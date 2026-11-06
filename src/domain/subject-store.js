const COMMANDS = new Set(['启动元气', '启动元炁']);
const queues = new Map();
function text(value, name) { if (typeof value !== 'string' || !value.trim()) throw new TypeError(name + ' is required'); return value; }
function clone(value) { return structuredClone(value); }
function serial(key, fn) { const prev = queues.get(key) || Promise.resolve(); const next = prev.then(fn); const settled = next.then(() => undefined, () => undefined); queues.set(key, settled); return next.finally(() => { if (queues.get(key) === settled) queues.delete(key); }); }
async function putOnce(table, key, value, message) { const old = table.get(key); if (old !== undefined) { if (JSON.stringify(old) !== JSON.stringify(value)) throw new Error(message); return clone(old); } await table.put(key, value); return clone(table.get(key) || value); }
function verified(verifier, event, purpose) { const result = verifier(event, purpose); if (!result || result.verified !== true) throw new Error('unverified DSH event: ' + purpose); return result; }
export function createSubjectStore({ userDomain, yuanqiDomain, verifyDirectUserEvent, verifyBirthProfileConfirmation }) {
  if (!userDomain || !yuanqiDomain) throw new TypeError('both DSH subject domains are required');
  if (typeof verifyDirectUserEvent !== 'function' || typeof verifyBirthProfileConfirmation !== 'function') throw new TypeError('host event verifiers are required');
  const users = userDomain.table('identities');
  const births = userDomain.table('birth-profiles');
  const yuanqis = yuanqiDomain.table('identities');
  const wakes = yuanqiDomain.table('wake-records');
  async function create(table, kind, id, eventRef) {
    text(id, 'subject_id'); text(eventRef, 'created_from_event_ref');
    const record = { subject_id: id, subject_kind: kind, identity_version: 1, status: 'active', created_from_event_ref: eventRef };
    return serial(kind + ':' + id, () => putOnce(table, id, record, kind + ' identity conflict'));
  }
  return Object.freeze({
    createUserSubject({ subject_id, created_from_event_ref }) { return create(users, 'user', subject_id, created_from_event_ref); },
    createYuanQiSubject({ subject_id, created_from_event_ref }) { return create(yuanqis, 'yuanqi', subject_id, created_from_event_ref); },
    getUserSubject(id) { text(id, 'subject_id'); const v = users.get(id); return v === undefined ? undefined : clone(v); },
    getYuanQiSubject(id) { text(id, 'subject_id'); const v = yuanqis.get(id); return v === undefined ? undefined : clone(v); },
    async confirmUserBirthProfile({ profile_id, subject_id, facts, confirmation_event }) {
      text(profile_id, 'profile_id'); text(subject_id, 'subject_id');
      if (!facts || typeof facts !== 'object' || Array.isArray(facts)) throw new TypeError('facts must be an object');
      if (!users.get(subject_id)) throw new Error('UserSubject does not exist');
      const event = verified(verifyBirthProfileConfirmation, confirmation_event, 'birth-profile-confirmation');
      text(event.event_id, 'confirmation_event.event_id');
      const record = { profile_id, subject_id, subject_kind: 'user', facts: clone(facts), confirmation_event_ref: event.event_id, status: 'confirmed' };
      return serial('birth:' + profile_id, () => putOnce(births, profile_id, record, 'birth profile conflict'));
    },
    async recordInitialWake({ subject_id, direct_user_event }) {
      text(subject_id, 'subject_id'); if (!yuanqis.get(subject_id)) throw new Error('YuanQiSubject does not exist');
      const event = verified(verifyDirectUserEvent, direct_user_event, 'initial-wake');
      if (event.is_first_conversation_user_message !== true) throw new Error('wake requires the first conversation user message');
      const command = typeof event.text === 'string' ? event.text.trim() : '';
      if (!COMMANDS.has(command)) throw new Error('wake command must exactly match 启动元气 or 启动元炁');
      text(event.event_id, 'wake event id'); text(event.first_conversation_event_ref, 'first conversation event ref');
      const time = new Date(event.occurred_at); if (!Number.isFinite(time.getTime())) throw new TypeError('valid DSH event time is required');
      const record = { wake_record_id: 'wake:' + subject_id, subject_id, subject_kind: 'yuanqi', first_conversation_event_ref: event.first_conversation_event_ref, wake_event_ref: event.event_id, trigger_command: command, occurred_at: time.toISOString(), schema_version: 2 };
      return serial('wake:' + subject_id, async () => { const old = wakes.get(subject_id); return old === undefined ? putOnce(wakes, subject_id, record, 'wake record conflict') : clone(old); });
    },
    getUserBirthProfile(id) { text(id, 'profile_id'); const v = births.get(id); return v === undefined ? undefined : clone(v); },
    getWakeRecord(id) { text(id, 'subject_id'); const v = wakes.get(id); return v === undefined ? undefined : clone(v); },
  });
}
