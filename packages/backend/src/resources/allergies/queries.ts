// Allergy queries.  Reads project the summary view; writes return the
// fresh row in the same shape so the caller can update local state
// without a follow-up GET.  Every function takes a Kysely Transaction
// already scoped via withRlsContext — RLS does the access filtering.

import { sql, type Transaction } from 'kysely';

import type { Database } from '../../db/types.js';
import type {
  AllergenType,
  AllergySeverity,
  AllergyStatus,
  AllergySummaryRow,
} from './views.js';

const SUMMARY_COLUMNS = [
  'id',
  'patient_id',
  'allergen',
  'allergen_type',
  'reaction',
  'severity',
  'status',
  'created_at',
  'updated_at',
] as const;

interface SummaryRow {
  id: string;
  patient_id: string;
  allergen: string;
  allergen_type: AllergenType;
  reaction: string | null;
  severity: AllergySeverity | null;
  status: AllergyStatus;
  created_at: Date | string;
  updated_at: Date | string;
}

export async function readAllergySummary(
  tx: Transaction<Database>,
  id: string,
): Promise<AllergySummaryRow | null> {
  const row = await tx
    .selectFrom('allergies')
    .select(SUMMARY_COLUMNS)
    .where('id', '=', id)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (row === undefined) return null;
  return toSummary(row);
}

export interface ListAllergiesOptions {
  readonly status?: AllergyStatus;
  readonly limit?: number;
}

export async function listAllergySummariesByPatient(
  tx: Transaction<Database>,
  patientId: string,
  options: ListAllergiesOptions = {},
): Promise<readonly AllergySummaryRow[]> {
  const limit = options.limit ?? 200;
  let query = tx
    .selectFrom('allergies')
    .select(SUMMARY_COLUMNS)
    .where('patient_id', '=', patientId)
    .where('deleted_at', 'is', null);
  if (options.status !== undefined) {
    query = query.where('status', '=', options.status);
  }
  // Severity priority: life-threatening > severe > moderate > mild >
  // null.  Within a severity tier: status alphabetical (active <
  // inactive < resolved), then most recently updated.
  const rows = await query
    .orderBy(
      sql`CASE severity
            WHEN 'life_threatening' THEN 0
            WHEN 'severe'           THEN 1
            WHEN 'moderate'         THEN 2
            WHEN 'mild'             THEN 3
            ELSE 4
          END`,
    )
    .orderBy('status', 'asc')
    .orderBy('updated_at', 'desc')
    .limit(limit)
    .execute();
  return rows.map(toSummary);
}

export interface InsertAllergyInput {
  readonly patientId: string;
  readonly allergen: string;
  readonly allergenType: AllergenType;
  readonly reaction?: string | null;
  readonly severity?: AllergySeverity | null;
  readonly status?: AllergyStatus;
  readonly authorUserId: string;
}

export async function insertAllergy(
  tx: Transaction<Database>,
  input: InsertAllergyInput,
): Promise<AllergySummaryRow> {
  const inserted = await tx
    .insertInto('allergies')
    .values({
      patient_id: input.patientId,
      allergen: input.allergen,
      allergen_type: input.allergenType,
      reaction: input.reaction ?? null,
      severity: input.severity ?? null,
      status: input.status ?? 'active',
      created_by: input.authorUserId,
      updated_by: input.authorUserId,
    })
    .returning(SUMMARY_COLUMNS)
    .executeTakeFirstOrThrow();
  return toSummary(inserted);
}

export interface UpdateAllergyInput {
  // Mutable fields only.  `allergen` and `allergenType` are identity
  // for an allergy record — change either and it's a different entry.
  readonly reaction?: string | null;
  readonly severity?: AllergySeverity | null;
  readonly status?: AllergyStatus;
  readonly editorUserId: string;
}

// Returns null when the row is invisible (RLS-filtered) or already
// soft-deleted.  Callers translate null to 404.
export async function updateAllergy(
  tx: Transaction<Database>,
  id: string,
  input: UpdateAllergyInput,
): Promise<AllergySummaryRow | null> {
  const updates: Record<string, unknown> = {
    updated_by: input.editorUserId,
    updated_at: new Date(),
  };
  if (input.reaction !== undefined) updates['reaction'] = input.reaction;
  if (input.severity !== undefined) updates['severity'] = input.severity;
  if (input.status !== undefined) updates['status'] = input.status;

  const row = await tx
    .updateTable('allergies')
    .set(updates)
    .where('id', '=', id)
    .where('deleted_at', 'is', null)
    .returning(SUMMARY_COLUMNS)
    .executeTakeFirst();
  if (row === undefined) return null;
  return toSummary(row);
}

function toSummary(row: SummaryRow): AllergySummaryRow {
  return {
    id: row.id,
    patientId: row.patient_id,
    allergen: row.allergen,
    allergenType: row.allergen_type,
    reaction: row.reaction,
    severity: row.severity,
    status: row.status,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function toIso(value: Date | string): string {
  return typeof value === 'string' ? value : value.toISOString();
}
