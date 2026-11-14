const DATE_PATTERN = /(?:出生日期|生日|出生于)\s*[:：为]?\s*(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/u;
const TIME_PATTERN = /(?:出生时间|出生时刻|出生时|时间)\s*[:：为]?\s*(\d{1,2})[:：](\d{2})/u;
const PLACE_PATTERN = /(?:出生地点|出生地)\s*[:：为]?\s*([^，,。；;\n]+)/u;

function validDate(year, month, day) {
  const value = new Date(Date.UTC(year, month - 1, day));
  return value.getUTCFullYear() === year &&
    value.getUTCMonth() === month - 1 &&
    value.getUTCDate() === day;
}

/**
 * Extract only explicitly labelled birth facts from one trusted user's text.
 * No defaults, inferred values, current-time substitution, or geocoding.
 */
export function parseExplicitBirthProfile(text) {
  if (typeof text !== 'string' || text.length === 0) return null;
  const facts = {};
  const field_sources = {};
  const date = DATE_PATTERN.exec(text);
  if (date) {
    const year = Number(date[1]), month = Number(date[2]), day = Number(date[3]);
    if (!validDate(year, month, day)) return null;
    facts.birth_date = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    field_sources.birth_date = { raw_text: date[0], extraction_kind: 'user_explicit' };
    const suffix = text.slice(date.index + date[0].length);
    const time = /^(?:\s*[,，]?)\s*(\d{1,2})[:：](\d{2})/u.exec(suffix) ?? TIME_PATTERN.exec(text);
    if (time) {
      const hour = Number(time[1]), minute = Number(time[2]);
      if (hour > 23 || minute > 59) return null;
      facts.birth_time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
      field_sources.birth_time = { raw_text: time[0], extraction_kind: 'user_explicit' };
    }
  }
  const place = PLACE_PATTERN.exec(text);
  if (place) {
    const value = place[1].trim();
    if (value) {
      facts.birth_place = value;
      field_sources.birth_place = { raw_text: place[0], extraction_kind: 'user_explicit' };
    }
  }
  if (!Object.keys(facts).length) return null;
  return { facts, field_sources };
}
