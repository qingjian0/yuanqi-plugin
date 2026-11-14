import test from 'node:test';
import assert from 'node:assert/strict';
import {createSubjectStore} from '../../src/domain/subject-store.js';
function memoryDomain(names){const maps=new Map(names.map(n=>[n,new Map()]));return{table(n){const m=maps.get(n);if(!m)throw Error('unknown table '+n);return{get:k=>m.get(k),async put(k,v){m.set(k,structuredClone(v));},async update(k,fn){const v=fn(m.get(k));m.set(k,structuredClone(v));}};}};}
function store(){const u=memoryDomain(['identities','birth_profiles']),y=memoryDomain(['identities','installation_state','first_user_messages','wake_records']);return createSubjectStore({userDomain:u,yuanqiDomain:y,verifyDirectUserEvent:e=>e?.trusted&&e?.event_type==='user/message'&&e?.source_kind==='user'?{...e,verified:true}:null,verifyBirthProfileConfirmation:e=>e?.trusted&&e?.explicit?{...e,verified:true}:null});}
const event=(v={})=>({trusted:true,event_type:'user/message',source_kind:'user',session_id:'s1',event_id:'e1',event_seq:0,event_time:1793966400000,text:'启动元炁',...v});
test('UserSubject and YuanQiSubject namespaces are isolated',async()=>{const s=store();await s.createUserSubject({subject_id:'same',created_from_event_ref:'u'});await s.createYuanQiSubject({subject_id:'same',created_from_event_ref:'y'});assert.equal(s.getUserSubject('same').subject_kind,'user');assert.equal(s.getYuanQiSubject('same').subject_kind,'yuanqi');});
test('birth profile requires an existing UserSubject and verified confirmation',async()=>{const s=store();await s.createUserSubject({subject_id:'u1',created_from_event_ref:'e'});await assert.rejects(s.confirmUserBirthProfile({profile_id:'b1',subject_id:'u1',facts:{},confirmation_event:{trusted:true,explicit:false,event_id:'x'}}),/unverified/);const p=await s.confirmUserBirthProfile({profile_id:'b1',subject_id:'u1',facts:{birth_date:'1998-04-21'},confirmation_event:{trusted:true,explicit:true,event_id:'ok'}});assert.equal(p.confirmation_event_ref,'ok');});
test('injected user-role content cannot create first-message lock',async()=>{const s=store();await s.createYuanQiSubject({subject_id:'y1',created_from_event_ref:'e'});await assert.rejects(s.recordFirstUserMessage({subject_id:'y1',direct_user_event:event({source_kind:'system-prompt'})}),/unverified/);assert.equal(s.getFirstUserMessage('y1'),undefined);});
test('a later exact startup command wakes after an earlier non-command message',async()=>{const s=store();await s.createYuanQiSubject({subject_id:'y1',created_from_event_ref:'e'});assert.equal(await s.recordInitialWake({subject_id:'y1',direct_user_event:event({text:'你好'})}),undefined);const wake=await s.recordInitialWake({subject_id:'y1',direct_user_event:event({session_id:'s2',event_id:'e2',event_seq:0,event_time:1794052800000})});assert.equal(s.getFirstUserMessage('y1').first_session_id,'s1');assert.equal(s.getFirstUserMessage('y1').trigger_command,null);assert.equal(wake.wake_event_ref,'e2');assert.equal(wake.first_session_id,'s2');assert.equal(wake.birth_time,new Date(1794052800000).toISOString());});
test('whitespace, quotes and appended text do not match startup commands',async()=>{for(const text of [' 启动元炁','启动元炁 ','"启动元炁"','启动元炁！','请启动元炁','启动元气\n']){const s=store();await s.createYuanQiSubject({subject_id:'y1',created_from_event_ref:'e'});assert.equal(await s.recordInitialWake({subject_id:'y1',direct_user_event:event({text})}),undefined,text);assert.equal(s.getFirstUserMessage('y1').trigger_command,null,text);}});
test('exact first-message command creates one wake using persisted DSH event time',async()=>{const s=store();await s.createYuanQiSubject({subject_id:'y1',created_from_event_ref:'e'});const a=await s.recordInitialWake({subject_id:'y1',direct_user_event:event()});const b=await s.recordInitialWake({subject_id:'y1',direct_user_event:event({session_id:'s2',event_id:'e2',event_seq:1,event_time:1794052800000})});const later=await s.recordInitialWake({subject_id:'y1',direct_user_event:event({session_id:'s3',event_id:'e3',event_seq:2,event_time:1794052801000,text:'后续消息'})});assert.deepEqual(a,b);assert.deepEqual(a,later);assert.equal(a.first_session_id,'s1');assert.equal(a.first_event_seq,0);assert.equal(a.wake_event_ref,'e1');assert.equal(a.occurred_at,new Date(1793966400000).toISOString());assert.equal(a.birth_time,a.occurred_at);assert.deepEqual(a.birth_location,{status:'unavailable',latitude:null,longitude:null,accuracy_meters:null,place_label:null,time_zone_id:null,source:'unavailable',captured_at:null});});
test('wake record can be recovered after first-message lock persisted',async()=>{const s=store();await s.createYuanQiSubject({subject_id:'y1',created_from_event_ref:'e'});await s.recordFirstUserMessage({subject_id:'y1',direct_user_event:event()});assert.equal(s.getWakeRecord('y1'),undefined);const r=await s.recoverInitialWake({subject_id:'y1'});assert.equal(r.wake_event_ref,'e1');assert.equal(r.birth_time,new Date(1793966400000).toISOString());});

test('installation activation boundary is durable and never refreshed on restart',async()=>{
 const s=store();
 const first=await s.getOrCreateInstallationBoundary(1000);
 const second=await s.getOrCreateInstallationBoundary(2000);
 assert.deepEqual(first,second);
 assert.equal(first.activated_at_ms,1000);
});

test('pending birth location can be completed exactly once without changing the wake event',async()=>{
 const s=store();
 await s.createYuanQiSubject({subject_id:'y1',created_from_event_ref:'e'});
 const pending={status:'pending',latitude:null,longitude:null,accuracy_meters:null,place_label:null,time_zone_id:null,source:'unavailable',captured_at:null};
 const wake=await s.recordInitialWake({subject_id:'y1',direct_user_event:event(),birth_location:pending});
 const captured={status:'captured',latitude:31.23,longitude:121.47,accuracy_meters:15,place_label:null,time_zone_id:null,source:'host_location_provider',captured_at:new Date(1793966400000).toISOString()};
 const completed=await s.completeInitialWakeLocation({subject_id:'y1',birth_location:captured});
 const second=await s.completeInitialWakeLocation({subject_id:'y1',birth_location:{status:'unavailable',latitude:null,longitude:null,accuracy_meters:null,place_label:null,time_zone_id:null,source:'unavailable',captured_at:null}});
 assert.equal(completed.wake_event_ref,wake.wake_event_ref);
 assert.equal(completed.birth_time,wake.birth_time);
 assert.deepEqual(completed.birth_location,captured);
 assert.deepEqual(second.birth_location,captured);
});
