const COMMANDS=new Set(['启动元气','启动元炁']);
function requiredText(v,f){if(typeof v!=='string'||v.trim()==='')throw new TypeError(f+' is required');return v;}
function clone(v){return structuredClone(v);}
function serializeByKey(q,k,op){const p=q.get(k)??Promise.resolve();const r=p.then(op);const s=r.then(()=>undefined,()=>undefined);q.set(k,s);return r.finally(()=>{if(q.get(k)===s)q.delete(k);});}
async function putOnce(t,k,v,msg){const old=t.get(k);if(old!==undefined){if(JSON.stringify(old)!==JSON.stringify(v))throw new Error(msg);return clone(old);}await t.put(k,v);return clone(t.get(k)??v);}
function verified(fn,event,purpose){const v=fn(event,purpose);if(!v||v.verified!==true)throw new Error('unverified DSH event: '+purpose);return v;}
function firstMessageFields(e){
 if(e.event_type!=='user/message'||e.source_kind!=='user')throw new Error('only direct DSH user/message events may establish the first-message lock');
 requiredText(e.session_id,'session_id');requiredText(e.event_id,'event_id');
 if(!Number.isSafeInteger(e.event_seq)||e.event_seq<0)throw new TypeError('valid DSH event sequence is required');
 if(!Number.isSafeInteger(e.event_time)||e.event_time<0)throw new TypeError('valid DSH event time is required');
 if(typeof e.text!=='string')throw new TypeError('direct user message text is required');
 return {first_session_id:e.session_id,first_event_id:e.event_id,first_event_seq:e.event_seq,first_event_time:e.event_time,source_kind:'user',event_type:'user/message',trigger_command:COMMANDS.has(e.text)?e.text:null};
}
export function createSubjectStore({userDomain,yuanqiDomain,verifyDirectUserEvent,verifyBirthProfileConfirmation}){
 if(!userDomain||!yuanqiDomain)throw new TypeError('both DSH subject domains are required');
 if(typeof verifyDirectUserEvent!=='function'||typeof verifyBirthProfileConfirmation!=='function')throw new TypeError('host event verifiers are required');
 const users=userDomain.table('identities'),births=userDomain.table('birth_profiles'),yuanqis=yuanqiDomain.table('identities');
 const installationState=yuanqiDomain.table('installation_state');
 const firstMessages=yuanqiDomain.table('first_user_messages'),wakes=yuanqiDomain.table('wake_records'),queues=new Map();
 async function identity(table,kind,id,ref){requiredText(id,'subject_id');requiredText(ref,'created_from_event_ref');const v={subject_id:id,subject_kind:kind,identity_version:1,status:'active',created_from_event_ref:ref};return serializeByKey(queues,kind+':'+id,async()=>{const old=table.get(id);if(old!==undefined){if(old.subject_kind!==kind)throw new Error(kind+' identity kind conflict');return clone(old);}return putOnce(table,id,v,kind+' identity conflict');});}
 async function recordFirstUserMessage({subject_id,direct_user_event}){
  requiredText(subject_id,'subject_id');if(!yuanqis.get(subject_id))throw new Error('YuanQiSubject does not exist');
  const e=verified(verifyDirectUserEvent,direct_user_event,'first-user-message'),fields=firstMessageFields(e);
  return serializeByKey(queues,'first-user:'+subject_id,async()=>{const old=firstMessages.get(subject_id);if(old!==undefined)return clone(old);return putOnce(firstMessages,subject_id,{subject_id,subject_kind:'yuanqi',...fields,schema_version:1},'first user message lock conflict');});
 }
 async function recoverInitialWake({subject_id,birth_location}){
  requiredText(subject_id,'subject_id');if(!yuanqis.get(subject_id))throw new Error('YuanQiSubject does not exist');
  const first=firstMessages.get(subject_id);if(!first||first.trigger_command===null)return undefined;
  return serializeByKey(queues,'wake:'+subject_id,async()=>{const old=wakes.get(subject_id);if(old!==undefined)return clone(old);
   const date=new Date(first.first_event_time);if(!Number.isFinite(date.getTime()))throw new TypeError('valid persisted DSH event time is required');
   const location=birth_location&&typeof birth_location==='object'?clone(birth_location):{status:'unavailable',latitude:null,longitude:null,accuracy_meters:null,place_label:null,time_zone_id:null,source:'unavailable',captured_at:null};
   return putOnce(wakes,subject_id,{wake_record_id:'wake:'+subject_id,subject_id,subject_kind:'yuanqi',first_conversation_event_ref:first.first_event_id,first_session_id:first.first_session_id,first_event_seq:first.first_event_seq,wake_event_ref:first.first_event_id,trigger_command:first.trigger_command,occurred_at:date.toISOString(),birth_time:date.toISOString(),birth_location:location,schema_version:4},'wake record conflict');
  });
 }
 return Object.freeze({
  async getOrCreateInstallationBoundary(now){
   if(!Number.isSafeInteger(now)||now<0)throw new TypeError('installation boundary clock must be Unix milliseconds');
   return serializeByKey(queues,'installation:primary',async()=>{
    const old=installationState.get('installation:primary');
    if(old!==undefined){if(old.installation_id!=='installation:primary'||old.schema_version!==1||!Number.isSafeInteger(old.activated_at_ms)||old.activated_at_ms<0)throw new Error('persisted YuanQi installation boundary is invalid');return clone(old);}
    return putOnce(installationState,'installation:primary',{installation_id:'installation:primary',activated_at_ms:now,schema_version:1},'installation boundary conflict');
   });
  },
  createUserSubject({subject_id,created_from_event_ref}){return identity(users,'user',subject_id,created_from_event_ref);},
  createYuanQiSubject({subject_id,created_from_event_ref}){return identity(yuanqis,'yuanqi',subject_id,created_from_event_ref);},
  getUserSubject(id){requiredText(id,'subject_id');const v=users.get(id);return v===undefined?undefined:clone(v);},
  getYuanQiSubject(id){requiredText(id,'subject_id');const v=yuanqis.get(id);return v===undefined?undefined:clone(v);},
  async confirmUserBirthProfile({profile_id,subject_id,facts,confirmation_event}){
   requiredText(profile_id,'profile_id');requiredText(subject_id,'subject_id');if(!facts||typeof facts!=='object'||Array.isArray(facts))throw new TypeError('facts must be an object');
   if(!users.get(subject_id))throw new Error('UserSubject does not exist');const e=verified(verifyBirthProfileConfirmation,confirmation_event,'birth-profile-confirmation');requiredText(e.event_id,'confirmation_event.event_id');
   return serializeByKey(queues,'birth:'+profile_id,()=>putOnce(births,profile_id,{profile_id,subject_id,subject_kind:'user',facts:clone(facts),confirmation_event_ref:e.event_id,status:'confirmed'},'birth profile conflict'));
  },
  recordFirstUserMessage,recoverInitialWake,
  async recordInitialWake(input){await recordFirstUserMessage(input);return recoverInitialWake({subject_id:input.subject_id,birth_location:input.birth_location});},
  getFirstUserMessage(id){requiredText(id,'subject_id');const v=firstMessages.get(id);return v===undefined?undefined:clone(v);},
  getUserBirthProfile(id){requiredText(id,'profile_id');const v=births.get(id);return v===undefined?undefined:clone(v);},
  getWakeRecord(id){requiredText(id,'subject_id');const v=wakes.get(id);return v===undefined?undefined:clone(v);}
 });
}
