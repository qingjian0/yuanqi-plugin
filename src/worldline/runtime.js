const SELF_MODEL_CENTERS = Object.freeze([
  'identity_continuity',
  'experience_memory',
  'cognition_reflection',
  'emotion_appraisal',
  'goals_agency',
]);
const EPISTEMIC_STATES = new Set(['hypothesis', 'evidence_supported', 'user_confirmed', 'disputed', 'unknown']);

function requiredText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(field + ' is required');
  return value;
}
function safeTime(value, field = 'now_ms') {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(field + ' must be a non-negative safe integer');
  return value;
}
function leaseExpiry(now, ttl) {
  const expiry = now + ttl;
  if (!Number.isSafeInteger(expiry)) throw new RangeError('lease expiry exceeds the safe integer range');
  return expiry;
}
function clone(value) { return structuredClone(value); }
function serializeByKey(queues, key, operation) {
  const previous = queues.get(key) ?? Promise.resolve();
  const result = previous.then(operation);
  const settled = result.then(() => undefined, () => undefined);
  queues.set(key, settled);
  return result.finally(() => { if (queues.get(key) === settled) queues.delete(key); });
}
function putOnce(table, key, value, message) {
  const old = table.get(key);
  if (old !== undefined) {
    if (JSON.stringify(old) !== JSON.stringify(value)) throw new Error(message);
    return clone(old);
  }
  return table.put(key, value).then(() => clone(table.get(key) ?? value));
}
function verifiedEvent(verifier, event, purpose) {
  const verified = verifier(event, purpose);
  if (!verified || verified.verified !== true) throw new Error('unverified DSH event: ' + purpose);
  requiredText(verified.event_id, 'event_id');
  const sourceRef = verified.source_event_ref ?? verified.event_id;
  requiredText(sourceRef, 'source_event_ref');
  if (!['direct_user_event', 'host_event'].includes(verified.source_kind)) {
    throw new TypeError('unsupported Worldline event source');
  }
  const date = new Date(verified.occurred_at);
  if (!Number.isFinite(date.getTime())) throw new TypeError('valid DSH event time is required');
  return { ...verified, occurred_at: date.toISOString(), source_event_ref: sourceRef };
}
function emptySelfModel(eventRef) {
  return {
    schema_version: 1,
    centers: Object.fromEntries(SELF_MODEL_CENTERS.map(center => [center, {
      center_id: center,
      center_version: 0,
      content: {},
      evidence_refs: [],
      uncertainty: ['尚无足够证据建立该中心的状态描述'],
      epistemic_status: 'unknown',
      updated_from_event_ref: eventRef,
    }])),
  };
}
function initialHead(worldlineId, subjectId, eventRef, baseSnapshotRef = null) {
  const state = { self_model: emptySelfModel(eventRef) };
  const snapshot = {
    snapshot_version: 0,
    state_payload: state,
    evidence_refs: [],
    created_at_event_ref: eventRef,
    fencing_token: 0,
  };
  return {
    worldline_id: worldlineId,
    yuanqi_subject_id: subjectId,
    current_snapshot_version: 0,
    current_state_payload: clone(state),
    current_evidence_refs: [],
    snapshot_history: [snapshot],
    base_snapshot_ref: baseSnapshotRef,
    runtime_lease: { holder_id: null, fencing_token: 0, expires_at_ms: 0 },
    updated_from_event_ref: eventRef,
  };
}
function validateSelfModel(state) {
  const selfModel = state?.self_model;
  if (!selfModel || selfModel.schema_version !== 1 || !selfModel.centers || typeof selfModel.centers !== 'object') {
    throw new TypeError('state_payload.self_model v1 is required');
  }
  const keys = Object.keys(selfModel.centers).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...SELF_MODEL_CENTERS].sort())) {
    throw new TypeError('SelfModel must contain exactly the five YuanQi centers');
  }
  for (const center of SELF_MODEL_CENTERS) {
    const item = selfModel.centers[center];
    if (!item || item.center_id !== center || !Number.isSafeInteger(item.center_version) || item.center_version < 0) {
      throw new TypeError('invalid SelfModel center: ' + center);
    }
    if (!item.content || typeof item.content !== 'object' || Array.isArray(item.content)) {
      throw new TypeError('SelfModel center content must be an object: ' + center);
    }
    if (!Array.isArray(item.evidence_refs) || !item.evidence_refs.every(x => typeof x === 'string' && x.length > 0)) {
      throw new TypeError('SelfModel evidence_refs must be strings: ' + center);
    }
    if (!Array.isArray(item.uncertainty) || !item.uncertainty.every(x => typeof x === 'string')) {
      throw new TypeError('SelfModel uncertainty must be strings: ' + center);
    }
    if (!EPISTEMIC_STATES.has(item.epistemic_status)) throw new TypeError('invalid epistemic status: ' + center);
    if (['evidence_supported', 'user_confirmed'].includes(item.epistemic_status) && item.evidence_refs.length === 0) {
      throw new TypeError('evidence references are required for ' + item.epistemic_status + ': ' + center);
    }
    requiredText(item.updated_from_event_ref, 'updated_from_event_ref');
  }
}
function assertLease(head, holderId, fencingToken, now) {
  const lease = head.runtime_lease;
  if (!lease || lease.holder_id !== holderId || lease.fencing_token !== fencingToken || lease.expires_at_ms <= now) {
    throw new Error('runtime lease is absent, expired, or fenced by a newer holder');
  }
}

export const SELF_MODEL_CENTER_IDS = SELF_MODEL_CENTERS;

export function createWorldlineStore({ yuanqiDomain, verifyHostEvent }) {
  if (!yuanqiDomain || typeof verifyHostEvent !== 'function') {
    throw new TypeError('YuanQi domain and trusted host-event verifier are required');
  }
  const identities = yuanqiDomain.table('identities');
  const worldlines = yuanqiDomain.table('worldlines');
  const mainlines = yuanqiDomain.table('worldline_mainlines');
  const snapshots = yuanqiDomain.table('worldline_snapshots');
  const events = yuanqiDomain.table('worldline_events');
  const bindings = yuanqiDomain.table('session_worldline_bindings');
  const heads = yuanqiDomain.table('worldline_heads');
  const queues = new Map();

  function requireSubject(id) {
    requiredText(id, 'yuanqi_subject_id');
    if (!identities.get(id)) throw new Error('YuanQiSubject does not exist');
  }
  function snapshotKey(id, version) { return id + ':' + version; }

  async function ensureHead(line, eventRef) {
    const existing = heads.get(line.worldline_id);
    if (existing) return existing;
    const baseRef = line.parent_worldline_id
      ? { worldline_id: line.parent_worldline_id, snapshot_version: line.base_snapshot_version }
      : null;
    const head = initialHead(line.worldline_id, line.yuanqi_subject_id, eventRef ?? line.created_from_event_ref, baseRef);
    await putOnce(heads, line.worldline_id, head, 'Worldline head initialization conflict');
    return heads.get(line.worldline_id);
  }

  async function recordEvent({ event_id, event_type, subject_id, worldline_id, occurred_at, source_kind, source_event_ref, payload }) {
    const record = {
      event_id, event_type, subject_id, subject_kind: 'yuanqi', worldline_id,
      occurred_at, source_kind, source_event_ref, schema_version: 1, payload,
    };
    return putOnce(events, event_id, record, 'Worldline event conflict');
  }

  async function createMainline({ yuanqi_subject_id, worldline_id, created_from_event }) {
    requiredText(worldline_id, 'worldline_id');
    requireSubject(yuanqi_subject_id);
    const source = verifiedEvent(verifyHostEvent, created_from_event, 'worldline-created');
    return serializeByKey(queues, 'mainline:' + yuanqi_subject_id, async () => {
      const registered = mainlines.get(yuanqi_subject_id);
      if (registered) {
        const existing = worldlines.get(registered.worldline_id);
        if (!existing) throw new Error('mainline registry points to a missing Worldline');
        await ensureHead(existing, existing.created_from_event_ref);
        return clone(existing);
      }
      const existingLine = worldlines.get(worldline_id);
      if (existingLine && (
        existingLine.yuanqi_subject_id !== yuanqi_subject_id ||
        existingLine.parent_worldline_id !== undefined ||
        existingLine.created_from_event_ref !== source.source_event_ref
      )) throw new Error('requested mainline id is already used by another Worldline or creation event');
      const record = existingLine ?? {
        worldline_id, yuanqi_subject_id, status: 'active',
        created_from_event_ref: source.source_event_ref,
      };
      const initial = {
        snapshot_id: snapshotKey(worldline_id, 0), worldline_id, yuanqi_subject_id,
        snapshot_version: 0, state_payload: { self_model: emptySelfModel(source.source_event_ref) },
        evidence_refs: [], created_at_event_ref: source.source_event_ref,
      };
      await putOnce(snapshots, snapshotKey(worldline_id, 0), initial, 'mainline snapshot conflict');
      await putOnce(worldlines, worldline_id, record, 'mainline Worldline conflict');
      await ensureHead(record, source.source_event_ref);
      await recordEvent({
        event_id: 'worldline.created:' + worldline_id, event_type: 'worldline.created',
        subject_id: yuanqi_subject_id, worldline_id, occurred_at: source.occurred_at,
        source_kind: source.source_kind, source_event_ref: source.source_event_ref,
        payload: { parent_worldline_id: null, base_snapshot_version: 0 },
      });
      await putOnce(mainlines, yuanqi_subject_id, {
        yuanqi_subject_id, worldline_id, created_from_event_ref: source.source_event_ref,
      }, 'mainline registry conflict');
      return clone(record);
    });
  }

  async function forkWorldline({ yuanqi_subject_id, parent_worldline_id, target_worldline_id, base_snapshot_version, created_from_event }) {
    requiredText(target_worldline_id, 'target_worldline_id');
    requireSubject(yuanqi_subject_id);
    if (!Number.isSafeInteger(base_snapshot_version) || base_snapshot_version < 0) {
      throw new TypeError('base snapshot version must be a non-negative integer');
    }
    const source = verifiedEvent(verifyHostEvent, created_from_event, 'worldline-forked');
    return serializeByKey(queues, 'worldline:' + target_worldline_id, async () => {
      const parent = worldlines.get(parent_worldline_id);
      if (!parent || parent.yuanqi_subject_id !== yuanqi_subject_id || parent.status !== 'active') {
        throw new Error('active parent Worldline for this YuanQiSubject is required');
      }
      const parentHead = await ensureHead(parent, parent.created_from_event_ref);
      const base = parentHead.snapshot_history.find(item => item.snapshot_version === base_snapshot_version);
      if (!base) throw new Error('parent snapshot does not exist');
      const existing = worldlines.get(target_worldline_id);
      if (existing && (
        existing.yuanqi_subject_id !== yuanqi_subject_id ||
        existing.parent_worldline_id !== parent_worldline_id ||
        existing.base_snapshot_version !== base_snapshot_version ||
        existing.created_from_event_ref !== source.source_event_ref
      )) throw new Error('target Worldline already exists with different lineage or creation event');
      const record = existing ?? {
        worldline_id: target_worldline_id, yuanqi_subject_id, parent_worldline_id,
        base_snapshot_version, status: 'active', created_from_event_ref: source.source_event_ref,
      };
      const local = {
        snapshot_id: snapshotKey(target_worldline_id, 0), worldline_id: target_worldline_id,
        yuanqi_subject_id, snapshot_version: 0,
        state_payload: { self_model: emptySelfModel(source.source_event_ref) },
        evidence_refs: [], created_at_event_ref: source.source_event_ref,
      };
      await putOnce(snapshots, snapshotKey(target_worldline_id, 0), local, 'fork local snapshot conflict');
      await putOnce(worldlines, target_worldline_id, record, 'fork Worldline conflict');
      await ensureHead(record, source.source_event_ref);
      await recordEvent({
        event_id: 'worldline.forked:' + target_worldline_id, event_type: 'worldline.forked',
        subject_id: yuanqi_subject_id, worldline_id: target_worldline_id,
        occurred_at: source.occurred_at, source_kind: source.source_kind,
        source_event_ref: source.source_event_ref,
        payload: { parent_worldline_id, base_snapshot_version },
      });
      return clone(record);
    });
  }

  async function bindSession({ session_id, yuanqi_subject_id, worldline_id, bound_from_event_ref }) {
    requiredText(session_id, 'session_id');
    requiredText(bound_from_event_ref, 'bound_from_event_ref');
    requireSubject(yuanqi_subject_id);
    return serializeByKey(queues, 'session:' + session_id, async () => {
      const line = worldlines.get(worldline_id);
      if (!line || line.yuanqi_subject_id !== yuanqi_subject_id || line.status !== 'active') {
        throw new Error('active Worldline for this YuanQiSubject is required');
      }
      const old = bindings.get(session_id);
      if (old) {
        if (old.yuanqi_subject_id !== yuanqi_subject_id || old.worldline_id !== worldline_id) {
          throw new Error('Session is already bound to a different Worldline');
        }
        return clone(old);
      }
      return putOnce(bindings, session_id, {
        session_id, yuanqi_subject_id, worldline_id, bound_from_event_ref, schema_version: 1,
      }, 'Session Worldline binding conflict');
    });
  }

  // KvTable.update is an atomic read-modify-write on this open DSH Domain's write chain.
  // It provides in-instance serialization; the Storage Domain contract does not claim
  // distributed compare-and-set across separate processes or independently opened facilities.
  async function acquireRuntimeLease({ worldline_id, holder_id, now_ms = Date.now(), ttl_ms = 30000 }) {
    requiredText(holder_id, 'holder_id');
    safeTime(now_ms);
    if (!Number.isSafeInteger(ttl_ms) || ttl_ms < 1000 || ttl_ms > 300000) {
      throw new TypeError('ttl_ms must be between 1000 and 300000');
    }
    const line = worldlines.get(requiredText(worldline_id, 'worldline_id'));
    if (!line || line.status !== 'active') throw new Error('active Worldline is required');
    await ensureHead(line, line.created_from_event_ref);
    let acquired;
    await heads.update(worldline_id, current => {
      const lease = current.runtime_lease;
      if (lease.holder_id && lease.expires_at_ms > now_ms && lease.holder_id !== holder_id) {
        throw new Error('Worldline runtime lease is held by another runtime');
      }
      if (lease.holder_id === holder_id && lease.expires_at_ms > now_ms) {
        acquired = clone(lease);
        return current;
      }
      if (lease.fencing_token >= Number.MAX_SAFE_INTEGER) throw new Error('Worldline fencing token exhausted');
      acquired = { holder_id, fencing_token: lease.fencing_token + 1, expires_at_ms: leaseExpiry(now_ms, ttl_ms) };
      return { ...current, runtime_lease: acquired };
    });
    return clone(acquired);
  }

  async function renewRuntimeLease({ worldline_id, holder_id, fencing_token, now_ms = Date.now(), ttl_ms = 30000 }) {
    requiredText(holder_id, 'holder_id');
    safeTime(now_ms);
    if (!Number.isSafeInteger(ttl_ms) || ttl_ms < 1000 || ttl_ms > 300000) throw new TypeError('invalid ttl_ms');
    let renewed;
    await heads.update(requiredText(worldline_id, 'worldline_id'), current => {
      assertLease(current, holder_id, fencing_token, now_ms);
      renewed = { holder_id, fencing_token, expires_at_ms: now_ms + ttl_ms };
      return { ...current, runtime_lease: renewed };
    });
    return clone(renewed);
  }

  async function releaseRuntimeLease({ worldline_id, holder_id, fencing_token, now_ms = Date.now() }) {
    safeTime(now_ms);
    let released = false;
    await heads.update(requiredText(worldline_id, 'worldline_id'), current => {
      assertLease(current, holder_id, fencing_token, now_ms);
      released = true;
      return { ...current, runtime_lease: { holder_id: null, fencing_token, expires_at_ms: 0 } };
    });
    return released;
  }

  async function commitSnapshot({ worldline_id, holder_id, fencing_token, expected_snapshot_version, state_payload, evidence_refs = [], source_event_ref, now_ms = Date.now() }) {
    requiredText(source_event_ref, 'source_event_ref');
    safeTime(now_ms);
    if (!Number.isSafeInteger(expected_snapshot_version) || expected_snapshot_version < 0) {
      throw new TypeError('expected_snapshot_version must be a non-negative integer');
    }
    if (!Array.isArray(evidence_refs) || !evidence_refs.every(x => typeof x === 'string' && x.length > 0)) {
      throw new TypeError('evidence_refs must be non-empty strings');
    }
    validateSelfModel(state_payload);
    let committed;
    await heads.update(requiredText(worldline_id, 'worldline_id'), current => {
      assertLease(current, holder_id, fencing_token, now_ms);
      if (current.current_snapshot_version !== expected_snapshot_version) {
        throw new Error('snapshot CAS conflict: expected ' + expected_snapshot_version + ', current ' + current.current_snapshot_version);
      }
      const nextVersion = current.current_snapshot_version + 1;
      if (!Number.isSafeInteger(nextVersion)) throw new Error('snapshot version exhausted');
      const snapshot = {
        snapshot_version: nextVersion,
        state_payload: clone(state_payload),
        evidence_refs: [...new Set(evidence_refs)],
        created_at_event_ref: source_event_ref,
        fencing_token,
      };
      committed = clone(snapshot);
      return {
        ...current,
        current_snapshot_version: nextVersion,
        current_state_payload: clone(state_payload),
        current_evidence_refs: snapshot.evidence_refs,
        snapshot_history: [...current.snapshot_history, snapshot],
        updated_from_event_ref: source_event_ref,
      };
    });
    return committed;
  }

  async function updateSelfModelCenter({ worldline_id, holder_id, fencing_token, expected_snapshot_version, center_id, content, evidence_refs = [], uncertainty = [], epistemic_status = 'hypothesis', source_event_ref, now_ms = Date.now() }) {
    if (!SELF_MODEL_CENTERS.includes(center_id)) throw new TypeError('unknown SelfModel center');
    if (!content || typeof content !== 'object' || Array.isArray(content)) throw new TypeError('center content must be an object');
    if (!Array.isArray(evidence_refs) || !evidence_refs.every(x => typeof x === 'string' && x.length > 0)) throw new TypeError('invalid evidence_refs');
    if (!Array.isArray(uncertainty) || !uncertainty.every(x => typeof x === 'string')) throw new TypeError('invalid uncertainty');
    if (!EPISTEMIC_STATES.has(epistemic_status)) throw new TypeError('invalid epistemic_status');
    if (['evidence_supported', 'user_confirmed'].includes(epistemic_status) && evidence_refs.length === 0) {
      throw new TypeError('evidence references are required for this epistemic status');
    }
    requiredText(source_event_ref, 'source_event_ref');
    safeTime(now_ms);
    let result;
    await heads.update(requiredText(worldline_id, 'worldline_id'), current => {
      assertLease(current, holder_id, fencing_token, now_ms);
      if (current.current_snapshot_version !== expected_snapshot_version) {
        throw new Error('snapshot CAS conflict: expected ' + expected_snapshot_version + ', current ' + current.current_snapshot_version);
      }
      const state = clone(current.current_state_payload);
      const oldCenter = state.self_model.centers[center_id];
      state.self_model.centers[center_id] = {
        center_id,
        center_version: oldCenter.center_version + 1,
        content: clone(content),
        evidence_refs: [...new Set(evidence_refs)],
        uncertainty: [...uncertainty],
        epistemic_status,
        updated_from_event_ref: source_event_ref,
      };
      const nextVersion = current.current_snapshot_version + 1;
      const snapshot = {
        snapshot_version: nextVersion, state_payload: state,
        evidence_refs: [...new Set(evidence_refs)], created_at_event_ref: source_event_ref,
        fencing_token,
      };
      result = { center: clone(state.self_model.centers[center_id]), snapshot: clone(snapshot) };
      return {
        ...current, current_snapshot_version: nextVersion,
        current_state_payload: state, current_evidence_refs: snapshot.evidence_refs,
        snapshot_history: [...current.snapshot_history, snapshot],
        updated_from_event_ref: source_event_ref,
      };
    });
    return result;
  }

  function getHead(worldline_id) {
    requiredText(worldline_id, 'worldline_id');
    const value = heads.get(worldline_id);
    return value === undefined ? undefined : clone(value);
  }
  function getSnapshot(worldline_id, version) {
    requiredText(worldline_id, 'worldline_id');
    if (!Number.isSafeInteger(version) || version < 0) throw new TypeError('snapshot version must be non-negative');
    const head = heads.get(worldline_id);
    const value = head?.snapshot_history.find(item => item.snapshot_version === version);
    if (value) return clone(value);
    const legacy = snapshots.get(snapshotKey(worldline_id, version));
    return legacy === undefined ? undefined : clone(legacy);
  }
  function getEffectiveSnapshot(worldline_id) {
    requiredText(worldline_id, 'worldline_id');
    const line = worldlines.get(worldline_id);
    if (!line) return undefined;
    const head = heads.get(worldline_id);
    if (!head) throw new Error('Worldline head is missing');
    const base = line.parent_worldline_id
      ? getSnapshot(line.parent_worldline_id, line.base_snapshot_version)
      : undefined;
    if (line.parent_worldline_id && !base) throw new Error('Worldline base snapshot reference is unavailable');
    return {
      worldline: clone(line),
      base_snapshot: base === undefined ? null : base,
      local_snapshot: {
        snapshot_version: head.current_snapshot_version,
        state_payload: clone(head.current_state_payload),
        evidence_refs: clone(head.current_evidence_refs),
      },
    };
  }

  return Object.freeze({
    createMainline, forkWorldline, bindSession,
    acquireRuntimeLease, renewRuntimeLease, releaseRuntimeLease,
    commitSnapshot, updateSelfModelCenter,
    getHead, getSnapshot, getWorldline(id) {
      requiredText(id, 'worldline_id');
      const value = worldlines.get(id);
      return value === undefined ? undefined : clone(value);
    },
    getSessionBinding(id) {
      requiredText(id, 'session_id');
      const value = bindings.get(id);
      return value === undefined ? undefined : clone(value);
    },
    getEffectiveSnapshot,
    getSelfModel(worldline_id) {
      const head = getHead(worldline_id);
      return head ? clone(head.current_state_payload.self_model) : undefined;
    },
  });
}
