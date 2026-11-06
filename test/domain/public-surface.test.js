import test from 'node:test';
import assert from 'node:assert/strict';
import * as domain from '../../src/domain/index.js';
test('domain subpath exposes subject and Worldline repositories', () => {
  assert.equal(typeof domain.createSubjectStore, 'function');
  assert.equal(typeof domain.createWorldlineStore, 'function');
  assert.equal(typeof domain.openSubjectDomains, 'function');
  assert.equal(domain.userSubjectDomainSpec.name, 'yuanqi_user_subject');
  assert.equal(domain.yuanqiSubjectDomainSpec.name, 'yuanqi_subject');
});
