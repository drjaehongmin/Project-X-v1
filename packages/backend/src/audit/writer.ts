// Server-side audit writer.  Called by handlers (or the audit Fastify
// plugin) to append a row to `audit_logs`.  The row is attributed to
// the authenticated user; the table's RLS policy enforces that the
// actor matches `app.user_id`.

import type { Transaction } from 'kysely';

import type { Database } from '../db/types.js';

// Optional fields accept explicit `undefined` so callers can pass
// values that may be missing without a per-field conditional spread.
// `exactOptionalPropertyTypes: true` otherwise rejects
// `moduleId: maybeStr`.
export interface AuditWriteInput {
  readonly userId: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId?: string | undefined;
  readonly patientId?: string | undefined;
  readonly moduleId?: string | undefined;
  readonly ip?: string | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
}

export async function writeAudit(
  tx: Transaction<Database>,
  input: AuditWriteInput,
): Promise<void> {
  await tx
    .insertInto('audit_logs')
    .values({
      actor_user_id: input.userId,
      actor_ip: input.ip ?? null,
      action: input.action,
      resource_type: input.resourceType,
      resource_id: input.resourceId ?? null,
      patient_id: input.patientId ?? null,
      module_id: input.moduleId ?? null,
      metadata: input.metadata ?? {},
    })
    .execute();
}
