import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../../src/dsh/plugin.js';
import { openSubjectDomains } from '../../src/domain/subject-domain.js';

function persistentStorageDomain({ failOpenName } = {}) {
  const tablesByDomain = new Map();
  const handles = [];
  return {
    handles,
    async open(spec) {
      if (spec.name === failOpenName) throw new Error('simulated open failure: ' + spec.name);
      let tables = tablesByDomain.get(spec.name);
      if (!tables) {
        tables = new Map(Object.keys(spec.tables).map(name => [name, new Map()]));
        tablesByDomain.set(spec.name, tables);
      }
      const handle = {
        closed: false,
        table(name) {
          const rows = tables.get(name);
          if (!rows) throw new Error('unknown table: ' + name);
          return {
            get: key => rows.get(key),
            async put(key, value) { rows.set(key, structuredClone(value)); },
          };
        },
        async close() { handle.closed = true; },
      };
      handles.push({ name: spec.name, handle });
      return handle;
    },
    table(domainName, tableName) {
      return tablesByDomain.get(domainName)?.get(tableName);
    },
  };
}

function dshEvent(text, id, seq = 0, time = 1793966400000) {
  return {
    type: 'user/message',
    seq,
    time,
    data: { id, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] },
  };
}

function context(storageDomain) {
  let listener;
  let flushListener;
  let disposer;
  return {
    storageDomain,
    logger: { warn(message) { throw new Error(message); } },
    on(name, callback) {
      if (name === 'session/event') listener = callback;
      else if (name === 'session/flush') flushListener = callback;
      else throw new Error('unexpected event ' + name);
    },
    effect(register) { disposer = register(); },
    get listener() { return listener; },
    get flushListener() { return flushListener; },
    get disposer() { return disposer; },
  };
}

test('reopening DSH Storage Domains preserves YuanQi state and replay is idempotent', async () => {
  const storage = persistentStorageDomain();
  const firstContext = context(storage);
  await apply(firstContext);

  const firstEvent = dshEvent('启动元炁', 'first-direct-message');
  await firstContext.listener({ id: 'session-a' }, firstEvent);
  await firstContext.flushListener({ id: 'session-a' });
  const beforeRestart = storage.table('yuanqi_subject', 'worldline_heads').get('worldline:main');
  assert.equal(beforeRestart.current_snapshot_version, 0);
  assert.equal(storage.table('yuanqi_subject', 'wake_records').get('yuanqi:primary').wake_event_ref, 'first-direct-message');

  await firstContext.disposer();
  assert.equal(storage.handles.slice(0, 2).every(item => item.handle.closed), true);

  const secondContext = context(storage);
  await apply(secondContext);
  await secondContext.listener({ id: 'session-a' }, firstEvent);
  await secondContext.flushListener({ id: 'session-a' });

  assert.equal(storage.table('yuanqi_subject', 'first_user_messages').get('yuanqi:primary').first_event_id, 'first-direct-message');
  assert.equal(storage.table('yuanqi_subject', 'wake_records').get('yuanqi:primary').wake_event_ref, 'first-direct-message');
  assert.equal(storage.table('yuanqi_subject', 'worldline_mainlines').get('yuanqi:primary').worldline_id, 'worldline:main');
  assert.equal(storage.table('yuanqi_subject', 'session_worldline_bindings').get('session-a').worldline_id, 'worldline:main');
  assert.equal(storage.table('yuanqi_subject', 'worldline_heads').get('worldline:main').current_snapshot_version, 0);

  await secondContext.disposer();
  assert.equal(storage.handles.slice(2).every(item => item.handle.closed), true);
});

test('opening the second DSH Domain failure closes the already-open first Domain', async () => {
  const storage = persistentStorageDomain({ failOpenName: 'yuanqi_subject' });
  await assert.rejects(openSubjectDomains(storage), /simulated open failure: yuanqi_subject/);
  assert.equal(storage.handles.length, 1);
  assert.equal(storage.handles[0].name, 'yuanqi_user_subject');
  assert.equal(storage.handles[0].handle.closed, true);
});
