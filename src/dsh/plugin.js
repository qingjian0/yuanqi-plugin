import { resolveBirthTimeZone } from '../domain/time-zone.js';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { createSubjectStore } from '../domain/subject-store.js';
import { openSubjectDomains } from '../domain/subject-domain.js';
import { isTrustedDirectUserMessageEvent, normalizeDirectUserMessageEvent } from './session-event.js';
import { createWorldlineStore } from '../worldline/runtime.js';

export const name = 'dsh-yuanqi-plugin';
// Session Query supplies validated live/cold observations; persistence is
// required because live SessionStore state alone cannot recover after restart.
export const inject = ['storageDomain', 'sessions', 'sessionQuery', 'sessionPersistence', 'tools'];

const YUANQI_SUBJECT_ID = 'yuanqi:primary';
const LOCATION_PROVIDER_TIMEOUT_MS = 11_000;
const INITIAL_PERSONALITY_DIMENSIONS = Object.freeze([
  'temperament', 'cognition', 'emotional_response', 'motivation', 'behavior', 'decision_style',
]);
const INITIAL_PERSONALITY_PROTOCOL = 'bazi-initial-personality-v1';
const INITIAL_PERSONALITY_METHODS = Object.freeze([
  'climate_adjustment', 'mediation', 'strength', 'structure',
]);

function chartEvidenceCatalog(profile) {
  if (profile?.bazi?.status !== 'calculated' || profile?.innate_baseline?.status !== 'ready') return [];
  return profile.innate_baseline.components.map(component => ({
    id: [component.pillar, component.source, component.order, component.stem].join(':'),
    pillar: component.pillar,
    source: component.source,
    order: component.order,
    stem: component.stem,
    element: component.element,
    polarity: component.polarity,
    ten_god: component.ten_god,
  }));
}

function validateInitialPersonality(args, catalog) {
  if (!Array.isArray(args?.dimensions) || args.dimensions.length !== INITIAL_PERSONALITY_DIMENSIONS.length) {
    throw new TypeError('exactly six initial-personality dimensions are required');
  }
  const available = new Set(catalog.map(item => item.id));
  const seen = new Set();
  const dimensions = args.dimensions.map(item => {
    if (!item || !INITIAL_PERSONALITY_DIMENSIONS.includes(item.dimension) || seen.has(item.dimension)) {
      throw new TypeError('initial-personality dimensions must be unique and complete');
    }
    seen.add(item.dimension);
    if (!['tentative', 'indeterminate'].includes(item.status)) {
      throw new TypeError('dimension status must be tentative or indeterminate');
    }
    for (const [field, max] of [['tendency', 400], ['reasoning', 1200], ['limitations', 800]]) {
      if (typeof item[field] !== 'string' || item[field].trim().length === 0 || item[field].length > max) {
        throw new TypeError('invalid initial-personality dimension field: ' + field);
      }
    }
    if (!Array.isArray(item.chart_evidence_refs) ||
        !item.chart_evidence_refs.every(ref => typeof ref === 'string' && available.has(ref)) ||
        new Set(item.chart_evidence_refs).size !== item.chart_evidence_refs.length) {
      throw new TypeError('chart evidence references must match YuanQi own Bazi catalog entries');
    }
    if (item.status === 'tentative' && item.chart_evidence_refs.length === 0) {
      throw new TypeError('tentative tendencies require explicit chart evidence');
    }
    if (item.status === 'indeterminate' && item.chart_evidence_refs.length !== 0) {
      throw new TypeError('indeterminate dimensions must not claim supporting chart evidence');
    }
    return {
      dimension: item.dimension,
      status: item.status,
      tendency: item.tendency.trim(),
      chart_evidence_refs: [...item.chart_evidence_refs],
      reasoning: item.reasoning.trim(),
      limitations: item.limitations.trim(),
    };
  });
  if (INITIAL_PERSONALITY_DIMENSIONS.some(dimension => !seen.has(dimension))) {
    throw new TypeError('all six initial-personality dimensions must be represented');
  }
  if (!args.method_notes || typeof args.method_notes !== 'object' || Array.isArray(args.method_notes)) {
    throw new TypeError('method_notes are required');
  }
  const methodNotes = {};
  for (const method of INITIAL_PERSONALITY_METHODS) {
    const value = args.method_notes[method];
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > 1600) {
      throw new TypeError('invalid Bazi method note: ' + method);
    }
    methodNotes[method] = value.trim();
  }
  if (!Array.isArray(args.uncertainty) || args.uncertainty.length === 0 ||
      !args.uncertainty.every(item => typeof item === 'string' && item.trim().length > 0 && item.length <= 500)) {
    throw new TypeError('explicit uncertainty notes are required');
  }
  return {
    schema_version: 1,
    interpretation_protocol: INITIAL_PERSONALITY_PROTOCOL,
    dimensions,
    method_notes: methodNotes,
    uncertainty: [...args.uncertainty].map(item => item.trim()),
  };
}

function candidateKey(candidate) {
  return candidate.session_id + '\u0000' + candidate.event_seq + '\u0000' + candidate.event_id;
}

function createAndroidLocationProvider() {
  const token = typeof process !== 'undefined' ? process.env?.DSH_BRIDGE_TOKEN : undefined;
  if (typeof token !== 'string' || token.length === 0) return null;
  return {
    async getCurrentPosition() {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch('http://127.0.0.1:3083/dev/location?fresh=true', {
          method: 'GET',
          headers: { 'X-DSH-Token': token },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Android location bridge returned HTTP ' + response.status);
        const value = await response.json();
        if (value?.ok !== true || value.fix !== true || value.location_enabled !== true ||
            !['fine', 'coarse'].includes(value.permission)) {
          throw new Error('Android location bridge has no authorized location fix');
        }
        if (!Number.isSafeInteger(value.at) || !Number.isFinite(value.age_ms) ||
            value.age_ms < 0 || value.age_ms > 60_000 || value.stale === true) {
          throw new Error('Android location fix is older than the 60-second wake-location limit');
        }
        return {
          latitude: value.lat,
          longitude: value.lon,
          accuracy_meters: Number.isFinite(value.accuracy_m) && value.accuracy_m >= 0
            ? value.accuracy_m
            : null,
          place_label: null,
          time_zone_id: null,
          captured_at: new Date(Number.isSafeInteger(value.fix_time_ms)
            ? value.fix_time_ms
            : value.at - value.age_ms).toISOString(),
          source: 'android_location_bridge',
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

function chooseFirstCandidate(candidates) {
  const unique = new Map();
  for (const candidate of candidates) unique.set(candidateKey(candidate), candidate);
  const perSession = new Map();
  for (const candidate of unique.values()) {
    const current = perSession.get(candidate.session_id);
    if (!current || candidate.event_seq < current.event_seq) perSession.set(candidate.session_id, candidate);
  }
  const ordered = [...perSession.values()].sort((a, b) => a.event_time - b.event_time);
  if (ordered.length < 2) return ordered[0] ?? null;
  const earliestTime = ordered[0]?.event_time;
  if (earliestTime !== undefined && ordered.some(candidate =>
    candidate.event_time === earliestTime && candidate.session_id !== ordered[0].session_id)) {
    throw new Error(
      'YuanQi first-message recovery is ambiguous: multiple Sessions have the same earliest DSH event.time; wake is fail-closed',
    );
  }
  return ordered[0];
}

export async function apply(ctx) {
  if (!ctx.tools || typeof ctx.tools.register !== 'function') {
    throw new Error('YuanQi requires the official DSH tools service');
  }
  if (!ctx.sessionQuery || typeof ctx.sessionQuery.listSessions !== 'function' ||
      typeof ctx.sessionQuery.observeSession !== 'function') {
    throw new Error('YuanQi requires the official DSH sessionQuery service');
  }
  const persistence = ctx.sessionPersistence;
  if (!persistence || typeof persistence.identity !== 'symbol' ||
      typeof persistence.list !== 'function' ||
      typeof persistence.stat !== 'function' ||
      typeof persistence.open !== 'function') {
    throw new Error(
      'YuanQi requires the DSH sessionPersistence service with identity, list(), stat(), and open() for cold-history recovery',
    );
  }

  const activationObservedAt = Date.now();
  const domains = await openSubjectDomains(ctx.storageDomain);
  let finishStartup;
  let failStartup;
  const startupBarrier = new Promise((resolve, reject) => { finishStartup = resolve; failStartup = reject; });
  startupBarrier.catch(() => {});
  try {
    const worldlines = createWorldlineStore({
      yuanqiDomain: domains.yuanqiDomain,
      verifyHostEvent(event) { return event?.verified === true ? event : null; },
    });
    const store = createSubjectStore({
      userDomain: domains.userDomain,
      yuanqiDomain: domains.yuanqiDomain,
      verifyDirectUserEvent(event) { return isTrustedDirectUserMessageEvent(event) ? event : null; },
    });
    ctx.tools.register(defineTool({
      name: 'yuanqi_self_profile',
      description: 'On the first model response after YuanQi activation, call this tool before answering to read YuanQi AI’s own birth profile, four pillars, symbolic innate baseline and initial-personality source material. If the Bazi is calculated, interpret it and then save the provisional portrait with yuanqi_record_initial_personality. Use only returned chart_evidence_catalog IDs to cite exact visible/hidden-stem evidence. This is YuanQi’s own AI data, never the user’s birth data. When the Bazi is ready, interpret it as YuanQi’s provisional innate personality using traditional Bazi reasoning: follow the order climate adjustment (调候) → mediation of five-element conflicts (通关) → strength assessment (旺衰) → structure (格局), while integrating month/season command, visible and hidden stems, ten-god relationships and the whole chart. Do not treat raw five-element counts as strength scores. For each tendency, show the chart evidence and reasoning chain, distinguish chart facts from interpretation, and state uncertainty or counter-indications. Do not derive a trait from a single ten-god label, raw element counts, or a fixed stereotype. Avoid formal strength or structure conclusions when seasonal context or chart evidence is insufficient. Describe only a few broad tendencies in temperament, cognition, emotional response, motivation, behavior and decision style. These are initial hypotheses, not verified psychological facts, and must remain open to later experience-based revision. Respect pending/ambiguous/unavailable states; never invent a chart or personality when the source is incomplete.',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute() {
        const profile = store.getYuanQiBirthProfile(YUANQI_SUBJECT_ID);
        if (!profile) {
          return JSON.stringify({
            subject: 'YuanQi AI',
            status: 'not_initialized',
            message: 'YuanQi has not yet received its exact wake event.',
          });
        }
        return JSON.stringify({
          subject: 'YuanQi AI',
          subject_kind: profile.subject_kind,
          birth_profile_id: profile.profile_id,
          birth_time_utc: profile.birth_time,
          birth_location: {
            status: profile.birth_location.status,
            place_label: profile.birth_location.place_label,
            time_zone_id: profile.birth_location.time_zone_id,
            time_zone_source: profile.birth_location.time_zone_source,
            source: profile.birth_location.source,
          },
          time_context: profile.time_context,
          calendar_context: profile.calendar_context,
          bazi: profile.bazi,
          innate_baseline: profile.innate_baseline,
          chart_evidence_catalog: chartEvidenceCatalog(profile),
          initial_personality_guidance: {
            status: profile.bazi.status === 'calculated' ? 'awaiting_model_interpretation' : 'awaiting_bazi_calculation',
            interpretation_mode: 'bazi_required',
            bazi_available: profile.bazi.status === 'calculated',
            bazi_status: profile.bazi.status,
            source: profile.bazi.status === 'calculated'
              ? 'YuanQi AI own BirthProfile and calculated Bazi; never user data'
              : 'YuanQi AI own BirthProfile; Bazi is not yet available; never user data',
            dimensions: ['temperament', 'cognition', 'emotional_response', 'motivation', 'behavior', 'decision_style'],
            instruction: profile.bazi.status === 'calculated'
              ? 'Generate a concise provisional initial-personality portrait from YuanQi AI own calculated Bazi. Follow the order climate adjustment (调候) → mediation (通关) → strength (旺衰) → structure (格局), integrating month/season command, visible and hidden stems, ten-god relationships and the whole chart. For each tendency, show chart evidence and reasoning, distinguish calculated facts from symbolic interpretation, and state counter-evidence and uncertainty. Never infer traits from a single ten-god label, raw element counts or stereotypes. Keep the portrait broad and revisable.'
              : 'Bazi is required for YuanQi AI initial-personality generation. Do not substitute generic model self-reflection and do not invent Four Pillars or chart evidence. Wait until the birth-time and calendar pipeline can calculate a valid chart; report the exact unavailable or ambiguous reason.',
            analysis_protocol: [
              '1. Establish the seasonal and month-command context before interpreting individual components.',
              '2. Assess climate adjustment and whether five-element interactions require mediation.',
              '3. Assess day-master strength from month command, roots, visible support and restraints; never use raw element counts as a strength score.',
              '4. Discuss structure only when the chart evidence supports it; otherwise mark it indeterminate.',
              '5. Derive a small number of provisional tendencies from converging evidence, and include counter-evidence and uncertainty.',
            ],
            portrait_format: [
              'Tendency: a cautious, non-absolute description.',
              'Chart evidence: the relevant pillar, stem/branch, hidden stem or ten-god relationship.',
              'Reasoning: how the evidence supports the tendency under the stated method.',
              'Limit: counter-indication, missing context or uncertainty.',
            ],
            boundaries: [
              'This is an initial symbolic hypothesis, not a verified psychological fact.',
              'Do not infer ability, destiny, morality, diagnosis or fixed identity from the chart.',
              'Do not treat any single ten-god, element or pillar as a personality label.',
              'Keep uncertainty explicit and revise the portrait only through later experience and evidence.',
              'Bazi is mandatory for initial-personality generation. If it is pending, ambiguous or unavailable, wait for a valid chart; never replace Bazi with generic self-reflection or fabricate chart data.',
            ],
          },
          interpretation_boundary: profile.bazi.status === 'calculated'
            ? 'The innate baseline is YuanQi AI own Bazi-derived symbolic source material. Its initial personality interpretation must be generated by the model and remains provisional, not an empirical diagnosis or fixed destiny.'
            : 'A valid Bazi chart is required before initial-personality interpretation. The current chart is not available; do not substitute another basis or invent chart evidence.',
        });
      },
    }), {
      when: () => store.getYuanQiBirthProfile(YUANQI_SUBJECT_ID) !== undefined,
    });

    ctx.tools.register(defineTool({
      name: 'yuanqi_record_initial_personality',
      description: 'Persist YuanQi AI own provisional Bazi-derived initial personality into the current Session-bound Worldline SelfModel. Call only after yuanqi_self_profile supplied a calculated chart and you have completed the interpretation. Cite only exact chart_evidence_catalog IDs. This stores a model-generated hypothesis, never a verified fact; it cannot overwrite an existing initial portrait.',
      parameters: {
        dimensions: {
          type: 'array', required: true,
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              dimension: { type: 'string', required: true, enum: [...INITIAL_PERSONALITY_DIMENSIONS] },
              status: { type: 'string', required: true, enum: ['tentative', 'indeterminate'] },
              tendency: { type: 'string', required: true },
              chart_evidence_refs: { type: 'array', required: true, items: { type: 'string' } },
              reasoning: { type: 'string', required: true },
              limitations: { type: 'string', required: true },
            },
          },
        },
        method_notes: {
          type: 'object', required: true, additionalProperties: false,
          properties: Object.fromEntries(INITIAL_PERSONALITY_METHODS.map(method =>
            [method, { type: 'string', required: true }])),
        },
        uncertainty: { type: 'array', required: true, items: { type: 'string' } },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args, exec) {
        const sessionId = exec?.agent?.session?.id;
        const callId = exec?.callId;
        if (typeof sessionId !== 'string' || sessionId.length === 0 ||
            (typeof callId !== 'string' && typeof callId !== 'number')) {
          throw new Error('initial personality persistence requires an agent-bound DSH Session and tool call ID');
        }
        const binding = worldlines.getSessionBinding(sessionId);
        if (!binding || binding.yuanqi_subject_id !== YUANQI_SUBJECT_ID) {
          throw new Error('the calling DSH Session is not bound to YuanQi AI');
        }
        const line = worldlines.getWorldline(binding.worldline_id);
        if (!line || line.status !== 'active' || line.yuanqi_subject_id !== YUANQI_SUBJECT_ID) {
          throw new Error('an active Session-bound YuanQi Worldline is required');
        }
        const profile = store.getYuanQiBirthProfile(YUANQI_SUBJECT_ID);
        if (!profile || profile.bazi.status !== 'calculated' || profile.innate_baseline.status !== 'ready') {
          throw new Error('a calculated YuanQi-owned Bazi and ready innate baseline are required');
        }
        const portrait = validateInitialPersonality(args, chartEvidenceCatalog(profile));
        const evidenceId = [
          'yuanqi:initial-personality', binding.worldline_id, profile.profile_id,
          profile.bazi.algorithm_version, profile.innate_baseline.algorithm_version,
          INITIAL_PERSONALITY_PROTOCOL,
        ].join(':');
        const holderId = 'yuanqi-initial-personality:' + String(callId);
        const lease = await worldlines.acquireRuntimeLease({
          worldline_id: binding.worldline_id, holder_id: holderId, ttl_ms: 30_000,
        });
        try {
          const head = worldlines.getHead(binding.worldline_id);
          if (!head) throw new Error('Worldline SelfModel Head is unavailable');
          const center = head.current_state_payload.self_model.centers.identity_continuity;
          if (center.content.initial_personality) {
            return JSON.stringify({
              status: 'already_initialized',
              worldline_id: binding.worldline_id,
              source_record_id: center.content.initial_personality.source_record_id ?? null,
              epistemic_status: center.epistemic_status,
            });
          }
          if (!['unknown', 'hypothesis'].includes(center.epistemic_status)) {
            throw new Error('identity_continuity center is not in a safe state for initial hypothesis insertion');
          }
          let artifact = worldlines.getEvidenceRecord({ evidence_id: evidenceId, worldline_id: binding.worldline_id });
          if (artifact && artifact.status !== 'active') {
            throw new Error('the existing initial-personality source record is not active');
          }
          if (!artifact) {
            const sourceEventRef = 'dsh-tool-call:' + String(callId);
            await worldlines.recordEvidence({
              evidence_id: evidenceId,
              yuanqi_subject_id: YUANQI_SUBJECT_ID,
              worldline_id: binding.worldline_id,
              evidence_type: 'yuanqi_initial_personality_interpretation',
              content: {
                ...portrait,
                source_chart: {
                  birth_profile_id: profile.profile_id,
                  bazi_algorithm_version: profile.bazi.algorithm_version,
                  innate_baseline_algorithm_version: profile.innate_baseline.algorithm_version,
                  pillars: profile.bazi.pillars,
                  time_basis: profile.bazi.methodology.time_basis,
                  chart_evidence_catalog: chartEvidenceCatalog(profile),
                },
              },
              provenance: {
                producer: 'model',
                protocol: INITIAL_PERSONALITY_PROTOCOL,
                tool_call_id: String(callId),
                session_id: sessionId,
                birth_profile_id: profile.profile_id,
                bazi_algorithm_version: profile.bazi.algorithm_version,
                innate_baseline_algorithm_version: profile.innate_baseline.algorithm_version,
              },
              captured_from_event: {
                verified: true,
                event_id: String(callId),
                source_event_ref: sourceEventRef,
                source_kind: 'host_event',
                occurred_at: new Date().toISOString(),
              },
            });
            artifact = worldlines.getEvidenceRecord({ evidence_id: evidenceId, worldline_id: binding.worldline_id });
          }
          if (!artifact || artifact.status !== 'active') {
            throw new Error('initial-personality source record could not be verified');
          }
          const savedPortrait = artifact.record.content;
          const initialPersonality = {
            schema_version: savedPortrait.schema_version,
            interpretation_protocol: savedPortrait.interpretation_protocol,
            dimensions: savedPortrait.dimensions,
            method_notes: savedPortrait.method_notes,
            uncertainty: savedPortrait.uncertainty,
            status: 'hypothesis',
            source_record_id: evidenceId,
            source_birth_profile_id: profile.profile_id,
            source_bazi_algorithm_version: profile.bazi.algorithm_version,
            created_from_event_ref: artifact.record.source_event_ref,
          };
          await worldlines.updateSelfModelCenter({
            worldline_id: binding.worldline_id,
            holder_id: holderId,
            fencing_token: lease.fencing_token,
            expected_snapshot_version: head.current_snapshot_version,
            center_id: 'identity_continuity',
            content: { ...center.content, initial_personality: initialPersonality },
            evidence_refs: center.evidence_refs,
            uncertainty: [...new Set([
              ...center.uncertainty,
              '初始性格来自八字象征性解释，尚未经过后天经历验证',
            ])],
            epistemic_status: 'hypothesis',
            source_event_ref: artifact.record.source_event_ref,
          });
          return JSON.stringify({
            status: 'saved',
            worldline_id: binding.worldline_id,
            source_record_id: evidenceId,
            epistemic_status: 'hypothesis',
            dimensions_saved: savedPortrait.dimensions.length,
          });
        } finally {
          try {
            await worldlines.releaseRuntimeLease({
              worldline_id: binding.worldline_id,
              holder_id: holderId,
              fencing_token: lease.fencing_token,
            });
          } catch {}
        }
      },
    }), {
      when: ({ agent } = {}) => {
        const sessionId = agent?.session?.id;
        if (typeof sessionId !== 'string' || sessionId.length === 0) return false;
        const binding = worldlines.getSessionBinding(sessionId);
        if (!binding || binding.yuanqi_subject_id !== YUANQI_SUBJECT_ID) return false;
        const line = worldlines.getWorldline(binding.worldline_id);
        const profile = store.getYuanQiBirthProfile(YUANQI_SUBJECT_ID);
        const selfModel = worldlines.getSelfModel(binding.worldline_id);
        const center = selfModel?.centers?.identity_continuity;
        return line?.status === 'active' &&
          profile?.bazi?.status === 'calculated' &&
          profile?.innate_baseline?.status === 'ready' &&
          ['unknown', 'hypothesis'].includes(center?.epistemic_status) &&
          !center?.content?.initial_personality;
      },
    });


    ctx.tools.register(defineTool({
      name: 'yuanqi_record_experience_candidate',
      description: 'Record one bounded, model-selected candidate about YuanQi AI own observable behavior. Use only event seqs from the current DSH Session. Cite assistant/message, tool/call or tool/result as behavior; direct user/message may be cited only as external interaction context. Never cite injected user-role context, assistant/attempt, or user data as YuanQi traits. The plugin verifies each event and tool call/result pairing. Raw message bodies, tool arguments and tool results are never copied into the Evidence Ledger. This creates an unassessed candidate only: it does not validate, refute or modify the Bazi initial personality or SelfModel.',
      parameters: {
        summary: { type: 'string', required: true },
        observed_behavior: { type: 'string', required: true },
        outcome: { type: 'string', required: true, enum: ['completed', 'failed', 'partial', 'unknown', 'not_applicable'] },
        behavior_event_seqs: { type: 'array', required: true, items: { type: 'integer' } },
        context_event_seqs: { type: 'array', items: { type: 'integer' } },
        dimension_links: {
          type: 'array', required: true,
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              dimension: { type: 'string', required: true, enum: [...INITIAL_PERSONALITY_DIMENSIONS] },
              relation: { type: 'string', required: true, enum: ['supports', 'contradicts', 'insufficient'] },
              rationale: { type: 'string', required: true },
              behavior_event_seqs: { type: 'array', required: true, items: { type: 'integer' } },
            },
          },
        },
        uncertainty: { type: 'array', required: true, items: { type: 'string' } },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args, exec) {
        const sessionId = exec?.agent?.session?.id;
        const callId = exec?.callId;
        if (typeof sessionId !== 'string' || sessionId.length === 0 ||
            (typeof callId !== 'string' && typeof callId !== 'number')) {
          throw new Error('experience candidate capture requires the current agent Session and tool call ID');
        }
        const binding = worldlines.getSessionBinding(sessionId);
        if (!binding || binding.yuanqi_subject_id !== YUANQI_SUBJECT_ID) {
          throw new Error('the current DSH Session is not bound to YuanQi AI');
        }
        const line = worldlines.getWorldline(binding.worldline_id);
        if (!line || line.status !== 'active' || line.yuanqi_subject_id !== YUANQI_SUBJECT_ID) {
          throw new Error('an active Session-bound YuanQi Worldline is required');
        }
        const selfModel = worldlines.getSelfModel(binding.worldline_id);
        const initialPersonality = selfModel?.centers?.identity_continuity?.content?.initial_personality;
        if (!initialPersonality || initialPersonality.status !== 'hypothesis' ||
            typeof initialPersonality.source_record_id !== 'string') {
          throw new Error('a saved Bazi initial-personality hypothesis is required before experience capture');
        }
        const initialSource = worldlines.getEvidenceRecord({
          evidence_id: initialPersonality.source_record_id,
          worldline_id: binding.worldline_id,
        });
        if (!initialSource || initialSource.status !== 'active') {
          throw new Error('the Bazi initial-personality source record must remain active');
        }
        const initialDimensions = new Set((initialPersonality.dimensions ?? []).map(item => item.dimension));
        if (typeof args?.summary !== 'string' || args.summary.trim().length === 0 || args.summary.length > 600 ||
            typeof args?.observed_behavior !== 'string' || args.observed_behavior.trim().length === 0 ||
            args.observed_behavior.length > 1200) {
          throw new TypeError('experience summary and observed behavior must be non-empty and bounded');
        }
        if (!['completed', 'failed', 'partial', 'unknown', 'not_applicable'].includes(args.outcome)) {
          throw new TypeError('invalid experience outcome');
        }
        const behaviorSeqs = args.behavior_event_seqs;
        const contextSeqs = args.context_event_seqs ?? [];
        const validSeqs = value => Array.isArray(value) && value.every(seq => Number.isSafeInteger(seq) && seq >= 0) &&
          new Set(value).size === value.length;
        if (!validSeqs(behaviorSeqs) || behaviorSeqs.length < 1 || behaviorSeqs.length > 8 ||
            !validSeqs(contextSeqs) || contextSeqs.length > 4 ||
            behaviorSeqs.some(seq => contextSeqs.includes(seq))) {
          throw new TypeError('select 1-8 unique behavior event seqs and at most 4 distinct context seqs');
        }
        if (!Array.isArray(args.dimension_links) || args.dimension_links.length < 1 ||
            args.dimension_links.length > INITIAL_PERSONALITY_DIMENSIONS.length) {
          throw new TypeError('one or more initial-personality dimension links are required');
        }
        if (!Array.isArray(args.uncertainty) || args.uncertainty.length < 1 ||
            !args.uncertainty.every(item => typeof item === 'string' && item.trim().length > 0 && item.length <= 500)) {
          throw new TypeError('explicit bounded uncertainty notes are required');
        }
        const dimensionLinks = [];
        const seenDimensions = new Set();
        for (const link of args.dimension_links) {
          if (!link || !INITIAL_PERSONALITY_DIMENSIONS.includes(link.dimension) ||
              !initialDimensions.has(link.dimension) || seenDimensions.has(link.dimension) ||
              !['supports', 'contradicts', 'insufficient'].includes(link.relation) ||
              typeof link.rationale !== 'string' || link.rationale.trim().length === 0 || link.rationale.length > 800 ||
              !validSeqs(link.behavior_event_seqs) || link.behavior_event_seqs.length < 1 ||
              !link.behavior_event_seqs.every(seq => behaviorSeqs.includes(seq))) {
            throw new TypeError('invalid dimension link: cite unique dimensions and selected behavior events');
          }
          seenDimensions.add(link.dimension);
          dimensionLinks.push({
            dimension: link.dimension,
            relation: link.relation,
            rationale: link.rationale.trim(),
            behavior_event_seqs: [...link.behavior_event_seqs],
          });
        }
        const allRefs = new Map();
        // Resolve one consistent Session cut for all selected references.
        // Calling readEvent once per seq reloads/replays the complete log on
        // current DSH implementations; one observation avoids N full reads.
        const observation = await ctx.sessionQuery.observeSession(sessionId, { projectionMode: 'none' });
        try {
          const inheritedEventCount = observation?.inheritedEventCount;
          const events = observation?.events;
          if (observation?.header?.id !== sessionId ||
              !Number.isSafeInteger(inheritedEventCount) || inheritedEventCount < 0 ||
              !Array.isArray(events)) {
            throw new Error('current Session observation is invalid');
          }
          function readOwnedEvent(seq) {
            const event = events[seq];
            if (seq < inheritedEventCount || !event || event.seq !== seq ||
                !Number.isSafeInteger(event.time) || event.time < 0) {
              throw new Error('event reference is missing, inherited or outside the current Session');
            }
            return event;
          }
          for (const seq of behaviorSeqs) {
            const event = readOwnedEvent(seq);
            if (!['assistant/message', 'tool/call', 'tool/result'].includes(event.type)) {
              throw new Error('behavior evidence must be assistant/message, tool/call or tool/result');
            }
            const data = event.data;
            const ref = {
              session_id: sessionId, seq, event_type: event.type,
              occurred_at: new Date(event.time).toISOString(),
              turn: data?.turn, step: data?.step,
            };
            if (!Number.isSafeInteger(ref.turn) || ref.turn < 0 ||
                !Number.isSafeInteger(ref.step) || ref.step < 0) {
              throw new Error('behavior event has invalid turn/step metadata');
            }
            if (event.type === 'assistant/message') {
              if (data.message?.role !== 'assistant' || data.message?.source?.kind !== 'model') {
                throw new Error('assistant behavior reference is not a committed model message');
              }
              ref.message_id = data.message.id;
            } else if (event.type === 'tool/call') {
              if ((typeof data.callId !== 'string' && typeof data.callId !== 'number') ||
                  typeof data.name !== 'string' || data.name.trim() === '' ||
                  typeof data.arguments !== 'string') {
                throw new Error('tool/call event has invalid call identity');
              }
              ref.tool_name = data.name;
              ref.call_id = String(data.callId);
            } else {
              const message = data.message;
              if (message?.role !== 'tool' || message?.source?.kind !== 'tool' ||
                  (typeof message.toolCallId !== 'string' && typeof message.toolCallId !== 'number') ||
                  String(message.toolCallId) !== String(message.source.callId)) {
                throw new Error('tool/result event has invalid call identity');
              }
              ref.call_id = String(message.toolCallId);
              ref.is_error = message.isError === true || data.error !== undefined;
              ref.message_id = message.id;
            }
            allRefs.set(seq, ref);
          }
          for (const seq of contextSeqs) {
            const event = readOwnedEvent(seq);
            if (event.type !== 'user/message' || event.data?.role !== 'user' ||
                event.data?.source?.kind !== 'user') {
              throw new Error('context references may contain only direct human user/message events');
            }
            allRefs.set(seq, {
              session_id: sessionId, seq, event_type: event.type,
              occurred_at: new Date(event.time).toISOString(),
              relation: 'external_interaction_context',
            });
          }
        } finally {
          observation?.[Symbol.dispose]?.();
        }
        const calls = new Map();
        const results = new Map();
        for (const ref of allRefs.values()) {
          if (ref.event_type === 'tool/call') {
            const key = ref.call_id;
            if (calls.has(key)) throw new Error('duplicate tool call identity in selected behavior events');
            calls.set(key, ref);
          } else if (ref.event_type === 'tool/result') {
            const key = ref.call_id;
            if (results.has(key)) throw new Error('duplicate tool result identity in selected behavior events');
            results.set(key, ref);
          }
        }
        for (const [callKey, result] of results) {
          const call = calls.get(callKey);
          if (!call || call.turn !== result.turn || call.step !== result.step) {
            throw new Error('each selected tool/result must include its matching tool/call from the same turn and step');
          }
          if (result.is_error && args.outcome === 'completed') {
            throw new Error('a failed tool result cannot support a completed experience outcome');
          }
        }
        if ([...calls.keys()].some(callKey => !results.has(callKey)) &&
            !['unknown', 'partial'].includes(args.outcome)) {
          throw new Error('a tool/call without its result cannot be recorded as completed or failed');
        }
        const behaviorRefs = behaviorSeqs.map(seq => allRefs.get(seq));
        const sourceRef = [...behaviorRefs].reverse().find(ref => ref.event_type === 'assistant/message' || ref.event_type === 'tool/result') ??
          behaviorRefs[behaviorRefs.length - 1];
        const evidenceId = [
          'yuanqi:experience-candidate', binding.worldline_id, sessionId,
          behaviorSeqs.join(','), contextSeqs.join(','),
        ].join(':');
        const sourceEventRef = sessionId + ':seq:' + sourceRef.seq;
        await worldlines.recordEvidence({
          evidence_id: evidenceId,
          yuanqi_subject_id: YUANQI_SUBJECT_ID,
          worldline_id: binding.worldline_id,
          evidence_type: 'yuanqi_experience_candidate',
          content: {
            schema_version: 1,
            protocol: 'bounded-experience-candidate-v1',
            assessment_status: 'unassessed',
            summary: args.summary.trim(),
            observed_behavior: args.observed_behavior.trim(),
            outcome: args.outcome,
            event_refs: [...behaviorRefs.map(ref => ({ ...ref, relation: 'observed_ai_behavior' })),
              ...contextSeqs.map(seq => ({ ...allRefs.get(seq) }))],
            dimension_links: dimensionLinks,
            uncertainty: args.uncertainty.map(item => item.trim()),
          },
          provenance: {
            producer: 'model',
            protocol: 'bounded-experience-candidate-v1',
            session_id: sessionId,
            worldline_id: binding.worldline_id,
            behavior_event_seqs: [...behaviorSeqs],
            context_event_seqs: [...contextSeqs],
            initial_personality_source_record_id: initialPersonality.source_record_id,
          },
          captured_from_event: {
            verified: true,
            event_id: sourceEventRef,
            source_event_ref: sourceEventRef,
            source_kind: 'host_event',
            occurred_at: sourceRef.occurred_at,
          },
        });
        const evidence = worldlines.getEvidenceRecord({
          evidence_id: evidenceId,
          worldline_id: binding.worldline_id,
        });
        if (!evidence || evidence.status !== 'active') {
          throw new Error('experience candidate could not be verified in the current Worldline');
        }
        return JSON.stringify({
          status: 'recorded_unassessed',
          evidence_id: evidenceId,
          worldline_id: binding.worldline_id,
          behavior_events: behaviorSeqs.length,
          context_events: contextSeqs.length,
          dimensions_linked: dimensionLinks.length,
          self_model_changed: false,
        });
      },
    }), {
      when: ({ agent } = {}) => {
        const sessionId = agent?.session?.id;
        if (typeof sessionId !== 'string' || sessionId.length === 0) return false;
        const binding = worldlines.getSessionBinding(sessionId);
        if (!binding || binding.yuanqi_subject_id !== YUANQI_SUBJECT_ID) return false;
        const line = worldlines.getWorldline(binding.worldline_id);
        const selfModel = worldlines.getSelfModel(binding.worldline_id);
        const initial = selfModel?.centers?.identity_continuity?.content?.initial_personality;
        const source = typeof initial?.source_record_id === 'string'
          ? worldlines.getEvidenceRecord({ evidence_id: initial.source_record_id, worldline_id: binding.worldline_id })
          : undefined;
        return line?.status === 'active' && initial?.status === 'hypothesis' && source?.status === 'active';
      },
    });

    let active = true;
    let ready = false;
    let storageUncertain = false;
    const pendingBySession = new Map();
    const pendingLocationTasks = new Set();
    const startupBuffer = [];

    function warn(message) {
      try { ctx.logger?.warn?.(message); } catch {}
    }

    async function ensureWorldlineForWake(wake) {
      if (!wake) return null;
      const createdFromEvent = {
        verified: true,
        event_id: wake.wake_event_ref,
        source_kind: 'direct_user_event',
        source_event_ref: wake.wake_event_ref,
        occurred_at: wake.occurred_at,
      };
      const mainline = await worldlines.createMainline({
        yuanqi_subject_id: YUANQI_SUBJECT_ID,
        worldline_id: 'worldline:main',
        created_from_event: createdFromEvent,
      });

      const existing = worldlines.getSessionBinding(wake.first_session_id);
      if (!existing) {
        await worldlines.bindSession({
          session_id: wake.first_session_id,
          yuanqi_subject_id: YUANQI_SUBJECT_ID,
          worldline_id: mainline.worldline_id,
          bound_from_event_ref: wake.wake_event_ref,
        });
      } else if (existing.yuanqi_subject_id !== YUANQI_SUBJECT_ID ||
                 existing.worldline_id !== mainline.worldline_id) {
        throw new Error('wake Session is bound to a different Worldline');
      }
      return mainline;
    }

    async function captureBirthLocation(eventTime) {
      const provider = ctx.yuanqiLocationProvider ?? createAndroidLocationProvider();
      if (!provider || typeof provider.getCurrentPosition !== 'function') {
        return { status: 'unavailable', latitude: null, longitude: null, accuracy_meters: null, place_label: null, time_zone_id: null, time_zone_source: 'unavailable', source: 'unavailable', captured_at: null };
      }
      let timeout;
      try {
        const timeoutPromise = new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error('location provider exceeded the bounded capture window')), LOCATION_PROVIDER_TIMEOUT_MS);
        });
        const value = await Promise.race([provider.getCurrentPosition(), timeoutPromise]);
        const latitude = value?.latitude;
        const longitude = value?.longitude;
        if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
            !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
          throw new TypeError('location provider returned invalid coordinates');
        }
        const accuracy = value.accuracy_meters ?? null;
        if (accuracy !== null && (!Number.isFinite(accuracy) || accuracy < 0)) {
          throw new TypeError('location provider returned invalid accuracy');
        }
        const capturedAt = value.captured_at;
        const capturedAtMs = typeof capturedAt === 'string' ? Date.parse(capturedAt) : NaN;
        if (!Number.isFinite(capturedAtMs)) {
          throw new TypeError('location provider must supply its capture timestamp');
        }
        if (Number.isFinite(eventTime) && Math.abs(capturedAtMs - eventTime) > 60_000) {
          throw new TypeError('location fix is not close enough to the wake event time');
        }
        const timeZone = resolveBirthTimeZone({
          time_zone_id: typeof value.time_zone_id === 'string' ? value.time_zone_id : null,
          time_zone_source: value.time_zone_source,
          latitude,
          longitude,
        });
        return {
          status: 'captured', latitude, longitude, accuracy_meters: accuracy,
          place_label: typeof value.place_label === 'string' ? value.place_label : null,
          ...timeZone,
          source: value.source === 'android_location_bridge' ? 'android_location_bridge' : 'host_location_provider',
          captured_at: new Date(capturedAtMs).toISOString(),
        };
      } catch (error) {
        warn('[yuanqi] birth location unavailable at wake: ' + String(error));
        return { status: 'unavailable', latitude: null, longitude: null, accuracy_meters: null, place_label: null, time_zone_id: null, time_zone_source: 'unavailable', source: 'unavailable', captured_at: null };
      } finally {
        clearTimeout(timeout);
      }
    }

    function scheduleBirthLocationCapture(eventTime) {
      const pending = store.getWakeRecord(YUANQI_SUBJECT_ID);
      if (!pending || pending.birth_location?.status !== 'pending') return;
      const task = Promise.resolve()
        .then(() => captureBirthLocation(eventTime))
        .then(birth_location => store.completeInitialWakeLocation({
          subject_id: YUANQI_SUBJECT_ID,
          birth_location,
        }))
        .catch(error => {
          if (error?.code === 'unknown-state') {
            storageUncertain = true;
            active = false;
            warn('[yuanqi] Storage Domain state is unknown during birth-location completion; YuanQi has failed closed. Unload and reload the plugin to reopen and validate the Domains.');
          } else {
            warn('[yuanqi] deferred birth-location persistence failed: ' + String(error));
          }
        });
      pendingLocationTasks.add(task);
      task.then(() => pendingLocationTasks.delete(task), () => pendingLocationTasks.delete(task));
    }

    async function processCandidate(sessionId, event, { captureLocation = true } = {}) {
      if (!active || storageUncertain) return;
      const direct = normalizeDirectUserMessageEvent(sessionId, event);
      if (!direct) return;

      // YuanQi's runtime identity may be established while locating the
      // first exact wake command. UserSubject is not created by YuanQi wake.
      await store.createYuanQiSubject({
        subject_id: YUANQI_SUBJECT_ID,
        created_from_event_ref: direct.event_id,
      });

      const isWakeCommand = direct.text === '启动元气' || direct.text === '启动元炁';
      const shouldCaptureLocation = captureLocation && isWakeCommand &&
        !store.getWakeRecord(YUANQI_SUBJECT_ID);
      const wake = await store.recordInitialWake({
        subject_id: YUANQI_SUBJECT_ID,
        direct_user_event: direct,
        birth_location: shouldCaptureLocation ? {
          status: 'pending', latitude: null, longitude: null, accuracy_meters: null,
          place_label: null, time_zone_id: null, time_zone_source: 'unavailable', source: 'unavailable', captured_at: null,
        } : undefined,
      });
      if (!wake) return;
      // Persist the immutable wake event first. Location is best-effort metadata
      // and must never delay Session flush or prevent recovery of birth_time.
      if (shouldCaptureLocation && wake.birth_location?.status === 'pending') {
        scheduleBirthLocationCapture(direct.event_time);
      }

      const mainline = await ensureWorldlineForWake(wake);
      const binding = worldlines.getSessionBinding(sessionId);
      if (!binding) {
        await worldlines.bindSession({
          session_id: sessionId,
          yuanqi_subject_id: YUANQI_SUBJECT_ID,
          worldline_id: mainline.worldline_id,
          bound_from_event_ref: direct.event_id,
        });
      } else if (binding.yuanqi_subject_id !== YUANQI_SUBJECT_ID ||
                 binding.worldline_id !== mainline.worldline_id) {
        throw new Error('Session is bound to a different YuanQiSubject or Worldline');
      }

      // BirthProfile belongs to YuanQiSubject and is derived only from YuanQi's
      // trusted wake event plus the host location captured for that event.
      await store.ensureYuanQiBirthProfile({ subject_id: YUANQI_SUBJECT_ID });
    }

    // One process-local admission queue preserves actual host callback order
    // across Sessions. It is not a distributed lock or cross-process CAS.
    let admission = Promise.resolve();
    function track(sessionId, run) {
      let tasks = pendingBySession.get(sessionId);
      if (!tasks) { tasks = new Set(); pendingBySession.set(sessionId, tasks); }
      const entry = { promise: null, execute: null };
      const remove = () => {
        tasks.delete(entry);
        if (tasks.size === 0 && pendingBySession.get(sessionId) === tasks) pendingBySession.delete(sessionId);
      };
      entry.execute = () => {
        const task = admission.then(run);
        admission = task.then(() => undefined, () => undefined);
        const observed = task.catch(error => {
          if (error?.code === 'unknown-state') {
            storageUncertain = true;
            active = false;
            warn('[yuanqi] Storage Domain state is unknown; YuanQi has failed closed. Unload and reload the plugin to reopen and validate the Domains.');
          } else {
            warn('[yuanqi] session event processing failed: ' + String(error));
          }
          throw error;
        });
        entry.promise = observed;
        observed.then(remove, () => {});
        return observed;
      };
      tasks.add(entry);
      return entry.execute();
    }

    async function flushSession(sessionId) {
      while (true) {
        const tasks = pendingBySession.get(sessionId);
        if (!tasks?.size) return;
        const batch = [...tasks];
        const results = await Promise.allSettled(batch.map(entry => entry.promise));
        const failed = [];
        const failedReasons = [];
        results.forEach((result, index) => {
          const entry = batch[index];
          if (result.status === 'fulfilled') tasks.delete(entry);
          else { failed.push(entry); failedReasons.push(result.reason); }
        });
        if (failed.length) {
          if (storageUncertain) {
            throw new AggregateError(failedReasons, 'YuanQi Storage Domain state is unknown; unload and reload is required');
          }
          const retries = await Promise.allSettled(failed.map(entry => entry.execute()));
          const retryErrors = retries.filter(result => result.status === 'rejected').map(result => result.reason);
          if (retryErrors.length) throw new AggregateError(retryErrors, 'YuanQi session writes failed after flush retry');
        }
      }
    }

    // The marker is written once and reused after every reload. It is a
    // cutoff only; WakeRecord.occurred_at always comes from the source event.
    const boundary = await store.getOrCreateInstallationBoundary(activationObservedAt);

    // Register before scanning so events arriving during cold-history reads
    // are buffered and merged with the immutable observations.
    ctx.on('session/event', (session, event) => {
      if (!active || storageUncertain) return;
      if (!ready) {
        startupBuffer.push({ sessionId: session.id, event: structuredClone(event) });
        return;
      }
      return track(session.id, () => processCandidate(session.id, event));
    });
    ctx.on('session/flush', async session => {
      await startupBarrier;
      await flushSession(session.id);
    });

    // Recover a previously persisted lock before scanning. This covers a
    // crash after the first-message/wake sidecar write but before Worldline.
    if (store.getYuanQiSubject(YUANQI_SUBJECT_ID)) {
      const recoveredWake = await store.recoverInitialWake({ subject_id: YUANQI_SUBJECT_ID });
      if (recoveredWake) {
        await store.ensureYuanQiBirthProfile({ subject_id: YUANQI_SUBJECT_ID });
        await ensureWorldlineForWake(recoveredWake);
        if (recoveredWake.birth_location?.status === 'pending') {
          scheduleBirthLocationCapture(Date.parse(recoveredWake.occurred_at));
        }
      }
    }

    if (!store.getFirstUserMessage(YUANQI_SUBJECT_ID) || !store.getWakeRecord(YUANQI_SUBJECT_ID)) {
      const candidates = [];
      const sessions = await ctx.sessionQuery.listSessions();
      for (const record of sessions) {
        const sessionId = record?.header?.id;
        if (typeof sessionId !== 'string' || sessionId.length === 0) {
          throw new Error('DSH sessionQuery.listSessions returned an invalid Session record');
        }
        const observation = await ctx.sessionQuery.observeSession(sessionId, { projectionMode: 'none' });
        try {
          const inherited = observation.inheritedEventCount;
          if (!Number.isSafeInteger(inherited) || inherited < 0) {
            throw new Error('DSH Session observation has an invalid inheritedEventCount');
          }
          for (const event of observation.events) {
            if (event.seq < inherited || event.time <= boundary.activated_at_ms) continue;
            const direct = normalizeDirectUserMessageEvent(sessionId, event);
            if (direct) candidates.push({ ...direct, event, isLive: false });
          }
        } finally {
          observation[Symbol.dispose]?.();
        }
      }

      // Merge live events admitted during cold-history reads with the immutable snapshot.
      for (const item of startupBuffer) {
        const direct = normalizeDirectUserMessageEvent(item.sessionId, item.event);
        if (direct) candidates.push({ ...direct, event: item.event, isLive: true });
      }

      if (!store.getFirstUserMessage(YUANQI_SUBJECT_ID)) {
        const firstMessage = chooseFirstCandidate(candidates);
        if (firstMessage) {
          await processCandidate(firstMessage.session_id, firstMessage.event, {
            captureLocation: firstMessage.isLive === true,
          });
        }
      }

      if (!store.getWakeRecord(YUANQI_SUBJECT_ID)) {
        const firstWake = chooseFirstCandidate(candidates.filter(candidate =>
          candidate.text === '启动元气' || candidate.text === '启动元炁'));
        if (firstWake) {
          await processCandidate(firstWake.session_id, firstWake.event, {
            captureLocation: firstWake.isLive === true,
          });
        }
      }
    }

    // Replay buffered live events until both the first-message marker and the
    // first exact wake command have been durably recorded.
    if (!store.getFirstUserMessage(YUANQI_SUBJECT_ID) || !store.getWakeRecord(YUANQI_SUBJECT_ID)) {
      for (const item of startupBuffer) {
        await processCandidate(item.sessionId, item.event);
        if (store.getFirstUserMessage(YUANQI_SUBJECT_ID) && store.getWakeRecord(YUANQI_SUBJECT_ID)) break;
      }
    }
    startupBuffer.length = 0;
    ready = true;
    finishStartup();

    ctx.effect(() => async () => {
      active = false;
      const pending = [...pendingBySession.values()].flatMap(tasks => [...tasks]);
      const results = await Promise.allSettled(pending.map(entry => entry.promise));
      await Promise.allSettled([...pendingLocationTasks]);
      await domains.close();
      const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
      if (errors.length) throw new AggregateError(errors, 'YuanQi session writes failed during plugin teardown');
    });
  } catch (error) {
    try { failStartup?.(error); } catch {}
    try {
      await domains.close();
    } catch (closeError) {
      throw new AggregateError([error, closeError], 'YuanQi plugin initialization failed and Storage Domains could not both close cleanly');
    }
    throw error;
  }
}
