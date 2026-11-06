import test from 'node:test';
import assert from 'node:assert/strict';
import * as entry from '../index.js';

test('package root imports and exposes only implemented subject-domain capabilities', () => {
  assert.equal(typeof entry.createSubjectStore, 'function');
  assert.equal(typeof entry.openSubjectDomains, 'function');
  assert.equal(entry.userSubjectDomainSpec.name, 'yuanqi_user_subject');
  assert.equal(entry.yuanqiSubjectDomainSpec.name, 'yuanqi_subject');
  assert.equal('mountYuanQiPlugin' in entry, false);
  assert.equal('createWorldlineRuntime' in entry, false);
});
