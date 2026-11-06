import { createSubjectStore } from '../domain/subject-store.js';
import { openSubjectDomains } from '../domain/subject-domain.js';
import { normalizeDirectUserMessageEvent } from './session-event.js';

export const name = 'dsh-yuanqi-plugin';
export const inject = ['storageDomain', 'sessions'];

const USER_SUBJECT_ID = 'user:primary';
const YUANQI_SUBJECT_ID = 'yuanqi:primary';

export async function apply(ctx) {
  const domains = await openSubjectDomains(ctx.storageDomain);
  const store = createSubjectStore({
    userDomain: domains.userDomain,
    yuanqiDomain: domains.yuanqiDomain,
    verifyDirectUserEvent(event) { return event?.verified === true ? event : null; },
    verifyBirthProfileConfirmation() { return null; },
  });

  let active = true;
  const pendingBySession = new Map();

  async function observe(session, event) {
    if (!active) return;
    const direct = normalizeDirectUserMessageEvent(session?.id, event);
    if (!direct) return;
    await store.createUserSubject({ subject_id: USER_SUBJECT_ID, created_from_event_ref: direct.event_id });
    await store.createYuanQiSubject({ subject_id: YUANQI_SUBJECT_ID, created_from_event_ref: direct.event_id });
    await store.recordInitialWake({ subject_id: YUANQI_SUBJECT_ID, direct_user_event: direct });
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
