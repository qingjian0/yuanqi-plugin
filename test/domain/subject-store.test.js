import test from 'node:test';
import assert from 'node:assert/strict';
import { createSubjectStore } from '../../src/domain/subject-store.js';

function memoryDomain(names) {
  const maps = new Map(names.map(name => [name, new Map()]));
  return {
    maps,
    table(name) {
      const map = maps.get(name);
      if (!map) throw new Error('unknown table ' + name);
      return {
        get: key => map.get(key),
        async put(key, value) { map.set(key, structuredClone(value)); },
        async update(key, update) { map.set(key, structuredClone(update(map.get(key)))); },
      };
    },
  };
}
function makeStore() {
  const userDomain = memoryDomain(['identities']);
  const yuanqiDomain = memoryDomain(['identities', 'installation_state', 'first_user_messages', 'wake_records', 'birth_profiles']);
  const store = createSubjectStore({
    userDomain, yuanqiDomain,
    verifyDirectUserEvent: event => event?.trusted && event?.event_type === 'user/message' && event?.source_kind === 'user' ? event : null,
  });
  return { store, userDomain, yuanqiDomain };
}
const event = (overrides = {}) => ({
  trusted: true, event_type: 'user/message', source_kind: 'user', session_id: 's1',
  event_id: 'wake-1', event_seq: 0, event_time: 1793966400000, text: '启动元炁', ...overrides,
});

test('UserSubject and YuanQiSubject identity namespaces remain isolated', async () => {
  const { store } = makeStore();
  await store.createUserSubject({ subject_id: 'same', created_from_event_ref: 'user-event' });
  await store.createYuanQiSubject({ subject_id: 'same', created_from_event_ref: 'yuanqi-event' });
  assert.equal(store.getUserSubject('same').subject_kind, 'user');
  assert.equal(store.getYuanQiSubject('same').subject_kind, 'yuanqi');
});

test('YuanQi BirthProfile is derived from its own trusted wake event and stored under YuanQiSubject', async () => {
  const { store, userDomain, yuanqiDomain } = makeStore();
  await store.createYuanQiSubject({ subject_id: 'yuanqi:primary', created_from_event_ref: 'wake-1' });
  const wake = await store.recordInitialWake({ subject_id: 'yuanqi:primary', direct_user_event: event() });
  const profile = store.getYuanQiBirthProfile('yuanqi:primary');
  assert.equal(wake.birth_time, new Date(1793966400000).toISOString());
  assert.equal(profile.subject_kind, 'yuanqi');
  assert.equal(profile.birth_time, wake.birth_time);
  assert.equal(profile.source_wake_event_ref, 'wake-1');
  assert.equal(profile.bazi.status, 'pending');
  assert.equal(profile.bazi.calendar_system, 'jieqi');
  assert.equal(userDomain.maps.get('identities').has('user:primary'), false);
  assert.equal(yuanqiDomain.maps.get('birth_profiles').has('yuanqi:primary'), true);
});

test('YuanQi BirthProfile location follows the immutable wake location completion', async () => {
  const { store } = makeStore();
  await store.createYuanQiSubject({ subject_id: 'yuanqi:primary', created_from_event_ref: 'wake-1' });
  const pending = {
    status: 'pending', latitude: null, longitude: null, accuracy_meters: null,
    place_label: null, time_zone_id: null, source: 'unavailable', captured_at: null,
  };
  const wake = await store.recordInitialWake({
    subject_id: 'yuanqi:primary', direct_user_event: event(), birth_location: pending,
  });
  assert.equal(store.getYuanQiBirthProfile('yuanqi:primary').birth_location.status, 'pending');
  const captured = {
    status: 'captured', latitude: 31.23, longitude: 121.47, accuracy_meters: 15,
    place_label: 'Shanghai', time_zone_id: 'Asia/Shanghai', source: 'host_location_provider',
    captured_at: new Date(1793966400000).toISOString(),
  };
  await store.completeInitialWakeLocation({ subject_id: 'yuanqi:primary', birth_location: captured });
  assert.deepEqual(store.getYuanQiBirthProfile('yuanqi:primary').birth_location, captured);
  assert.equal(store.getYuanQiBirthProfile('yuanqi:primary').time_context.time_zone_id, 'Asia/Shanghai');
  assert.equal(store.getWakeRecord('yuanqi:primary').wake_event_ref, wake.wake_event_ref);
  await store.completeInitialWakeLocation({ subject_id: 'yuanqi:primary', birth_location: {
    status: 'unavailable', latitude: null, longitude: null, accuracy_meters: null,
    place_label: null, time_zone_id: null, source: 'unavailable', captured_at: null,
  }});
  assert.deepEqual(store.getYuanQiBirthProfile('yuanqi:primary').birth_location, captured);
});

test('no YuanQi BirthProfile is created before a trusted exact wake event', async () => {
  const { store } = makeStore();
  await store.createYuanQiSubject({ subject_id: 'yuanqi:primary', created_from_event_ref: 'first' });
  assert.equal(await store.recordInitialWake({ subject_id: 'yuanqi:primary', direct_user_event: event({ text: '你好' }) }), undefined);
  assert.equal(store.getYuanQiBirthProfile('yuanqi:primary'), undefined);
  assert.equal(store.getFirstUserMessage('yuanqi:primary').trigger_command, null);
});

test('wake recovery also creates the YuanQi-owned BirthProfile', async () => {
  const { store } = makeStore();
  await store.createYuanQiSubject({ subject_id: 'yuanqi:primary', created_from_event_ref: 'wake-1' });
  await store.recordFirstUserMessage({ subject_id: 'yuanqi:primary', direct_user_event: event() });
  const wake = await store.recoverInitialWake({ subject_id: 'yuanqi:primary' });
  await store.ensureYuanQiBirthProfile({ subject_id: 'yuanqi:primary' });
  assert.equal(store.getYuanQiBirthProfile('yuanqi:primary').source_wake_event_ref, wake.wake_event_ref);
});
