import test from 'node:test';
import assert from 'node:assert/strict';
import { createSubjectStore } from '../../src/domain/subject-store.js';

function memoryDomain(tableNames) {
  const tables = new Map(tableNames.map(name => [name, new Map()]));
  return {
    table(name) {
      const records = tables.get(name);
      if (!records) throw new Error('unknown table: ' + name);
      return {
        get(key) { return records.get(key); },
        async put(key, value) { records.set(key, structuredClone(value)); },
      };
    },
  };
}

function createStore() {
  const userDomain = memoryDomain(['identities', 'birth_profiles']);
  const yuanqiDomain = memoryDomain(['identities', 'wake_records']);
  return createSubjectStore({
    userDomain,
    yuanqiDomain,
    verifyDirectUserEvent(event) {
      return event?.trusted === true ? { ...event, verified: true } : null;
    },
    verifyBirthProfileConfirmation(event) {
      return event?.trusted === true && event?.explicit === true
        ? { ...event, verified: true }
        : null;
    },
  });
}

test('UserSubject and YuanQiSubject use separate identity namespaces', async () => {
  const store = createStore();
  await store.createUserSubject({ subject_id: 'same', created_from_event_ref: 'user-event' });
  await store.createYuanQiSubject({ subject_id: 'same', created_from_event_ref: 'yuanqi-event' });
  assert.equal(store.getUserSubject('same').subject_kind, 'user');
  assert.equal(store.getYuanQiSubject('same').subject_kind, 'yuanqi');
});

test('birth profile belongs only to an existing UserSubject and needs verified confirmation', async () => {
  const store = createStore();
  await store.createUserSubject({ subject_id: 'user-1', created_from_event_ref: 'user-event' });
  await assert.rejects(store.confirmUserBirthProfile({
    profile_id: 'birth-1',
    subject_id: 'user-1',
    facts: { birth_date: '1998-04-21' },
    confirmation_event: { trusted: true, explicit: false, event_id: 'unconfirmed' },
  }), /unverified/);
  const profile = await store.confirmUserBirthProfile({
    profile_id: 'birth-1',
    subject_id: 'user-1',
    facts: { birth_date: '1998-04-21' },
    confirmation_event: { trusted: true, explicit: true, event_id: 'confirmed' },
  });
  assert.equal(profile.subject_kind, 'user');
  assert.equal(profile.confirmation_event_ref, 'confirmed');
  await assert.rejects(store.confirmUserBirthProfile({
    profile_id: 'birth-2',
    subject_id: 'missing',
    facts: { birth_date: '2000-01-01' },
    confirmation_event: { trusted: true, explicit: true, event_id: 'confirmed' },
  }), /does not exist/);
});

test('wake requires the first direct user message and an exact startup command', async () => {
  const store = createStore();
  await store.createYuanQiSubject({ subject_id: 'yuanqi-1', created_from_event_ref: 'created' });
  const base = {
    trusted: true,
    is_first_conversation_user_message: true,
    event_id: 'wake-event',
    first_conversation_event_ref: 'first-event',
    occurred_at: '2026-11-06T12:00:00.000Z',
  };
  await assert.rejects(store.recordInitialWake({
    subject_id: 'yuanqi-1',
    direct_user_event: { ...base, text: '讨论启动元炁的设计' },
  }), /exactly/);
  await assert.rejects(store.recordInitialWake({
    subject_id: 'yuanqi-1',
    direct_user_event: { ...base, trusted: false, text: '启动元炁' },
  }), /unverified/);
  await assert.rejects(store.recordInitialWake({
    subject_id: 'yuanqi-1',
    direct_user_event: { ...base, is_first_conversation_user_message: false, text: '启动元炁' },
  }), /first conversation/);
});

test('wake is recorded once using the trusted DSH event timestamp', async () => {
  const store = createStore();
  await store.createYuanQiSubject({ subject_id: 'yuanqi-1', created_from_event_ref: 'created' });
  const event = {
    trusted: true,
    is_first_conversation_user_message: true,
    text: '启动元气',
    event_id: 'wake-event',
    first_conversation_event_ref: 'first-event',
    occurred_at: '2026-11-06T12:00:00.000Z',
  };
  const first = await store.recordInitialWake({ subject_id: 'yuanqi-1', direct_user_event: event });
  const again = await store.recordInitialWake({
    subject_id: 'yuanqi-1',
    direct_user_event: { ...event, event_id: 'later-event', occurred_at: '2026-11-07T12:00:00.000Z' },
  });
  assert.deepEqual(again, first);
  assert.equal(first.wake_event_ref, 'wake-event');
  assert.equal(first.occurred_at, '2026-11-06T12:00:00.000Z');
});
