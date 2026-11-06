import test from 'node:test';
import assert from 'node:assert/strict';
import * as entry from '../index.js';
test('package root exposes implemented Cordis, subject and Worldline capabilities', () => {
  assert.equal(typeof entry.apply, 'function');
  assert.equal(entry.name, 'dsh-yuanqi-plugin');
  assert.deepEqual(entry.inject, ['storageDomain', 'sessions']);
  assert.equal(typeof entry.createSubjectStore, 'function');
  assert.equal(typeof entry.createWorldlineStore, 'function');
  assert.equal(typeof entry.openSubjectDomains, 'function');
  assert.equal(entry.userSubjectDomainSpec.name, 'yuanqi_user_subject');
  assert.equal(entry.yuanqiSubjectDomainSpec.name, 'yuanqi_subject');
  assert.equal('mountYuanQiPlugin' in entry, false);
  assert.equal('createWorldlineRuntime' in entry, false);
});
