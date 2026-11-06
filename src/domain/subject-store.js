const COMMANDS = new Set(['启动元气', '启动元炁']);

function requiredText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(field + ' is required');
  }
  return value;
}

function clone(value) {
  return structuredClone(value);
}

function serializeByKey(queues, key, operation) {
  const previous = queues.get(key) ?? Promise.resolve();
  const result = previous.then(operation);
  const settled = result.then(() => undefined, () => undefined);
  queues.set(key, settled);
  return result.finally(() => {
    if (queues.get(key) === settled) queues.delete(key);
  });
}

async function putOnce(table, key, value, conflictMessage) {
  const existing = table.get(key);
  if (existing !== undefined) {
    if (JSON.stringify(existing) !== JSON.stringify(value)) throw new Error(conflictMessage);
    return clone(existing);
  }
  await table.put(key, value);
  return clone(table.get(key) ?? value);
}

function requireVerifiedEvent(verifier, event, purpose) {
  const result = verifier(event, purpose);
  if (!result || result.verified !== true) {
    throw new Error('unverified DSH event: ' + purpose);
  }
  return result;
}

/**
 * Creates the YuanQi subject repository over two independently opened DSH
 * Storage Domain handles. Event verifiers must be supplied by the trusted
 * DSH integration layer; model-provided identifiers and claims are not proof.
 */
export function createSubjectStore({
  userDomain,
  yuanqiDomain,
  verifyDirectUserEvent,
  verifyBirthProfileConfirmation,
}) {
  if (!userDomain || !yuanqiDomain) throw new TypeError('both DSH subject domains are required');
  if (typeof verifyDirectUserEvent !== 'function' || typeof verifyBirthProfileConfirmation !== 'function') {
    throw new TypeError('host event verifiers are required');
  }

  const users = userDomain.table('identities');
  const births = userDomain.table('birth_profiles');
  const yuanqis = yuanqiDomain.table('identities');
  const wakes = yuanqiDomain.table('wake_records');
  const queues = new Map();

  async function createIdentity(table, kind, subjectId, eventRef) {
    requiredText(subjectId, 'subject_id');
    requiredText(eventRef, 'created_from_event_ref');
    const record = {
      subject_id: subjectId,
      subject_kind: kind,
      identity_version: 1,
      status: 'active',
      created_from_event_ref: eventRef,
    };
    return serializeByKey(queues, kind + ':' + subjectId, () =>
      putOnce(table, subjectId, record, kind + ' identity conflict'));
  }

  return Object.freeze({
    createUserSubject({ subject_id, created_from_event_ref }) {
      return createIdentity(users, 'user', subject_id, created_from_event_ref);
    },
    createYuanQiSubject({ subject_id, created_from_event_ref }) {
      return createIdentity(yuanqis, 'yuanqi', subject_id, created_from_event_ref);
    },
    getUserSubject(subjectId) {
      requiredText(subjectId, 'subject_id');
      const record = users.get(subjectId);
      return record === undefined ? undefined : clone(record);
    },
    getYuanQiSubject(subjectId) {
      requiredText(subjectId, 'subject_id');
      const record = yuanqis.get(subjectId);
      return record === undefined ? undefined : clone(record);
    },
    async confirmUserBirthProfile({ profile_id, subject_id, facts, confirmation_event }) {
      requiredText(profile_id, 'profile_id');
      requiredText(subject_id, 'subject_id');
      if (!facts || typeof facts !== 'object' || Array.isArray(facts)) {
        throw new TypeError('facts must be an object');
      }
      if (!users.get(subject_id)) throw new Error('UserSubject does not exist');

      const event = requireVerifiedEvent(
        verifyBirthProfileConfirmation,
        confirmation_event,
        'birth-profile-confirmation',
      );
      requiredText(event.event_id, 'confirmation_event.event_id');
      const record = {
        profile_id,
        subject_id,
        subject_kind: 'user',
        facts: clone(facts),
        confirmation_event_ref: event.event_id,
        status: 'confirmed',
      };
      return serializeByKey(queues, 'birth:' + profile_id, () =>
        putOnce(births, profile_id, record, 'birth profile conflict'));
    },
    async recordInitialWake({ subject_id, direct_user_event }) {
      requiredText(subject_id, 'subject_id');
      if (!yuanqis.get(subject_id)) throw new Error('YuanQiSubject does not exist');

      const event = requireVerifiedEvent(verifyDirectUserEvent, direct_user_event, 'initial-wake');
      if (event.is_first_conversation_user_message !== true) {
        throw new Error('wake requires the first conversation user message');
      }
      const command = typeof event.text === 'string' ? event.text.trim() : '';
      if (!COMMANDS.has(command)) {
        throw new Error('wake command must exactly match 启动元气 or 启动元炁');
      }
      requiredText(event.event_id, 'wake event id');
      requiredText(event.first_conversation_event_ref, 'first conversation event ref');
      const occurredAt = new Date(event.occurred_at);
      if (!Number.isFinite(occurredAt.getTime())) {
        throw new TypeError('valid DSH event time is required');
      }

      const record = {
        wake_record_id: 'wake:' + subject_id,
        subject_id,
        subject_kind: 'yuanqi',
        first_conversation_event_ref: event.first_conversation_event_ref,
        wake_event_ref: event.event_id,
        trigger_command: command,
        occurred_at: occurredAt.toISOString(),
        schema_version: 2,
      };
      return serializeByKey(queues, 'wake:' + subject_id, async () => {
        const existing = wakes.get(subject_id);
        return existing === undefined
          ? putOnce(wakes, subject_id, record, 'wake record conflict')
          : clone(existing);
      });
    },
    getUserBirthProfile(profileId) {
      requiredText(profileId, 'profile_id');
      const record = births.get(profileId);
      return record === undefined ? undefined : clone(record);
    },
    getWakeRecord(subjectId) {
      requiredText(subjectId, 'subject_id');
      const record = wakes.get(subjectId);
      return record === undefined ? undefined : clone(record);
    },
  });
}
