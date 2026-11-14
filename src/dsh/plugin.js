import { createSubjectStore } from '../domain/subject-store.js';
import { openSubjectDomains } from '../domain/subject-domain.js';
import { normalizeDirectUserMessageEvent } from './session-event.js';
import { createWorldlineStore } from '../worldline/runtime.js';

export const name = 'dsh-yuanqi-plugin';
// Session Query supplies validated live/cold observations; persistence is
// required because live SessionStore state alone cannot recover after restart.
export const inject = ['storageDomain', 'sessions', 'sessionQuery', 'sessionPersistence'];

const USER_SUBJECT_ID = 'user:primary';
const YUANQI_SUBJECT_ID = 'yuanqi:primary';

function candidateKey(candidate) {
  return candidate.session_id + '\u0000' + candidate.event_seq + '\u0000' + candidate.event_id;
}

function createAndroidLocationProvider() {
  const token = typeof process !== 'undefined' ? process.env?.DSH_BRIDGE_TOKEN : undefined;
  if (typeof token !== 'string' || token.length === 0) return null;
  return {
    async getCurrentPosition() {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2500);
      try {
        const response = await fetch('http://127.0.0.1:3083/dev/location', {
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
          captured_at: new Date(value.at - value.age_ms).toISOString(),
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
      verifyDirectUserEvent(event) { return event?.verified === true ? event : null; },
      verifyBirthProfileConfirmation() { return null; },
    });

    let active = true;
    let ready = false;
    let storageUncertain = false;
    const pendingBySession = new Map();
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
        return { status: 'unavailable', latitude: null, longitude: null, accuracy_meters: null, place_label: null, time_zone_id: null, source: 'unavailable', captured_at: null };
      }
      try {
        const value = await provider.getCurrentPosition();
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
        return {
          status: 'captured', latitude, longitude, accuracy_meters: accuracy,
          place_label: typeof value.place_label === 'string' ? value.place_label : null,
          time_zone_id: typeof value.time_zone_id === 'string' ? value.time_zone_id : null,
          source: value.source === 'android_location_bridge' ? 'android_location_bridge' : 'host_location_provider',
          captured_at: new Date(capturedAtMs).toISOString(),
        };
      } catch (error) {
        warn('[yuanqi] birth location unavailable at wake: ' + String(error));
        return { status: 'unavailable', latitude: null, longitude: null, accuracy_meters: null, place_label: null, time_zone_id: null, source: 'unavailable', captured_at: null };
      }
    }

    async function processCandidate(sessionId, event, { captureLocation = true } = {}) {
      if (!active || storageUncertain) return;
      const direct = normalizeDirectUserMessageEvent(sessionId, event);
      if (!direct) return;

      await store.createUserSubject({
        subject_id: USER_SUBJECT_ID,
        created_from_event_ref: direct.event_id,
      });
      await store.createYuanQiSubject({
        subject_id: YUANQI_SUBJECT_ID,
        created_from_event_ref: direct.event_id,
      });

      const isWakeCommand = direct.text === '启动元气' || direct.text === '启动元炁';
      const birthLocation = captureLocation && isWakeCommand &&
        !store.getWakeRecord(YUANQI_SUBJECT_ID)
        ? await captureBirthLocation(direct.event_time)
        : undefined;
      const wake = await store.recordInitialWake({
        subject_id: YUANQI_SUBJECT_ID,
        direct_user_event: direct,
        birth_location: birthLocation,
      });
      if (!wake) return;

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
      if (recoveredWake) await ensureWorldlineForWake(recoveredWake);
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
