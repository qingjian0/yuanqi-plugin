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
    async open(spec) {
      let tables = persisted.get(spec.name);
      if (!tables) {
        tables = new Map(Object.keys(spec.tables).map(name => [name, new Map()]));
        persisted.set(spec.name, tables);
      }
      const domain = {
        table(name) {
          const rows = tables.get(name);
          if (!rows) throw new Error('unknown table: ' + name);
          return {
            get: key => rows.get(key),
            async put(key, value) {
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
