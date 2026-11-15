import test from 'node:test';
import assert from 'node:assert/strict';
import { userSubjectDomainSpec, yuanqiSubjectDomainSpec } from '../../src/domain/subject-domain.js';
test('DSH domains enforce separate subject ownership and fenced Worldline state tables', () => {
  assert.equal(userSubjectDomainSpec.name, 'yuanqi_user_subject');
  assert.equal(userSubjectDomainSpec.version, 3);
  assert.deepEqual(userSubjectDomainSpec.compatibleVersions, [1, 2]);
  assert.deepEqual(Object.keys(userSubjectDomainSpec.tables).sort(), ['identities']);
  assert.equal(yuanqiSubjectDomainSpec.name, 'yuanqi_subject');
  assert.equal(yuanqiSubjectDomainSpec.version, 11);
  assert.deepEqual(yuanqiSubjectDomainSpec.compatibleVersions, [3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(Object.keys(yuanqiSubjectDomainSpec.tables).sort(), [
    'birth_profiles', 'installation_state', 'evidence_assessments', 'evidence_records', 'evidence_revocations', 'evidence_transfers', 'first_user_messages', 'transfer_authorization_revocations', 'transfer_authorizations', 'identities', 'session_worldline_bindings', 'wake_records',
    'worldline_events', 'worldline_heads', 'worldline_mainlines', 'worldline_snapshots', 'worldline_snapshot_archive_entries', 'worldline_snapshot_archive_manifests', 'worldlines',
  ].sort());
});
