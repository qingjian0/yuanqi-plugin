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
  const pendingBySession = new Map();

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
    if (!active) return;
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

  function track(sessionId, task) {
    let tasks = pendingBySession.get(sessionId);
    if (!tasks) { tasks = new Set(); pendingBySession.set(sessionId, tasks); }
    tasks.add(task);
    const remove = () => {
      tasks.delete(task);
      if (tasks.size === 0) pendingBySession.delete(sessionId);
    };
    task.then(remove, remove);
  }

  ctx.on('session/event', (session, event) => {
    const task = observe(session, event).catch(error => {
      ctx.logger?.warn?.('[yuanqi] session event processing failed: ' + String(error));
      throw error;
    });
    track(session.id, task);
    return task;
  });

  // session/event is post-commit and fire-and-forget. The awaited flush
  // barrier makes sure our cross-session lock write settles before the host
  // completes its durability checkpoint for this Session.
  ctx.on('session/flush', async session => {
    const tasks = [...(pendingBySession.get(session.id) ?? [])];
    await Promise.all(tasks);
  });

  ctx.effect(() => async () => {
    active = false;
    await Promise.allSettled([...pendingBySession.values()].flatMap(tasks => [...tasks]));
    await domains.close();
  });
}
