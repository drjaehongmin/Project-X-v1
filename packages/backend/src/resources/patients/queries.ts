// Patient queries.  Each function takes a Kysely Transaction already
// scoped via withRlsContext — the caller is responsible for the wrap.
// RLS does the access filtering; these functions just project the
// view's columns.

import type { Transaction } from 'kysely';

import type { Database } from '../../db/types.js';
import type { PatientSex, PatientSummaryRow } from './views.js';

const SUMMARY_COLUMNS = [
  'id',
  'mrn',
  'first_name',
  'last_name',
  'date_of_birth',
  'sex_at_birth',
] as const;

interface SummaryRow {
  id: string;
  mrn: string;
  first_name: string;
  last_name: string;
  date_of_birth: Date | string;
  sex_at_birth: PatientSex | null;
}

export async function readPatientSummary(
  tx: Transaction<Database>,
  id: string,
): Promise<PatientSummaryRow | null> {
  const row = await tx
    .selectFrom('patients')
    .select(SUMMARY_COLUMNS)
    .where('id', '=', id)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();

  if (row === undefined) return null;
  return toSummary(row);
}

export interface InsertPatientInput {
  readonly mrn: string;
  readonly firstName: string;
  readonly middleName?: string | null;
  readonly lastName: string;
  readonly dateOfBirth: string; // YYYY-MM-DD
  readonly sex?: PatientSex | null;
  readonly nationality?: string | null;       // ISO 3166-1 alpha-2
  readonly countryOfResidence?: string | null; // ISO 3166-1 alpha-2
}

// Inserts a row in `patients` and returns the summary view.  RLS on
// INSERT is the `patients_staff_insert` policy from 0005, which checks
// `app_is_admin() OR app_has_role('provider'|'clinician'|'registrar')`.
// The route layer also enforces `patient.write` so we get two gates.
export async function insertPatient(
  tx: Transaction<Database>,
  input: InsertPatientInput,
): Promise<PatientSummaryRow> {
  const row = await tx
    .insertInto('patients')
    .values({
      mrn: input.mrn,
      first_name: input.firstName,
      middle_name: input.middleName ?? null,
      last_name: input.lastName,
      date_of_birth: input.dateOfBirth,
      sex_at_birth: input.sex ?? null,
      nationality: input.nationality ?? null,
      country_of_residence: input.countryOfResidence ?? null,
    })
    .returning(SUMMARY_COLUMNS)
    .executeTakeFirstOrThrow();
  return toSummary(row);
}

// Adds a care-team row.  The route calls this immediately after
// insertPatient so the caller is the patient's first care provider —
// without it, the caller would create a patient they couldn't see on
// the next read (RLS is patient-access based, not authored-by based).
export async function assignSelfToCareTeam(
  tx: Transaction<Database>,
  patientId: string,
  userId: string,
  role: 'primary' | 'consulting' | 'nurse' | 'admin' | 'other' = 'primary',
): Promise<void> {
  await tx
    .insertInto('care_team_assignments')
    .values({ patient_id: patientId, user_id: userId, role })
    .execute();
}

function toSummary(row: SummaryRow): PatientSummaryRow {
  return {
    id: row.id,
    mrn: row.mrn,
    displayName: [row.first_name, row.last_name].filter(Boolean).join(' '),
    dateOfBirth: formatDate(row.date_of_birth),
    sex: row.sex_at_birth,
  };
}

function formatDate(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10);
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
