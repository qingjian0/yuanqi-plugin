import test from 'node:test';
import assert from 'node:assert/strict';
import { parseExplicitBirthProfile } from '../../src/domain/birth-profile-parser.js';

test('parses only explicitly labelled date, time and place facts', () => {
  const parsed = parseExplicitBirthProfile('出生日期：1998年4月21日10:31，出生地：云南昆明安宁');
  assert.deepEqual(parsed.facts, {
    birth_date: '1998-04-21',
    birth_time: '10:31',
    birth_place: '云南昆明安宁',
  });
  assert.equal(parsed.field_sources.birth_date.extraction_kind, 'user_explicit');
  assert.match(parsed.field_sources.birth_date.raw_text, /1998年4月21日/u);
  assert.equal(parsed.field_sources.birth_place.raw_text, '出生地：云南昆明安宁');
});

test('does not infer missing fields or accept ambiguous and invalid dates', () => {
  assert.deepEqual(parseExplicitBirthProfile('出生日期：1998年4月21日').facts, {
    birth_date: '1998-04-21',
  });
  assert.deepEqual(parseExplicitBirthProfile('出生地：云南昆明').facts, {
    birth_place: '云南昆明',
  });
  assert.equal(parseExplicitBirthProfile('我大概是1998年春天出生'), null);
  assert.equal(parseExplicitBirthProfile('出生日期：1998年2月30日'), null);
  assert.equal(parseExplicitBirthProfile('出生日期：1998年4月21日 出生时间：25:70'), null);
});
