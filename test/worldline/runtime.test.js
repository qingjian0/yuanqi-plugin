import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldlineStore, SELF_MODEL_CENTER_IDS } from '../../src/worldline/runtime.js';

function memoryDomain(names) {
  const maps = new Map(names.map(name => [name, new Map()]));
  let chain = Promise.resolve();
  function enqueue(operation) {
    const result = chain.then(operation);
    chain = result.then(() => undefined, () => undefined);
    return result;
  }
  return { table(name) {
    const rows = maps.get(name);
    if (!rows) throw new Error('unknown table: ' + name);
    return {
      get: key => rows.get(key),
      async put(key, value) { return enqueue(() => { rows.set(key, structuredClone(value)); }); },
      async update(key, transform) {
        return enqueue(() => {
          if (!rows.has(key)) throw new Error('missing-key');
          const next = transform(rows.get(key));
          rows.set(key, structuredClone(next));
          return structuredClone(next);
        });
      },
    };
  }};
}
async function setup() {
  const yuanqiDomain = memoryDomain([
    'identities','worldlines','worldline_mainlines','worldline_snapshots',
    'worldline_events','session_worldline_bindings','worldline_heads',
  ]);
  await yuanqiDomain.table('identities').put('yuanqi-1',{subject_id:'yuanqi-1',subject_kind:'yuanqi'});
  const store = createWorldlineStore({
    yuanqiDomain,
    verifyHostEvent(event) { return event?.verified === true ? event : null; },
  });
  return { store, yuanqiDomain };
}
function hostEvent(id, time=1793966400000) {
  return {verified:true,event_id:id,source_event_ref:id,source_kind:'direct_user_event',occurred_at:new Date(time).toISOString()};
}
async function mainline(store) {
  return store.createMainline({
    yuanqi_subject_id:'yuanqi-1',worldline_id:'worldline:main',
    created_from_event:hostEvent('main-created'),
  });
}
const now = 1793966400000;

test('one YuanQiSubject gets one idempotent mainline with all five SelfModel centers', async () => {
  const {store,yuanqiDomain}=await setup();
  const first=await mainline(store);
  const again=await store.createMainline({
    yuanqi_subject_id:'yuanqi-1',worldline_id:'ignored-mainline',
    created_from_event:hostEvent('second-event'),
  });
  assert.deepEqual(again,first);
  assert.equal(store.getSnapshot('worldline:main',0).snapshot_version,0);
  assert.equal(yuanqiDomain.table('worldline_events').get('worldline.created:worldline:main').event_type,'worldline.created');
  assert.deepEqual(Object.keys(store.getSelfModel('worldline:main').centers).sort(), [...SELF_MODEL_CENTER_IDS].sort());
});

test('fork preserves the parent snapshot reference and starts an independent local SelfModel', async () => {
  const {store}=await setup();
  await mainline(store);
  const child=await store.forkWorldline({
    yuanqi_subject_id:'yuanqi-1',parent_worldline_id:'worldline:main',
    target_worldline_id:'worldline:experiment-1',base_snapshot_version:0,
    created_from_event:hostEvent('fork-event'),
  });
  assert.equal(child.parent_worldline_id,'worldline:main');
  assert.equal(child.base_snapshot_version,0);
  const effective=store.getEffectiveSnapshot('worldline:experiment-1');
  assert.equal(effective.base_snapshot.snapshot_version,0);
  assert.equal(effective.local_snapshot.snapshot_version,0);
  assert.notEqual(effective.base_snapshot.state_payload,effective.local_snapshot.state_payload);
  assert.deepEqual(store.getSelfModel('worldline:experiment-1').centers.identity_continuity.content,{});
});

test('a Session is bound to a Worldline, and multiple Sessions may share one line', async () => {
  const {store}=await setup();
  await mainline(store);
  await store.bindSession({session_id:'session-a',yuanqi_subject_id:'yuanqi-1',worldline_id:'worldline:main',bound_from_event_ref:'e1'});
  await store.bindSession({session_id:'session-b',yuanqi_subject_id:'yuanqi-1',worldline_id:'worldline:main',bound_from_event_ref:'e2'});
  assert.equal(store.getSessionBinding('session-a').worldline_id,'worldline:main');
  assert.equal(store.getSessionBinding('session-b').worldline_id,'worldline:main');
  await store.forkWorldline({yuanqi_subject_id:'yuanqi-1',parent_worldline_id:'worldline:main',target_worldline_id:'worldline:child',base_snapshot_version:0,created_from_event:hostEvent('fork')});
  await assert.rejects(store.bindSession({session_id:'session-a',yuanqi_subject_id:'yuanqi-1',worldline_id:'worldline:child',bound_from_event_ref:'rebind'}),/already bound/);
});

test('runtime lease acquisition, renewal, release and fencing reject stale holders', async () => {
  const {store}=await setup();
  await mainline(store);
  const first=await store.acquireRuntimeLease({worldline_id:'worldline:main',holder_id:'runtime-A',now_ms:now,ttl_ms:1000});
  assert.equal(first.fencing_token,1);
  assert.equal(first.expires_at_ms,now+1000);
  await assert.rejects(
    store.acquireRuntimeLease({worldline_id:'worldline:main',holder_id:'runtime-B',now_ms:now+500,ttl_ms:1000}),
    /held by another runtime/,
  );
  const renewed=await store.renewRuntimeLease({
    worldline_id:'worldline:main',holder_id:'runtime-A',fencing_token:first.fencing_token,
    now_ms:now+500,ttl_ms:2000,
  });
  assert.equal(renewed.fencing_token,1);
  assert.equal(renewed.expires_at_ms,now+2500);
  await store.releaseRuntimeLease({
    worldline_id:'worldline:main',holder_id:'runtime-A',fencing_token:first.fencing_token,now_ms:now+600,
  });
  const second=await store.acquireRuntimeLease({worldline_id:'worldline:main',holder_id:'runtime-B',now_ms:now+700,ttl_ms:1000});
  assert.equal(second.fencing_token,2);
  await assert.rejects(
    store.renewRuntimeLease({worldline_id:'worldline:main',holder_id:'runtime-A',fencing_token:first.fencing_token,now_ms:now+800}),
    /expired, or fenced/,
  );
});

test('expired leases can be taken over and increment the fencing token', async () => {
  const {store}=await setup();
  await mainline(store);
  const first=await store.acquireRuntimeLease({worldline_id:'worldline:main',holder_id:'runtime-A',now_ms:now,ttl_ms:1000});
  const second=await store.acquireRuntimeLease({worldline_id:'worldline:main',holder_id:'runtime-B',now_ms:now+1000,ttl_ms:1000});
  assert.equal(second.fencing_token,first.fencing_token+1);
  await assert.rejects(
    store.releaseRuntimeLease({worldline_id:'worldline:main',holder_id:'runtime-A',fencing_token:first.fencing_token,now_ms:now+1001}),
    /expired, or fenced/,
  );
});

test('Snapshot CAS commits atomically and rejects stale or concurrent expected versions', async () => {
  const {store}=await setup();
  await mainline(store);
  const lease=await store.acquireRuntimeLease({worldline_id:'worldline:main',holder_id:'runtime-A',now_ms:now,ttl_ms:10000});
  const initial=store.getHead('worldline:main').current_state_payload;
  const updated=structuredClone(initial);
  updated.self_model.centers.identity_continuity={
    center_id:'identity_continuity',center_version:1,content:{summary:'tentative identity continuity'},
    evidence_refs:['event:user-confirmation-1'],uncertainty:['仅有一条来源记录'],
    epistemic_status:'evidence_supported',updated_from_event_ref:'event:user-confirmation-1',
  };
  const committed=await store.commitSnapshot({
    worldline_id:'worldline:main',holder_id:'runtime-A',fencing_token:lease.fencing_token,
    expected_snapshot_version:0,state_payload:updated,evidence_refs:['event:user-confirmation-1'],
    source_event_ref:'event:user-confirmation-1',now_ms:now+1,
  });
  assert.equal(committed.snapshot_version,1);
  assert.equal(store.getHead('worldline:main').current_snapshot_version,1);
  assert.equal(store.getSnapshot('worldline:main',1).state_payload.self_model.centers.identity_continuity.epistemic_status,'evidence_supported');
  await assert.rejects(store.commitSnapshot({
    worldline_id:'worldline:main',holder_id:'runtime-A',fencing_token:lease.fencing_token,
    expected_snapshot_version:0,state_payload:updated,source_event_ref:'stale',now_ms:now+2,
  }),/snapshot CAS conflict/);

  const nextA=structuredClone(store.getHead('worldline:main').current_state_payload);
  const nextB=structuredClone(nextA);
  nextA.self_model.centers.cognition_reflection.content={winner:'A'};
  nextB.self_model.centers.cognition_reflection.content={winner:'B'};
  const attempts=await Promise.allSettled([
    store.commitSnapshot({worldline_id:'worldline:main',holder_id:'runtime-A',fencing_token:lease.fencing_token,expected_snapshot_version:1,state_payload:nextA,source_event_ref:'concurrent-A',now_ms:now+3}),
    store.commitSnapshot({worldline_id:'worldline:main',holder_id:'runtime-A',fencing_token:lease.fencing_token,expected_snapshot_version:1,state_payload:nextB,source_event_ref:'concurrent-B',now_ms:now+3}),
  ]);
  assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(attempts.filter(x=>x.status==='rejected').length,1);
  assert.equal(store.getHead('worldline:main').current_snapshot_version,2);
});

test('five-center SelfModel stores evidence and uncertainty without treating model output as fact', async () => {
  const {store}=await setup();
  await mainline(store);
  const lease=await store.acquireRuntimeLease({worldline_id:'worldline:main',holder_id:'runtime-A',now_ms:now,ttl_ms:10000});
  const result=await store.updateSelfModelCenter({
    worldline_id:'worldline:main',holder_id:'runtime-A',fencing_token:lease.fencing_token,
    expected_snapshot_version:0,center_id:'cognition_reflection',
    content:{current_hypothesis:'可能偏好先验证再行动'},
    evidence_refs:['event:conversation-1'],uncertainty:['只基于一次对话，尚未稳定'],
    epistemic_status:'hypothesis',source_event_ref:'event:conversation-1',now_ms:now+1,
  });
  assert.equal(result.center.center_version,1);
  assert.equal(result.center.epistemic_status,'hypothesis');
  assert.deepEqual(result.center.uncertainty,['只基于一次对话，尚未稳定']);
  assert.equal(result.snapshot.snapshot_version,1);
  await assert.rejects(store.updateSelfModelCenter({
    worldline_id:'worldline:main',holder_id:'runtime-A',fencing_token:lease.fencing_token,
    expected_snapshot_version:1,center_id:'unknown-center',content:{},source_event_ref:'bad',now_ms:now+2,
  }),/unknown SelfModel center/);
  await assert.rejects(store.updateSelfModelCenter({
    worldline_id:'worldline:main',holder_id:'runtime-A',fencing_token:lease.fencing_token,
    expected_snapshot_version:1,center_id:'goals_agency',content:{goal:'unverified'},
    epistemic_status:'user_confirmed',source_event_ref:'bad',now_ms:now+2,
  }),/evidence references are required/);
  assert.deepEqual(Object.keys(store.getSelfModel('worldline:main').centers).sort(),[...SELF_MODEL_CENTER_IDS].sort());
});

test('Worldline operations reject missing subjects, snapshots, and unverified host events', async () => {
  const {store}=await setup();
  await assert.rejects(store.createMainline({yuanqi_subject_id:'missing',worldline_id:'x',created_from_event:hostEvent('e')}),/does not exist/);
  await assert.rejects(store.createMainline({yuanqi_subject_id:'yuanqi-1',worldline_id:'x',created_from_event:{event_id:'fake'}}),/unverified/);
  await mainline(store);
  await assert.rejects(store.forkWorldline({yuanqi_subject_id:'yuanqi-1',parent_worldline_id:'worldline:main',target_worldline_id:'child',base_snapshot_version:9,created_from_event:hostEvent('f')}),/parent snapshot does not exist/);
});

test('mainline creation recovers when the Worldline row persisted before its registry', async () => {
  const {store,yuanqiDomain}=await setup();
  const line={worldline_id:'worldline:main',yuanqi_subject_id:'yuanqi-1',status:'active',created_from_event_ref:'recovery-event'};
  await yuanqiDomain.table('worldlines').put('worldline:main',line);
  const recovered=await store.createMainline({
    yuanqi_subject_id:'yuanqi-1',worldline_id:'worldline:main',
    created_from_event:hostEvent('recovery-event'),
  });
  assert.deepEqual(recovered,line);
  assert.equal(store.getHead('worldline:main').current_snapshot_version,0);
  assert.equal(yuanqiDomain.table('worldline_mainlines').get('yuanqi-1').worldline_id,'worldline:main');
  assert.equal(yuanqiDomain.table('worldline_events').get('worldline.created:worldline:main').source_event_ref,'recovery-event');
});

test('a fenced-out runtime cannot commit after a new holder acquires the lease', async () => {
  const {store}=await setup();
  await mainline(store);
  const oldLease=await store.acquireRuntimeLease({worldline_id:'worldline:main',holder_id:'runtime-old',now_ms:now,ttl_ms:1000});
  const newLease=await store.acquireRuntimeLease({worldline_id:'worldline:main',holder_id:'runtime-new',now_ms:now+1000,ttl_ms:1000});
  const state=store.getHead('worldline:main').current_state_payload;
  await assert.rejects(store.commitSnapshot({
    worldline_id:'worldline:main',holder_id:'runtime-old',fencing_token:oldLease.fencing_token,
    expected_snapshot_version:0,state_payload:state,source_event_ref:'stale-writer',now_ms:now+1001,
  }),/expired, or fenced/);
  assert.equal(store.getHead('worldline:main').runtime_lease.fencing_token,newLease.fencing_token);
});
