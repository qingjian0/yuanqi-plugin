import { z } from 'zod';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';

function identitySchema(kind) {
  return z.object({
    subject_id: z.string().min(1),
    subject_kind: z.literal(kind),
    identity_version: z.number().int().min(1),
    status: z.enum(['active', 'suspended', 'retired']),
    created_from_event_ref: z.string().min(1),
  }).strict();
}
const userIdentity = identitySchema('user');
const yuanqiIdentity = identitySchema('yuanqi');

const birthProfile = z.object({
  profile_id: z.string().min(1),
  subject_id: z.string().min(1),
  subject_kind: z.literal('user'),
  facts: z.record(z.string(), z.unknown()),
  confirmation_event_ref: z.string().min(1),
  status: z.enum(['confirmed', 'superseded', 'revoked']),
}).strict();

const wakeRecord = z.object({
  wake_record_id: z.string().min(1),
  subject_id: z.string().min(1),
  subject_kind: z.literal('yuanqi'),
  first_conversation_event_ref: z.string().min(1),
  wake_event_ref: z.string().min(1),
  trigger_command: z.enum(['启动元气', '启动元炁']),
  occurred_at: z.string().datetime(),
  schema_version: z.number().int().min(2),
}).strict();

export const userSubjectDomainSpec = defineDomain({
  name: 'yuanqi_user_subject',
  version: 1,
  tables: { identities: domainTable(userIdentity), birth_profiles: domainTable(birthProfile) },
});
export const yuanqiSubjectDomainSpec = defineDomain({
  name: 'yuanqi_subject',
  version: 1,
  tables: { identities: domainTable(yuanqiIdentity), wake_records: domainTable(wakeRecord) },
});

export async function openSubjectDomains(storageDomain) {
  if (!storageDomain || typeof storageDomain.open !== 'function') throw new TypeError('DSH storageDomain is required');
  const userDomain = await storageDomain.open(userSubjectDomainSpec);
  try {
    const yuanqiDomain = await storageDomain.open(yuanqiSubjectDomainSpec);
    return { userDomain, yuanqiDomain, async close() { await Promise.all([userDomain.close(), yuanqiDomain.close()]); } };
  } catch (error) {
    await userDomain.close();
    throw error;
  }
}
