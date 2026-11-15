const FORMATTER_CACHE = new Map();

function finiteNumber(value, field, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new TypeError(field + ' must be a finite number in [' + min + ', ' + max + ']');
  }
  return value;
}

function formatterFor(timeZone) {
  let formatter = FORMATTER_CACHE.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone, calendar: 'gregory', numberingSystem: 'latn',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23',
    });
    // Force IANA time-zone validation now rather than silently falling back.
    formatter.format(new Date(0));
    FORMATTER_CACHE.set(timeZone, formatter);
  }
  return formatter;
}

function localParts(formatter, instant) {
  const values = Object.fromEntries(formatter.formatToParts(instant)
    .filter(part => part.type !== 'literal')
    .map(part => [part.type, Number(part.value)]));
  return {
    year: values.year, month: values.month, day: values.day,
    hour: values.hour, minute: values.minute, second: values.second,
  };
}

function pad(value, width = 2) { return String(value).padStart(width, '0'); }
function formatLocal(parts) {
  return parts.year + '-' + pad(parts.month) + '-' + pad(parts.day) +
    'T' + pad(parts.hour) + ':' + pad(parts.minute) + ':' + pad(parts.second);
}

function offsetMinutesAt(formatter, instant, parts) {
  // Intl formats the same instant as wall-clock components in the target zone.
  // Comparing those components as UTC yields the offset, including DST.
  const wallAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day,
    parts.hour, parts.minute, parts.second);
  return Math.round((wallAsUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

function equationOfTimeMinutes(instant) {
  // NOAA fractional-year approximation. This is an approximation, not a
  // high-precision ephemeris and must not be used to claim boundary accuracy.
  const yearStart = Date.UTC(instant.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((Date.UTC(
    instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate(),
  ) - yearStart) / 86400000) + 1;
  const utcHour = instant.getUTCHours() + instant.getUTCMinutes() / 60 +
    instant.getUTCSeconds() / 3600 + instant.getUTCMilliseconds() / 3600000;
  const year = instant.getUTCFullYear();
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInYear = leapYear ? 366 : 365;
  const gamma = (2 * Math.PI / daysInYear) * (dayOfYear - 1 + (utcHour - 12) / 24);
  return 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) -
    0.032077 * Math.sin(gamma) - 0.014615 * Math.cos(2 * gamma) -
    0.040849 * Math.sin(2 * gamma));
}

function addWallMinutes(parts, minutes) {
  const base = Date.UTC(parts.year, parts.month - 1, parts.day,
    parts.hour, parts.minute, parts.second);
  const shifted = new Date(base + minutes * 60000);
  return {
    year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(), hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(), second: shifted.getUTCSeconds(),
  };
}

/**
 * Derive local civil time and approximate apparent solar time for YuanQi's
 * own WakeRecord instant. No user birth data or inferred location is accepted.
 *
 * The IANA time zone must come from the authorized host location result.
 * True-solar time is a NOAA equation-of-time approximation; solar-term and
 * Four-Pillars calculations are deliberately outside this function.
 */
export function deriveBirthTimeContext({ birth_time, birth_location } = {}) {
  if (typeof birth_time !== 'string' || !Number.isFinite(Date.parse(birth_time))) {
    throw new TypeError('birth_time must be a valid ISO timestamp');
  }
  const instant = new Date(birth_time);
  const location = birth_location ?? {};
  if (location.status === 'pending') {
    return {
      status: 'pending', time_zone_id: null, time_zone_source: 'unavailable', local_datetime: null,
      utc_offset_minutes: null, longitude_correction_minutes: null,
      equation_of_time_minutes: null, true_solar_datetime: null, time_basis: null,
      algorithm_version: 'noaa-eot-approx-v1',
    };
  }

  const suppliedZone = typeof location.time_zone_id === 'string' ? location.time_zone_id : null;
  let timeZone = suppliedZone;
  let formatter;
  let timeZoneSource = ['host_location_provider', 'coordinate_lookup'].includes(location.time_zone_source)
    ? location.time_zone_source : 'host_location_provider';
  if (!timeZone) {
    timeZone = 'Asia/Shanghai';
    timeZoneSource = 'default_beijing';
  }
  try {
    formatter = formatterFor(timeZone);
  } catch {
    timeZone = 'Asia/Shanghai';
    timeZoneSource = 'default_beijing';
    formatter = formatterFor(timeZone);
  }

  const parts = localParts(formatter, instant);
  const utcOffset = offsetMinutesAt(formatter, instant, parts);
  const hasLongitude = location.status === 'captured' &&
    typeof location.longitude === 'number' && Number.isFinite(location.longitude);
  if (hasLongitude) finiteNumber(location.longitude, 'birth_location.longitude', -180, 180);

  if (!hasLongitude) {
    return {
      status: 'ready',
      time_zone_id: timeZone,
      time_zone_source: timeZoneSource,
      local_datetime: formatLocal(parts),
      utc_offset_minutes: utcOffset,
      longitude_correction_minutes: null,
      equation_of_time_minutes: null,
      true_solar_datetime: formatLocal(parts),
      time_basis: 'beijing-standard-time-fallback',
      algorithm_version: 'civil-time-only-v1',
    };
  }

  const longitudeCorrection = location.longitude * 4;
  const equationOfTime = equationOfTimeMinutes(instant);
  const trueSolarParts = addWallMinutes(parts,
    longitudeCorrection - utcOffset + equationOfTime);
  return {
    status: 'ready',
    time_zone_id: timeZone,
    time_zone_source: timeZoneSource,
    local_datetime: formatLocal(parts),
    utc_offset_minutes: utcOffset,
    longitude_correction_minutes: Number(longitudeCorrection.toFixed(6)),
    equation_of_time_minutes: Number(equationOfTime.toFixed(6)),
    true_solar_datetime: formatLocal(trueSolarParts),
    time_basis: 'apparent-solar-time',
    algorithm_version: 'noaa-eot-approx-v1',
  };
}
