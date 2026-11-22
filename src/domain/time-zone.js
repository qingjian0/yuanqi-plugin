import tzLookup from '@photostructure/tz-lookup';

const VALID_SOURCES = new Set(['host_location_provider', 'coordinate_lookup', 'default_beijing', 'unavailable']);
export const DEFAULT_BIRTH_TIME_ZONE = 'Asia/Shanghai';

function isIanaTimeZone(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the IANA zone from an explicit host result first, then from the
 * authorized wake-location coordinates using the bundled offline boundary map.
 */
export function resolveBirthTimeZone({
  time_zone_id,
  time_zone_source,
  latitude,
  longitude,
} = {}) {
  if (isIanaTimeZone(time_zone_id)) {
    const source = VALID_SOURCES.has(time_zone_source) && time_zone_source !== 'unavailable'
      ? time_zone_source : 'host_location_provider';
    return { time_zone_id, time_zone_source: source };
  }
  if (typeof latitude === 'number' && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
      typeof longitude === 'number' && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180) {
    try {
      const resolved = tzLookup(latitude, longitude);
      if (isIanaTimeZone(resolved)) {
        return { time_zone_id: resolved, time_zone_source: 'coordinate_lookup' };
      }
    } catch {
      // Fail closed: no IP, server-zone, or model-inferred fallback.
    }
  }
  return { time_zone_id: DEFAULT_BIRTH_TIME_ZONE, time_zone_source: 'default_beijing' };
}
