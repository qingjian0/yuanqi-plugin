import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateBaziPillars } from '../../src/domain/bazi-engine.js';

function calendarContext({ year = 1999, monthBranch = '丑', status = 'ready' } = {}) {
  return {
    status,
    last_li_chun: { name: '立春', at_utc: year + '-02-04T00:00:00.000Z' },
    previous_jie: { name: '小寒', month_branch: monthBranch, at_utc: year + '-01-05T00:00:00.000Z' },
  };
}
function timeContext(solarTime, timeBasis = 'apparent-solar-time') {
  return { status: 'ready', true_solar_datetime: solarTime, longitude_correction_minutes: timeBasis === 'beijing-standard-time-fallback' ? null : 485.8948, algorithm_version: timeBasis === 'beijing-standard-time-fallback' ? 'civil-time-only-v1' : 'noaa-eot-approx-v1', time_zone_source: timeBasis === 'beijing-standard-time-fallback' ? 'default_beijing' : 'host_location_provider' };
}

test('calculates a reference chart from the 1949-10-01 Jiazi day-cycle anchor', () => {
  const result = calculateBaziPillars({
    time_context: timeContext('2000-01-07T12:00:00'),
    calendar_context: calendarContext({ year: 1999, monthBranch: '丑' }),
    calculated_at: '2026-11-15T00:00:00.000Z',
  });
  assert.equal(result.status, 'calculated');
  assert.deepEqual(result.pillars, { year: '己卯', month: '丁丑', day: '甲子', hour: '庚午' });
  assert.equal(result.algorithm_version, 'yuanqi-bazi-v1');
  assert.equal(result.calculated_at, '2026-11-15T00:00:00.000Z');
  assert.equal(result.methodology.day_boundary, 'zi-zheng-midnight');
});

test('uses Li Chun for year and Jie for month, with the five-tiger month-stem rule', () => {
  const result = calculateBaziPillars({
    time_context: timeContext('2026-11-06T20:22:18'),
    calendar_context: calendarContext({ year: 2026, monthBranch: '戌' }),
  });
  assert.equal(result.pillars.year, '丙午');
  assert.equal(result.pillars.month, '戊戌');
  assert.equal(result.pillars.day, '甲申');
  assert.equal(result.pillars.hour, '甲戌');
});

test('implements all five-tiger month-stem starts across the ten year stems', () => {
  const expected = ['丙','戊','庚','壬','甲','丙','戊','庚','壬','甲'];
  for (let yearStem = 0; yearStem < 10; yearStem += 1) {
    const result = calculateBaziPillars({
      time_context: timeContext('2001-07-15T12:00:00'),
      calendar_context: calendarContext({ year: 1984 + yearStem, monthBranch: '寅' }),
    });
    assert.equal(result.pillars.month, expected[yearStem] + '寅');
  }
});

test('implements all five-rat hour-stem starts across the ten day stems', () => {
  const expected = ['庚','壬','甲','丙','戊','庚','壬','甲','丙','戊'];
  for (let dayStem = 0; dayStem < 10; dayStem += 1) {
    const date = new Date(Date.UTC(1949, 9, 1 + dayStem));
    const solarDate = date.toISOString().slice(0, 10) + 'T12:00:00';
    const result = calculateBaziPillars({
      time_context: timeContext(solarDate),
      calendar_context: calendarContext({ year: 1984, monthBranch: '寅' }),
    });
    assert.equal(result.pillars.hour, expected[dayStem] + '午');
  }
});

test('uses Zi-Zheng midnight as the day change while retaining Zi hour from 23:00 to 01:00', () => {
  const beforeMidnight = calculateBaziPillars({
    time_context: timeContext('2000-01-06T22:15:00'),
    calendar_context: calendarContext({ year: 1999, monthBranch: '丑' }),
  });
  const afterMidnight = calculateBaziPillars({
    time_context: timeContext('2000-01-07T01:45:00'),
    calendar_context: calendarContext({ year: 1999, monthBranch: '丑' }),
  });
  assert.equal(beforeMidnight.pillars.day, '癸亥');
  assert.equal(beforeMidnight.pillars.hour, '癸亥');
  assert.equal(afterMidnight.pillars.day, '甲子');
  assert.equal(afterMidnight.pillars.hour, '乙丑');
});

test('marks apparent-solar midnight and double-hour transitions ambiguous', () => {
  const ziStart = calculateBaziPillars({
    time_context: timeContext('2000-01-06T23:30:00'),
    calendar_context: calendarContext({ year: 1999, monthBranch: '丑' }),
  });
  const midnight = calculateBaziPillars({
    time_context: timeContext('2000-01-07T00:30:00'),
    calendar_context: calendarContext({ year: 1999, monthBranch: '丑' }),
  });
  assert.equal(ziStart.status, 'ambiguous');
  assert.ok(ziStart.ambiguity_reasons.includes('apparent-solar-midnight-within-30m'));
  assert.ok(ziStart.ambiguity_reasons.includes('apparent-solar-hour-boundary-within-30m'));
  assert.equal(midnight.status, 'ambiguous');
  assert.equal(ziStart.pillars, null);
});

test('does not calculate pillars for pending, unavailable or solar-term-ambiguous inputs', () => {
  const calendar = calendarContext();
  assert.equal(calculateBaziPillars({ time_context: { status: 'pending' }, calendar_context: calendar }).status, 'pending');
  assert.equal(calculateBaziPillars({ time_context: { status: 'unavailable' }, calendar_context: calendar }).status, 'unavailable');
  assert.equal(calculateBaziPillars({ time_context: timeContext('2000-01-07T12:00:00'), calendar_context: calendarContext({ status: 'ambiguous' }) }).status, 'ambiguous');
});


test('records Beijing standard-time fallback explicitly when no longitude is available', () => {
  const result = calculateBaziPillars({
    time_context: timeContext('2000-01-07T12:00:00', 'beijing-standard-time-fallback'),
    calendar_context: calendarContext({ year: 1999, monthBranch: '丑' }),
  });
  assert.equal(result.status, 'calculated');
  assert.equal(result.methodology.time_basis, 'beijing-standard-time-fallback-no-longitude-correction');
  assert.equal(result.methodology.time_context_engine, 'civil-time-only-v1');
  assert.deepEqual(result.pillars, { year: '己卯', month: '丁丑', day: '甲子', hour: '庚午' });
});
