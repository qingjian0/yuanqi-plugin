import { createSubjectStore } from '../domain/subject-store.js';
import { openSubjectDomains } from '../domain/subject-domain.js';
import { normalizeDirectUserMessageEvent } from './session-event.js';
import { createWorldlineStore } from '../worldline/runtime.js';

export const name = 'dsh-yuanqi-plugin';
export const inject = ['storageDomain', 'sessions'];

const USER_SUBJECT_ID = 'user:primary';
const YUANQI_SUBJECT_ID = 'yuanqi:primary';

export async function apply(ctx) {
  const domains = await openSubjectDomains(ctx.storageDomain);
  try {
  const worldlines = createWorldlineStore({
    yuanqiDomain: domains.yuanqiDomain,
    verifyHostEvent(event) { return event?.verified === true ? event : null; },
  });
  const store = createSubjectStore({
    userDomain: domains.userDomain,
    yuanqiDomain: domains.yuanqiDomain,
    verifyDirectUserEvent(event) { return event?.verified === true ? event : null; },
    verifyBirthProfileConfirmation() { return null; },
  });

  let active = true;
  let storageUncertain = false;
  const pendingBySession = new Map();

  function warn(message) {
    try { ctx.logger?.warn?.(message); } catch {}
  }

  async function ensureWorldlineForWake(wake) {
    const first = store.getFirstUserMessage(YUANQI_SUBJECT_ID);
    if (!wake || !first || first.trigger_command === null) return null;

    const createdFromEvent = {
      verified: true,
      event_id: first.first_event_id,
      source_kind: 'direct_user_event',
      source_event_ref: first.first_event_id,
      occurred_at: new Date(first.first_event_time).toISOString(),
    };
    const mainline = await worldlines.createMainline({
      yuanqi_subject_id: YUANQI_SUBJECT_ID,
      worldline_id: 'worldline:main',
      created_from_event: createdFromEvent,
    });

    const existing = worldlines.getSessionBinding(first.first_session_id);
    if (!existing) {
      await worldlines.bindSession({
        session_id: first.first_session_id,
        yuanqi_subject_id: YUANQI_SUBJECT_ID,
        worldline_id: mainline.worldline_id,
        bound_from_event_ref: first.first_event_id,
      });
    } else if (existing.yuanqi_subject_id !== YUANQI_SUBJECT_ID ||
               existing.worldline_id !== mainline.worldline_id) {
      throw new Error('first Session is bound to a different Worldline');
    }
    return mainline;
  }

  // Recover a crash after the durable first-message lock or wake record was
  // written but before Worldline creation and Session binding completed.
  if (store.getYuanQiSubject(YUANQI_SUBJECT_ID)) {
    const recoveredWake = await store.recoverInitialWake({ subject_id: YUANQI_SUBJECT_ID });
    if (recoveredWake) await ensureWorldlineForWake(recoveredWake);
  }

  async function observe(session, event) {
    if (!active || storageUncertain) return;
    const direct = normalizeDirectUserMessageEvent(session?.id, event);
    if (!direct) return;

    await store.createUserSubject({
      subject_id: USER_SUBJECT_ID,
      created_from_event_ref: direct.event_id,
    });
    await store.createYuanQiSubject({
      subject_id: YUANQI_SUBJECT_ID,
      created_from_event_ref: direct.event_id,
    });

    const wake = await store.recordInitialWake({
      subject_id: YUANQI_SUBJECT_ID,
      direct_user_event: direct,
    });
    if (!wake) return;

    const mainline = await ensureWorldlineForWake(wake);
    const binding = worldlines.getSessionBinding(session.id);
    if (!binding) {
      await worldlines.bindSession({
        session_id: session.id,
        yuanqi_subject_id: YUANQI_SUBJECT_ID,
        worldline_id: mainline.worldline_id,
        bound_from_event_ref: direct.event_id,
      });
    } else if (binding.yuanqi_subject_id !== YUANQI_SUBJECT_ID ||
               binding.worldline_id !== mainline.worldline_id) {
      throw new Error('Session is bound to a different YuanQiSubject or Worldline');
    }
  }

  function track(sessionId, run) {
    let tasks = pendingBySession.get(sessionId);
    if (!tasks) { tasks = new Set(); pendingBySession.set(sessionId, tasks); }

    const entry = { run, promise: null, execute: null };
    const remove = () => {
      tasks.delete(entry);
      if (tasks.size === 0 && pendingBySession.get(sessionId) === tasks) {
        pendingBySession.delete(sessionId);
      }
    };
    entry.execute = () => {
      let result;
      try {
        // Start synchronously up to the first await, preserving event admission order.
        result = run();
      } catch (error) {
        result = Promise.reject(error);
      }
      const task = Promise.resolve(result).catch(error => {
        if (error?.code === 'unknown-state') {
          storageUncertain = true;
          active = false;
          warn('[yuanqi] Storage Domain state is unknown; YuanQi has failed closed. Unload and reload the plugin to reopen and validate the Domains.');
        } else {
          warn('[yuanqi] session event processing failed: ' + String(error));
        }
        throw error;
      });
      entry.promise = task;
      // Successful writes leave the pending set. Failed writes remain there
      // until a flush retries them or teardown reports the failure.
      task.then(remove, () => {});
      return task;
    };

    tasks.add(entry);
    return entry.execute();
  }

  async function flushSession(sessionId) {
    while (true) {
      const tasks = pendingBySession.get(sessionId);
      if (!tasks?.size) return;

      const batch = [...tasks];
      const results = await Promise.allSettled(batch.map(entry => entry.promise));
      const failed = [];
      const failedReasons = [];
      results.forEach((result, index) => {
        const entry = batch[index];
        if (result.status === 'fulfilled') tasks.delete(entry);
        else {
          failed.push(entry);
          failedReasons.push(result.reason);
        }
      });

      if (failed.length) {
        // An unknown durable outcome quarantines the DSH Domain. Never retry
        // through the same handle; only close/reopen can re-establish state.
        if (storageUncertain) {
          throw new AggregateError(
            failedReasons,
            'YuanQi Storage Domain state is unknown; unload and reload is required',
          );
        }
        // Domain operations are idempotent. Retry ordinary transient failures
        // once at the durability checkpoint; persistent failures remain visible.
        const retries = await Promise.allSettled(failed.map(entry => entry.execute()));
        const retryErrors = retries
          .filter(result => result.status === 'rejected')
          .map(result => result.reason);
        if (retryErrors.length) {
          throw new AggregateError(retryErrors, 'YuanQi session writes failed after flush retry');
        }
      }
      // Re-read the set on every pass so work admitted while this flush was
      // waiting is also drained before the checkpoint resolves.
    }
  }

  ctx.on('session/event', (session, event) => {
    if (!active || storageUncertain) return;
    return track(session.id, () => observe(session, event));
  });

  // session/event is post-commit and fire-and-forget. The awaited flush
  // barrier drains all admitted work, retries transient failures, and reports
  // persistent failures before the host completes its durability checkpoint.
  ctx.on('session/flush', async session => {
    await flushSession(session.id);
  });

  ctx.effect(() => async () => {
    active = false;
    const pending = [...pendingBySession.values()].flatMap(tasks => [...tasks]);
    const results = await Promise.allSettled(pending.map(entry => entry.promise));
    await domains.close();
    const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
    if (errors.length) throw new AggregateError(errors, 'YuanQi session writes failed during plugin teardown');
  });
  } catch (error) {
    try {
      await domains.close();
    } catch (closeError) {
      throw new AggregateError(
        [error, closeError],
        'YuanQi plugin initialization failed and Storage Domains could not both close cleanly',
      );
    }
    throw error;
  }
}
