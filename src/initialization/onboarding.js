const EMPTY_LOCATION = Object.freeze({
  status: 'pending',
  latitude: null,
  longitude: null,
  accuracyMeters: null,
  placeLabel: null,
  timeZoneId: null,
  source: null,
  capturedAt: null,
});

/**
 * Creates YuanQi's own first-run record. No personal birth facts are requested:
 * the timestamp is the trusted initialization/wake event and location is
 * acquired by the host provider, with IP geolocation as a coarse fallback.
 */
export function beginInitialization({ existingState, now = new Date() } = {}) {
  const startedAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  if (existingState?.status === 'ready') {
    return { action: 'resume', state: existingState };
  }
  const state = {
    schemaVersion: 2,
    status: 'collecting_environment',
    initializationStartedAt: startedAt,
    yuanqiBirthTime: startedAt,
    birthLocation: { ...EMPTY_LOCATION },
    locationStrategy: ['host_location_provider', 'ip_geolocation'],
    missingFields: [],
  };
  return { action: existingState ? 'resumed' : 'started', state };
}

/** Completes the automatic environment capture; missing location never blocks initialization. */
export function completeInitializationLocation(state, location) {
  if (!state || !['collecting_environment', 'location_pending'].includes(state.status)) {
    throw new Error('environment capture is not pending');
  }
  if (!location || !['captured', 'unavailable'].includes(location.status)) {
    throw new TypeError('location result must be captured or unavailable');
  }
  return {
    ...state,
    status: 'ready',
    birthLocation: { ...EMPTY_LOCATION, ...location },
    completedAt: new Date().toISOString(),
    missingFields: [],
  };
}
