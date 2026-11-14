import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../../src/dsh/plugin.js';

function fakeStorageDomain() {
  const opened = new Map();
  const persisted = new Map();
  const storage = {
    opened,
    failWorldlineWrite: false,
    failWorldlineWrites: 0,
    failWorldlineUnknownState: false,
    worldlineWriteAttempts: 0,
    failWorldlineTableBinding: false,
    async open(spec) {
      let tables = persisted.get(spec.name);
      if (!tables) {
        tables = new Map(Object.keys(spec.tables).map(name => [name, new Map()]));
        persisted.set(spec.name, tables);
      }
      const domain = {
        table(name) {
          const rows = tables.get(name);
          if (spec.name === 'yuanqi_subject' && name === 'worldlines' && storage.failWorldlineTableBinding) {
            throw new Error('simulated table binding failure: ' + spec.name + '/' + name);
          }
          if (!rows) throw new Error('unknown table: ' + name);
          return {
            get: key => rows.get(key),
            async put(key, value) {
              if (spec.name === 'yuanqi_subject' && name === 'worldlines') {
                storage.worldlineWriteAttempts += 1;
                if (storage.failWorldlineUnknownState) {
                  throw Object.assign(new Error('simulated unknown durable state'), { code: 'unknown-state' });
                }
              }
              if (spec.name === 'yuanqi_subject' && name === 'worldlines' &&
                  (storage.failWorldlineWrite || storage.failWorldlineWrites > 0)) {
                storage.failWorldlineWrite = false;
                if (storage.failWorldlineWrites > 0) storage.failWorldlineWrites -= 1;
                throw new Error('simulated interruption before Worldline record');
              }
              rows.set(key, structuredClone(value));
            },
          };
        },
        async close() { domain.closed = true; },
        closed: false,
      };
      opened.set(spec.name, { domain, tables });
      return domain;
    },
  };
  return storage;
}
function dshEvent(text, id, seq, time) {
  return { type: 'user/message', seq, time, data: { id, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] } };
}
function context(storageDomain, options = {}) {
  let listener, flushListener, disposer;
  const warnings = [];
  return {
    storageDomain,
    yuanqiLocationProvider: options.yuanqiLocationProvider,
    sessionPersistence: options.sessionPersistence ?? {
      identity: Symbol('test-session-persistence'),
      async list() { return []; },
      async stat() { return undefined; },
      async open() { throw new Error('unexpected persisted Session open'); },
    },
    sessionQuery: options.sessionQuery ?? { async listSessions() { return []; }, async observeSession() { throw new Error('unexpected Session observation'); } },
    warnings,
    logger: { warn(message) { warnings.push(message); } },
    on(name, callback) { if (name === 'session/event') listener = callback; else if (name === 'session/flush') flushListener = callback; else throw new Error('unexpected event ' + name); },
    effect(register) { disposer = register(); },
    get listener() { return listener; },
    get flushListener() { return flushListener; },
    get disposer() { return disposer; },
  };
}

test('plugin startup rejects an incomplete SessionPersistence provider before opening Domains', async () => {
  const invalidProviders = [
    { async list() { return []; } },
    { identity: Symbol('missing-stat'), async list() { return []; }, async open() {} },
    { identity: Symbol('missing-open'), async list() { return []; }, async stat() { return undefined; } },
    { identity: 'not-a-symbol', async list() { return []; }, async stat() { return undefined; }, async open() {} },
  ];

  for (const sessionPersistence of invalidProviders) {
    const storage = fakeStorageDomain();
    await assert.rejects(
      apply(context(storage, { sessionPersistence })),
      /sessionPersistence service with identity, list\(\), stat\(\), and open\(\)/,
    );
    assert.equal(storage.opened.size, 0);
  }
});

test('first exact startup command wakes even after an earlier ordinary message in another Session', async () => {
  const storage = fakeStorageDomain(), ctx = context(storage);
  await apply(ctx);
  await ctx.listener({ id: 'session-a' }, dshEvent('你好', 'm1', 0, 1793966400000));
  await ctx.flushListener({ id: 'session-a' });
  await ctx.listener({ id: 'session-b' }, dshEvent('启动元炁', 'm2', 0, 1794052800000));
  await ctx.flushListener({ id: 'session-b' });
  const tables = storage.opened.get('yuanqi_subject').tables;
  assert.equal(tables.get('first_user_messages').get('yuanqi:primary').first_event_id, 'm1');
  assert.equal(tables.get('first_user_messages').get('yuanqi:primary').trigger_command, null);
  assert.equal(tables.get('wake_records').get('yuanqi:primary').wake_event_ref, 'm2');
  assert.equal(tables.get('wake_records').get('yuanqi:primary').first_session_id, 'session-b');
  assert.equal(tables.get('worldlines').get('worldline:main').status, 'active');
  assert.equal(tables.get('session_worldline_bindings').has('session-a'), false);
  assert.equal(tables.get('session_worldline_bindings').get('session-b').worldline_id, 'worldline:main');
  await ctx.disposer();
  assert.equal(storage.opened.get('yuanqi_subject').domain.closed, true);
  assert.equal(storage.opened.get('yuanqi_user_subject').domain.closed, true);
});
test('whitespace-wrapped command in the first message does not wake YuanQi', async () => {
  const storage = fakeStorageDomain(), ctx = context(storage);
  await apply(ctx);
  await ctx.listener({ id: 'session-a' }, dshEvent(' 启动元炁 ', 'm1', 0, 1793966400000));
  await ctx.flushListener({ id: 'session-a' });
  const tables = storage.opened.get('yuanqi_subject').tables;
  assert.equal(tables.get('first_user_messages').get('yuanqi:primary').trigger_command, null);
  assert.equal(tables.get('wake_records').has('yuanqi:primary'), false);
  assert.equal(tables.get('worldlines').has('worldline:main'), false);
  await ctx.disposer();
});
test('Cordis plugin wakes only from an exact direct user command', async () => {
  const storage = fakeStorageDomain(), ctx = context(storage);
  await apply(ctx);
  await ctx.listener({ id: 'session-a' }, dshEvent('启动元炁', 'm1', 0, 1793966400000));
  await ctx.flushListener({ id: 'session-a' });
  const wake = storage.opened.get('yuanqi_subject').tables.get('wake_records').get('yuanqi:primary');
  assert.equal(wake.wake_event_ref, 'm1');
  assert.equal(wake.first_session_id, 'session-a');
  assert.equal(wake.occurred_at, new Date(1793966400000).toISOString());
  assert.equal(storage.opened.get('yuanqi_subject').tables.get('session_worldline_bindings').get('session-a').worldline_id, 'worldline:main');
  await ctx.disposer();
});
test('startup reconciliation completes Worldline creation after an interrupted wake', async () => {
  const storage = fakeStorageDomain();
  storage.failWorldlineWrite = true;
  const first = context(storage);
  await apply(first);
  await assert.rejects(first.listener({ id: 'session-a' }, dshEvent('启动元炁', 'm1', 0, 1793966400000)), /simulated interruption/);
  await assert.rejects(first.disposer(), /YuanQi session writes failed during plugin teardown/);

  const restarted = context(storage);
  await apply(restarted);
  const tables = storage.opened.get('yuanqi_subject').tables;
  assert.equal(tables.get('wake_records').get('yuanqi:primary').wake_event_ref, 'm1');
  assert.equal(tables.get('worldlines').get('worldline:main').status, 'active');
  assert.equal(tables.get('session_worldline_bindings').get('session-a').worldline_id, 'worldline:main');
  await restarted.disposer();
});

test('session/flush retries a failed domain write before acknowledging the checkpoint', async () => {
  const storage = fakeStorageDomain();
  storage.failWorldlineWrite = true;
  const ctx = context(storage);
  await apply(ctx);

  await assert.rejects(
    ctx.listener({ id: 'session-a' }, dshEvent('启动元炁', 'm1', 0, 1793966400000)),
    /simulated interruption before Worldline record/,
  );

  // The failed event task must remain visible to the next flush. Its retry
  // resumes from the persisted wake record and completes the Worldline.
  await ctx.flushListener({ id: 'session-a' });
  const tables = storage.opened.get('yuanqi_subject').tables;
  assert.equal(tables.get('wake_records').get('yuanqi:primary').wake_event_ref, 'm1');
  assert.equal(tables.get('worldlines').get('worldline:main').status, 'active');
  assert.equal(
    tables.get('session_worldline_bindings').get('session-a').worldline_id,
    'worldline:main',
  );
  assert.equal(ctx.warnings.length, 1);
  await ctx.disposer();
});

test('persistent session write failure is reported by flush and remains retryable', async () => {
  const storage = fakeStorageDomain();
  storage.failWorldlineWrites = 2;
  const ctx = context(storage);
  await apply(ctx);

  await assert.rejects(
    ctx.listener({ id: 'session-a' }, dshEvent('启动元炁', 'm1', 0, 1793966400000)),
    /simulated interruption before Worldline record/,
  );
  await assert.rejects(
    ctx.flushListener({ id: 'session-a' }),
    /YuanQi session writes failed after flush retry/,
  );

  const tables = storage.opened.get('yuanqi_subject').tables;
  assert.equal(tables.get('worldlines').has('worldline:main'), false);
  assert.equal(ctx.warnings.length, 2);

  // The failed entry remains pending; a later flush retries it again.
  await ctx.flushListener({ id: 'session-a' });
  assert.equal(tables.get('worldlines').get('worldline:main').status, 'active');
  await ctx.disposer();
});

test('unknown-state fails closed and never retries through the quarantined Domain', async () => {
  const storage = fakeStorageDomain();
  storage.failWorldlineUnknownState = true;
  const ctx = context(storage);
  await apply(ctx);

  await assert.rejects(
    ctx.listener({ id: 'session-a' }, dshEvent('启动元炁', 'm1', 0, 1793966400000)),
    /simulated unknown durable state/,
  );
  await assert.rejects(
    ctx.flushListener({ id: 'session-a' }),
    /Storage Domain state is unknown/,
  );

  // Once DSH reports unknown durable state, no later event may use this handle.
  await ctx.listener({ id: 'session-b' }, dshEvent('后续消息', 'm2', 0, 1794052800000));
  await assert.rejects(
    ctx.flushListener({ id: 'session-a' }),
    /Storage Domain state is unknown/,
  );
  assert.equal(storage.worldlineWriteAttempts, 1);
  assert.equal(ctx.warnings.some(message => message.includes('failed closed')), true);
  await assert.rejects(ctx.disposer(), /failed during plugin teardown/);
  assert.equal(storage.opened.get('yuanqi_subject').domain.closed, true);
  assert.equal(storage.opened.get('yuanqi_user_subject').domain.closed, true);
});

test('plugin initialization failure after opening both Domains closes both handles', async () => {
  const storage = fakeStorageDomain();
  storage.failWorldlineTableBinding = true;
  await assert.rejects(apply(context(storage)), /simulated table binding failure/);
  assert.equal(storage.opened.get('yuanqi_subject').domain.closed, true);
  assert.equal(storage.opened.get('yuanqi_user_subject').domain.closed, true);
});

test('startup restores first direct message and later wake command from cold Session history', async () => {
  const storage = fakeStorageDomain();
  const old = dshEvent('启动元炁', 'old', 0, Date.now() - 5000);
  const first = dshEvent('你好', 'first', 1, Date.now() + 10);
  const later = dshEvent('启动元炁', 'later', 2, Date.now() + 20);
  let released = 0;
  const ctx = context(storage, {
    sessionQuery: {
      async listSessions() { return [{ header: { id: 'cold-a' }, live: false, persisted: true }]; },
      async observeSession(id, options) {
        assert.equal(id, 'cold-a');
        assert.deepEqual(options, { projectionMode: 'none' });
        return {
          inheritedEventCount: 1,
          events: [old, first, later],
          [Symbol.dispose]() { released += 1; },
        };
      },
    },
  });
  await apply(ctx);
  const tables = storage.opened.get('yuanqi_subject').tables;
  assert.equal(tables.get('first_user_messages').get('yuanqi:primary').first_event_id, 'first');
  assert.equal(tables.get('first_user_messages').get('yuanqi:primary').trigger_command, null);
  assert.equal(tables.get('wake_records').get('yuanqi:primary').wake_event_ref, 'later');
  assert.equal(tables.get('wake_records').get('yuanqi:primary').birth_time, new Date(later.time).toISOString());
  assert.equal(released, 1);
  await ctx.disposer();
});

test('Fork-inherited prefix is excluded from first-message recovery', async () => {
  const storage = fakeStorageDomain();
  const inheritedCommand = dshEvent('启动元炁', 'parent-command', 0, Date.now() + 1);
  const childMessage = dshEvent('普通消息', 'child-message', 1, Date.now() + 2);
  const ctx = context(storage, {
    sessionQuery: {
      async listSessions() { return [{ header: { id: 'fork-child' } }]; },
      async observeSession() {
        return { inheritedEventCount: 1, events: [inheritedCommand, childMessage], [Symbol.dispose]() {} };
      },
    },
  });
  await apply(ctx);
  const first = storage.opened.get('yuanqi_subject').tables.get('first_user_messages').get('yuanqi:primary');
  assert.equal(first.first_event_id, 'child-message');
  assert.equal(first.trigger_command, null);
  await ctx.disposer();
});

test('equal earliest timestamps across Sessions fail closed without consuming wake eligibility', async () => {
  const storage = fakeStorageDomain();
  const time = Date.now() + 10;
  const ctx = context(storage, {
    sessionQuery: {
      async listSessions() { return [{ header: { id: 's-a' } }, { header: { id: 's-b' } }]; },
      async observeSession(id) {
        const event = dshEvent('启动元炁', id + '-event', 0, time);
        return { inheritedEventCount: 0, events: [event], [Symbol.dispose]() {} };
      },
    },
  });
  await assert.rejects(apply(ctx), /ambiguous/);
  const tables = storage.opened.get('yuanqi_subject').tables;
  assert.equal(tables.get('first_user_messages').has('yuanqi:primary'), false);
  assert.equal(tables.get('wake_records').has('yuanqi:primary'), false);
  assert.equal(tables.get('worldlines').has('worldline:main'), false);
});

test('missing official Session Query or Persistence service fails closed at startup', async () => {
  const storage = fakeStorageDomain();
  await assert.rejects(apply({ ...context(storage), sessionQuery: undefined }), /sessionQuery/);
  await assert.rejects(apply({ ...context(storage), sessionPersistence: undefined }), /sessionPersistence/);
});

test('installation boundary is reused after restart; live post-activation events are not rejected by clock rollback', async () => {
  const storage = fakeStorageDomain();
  const first = context(storage);
  await apply(first);
  const boundary = storage.opened.get('yuanqi_subject').tables.get('installation_state').get('installation:primary');
  await first.disposer();

  const restarted = context(storage, {
    sessionQuery: {
      async listSessions() { return [{ header: { id: 'old-session' } }]; },
      async observeSession() {
        return { inheritedEventCount: 0, events: [dshEvent('启动元炁', 'pre-boundary', 0, boundary.activated_at_ms - 1)], [Symbol.dispose]() {} };
      },
    },
  });
  await apply(restarted);
  assert.equal(storage.opened.get('yuanqi_subject').tables.get('first_user_messages').has('yuanqi:primary'), false);
  await restarted.listener({ id: 'live-session' }, dshEvent('启动元炁', 'live-after-activation', 0, boundary.activated_at_ms - 2));
  await restarted.flushListener({ id: 'live-session' });
  assert.equal(storage.opened.get('yuanqi_subject').tables.get('first_user_messages').get('yuanqi:primary').first_event_id, 'live-after-activation');
  await restarted.disposer();
});

test('historical event at the exact activation millisecond is excluded conservatively', async () => {
  const storage = fakeStorageDomain();
  const first = context(storage);
  await apply(first);
  const boundary = storage.opened.get('yuanqi_subject').tables.get('installation_state').get('installation:primary');
  await first.disposer();
  const restarted = context(storage, {
    sessionQuery: {
      async listSessions() { return [{ header: { id: 'same-ms' } }]; },
      async observeSession() {
        return { inheritedEventCount: 0, events: [dshEvent('启动元炁', 'same-ms-event', 0, boundary.activated_at_ms)], [Symbol.dispose]() {} };
      },
    },
  });
  await apply(restarted);
  assert.equal(storage.opened.get('yuanqi_subject').tables.get('first_user_messages').has('yuanqi:primary'), false);
  await restarted.disposer();
});


test('YuanQi birth time is the exact first startup event time and host location is captured once', async () => {
  const storage = fakeStorageDomain();
  let locationReads = 0;
  const ctx = context(storage, {
    yuanqiLocationProvider: {
      async getCurrentPosition() {
        locationReads += 1;
        return {
          latitude: 31.2304, longitude: 121.4737, accuracy_meters: 18,
          place_label: 'Shanghai', time_zone_id: 'Asia/Shanghai',
          captured_at: '2026-11-14T11:23:47.000Z',
        };
      },
    },
  });
  await apply(ctx);
  await ctx.listener({ id: 'session-a' }, dshEvent('启动元炁', 'birth-event', 0, 1793966400123));
  await ctx.flushListener({ id: 'session-a' });
  const wake = storage.opened.get('yuanqi_subject').tables.get('wake_records').get('yuanqi:primary');
  assert.equal(wake.birth_time, new Date(1793966400123).toISOString());
  assert.equal(wake.occurred_at, wake.birth_time);
  assert.deepEqual(wake.birth_location, {
    status: 'captured', latitude: 31.2304, longitude: 121.4737,
    accuracy_meters: 18, place_label: 'Shanghai', time_zone_id: 'Asia/Shanghai',
    source: 'host_location_provider', captured_at: '2026-11-14T11:23:47.000Z',
  });
  await ctx.listener({ id: 'session-a' }, dshEvent('后续消息', 'later-event', 1, 1793966401123));
  await ctx.flushListener({ id: 'session-a' });
  assert.equal(locationReads, 1);
  await ctx.disposer();
});

test('missing host location capability records unknown place without fabricating data', async () => {
  const storage = fakeStorageDomain(), ctx = context(storage);
  await apply(ctx);
  await ctx.listener({ id: 'session-a' }, dshEvent('启动元气', 'birth-event', 0, 1793966400123));
  await ctx.flushListener({ id: 'session-a' });
  const wake = storage.opened.get('yuanqi_subject').tables.get('wake_records').get('yuanqi:primary');
  assert.equal(wake.birth_time, new Date(1793966400123).toISOString());
  assert.equal(wake.birth_location.status, 'unavailable');
  assert.equal(wake.birth_location.latitude, null);
  assert.equal(wake.birth_location.longitude, null);
  await ctx.disposer();
});
