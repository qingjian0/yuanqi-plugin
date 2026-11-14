import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveSolarTermContext, SOLAR_TERMS } from '../../src/domain/solar-terms.js';

test('defines all 24 solar terms as twelve Jie and twelve Zhongqi at 15-degree intervals', () => {
  assert.equal(SOLAR_TERMS.length, 24);
  assert.equal(SOLAR_TERMS.filter(term => term.kind === 'jie').length, 12);
  assert.equal(SOLAR_TERMS.filter(term => term.kind === 'zhongqi').length, 12);
  assert.deepEqual(
    SOLAR_TERMS.filter(term => term.kind === 'jie').map(term => [term.name, term.longitude, term.month_branch]),
    [
      ['清明', 15, '辰'], ['立夏', 45, '巳'], ['芒种', 75, '午'],
      ['小暑', 105, '未'], ['立秋', 135, '申'], ['白露', 165, '酉'],
      ['寒露', 195, '戌'], ['立冬', 225, '亥'], ['大雪', 255, '子'],
      ['小寒', 285, '丑'], ['立春', 315, '寅'], ['惊蛰', 345, '卯'],
    ],
  );
});

test('locates 2026 equinoxes and solstices within the declared USNO approximation uncertainty', () => {
  const referenceEvents = [
    ['2026-03-20T14:46:00.000Z', 0],
    ['2026-06-21T08:24:00.000Z', 90],
    ['2026-09-23T00:05:00.000Z', 180],
    ['2026-12-21T20:50:00.000Z', 270],
  ];
  for (const [referenceTime, longitude] of referenceEvents) {
    const context = deriveSolarTermContext({ birth_time: referenceTime });
    const candidates = [context.previous_term, context.next_term];
    const term = candidates.find(candidate => candidate.longitude_deg === longitude);
    assert.ok(term, 'expected solar longitude ' + longitude);
    const difference = Math.abs(Date.parse(term.at_utc) - Date.parse(referenceTime));
    assert.ok(difference <= 25 * 60 * 1000, longitude + '° crossing outside 25-minute uncertainty');
    assert.equal(context.status, 'ambiguous');
  }
});

test('uses Li Chun as the Bazi year boundary and identifies the surrounding Jie', () => {
  const before = deriveSolarTermContext({ birth_time: '2026-02-03T19:00:00.000Z' });
  const after = deriveSolarTermContext({ birth_time: '2026-02-03T20:30:00.000Z' });
  assert.equal(before.status, 'ready');
  assert.equal(before.previous_jie.name, '小寒');
  assert.equal(before.next_jie.name, '立春');
  assert.equal(new Date(before.last_li_chun.at_utc).getUTCFullYear(), 2025);
  assert.equal(after.status, 'ready');
  assert.equal(after.previous_jie.name, '立春');
  assert.equal(after.next_jie.name, '惊蛰');
  assert.equal(new Date(after.last_li_chun.at_utc).getUTCFullYear(), 2026);
});

test('marks birth instants inside the conservative solar-term boundary window ambiguous', () => {
  const context = deriveSolarTermContext({ birth_time: '2026-02-03T20:05:00.000Z' });
  assert.equal(context.status, 'ambiguous');
  assert.equal(context.previous_jie.name, '立春');
  assert.ok(context.boundary_distance_seconds < context.boundary_uncertainty_seconds);
  assert.equal(context.boundary_uncertainty_seconds, 1800);
});

test('does not claim solar-term calculations outside the documented 1800–2200 ephemeris range', () => {
  const context = deriveSolarTermContext({ birth_time: '2300-01-01T00:00:00.000Z' });
  assert.equal(context.status, 'unavailable');
  assert.equal(context.previous_term, null);
});

test('rejects invalid birth timestamps', () => {
  assert.throws(() => deriveSolarTermContext({ birth_time: 'not-a-date' }), /ISO timestamp/);
});
