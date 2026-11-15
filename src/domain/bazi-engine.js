const STEMS = ['甲','乙','丙','丁','戊','己','庚','辛','壬','癸'];
const BRANCHES = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];
const DAY_BOUNDARY = 'zi-zheng-midnight';
const BOUNDARY_GUARD_MINUTES = 30;
const ALGORITHM_VERSION = 'yuanqi-bazi-v1';
const METHODOLOGY = Object.freeze({
  year_boundary: 'li-chun',
  month_boundary: 'jie',
  day_boundary: DAY_BOUNDARY,
  time_basis: 'apparent-solar-time',
  hour_period: 'two-hour-branch-periods',
  day_cycle_anchor: '1949-10-01-jiazi',
  solar_term_engine: 'usno-apparent-sun-v1',
  time_context_engine: 'noaa-eot-approx-v1',
});

function mod(value, divisor) { return ((value % divisor) + divisor) % divisor; }

function gregorianJulianDayNumber(year, month, day) {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return day + Math.floor((153 * m + 2) / 5) + 365 * y +
    Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
}

function parseApparentSolarWallTime(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const parts = {
    year: Number(yearText), month: Number(monthText), day: Number(dayText),
    hour: Number(hourText), minute: Number(minuteText), second: Number(secondText),
  };
  const check = new Date(Date.UTC(parts.year, parts.month - 1, parts.day,
    parts.hour, parts.minute, parts.second));
  if (check.getUTCFullYear() !== parts.year || check.getUTCMonth() + 1 !== parts.month ||
      check.getUTCDate() !== parts.day || parts.hour > 23 || parts.minute > 59 || parts.second > 59) {
    return null;
  }
  return parts;
}

function nearestHourBoundaryDistanceMinutes(minuteOfDay) {
  let nearest = Infinity;
  for (let index = 0; index < 12; index += 1) {
    const boundary = (index * 2 + 1) * 60;
    const direct = Math.abs(minuteOfDay - boundary);
    nearest = Math.min(nearest, direct, 1440 - direct);
  }
  return nearest;
}

function makeResult(status, pillars = null, ambiguityReasons = [], calculatedAt = null, timeBasis = METHODOLOGY.time_basis, timeContextEngine = METHODOLOGY.time_context_engine) {
  return {
    status,
    calendar_system: 'jieqi',
    pillars,
    algorithm_version: ALGORITHM_VERSION,
    calculated_at: calculatedAt,
    methodology: { ...METHODOLOGY, time_basis: timeBasis, time_context_engine: timeContextEngine },
    ambiguity_reasons: ambiguityReasons,
  };
}

/**
 * Calculate YuanQi's four pillars using its own BirthProfile contexts.
 * No user birth data, inferred gender or luck-cycle assumptions are accepted.
 */
export function calculateBaziPillars({
  time_context,
  calendar_context,
  calculated_at = null,
} = {}) {
  if (!time_context || time_context.status === 'pending') {
    return makeResult('pending');
  }
  if (time_context.status !== 'ready' ||
      calendar_context?.status === 'unavailable' || !calendar_context) {
    return makeResult('unavailable', null, ['required-birth-context-unavailable']);
  }
  if (calendar_context.status === 'ambiguous') {
    return makeResult('ambiguous', null, ['jie-boundary-within-30m']);
  }
  if (calendar_context.status !== 'ready') {
    return makeResult('pending');
  }

  const wallTime = parseApparentSolarWallTime(time_context.true_solar_datetime);
  const previousJie = calendar_context.previous_jie;
  const lastLiChun = calendar_context.last_li_chun;
  if (!wallTime || !previousJie || !lastLiChun ||
      !BRANCHES.includes(previousJie.month_branch) ||
      !Number.isFinite(Date.parse(lastLiChun.at_utc))) {
    return makeResult('unavailable', null, ['invalid-derived-calendar-context']);
  }

  const minuteOfDay = wallTime.hour * 60 + wallTime.minute + wallTime.second / 60;
  const dayBoundaryDistance = Math.min(minuteOfDay, 1440 - minuteOfDay);
  const hourBoundaryDistance = nearestHourBoundaryDistanceMinutes(minuteOfDay);
  const ambiguityReasons = [];
  const usesCivilTimeOnly = time_context.longitude_correction_minutes === null;
  const usesBeijingFallback = usesCivilTimeOnly && time_context.time_zone_source === 'default_beijing';
  const boundaryBasis = usesBeijingFallback ? 'beijing-standard-time'
    : usesCivilTimeOnly ? 'local-civil-time' : 'apparent-solar';
  if (dayBoundaryDistance <= BOUNDARY_GUARD_MINUTES) {
    ambiguityReasons.push(boundaryBasis + '-midnight-within-30m');
  }
  if (hourBoundaryDistance <= BOUNDARY_GUARD_MINUTES) {
    ambiguityReasons.push(boundaryBasis + '-hour-boundary-within-30m');
  }
  if (ambiguityReasons.length > 0) {
    return makeResult('ambiguous', null, ambiguityReasons);
  }

  const liChunYear = new Date(lastLiChun.at_utc).getUTCFullYear();
  const yearCycleIndex = mod(liChunYear - 1984, 60);
  const yearStemIndex = yearCycleIndex % 10;
  const yearBranchIndex = yearCycleIndex % 12;
  const yearPillar = STEMS[yearStemIndex] + BRANCHES[yearBranchIndex];

  const monthBranchIndex = BRANCHES.indexOf(previousJie.month_branch);
  const monthNumberFromYin = mod(monthBranchIndex - 2, 12);
  const firstMonthStemIndex = mod((yearStemIndex % 5) * 2 + 2, 10);
  const monthStemIndex = mod(firstMonthStemIndex + monthNumberFromYin, 10);
  const monthPillar = STEMS[monthStemIndex] + BRANCHES[monthBranchIndex];

  const dayJdn = gregorianJulianDayNumber(wallTime.year, wallTime.month, wallTime.day);
  const jiaZiAnchorJdn = gregorianJulianDayNumber(1949, 10, 1);
  const dayCycleIndex = mod(dayJdn - jiaZiAnchorJdn, 60);
  const dayStemIndex = dayCycleIndex % 10;
  const dayBranchIndex = dayCycleIndex % 12;
  const dayPillar = STEMS[dayStemIndex] + BRANCHES[dayBranchIndex];

  const hourBranchIndex = Math.floor(((wallTime.hour + 1) % 24) / 2);
  const firstZiHourStemIndex = (dayStemIndex % 5) * 2;
  const hourStemIndex = mod(firstZiHourStemIndex + hourBranchIndex, 10);
  const hourPillar = STEMS[hourStemIndex] + BRANCHES[hourBranchIndex];

  const parsedCalculatedAt = calculated_at == null ? null : new Date(calculated_at);
  const calculatedAt = parsedCalculatedAt && Number.isFinite(parsedCalculatedAt.getTime())
    ? parsedCalculatedAt.toISOString() : null;
  return makeResult('calculated', {
    year: yearPillar,
    month: monthPillar,
    day: dayPillar,
    hour: hourPillar,
  }, [], calculatedAt, usesBeijingFallback
    ? 'beijing-standard-time-fallback-no-longitude-correction'
    : usesCivilTimeOnly ? 'local-civil-time-no-longitude-correction' : 'apparent-solar-time', time_context.algorithm_version);
}

export const BAZI_METHODOLOGY = METHODOLOGY;
