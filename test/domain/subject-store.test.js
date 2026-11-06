import test from 'node:test';
import assert from 'node:assert/strict';
import { createSubjectStore } from '../../src/domain/subject-store.js';

function memoryDomain(names) {
  const data = new Map(names.map(name => [name, new Map()]));
  return { table(name) {
    const rows = data.get(name); if (!rows) throw new Error('unknown table ' + name);
    return { get(key) { return rows.get(key); }, async put(key, value) { rows.set(key, structuredClone(value)); } };
  } };
}

function setup() {
  const userDomain = memoryDomain(['identities', 'birth-profiles']);
  const yuanqiDomain = memoryDomain(['identities', 'wake-records']);
  const store = createSubjectStore({
    userDomain, yuanqiDomain,
    verifyDirectUserEvent: event => event?.trusted ? { ...event, verified: true } : null,
    verifyBirthProfileConfirmation: event => event?.trusted && event?.explicit ? { ...event, verified: true } : null,
  });
  return store;
}

test('UserSubject and YuanQiSubject use separate identity namespaces', async () => {
  const store = setup();
  await store.createUserSubject({ subject_id: 'same', created_from_event_ref: 'user-event' });
  await store.createYuanQiSubject({ subject_id: 'same', created_from_event_ref: 'yuanqi-event' });
  assert.equal(store.getUserSubject('same').subject_kind, 'user');
  assert.equal(store.getYuanQiSubject('same').subject_kind, 'yuanqi');
});

test('birth profile belongs only to an existing UserSubject and needs verified confirmation', async () => {
  const store = setup();
  await store.createUserSubject({ subject_id: 'user-1', created_from_event_ref: 'user-event' });
  await assert.rejects(store.confirmUserBirthProfile({ profile_id: 'bp', subject_id: 'user-1', facts: { birth_date: '1998-04-21' }, confirmation_event: { trusted: true, explicit: false, event_id: 'no' } }), /unverified/);
  const profile = await store.confirmUserBirthProfile({ profile_id: 'bp', subject_id: 'user-1', facts: { birth_date: '1998-04-21' }, confirmation_event: { trusted: true, explicit: true, event_id: 'confirmed-event' } });
  assert.equal(profile.subject_kind, 'user');
  assert.equal(profile.confirmation_event_ref, 'confirmed-event');
  await assert.rejects(store.confirmUserBirthProfile({ profile_id: 'bp2', subject_id: 'missing', facts: { birth_date: '2000-01-01' }, confirmation_event: { trusted: true, explicit: true, event_id: 'confirmed-event' } }), /does not exist/);
});

test('wake requires the first direct user message and an exact startup command', async () => {
  const store = setup();
  await store.createYuanQiSubject({ subject_id: 'yq-1', created_from_event_ref: 'created' });
  const base = { trusted: true, is_first_conversation_user_message: true, event_id: 'wake-event', first_conversation_event_ref: 'first-event', occurred_at: '2026-11-06T12:00:00.000Z' };
  await assert.rejects(store.recordInitialWake({ subject_id: 'yq-1', direct_user_event: { ...base, text: '讨论启动元炁的设计' } }), /exactly/);
  await assert.rejects(store.recordInitialWake({ subject_id: 'yq-1', direct_user_event: { ...base, trusted: false, text: '启动元炁' } }), /unverified/);
  await assert.rejects(store.recordInitialWake({ subject_id: 'yq-1', direct_user_event: { ...base, is_first_conversation_user_message: false, text: '启动元炁' } }), /first conversation/);
});

test('wake is recorded once and uses the trusted DSH event timestamp', async () => {
  const store = setup();
  await store.createYuanQiSubject({ subject_id: 'yq-1', created_from_event_ref: 'created' });
  const event = { trusted: true, is_first_conversation_user_message: true, text: '启动元气', event_id: 'wake-event', first_conversation_event_ref: 'first-event', occurred_at: '2026-11-06T12:00:00.000Z' };
  const first = await store.recordInitialWake({ subject_id: 'yq-1', direct_user_event: event });
  const again = await store.recordInitialWake({ subject_id: 'yq-1', direct_user_event: { ...event, event_id: 'later-event', occurred_at: '2026-11-07T12:00:00.000Z' } });
  assert.deepEqual(again, first);
  assert.equal(first.wake_event_ref, 'wake-event');
  assert.equal(first.occurred_at, '2026-11-06T12:00:00.000Z');
});
