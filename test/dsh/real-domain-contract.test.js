import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { DomainFacility, defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import { StorageError } from '@deepseek-ai/dsh-storage';

function createDomainHost({ failNextPut = false } = {}) {
  const persisted = new Map();
  const opened = new Set();
  const changes = [];
  let shouldFailNextPut = failNextPut;

  const context = {
    storage: {
      backend: {
        get(name) {
          assert.equal(name, 'test-memory');
          return {
            kv: {
              async open(descriptor) {
                if (opened.has(descriptor.name)) {
                  throw new StorageError('malformed-medium', 'unit is already open in test backend');
                }
                opened.add(descriptor.name);
                let unitState = persisted.get(descriptor.name);
                if (!unitState) {
                  unitState = {
                    tables: Object.fromEntries(descriptor.tables.map(table => [table, {}])),
                    global: null,
                  };
                  persisted.set(descriptor.name, unitState);
                }
                let closed = false;
                const assertOpen = () => {
                  if (closed) throw new StorageError('closed', 'test unit is closed');
                };
                return {
                  async loadAll() {
                    assertOpen();
                    return structuredClone(unitState);
                  },
                  async putRecord(table, key, value) {
                    assertOpen();
                    if (shouldFailNextPut) {
                      shouldFailNextPut = false;
                      throw new StorageError('unknown-state', 'simulated unknown durable outcome');
                    }
                    unitState.tables[table] ??= {};
                    unitState.tables[table][key] = structuredClone(value);
                  },
                  async deleteRecord(table, key) {
                    assertOpen();
                    delete unitState.tables[table]?.[key];
                  },
                  async deleteRecords(table, keys) {
                    assertOpen();
                    for (const key of keys) delete unitState.tables[table]?.[key];
                  },
                  async setGlobal(value) {
                    assertOpen();
                    unitState.global = structuredClone(value);
                  },
                  async close() {
                    if (closed) return;
                    closed = true;
                    opened.delete(descriptor.name);
                  },
                };
              },
            },
          };
        },
      },
    },
    emit(type, payload) {
      changes.push({ type, payload });
    },
    logger: { warn() {}, error() {} },
  };

  return {
    context,
    persisted,
    opened,
    changes,
    facility: new DomainFacility(context, { backend: 'test-memory', routes: {} }),
  };
}

const probeSpec = defineDomain({
  name: 'yuanqi_contract_probe',
  version: 1,
  tables: {
    records: domainTable(z.object({ id: z.string(), value: z.number() }).strict()),
  },
});

test('actual DSH DomainFacility persists writes, validates records and reopens after close', async () => {
  const host = createDomainHost();
  const domain = await host.facility.open(probeSpec);
  const records = domain.table('records');

  assert.equal(records.get('probe-1'), undefined);
  await records.put('probe-1', { id: 'probe-1', value: 1 });
  await records.update('probe-1', current => ({ ...current, value: current.value + 1 }));
  assert.deepEqual(records.get('probe-1'), { id: 'probe-1', value: 2 });
  assert.equal(host.changes.length, 2);
  assert.equal(host.changes.every(change => change.type === 'domain/changed'), true);

  await domain.close();
  assert.equal(host.opened.size, 0);

  const reopened = await host.facility.open(probeSpec);
  assert.deepEqual(reopened.table('records').get('probe-1'), { id: 'probe-1', value: 2 });
  await reopened.close();
});

test('actual DSH DomainImpl quarantines unknown-state and allows recovery only after close/reopen', async () => {
  const host = createDomainHost({ failNextPut: true });
  const domain = await host.facility.open(probeSpec);
  const records = domain.table('records');

  await assert.rejects(
    records.put('probe-uncertain', { id: 'probe-uncertain', value: 1 }),
    error => error instanceof StorageError && error.code === 'unknown-state',
  );
  assert.throws(
    () => records.get('probe-uncertain'),
    error => error instanceof StorageError && error.code === 'unknown-state',
  );
  await domain.close();

  const reopened = await host.facility.open(probeSpec);
  assert.equal(reopened.table('records').get('probe-uncertain'), undefined);
  await reopened.table('records').put('probe-uncertain', { id: 'probe-uncertain', value: 2 });
  assert.deepEqual(reopened.table('records').get('probe-uncertain'), { id: 'probe-uncertain', value: 2 });
  await reopened.close();
});
