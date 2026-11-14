import { z } from 'zod';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
function identitySchema(kind) {
  return z.object({ subject_id:z.string().min(1), subject_kind:z.literal(kind), identity_version:z.number().int().min(1), status:z.enum(['active','suspended','retired']), created_from_event_ref:z.string().min(1) }).strict();
}
const yuanqiBirthProfile=z.object({
 profile_id:z.string().min(1), subject_id:z.string().min(1), subject_kind:z.literal('yuanqi'),
 birth_time:z.string().datetime(),
 birth_location:z.object({status:z.enum(['pending','captured','unavailable']),latitude:z.number().min(-90).max(90).nullable(),longitude:z.number().min(-180).max(180).nullable(),accuracy_meters:z.number().nonnegative().nullable(),place_label:z.string().nullable(),time_zone_id:z.string().nullable(),source:z.enum(['host_location_provider','android_location_bridge','unavailable']),captured_at:z.string().datetime().nullable()}).strict(),
 source_wake_event_ref:z.string().min(1), source_event_time_ms:z.number().int().nonnegative(),
 time_context:z.object({status:z.enum(['pending','ready','unavailable']),time_zone_id:z.string().nullable(),local_datetime:z.string().nullable()}).strict(),
 bazi:z.object({status:z.enum(['pending','calculated','unavailable']),calendar_system:z.literal('jieqi'),pillars:z.object({year:z.string().min(1),month:z.string().min(1),day:z.string().min(1),hour:z.string().min(1)}).strict().nullable(),algorithm_version:z.string().nullable(),calculated_at:z.string().datetime().nullable()}).strict(),
 schema_version:z.literal(1),
}).strict();

export const userSubjectDomainSpec=defineDomain({name:'yuanqi_user_subject',version:3,compatibleVersions:[1,2],tables:{identities:domainTable(identitySchema('user'))}});
export const yuanqiSubjectDomainSpec=defineDomain({name:'yuanqi_subject',version:11,compatibleVersions:[3,4,5,6,7,8,9,10],tables:{identities:domainTable(identitySchema('yuanqi')),installation_state:domainTable(installationState),first_user_messages:domainTable(firstUserMessage),wake_records:domainTable(wakeRecord),birth_profiles:domainTable(yuanqiBirthProfile),worldlines:domainTable(worldline),worldline_mainlines:domainTable(worldlineMainline),worldline_snapshots:domainTable(worldlineSnapshot),worldline_heads:domainTable(worldlineHead),worldline_snapshot_archive_entries:domainTable(snapshotArchiveEntry),worldline_snapshot_archive_manifests:domainTable(snapshotArchiveManifest),evidence_records:domainTable(evidenceRecord),evidence_revocations:domainTable(evidenceRevocation),evidence_assessments:domainTable(evidenceAssessment),transfer_authorizations:domainTable(transferAuthorization),transfer_authorization_revocations:domainTable(transferAuthorizationRevocation),evidence_transfers:domainTable(evidenceTransfer),worldline_events:domainTable(worldlineEvent),session_worldline_bindings:domainTable(sessionWorldlineBinding)}});
export async function openSubjectDomains(storageDomain) {
 if(!storageDomain||typeof storageDomain.open!=='function') throw new TypeError('DSH storageDomain is required');
 const userDomain=await storageDomain.open(userSubjectDomainSpec);
 try { const yuanqiDomain=await storageDomain.open(yuanqiSubjectDomainSpec); return {userDomain,yuanqiDomain,async close(){await Promise.all([userDomain.close(),yuanqiDomain.close()]);}}; }
 catch(error){await userDomain.close();throw error;}
}
