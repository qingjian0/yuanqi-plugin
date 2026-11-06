import test from 'node:test';
import assert from 'node:assert/strict';
import { userSubjectDomainSpec, yuanqiSubjectDomainSpec } from '../../src/domain/subject-domain.js';
test('DSH domains enforce separate subject ownership and data tables', () => {
  assert.equal(userSubjectDomainSpec.name, 'yuanqi_user_subject');
  assert.deepEqual(Object.keys(userSubjectDomainSpec.tables).sort(), ['birth_profiles', 'identities']);
  assert.equal(yuanqiSubjectDomainSpec.name, 'yuanqi_subject');
  assert.deepEqual(Object.keys(yuanqiSubjectDomainSpec.tables).sort(), ['identities', 'wake_records']);
});
