const COMMANDS = new Set(['启动元气', '启动元炁']);

function requiredText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(field + ' is required');
  return value;
}
function clone(value) { return structuredClone(value); }
function serializeByKey(queues, key, operation) {
  const previous = queues.get(key) ?? Promise.resolve();
  const result = previous.then(operation);
  const settled = result.then(() => undefined, () => undefined);
  queues.set(key, settled);
  return result.finally(() => { if (queues.get(key) === settled) queues.delete(key); });
}
async function putOnce(table, key, value, message) {
  const old = table.get(key);
  if (old !== undefined) {
    if (JSON.stringify(old) !== JSON.stringify(value)) throw new Error(message);
    return clone(old);
  }
  await table.put(key, value);
  return clone(table.get(key) ?? value);
}
function verified(verifier, event, purpose) {
  // The injected verifier is the trust authority. A caller-controlled boolean
  // on the event object is not a credential.
  const value = verifier(event, purpose);
  if (!value) throw new Error('unverified DSH event: ' + purpose);
  return value;
}
function firstMessageFields(event) {
  if (event.event_type !== 'user/message' || event.source_kind !== 'user') {
    throw new Error('only direct DSH user/message events may establish the first-message lock');
  }
  requiredText(event.session_id, 'session_id');
  requiredText(event.event_id, 'event_id');
  if (!Number.isSafeInteger(event.event_seq) || event.event_seq < 0) throw new TypeError('valid DSH event sequence is required');
  if (!Number.isSafeInteger(event.event_time) || event.event_time < 0) throw new TypeError('valid DSH event time is required');
  if (typeof event.text !== 'string') throw new TypeError('direct user message text is required');
  return {
    first_session_id: event.session_id,
    first_event_id: event.event_id,
    first_event_seq: event.event_seq,
    first_event_time: event.event_time,
    source_kind: 'user',
    event_type: 'user/message',
    trigger_command: COMMANDS.has(event.text) ? event.text : null,
  };
}
function wakeFields(event) {
  if (event.event_type !== 'user/message' || event.source_kind !== 'user' || !COMMANDS.has(event.text)) {
    return null;
  }
  requiredText(event.session_id, 'session_id');
  requiredText(event.event_id, 'event_id');
  if (!Number.isSafeInteger(event.event_seq) || event.event_seq < 0) throw new TypeError('valid DSH event sequence is required');
  if (!Number.isSafeInteger(event.event_time) || event.event_time < 0) throw new TypeError('valid DSH event time is required');
  const occurredAt = new Date(event.event_time);
  if (!Number.isFinite(occurredAt.getTime())) throw new TypeError('valid DSH event time is required');
  return {
    first_conversation_event_ref: event.event_id,
    first_session_id: event.session_id,
    first_event_seq: event.event_seq,
    wake_event_ref: event.event_id,
    trigger_command: event.text,
    occurred_at: occurredAt.toISOString(),
    birth_time: occurredAt.toISOString(),
  };
}
function unavailableLocation() {
  return {
    status: 'unavailable', latitude: null, longitude: null, accuracy_meters: null,
    place_label: null, time_zone_id: null, source: 'unavailable', captured_at: null,
  };
}

export function createSubjectStore({ userDomain, yuanqiDomain, verifyDirectUserEvent }) {
  if (!userDomain || !yuanqiDomain) throw new TypeError('both DSH subject domains are required');
  if (typeof verifyDirectUserEvent !== 'function') throw new TypeError('host event verifier is required');
  const users = userDomain.table('identities');
  const yuanqis = yuanqiDomain.table('identities');
  const installationState = yuanqiDomain.table('installation_state');
  const firstMessages = yuanqiDomain.table('first_user_messages');
  const wakes = yuanqiDomain.table('wake_records');
  const birthProfiles = yuanqiDomain.table('birth_profiles');
  const queues = new Map();

  async function identity(table, kind, id, ref) {
    requiredText(id, 'subject_id');
    requiredText(ref, 'created_from_event_ref');
    const value = { subject_id: id, subject_kind: kind, identity_version: 1, status: 'active', created_from_event_ref: ref };
    return serializeByKey(queues, kind + ':' + id, async () => {
      const old = table.get(id);
      if (old !== undefined) {
        if (old.subject_kind !== kind) throw new Error(kind + ' identity kind conflict');
        return clone(old);
      }
      return putOnce(table, id, value, kind + ' identity conflict');
    });
  }

  async function recordFirstUserMessage({ subject_id, direct_user_event }) {
    requiredText(subject_id, 'subject_id');
    if (!yuanqis.get(subject_id)) throw new Error('YuanQiSubject does not exist');
    const event = verified(verifyDirectUserEvent, direct_user_event, 'first-user-message');
    const fields = firstMessageFields(event);
    return serializeByKey(queues, 'first-user:' + subject_id, async () => {
      const old = firstMessages.get(subject_id);
      if (old !== undefined) return clone(old);
      return putOnce(firstMessages, subject_id, {
        subject_id, subject_kind: 'yuanqi', ...fields, schema_version: 1,
      }, 'first user message lock conflict');
    });
  }

  async function createWakeRecord(subject_id, event, birth_location) {
    const fields = wakeFields(event);
    if (!fields) return undefined;
    return serializeByKey(queues, 'wake:' + subject_id, async () => {
      const old = wakes.get(subject_id);
      if (old !== undefined) return clone(old);
      const location = birth_location && typeof birth_location === 'object'
        ? clone(birth_location)
        : unavailableLocation();
      return putOnce(wakes, subject_id, {
        wake_record_id: 'wake:' + subject_id,
        subject_id,
        subject_kind: 'yuanqi',
        ...fields,
        birth_location: location,
        schema_version: 4,
      }, 'wake record conflict');
    });
  }

  async function recoverInitialWake({ subject_id, birth_location } = {}) {
    requiredText(subject_id, 'subject_id');
    if (!yuanqis.get(subject_id)) throw new Error('YuanQiSubject does not exist');
    const existing = wakes.get(subject_id);
    if (existing !== undefined) return clone(existing);
    // Backward compatibility: recover a wake written by the old first-message-gated implementation.
    const first = firstMessages.get(subject_id);
    if (!first || !COMMANDS.has(first.trigger_command)) return undefined;
    return createWakeRecord(subject_id, {
      verified: true,
      event_type: 'user/message',
      source_kind: 'user',
      session_id: first.first_session_id,
      event_id: first.first_event_id,
      event_seq: first.first_event_seq,
      event_time: first.first_event_time,
      text: first.trigger_command,
    }, birth_location);
  }

  async function ensureYuanQiBirthProfile({ subject_id } = {}) {
      requiredText(subject_id, 'subject_id');
      if (!yuanqis.get(subject_id)) throw new Error('YuanQiSubject does not exist');
      return serializeByKey(queues, 'yuanqi-birth-profile:' + subject_id, async () => {
        const wake = wakes.get(subject_id);
        if (!wake) return undefined;
        const location = clone(wake.birth_location ?? unavailableLocation());
        const timeZone = location.time_zone_id ?? null;
        const existing = birthProfiles.get(subject_id);
        const profile = {
          profile_id: 'birth-profile:' + subject_id,
          subject_id,
          subject_kind: 'yuanqi',
          birth_time: wake.birth_time ?? wake.occurred_at,
          birth_location: location,
          source_wake_event_ref: wake.wake_event_ref,
          source_event_time_ms: Date.parse(wake.birth_time ?? wake.occurred_at),
          time_context: {
            status: location.status === 'unavailable' ? 'unavailable' : (timeZone ? 'ready' : 'pending'),
            time_zone_id: timeZone,
            local_datetime: null,
          },
          bazi: {
            status: 'pending',
            calendar_system: 'jieqi',
            pillars: null,
            algorithm_version: null,
            calculated_at: null,
          },
          schema_version: 1,
        };
        if (existing === undefined) {
          return putOnce(birthProfiles, subject_id, profile, 'YuanQi BirthProfile creation conflict');
        }
        if (existing.subject_kind !== 'yuanqi' || existing.source_wake_event_ref !== wake.wake_event_ref ||
            existing.birth_time !== profile.birth_time) {
          throw new Error('YuanQi BirthProfile source conflict');
        }
        if (existing.birth_location?.status === 'pending' && location.status !== 'pending') {
          if (typeof birthProfiles.update !== 'function') {
            throw new TypeError('YuanQi BirthProfile location completion requires DSH Domain table.update');
          }
          await birthProfiles.update(subject_id, current => current?.birth_location?.status === 'pending'
            ? { ...current, birth_location: location, time_context: profile.time_context }
            : current);
          return clone(birthProfiles.get(subject_id));
        }
        return clone(existing);
      });
  }

  return Object.freeze({
    async getOrCreateInstallationBoundary(now) {
      if (!Number.isSafeInteger(now) || now < 0) throw new TypeError('installation boundary clock must be Unix milliseconds');
      return serializeByKey(queues, 'installation:primary', async () => {
        const old = installationState.get('installation:primary');
        if (old !== undefined) {
          if (old.installation_id !== 'installation:primary' || old.schema_version !== 1 ||
              !Number.isSafeInteger(old.activated_at_ms) || old.activated_at_ms < 0) {
            throw new Error('persisted YuanQi installation boundary is invalid');
          }
          return clone(old);
        }
        return putOnce(installationState, 'installation:primary', {
          installation_id: 'installation:primary', activated_at_ms: now, schema_version: 1,
        }, 'installation boundary conflict');
      });
    },
    createUserSubject({ subject_id, created_from_event_ref }) {
      return identity(users, 'user', subject_id, created_from_event_ref);
    },
    createYuanQiSubject({ subject_id, created_from_event_ref }) {
      return identity(yuanqis, 'yuanqi', subject_id, created_from_event_ref);
    },
    getUserSubject(id) { requiredText(id, 'subject_id'); const value = users.get(id); return value === undefined ? undefined : clone(value); },
    getYuanQiSubject(id) { requiredText(id, 'subject_id'); const value = yuanqis.get(id); return value === undefined ? undefined : clone(value); },
    ensureYuanQiBirthProfile,
    getYuanQiBirthProfile(id) {
      requiredText(id, 'subject_id');
      const value = birthProfiles.get(id);
      return value === undefined ? undefined : clone(value);
    },
    recordFirstUserMessage,
    recoverInitialWake,
    async completeInitialWakeLocation({ subject_id, birth_location } = {}) {
      requiredText(subject_id, 'subject_id');
      if (!birth_location || typeof birth_location !== 'object' || Array.isArray(birth_location) ||
          !['captured', 'unavailable'].includes(birth_location.status)) {
        throw new TypeError('birth_location must be a captured or unavailable location result');
      }
      return serializeByKey(queues, 'wake:' + subject_id, async () => {
        if (wakes.get(subject_id) === undefined) throw new Error('WakeRecord does not exist');
        await wakes.update(subject_id, current => {
          if (current === undefined) throw new Error('WakeRecord does not exist');
          if (current.birth_location?.status !== 'pending') return current;
          return { ...current, birth_location: clone(birth_location) };
        });
        await ensureYuanQiBirthProfile({ subject_id });
        return clone(wakes.get(subject_id));
      });
    },
    async recordInitialWake(input) {
      const event = verified(verifyDirectUserEvent, input.direct_user_event, 'initial-wake');
      await recordFirstUserMessage({ subject_id: input.subject_id, direct_user_event: event });
      const existing = wakes.get(input.subject_id);
      if (existing !== undefined) {
        await ensureYuanQiBirthProfile({ subject_id: input.subject_id });
        return clone(existing);
      }
      const wake = await createWakeRecord(input.subject_id, event, input.birth_location);
      if (wake) await ensureYuanQiBirthProfile({ subject_id: input.subject_id });
      return wake;
    },
    getFirstUserMessage(id) { requiredText(id, 'subject_id'); const value = firstMessages.get(id); return value === undefined ? undefined : clone(value); },
    getWakeRecord(id) { requiredText(id, 'subject_id'); const value = wakes.get(id); return value === undefined ? undefined : clone(value); },
  });
}
