const DAY_MS = 86400000;
const MEAN_SUN_RATE_DEG_PER_DAY = 0.98564736;
const BOUNDARY_UNCERTAINTY_SECONDS = 1500;
const ENGINE_VERSION = 'usno-apparent-sun-v1';

const TERMS = [
  { longitude: 0, name: '春分', kind: 'zhongqi' },
  { longitude: 15, name: '清明', kind: 'jie', month_branch: '辰' },
  { longitude: 30, name: '谷雨', kind: 'zhongqi' },
  { longitude: 45, name: '立夏', kind: 'jie', month_branch: '巳' },
  { longitude: 60, name: '小满', kind: 'zhongqi' },
  { longitude: 75, name: '芒种', kind: 'jie', month_branch: '午' },
  { longitude: 90, name: '夏至', kind: 'zhongqi' },
  { longitude: 105, name: '小暑', kind: 'jie', month_branch: '未' },
  { longitude: 120, name: '大暑', kind: 'zhongqi' },
  { longitude: 135, name: '立秋', kind: 'jie', month_branch: '申' },
  { longitude: 150, name: '处暑', kind: 'zhongqi' },
  { longitude: 165, name: '白露', kind: 'jie', month_branch: '酉' },
  { longitude: 180, name: '秋分', kind: 'zhongqi' },
  { longitude: 195, name: '寒露', kind: 'jie', month_branch: '戌' },
  { longitude: 210, name: '霜降', kind: 'zhongqi' },
  { longitude: 225, name: '立冬', kind: 'jie', month_branch: '亥' },
  { longitude: 240, name: '小雪', kind: 'zhongqi' },
  { longitude: 255, name: '大雪', kind: 'jie', month_branch: '子' },
  { longitude: 270, name: '冬至', kind: 'zhongqi' },
  { longitude: 285, name: '小寒', kind: 'jie', month_branch: '丑' },
  { longitude: 300, name: '大寒', kind: 'zhongqi' },
  { longitude: 315, name: '立春', kind: 'jie', month_branch: '寅' },
  { longitude: 330, name: '雨水', kind: 'zhongqi' },
  { longitude: 345, name: '惊蛰', kind: 'jie', month_branch: '卯' },
];
const JIE_TERMS = TERMS.filter(term => term.kind === 'jie');

function mod(value, divisor) { return ((value % divisor) + divisor) % divisor; }
function forwardDegrees(from, to) { return mod(to - from, 360); }

export function apparentSunLongitudeDegrees(instant) {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (!Number.isFinite(date.getTime())) throw new TypeError('instant must be a valid date');
  const year = date.getUTCFullYear();
  if (year < 1800 || year > 2200) throw new RangeError('USNO approximate solar longitude is supported only for 1800–2200');
  const julianDay = date.getTime() / DAY_MS + 2440587.5;
  const daysSinceJ2000 = julianDay - 2451545.0;
  const meanAnomaly = mod(357.529 + 0.98560028 * daysSinceJ2000, 360);
  const meanLongitude = 280.459 + 0.98564736 * daysSinceJ2000;
  const radians = Math.PI / 180;
  const apparentLongitude = meanLongitude +
    1.915 * Math.sin(meanAnomaly * radians) +
    0.020 * Math.sin(2 * meanAnomaly * radians);
  return mod(apparentLongitude, 360);
}

function crossingInstant(targetLongitude, guessMs) {
  // The target crossing is within a few minutes of the mean-motion estimate.
  // A +/- 3 day bracket spans more than 5 degrees of solar motion.
  let lowMs = guessMs - 3 * DAY_MS;
  let highMs = guessMs + 3 * DAY_MS;
  const lowLongitude = apparentSunLongitudeDegrees(new Date(lowMs));
  const targetProgress = forwardDegrees(lowLongitude, targetLongitude);
  const highProgress = forwardDegrees(
    lowLongitude,
    apparentSunLongitudeDegrees(new Date(highMs)),
  );
  if (targetProgress > highProgress + 1e-7) {
    throw new Error('solar longitude crossing could not be bracketed');
  }
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const middleMs = (lowMs + highMs) / 2;
    const progress = forwardDegrees(
      lowLongitude,
      apparentSunLongitudeDegrees(new Date(middleMs)),
    );
    if (progress < targetProgress) lowMs = middleMs;
    else highMs = middleMs;
  }
  return new Date((lowMs + highMs) / 2);
}

function termAt(term, instant, direction, currentLongitude) {
  const distance = direction < 0
    ? forwardDegrees(term.longitude, currentLongitude)
    : forwardDegrees(currentLongitude, term.longitude);
  const guessMs = instant.getTime() + direction * distance / MEAN_SUN_RATE_DEG_PER_DAY * DAY_MS;
  const at = crossingInstant(term.longitude, guessMs);
  return {
    name: term.name,
    longitude_deg: term.longitude,
    kind: term.kind,
    month_branch: term.month_branch ?? null,
    at_utc: at.toISOString(),
  };
}

function unavailableContext() {
  return {
    status: 'unavailable',
    engine_version: ENGINE_VERSION,
    calculation_basis: 'apparent-geocentric-ecliptic-longitude',
    sun_apparent_longitude_deg: null,
    boundary_uncertainty_seconds: BOUNDARY_UNCERTAINTY_SECONDS,
    boundary_distance_seconds: null,
    previous_term: null,
    next_term: null,
    previous_jie: null,
    next_jie: null,
    last_li_chun: null,
  };
}

/**
 * Locate the surrounding 15-degree solar terms for YuanQi's own UTC birth
 * instant. This uses the USNO compact apparent geocentric solar-longitude
 * approximation; births close to a term are marked ambiguous.
 */
export function deriveSolarTermContext({ birth_time } = {}) {
  if (typeof birth_time !== 'string' || !Number.isFinite(Date.parse(birth_time))) {
    throw new TypeError('birth_time must be a valid ISO timestamp');
  }
  const instant = new Date(birth_time);
  const year = instant.getUTCFullYear();
  if (year < 1801 || year > 2199) return unavailableContext();

  const longitude = apparentSunLongitudeDegrees(instant);
  const previousAngle = Math.floor(longitude / 15) * 15;
  const nextAngle = mod(previousAngle + 15, 360);
  const previousTerm = TERMS.find(term => term.longitude === previousAngle);
  const nextTerm = TERMS.find(term => term.longitude === nextAngle);
  const previousJieDefinition = JIE_TERMS.reduce((best, term) =>
    forwardDegrees(term.longitude, longitude) < forwardDegrees(best.longitude, longitude) ? term : best,
  );
  const nextJieDefinition = JIE_TERMS.reduce((best, term) =>
    forwardDegrees(longitude, term.longitude) < forwardDegrees(longitude, best.longitude) ? term : best,
  );
  const liChunDefinition = TERMS.find(term => term.name === '立春');

  const previous = termAt(previousTerm, instant, -1, longitude);
  const next = termAt(nextTerm, instant, 1, longitude);
  const previousJie = termAt(previousJieDefinition, instant, -1, longitude);
  const nextJie = termAt(nextJieDefinition, instant, 1, longitude);
  const lastLiChun = termAt(liChunDefinition, instant, -1, longitude);

  const previousDistance = (instant.getTime() - Date.parse(previous.at_utc)) / 1000;
  const nextDistance = (Date.parse(next.at_utc) - instant.getTime()) / 1000;
  const boundaryDistance = Math.min(previousDistance, nextDistance);
  return {
    status: boundaryDistance <= BOUNDARY_UNCERTAINTY_SECONDS ? 'ambiguous' : 'ready',
    engine_version: ENGINE_VERSION,
    calculation_basis: 'apparent-geocentric-ecliptic-longitude',
    sun_apparent_longitude_deg: Number(longitude.toFixed(8)),
    boundary_uncertainty_seconds: BOUNDARY_UNCERTAINTY_SECONDS,
    boundary_distance_seconds: Number(boundaryDistance.toFixed(3)),
    previous_term: previous,
    next_term: next,
    previous_jie: previousJie,
    next_jie: nextJie,
    last_li_chun: lastLiChun,
  };
}

export const SOLAR_TERMS = Object.freeze(TERMS.map(term => Object.freeze({ ...term })));
