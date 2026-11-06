import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldlineStore } from '../../src/worldline/runtime.js';

function memoryDomain(names) {
  const maps = new Map(names.map(name => [name, new Map()]));
  return { table(name) {
    const rows = maps.get(name);
    if (!rows) throw new Error('unknown table: ' + name);
    return { get: key => rows.get(key), async put(key, value) { rows.set(key, structuredClone(value)); } };
  }};
}
function setup() {
  const yuanqiDomain = memoryDomain([
    'identities','worldlines','worldline_mainlines','worldline_snapshots',
    'worldline_events','session_worldline_bindings',
  ]);
  yuanqiDomain.table('identities').put('yuanqi-1',{subject_id:'yuanqi-1',subject_kind:'yuanqi'});
  const store = createWorldlineStore({
    yuanqiDomain,
    verifyHostEvent(event) { return event?.verified === true ? event : null; },
  });
  return { store, yuanqiDomain };
}
function hostEvent(id, time=1793966400000) {
  return {verified:true,event_id:id,source_event_ref:id,source_kind:'direct_user_event',occurred_at:new Date(time).toISOString()};
}

test('one YuanQiSubject gets one idempotent mainline and immutable initial snapshot', async () => {
  const {store,yuanqiDomain}=setup();
  const first=await store.createMainline({yuanqi_subject_id:'yuanqi-1',worldline_id:'worldline:main',created_from_event:hostEvent('e1')});
  const again=await store.createMainline({yuanqi_subject_id:'yuanqi-1',worldline_id:'ignored-mainline',created_from_event:hostEvent('e2')});
  assert.deepEqual(again,first);
  assert.equal(store.getSnapshot('worldline:main',0).snapshot_version,0);
  assert.equal(yuanqiDomain.table('worldline_events').get('worldline.created:worldline:main').event_type,'worldline.created');
});

test('fork keeps a parent snapshot reference and an independent child snapshot', async () => {
  const {store}=setup();
  await store.createMainline({yuanqi_subject_id:'yuanqi-1',worldline_id:'worldline:main',created_from_event:hostEvent('e1')});
  const child=await store.forkWorldline({
    yuanqi_subject_id:'yuanqi-1',parent_worldline_id:'worldline:main',
    target_worldline_id:'worldline:experiment-1',base_snapshot_version:0,
    created_from_event:hostEvent('fork-event'),
  });
  assert.equal(child.parent_worldline_id,'worldline:main');
  assert.equal(child.base_snapshot_version,0);
  const effective=store.getEffectiveSnapshot('worldline:experiment-1');
  assert.equal(effective.base_snapshot.snapshot_id,'worldline:main:0');
  assert.equal(effective.local_snapshot.snapshot_id,'worldline:experiment-1:0');
  assert.notEqual(effective.base_snapshot,effective.local_snapshot);
  effective.local_snapshot.state_payload.local_only=true;
  assert.deepEqual(store.getSnapshot('worldline:main',0).state_payload,{});
  assert.deepEqual(store.getSnapshot('worldline:experiment-1',0).state_payload,{});
});

test('a Session is bound to a Worldline, and multiple Sessions may share one line', async () => {
  const {store}=setup();
  await store.createMainline({yuanqi_subject_id:'yuanqi-1',worldline_id:'worldline:main',created_from_event:hostEvent('e1')});
  await store.bindSession({session_id:'session-a',yuanqi_subject_id:'yuanqi-1',worldline_id:'worldline:main',bound_from_event_ref:'e1'});
  await store.bindSession({session_id:'session-b',yuanqi_subject_id:'yuanqi-1',worldline_id:'worldline:main',bound_from_event_ref:'e2'});
  assert.equal(store.getSessionBinding('session-a').worldline_id,'worldline:main');
  assert.equal(store.getSessionBinding('session-b').worldline_id,'worldline:main');
  await store.forkWorldline({yuanqi_subject_id:'yuanqi-1',parent_worldline_id:'worldline:main',target_worldline_id:'worldline:child',base_snapshot_version:0,created_from_event:hostEvent('fork')});
  await assert.rejects(store.bindSession({session_id:'session-a',yuanqi_subject_id:'yuanqi-1',worldline_id:'worldline:child',bound_from_event_ref:'rebind'}),/already bound/);
});

test('Worldline operations reject missing subjects, snapshots, and unverified host events', async () => {
  const {store}=setup();
  await assert.rejects(store.createMainline({yuanqi_subject_id:'missing',worldline_id:'x',created_from_event:hostEvent('e')}),/does not exist/);
  await assert.rejects(store.createMainline({yuanqi_subject_id:'yuanqi-1',worldline_id:'x',created_from_event:{event_id:'fake'}}),/unverified/);
  await store.createMainline({yuanqi_subject_id:'yuanqi-1',worldline_id:'worldline:main',created_from_event:hostEvent('e1')});
  await assert.rejects(store.forkWorldline({yuanqi_subject_id:'yuanqi-1',parent_worldline_id:'worldline:main',target_worldline_id:'child',base_snapshot_version:9,created_from_event:hostEvent('f')}),/snapshot does not exist/);
});
