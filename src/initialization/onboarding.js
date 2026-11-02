const REQUIRED_BIRTH_FIELDS = [
  'birthDate', 'birthTime', 'birthplaceText', 'timeZoneId',
  'latitude', 'longitude', 'timePrecision'
];

function isPresent(value) {
  return value !== undefined && value !== null && value !== '';
}

function validateDraft(draft) {
  if (isPresent(draft.latitude) && (!Number.isFinite(draft.latitude) || Math.abs(draft.latitude) > 90)) {
    throw new RangeError('latitude must be within [-90, 90]');
  }
  if (isPresent(draft.longitude) && (!Number.isFinite(draft.longitude) || Math.abs(draft.longitude) > 180)) {
    throw new RangeError('longitude must be within [-180, 180]');
  }
  if (isPresent(draft.timePrecision) && !['second', 'minute', 'hour', 'approximate', 'unknown'].includes(draft.timePrecision)) {
    throw new TypeError('unsupported timePrecision');
  }
}

/** Starts or resumes the conversational onboarding state machine. */
export function beginInitialization({ existingState, now = new Date() } = {}) {
  const startedAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  if (existingState?.status === 'ready' || existingState?.status === 'confirmed') {
    return { action: 'resume', state: existingState };
  }
  if (existingState && ['collecting_birth_data', 'awaiting_confirmation'].includes(existingState.status)) {
    return { action: 'resume', state: existingState };
  }
  const state = {
    schemaVersion: 1,
    status: 'collecting_birth_data',
    initializationStartedAt: startedAt,
    birthProfileDraft: {},
    missingFields: [...REQUIRED_BIRTH_FIELDS]
  };
  return { action: 'started', state };
}

/** Applies user-provided/confirmed lookup data; it never fills birth facts from now/device/IP. */
export function updateBirthProfileDraft(state, patch) {
  if (!state || state.status !== 'collecting_birth_data') {
    throw new Error('birth data can only be updated while collecting_birth_data');
  }
  const allowed = new Set(REQUIRED_BIRTH_FIELDS.concat(['altitudeMeters', 'placeSource', 'coordinatePrecisionDegrees']));
  for (const key of Object.keys(patch ?? {})) {
    if (!allowed.has(key)) throw new TypeError(`unsupported birth profile field: ${key}`);
  }
  const birthProfileDraft = { ...state.birthProfileDraft, ...patch };
  validateDraft(birthProfileDraft);
  const missingFields = REQUIRED_BIRTH_FIELDS.filter(field => !isPresent(birthProfileDraft[field]));
  return {
    ...state,
    birthProfileDraft,
    missingFields,
    status: missingFields.length === 0 ? 'awaiting_confirmation' : 'collecting_birth_data'
  };
}

/** Explicit user confirmation is required before a final BirthProfile may be created. */
export function confirmBirthProfile(state, { confirmed } = {}) {
  if (!state || state.status !== 'awaiting_confirmation') {
    throw new Error('birth profile is not ready for confirmation');
  }
  if (confirmed !== true) {
    return { ...state, status: 'collecting_birth_data', confirmationRejected: true };
  }
  return { ...state, status: 'confirmed', birthProfileConfirmedAt: new Date().toISOString() };
}
