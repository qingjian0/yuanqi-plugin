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
function serializeByKeys(queues, keys, operation) {
  const ordered = [...new Set(keys)].sort();
  const nested = ordered.reduceRight(
    (next, key) => () => serializeByKey(queues, 'evidence-state:' + key, next),
    operation,
  );
  return nested();
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
    snapshot_archive_checkpoint: null,
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
    if (item.epistemic_status === 'user_confirmed') requiredText(item.confirmation_event_ref, 'confirmation_event_ref');
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
  const snapshotArchiveEntries = yuanqiDomain.table('worldline_snapshot_archive_entries');
  const snapshotArchiveManifests = yuanqiDomain.table('worldline_snapshot_archive_manifests');
  const events = yuanqiDomain.table('worldline_events');
  const bindings = yuanqiDomain.table('session_worldline_bindings');
  const heads = yuanqiDomain.table('worldline_heads');
  const evidenceRecords = yuanqiDomain.table('evidence_records');
  const evidenceRevocations = yuanqiDomain.table('evidence_revocations');
  const evidenceAssessments = yuanqiDomain.table('evidence_assessments');
  const transferAuthorizations = yuanqiDomain.table('transfer_authorizations');
  const transferAuthorizationRevocations = yuanqiDomain.table('transfer_authorization_revocations');
  const evidenceTransfers = yuanqiDomain.table('evidence_transfers');
  const queues = new Map();

  function requireSubject(id) {
    requiredText(id, 'yuanqi_subject_id');
    if (!identities.get(id)) throw new Error('YuanQiSubject does not exist');
  }
  function snapshotKey(id, version) { return id + ':' + version; }
  function archiveId(id, from, through) { return 'archive:' + id + ':' + from + ':' + through; }

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
      await ensureHead(parent, parent.created_from_event_ref);
      const base = getSnapshot(parent_worldline_id, base_snapshot_version);
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

  // Evidence records are immutable provenance objects. Revocation is a separate append-only row.
  async function recordEvidence({ evidence_id, yuanqi_subject_id, worldline_id, evidence_type, content, provenance = {}, captured_from_event }) {
    requiredText(evidence_id, 'evidence_id');
    requiredText(evidence_type, 'evidence_type');
    if (!content || typeof content !== 'object' || Array.isArray(content)) throw new TypeError('evidence content must be an object');
    if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) throw new TypeError('evidence provenance must be an object');
    requireSubject(yuanqi_subject_id);
    const source = verifiedEvent(verifyHostEvent, captured_from_event, 'evidence-recorded');
    const line = worldlines.get(requiredText(worldline_id, 'worldline_id'));
    if (!line || line.yuanqi_subject_id !== yuanqi_subject_id || line.status !== 'active') {
      throw new Error('active Worldline for this YuanQiSubject is required');
    }
    const record = {
      evidence_id, yuanqi_subject_id, worldline_id, evidence_type,
      content: clone(content), provenance: clone(provenance),
      source_kind: source.source_kind, source_event_ref: source.source_event_ref,
      captured_at: source.occurred_at, schema_version: 1,
    };
    return serializeByKey(queues, 'evidence:' + evidence_id, () =>
      putOnce(evidenceRecords, evidence_id, record, 'evidence id is already bound to different immutable provenance'));
  }

  async function revokeEvidence({ evidence_id, worldline_id, reason, revoked_from_event }) {
    requiredText(evidence_id, 'evidence_id');
    requiredText(reason, 'reason');
    const source = verifiedEvent(verifyHostEvent, revoked_from_event, 'evidence-revoked');
    if (source.source_kind !== 'direct_user_event') throw new Error('evidence revocation requires a verified direct user event');
    const record = evidenceRecords.get(evidence_id);
    if (!record || record.worldline_id !== requiredText(worldline_id, 'worldline_id')) {
      throw new Error('evidence does not exist in the requested Worldline scope');
    }
    const revocation = {
      evidence_id, worldline_id, reason,
      revoked_from_event_ref: source.source_event_ref,
      revoked_at: source.occurred_at, schema_version: 1,
    };
    return serializeByKey(queues, 'evidence-state:' + evidence_id, () =>
      putOnce(evidenceRevocations, evidence_id, revocation, 'evidence already has a different revocation record'));
  }

  function getEvidenceRecord({ evidence_id, worldline_id }, visited = new Set()) {
    requiredText(evidence_id, 'evidence_id');
    const scope = requiredText(worldline_id, 'worldline_id');
    const record = evidenceRecords.get(evidence_id);
    if (!record || record.worldline_id !== scope) return undefined;
    const lineageKey = scope + ':' + evidence_id;
    if (visited.has(lineageKey)) {
      return {
        record: clone(record),
        revocation: { inherited: true, reason: 'cyclic transferred evidence lineage' },
        status: 'invalid_lineage',
      };
    }
    visited.add(lineageKey);
    const revocation = evidenceRevocations.get(evidence_id);
    if (revocation) return { record: clone(record), revocation: clone(revocation), status: 'revoked' };
    if (record.transferred_from) {
      const origin = getEvidenceRecord({
        evidence_id: record.transferred_from.evidence_id,
        worldline_id: record.transferred_from.worldline_id,
      }, visited);
      if (!origin || origin.status !== 'active') {
        return {
          record: clone(record),
          revocation: { inherited: true, reason: origin?.status === 'invalid_lineage' ? 'origin evidence lineage is cyclic or invalid' : 'origin evidence is unavailable or revoked' },
          status: origin?.status === 'invalid_lineage' ? 'invalid_lineage' : 'revoked',
        };
      }
    }
    return { record: clone(record), revocation: null, status: 'active' };
  }

  function assertEvidenceRefsActive(worldlineId, refs) {
    for (const id of new Set(refs)) {
      const evidence = getEvidenceRecord({ evidence_id: id, worldline_id: worldlineId });
      if (!evidence) throw new Error('evidence reference is missing or outside Worldline scope: ' + id);
      if (evidence.status !== 'active') throw new Error('evidence reference is revoked: ' + id);
    }
  }

  async function assessEvidence({ assessment_id, evidence_id, worldline_id, outcome, assessor_kind, rationale, confidence = null, corroborating_evidence_refs = [], assessed_from_event }) {
    requiredText(assessment_id, 'assessment_id');
    requiredText(rationale, 'rationale');
    if (!['corroborated', 'contradicted', 'insufficient'].includes(outcome)) throw new TypeError('invalid evidence assessment outcome');
    if (!['user', 'model', 'system'].includes(assessor_kind)) throw new TypeError('invalid assessor_kind');
    if (confidence !== null && (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1)) {
      throw new TypeError('confidence must be null or a number from 0 to 1');
    }
    if (!Array.isArray(corroborating_evidence_refs) || !corroborating_evidence_refs.every(x => typeof x === 'string' && x.length > 0)) {
      throw new TypeError('corroborating_evidence_refs must be non-empty strings');
    }
    const source = verifiedEvent(verifyHostEvent, assessed_from_event, 'evidence-assessed');
    if (assessor_kind === 'user' && source.source_kind !== 'direct_user_event') {
      throw new Error('user assessment requires a verified direct user event');
    }
    const evidence = getEvidenceRecord({ evidence_id, worldline_id });
    if (!evidence || evidence.status !== 'active') throw new Error('active evidence in the requested Worldline is required');
    assertEvidenceRefsActive(worldline_id, corroborating_evidence_refs);
    const assessment = {
      assessment_id, evidence_id, worldline_id, outcome, assessor_kind, rationale,
      confidence, corroborating_evidence_refs: [...new Set(corroborating_evidence_refs)],
      assessed_from_event_ref: source.source_event_ref, assessed_at: source.occurred_at,
      schema_version: 1,
    };
    return serializeByKey(queues, 'assessment:' + assessment_id, () =>
      putOnce(evidenceAssessments, assessment_id, assessment, 'assessment id is already bound to different immutable content'));
  }

  function getEvidenceAssessment({ assessment_id, worldline_id }) {
    requiredText(assessment_id, 'assessment_id');
    const item = evidenceAssessments.get(assessment_id);
    if (!item || item.worldline_id !== requiredText(worldline_id, 'worldline_id')) return undefined;
    const evidence = getEvidenceRecord({ evidence_id: item.evidence_id, worldline_id });
    const refsActive = item.corroborating_evidence_refs.every(id => getEvidenceRecord({ evidence_id: id, worldline_id })?.status === 'active');
    return { assessment: clone(item), status: evidence?.status === 'active' && refsActive ? 'active' : 'stale' };
  }

  async function authorizeEvidenceTransfer({ authorization_id, yuanqi_subject_id, source_worldline_id, target_worldline_id, evidence_ids, expires_at_ms, authorized_from_event, now_ms = Date.now() }) {
    requiredText(authorization_id, 'authorization_id');
    safeTime(now_ms);
    if (!Array.isArray(evidence_ids) || evidence_ids.length === 0 || !evidence_ids.every(x => typeof x === 'string' && x.length > 0)) {
      throw new TypeError('explicit evidence_ids are required');
    }
    if (new Set(evidence_ids).size !== evidence_ids.length) throw new TypeError('evidence_ids must be unique');
    if (!Number.isSafeInteger(expires_at_ms) || expires_at_ms <= now_ms || expires_at_ms - now_ms > 30 * 24 * 60 * 60 * 1000) {
      throw new TypeError('transfer authorization expiry must be within 30 days');
    }
    requireSubject(yuanqi_subject_id);
    const sourceLine = worldlines.get(requiredText(source_worldline_id, 'source_worldline_id'));
    const targetLine = worldlines.get(requiredText(target_worldline_id, 'target_worldline_id'));
    if (!sourceLine || !targetLine || sourceLine.status !== 'active' || targetLine.status !== 'active' ||
        sourceLine.yuanqi_subject_id !== yuanqi_subject_id || targetLine.yuanqi_subject_id !== yuanqi_subject_id ||
        source_worldline_id === target_worldline_id) {
      throw new Error('active source and distinct target Worldlines for the same YuanQiSubject are required');
    }
    assertEvidenceRefsActive(source_worldline_id, evidence_ids);
    const source = verifiedEvent(verifyHostEvent, authorized_from_event, 'evidence-transfer-authorized');
    if (source.source_kind !== 'direct_user_event') throw new Error('transfer authorization requires a verified direct user event');
    const authorization = {
      authorization_id, yuanqi_subject_id, source_worldline_id, target_worldline_id,
      evidence_ids: [...evidence_ids], authorized_from_event_ref: source.source_event_ref,
      authorized_at: source.occurred_at, expires_at_ms, schema_version: 1,
    };
    return serializeByKey(queues, 'transfer-auth:' + authorization_id, () =>
      putOnce(transferAuthorizations, authorization_id, authorization, 'authorization id is already bound to different scope'));
  }

  async function revokeTransferAuthorization({ authorization_id, reason, revoked_from_event }) {
    requiredText(authorization_id, 'authorization_id');
    requiredText(reason, 'reason');
    const source = verifiedEvent(verifyHostEvent, revoked_from_event, 'evidence-transfer-authorization-revoked');
    if (source.source_kind !== 'direct_user_event') throw new Error('authorization revocation requires a verified direct user event');
    if (!transferAuthorizations.get(authorization_id)) throw new Error('transfer authorization does not exist');
    const revocation = {
      authorization_id, reason, revoked_from_event_ref: source.source_event_ref,
      revoked_at: source.occurred_at, schema_version: 1,
    };
    return serializeByKey(queues, 'transfer-auth-state:' + authorization_id, () =>
      putOnce(transferAuthorizationRevocations, authorization_id, revocation, 'authorization already has a different revocation'));
  }

  async function transferEvidence({ authorization_id, evidence_id, transferred_from_event, now_ms = Date.now() }) {
    safeTime(now_ms);
    const authorization = transferAuthorizations.get(requiredText(authorization_id, 'authorization_id'));
    if (!authorization || !authorization.evidence_ids.includes(requiredText(evidence_id, 'evidence_id'))) {
      throw new Error('evidence is outside the explicit transfer authorization scope');
    }
    if (transferAuthorizationRevocations.get(authorization_id)) throw new Error('transfer authorization has been revoked');
    if (now_ms >= authorization.expires_at_ms) throw new Error('transfer authorization has expired');
    const source = verifiedEvent(verifyHostEvent, transferred_from_event, 'evidence-transferred');
    if (source.source_kind !== 'direct_user_event') throw new Error('evidence transfer requires a verified direct user event');
    const original = getEvidenceRecord({ evidence_id, worldline_id: authorization.source_worldline_id });
    if (!original || original.status !== 'active') throw new Error('source evidence is unavailable or revoked');
    const transferId = 'transfer:' + authorization_id + ':' + evidence_id;
    const targetEvidenceId = 'transferred:' + authorization_id + ':' + evidence_id;
    return serializeByKey(queues, 'transfer-auth-state:' + authorization_id, () =>
      serializeByKey(queues, 'evidence-state:' + evidence_id, async () => {
      const currentAuthorization = transferAuthorizations.get(authorization_id);
      if (!currentAuthorization || transferAuthorizationRevocations.get(authorization_id) || now_ms >= currentAuthorization.expires_at_ms) {
        throw new Error('transfer authorization is revoked or expired');
      }
      const currentSource = getEvidenceRecord({ evidence_id, worldline_id: currentAuthorization.source_worldline_id });
      if (!currentSource || currentSource.status !== 'active') throw new Error('source evidence is unavailable or revoked');
      const old = evidenceTransfers.get(transferId);
      if (old) return clone(old);
      const transferredRecord = {
        ...clone(original.record),
        evidence_id: targetEvidenceId,
        worldline_id: authorization.target_worldline_id,
        provenance: {
          ...clone(original.record.provenance),
          transfer_authorization_id: authorization_id,
          transferred_from_worldline_id: authorization.source_worldline_id,
        },
        transferred_from: {
          evidence_id, worldline_id: authorization.source_worldline_id,
          authorization_id,
        },
      };
      await putOnce(evidenceRecords, targetEvidenceId, transferredRecord, 'target evidence ID conflicts with existing evidence');
      const audit = {
        transfer_id: transferId, authorization_id, source_evidence_id: evidence_id,
        target_evidence_id: targetEvidenceId, source_worldline_id: authorization.source_worldline_id,
        target_worldline_id: authorization.target_worldline_id,
        transferred_from_event_ref: source.source_event_ref, transferred_at: source.occurred_at,
        schema_version: 1,
      };
      await putOnce(evidenceTransfers, transferId, audit, 'evidence transfer audit conflict');
      return clone(audit);
    }));
  }

  function getEvidenceTransfer({ transfer_id }) {
    requiredText(transfer_id, 'transfer_id');
    const value = evidenceTransfers.get(transfer_id);
    return value === undefined ? undefined : clone(value);
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
      renewed = { holder_id, fencing_token, expires_at_ms: leaseExpiry(now_ms, ttl_ms) };
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
    const allRefs = [...evidence_refs, ...SELF_MODEL_CENTERS.flatMap(center => state_payload.self_model.centers[center].evidence_refs)];
    assertEvidenceRefsActive(worldline_id, allRefs);
    let committed;
    await serializeByKeys(queues, allRefs, async () => {
      assertEvidenceRefsActive(worldline_id, allRefs);
      await heads.update(requiredText(worldline_id, 'worldline_id'), current => {
        assertLease(current, holder_id, fencing_token, now_ms);
        for (const center of SELF_MODEL_CENTERS) {
          const nextCenter = state_payload.self_model.centers[center];
          const currentCenter = current.current_state_payload.self_model.centers[center];
          if (nextCenter.epistemic_status === 'user_confirmed' && JSON.stringify(nextCenter) !== JSON.stringify(currentCenter)) {
            throw new Error('user_confirmed SelfModel state must be changed through the direct-user confirmation path');
          }
        }
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
    });
    return committed;
  }


  async function compactSnapshotHistory({
    worldline_id, holder_id, fencing_token, expected_snapshot_version,
    through_version, source_event_ref, now_ms = Date.now(),
  }) {
    requiredText(source_event_ref, 'source_event_ref');
    safeTime(now_ms);
    if (!Number.isSafeInteger(expected_snapshot_version) || expected_snapshot_version < 0 ||
        !Number.isSafeInteger(through_version) || through_version < 0) {
      throw new TypeError('snapshot versions must be non-negative safe integers');
    }
    return serializeByKey(queues, 'snapshot-archive:' + requiredText(worldline_id, 'worldline_id'), async () => {
      const observed = heads.get(worldline_id);
      if (!observed) throw new Error('Worldline head is missing');
      const checkpoint = observed.snapshot_archive_checkpoint?.through_version ?? -1;
      if (through_version <= checkpoint) {
        const existing = snapshotArchiveManifests.get(observed.snapshot_archive_checkpoint.archive_id);
        if (!existing || existing.through_version !== checkpoint) throw new Error('existing snapshot archive checkpoint is inconsistent');
        return { archive_id: existing.archive_id, from_version: existing.from_version, through_version: existing.through_version, snapshot_count: existing.snapshot_count, compacted: false };
      }
      if (observed.current_snapshot_version !== expected_snapshot_version) {
        throw new Error('snapshot archive CAS conflict: expected ' + expected_snapshot_version + ', current ' + observed.current_snapshot_version);
      }
      if (through_version >= observed.current_snapshot_version) {
        throw new Error('snapshot archive must retain the current snapshot');
      }
      const from_version = checkpoint + 1;
      const archive_id = archiveId(worldline_id, from_version, through_version);
      const line = worldlines.get(worldline_id);
      if (!line) throw new Error('Worldline does not exist');
      const historyByVersion = new Map(observed.snapshot_history.map(item => [item.snapshot_version, item]));
      const selected = [];
      for (let version = from_version; version <= through_version; version += 1) {
        const snapshot = historyByVersion.get(version);
        if (!snapshot) throw new Error('snapshot archive range is incomplete at version ' + version);
        selected.push(snapshot);
      }
      const manifest = {
        archive_id, worldline_id, yuanqi_subject_id: line.yuanqi_subject_id,
        from_version, through_version, snapshot_count: selected.length,
        previous_archive_id: observed.snapshot_archive_checkpoint?.archive_id ?? null,
        created_from_event_ref: source_event_ref, schema_version: 1,
      };
      const existingManifest = snapshotArchiveManifests.get(archive_id);
      if (existingManifest && (
        existingManifest.worldline_id !== manifest.worldline_id ||
        existingManifest.yuanqi_subject_id !== manifest.yuanqi_subject_id ||
        existingManifest.from_version !== manifest.from_version ||
        existingManifest.through_version !== manifest.through_version ||
        existingManifest.snapshot_count !== manifest.snapshot_count ||
        existingManifest.previous_archive_id !== manifest.previous_archive_id
      )) {
        throw new Error('snapshot archive manifest conflicts with an existing archive');
      }
      for (const snapshot of selected) {
        const entry = { archive_id, worldline_id, yuanqi_subject_id: line.yuanqi_subject_id, snapshot: clone(snapshot) };
        await putOnce(snapshotArchiveEntries, snapshotKey(worldline_id, snapshot.snapshot_version), entry, 'snapshot archive entry conflict');
      }
      if (!existingManifest) await putOnce(snapshotArchiveManifests, archive_id, manifest, 'snapshot archive manifest conflict');
      let compacted = false;
      await heads.update(worldline_id, current => {
        assertLease(current, holder_id, fencing_token, now_ms);
        if (current.current_snapshot_version !== expected_snapshot_version) {
          throw new Error('snapshot archive CAS conflict: expected ' + expected_snapshot_version + ', current ' + current.current_snapshot_version);
        }
        if ((current.snapshot_archive_checkpoint?.through_version ?? -1) !== checkpoint) {
          throw new Error('snapshot archive checkpoint changed during compaction');
        }
        const prefix = current.snapshot_history.filter(item => item.snapshot_version <= through_version);
        if (prefix.length !== selected.length || prefix.some((item, index) => JSON.stringify(item) !== JSON.stringify(selected[index]))) {
          throw new Error('snapshot history changed while archive was being prepared');
        }
        const retained = current.snapshot_history.filter(item => item.snapshot_version > through_version);
        if (retained.length === 0 || retained[0].snapshot_version !== through_version + 1) {
          throw new Error('snapshot archive would leave no valid active history');
        }
        compacted = true;
        return {
          ...current,
          snapshot_history: retained,
          snapshot_archive_checkpoint: { archive_id, through_version },
          updated_from_event_ref: source_event_ref,
        };
      });
      return { archive_id, from_version, through_version, snapshot_count: selected.length, compacted };
    });
  }

  async function updateSelfModelCenter({ worldline_id, holder_id, fencing_token, expected_snapshot_version, center_id, content, evidence_refs = [], uncertainty = [], epistemic_status = 'hypothesis', source_event_ref, confirmation_event, now_ms = Date.now() }) {
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
    let confirmationEventRef;
    if (epistemic_status === 'user_confirmed') {
      const confirmation = verifiedEvent(verifyHostEvent, confirmation_event, 'self-model-user-confirmed');
      if (confirmation.source_kind !== 'direct_user_event') throw new Error('user_confirmed SelfModel state requires a verified direct user event');
      confirmationEventRef = confirmation.source_event_ref;
    }
    assertEvidenceRefsActive(worldline_id, evidence_refs);
    let result;
    const observed = getHead(worldline_id);
    const observedRefs = observed ? SELF_MODEL_CENTERS.flatMap(id => observed.current_state_payload.self_model.centers[id].evidence_refs) : [];
    await serializeByKeys(queues, [...observedRefs, ...evidence_refs], async () => {
      await heads.update(requiredText(worldline_id, 'worldline_id'), current => {
        assertLease(current, holder_id, fencing_token, now_ms);
        const retainedRefs = SELF_MODEL_CENTERS.filter(id => id !== center_id).flatMap(id => current.current_state_payload.self_model.centers[id].evidence_refs);
        assertEvidenceRefsActive(worldline_id, [...retainedRefs, ...evidence_refs]);
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
          ...(epistemic_status === 'user_confirmed' ? { confirmation_event_ref: confirmationEventRef } : {}),
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
    const archived = snapshotArchiveEntries.get(snapshotKey(worldline_id, version));
    if (archived) {
      const manifest = snapshotArchiveManifests.get(archived.archive_id);
      if (!manifest || manifest.archive_id !== archived.archive_id ||
          manifest.worldline_id !== worldline_id ||
          manifest.yuanqi_subject_id !== archived.yuanqi_subject_id ||
          version < manifest.from_version || version > manifest.through_version ||
          archived.worldline_id !== worldline_id ||
          archived.snapshot?.snapshot_version !== version) {
        throw new Error('archived snapshot entry has no valid matching manifest');
      }
      return clone(archived.snapshot);
    }
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


  // Read-only integrity diagnostics. Recovery never guesses or mutates persisted state.
  function auditWorldline({ worldline_id, now_ms = Date.now() }) {
    requiredText(worldline_id, 'worldline_id');
    safeTime(now_ms);
    const issues = [];
    const add = (code, severity, detail, repair = 'manual_review') => issues.push({ code, severity, detail, repair });
    const line = worldlines.get(worldline_id);
    if (!line) {
      add('worldline.missing', 'critical', 'Worldline record is missing');
      return { worldline_id, checked_at_ms: now_ms, status: 'critical', issues, repair_policy: 'manual_only' };
    }
    const subject = identities.get(line.yuanqi_subject_id);
    if (!subject || subject.subject_kind !== 'yuanqi') {
      add('subject.missing_or_invalid', 'critical', 'Worldline does not resolve to a YuanQiSubject identity');
    }
    if (line.status !== 'active' && line.status !== 'archived' && line.status !== 'suspended') {
      add('worldline.invalid_status', 'critical', 'Worldline status is not recognized');
    }
    if (line.parent_worldline_id) {
      const parent = worldlines.get(line.parent_worldline_id);
      if (!parent || parent.yuanqi_subject_id !== line.yuanqi_subject_id) {
        add('worldline.parent_missing_or_cross_subject', 'critical', 'Parent Worldline is missing or belongs to another YuanQiSubject');
      } else {
        const base = getSnapshot(line.parent_worldline_id, line.base_snapshot_version);
        if (!base) add('worldline.base_snapshot_missing', 'critical', 'Fork base snapshot reference cannot be resolved');
      }
    } else {
      const registered = mainlines.get(line.yuanqi_subject_id);
      if (!registered || registered.worldline_id !== worldline_id) {
        add('worldline.mainline_registry_mismatch', 'critical', 'Mainline registry does not point back to this Worldline');
      }
    }

    const head = heads.get(worldline_id);
    if (!head) {
      add('worldline.head_missing', 'critical', 'Worldline Head is missing; no automatic head reconstruction is attempted');
      return {
        worldline_id, yuanqi_subject_id: line.yuanqi_subject_id, checked_at_ms: now_ms,
        status: 'critical', issues, repair_policy: 'manual_only',
      };
    }
    if (head.worldline_id !== worldline_id || head.yuanqi_subject_id !== line.yuanqi_subject_id) {
      add('worldline.head_identity_mismatch', 'critical', 'Head identity does not match the Worldline record');
    }
    if (!Array.isArray(head.snapshot_history) || head.snapshot_history.length === 0) {
      add('snapshot.history_missing', 'critical', 'Snapshot history is absent or empty');
    } else {
      const history = head.snapshot_history;
      const checkpoint = head.snapshot_archive_checkpoint ?? null;
      const auditHistory = [];
      if (checkpoint) {
        const manifests = [];
        const seenArchives = new Set();
        let cursor = checkpoint.archive_id;
        let expectedThrough = checkpoint.through_version;
        while (cursor) {
          if (seenArchives.has(cursor)) {
            add('snapshot.archive_manifest_cycle', 'critical', 'Snapshot archive manifest chain contains a cycle');
            break;
          }
          seenArchives.add(cursor);
          const manifest = snapshotArchiveManifests.get(cursor);
          if (!manifest || manifest.worldline_id !== worldline_id ||
              manifest.yuanqi_subject_id !== line.yuanqi_subject_id ||
              manifest.through_version !== expectedThrough ||
              manifest.snapshot_count !== manifest.through_version - manifest.from_version + 1) {
            add('snapshot.archive_manifest_invalid', 'critical', 'Snapshot archive manifest is missing or inconsistent');
            break;
          }
          manifests.push(manifest);
          expectedThrough = manifest.from_version - 1;
          cursor = manifest.previous_archive_id;
        }
        if (manifests.length && manifests[manifests.length - 1].from_version !== 0) {
          add('snapshot.archive_chain_incomplete', 'critical', 'Snapshot archive chain does not reach version 0');
        }
        const manifestByVersion = new Map();
        for (const manifest of manifests) {
          for (let version = manifest.from_version; version <= manifest.through_version; version += 1) {
            manifestByVersion.set(version, manifest);
          }
        }
        for (let version = 0; version <= checkpoint.through_version; version += 1) {
          const manifest = manifestByVersion.get(version);
          const entry = snapshotArchiveEntries.get(snapshotKey(worldline_id, version));
          if (!manifest || !entry || entry.archive_id !== manifest.archive_id ||
              entry.worldline_id !== worldline_id || entry.yuanqi_subject_id !== line.yuanqi_subject_id ||
              entry.snapshot?.snapshot_version !== version) {
            add('snapshot.archive_entry_missing_or_invalid', 'critical', 'Archived snapshot entry is missing or invalid at version ' + version);
            auditHistory.push(null);
          } else {
            auditHistory.push(entry.snapshot);
          }
        }
      }
      auditHistory.push(...history);
      for (let index = 0; index < auditHistory.length; index += 1) {
        const snapshot = auditHistory[index];
        if (!snapshot || snapshot.snapshot_version !== index) {
          add('snapshot.history_gap_or_reorder', 'critical', 'Archived and active snapshot history must be contiguous from version 0; mismatch at version ' + index);
          continue;
        }
        if (!Number.isSafeInteger(snapshot.fencing_token) || snapshot.fencing_token < 0) {
          add('snapshot.invalid_fencing_token', 'critical', 'Snapshot ' + index + ' has an invalid fencing token');
        }
        try {
          validateSelfModel(snapshot.state_payload);
        } catch (error) {
          add('snapshot.invalid_self_model', 'critical', 'Snapshot ' + index + ': ' + error.message);
        }
        const refs = [
          ...(Array.isArray(snapshot.evidence_refs) ? snapshot.evidence_refs : []),
          ...SELF_MODEL_CENTERS.flatMap(center => snapshot.state_payload?.self_model?.centers?.[center]?.evidence_refs ?? []),
        ];
        for (const evidenceId of new Set(refs)) {
          const evidence = getEvidenceRecord({ evidence_id: evidenceId, worldline_id });
          if (!evidence) {
            add('evidence.reference_missing_or_out_of_scope', 'critical', 'Snapshot ' + index + ' references unavailable or cross-Worldline evidence: ' + evidenceId);
          } else if (evidence.status === 'invalid_lineage') {
            add('evidence.transfer_lineage_invalid', 'critical', 'Snapshot ' + index + ' references cyclic or invalid transferred evidence: ' + evidenceId);
          } else if (evidence.status !== 'active') {
            add('evidence.reference_revoked', 'warning', 'Snapshot ' + index + ' references revoked evidence: ' + evidenceId, 'preserve_history_and_review');
          }
          const record = evidence?.record;
          if (record?.transferred_from) {
            const origin = record.transferred_from;
            const auth = transferAuthorizations.get(origin.authorization_id);
            const transferId = 'transfer:' + origin.authorization_id + ':' + origin.evidence_id;
            const audit = evidenceTransfers.get(transferId);
            if (
              origin.worldline_id !== (auth?.source_worldline_id ?? null) ||
              worldline_id !== (auth?.target_worldline_id ?? null) ||
              !auth?.evidence_ids?.includes(origin.evidence_id) ||
              !audit || audit.target_evidence_id !== evidenceId ||
              audit.source_evidence_id !== origin.evidence_id ||
              audit.source_worldline_id !== origin.worldline_id ||
              audit.target_worldline_id !== worldline_id
            ) {
              add('transfer.lineage_inconsistent', 'critical', 'Transferred evidence lineage or audit does not match: ' + evidenceId);
            }
          }
        }
      }
      const latest = history[history.length - 1];
      if (head.current_snapshot_version !== latest.snapshot_version) {
        add('snapshot.head_version_mismatch', 'critical', 'Current snapshot version does not match the final history entry');
      }
      if (JSON.stringify(head.current_state_payload) !== JSON.stringify(latest.state_payload)) {
        add('snapshot.head_payload_mismatch', 'critical', 'Current state payload differs from the final history entry');
      }
      if (JSON.stringify(head.current_evidence_refs) !== JSON.stringify(latest.evidence_refs)) {
        add('snapshot.head_evidence_refs_mismatch', 'critical', 'Current evidence references differ from the final history entry');
      }
    }
    if (!head.runtime_lease || !Number.isSafeInteger(head.runtime_lease.fencing_token) ||
        head.runtime_lease.fencing_token < 0 || !Number.isSafeInteger(head.runtime_lease.expires_at_ms) ||
        head.runtime_lease.expires_at_ms < 0 ||
        !(head.runtime_lease.holder_id === null || (typeof head.runtime_lease.holder_id === 'string' && head.runtime_lease.holder_id.length > 0))) {
      add('lease.metadata_invalid', 'critical', 'Runtime Lease metadata is malformed');
    } else {
      if (head.snapshot_history?.length) {
        const maxSnapshotFence = head.snapshot_history.reduce((maximum, item) => Math.max(maximum, Number.isSafeInteger(item?.fencing_token) ? item.fencing_token : 0), 0);
        if (head.runtime_lease.fencing_token < maxSnapshotFence) {
          add('lease.fencing_regressed', 'critical', 'Head fencing token is lower than a committed snapshot token');
        }
      }
      if (head.runtime_lease.holder_id && head.runtime_lease.expires_at_ms <= now_ms) {
        add('lease.expired_holder', 'warning', 'Runtime Lease holder remains recorded after expiry', 'allow_normal_lease_takeover');
      }
      if (!head.runtime_lease.holder_id && head.runtime_lease.expires_at_ms !== 0) {
        add('lease.released_expiry_nonzero', 'warning', 'Released Runtime Lease has a non-zero expiry');
      }
    }
    if (head.base_snapshot_ref) {
      if (head.base_snapshot_ref.worldline_id !== line.parent_worldline_id ||
          head.base_snapshot_ref.snapshot_version !== line.base_snapshot_version) {
        add('worldline.head_base_reference_mismatch', 'critical', 'Head base snapshot reference differs from Worldline lineage');
      }
    } else if (line.parent_worldline_id) {
      add('worldline.head_base_reference_missing', 'critical', 'Fork Head has no parent snapshot reference');
    }
    const critical = issues.some(item => item.severity === 'critical');
    const warning = issues.some(item => item.severity === 'warning');
    return {
      worldline_id, yuanqi_subject_id: line.yuanqi_subject_id, checked_at_ms: now_ms,
      status: critical ? 'critical' : warning ? 'degraded' : 'healthy',
      issue_count: issues.length, issues, repair_policy: 'manual_only',
    };
  }

  return Object.freeze({
    createMainline, forkWorldline, bindSession,
    recordEvidence, revokeEvidence, getEvidenceRecord,
    assessEvidence, getEvidenceAssessment,
    authorizeEvidenceTransfer, revokeTransferAuthorization, transferEvidence, getEvidenceTransfer,
    acquireRuntimeLease, renewRuntimeLease, releaseRuntimeLease,
    commitSnapshot, compactSnapshotHistory, updateSelfModelCenter,
    getHead, getSnapshot, auditWorldline, getWorldline(id) {
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
