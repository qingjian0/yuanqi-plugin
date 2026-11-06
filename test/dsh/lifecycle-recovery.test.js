import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../../src/dsh/plugin.js';
import { openSubjectDomains } from '../../src/domain/subject-domain.js';

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

function persistentStorageDomain({ failOpenName, failTable, beforeWrite = async () => {} } = {}) {
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
      let writeChain = Promise.resolve();
      let closing = false;
      let closePromise;
      const enqueue = job => {
        if (closing) return Promise.reject(new Error('domain is closing'));
        const result = writeChain.then(job);
        writeChain = result.then(() => undefined, () => undefined);
        return result;
      };
      const handle = {
        closed: false,
        table(name) {
          if (failTable?.domain === spec.name && failTable?.table === name) throw new Error('simulated table binding failure: ' + spec.name + '/' + name);
          const rows = tables.get(name);
          if (!rows) throw new Error('unknown table: ' + name);
          return {
            get: key => rows.get(key),
            async put(key, value) {
              return enqueue(async () => {
                await beforeWrite({ domain: spec.name, table: name, key, operation: 'put' });
                rows.set(key, structuredClone(value));
              });
            },
            async update(key, fn) {
              return enqueue(async () => {
                if (!rows.has(key)) throw new Error('missing-key: ' + key);
                const next = fn(rows.get(key));
                await beforeWrite({ domain: spec.name, table: name, key, operation: 'update' });
                rows.set(key, structuredClone(next));
                return structuredClone(next);
              });
            },
          };
        },
        close() {
          closing = true;
          closePromise ??= (async () => {
            await writeChain;
            handle.closed = true;
          })();
          return closePromise;
        },
      };
      handles.push({ name: spec.name, handle });
      return handle;
    },
    table(domainName, tableName) {
      return tablesByDomain.get(domainName)?.get(tableName);
    },
  };
}

function dshEvent(text, id, seq = 0, time = 1793966400000, source = { kind: 'user' }) {
  return {
    type: 'user/message',
    seq,
    time,
    data: { id, role: 'user', source, content: [{ type: 'text', text }] },
  };
}

function context(storageDomain) {
  let listener;
  let flushListener;
  let disposer;
  const warnings = [];
  return {
    storageDomain,
    warnings,
    logger: { warn(message) { warnings.push(message); } },
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

test('synthetic user-role context is not mistaken for the first direct human message', async () => {
  const storage = persistentStorageDomain();
  const ctx = context(storage);
  await apply(ctx);

  await ctx.listener({ id: 'session-context' }, dshEvent('injected context', 'synthetic-context', 0, 1793966400000, { kind: 'plugin', plugin: 'test' }));
  await ctx.flushListener({ id: 'session-context' });
  assert.equal(storage.table('yuanqi_subject', 'first_user_messages').get('yuanqi:primary'), undefined);

  await ctx.listener({ id: 'session-human' }, dshEvent('真正的首条消息', 'direct-human-message', 0, 1793966401000));
  await ctx.flushListener({ id: 'session-human' });
  assert.equal(storage.table('yuanqi_subject', 'first_user_messages').get('yuanqi:primary').first_event_id, 'direct-human-message');

  await ctx.disposer();
});

test('plugin disposal waits for in-flight event writes before closing Domains', async () => {
  const entered = deferred();
  const release = deferred();
  let firstWrite = true;
  const storage = persistentStorageDomain({
    beforeWrite: async () => {
      if (!firstWrite) return;
      firstWrite = false;
      entered.resolve();
      await release.promise;
    },
  });
  const ctx = context(storage);
  await apply(ctx);

  const eventTask = ctx.listener({ id: 'session-drain' }, dshEvent('普通消息', 'drain-event'));
  await entered.promise;
  let disposed = false;
  const disposeTask = ctx.disposer().then(() => { disposed = true; });
  await Promise.resolve();
  assert.equal(disposed, false);
  assert.equal(storage.handles.every(item => !item.handle.closed), true);

  release.resolve();
  await eventTask;
  await disposeTask;
  assert.equal(disposed, true);
  assert.equal(storage.handles.every(item => item.handle.closed), true);
});

test('a fast event-write failure remains visible to the later Session flush', async () => {
  const storage = persistentStorageDomain({
    beforeWrite: async () => { throw new Error('simulated durable write rejection'); },
  });
  const ctx = context(storage);
  await apply(ctx);

  await assert.rejects(ctx.listener({ id: 'session-fail' }, dshEvent('消息', 'failed-event')), /simulated durable write rejection/);
  await assert.rejects(ctx.flushListener({ id: 'session-fail' }), /YuanQi Session writes failed/);
  await ctx.flushListener({ id: 'session-fail' });
  assert.equal(ctx.warnings.some(message => message.includes('session event processing failed')), true);
  await ctx.disposer();
});

test('unknown-state makes the plugin fail closed until unload and reload', async () => {
  let writeAttempts = 0;
  const storage = persistentStorageDomain({
    beforeWrite: async () => {
      writeAttempts += 1;
      throw Object.assign(new Error('backend cannot establish durable state'), { code: 'unknown-state' });
    },
  });
  const ctx = context(storage);
  await apply(ctx);

  await assert.rejects(ctx.listener({ id: 'session-uncertain' }, dshEvent('消息', 'uncertain-event')), /backend cannot establish durable state/);
  await assert.rejects(ctx.flushListener({ id: 'session-uncertain' }), /YuanQi Session writes failed/);
  await ctx.listener({ id: 'session-uncertain' }, dshEvent('后续消息', 'later-event', 1));
  await ctx.flushListener({ id: 'session-uncertain' });

  assert.equal(writeAttempts, 1);
  assert.equal(storage.table('yuanqi_user_subject', 'identities').get('user:primary'), undefined);
  assert.equal(ctx.warnings.some(message => message.includes('failed closed')), true);
  await ctx.disposer();
});

test('opening the second DSH Domain failure closes the already-open first Domain', async () => {
  const storage = persistentStorageDomain({ failOpenName: 'yuanqi_subject' });
  await assert.rejects(openSubjectDomains(storage), /simulated open failure: yuanqi_subject/);
  assert.equal(storage.handles.length, 1);
  assert.equal(storage.handles[0].name, 'yuanqi_user_subject');
  assert.equal(storage.handles[0].handle.closed, true);
});


test('plugin initialization failure after opening both Domains closes both handles', async () => {
  const storage = persistentStorageDomain({
    failTable: { domain: 'yuanqi_subject', table: 'worldlines' },
  });
  await assert.rejects(apply(context(storage)), /simulated table binding failure: yuanqi_subject\/worldlines/);
  assert.equal(storage.handles.length, 2);
  assert.equal(storage.handles.every(item => item.handle.closed), true);
});
