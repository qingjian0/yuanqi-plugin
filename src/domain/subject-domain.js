import { z } from 'zod';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
function identitySchema(kind) {
  return z.object({ subject_id:z.string().min(1), subject_kind:z.literal(kind), identity_version:z.number().int().min(1), status:z.enum(['active','suspended','retired']), created_from_event_ref:z.string().min(1) }).strict();
}
const birthProfile=z.object({ profile_id:z.string().min(1), subject_id:z.string().min(1), subject_kind:z.literal('user'), facts:z.record(z.string(),z.unknown()), confirmation_event_ref:z.string().min(1), status:z.enum(['confirmed','superseded','revoked']) }).strict();
const installationState=z.object({ installation_id:z.literal('installation:primary'), activated_at_ms:z.number().int().nonnegative(), schema_version:z.literal(1) }).strict();
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
const evidenceRecord=z.object({
 evidence_id:z.string().min(1), yuanqi_subject_id:z.string().min(1), worldline_id:z.string().min(1),
 evidence_type:z.string().min(1), content:z.record(z.string(),z.unknown()), provenance:z.record(z.string(),z.unknown()),
 source_kind:z.enum(['direct_user_event','host_event']), source_event_ref:z.string().min(1),
 captured_at:z.string().datetime(), transferred_from:z.object({evidence_id:z.string().min(1),worldline_id:z.string().min(1),authorization_id:z.string().min(1)}).strict().optional(), schema_version:z.literal(1),
}).strict();
const evidenceRevocation=z.object({
 evidence_id:z.string().min(1), worldline_id:z.string().min(1), reason:z.string().min(1),
 revoked_from_event_ref:z.string().min(1), revoked_at:z.string().datetime(), schema_version:z.literal(1),
}).strict();
const evidenceAssessment=z.object({
 assessment_id:z.string().min(1), evidence_id:z.string().min(1), worldline_id:z.string().min(1),
 outcome:z.enum(['corroborated','contradicted','insufficient']), assessor_kind:z.enum(['user','model','system']),
 rationale:z.string().min(1), confidence:z.number().min(0).max(1).nullable(),
 corroborating_evidence_refs:z.array(z.string().min(1)), assessed_from_event_ref:z.string().min(1),
 assessed_at:z.string().datetime(), schema_version:z.literal(1),
}).strict();
const transferAuthorization=z.object({
 authorization_id:z.string().min(1), yuanqi_subject_id:z.string().min(1),
 source_worldline_id:z.string().min(1), target_worldline_id:z.string().min(1),
 evidence_ids:z.array(z.string().min(1)).min(1), authorized_from_event_ref:z.string().min(1),
 authorized_at:z.string().datetime(), expires_at_ms:z.number().int().nonnegative(), schema_version:z.literal(1),
}).strict();
const transferAuthorizationRevocation=z.object({
 authorization_id:z.string().min(1), reason:z.string().min(1),
 revoked_from_event_ref:z.string().min(1), revoked_at:z.string().datetime(), schema_version:z.literal(1),
}).strict();
const evidenceTransfer=z.object({
 transfer_id:z.string().min(1), authorization_id:z.string().min(1),
 source_evidence_id:z.string().min(1), target_evidence_id:z.string().min(1),
 source_worldline_id:z.string().min(1), target_worldline_id:z.string().min(1),
 transferred_from_event_ref:z.string().min(1), transferred_at:z.string().datetime(), schema_version:z.literal(1),
}).strict();
const headSnapshot=z.object({ snapshot_version:z.number().int().nonnegative(), state_payload:z.record(z.string(),z.unknown()), evidence_refs:z.array(z.string().min(1)), created_at_event_ref:z.string().min(1), fencing_token:z.number().int().nonnegative() }).strict();
const snapshotArchiveEntry=z.object({ archive_id:z.string().min(1), worldline_id:z.string().min(1), yuanqi_subject_id:z.string().min(1), snapshot:headSnapshot }).strict();
const snapshotArchiveManifest=z.object({ archive_id:z.string().min(1), worldline_id:z.string().min(1), yuanqi_subject_id:z.string().min(1), from_version:z.number().int().nonnegative(), through_version:z.number().int().nonnegative(), snapshot_count:z.number().int().positive(), previous_archive_id:z.string().min(1).nullable(), created_from_event_ref:z.string().min(1), schema_version:z.literal(1) }).strict();
const worldlineHead=z.object({
 worldline_id:z.string().min(1), yuanqi_subject_id:z.string().min(1),
 current_snapshot_version:z.number().int().nonnegative(),
 current_state_payload:z.record(z.string(),z.unknown()), current_evidence_refs:z.array(z.string().min(1)),
 snapshot_history:z.array(headSnapshot), snapshot_archive_checkpoint:z.object({archive_id:z.string().min(1),through_version:z.number().int().nonnegative()}).strict().nullable().optional(), base_snapshot_ref:z.object({worldline_id:z.string().min(1),snapshot_version:z.number().int().nonnegative()}).nullable(),
 runtime_lease:z.object({holder_id:z.string().min(1).nullable(),fencing_token:z.number().int().nonnegative(),expires_at_ms:z.number().int().nonnegative()}).strict(),
 updated_from_event_ref:z.string().min(1),
}).strict();
const wakeRecord=z.object({
 wake_record_id:z.string().min(1), subject_id:z.string().min(1), subject_kind:z.literal('yuanqi'),
 first_conversation_event_ref:z.string().min(1), first_session_id:z.string().min(1), first_event_seq:z.number().int().nonnegative(),
 wake_event_ref:z.string().min(1), trigger_command:z.enum(['启动元气','启动元炁']), occurred_at:z.string().datetime(), birth_time:z.string().datetime().optional(), birth_location:z.object({status:z.enum(['pending','captured','unavailable']),latitude:z.number().min(-90).max(90).nullable(),longitude:z.number().min(-180).max(180).nullable(),accuracy_meters:z.number().nonnegative().nullable(),place_label:z.string().nullable(),time_zone_id:z.string().nullable(),source:z.enum(['host_location_provider','android_location_bridge','unavailable']),captured_at:z.string().datetime().nullable()}).strict().optional(), schema_version:z.union([z.literal(3),z.literal(4)]),
}).strict();
export const userSubjectDomainSpec=defineDomain({name:'yuanqi_user_subject',version:1,tables:{identities:domainTable(identitySchema('user')),birth_profiles:domainTable(birthProfile)}});
export const yuanqiSubjectDomainSpec=defineDomain({name:'yuanqi_subject',version:10,compatibleVersions:[3,4,5,6,7,8,9],tables:{installation_state:domainTable(installationState),identities:domainTable(identitySchema('yuanqi')),first_user_messages:domainTable(firstUserMessage),wake_records:domainTable(wakeRecord),worldlines:domainTable(worldline),worldline_mainlines:domainTable(worldlineMainline),worldline_snapshots:domainTable(worldlineSnapshot),worldline_heads:domainTable(worldlineHead),worldline_snapshot_archive_entries:domainTable(snapshotArchiveEntry),worldline_snapshot_archive_manifests:domainTable(snapshotArchiveManifest),evidence_records:domainTable(evidenceRecord),evidence_revocations:domainTable(evidenceRevocation),evidence_assessments:domainTable(evidenceAssessment),transfer_authorizations:domainTable(transferAuthorization),transfer_authorization_revocations:domainTable(transferAuthorizationRevocation),evidence_transfers:domainTable(evidenceTransfer),worldline_events:domainTable(worldlineEvent),session_worldline_bindings:domainTable(sessionWorldlineBinding)}});
export async function openSubjectDomains(storageDomain) {
 if(!storageDomain||typeof storageDomain.open!=='function') throw new TypeError('DSH storageDomain is required');
 const userDomain=await storageDomain.open(userSubjectDomainSpec);
 try { const yuanqiDomain=await storageDomain.open(yuanqiSubjectDomainSpec); return {userDomain,yuanqiDomain,async close(){await Promise.all([userDomain.close(),yuanqiDomain.close()]);}}; }
 catch(error){await userDomain.close();throw error;}
}
