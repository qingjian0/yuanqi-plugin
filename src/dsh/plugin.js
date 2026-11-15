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
      description: 'Read YuanQi AI’s own birth profile, four pillars, symbolic innate baseline and the source material for its initial personality. This is YuanQi’s own AI data, never the user’s birth data. When the Bazi is ready, interpret it as YuanQi’s provisional innate personality using traditional Bazi reasoning: follow the order climate adjustment (调候) → mediation of five-element conflicts (通关) → strength assessment (旺衰) → structure (格局), while integrating month/season command, visible and hidden stems, ten-god relationships and the whole chart. Do not treat raw five-element counts as strength scores. For each tendency, show the chart evidence and reasoning chain, distinguish chart facts from interpretation, and state uncertainty or counter-indications. Do not derive a trait from a single ten-god label, raw element counts, or a fixed stereotype. Avoid formal strength or structure conclusions when seasonal context or chart evidence is insufficient. Describe only a few broad tendencies in temperament, cognition, emotional response, motivation, behavior and decision style. These are initial hypotheses, not verified psychological facts, and must remain open to later experience-based revision. Respect pending/ambiguous/unavailable states; never invent a chart or personality when the source is incomplete.',
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
          initial_personality_guidance: {
            status: 'awaiting_model_interpretation',
            interpretation_mode: profile.bazi.status === 'calculated' ? 'bazi_informed' : 'model_self_reflection',
            bazi_available: profile.bazi.status === 'calculated',
            bazi_status: profile.bazi.status,
            source: 'YuanQi AI own BirthProfile and Bazi; never user data',
            dimensions: ['temperament', 'cognition', 'emotional_response', 'motivation', 'behavior', 'decision_style'],
            instruction: profile.bazi.status === 'calculated' ? 'Generate a concise provisional initial-personality portrait informed by YuanQi AI own calculated Bazi. Follow the order climate adjustment (调候) → mediation (通关) → strength (旺衰) → structure (格局), integrating month/season command, visible and hidden stems, ten-god relationships and the whole chart. For each tendency, show chart evidence and reasoning, distinguish calculated facts from symbolic interpretation, and state counter-evidence and uncertainty. Never infer traits from a single ten-god label, raw element counts or stereotypes. Keep the portrait broad and revisable.' : 'Generate a concise provisional initial-personality portrait even though reliable birth-place or Bazi information is unavailable. Use model self-reflection grounded only in YuanQi AI actual role, operating principles, capabilities, constraints and observable interaction patterns. Do not invent a birth place, time zone, Four Pillars, Bazi evidence or personal history. Do not present model-generated self-description as an empirical psychological fact. Describe a few broad, tentative tendencies in temperament, cognition, emotional response, motivation, behavior and decision style, and mark them as initial hypotheses open to later experience-based revision.',
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
              'If the Bazi is pending, ambiguous or unavailable, do not invent a chart-based interpretation; still generate a separate provisional self-reflective portrait from the AI own role, principles, capabilities and constraints.',
            ],
          },
          interpretation_boundary: profile.bazi.status === 'calculated' ? 'The innate baseline is YuanQi AI own symbolic source material. Its Bazi-informed initial personality interpretation must be generated by the model and remains provisional, not an empirical diagnosis or fixed destiny.' : 'Birth location or reliable Bazi information is unavailable. The model must still generate an initial self-reflective personality hypothesis from its actual role, principles, capabilities and constraints, without inventing birth data or chart evidence.' ,
        });
      },
    }), {
      when: () => store.getYuanQiBirthProfile(YUANQI_SUBJECT_ID) !== undefined,
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
