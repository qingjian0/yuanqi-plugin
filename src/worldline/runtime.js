function requiredText(v,f){if(typeof v!=='string'||v.trim()==='')throw new TypeError(f+' is required');return v;}
function clone(v){return structuredClone(v);}
function serializeByKey(q,k,op){const p=q.get(k)??Promise.resolve();const r=p.then(op);const s=r.then(()=>undefined,()=>undefined);q.set(k,s);return r.finally(()=>{if(q.get(k)===s)q.delete(k);});}
async function putOnce(t,k,v,msg){const old=t.get(k);if(old!==undefined){if(JSON.stringify(old)!==JSON.stringify(v))throw new Error(msg);return clone(old);}await t.put(k,v);return clone(t.get(k)??v);}
function verifiedEvent(verifier,event,purpose){
 const e=verifier(event,purpose);if(!e||e.verified!==true)throw new Error('unverified DSH event: '+purpose);
 requiredText(e.event_id,'event_id');requiredText(e.source_event_ref??e.event_id,'source_event_ref');
 if(!['direct_user_event','host_event'].includes(e.source_kind))throw new TypeError('unsupported worldline event source');
 const date=new Date(e.occurred_at);if(!Number.isFinite(date.getTime()))throw new TypeError('valid DSH event time is required');
 return {...e,occurred_at:date.toISOString(),source_event_ref:e.source_event_ref??e.event_id};
}
export function createWorldlineStore({yuanqiDomain,verifyHostEvent}){
 if(!yuanqiDomain||typeof verifyHostEvent!=='function')throw new TypeError('YuanQi domain and trusted host-event verifier are required');
 const identities=yuanqiDomain.table('identities'),worldlines=yuanqiDomain.table('worldlines'),mainlines=yuanqiDomain.table('worldline_mainlines');
 const snapshots=yuanqiDomain.table('worldline_snapshots'),events=yuanqiDomain.table('worldline_events'),bindings=yuanqiDomain.table('session_worldline_bindings');
 const queues=new Map();
 function requireSubject(id){requiredText(id,'yuanqi_subject_id');if(!identities.get(id))throw new Error('YuanQiSubject does not exist');}
 function snapshotKey(id,version){return id+':'+version;}
 async function recordEvent({event_id,event_type,subject_id,worldline_id,occurred_at,source_kind,source_event_ref,payload}){
  const record={event_id,event_type,subject_id,subject_kind:'yuanqi',worldline_id,occurred_at,source_kind,source_event_ref,schema_version:1,payload};
  return putOnce(events,event_id,record,'worldline event conflict');
 }
 async function createMainline({yuanqi_subject_id,worldline_id,created_from_event}){
  requiredText(worldline_id,'worldline_id');requireSubject(yuanqi_subject_id);
  const source=verifiedEvent(verifyHostEvent,created_from_event,'worldline-created');
  return serializeByKey(queues,'mainline:'+yuanqi_subject_id,async()=>{
   const registered=mainlines.get(yuanqi_subject_id);
   if(registered)return clone(worldlines.get(registered.worldline_id));
   const record={worldline_id,yuanqi_subject_id,status:'active',created_from_event_ref:source.source_event_ref};
   const snap={snapshot_id:snapshotKey(worldline_id,0),worldline_id,yuanqi_subject_id,snapshot_version:0,state_payload:{},evidence_refs:[],created_at_event_ref:source.source_event_ref};
   await putOnce(snapshots,snapshotKey(worldline_id,0),snap,'mainline snapshot conflict');
   await putOnce(worldlines,worldline_id,record,'mainline worldline conflict');
   await recordEvent({event_id:'worldline.created:'+worldline_id,event_type:'worldline.created',subject_id:yuanqi_subject_id,worldline_id,occurred_at:source.occurred_at,source_kind:source.source_kind,source_event_ref:source.source_event_ref,payload:{parent_worldline_id:null,base_snapshot_version:0}});
   await putOnce(mainlines,yuanqi_subject_id,{yuanqi_subject_id,worldline_id,created_from_event_ref:source.source_event_ref},'mainline registry conflict');
   return clone(record);
  });
 }
 async function forkWorldline({yuanqi_subject_id,parent_worldline_id,target_worldline_id,base_snapshot_version,created_from_event}){
  requiredText(target_worldline_id,'target_worldline_id');requireSubject(yuanqi_subject_id);
  if(!Number.isSafeInteger(base_snapshot_version)||base_snapshot_version<0)throw new TypeError('base snapshot version must be a non-negative integer');
  const source=verifiedEvent(verifyHostEvent,created_from_event,'worldline-forked');
  return serializeByKey(queues,'worldline:'+target_worldline_id,async()=>{
   const parent=worldlines.get(parent_worldline_id);
   if(!parent||parent.yuanqi_subject_id!==yuanqi_subject_id||parent.status!=='active')throw new Error('active parent Worldline for this YuanQiSubject is required');
   const base=snapshots.get(snapshotKey(parent_worldline_id,base_snapshot_version));
   if(!base)throw new Error('parent snapshot does not exist');
   const existing=worldlines.get(target_worldline_id);
   if(existing&&(existing.yuanqi_subject_id!==yuanqi_subject_id||existing.parent_worldline_id!==parent_worldline_id||existing.base_snapshot_version!==base_snapshot_version||existing.created_from_event_ref!==source.source_event_ref))throw new Error('target Worldline already exists with different lineage or creation event');
   const record=existing??{worldline_id:target_worldline_id,yuanqi_subject_id,parent_worldline_id,base_snapshot_version,status:'active',created_from_event_ref:source.source_event_ref};
   const local={snapshot_id:snapshotKey(target_worldline_id,0),worldline_id:target_worldline_id,yuanqi_subject_id,snapshot_version:0,state_payload:{},evidence_refs:[],created_at_event_ref:record.created_from_event_ref};
   await putOnce(snapshots,snapshotKey(target_worldline_id,0),local,'fork local snapshot conflict');
   await putOnce(worldlines,target_worldline_id,record,'fork Worldline conflict');
   await recordEvent({event_id:'worldline.forked:'+target_worldline_id,event_type:'worldline.forked',subject_id:yuanqi_subject_id,worldline_id:target_worldline_id,occurred_at:source.occurred_at,source_kind:source.source_kind,source_event_ref:source.source_event_ref,payload:{parent_worldline_id,base_snapshot_version}});
   return clone(record);
  });
 }
 async function bindSession({session_id,yuanqi_subject_id,worldline_id,bound_from_event_ref}){
  requiredText(session_id,'session_id');requiredText(bound_from_event_ref,'bound_from_event_ref');requireSubject(yuanqi_subject_id);
  return serializeByKey(queues,'session:'+session_id,async()=>{
   const line=worldlines.get(worldline_id);if(!line||line.yuanqi_subject_id!==yuanqi_subject_id||line.status!=='active')throw new Error('active Worldline for this YuanQiSubject is required');
   const old=bindings.get(session_id);if(old){if(old.yuanqi_subject_id!==yuanqi_subject_id||old.worldline_id!==worldline_id)throw new Error('Session is already bound to a different Worldline');return clone(old);}
   return putOnce(bindings,session_id,{session_id,yuanqi_subject_id,worldline_id,bound_from_event_ref,schema_version:1},'Session Worldline binding conflict');
  });
 }
 return Object.freeze({
  createMainline,forkWorldline,bindSession,
  getWorldline(id){requiredText(id,'worldline_id');const v=worldlines.get(id);return v===undefined?undefined:clone(v);},
  getSessionBinding(id){requiredText(id,'session_id');const v=bindings.get(id);return v===undefined?undefined:clone(v);},
  getSnapshot(id,version){requiredText(id,'worldline_id');const v=snapshots.get(snapshotKey(id,version));return v===undefined?undefined:clone(v);},
  getEffectiveSnapshot(id){
   requiredText(id,'worldline_id');const line=worldlines.get(id);if(!line)return undefined;
   const local=snapshots.get(snapshotKey(id,0));if(!local)throw new Error('Worldline local snapshot is missing');
   const base=line.parent_worldline_id?snapshots.get(snapshotKey(line.parent_worldline_id,line.base_snapshot_version)):undefined;
   if(line.parent_worldline_id&&!base)throw new Error('Worldline base snapshot reference is unavailable');
   return {worldline:clone(line),base_snapshot:base===undefined?null:clone(base),local_snapshot:clone(local)};
  },
 });
}
