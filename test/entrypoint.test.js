import test from 'node:test';
import assert from 'node:assert/strict';
import * as entry from '../index.js';
test('package root exposes implemented Cordis, subject, Worldline and SelfModel capabilities', () => {
  assert.equal(typeof entry.apply, 'function');
  assert.equal(entry.name, 'dsh-yuanqi-plugin');
  assert.deepEqual(entry.inject, ['storageDomain', 'sessions', 'sessionQuery', 'sessionPersistence']);
  assert.equal(typeof entry.createSubjectStore, 'function');
  assert.equal(typeof entry.createWorldlineStore, 'function');
  assert.deepEqual(entry.SELF_MODEL_CENTER_IDS, [
    'identity_continuity','experience_memory','cognition_reflection','emotion_appraisal','goals_agency',
  ]);
  assert.equal(typeof entry.openSubjectDomains, 'function');
  assert.equal(entry.userSubjectDomainSpec.name, 'yuanqi_user_subject');
  assert.equal(entry.yuanqiSubjectDomainSpec.name, 'yuanqi_subject');
  assert.equal('mountYuanQiPlugin' in entry, false);
  assert.equal('createWorldlineRuntime' in entry, false);
});
