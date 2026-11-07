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
function context(storageDomain) {
  let listener, flushListener, disposer;
  const warnings = [];
  return {
    storageDomain,
    warnings,
    logger: { warn(message) { warnings.push(message); } },
    on(name, callback) { if (name === 'session/event') listener = callback; else if (name === 'session/flush') flushListener = callback; else throw new Error('unexpected event ' + name); },
    effect(register) { disposer = register(); },
    get listener() { return listener; },
    get flushListener() { return flushListener; },
    get disposer() { return disposer; },
  };
}
test('non-command first message consumes wake eligibility without creating a Worldline', async () => {
  const storage = fakeStorageDomain(), ctx = context(storage);
  await apply(ctx);
  await ctx.listener({ id: 'session-a' }, dshEvent('你好', 'm1', 0, 1793966400000));
  await ctx.flushListener({ id: 'session-a' });
  await ctx.listener({ id: 'session-b' }, dshEvent('启动元炁', 'm2', 0, 1794052800000));
  await ctx.flushListener({ id: 'session-b' });
  const tables = storage.opened.get('yuanqi_subject').tables;
  assert.equal(tables.get('first_user_messages').get('yuanqi:primary').first_event_id, 'm1');
  assert.equal(tables.get('first_user_messages').get('yuanqi:primary').trigger_command, null);
  assert.equal(tables.get('wake_records').has('yuanqi:primary'), false);
  assert.equal(tables.get('worldlines').has('worldline:main'), false);
  assert.equal(tables.get('session_worldline_bindings').has('session-a'), false);
  assert.equal(tables.get('session_worldline_bindings').has('session-b'), false);
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
test('Cordis plugin wakes only from the exact first direct user command', async () => {
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
