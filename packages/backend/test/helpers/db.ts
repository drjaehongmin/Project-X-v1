// Test helpers.  These connect to a real Postgres (whatever
// TEST_DATABASE_URL points at), assume migrations have been applied,
// and truncate every test-owned table between cases.  No production
// dummy data — fixtures are created per-test.

import pg from 'pg';
import argon2 from 'argon2';

export interface TestEnv {
  readonly databaseUrl: string;
  readonly jwtSecret: string;
}

export function readTestEnv(): TestEnv | null {
  const url =
    process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL'] ?? '';
  if (url === '') return null;
  return {
    databaseUrl: url,
    jwtSecret:
      process.env['JWT_SECRET'] ??
      'test-only-secret-do-not-use-in-production-32+chars',
  };
}

const TABLES_TO_TRUNCATE = [
  'audit_logs',
  'allergies',
  'problems',
  'encounters',
  'providers',
  'encounter_types',
  'break_glass_events',
  'care_team_assignments',
  'sessions',
  'user_roles',
  'patients',
  'vessels',
  'facilities',
  'roles',
  'users',
] as const;

let pool: pg.Pool | null = null;

export function getTestPool(env: TestEnv): pg.Pool {
  if (pool === null) {
    pool = new pg.Pool({ connectionString: env.databaseUrl, max: 4 });
  }
  return pool;
}

export async function closeTestPool(): Promise<void> {
  if (pool !== null) {
    await pool.end();
    pool = null;
  }
}

export async function truncateAll(env: TestEnv): Promise<void> {
  const p = getTestPool(env);
  // RESTART IDENTITY resets bigserial PKs (audit_logs.id); CASCADE
  // covers FKs between the truncated set.
  await p.query(
    `TRUNCATE ${TABLES_TO_TRUNCATE.join(', ')} RESTART IDENTITY CASCADE`,
  );
}

// ---------- seed helpers --------------------------------------------

export interface SeedUserInput {
  readonly email: string;
  readonly password: string;
  readonly firstName?: string;
  readonly surname?: string;
  readonly userType?: 'staff' | 'provider' | 'admin' | 'patient';
  readonly roleNames?: readonly string[];
  readonly facilityId?: string | null;
}

export interface SeededUser {
  readonly id: string;
  readonly email: string;
  readonly password: string;
}

export async function seedUser(
  env: TestEnv,
  input: SeedUserInput,
): Promise<SeededUser> {
  const p = getTestPool(env);
  const hash = await argon2.hash(input.password, { type: argon2.argon2id });
  const userRes = await p.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, first_name, surname, user_type)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      input.email,
      hash,
      input.firstName ?? 'Test',
      input.surname ?? 'User',
      input.userType ?? 'staff',
    ],
  );
  const userId = userRes.rows[0]!.id;

  for (const roleName of input.roleNames ?? []) {
    const roleRes = await p.query<{ id: string }>(
      `INSERT INTO roles (name)
       VALUES ($1)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [roleName],
    );
    await p.query(
      `INSERT INTO user_roles (user_id, role_id, facility_id) VALUES ($1, $2, $3)`,
      [userId, roleRes.rows[0]!.id, input.facilityId ?? null],
    );
  }

  return { id: userId, email: input.email, password: input.password };
}

export async function seedFacility(
  env: TestEnv,
  name: string,
  facilityType: 'vessel' | 'clinic' = 'clinic',
): Promise<{ id: string }> {
  const p = getTestPool(env);
  const res = await p.query<{ id: string }>(
    `INSERT INTO facilities (name, facility_type, timezone)
     VALUES ($1, $2, 'UTC')
     RETURNING id`,
    [name, facilityType],
  );
  return { id: res.rows[0]!.id };
}

export interface SeededPatient {
  readonly id: string;
  readonly mrn: string;
}

export async function seedPatient(
  env: TestEnv,
  input: {
    mrn: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    sex?: 'male' | 'female' | 'intersex' | 'unknown';
  },
): Promise<SeededPatient> {
  const p = getTestPool(env);
  const res = await p.query<{ id: string }>(
    `INSERT INTO patients (mrn, first_name, last_name, date_of_birth, sex_at_birth)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [input.mrn, input.firstName, input.lastName, input.dateOfBirth, input.sex ?? null],
  );
  return { id: res.rows[0]!.id, mrn: input.mrn };
}

export async function assignCareTeam(
  env: TestEnv,
  patientId: string,
  userId: string,
  role: 'primary' | 'consulting' | 'nurse' | 'admin' | 'other' = 'primary',
): Promise<void> {
  const p = getTestPool(env);
  await p.query(
    `INSERT INTO care_team_assignments (patient_id, user_id, role) VALUES ($1, $2, $3)`,
    [patientId, userId, role],
  );
}

// NPI counter scoped to a process, so seedProvider doesn't need the
// caller to think up a unique value per test.  Each test file uses a
// distinct prefix to avoid cross-suite collisions.
let providerNpiCounter = 0;
const PROVIDER_NPI_PREFIX = (process.pid % 90 + 10).toString();

export interface SeedProviderInput {
  readonly userId?: string | null;
  readonly npi?: string;
  readonly specialty?: string | null;
  readonly defaultFacilityId?: string | null;
}

export interface SeededProvider {
  readonly id: string;
  readonly userId: string | null;
  readonly npi: string;
}

export async function seedProvider(
  env: TestEnv,
  input: SeedProviderInput = {},
): Promise<SeededProvider> {
  const p = getTestPool(env);
  providerNpiCounter += 1;
  const npi =
    input.npi ??
    `${PROVIDER_NPI_PREFIX}${String(providerNpiCounter).padStart(8, '0')}`;
  const res = await p.query<{ id: string }>(
    `INSERT INTO providers (user_id, npi, specialty, default_facility_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [
      input.userId ?? null,
      npi,
      input.specialty ?? null,
      input.defaultFacilityId ?? null,
    ],
  );
  return {
    id: res.rows[0]!.id,
    userId: input.userId ?? null,
    npi,
  };
}

export type EncounterStatus =
  | 'scheduled'
  | 'arrived'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'no_show';

export interface SeedEncounterInput {
  readonly patientId: string;
  readonly providerId: string;
  readonly facilityId: string;
  readonly status?: EncounterStatus;
  readonly startTime?: string | Date;
  readonly endTime?: string | Date | null;
  readonly chiefComplaint?: string | null;
  readonly isTelehealth?: boolean;
  readonly encounterTypeId?: string | null;
}

export interface SeededEncounter {
  readonly id: string;
  readonly startTime: string;
}

export type ProblemStatus = 'active' | 'inactive' | 'resolved';

export interface SeedProblemInput {
  readonly patientId: string;
  readonly description: string;
  readonly status?: ProblemStatus;
  readonly icd10Code?: string | null;
  readonly onsetDate?: string | null;
  readonly resolvedDate?: string | null;
}

export interface SeededProblem {
  readonly id: string;
}

export async function seedProblem(
  env: TestEnv,
  input: SeedProblemInput,
): Promise<SeededProblem> {
  const p = getTestPool(env);
  const status = input.status ?? 'active';
  // A 'resolved' problem must have a resolved_date per CHECK constraint;
  // default to today when the caller didn't supply one.
  const resolvedDate =
    input.resolvedDate ??
    (status === 'resolved' ? new Date().toISOString().slice(0, 10) : null);
  const res = await p.query<{ id: string }>(
    `INSERT INTO problems (patient_id, icd10_code, description, status, onset_date, resolved_date)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      input.patientId,
      input.icd10Code ?? null,
      input.description,
      status,
      input.onsetDate ?? null,
      resolvedDate,
    ],
  );
  return { id: res.rows[0]!.id };
}

export type AllergenType = 'drug' | 'food' | 'environmental' | 'other';
export type AllergySeverity =
  | 'mild'
  | 'moderate'
  | 'severe'
  | 'life_threatening';
export type AllergyStatus = 'active' | 'inactive' | 'resolved';

export interface SeedAllergyInput {
  readonly patientId: string;
  readonly allergen: string;
  readonly allergenType: AllergenType;
  readonly reaction?: string | null;
  readonly severity?: AllergySeverity | null;
  readonly status?: AllergyStatus;
  readonly createdBy?: string | null;
}

export interface SeededAllergy {
  readonly id: string;
}

export async function seedAllergy(
  env: TestEnv,
  input: SeedAllergyInput,
): Promise<SeededAllergy> {
  const p = getTestPool(env);
  const res = await p.query<{ id: string }>(
    `INSERT INTO allergies
       (patient_id, allergen, allergen_type, reaction, severity, status,
        created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
     RETURNING id`,
    [
      input.patientId,
      input.allergen,
      input.allergenType,
      input.reaction ?? null,
      input.severity ?? null,
      input.status ?? 'active',
      input.createdBy ?? null,
    ],
  );
  return { id: res.rows[0]!.id };
}

export async function seedEncounter(
  env: TestEnv,
  input: SeedEncounterInput,
): Promise<SeededEncounter> {
  const p = getTestPool(env);
  const startTime = input.startTime ?? new Date();
  const res = await p.query<{ id: string; start_time: Date }>(
    `INSERT INTO encounters (
       patient_id, provider_id, facility_id, encounter_type_id,
       status, start_time, end_time, chief_complaint, is_telehealth
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, start_time`,
    [
      input.patientId,
      input.providerId,
      input.facilityId,
      input.encounterTypeId ?? null,
      input.status ?? 'completed',
      typeof startTime === 'string' ? startTime : startTime.toISOString(),
      input.endTime === null || input.endTime === undefined
        ? null
        : typeof input.endTime === 'string'
          ? input.endTime
          : input.endTime.toISOString(),
      input.chiefComplaint ?? null,
      input.isTelehealth ?? false,
    ],
  );
  return {
    id: res.rows[0]!.id,
    startTime: res.rows[0]!.start_time.toISOString(),
  };
}
