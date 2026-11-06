import { z } from 'zod';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
function identitySchema(kind) {
  return z.object({ subject_id:z.string().min(1), subject_kind:z.literal(kind), identity_version:z.number().int().min(1), status:z.enum(['active','suspended','retired']), created_from_event_ref:z.string().min(1) }).strict();
}
const birthProfile=z.object({ profile_id:z.string().min(1), subject_id:z.string().min(1), subject_kind:z.literal('user'), facts:z.record(z.string(),z.unknown()), confirmation_event_ref:z.string().min(1), status:z.enum(['confirmed','superseded','revoked']) }).strict();
const firstUserMessage=z.object({
 subject_id:z.string().min(1), subject_kind:z.literal('yuanqi'), first_session_id:z.string().min(1),
 first_event_id:z.string().min(1), first_event_seq:z.number().int().nonnegative(), first_event_time:z.number().int().nonnegative(),
 source_kind:z.literal('user'), event_type:z.literal('user/message'), trigger_command:z.enum(['启动元气','启动元炁']).nullable(), schema_version:z.literal(1),
}).strict();
const worldline=z.object({ worldline_id:z.string().min(1), yuanqi_subject_id:z.string().min(1), parent_worldline_id:z.string().min(1).optional(), base_snapshot_version:z.number().int().nonnegative().optional(), status:z.enum(['active','archived','suspended']), created_from_event_ref:z.string().min(1) }).strict();
const worldlineMainline=z.object({ yuanqi_subject_id:z.string().min(1), worldline_id:z.string().min(1), created_from_event_ref:z.string().min(1) }).strict();
const worldlineSnapshot=z.object({ snapshot_id:z.string().min(1), worldline_id:z.string().min(1), yuanqi_subject_id:z.string().min(1), snapshot_version:z.number().int().nonnegative(), state_payload:z.record(z.string(),z.unknown()), evidence_refs:z.array(z.string().min(1)).default([]), created_at_event_ref:z.string().min(1) }).strict();
const worldlineEvent=z.object({ event_id:z.string().min(1), event_type:z.enum(['worldline.created','worldline.forked']), subject_id:z.string().min(1), subject_kind:z.literal('yuanqi'), worldline_id:z.string().min(1), occurred_at:z.string().datetime(), source_kind:z.enum(['direct_user_event','host_event']), source_event_ref:z.string().min(1), schema_version:z.literal(1), payload:z.record(z.string(),z.unknown()) }).strict();
const sessionWorldlineBinding=z.object({ session_id:z.string().min(1), yuanqi_subject_id:z.string().min(1), worldline_id:z.string().min(1), bound_from_event_ref:z.string().min(1), schema_version:z.literal(1) }).strict();
const wakeRecord=z.object({
 wake_record_id:z.string().min(1), subject_id:z.string().min(1), subject_kind:z.literal('yuanqi'),
 first_conversation_event_ref:z.string().min(1), first_session_id:z.string().min(1), first_event_seq:z.number().int().nonnegative(),
 wake_event_ref:z.string().min(1), trigger_command:z.enum(['启动元气','启动元炁']), occurred_at:z.string().datetime(), schema_version:z.literal(3),
}).strict();
export const userSubjectDomainSpec=defineDomain({name:'yuanqi_user_subject',version:1,tables:{identities:domainTable(identitySchema('user')),birth_profiles:domainTable(birthProfile)}});
export const yuanqiSubjectDomainSpec=defineDomain({name:'yuanqi_subject',version:3,tables:{identities:domainTable(identitySchema('yuanqi')),first_user_messages:domainTable(firstUserMessage),wake_records:domainTable(wakeRecord),worldlines:domainTable(worldline),worldline_mainlines:domainTable(worldlineMainline),worldline_snapshots:domainTable(worldlineSnapshot),worldline_events:domainTable(worldlineEvent),session_worldline_bindings:domainTable(sessionWorldlineBinding)}});
export async function openSubjectDomains(storageDomain) {
 if(!storageDomain||typeof storageDomain.open!=='function') throw new TypeError('DSH storageDomain is required');
 const userDomain=await storageDomain.open(userSubjectDomainSpec);
 try { const yuanqiDomain=await storageDomain.open(yuanqiSubjectDomainSpec); return {userDomain,yuanqiDomain,async close(){await Promise.all([userDomain.close(),yuanqiDomain.close()]);}}; }
 catch(error){await userDomain.close();throw error;}
}
