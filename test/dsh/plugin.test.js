import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../../src/dsh/plugin.js';

function fakeStorageDomain() {
  const opened = new Map();
  return {
    opened,
    async open(spec) {
      const tables = new Map(Object.keys(spec.tables).map(name => [name, new Map()]));
      const domain = {
        table(name) {
          const rows = tables.get(name);
          if (!rows) throw new Error('unknown table: ' + name);
          return { get: key => rows.get(key), async put(key, value) { rows.set(key, structuredClone(value)); } };
        },
        async close() { domain.closed = true; },
        closed: false,
      };
      opened.set(spec.name, { domain, tables });
      return domain;
    },
  };
}
function dshEvent(text, id, seq, time) {
  return { type: 'user/message', seq, time, data: { id, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] } };
}
function context(storageDomain) {
  let listener, disposer;
  return {
    storageDomain,
    logger: { warn(message) { throw new Error(message); } },
    on(name, callback) { assert.equal(name, 'session/event'); listener = callback; },
    effect(register) { disposer = register(); },
    get listener() { return listener; },
    get disposer() { return disposer; },
  };
}
test('Cordis plugin persists first direct message and does not wake on a later command', async () => {
  const storage = fakeStorageDomain(), ctx = context(storage);
  await apply(ctx);
  await ctx.listener({ id: 'session-a' }, dshEvent('你好', 'm1', 0, 1793966400000));
  await ctx.listener({ id: 'session-b' }, dshEvent('启动元炁', 'm2', 0, 1794052800000));
  const tables = storage.opened.get('yuanqi_subject').tables;
  assert.equal(tables.get('first_user_messages').get('yuanqi:primary').first_event_id, 'm1');
  assert.equal(tables.get('first_user_messages').get('yuanqi:primary').trigger_command, null);
  assert.equal(tables.get('wake_records').has('yuanqi:primary'), false);
  await ctx.disposer();
  assert.equal(storage.opened.get('yuanqi_subject').domain.closed, true);
  assert.equal(storage.opened.get('yuanqi_user_subject').domain.closed, true);
});
test('Cordis plugin wakes only from the exact first direct user command', async () => {
  const storage = fakeStorageDomain(), ctx = context(storage);
  await apply(ctx);
  await ctx.listener({ id: 'session-a' }, dshEvent('启动元炁', 'm1', 0, 1793966400000));
  const wake = storage.opened.get('yuanqi_subject').tables.get('wake_records').get('yuanqi:primary');
  assert.equal(wake.wake_event_ref, 'm1');
  assert.equal(wake.first_session_id, 'session-a');
  assert.equal(wake.occurred_at, new Date(1793966400000).toISOString());
  await ctx.disposer();
});
