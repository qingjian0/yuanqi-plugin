import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import SessionStore, {
  SESSION_FORMAT_VERSION,
  SessionId,
  SessionLogOffset,
  SessionSeq,
} from '@deepseek-ai/dsh-session';
import { SessionPersistenceRevision } from '@deepseek-ai/dsh-session-persistence';
import { SessionQueryEngine } from '@deepseek-ai/dsh-session-query';
import { apply } from '../../src/dsh/plugin.js';

class RestoreTestQuery extends SessionQueryEngine {
  async searchSessions() { return { items: [] }; }
  async searchEvents() { return { items: [] }; }
}

function memoryPersistence(entries) {
  const byId = new Map(entries.map(entry => [entry.header.id, entry]));
  const snapshot = entry => ({
    header: structuredClone(entry.header),
    revision: SessionPersistenceRevision(entry.revision),
  });
  return {
    identity: Symbol('test-session-persistence'),
    async list() { return [...byId.values()].map(snapshot); },
    async stat(id) {
      const entry = byId.get(id);
      return entry ? snapshot(entry) : undefined;
    },
    async open(id, access) {
      const entry = byId.get(id);
      if (!entry) throw new Error('missing persisted test Session: ' + id);
      return {
        id,
        header: structuredClone(entry.header),
        inheritedEventCount: SessionLogOffset(entry.inheritedEventCount ?? 0),
        access,
        async read() {
          return {
            eventState: 'detached',
            events: structuredClone(entry.events),
          };
        },
        async close() {},
      };
    },
  };
}

function event(seq, time, text) {
  return {
    type: 'user/message',
    seq: SessionSeq(seq),
    time,
    data: createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    }),
    surfaceOp: 'append',
  };
}

function memoryStorageDomain() {
  const persisted = new Map();
  return {
    async open(spec) {
      let tables = persisted.get(spec.name);
      if (!tables) {
        tables = new Map(Object.keys(spec.tables).map(name => [name, new Map()]));
        persisted.set(spec.name, tables);
      }
      return {
        table(name) {
          const rows = tables.get(name);
          if (!rows) throw new Error('unknown table: ' + name);
          return {
            get: key => rows.get(key),
            async put(key, value) { rows.set(key, structuredClone(value)); },
          };
        },
        async close() {},
      };
    },
    persisted,
  };
}

async function createHost(entries) {
  const host = new Context();
  await host.plugin(SessionStore);
  host.provide('sessionPersistence', memoryPersistence(entries));
  await host.plugin(RestoreTestQuery);
  return host;
}

function pluginContext(host, storageDomain) {
  let disposer;
  return {
    storageDomain,
    sessionQuery: host.sessionQuery,
    sessionPersistence: host.sessionPersistence,
    on: (...args) => host.on(...args),
    effect(register) { disposer = register(); },
    logger: { warn() {} },
    get disposer() { return disposer; },
  };
}

test('official DSH SessionQuery cold observation restores through real SessionStore without entering it', async () => {
  const sessionId = SessionId('cold-session-query-real');
  const header = {
    version: SESSION_FORMAT_VERSION,
    id: sessionId,
    createdAt: 1,
    isSeeded: false,
  };
  const persistedEvent = event(0, Date.now() + 1000, '启动元炁');
  const host = await createHost([{
    header,
    events: [persistedEvent],
    revision: 'r1',
    inheritedEventCount: 0,
  }]);

  const observed = await host.sessionQuery.observeSession(sessionId, { projectionMode: 'none' });
  try {
    assert.equal(observed.source, 'prepared');
    assert.equal(observed.events.length, 1);
    assert.equal(observed.events[0].data.id, persistedEvent.data.id);
    assert.equal(host.sessions.get(sessionId), undefined);
  } finally {
    observed[Symbol.dispose]();
  }

  const storageDomain = memoryStorageDomain();
  const plugin = pluginContext(host, storageDomain);
  await apply(plugin);
  const yuanqiTables = storageDomain.persisted.get('yuanqi_subject');
  assert.equal(yuanqiTables.get('first_user_messages').get('yuanqi:primary').first_event_id, persistedEvent.data.id);
  assert.equal(yuanqiTables.get('wake_records').get('yuanqi:primary').occurred_at, new Date(persistedEvent.time).toISOString());

  await plugin.disposer();
  await host.fiber.dispose();
});

test('official DSH SessionQuery preserves the fork inherited prefix for YuanQi filtering', async () => {
  const sessionId = SessionId('cold-fork-session-query-real');
  const header = {
    version: SESSION_FORMAT_VERSION,
    id: sessionId,
    createdAt: 2,
    isSeeded: true,
    parentSession: SessionId('parent-session'),
  };
  const inheritedCommand = event(0, Date.now() + 1000, '启动元炁');
  const childMessage = event(1, Date.now() + 2000, '子线第一条新消息');
  const host = await createHost([{
    header,
    events: [inheritedCommand, childMessage],
    revision: 'r2',
    inheritedEventCount: 1,
  }]);

  const storageDomain = memoryStorageDomain();
  const plugin = pluginContext(host, storageDomain);
  await apply(plugin);
  const first = storageDomain.persisted.get('yuanqi_subject')
    .get('first_user_messages').get('yuanqi:primary');
  assert.equal(first.first_event_id, childMessage.data.id);
  assert.equal(first.trigger_command, null);
  assert.equal(storageDomain.persisted.get('yuanqi_subject').get('worldlines').has('worldline:main'), false);

  await plugin.disposer();
  await host.fiber.dispose();
});
