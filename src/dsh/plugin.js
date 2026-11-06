import { createSubjectStore } from '../domain/subject-store.js';
import { openSubjectDomains } from '../domain/subject-domain.js';
import { normalizeDirectUserMessageEvent } from './session-event.js';

export const name = 'dsh-yuanqi-plugin';
export const inject = ['storageDomain', 'sessions'];

const USER_SUBJECT_ID = 'user:primary';
const YUANQI_SUBJECT_ID = 'yuanqi:primary';

/**
 * Cordis plugin entry. The first direct user event creates the two primary
 * subjects and permanently records first-message wake eligibility.
 */
export async function apply(ctx) {
  const domains = await openSubjectDomains(ctx.storageDomain);
  const store = createSubjectStore({
    userDomain: domains.userDomain,
    yuanqiDomain: domains.yuanqiDomain,
    verifyDirectUserEvent(event) {
      return event?.verified === true ? event : null;
    },
    // Birth-profile confirmation is intentionally unavailable until the
    // explicit user-confirmation UI/tool is wired to a trusted DSH event.
    verifyBirthProfileConfirmation() {
      return null;
    },
  });

  let active = true;
  const pending = new Set();

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
    await store.recordInitialWake({
      subject_id: YUANQI_SUBJECT_ID,
      direct_user_event: direct,
    });
  }

  ctx.on('session/event', (session, event) => {
    const task = observe(session, event)
      .catch(error => {
        ctx.logger?.warn?.('[yuanqi] session event processing failed: ' + String(error));
      })
      .finally(() => pending.delete(task));
    pending.add(task);
    return task;
  });

  ctx.effect(() => async () => {
    active = false;
    await Promise.allSettled([...pending]);
    await domains.close();
  });
}
