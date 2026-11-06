import test from 'node:test';
import assert from 'node:assert/strict';
import { userSubjectDomainSpec, yuanqiSubjectDomainSpec } from '../../src/domain/subject-domain.js';
test('DSH domains enforce separate subject ownership and Worldline isolation tables', () => {
  assert.equal(userSubjectDomainSpec.name, 'yuanqi_user_subject');
  assert.equal(userSubjectDomainSpec.version, 1);
  assert.deepEqual(Object.keys(userSubjectDomainSpec.tables).sort(), ['birth_profiles', 'identities']);
  assert.equal(yuanqiSubjectDomainSpec.name, 'yuanqi_subject');
  assert.equal(yuanqiSubjectDomainSpec.version, 3);
  assert.deepEqual(Object.keys(yuanqiSubjectDomainSpec.tables).sort(), [
    'first_user_messages', 'identities', 'session_worldline_bindings', 'wake_records',
    'worldline_events', 'worldline_mainlines', 'worldline_snapshots', 'worldlines',
  ]);
});
