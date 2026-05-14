// Problem queries.  Each function takes a Kysely Transaction already
// scoped via withRlsContext — RLS does the access filtering, these
// functions just project the view's columns.

import type { Transaction } from 'kysely';

import type { Database } from '../../db/types.js';
import type { ProblemStatus, ProblemSummaryRow } from './views.js';

const SUMMARY_COLUMNS = [
  'id',
  'patient_id',
  'icd10_code',
  'description',
  'status',
  'onset_date',
  'resolved_date',
] as const;

interface SummaryRow {
  id: string;
  patient_id: string;
  icd10_code: string | null;
  description: string;
  status: ProblemStatus;
  onset_date: Date | string | null;
  resolved_date: Date | string | null;
}

export async function readProblemSummary(
  tx: Transaction<Database>,
  id: string,
): Promise<ProblemSummaryRow | null> {
  const row = await tx
    .selectFrom('problems')
    .select(SUMMARY_COLUMNS)
    .where('id', '=', id)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();

  if (row === undefined) return null;
  return toSummary(row);
}

export interface ListProblemsOptions {
  readonly status?: ProblemStatus;
  readonly limit?: number;
}

export async function listProblemSummariesByPatient(
  tx: Transaction<Database>,
  patientId: string,
  options: ListProblemsOptions = {},
): Promise<readonly ProblemSummaryRow[]> {
  const limit = options.limit ?? 200;
  let query = tx
    .selectFrom('problems')
    .select(SUMMARY_COLUMNS)
    .where('patient_id', '=', patientId)
    .where('deleted_at', 'is', null);
  if (options.status !== undefined) {
    query = query.where('status', '=', options.status);
  }
  const rows = await query
    // Active problems first so the most clinically relevant items
    // surface without a UI sort.  The three allowed statuses sort
    // ascending alphabetically into clinical-priority order:
    // active < inactive < resolved.  Tie-break on onset_date desc,
    // then id asc for stable pagination.
    .orderBy('status', 'asc')
    .orderBy('onset_date', 'desc')
    .orderBy('id', 'asc')
    .limit(limit)
    .execute();

  return rows.map(toSummary);
}

function toSummary(row: SummaryRow): ProblemSummaryRow {
  return {
    id: row.id,
    patientId: row.patient_id,
    icd10Code: row.icd10_code,
    description: row.description,
    status: row.status,
    onsetDate: row.onset_date === null ? null : formatDate(row.onset_date),
    resolvedDate:
      row.resolved_date === null ? null : formatDate(row.resolved_date),
  };
}

function formatDate(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10);
  // Postgres date returns a Date with UTC midnight in node-pg.
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
