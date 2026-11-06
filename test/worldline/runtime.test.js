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
    'worldline_events','session_worldline_bindings','worldline_heads','evidence_records','evidence_revocations','evidence_assessments','transfer_authorizations','transfer_authorization_revocations','evidence_transfers',
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
async function seedEvidence(store, evidenceId, worldlineId='worldline:main', statement='seeded evidence') {
  return store.recordEvidence({
    evidence_id:evidenceId,yuanqi_subject_id:'yuanqi-1',worldline_id:worldlineId,
    evidence_type:'test_fixture',content:{statement},provenance:{fixture:true},
    captured_from_event:hostEvent('seed:'+evidenceId),
  });
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
  await seedEvidence(store,'event:user-confirmation-1');
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
  await seedEvidence(store,'event:conversation-1');
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


test('Evidence Ledger is immutable, Worldline-scoped, and revocation is append-only', async () => {
  const {store}=await setup();
  await mainline(store);
  await store.forkWorldline({
    yuanqi_subject_id:'yuanqi-1',parent_worldline_id:'worldline:main',
    target_worldline_id:'worldline:child',base_snapshot_version:0,
    created_from_event:hostEvent('evidence-fork'),
  });
  const captured=await store.recordEvidence({
    evidence_id:'evidence:main:1',yuanqi_subject_id:'yuanqi-1',
    worldline_id:'worldline:main',evidence_type:'user_statement',
    content:{statement:'用户明确表达的一条陈述'},
    provenance:{channel:'dsh-session-event',event_sequence:17},
    captured_from_event:hostEvent('evidence-source'),
  });
  assert.equal(captured.evidence_id,'evidence:main:1');
  assert.equal(store.getEvidenceRecord({evidence_id:'evidence:main:1',worldline_id:'worldline:main'}).status,'active');
  assert.equal(store.getEvidenceRecord({evidence_id:'evidence:main:1',worldline_id:'worldline:child'}),undefined);
  assert.deepEqual(await store.recordEvidence({
    evidence_id:'evidence:main:1',yuanqi_subject_id:'yuanqi-1',
    worldline_id:'worldline:main',evidence_type:'user_statement',
    content:{statement:'用户明确表达的一条陈述'},
    provenance:{channel:'dsh-session-event',event_sequence:17},
    captured_from_event:hostEvent('evidence-source'),
  }),captured);
  await assert.rejects(store.recordEvidence({
    evidence_id:'evidence:main:1',yuanqi_subject_id:'yuanqi-1',
    worldline_id:'worldline:main',evidence_type:'user_statement',
    content:{statement:'被篡改的内容'},
    provenance:{channel:'dsh-session-event',event_sequence:17},
    captured_from_event:hostEvent('evidence-source'),
  }),/immutable provenance/);
  await assert.rejects(store.revokeEvidence({
    evidence_id:'evidence:main:1',worldline_id:'worldline:main',
    reason:'用户要求撤销',revoked_from_event:{...hostEvent('host-revoke',now+1),source_kind:'host_event'},
  }),/direct user event/);
  const revoked=await store.revokeEvidence({
    evidence_id:'evidence:main:1',worldline_id:'worldline:main',
    reason:'用户要求撤销',revoked_from_event:hostEvent('user-revoke',now+2),
  });
  assert.equal(revoked.revoked_from_event_ref,'user-revoke');
  const view=store.getEvidenceRecord({evidence_id:'evidence:main:1',worldline_id:'worldline:main'});
  assert.equal(view.status,'revoked');
  assert.equal(view.record.content.statement,'用户明确表达的一条陈述');
  assert.equal(view.revocation.reason,'用户要求撤销');
  assert.deepEqual(await store.revokeEvidence({
    evidence_id:'evidence:main:1',worldline_id:'worldline:main',
    reason:'用户要求撤销',revoked_from_event:hostEvent('user-revoke',now+2),
  }),revoked);
  await assert.rejects(store.revokeEvidence({
    evidence_id:'evidence:main:1',worldline_id:'worldline:main',
    reason:'另一个撤销原因',revoked_from_event:hostEvent('user-revoke-2',now+3),
  }),/different revocation record/);
  await assert.rejects(store.revokeEvidence({
    evidence_id:'evidence:main:1',worldline_id:'worldline:child',
    reason:'跨线撤销',revoked_from_event:hostEvent('user-revoke-3',now+4),
  }),/requested Worldline scope/);
});

test('Evidence Ledger rejects inactive or cross-subject Worldline writes', async () => {
  const {store,yuanqiDomain}=await setup();
  await mainline(store);
  await yuanqiDomain.table('worldlines').put('worldline:archived',{
    worldline_id:'worldline:archived',yuanqi_subject_id:'yuanqi-1',
    status:'archived',created_from_event_ref:'archive-event',
  });
  await assert.rejects(store.recordEvidence({
    evidence_id:'evidence:archived',yuanqi_subject_id:'yuanqi-1',
    worldline_id:'worldline:archived',evidence_type:'observation',
    content:{value:1},captured_from_event:hostEvent('archived-evidence'),
  }),/active Worldline/);
  await assert.rejects(store.recordEvidence({
    evidence_id:'evidence:wrong-subject',yuanqi_subject_id:'other-subject',
    worldline_id:'worldline:main',evidence_type:'observation',
    content:{value:1},captured_from_event:hostEvent('wrong-subject-evidence'),
  }),/does not exist/);
  await assert.rejects(store.recordEvidence({
    evidence_id:'evidence:bad-content',yuanqi_subject_id:'yuanqi-1',
    worldline_id:'worldline:main',evidence_type:'observation',
    content:'not-an-object',captured_from_event:hostEvent('bad-content'),
  }),/must be an object/);
});


test('concurrent conflicting evidence IDs serialize to one immutable winner', async () => {
  const {store}=await setup();
  await mainline(store);
  const attempts=await Promise.allSettled([
    store.recordEvidence({
      evidence_id:'evidence:race',yuanqi_subject_id:'yuanqi-1',
      worldline_id:'worldline:main',evidence_type:'observation',
      content:{value:'A'},provenance:{writer:'A'},
      captured_from_event:hostEvent('evidence-race-A'),
    }),
    store.recordEvidence({
      evidence_id:'evidence:race',yuanqi_subject_id:'yuanqi-1',
      worldline_id:'worldline:main',evidence_type:'observation',
      content:{value:'B'},provenance:{writer:'B'},
      captured_from_event:hostEvent('evidence-race-B'),
    }),
  ]);
  assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(attempts.filter(x=>x.status==='rejected').length,1);
  const stored=store.getEvidenceRecord({evidence_id:'evidence:race',worldline_id:'worldline:main'});
  assert.ok(['A','B'].includes(stored.record.content.value));
});


test('evidence assessments preserve evaluator, uncertainty and immutable provenance', async () => {
  const {store}=await setup();
  await mainline(store);
  await seedEvidence(store,'evidence:assess:1');
  await seedEvidence(store,'evidence:assess:2');
  const assessment=await store.assessEvidence({
    assessment_id:'assessment:1',evidence_id:'evidence:assess:1',worldline_id:'worldline:main',
    outcome:'corroborated',assessor_kind:'model',rationale:'第二条独立记录提供一致支持',
    confidence:0.72,corroborating_evidence_refs:['evidence:assess:2'],
    assessed_from_event:hostEvent('assessment-event'),
  });
  assert.equal(assessment.outcome,'corroborated');
  assert.equal(assessment.assessor_kind,'model');
  assert.equal(store.getEvidenceAssessment({assessment_id:'assessment:1',worldline_id:'worldline:main'}).status,'active');
  await assert.rejects(store.assessEvidence({
    assessment_id:'assessment:1',evidence_id:'evidence:assess:1',worldline_id:'worldline:main',
    outcome:'contradicted',assessor_kind:'model',rationale:'conflicting rewrite',
    assessed_from_event:hostEvent('assessment-event'),
  }),/different immutable content/);
  await assert.rejects(store.assessEvidence({
    assessment_id:'assessment:user-bad',evidence_id:'evidence:assess:1',worldline_id:'worldline:main',
    outcome:'corroborated',assessor_kind:'user',rationale:'user claim',
    assessed_from_event:{...hostEvent('host-assessment'),source_kind:'host_event'},
  }),/direct user event/);
  await store.revokeEvidence({
    evidence_id:'evidence:assess:1',worldline_id:'worldline:main',reason:'撤销原证据',
    revoked_from_event:hostEvent('assessment-source-revoked',now+1),
  });
  assert.equal(store.getEvidenceAssessment({assessment_id:'assessment:1',worldline_id:'worldline:main'}).status,'stale');
});

test('SelfModel commits reject missing, cross-line and revoked evidence references', async () => {
  const {store}=await setup();
  await mainline(store);
  await store.forkWorldline({
    yuanqi_subject_id:'yuanqi-1',parent_worldline_id:'worldline:main',
    target_worldline_id:'worldline:child-evidence',base_snapshot_version:0,
    created_from_event:hostEvent('evidence-child-fork'),
  });
  await seedEvidence(store,'evidence:valid');
  await seedEvidence(store,'evidence:child-only','worldline:child-evidence');
  const lease=await store.acquireRuntimeLease({worldline_id:'worldline:main',holder_id:'runtime-A',now_ms:now,ttl_ms:10000});
  const state=structuredClone(store.getHead('worldline:main').current_state_payload);
  state.self_model.centers.experience_memory.evidence_refs=['evidence:valid'];
  await store.revokeEvidence({
    evidence_id:'evidence:valid',worldline_id:'worldline:main',reason:'撤销测试证据',
    revoked_from_event:hostEvent('evidence-valid-revoked',now+1),
  });
  await assert.rejects(store.commitSnapshot({
    worldline_id:'worldline:main',holder_id:'runtime-A',fencing_token:lease.fencing_token,
    expected_snapshot_version:0,state_payload:state,source_event_ref:'revoked-ref',now_ms:now+2,
  }),/evidence reference is revoked/);
  state.self_model.centers.experience_memory.evidence_refs=['missing-evidence'];
  await assert.rejects(store.commitSnapshot({
    worldline_id:'worldline:main',holder_id:'runtime-A',fencing_token:lease.fencing_token,
    expected_snapshot_version:0,state_payload:state,source_event_ref:'missing-ref',now_ms:now+2,
  }),/missing or outside Worldline scope/);
  state.self_model.centers.experience_memory.evidence_refs=['evidence:child-only'];
  await assert.rejects(store.commitSnapshot({
    worldline_id:'worldline:main',holder_id:'runtime-A',fencing_token:lease.fencing_token,
    expected_snapshot_version:0,state_payload:state,source_event_ref:'cross-ref',now_ms:now+2,
  }),/missing or outside Worldline scope/);
});

test('cross-Worldline transfer requires explicit user authorization and preserves source revocation lineage', async () => {
  const {store}=await setup();
  await mainline(store);
  await store.forkWorldline({
    yuanqi_subject_id:'yuanqi-1',parent_worldline_id:'worldline:main',
    target_worldline_id:'worldline:target',base_snapshot_version:0,
    created_from_event:hostEvent('transfer-fork'),
  });
  await seedEvidence(store,'evidence:transfer:1');
  const authorization=await store.authorizeEvidenceTransfer({
    authorization_id:'authorization:1',yuanqi_subject_id:'yuanqi-1',
    source_worldline_id:'worldline:main',target_worldline_id:'worldline:target',
    evidence_ids:['evidence:transfer:1'],expires_at_ms:now+60000,
    authorized_from_event:hostEvent('authorize-transfer'),now_ms:now,
  });
  assert.deepEqual(authorization.evidence_ids,['evidence:transfer:1']);
  await assert.rejects(store.transferEvidence({
    authorization_id:'authorization:1',evidence_id:'evidence:outside',
    transferred_from_event:hostEvent('transfer-outside'),now_ms:now+1,
  }),/outside the explicit transfer authorization scope/);
  const audit=await store.transferEvidence({
    authorization_id:'authorization:1',evidence_id:'evidence:transfer:1',
    transferred_from_event:hostEvent('transfer-event'),now_ms:now+1,
  });
  assert.equal(audit.source_worldline_id,'worldline:main');
  assert.equal(audit.target_worldline_id,'worldline:target');
  const copied=store.getEvidenceRecord({evidence_id:audit.target_evidence_id,worldline_id:'worldline:target'});
  assert.equal(copied.status,'active');
  assert.equal(copied.record.transferred_from.evidence_id,'evidence:transfer:1');
  assert.deepEqual(await store.transferEvidence({
    authorization_id:'authorization:1',evidence_id:'evidence:transfer:1',
    transferred_from_event:hostEvent('transfer-event'),now_ms:now+2,
  }),audit);
  await store.revokeEvidence({
    evidence_id:'evidence:transfer:1',worldline_id:'worldline:main',reason:'源证据撤销',
    revoked_from_event:hostEvent('source-evidence-revoked',now+3),
  });
  assert.equal(store.getEvidenceRecord({evidence_id:audit.target_evidence_id,worldline_id:'worldline:target'}).status,'revoked');
});

test('transfer authorization is revocable, time-limited and audited', async () => {
  const {store}=await setup();
  await mainline(store);
  await store.forkWorldline({
    yuanqi_subject_id:'yuanqi-1',parent_worldline_id:'worldline:main',
    target_worldline_id:'worldline:target',base_snapshot_version:0,
    created_from_event:hostEvent('transfer-fork-2'),
  });
  await seedEvidence(store,'evidence:transfer:2');
  await store.authorizeEvidenceTransfer({
    authorization_id:'authorization:revoked',yuanqi_subject_id:'yuanqi-1',
    source_worldline_id:'worldline:main',target_worldline_id:'worldline:target',
    evidence_ids:['evidence:transfer:2'],expires_at_ms:now+60000,
    authorized_from_event:hostEvent('authorize-revoked'),now_ms:now,
  });
  await store.revokeTransferAuthorization({
    authorization_id:'authorization:revoked',reason:'用户撤销跨线授权',
    revoked_from_event:hostEvent('revoke-transfer-auth',now+1),
  });
  await assert.rejects(store.transferEvidence({
    authorization_id:'authorization:revoked',evidence_id:'evidence:transfer:2',
    transferred_from_event:hostEvent('transfer-after-revoke'),now_ms:now+2,
  }),/authorization has been revoked/);
  await assert.rejects(store.transferEvidence({
    authorization_id:'authorization:revoked',evidence_id:'evidence:transfer:2',
    transferred_from_event:hostEvent('transfer-expired'),now_ms:now+70000,
  }),/authorization has been revoked/);
});


test('user-confirmed SelfModel state requires a verified direct-user event', async () => {
  const {store}=await setup();
  await mainline(store);
  await seedEvidence(store,'evidence:user-confirmed');
  const lease=await store.acquireRuntimeLease({worldline_id:'worldline:main',holder_id:'runtime-confirm',now_ms:now,ttl_ms:10000});
  await assert.rejects(store.updateSelfModelCenter({
    worldline_id:'worldline:main',holder_id:'runtime-confirm',fencing_token:lease.fencing_token,
    expected_snapshot_version:0,center_id:'identity_continuity',content:{statement:'confirmed'},
    evidence_refs:['evidence:user-confirmed'],epistemic_status:'user_confirmed',
    source_event_ref:'model-generated-event',
    confirmation_event:{...hostEvent('not-a-user-confirmation'),source_kind:'host_event'},now_ms:now+1,
  }),/verified direct user event/);
  const result=await store.updateSelfModelCenter({
    worldline_id:'worldline:main',holder_id:'runtime-confirm',fencing_token:lease.fencing_token,
    expected_snapshot_version:0,center_id:'identity_continuity',content:{statement:'confirmed'},
    evidence_refs:['evidence:user-confirmed'],epistemic_status:'user_confirmed',
    source_event_ref:'self-model-update',
    confirmation_event:hostEvent('actual-user-confirmation'),now_ms:now+2,
  });
  assert.equal(result.center.epistemic_status,'user_confirmed');
  assert.equal(result.center.confirmation_event_ref,'actual-user-confirmation');
  const next=structuredClone(store.getHead('worldline:main').current_state_payload);
  next.self_model.centers.cognition_reflection.content={note:'unrelated change'};
  await store.commitSnapshot({
    worldline_id:'worldline:main',holder_id:'runtime-confirm',fencing_token:lease.fencing_token,
    expected_snapshot_version:1,state_payload:next,source_event_ref:'unrelated-snapshot',now_ms:now+3,
  });
  const forged=structuredClone(store.getHead('worldline:main').current_state_payload);
  forged.self_model.centers.identity_continuity.content={statement:'silently changed'};
  await assert.rejects(store.commitSnapshot({
    worldline_id:'worldline:main',holder_id:'runtime-confirm',fencing_token:lease.fencing_token,
    expected_snapshot_version:2,state_payload:forged,source_event_ref:'forged-confirmation-change',now_ms:now+4,
  }),/direct-user confirmation path/);
});


test('Worldline integrity audit is read-only and reports a healthy mainline', async () => {
  const {store,yuanqiDomain}=await setup();
  await mainline(store);
  const before=structuredClone(yuanqiDomain.table('worldline_heads').get('worldline:main'));
  const first=store.auditWorldline({worldline_id:'worldline:main',now_ms:now});
  const second=store.auditWorldline({worldline_id:'worldline:main',now_ms:now});
  assert.equal(first.status,'healthy');
  assert.deepEqual(first.issues,[]);
  assert.deepEqual(second,first);
  assert.deepEqual(yuanqiDomain.table('worldline_heads').get('worldline:main'),before);
});

test('Worldline integrity audit detects snapshot history gaps and head divergence', async () => {
  const {store,yuanqiDomain}=await setup();
  await mainline(store);
  const head=structuredClone(store.getHead('worldline:main'));
  head.snapshot_history[0].snapshot_version=3;
  await yuanqiDomain.table('worldline_heads').put('worldline:main',head);
  const report=store.auditWorldline({worldline_id:'worldline:main',now_ms:now});
  assert.equal(report.status,'critical');
  assert.ok(report.issues.some(issue=>issue.code==='snapshot.history_gap_or_reorder'));
  assert.ok(report.issues.some(issue=>issue.code==='snapshot.head_version_mismatch'));
  assert.equal(report.repair_policy,'manual_only');
});

test('Worldline integrity audit distinguishes revoked evidence and a missing Head', async () => {
  const {store,yuanqiDomain}=await setup();
  await mainline(store);
  await seedEvidence(store,'evidence:audit');
  const lease=await store.acquireRuntimeLease({worldline_id:'worldline:main',holder_id:'audit-runtime',now_ms:now,ttl_ms:10000});
  await store.commitSnapshot({
    worldline_id:'worldline:main',holder_id:'audit-runtime',fencing_token:lease.fencing_token,
    expected_snapshot_version:0,state_payload:store.getHead('worldline:main').current_state_payload,
    evidence_refs:['evidence:audit'],source_event_ref:'audit-snapshot',now_ms:now+1,
  });
  await store.revokeEvidence({
    evidence_id:'evidence:audit',worldline_id:'worldline:main',reason:'audit fixture revoked',
    revoked_from_event:hostEvent('audit-revocation',now+2),
  });
  const revokedReport=store.auditWorldline({worldline_id:'worldline:main',now_ms:now+3});
  assert.equal(revokedReport.status,'degraded');
  assert.ok(revokedReport.issues.some(issue=>issue.code==='evidence.reference_revoked'));
  await yuanqiDomain.table('worldlines').put('worldline:orphan', {
    worldline_id:'worldline:orphan',yuanqi_subject_id:'yuanqi-1',status:'active',
    created_from_event_ref:'orphan-created',
  });
  const orphanReport=store.auditWorldline({worldline_id:'worldline:orphan',now_ms:now+4});
  assert.equal(orphanReport.status,'critical');
  assert.ok(orphanReport.issues.some(issue=>issue.code==='worldline.head_missing'));
});


test('Worldline integrity audit safely identifies cyclic transferred evidence lineage', async () => {
  const {store,yuanqiDomain}=await setup();
  await mainline(store);
  await seedEvidence(store,'evidence:cycle');
  const lease=await store.acquireRuntimeLease({worldline_id:'worldline:main',holder_id:'cycle-audit',now_ms:now,ttl_ms:10000});
  await store.commitSnapshot({
    worldline_id:'worldline:main',holder_id:'cycle-audit',fencing_token:lease.fencing_token,
    expected_snapshot_version:0,state_payload:store.getHead('worldline:main').current_state_payload,
    evidence_refs:['evidence:cycle'],source_event_ref:'cycle-snapshot',now_ms:now+1,
  });
  const record=yuanqiDomain.table('evidence_records').get('evidence:cycle');
  await yuanqiDomain.table('evidence_records').put('evidence:cycle',{
    ...record,
    transferred_from:{evidence_id:'evidence:cycle',worldline_id:'worldline:main',authorization_id:'missing-auth'},
  });
  const report=store.auditWorldline({worldline_id:'worldline:main',now_ms:now+2});
  assert.equal(report.status,'critical');
  assert.ok(report.issues.some(issue=>issue.code==='evidence.transfer_lineage_invalid'));
  assert.ok(report.issues.some(issue=>issue.code==='transfer.lineage_inconsistent'));
});
