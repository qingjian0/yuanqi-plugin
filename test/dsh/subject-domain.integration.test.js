import test from 'node:test';
import assert from 'node:assert/strict';
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain';
import { StorageError } from '@deepseek-ai/dsh-storage';
import { openSubjectDomains, userSubjectDomainSpec, yuanqiSubjectDomainSpec } from '../../src/domain/subject-domain.js';
import { createSubjectStore } from '../../src/domain/subject-store.js';

function createStorageDomain() {
  const persisted = new Map();
  const opened = new Set();
  const context = {
    storage: {
      backend: {
        get(name) {
          assert.equal(name, 'yuanqi-test-memory');
          return {
            kv: {
              async open(descriptor) {
                if (opened.has(descriptor.name)) throw new StorageError('malformed-medium', 'Domain already open');
                opened.add(descriptor.name);
                let state = persisted.get(descriptor.name);
                if (!state) {
                  state = { tables: Object.fromEntries(descriptor.tables.map(table => [table, {}])), global: null };
                  persisted.set(descriptor.name, state);
                }
                let closed = false;
                const assertOpen = () => { if (closed) throw new StorageError('closed', 'Domain is closed'); };
                return {
                  async loadAll() { assertOpen(); return structuredClone(state); },
                  async putRecord(table, key, value) { assertOpen(); state.tables[table] ??= {}; state.tables[table][key] = structuredClone(value); },
                  async deleteRecord(table, key) { assertOpen(); delete state.tables[table]?.[key]; },
                  async deleteRecords(table, keys) { assertOpen(); for (const key of keys) delete state.tables[table]?.[key]; },
                  async setGlobal(value) { assertOpen(); state.global = structuredClone(value); },
                  async close() { if (!closed) { closed = true; opened.delete(descriptor.name); } },
                };
              },
            },
          };
        },
      },
    },
    emit() {},
    logger: { warn() {}, error() {} },
  };
  const facility = new DomainFacility(context, { backend: 'yuanqi-test-memory', routes: {} });
  return { open: spec => facility.open(spec), persisted, opened };
}

test('actual DSH DomainFacility opens both YuanQi subject schemas, validates records and reopens durable rows', async () => {
  const storageDomain = createStorageDomain();
  assert.equal(userSubjectDomainSpec.version, 2);
  assert.deepEqual(userSubjectDomainSpec.compatibleVersions, [1]);
  assert.equal(yuanqiSubjectDomainSpec.version, 10);
  assert.deepEqual(yuanqiSubjectDomainSpec.compatibleVersions, [3, 4, 5, 6, 7, 8, 9]);

  const first = await openSubjectDomains(storageDomain);
  await first.userDomain.table('identities').put('user:primary', {
    subject_id: 'user:primary', subject_kind: 'user', identity_version: 1,
    status: 'active', created_from_event_ref: 'event:user-1',
  });
  await first.yuanqiDomain.table('identities').put('yuanqi:primary', {
    subject_id: 'yuanqi:primary', subject_kind: 'yuanqi', identity_version: 1,
    status: 'active', created_from_event_ref: 'event:yuanqi-1',
  });
  await first.yuanqiDomain.table('installation_state').put('installation:primary', {
    installation_id: 'installation:primary', activated_at_ms: 1794048000000, schema_version: 1,
  });
  await Promise.all([
    first.userDomain.table('identities').update('user:primary', value => ({ ...value, identity_version: 2 })),
    first.yuanqiDomain.table('first_user_messages').put('yuanqi:primary', {
      subject_id: 'yuanqi:primary', subject_kind: 'yuanqi', first_session_id: 'session:first',
      first_event_id: 'event:first', first_event_seq: 0, first_event_time: 1794048000100,
      source_kind: 'user', event_type: 'user/message', trigger_command: '启动元炁', schema_version: 1,
    }),
  ]);
  assert.equal(storageDomain.opened.size, 2);
  await first.close();
  assert.equal(storageDomain.opened.size, 0);

  const reopened = await openSubjectDomains(storageDomain);
  assert.equal(reopened.userDomain.table('identities').get('user:primary').identity_version, 2);
  assert.equal(reopened.yuanqiDomain.table('identities').get('yuanqi:primary').subject_kind, 'yuanqi');
  assert.equal(reopened.yuanqiDomain.table('installation_state').get('installation:primary').activated_at_ms, 1794048000000);
  assert.equal(reopened.yuanqiDomain.table('first_user_messages').get('yuanqi:primary').trigger_command, '启动元炁');
  assert.equal(reopened.userDomain.table('identities').get('yuanqi:primary'), undefined);
  assert.equal(reopened.yuanqiDomain.table('identities').get('user:primary'), undefined);
  await reopened.close();
  assert.equal(storageDomain.opened.size, 0);
});

test('actual DSH DomainFacility rejects malformed persisted YuanQi activation boundary on reopen', async () => {
  const storageDomain = createStorageDomain();
  const domains = await openSubjectDomains(storageDomain);
  // DSH validates records during DomainFacility.open(), not during KvTable.put().
  await domains.yuanqiDomain.table('installation_state').put('installation:primary', {
    installation_id: 'installation:primary', activated_at_ms: -1, schema_version: 1,
  });
  await domains.close();
  await assert.rejects(openSubjectDomains(storageDomain));
  assert.equal(storageDomain.opened.size, 0);
});


test('actual DSH DomainFacility persists and restores YuanQi-owned BirthProfile', async () => {
  const storageDomain = createStorageDomain();
  const domains = await openSubjectDomains(storageDomain);
  const store = createSubjectStore({
    userDomain: domains.userDomain, yuanqiDomain: domains.yuanqiDomain,
    verifyDirectUserEvent: event => event?.verified === true ? event : null,
  });
  await store.createYuanQiSubject({ subject_id: 'yuanqi:primary', created_from_event_ref: 'wake-event-1' });
  const eventTime = 1794048000100;
  await store.recordInitialWake({
    subject_id: 'yuanqi:primary',
    direct_user_event: {
      verified: true, event_type: 'user/message', source_kind: 'user',
      session_id: 'birth-session', event_id: 'wake-event-1', event_seq: 0,
      event_time: eventTime, text: '启动元炁',
    },
  });
  const profile = store.getYuanQiBirthProfile('yuanqi:primary');
  assert.equal(profile.subject_kind, 'yuanqi');
  assert.equal(profile.birth_time, new Date(eventTime).toISOString());
  assert.equal(profile.source_wake_event_ref, 'wake-event-1');
  assert.equal(profile.bazi.status, 'pending');
  await domains.close();

  const reopened = await openSubjectDomains(storageDomain);
  const restored = createSubjectStore({
    userDomain: reopened.userDomain, yuanqiDomain: reopened.yuanqiDomain,
    verifyDirectUserEvent: event => event?.verified === true ? event : null,
  });
  assert.deepEqual(restored.getYuanQiBirthProfile('yuanqi:primary'), profile);
  await reopened.close();
});

test('actual DSH DomainFacility atomically completes a pending WakeRecord location', async () => {
  const storageDomain = createStorageDomain();
  const domains = await openSubjectDomains(storageDomain);
  const store = createSubjectStore({
    userDomain: domains.userDomain,
    yuanqiDomain: domains.yuanqiDomain,
    verifyDirectUserEvent: event => event?.verified === true ? event : null,
  });
  await store.createYuanQiSubject({ subject_id: 'yuanqi:primary', created_from_event_ref: 'wake-event-1' });
  const eventTime = 1794048000100;
  const pending = {
    status: 'pending', latitude: null, longitude: null, accuracy_meters: null,
    place_label: null, time_zone_id: null, source: 'unavailable', captured_at: null,
  };
  await store.recordInitialWake({
    subject_id: 'yuanqi:primary',
    direct_user_event: {
      verified: true, event_type: 'user/message', source_kind: 'user',
      session_id: 'session:wake', event_id: 'wake-event-1', event_seq: 0,
      event_time: eventTime, text: '启动元炁',
    },
    birth_location: pending,
  });
  const captured = {
    status: 'captured', latitude: 31.23, longitude: 121.47, accuracy_meters: 12,
    place_label: null, time_zone_id: null, source: 'android_location_bridge',
    captured_at: new Date(eventTime).toISOString(),
  };
  await store.completeInitialWakeLocation({ subject_id: 'yuanqi:primary', birth_location: captured });
  assert.deepEqual(store.getWakeRecord('yuanqi:primary').birth_location, captured);
  assert.deepEqual(store.getYuanQiBirthProfile('yuanqi:primary').birth_location, captured);
  await domains.close();
});
