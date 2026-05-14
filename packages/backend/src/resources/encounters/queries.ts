// Encounter queries.  Each function takes a Kysely Transaction already
// scoped via withRlsContext — the caller is responsible for the wrap.
// RLS does the access filtering; these functions project the view's
// columns and translate snake_case rows to the camelCase wire shape.

import type { Transaction } from 'kysely';

import type { Database } from '../../db/types.js';
import type { EncounterSummaryRow, EncounterStatus } from './views.js';

const SUMMARY_COLUMNS = [
  'id',
  'patient_id',
  'provider_id',
  'facility_id',
  'encounter_type_id',
  'status',
  'start_time',
  'end_time',
  'chief_complaint',
  'is_telehealth',
] as const;

interface SummaryRow {
  id: string;
  patient_id: string;
  provider_id: string;
  facility_id: string;
  encounter_type_id: string | null;
  status: EncounterStatus;
  start_time: Date | string;
  end_time: Date | string | null;
  chief_complaint: string | null;
  is_telehealth: boolean;
}

export async function readEncounterSummary(
  tx: Transaction<Database>,
  id: string,
): Promise<EncounterSummaryRow | null> {
  const row = await tx
    .selectFrom('encounters')
    .select(SUMMARY_COLUMNS)
    .where('id', '=', id)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();

  if (row === undefined) return null;
  return toSummary(row);
}

// Lists encounters for a patient, newest start_time first.  RLS already
// gates by care-team membership, so the explicit `patient_id` filter is
// a routing/payload convenience — the predicate would otherwise return
// every encounter the caller can see across patients.
export async function listEncounterSummariesByPatient(
  tx: Transaction<Database>,
  patientId: string,
  options: { limit?: number } = {},
): Promise<readonly EncounterSummaryRow[]> {
  const limit = options.limit ?? 100;
  const rows = await tx
    .selectFrom('encounters')
    .select(SUMMARY_COLUMNS)
    .where('patient_id', '=', patientId)
    .where('deleted_at', 'is', null)
    .orderBy('start_time', 'desc')
    .limit(limit)
    .execute();

  return rows.map(toSummary);
}

function toSummary(row: SummaryRow): EncounterSummaryRow {
  return {
    id: row.id,
    patientId: row.patient_id,
    providerId: row.provider_id,
    facilityId: row.facility_id,
    encounterTypeId: row.encounter_type_id,
    status: row.status,
    startTime: toIso(row.start_time),
    endTime: row.end_time === null ? null : toIso(row.end_time),
    chiefComplaint: row.chief_complaint,
    isTelehealth: row.is_telehealth,
  };
}

function toIso(value: Date | string): string {
  return typeof value === 'string' ? value : value.toISOString();
}
