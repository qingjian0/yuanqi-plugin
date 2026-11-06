import test from 'node:test';
import assert from 'node:assert/strict';
import { createSubjectStore } from '../../src/domain/subject-store.js';
function memoryDomain(names) {
  const data = new Map(names.map(name => [name, new Map()]));
  return { table(name) { const rows = data.get(name); if (!rows) throw new Error('unknown table ' + name); return { get(key) { return rows.get(key); }, async put(key, value) { rows.set(key, structuredClone(value)); } }; } };
}
function setup() {
  const userDomain = memoryDomain(['identities', 'birth_profiles']);
  const yuanqiDomain = memoryDomain(['identities', 'wake_records']);
  return createSubjectStore({ userDomain, yuanqiDomain, verifyDirectUserEvent: e => e?.trusted ? { ...e, verified: true } : null, verifyBirthProfileConfirmation: e => e?.trusted && e?.explicit ? { ...e, verified: true } : null });
}
test('UserSubject and YuanQiSubject use separate identity namespaces', async () => {
  const s = setup(); await s.createUserSubject({ subject_id: 'same', created_from_event_ref: 'u' }); await s.createYuanQiSubject({ subject_id: 'same', created_from_event_ref: 'y' });
  assert.equal(s.getUserSubject('same').subject_kind, 'user'); assert.equal(s.getYuanQiSubject('same').subject_kind, 'yuanqi');
});
test('birth profile belongs only to an existing UserSubject and needs verified confirmation', async () => {
  const s = setup(); await s.createUserSubject({ subject_id: 'u1', created_from_event_ref: 'u-event' });
  await assert.rejects(s.confirmUserBirthProfile({ profile_id: 'bp', subject_id: 'u1', facts: { birth_date: '1998-04-21' }, confirmation_event: { trusted: true, explicit: false, event_id: 'no' } }), /unverified/);
  const p = await s.confirmUserBirthProfile({ profile_id: 'bp', subject_id: 'u1', facts: { birth_date: '1998-04-21' }, confirmation_event: { trusted: true, explicit: true, event_id: 'yes' } });
  assert.equal(p.subject_kind, 'user'); assert.equal(p.confirmation_event_ref, 'yes');
  await assert.rejects(s.confirmUserBirthProfile({ profile_id: 'bp2', subject_id: 'missing', facts: { birth_date: '2000-01-01' }, confirmation_event: { trusted: true, explicit: true, event_id: 'yes' } }), /does not exist/);
});
test('wake requires the first direct user message and an exact startup command', async () => {
  const s = setup(); await s.createYuanQiSubject({ subject_id: 'y1', created_from_event_ref: 'create' });
  const b = { trusted: true, is_first_conversation_user_message: true, event_id: 'wake', first_conversation_event_ref: 'first', occurred_at: '2026-11-06T12:00:00.000Z' };
  await assert.rejects(s.recordInitialWake({ subject_id: 'y1', direct_user_event: { ...b, text: '讨论启动元炁的设计' } }), /exactly/);
  await assert.rejects(s.recordInitialWake({ subject_id: 'y1', direct_user_event: { ...b, trusted: false, text: '启动元炁' } }), /unverified/);
  await assert.rejects(s.recordInitialWake({ subject_id: 'y1', direct_user_event: { ...b, is_first_conversation_user_message: false, text: '启动元炁' } }), /first conversation/);
});
test('wake is recorded once using the trusted DSH event timestamp', async () => {
  const s = setup(); await s.createYuanQiSubject({ subject_id: 'y1', created_from_event_ref: 'create' });
  const e = { trusted: true, is_first_conversation_user_message: true, text: '启动元气', event_id: 'wake', first_conversation_event_ref: 'first', occurred_at: '2026-11-06T12:00:00.000Z' };
  const first = await s.recordInitialWake({ subject_id: 'y1', direct_user_event: e });
  const again = await s.recordInitialWake({ subject_id: 'y1', direct_user_event: { ...e, event_id: 'later', occurred_at: '2026-11-07T12:00:00.000Z' } });
  assert.deepEqual(again, first); assert.equal(first.wake_event_ref, 'wake'); assert.equal(first.occurred_at, '2026-11-06T12:00:00.000Z');
});
