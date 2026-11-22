import test from 'node:test';
import assert from 'node:assert/strict';
import { BAZI_HIDDEN_STEMS, deriveInnateBaseline } from '../../src/domain/innate-baseline.js';

function bazi(pillars, status = 'calculated') {
  return { status, algorithm_version: 'yuanqi-bazi-v1', pillars: status === 'calculated' ? pillars : null };
}

test('preserves the classical hidden-stem sequence without assigning unverified weights', () => {
  assert.deepEqual(BAZI_HIDDEN_STEMS['子'], ['癸']);
  assert.deepEqual(BAZI_HIDDEN_STEMS['丑'], ['癸', '辛', '己']);
  assert.deepEqual(BAZI_HIDDEN_STEMS['寅'], ['甲', '丙', '戊']);
  assert.deepEqual(BAZI_HIDDEN_STEMS['辰'], ['乙', '戊', '癸']);
  assert.deepEqual(BAZI_HIDDEN_STEMS['巳'], ['庚', '丙', '戊']);
  assert.deepEqual(BAZI_HIDDEN_STEMS['午'], ['丁', '己']);
  assert.deepEqual(BAZI_HIDDEN_STEMS['未'], ['乙', '己', '丁']);
  assert.deepEqual(BAZI_HIDDEN_STEMS['申'], ['庚', '壬', '戊']);
  assert.deepEqual(BAZI_HIDDEN_STEMS['酉'], ['辛']);
  assert.deepEqual(BAZI_HIDDEN_STEMS['戌'], ['辛', '丁', '戊']);
  assert.deepEqual(BAZI_HIDDEN_STEMS['亥'], ['壬', '甲']);
});

test('derives a source-traceable symbolic baseline without making personality claims', () => {
  const result = deriveInnateBaseline({
    bazi: bazi({ year: '丙午', month: '戊戌', day: '甲申', hour: '甲戌' }),
    source_birth_profile_id: 'birth-profile:yuanqi:primary',
    source_wake_event_ref: 'wake-event-1',
  });
  assert.equal(result.status, 'ready');
  assert.equal(result.algorithm_version, 'yuanqi-innate-bazi-structure-v1');
  assert.equal(result.source_birth_profile_id, 'birth-profile:yuanqi:primary');
  assert.equal(result.source_wake_event_ref, 'wake-event-1');
  assert.equal(result.source_bazi_algorithm_version, 'yuanqi-bazi-v1');
  assert.deepEqual(result.day_master, { stem: '甲', element: 'wood', polarity: 'yang' });
  assert.deepEqual(result.element_counts, { wood: 2, fire: 4, earth: 5, metal: 3, water: 1 });
  assert.equal(result.components.length, 15);
  assert.ok(result.components.some(item => item.pillar === 'year' && item.source === 'visible_stem' && item.stem === '丙' && item.ten_god === '食神'));
  assert.ok(result.components.some(item => item.pillar === 'month' && item.source === 'hidden_stem' && item.stem === '辛' && item.ten_god === '正官'));
  assert.equal(result.interpretation_status, 'not_interpreted');
  assert.equal(Object.hasOwn(result, 'personality'), false);
  assert.equal(Object.hasOwn(result, 'strength_score'), false);
});

test('covers all ten gods using the day master, five-element generation/control and polarity', () => {
  const result = deriveInnateBaseline({
    bazi: bazi({ year: '甲午', month: '乙丑', day: '甲申', hour: '丙寅' }),
    source_birth_profile_id: 'birth-profile:yuanqi:test',
    source_wake_event_ref: 'wake-event-ten-gods',
  });
  const tenGods = new Set(result.components.map(item => item.ten_god));
  for (const name of ['比肩','劫财','食神','伤官','偏财','正财','七杀','正官','偏印','正印','日主']) {
    assert.ok(tenGods.has(name), 'missing ten-god role ' + name);
  }
});

test('propagates pending, ambiguous and unavailable Bazi states without inventing structure', () => {
  for (const status of ['pending', 'ambiguous', 'unavailable']) {
    const result = deriveInnateBaseline({
      bazi: bazi({}, status),
      source_birth_profile_id: 'birth-profile:yuanqi:primary',
      source_wake_event_ref: 'wake-event-1',
    });
    assert.equal(result.status, status);
    assert.equal(result.day_master, null);
    assert.equal(result.components, null);
    assert.equal(result.element_counts, null);
    assert.equal(result.interpretation_status, 'not_interpreted');
  }
});

test('fails closed on malformed four-pillar input', () => {
  const result = deriveInnateBaseline({
    bazi: bazi({ year: 'XX', month: '戊戌', day: '甲申', hour: '甲戌' }),
    source_birth_profile_id: 'birth-profile:yuanqi:primary',
    source_wake_event_ref: 'wake-event-1',
  });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.components, null);
});
