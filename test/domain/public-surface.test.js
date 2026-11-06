import test from 'node:test';
import assert from 'node:assert/strict';
import * as domain from '../../src/domain/index.js';
test('domain subpath exposes subject, Worldline and SelfModel contracts', () => {
  assert.equal(typeof domain.createSubjectStore, 'function');
  assert.equal(typeof domain.createWorldlineStore, 'function');
  assert.deepEqual(domain.SELF_MODEL_CENTER_IDS, [
    'identity_continuity','experience_memory','cognition_reflection','emotion_appraisal','goals_agency',
  ]);
  assert.equal(typeof domain.openSubjectDomains, 'function');
  assert.equal(domain.userSubjectDomainSpec.name, 'yuanqi_user_subject');
  assert.equal(domain.yuanqiSubjectDomainSpec.name, 'yuanqi_subject');
});
