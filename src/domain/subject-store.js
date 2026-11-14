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

export function createSubjectStore({ userDomain, yuanqiDomain, verifyDirectUserEvent, verifyBirthProfileConfirmation }) {
  if (!userDomain || !yuanqiDomain) throw new TypeError('both DSH subject domains are required');
  if (typeof verifyDirectUserEvent !== 'function' || typeof verifyBirthProfileConfirmation !== 'function') {
    throw new TypeError('host event verifiers are required');
  }
  const users = userDomain.table('identities');
  const births = userDomain.table('birth_profiles');
  const birthWorkflows = userDomain.table('birth_profile_workflows');
  if (typeof birthWorkflows.update !== 'function') throw new TypeError('BirthProfile workflow table must support atomic update');
  const yuanqis = yuanqiDomain.table('identities');
  const installationState = yuanqiDomain.table('installation_state');
  const firstMessages = yuanqiDomain.table('first_user_messages');
  const wakes = yuanqiDomain.table('wake_records');
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
    async saveBirthProfileCandidate({ subject_id, facts, field_sources, source_event }) {
      requiredText(subject_id, 'subject_id');
      if (!users.get(subject_id)) throw new Error('UserSubject does not exist');
      if (!facts || typeof facts !== 'object' || Array.isArray(facts) || Object.keys(facts).length === 0) {
        throw new TypeError('facts must be a non-empty object');
      }
      if (!field_sources || typeof field_sources !== 'object' || Array.isArray(field_sources)) {
        throw new TypeError('field_sources must be an object');
      }
      const event = verified(verifyDirectUserEvent, source_event, 'birth-profile-candidate');
      if (event.event_type !== 'user/message' || event.source_kind !== 'user') {
        throw new Error('BirthProfile candidate source must be a direct user message');
      }
      const factKeys = Object.keys(facts).sort();
      const sourceKeys = Object.keys(field_sources).sort();
      if (JSON.stringify(factKeys) !== JSON.stringify(sourceKeys)) {
        throw new Error('every BirthProfile fact must have exactly one field source');
      }
      const fields = {};
      for (const key of factKeys) {
        const source = field_sources[key];
        if (!source || typeof source !== 'object' ||
            source.source_event_ref !== event.event_id ||
            typeof source.raw_text !== 'string' ||
            !['user_explicit', 'model_extracted'].includes(source.extraction_kind)) {
          throw new Error('invalid provenance for BirthProfile field: ' + key);
        }
        fields[key] = {
          source_event_ref: event.event_id,
          raw_text: source.raw_text,
          extraction_kind: source.extraction_kind,
        };
      }
      const now = event.event_time;
      return serializeByKey(queues, 'birth-workflow:' + subject_id, async () => {
        let result;
        await birthWorkflows.update(subject_id, current => {
          if (current?.status === 'confirmed' || current?.status === 'revoked') {
            throw new Error('confirmed or revoked BirthProfile cannot be edited in place');
          }
          const revision = (current?.current_revision ?? 0) + 1;
          const entry = {
            revision, facts: clone(facts), field_sources: clone(fields),
            source_event_refs: [event.event_id], created_from_event_ref: event.event_id,
            created_at_ms: now,
          };
          const audit = {
            audit_id: 'birth-audit:' + subject_id + ':' + revision + ':candidate',
            action: current ? 'candidate_revised' : 'candidate_created',
            revision, event_ref: event.event_id, occurred_at_ms: now, details: {},
          };
          result = {
            subject_id, subject_kind: 'user', current_revision: revision,
            status: 'collecting', revisions: [...(current?.revisions ?? []), entry],
            challenge: current?.challenge ? { ...current.challenge, status: 'invalidated' } : null,
            confirmed_profile: null,
            audit_events: [
              ...(current?.audit_events ?? []),
              ...(current?.challenge?.status === 'active' ? [{
                audit_id: 'birth-audit:' + subject_id + ':' + current.current_revision + ':challenge-invalidated',
                action: 'challenge_invalidated', revision: current.current_revision,
                event_ref: event.event_id, occurred_at_ms: now, details: { reason: 'candidate_revised' },
              }] : []),
              audit,
            ],
            schema_version: 1,
          };
          return result;
        });
        return clone(result ?? birthWorkflows.get(subject_id));
      });
    },
    async issueBirthProfileConfirmationChallenge({ subject_id, challenge_id, session_id, issued_at_ms, expires_at_ms, issued_from_event_ref } = {}) {
      requiredText(subject_id, 'subject_id');
      requiredText(challenge_id, 'challenge_id');
      requiredText(session_id, 'session_id');
      requiredText(issued_from_event_ref, 'issued_from_event_ref');
      if (!Number.isSafeInteger(issued_at_ms) || issued_at_ms < 0 ||
          !Number.isSafeInteger(expires_at_ms) || expires_at_ms <= issued_at_ms) {
        throw new TypeError('valid challenge issue and expiry times are required');
      }
      return serializeByKey(queues, 'birth-workflow:' + subject_id, async () => {
        let result;
        await birthWorkflows.update(subject_id, current => {
          if (!current || !['collecting', 'awaiting_confirmation'].includes(current.status)) {
            throw new Error('no editable BirthProfile candidate exists');
          }
          const revision = current.current_revision;
          const audit = {
            audit_id: 'birth-audit:' + subject_id + ':' + revision + ':challenge:' + challenge_id,
            action: 'challenge_issued', revision, event_ref: issued_from_event_ref,
            occurred_at_ms: issued_at_ms, details: { challenge_id, session_id, expires_at_ms },
          };
          result = {
            ...current, status: 'awaiting_confirmation',
            challenge: {
              challenge_id, revision, session_id, issued_from_event_ref,
              issued_at_ms, expires_at_ms, status: 'active', consumed_by_event_ref: null,
            },
            audit_events: [...current.audit_events, audit],
          };
          return result;
        });
        return clone(result ?? birthWorkflows.get(subject_id));
      });
    },
    async confirmUserBirthProfile({ subject_id, confirmation_event } = {}) {
      requiredText(subject_id, 'subject_id');
      const event = verified(verifyBirthProfileConfirmation, confirmation_event, 'birth-profile-confirmation');
      if (event.event_type !== 'user/message' || event.source_kind !== 'user' ||
          event.text !== '确认出生资料') {
        throw new Error('confirmation must be the exact direct-user command 确认出生资料');
      }
      return serializeByKey(queues, 'birth-workflow:' + subject_id, async () => {
        let profile;
        await birthWorkflows.update(subject_id, current => {
          if (!current) throw new Error('BirthProfile candidate does not exist');
          if (current.status === 'confirmed') {
            if (current.confirmed_profile?.confirmation_event_ref === event.event_id) {
              profile = current.confirmed_profile;
              return current;
            }
            throw new Error('BirthProfile candidate has already been confirmed');
          }
          const challenge = current.challenge;
          if (current.status !== 'awaiting_confirmation' || !challenge ||
              challenge.status !== 'active') throw new Error('no active BirthProfile confirmation challenge');
          if (challenge.revision !== current.current_revision ||
              challenge.session_id !== event.session_id ||
              event.event_time <= challenge.issued_at_ms ||
              event.event_time > challenge.expires_at_ms) {
            throw new Error('BirthProfile confirmation challenge is stale, expired, or out of scope');
          }
          const revision = current.revisions.find(item => item.revision === challenge.revision);
          if (!revision) throw new Error('BirthProfile candidate revision is missing');
          profile = {
            profile_id: 'birth-profile:' + subject_id,
            subject_id, subject_kind: 'user', revision: revision.revision,
            facts: clone(revision.facts), confirmation_event_ref: event.event_id,
            confirmed_at_ms: event.event_time, status: 'confirmed',
          };
          return {
            ...current, status: 'confirmed',
            challenge: { ...challenge, status: 'consumed', consumed_by_event_ref: event.event_id },
            confirmed_profile: profile,
            audit_events: [...current.audit_events, {
              audit_id: 'birth-audit:' + subject_id + ':' + revision.revision + ':confirmed',
              action: 'confirmed', revision: revision.revision,
              event_ref: event.event_id, occurred_at_ms: event.event_time,
              details: { challenge_id: challenge.challenge_id },
            }],
          };
        });
        return clone(profile);
      });
    },
    async rejectBirthProfileCandidate({ subject_id, rejection_event } = {}) {
      requiredText(subject_id, 'subject_id');
      const event = verified(verifyBirthProfileConfirmation, rejection_event, 'birth-profile-rejection');
      if (event.event_type !== 'user/message' || event.source_kind !== 'user' ||
          event.text !== '拒绝出生资料') {
        throw new Error('rejection must be the exact direct-user command 拒绝出生资料');
      }
      return serializeByKey(queues, 'birth-workflow:' + subject_id, async () => {
        let result;
        await birthWorkflows.update(subject_id, current => {
          const challenge = current?.challenge;
          if (!current || current.status !== 'awaiting_confirmation' || !challenge ||
              challenge.status !== 'active' || challenge.revision !== current.current_revision ||
              challenge.session_id !== event.session_id ||
              event.event_time <= challenge.issued_at_ms || event.event_time > challenge.expires_at_ms) {
            throw new Error('no matching active BirthProfile challenge to reject');
          }
          result = {
            ...current, status: 'rejected',
            challenge: { ...challenge, status: 'consumed', consumed_by_event_ref: event.event_id },
            audit_events: [...current.audit_events, {
              audit_id: 'birth-audit:' + subject_id + ':' + current.current_revision + ':rejected',
              action: 'rejected', revision: current.current_revision,
              event_ref: event.event_id, occurred_at_ms: event.event_time,
              details: { challenge_id: challenge.challenge_id },
            }],
          };
          return result;
        });
        return clone(result ?? birthWorkflows.get(subject_id));
      });
    },
    async revokeUserBirthProfile({ subject_id, revocation_event } = {}) {
      requiredText(subject_id, 'subject_id');
      const event = verified(verifyBirthProfileConfirmation, revocation_event, 'birth-profile-revocation');
      if (event.event_type !== 'user/message' || event.source_kind !== 'user' ||
          event.text !== '撤销出生资料') {
        throw new Error('revocation must be the exact direct-user command 撤销出生资料');
      }
      return serializeByKey(queues, 'birth-workflow:' + subject_id, async () => {
        let profile;
        await birthWorkflows.update(subject_id, current => {
          if (!current || current.status !== 'confirmed' || !current.confirmed_profile) {
            throw new Error('no confirmed BirthProfile to revoke');
          }
          if (event.event_time <= current.confirmed_profile.confirmed_at_ms) {
            throw new Error('BirthProfile revocation event must follow confirmation');
          }
          profile = { ...current.confirmed_profile, status: 'revoked' };
          return {
            ...current, status: 'revoked', confirmed_profile: profile, challenge: null,
            audit_events: [...current.audit_events, {
              audit_id: 'birth-audit:' + subject_id + ':' + current.current_revision + ':revoked',
              action: 'revoked', revision: current.current_revision,
              event_ref: event.event_id, occurred_at_ms: event.event_time, details: {},
            }],
          };
        });
        return clone(profile);
      });
    },
    getBirthProfileWorkflow(id) { requiredText(id, 'subject_id'); const value = birthWorkflows.get(id); return value === undefined ? undefined : clone(value); },
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
        return clone(wakes.get(subject_id));
      });
    },
    async recordInitialWake(input) {
      const event = verified(verifyDirectUserEvent, input.direct_user_event, 'initial-wake');
      await recordFirstUserMessage({ subject_id: input.subject_id, direct_user_event: event });
      const existing = wakes.get(input.subject_id);
      if (existing !== undefined) return clone(existing);
      return createWakeRecord(input.subject_id, event, input.birth_location);
    },
    getFirstUserMessage(id) { requiredText(id, 'subject_id'); const value = firstMessages.get(id); return value === undefined ? undefined : clone(value); },
    getUserBirthProfile(id) { requiredText(id, 'subject_id'); const workflow = birthWorkflows.get(id); if (workflow?.confirmed_profile) return clone(workflow.confirmed_profile); const value = births.get(id); return value === undefined ? undefined : clone(value); },
    getWakeRecord(id) { requiredText(id, 'subject_id'); const value = wakes.get(id); return value === undefined ? undefined : clone(value); },
  });
}
