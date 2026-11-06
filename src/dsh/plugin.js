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

  async function observe(session, event) {
    if (!active || storageUncertain) return;
    const direct = normalizeDirectUserMessageEvent(session?.id, event);
    if (!direct) return;
    await store.createUserSubject({ subject_id: USER_SUBJECT_ID, created_from_event_ref: direct.event_id });
    await store.createYuanQiSubject({ subject_id: YUANQI_SUBJECT_ID, created_from_event_ref: direct.event_id });
    await store.recordInitialWake({ subject_id: YUANQI_SUBJECT_ID, direct_user_event: direct });

    const mainline = await worldlines.createMainline({
      yuanqi_subject_id: YUANQI_SUBJECT_ID,
      worldline_id: 'worldline:main',
      created_from_event: {
        ...direct,
        source_kind: 'direct_user_event',
        source_event_ref: direct.event_id,
        occurred_at: new Date(direct.event_time).toISOString(),
      },
    });
    const binding = worldlines.getSessionBinding(session.id);
    if (!binding) {
      await worldlines.bindSession({
        session_id: session.id,
        yuanqi_subject_id: YUANQI_SUBJECT_ID,
        worldline_id: mainline.worldline_id,
        bound_from_event_ref: direct.event_id,
      });
    } else if (binding.yuanqi_subject_id !== YUANQI_SUBJECT_ID) {
      throw new Error('Session is bound to a different YuanQiSubject');
    }
  }

  function track(sessionId, task) {
    let tasks = pendingBySession.get(sessionId);
    if (!tasks) { tasks = new Set(); pendingBySession.set(sessionId, tasks); }
    tasks.add(task);
    // The host's session/event feed is fire-and-forget. Mark the rejection as
    // observed here, but retain the original task until session/flush reports it.
    void task.catch(() => {});
  }

  async function drainSession(sessionId) {
    const failures = [];
    while (true) {
      const tasks = pendingBySession.get(sessionId);
      if (!tasks || tasks.size === 0) break;
      const batch = [...tasks];
      const results = await Promise.allSettled(batch);
      for (let index = 0; index < batch.length; index += 1) {
        const result = results[index];
        if (result.status === 'rejected') failures.push(result.reason);
        tasks.delete(batch[index]);
      }
      if (tasks.size === 0 && pendingBySession.get(sessionId) === tasks) {
        pendingBySession.delete(sessionId);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'YuanQi Session writes failed before the DSH flush checkpoint');
    }
  }

  ctx.on('session/event', (session, event) => {
    const task = observe(session, event).catch(error => {
      if (error?.code === 'unknown-state') {
        storageUncertain = true;
        active = false;
        ctx.logger?.warn?.('[yuanqi] Storage Domain state is unknown; YuanQi has failed closed. Unload and reload the plugin to reopen and validate the Domains.');
      } else {
        ctx.logger?.warn?.('[yuanqi] session event processing failed: ' + String(error));
      }
      throw error;
    });
    track(session.id, task);
    return task;
  });

  // session/event is post-commit and fire-and-forget. Keep settled failures
  // until this awaited checkpoint consumes them; otherwise a fast rejection
  // could disappear before session/flush observes it.
  ctx.on('session/flush', async session => {
    await drainSession(session.id);
  });

  ctx.effect(() => async () => {
    active = false;
    const sessionIds = [...pendingBySession.keys()];
    await Promise.allSettled(sessionIds.map(drainSession));
    await domains.close();
  });
}
