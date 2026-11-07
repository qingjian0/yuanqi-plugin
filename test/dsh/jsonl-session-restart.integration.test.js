import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import SessionStore, { SESSION_FORMAT_VERSION, SessionId, SessionSeq } from '@deepseek-ai/dsh-session';
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import SqliteSessionQueryEngine from '@deepseek-ai/dsh-session-query-sqlite';
import { apply } from '../../src/dsh/plugin.js';

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

async function createHost(root) {
  const host = new Context();
  await host.plugin(SessionStore);
  await host.plugin(JsonlSessionPersistence, { root, compression: 'none' });
  await host.plugin(SqliteSessionQueryEngine, { path: ':memory:', openAt: 'never' });
  return host;
}

function pluginContext(host, storageDomain, dropSessionEvents = false) {
  let disposer;
  return {
    storageDomain,
    sessionQuery: host.sessionQuery,
    sessionPersistence: host.sessionPersistence,
    on(name, ...args) {
      if (!dropSessionEvents || (name !== 'session/event' && name !== 'session/flush')) {
        return host.on(name, ...args);
      }
    },
    effect(register) { disposer = register(); },
    logger: { warn() {} },
    get disposer() { return disposer; },
  };
}

function userEvent(time) {
  return {
    type: 'user/message',
    seq: SessionSeq(0),
    time,
    data: createUserMessage({
      content: [{ type: 'text', text: '启动元炁' }],
      source: { kind: 'user' },
    }),
    surfaceOp: 'append',
  };
}

test('JSONL persistence survives DSH context restart and official SessionQuery restores YuanQi first wake', async () => {
  const root = await mkdtemp(join(tmpdir(), 'yuanqi-session-restore-'));
  let firstHost;
  let secondHost;
  let firstPlugin;
  let secondPlugin;
  try {
    const storageDomain = memoryStorageDomain();
    firstHost = await createHost(root);
    firstPlugin = pluginContext(firstHost, storageDomain, true);

    // Establish YuanQi's durable activation boundary before the source event.
    // Drop only YuanQi's live observer to reproduce the crash window where
    // Session persistence commits but the plugin's first-message sidecar does not.
    await apply(firstPlugin);
    await new Promise(resolve => setTimeout(resolve, 5));

    const sessionId = SessionId('jsonl-restart-session');
    const header = {
      version: SESSION_FORMAT_VERSION,
      id: sessionId,
      createdAt: Date.now(),
      cwd: process.cwd(),
      isSeeded: false,
    };
    const writer = await firstHost.sessionPersistence.create(header);
    const sourceEvent = userEvent(Date.now());
    await writer.append([sourceEvent]);
    await writer.close();
    assert.equal(storageDomain.persisted.get('yuanqi_subject')
      .get('first_user_messages').has('yuanqi:primary'), false);

    await firstPlugin.disposer();
    firstPlugin = undefined;
    await firstHost.fiber.dispose();
    firstHost = undefined;

    // A new DSH Context reopens the same on-disk JSONL store. SessionQuery
    // performs a cold observation and SessionStore.prepare restore, without
    // inserting the restored Session into the live SessionStore.
    secondHost = await createHost(root);
    const sessions = await secondHost.sessionQuery.listSessions();
    assert.equal(sessions.some(record => record.header.id === sessionId && !record.live && record.persisted), true);
    const observed = await secondHost.sessionQuery.observeSession(sessionId, { projectionMode: 'none' });
    try {
      assert.equal(observed.source, 'prepared');
      assert.equal(observed.events[0].data.id, sourceEvent.data.id);
      assert.equal(secondHost.sessions.get(sessionId), undefined);
    } finally {
      observed[Symbol.dispose]();
    }

    secondPlugin = pluginContext(secondHost, storageDomain);
    await apply(secondPlugin);
    const tables = storageDomain.persisted.get('yuanqi_subject');
    const first = tables.get('first_user_messages').get('yuanqi:primary');
    const wake = tables.get('wake_records').get('yuanqi:primary');
    assert.equal(first.first_event_id, sourceEvent.data.id);
    assert.equal(first.first_session_id, sessionId);
    assert.equal(first.trigger_command, '启动元炁');
    assert.equal(wake.wake_event_ref, sourceEvent.data.id);
    assert.equal(wake.occurred_at, new Date(sourceEvent.time).toISOString());
    assert.equal(tables.get('worldlines').get('worldline:main').status, 'active');
  } finally {
    if (secondPlugin?.disposer) await secondPlugin.disposer();
    if (secondHost) await secondHost.fiber.dispose();
    if (firstPlugin?.disposer) await firstPlugin.disposer();
    if (firstHost) await firstHost.fiber.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
