#!/usr/bin/env tsx
// db-create-patient — bootstrap a patient row (and optionally a
// care-team assignment linking the new patient to an existing user)
// against the EMR database.  Reads connection info from DATABASE_URL.
//
// Like db-create-admin, this is an operator tool: someone with DB
// credentials runs it once to create test patients.  It never seeds
// dummy data into committed migrations.
//
// Three modes of operation, in order of precedence per field:
//   1. CLI flag (e.g. `--mrn MRN-0001`).
//   2. Environment variable (`EMR_PATIENT_MRN`, ...).
//   3. Interactive prompt (only if stdin is a TTY).
//
// To attach the patient to an existing user (so the user sees the
// patient through `app_is_on_care_team`), pass `--care-team-user-id`
// or `--care-team-user-email`.  Without either, the patient is created
// orphaned — no user can see it until an admin assigns a care team.
//
// Usage:
//   pnpm db-create-patient                                       # fully interactive
//   pnpm db-create-patient --mrn MRN-0001 --first-name Ada --last-name Lovelace --dob 1815-12-10 --sex female
//   pnpm db-create-patient --mrn MRN-0001 ... --care-team-user-email admin@example.com

import { Client } from 'pg';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { stdin as input, stdout as output } from 'node:process';

interface Inputs {
  databaseUrl: string;
  mrn: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  sex: 'male' | 'female' | 'intersex' | 'unknown' | null;
  careTeamUserId: string | null;
  careTeamUserEmail: string | null;
  careTeamRole: 'primary' | 'consulting' | 'nurse' | 'admin' | 'other';
  nonInteractive: boolean;
}

const USAGE = `
Usage: pnpm db-create-patient [options]

Options:
  --mrn <value>                Medical Record Number (also: EMR_PATIENT_MRN)
  --first-name <name>          Given name (default: prompt)
  --last-name <name>           Family name (default: prompt)
  --dob <YYYY-MM-DD>           Date of birth (also: EMR_PATIENT_DOB)
  --sex <value>                male | female | intersex | unknown (default: prompt; blank for NULL)
  --care-team-user-id <uuid>   Add this user to the patient's care team
  --care-team-user-email <e>   Look up the user by email and add to the care team
  --care-team-role <role>      primary | consulting | nurse | admin | other (default: primary)
  --database-url <url>         Postgres connection string (also: DATABASE_URL)
  --non-interactive            Fail rather than prompt for missing fields
  -h, --help                   Show this help and exit
`;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SEX_VALUES = new Set(['male', 'female', 'intersex', 'unknown']);
const CARE_TEAM_ROLES = new Set([
  'primary',
  'consulting',
  'nurse',
  'admin',
  'other',
]);

function parseArguments(): Partial<Inputs> & { help?: boolean } {
  const { values } = parseArgs({
    options: {
      mrn: { type: 'string' },
      'first-name': { type: 'string' },
      'last-name': { type: 'string' },
      dob: { type: 'string' },
      sex: { type: 'string' },
      'care-team-user-id': { type: 'string' },
      'care-team-user-email': { type: 'string' },
      'care-team-role': { type: 'string' },
      'database-url': { type: 'string' },
      'non-interactive': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
    allowPositionals: false,
  });

  const result: Partial<Inputs> & { help?: boolean } = {};
  if (values.help) result.help = true;
  if (typeof values.mrn === 'string') result.mrn = values.mrn;
  if (typeof values['first-name'] === 'string') result.firstName = values['first-name'];
  if (typeof values['last-name'] === 'string') result.lastName = values['last-name'];
  if (typeof values.dob === 'string') result.dateOfBirth = values.dob;
  if (typeof values.sex === 'string') {
    const s = values.sex;
    if (s === '') result.sex = null;
    else if (s === 'male' || s === 'female' || s === 'intersex' || s === 'unknown') {
      result.sex = s;
    } else {
      throw new Error(`Invalid --sex: ${s}`);
    }
  }
  if (typeof values['care-team-user-id'] === 'string') {
    result.careTeamUserId = values['care-team-user-id'];
  }
  if (typeof values['care-team-user-email'] === 'string') {
    result.careTeamUserEmail = values['care-team-user-email'];
  }
  if (typeof values['care-team-role'] === 'string') {
    const r = values['care-team-role'];
    if (!CARE_TEAM_ROLES.has(r)) throw new Error(`Invalid --care-team-role: ${r}`);
    result.careTeamRole = r as Inputs['careTeamRole'];
  }
  if (typeof values['database-url'] === 'string') {
    result.databaseUrl = values['database-url'];
  }
  if (values['non-interactive'] === true) result.nonInteractive = true;
  return result;
}

async function promptText(
  rl: ReturnType<typeof createInterface>,
  label: string,
  fallback?: string,
): Promise<string> {
  const suffix = fallback !== undefined ? ` [${fallback}]` : '';
  const answer = (await rl.question(`${label}${suffix}: `)).trim();
  return answer === '' && fallback !== undefined ? fallback : answer;
}

async function collect(): Promise<Inputs> {
  const args = parseArguments();
  if (args.help === true) {
    process.stdout.write(USAGE);
    process.exit(0);
  }

  const env = process.env;
  const databaseUrl = args.databaseUrl ?? env['DATABASE_URL'];
  if (databaseUrl === undefined || databaseUrl === '') {
    throw new Error(
      'DATABASE_URL is required (set the env var or pass --database-url)',
    );
  }

  const nonInteractive = args.nonInteractive === true || !input.isTTY;
  const rl = nonInteractive
    ? null
    : createInterface({ input, output, terminal: true });

  try {
    const mrn =
      args.mrn ??
      env['EMR_PATIENT_MRN'] ??
      (rl !== null ? await promptText(rl, 'MRN') : '');
    if (mrn === '') throw new Error('Missing required field: mrn');

    const firstName =
      args.firstName ??
      env['EMR_PATIENT_FIRST_NAME'] ??
      (rl !== null ? await promptText(rl, 'First name') : '');
    if (firstName === '') throw new Error('Missing required field: first name');

    const lastName =
      args.lastName ??
      env['EMR_PATIENT_LAST_NAME'] ??
      (rl !== null ? await promptText(rl, 'Last name') : '');
    if (lastName === '') throw new Error('Missing required field: last name');

    const dateOfBirth =
      args.dateOfBirth ??
      env['EMR_PATIENT_DOB'] ??
      (rl !== null ? await promptText(rl, 'Date of birth (YYYY-MM-DD)') : '');
    if (!ISO_DATE.test(dateOfBirth)) {
      throw new Error(`Date of birth must be YYYY-MM-DD: ${dateOfBirth}`);
    }

    let sex: Inputs['sex'];
    if (args.sex !== undefined) {
      sex = args.sex;
    } else {
      const raw =
        env['EMR_PATIENT_SEX'] ??
        (rl !== null
          ? await promptText(
              rl,
              'Sex at birth (male/female/intersex/unknown, blank for NULL)',
              '',
            )
          : '');
      if (raw === '') sex = null;
      else if (SEX_VALUES.has(raw)) sex = raw as Inputs['sex'];
      else throw new Error(`Invalid sex value: ${raw}`);
    }

    const careTeamUserId =
      args.careTeamUserId ?? env['EMR_PATIENT_CARE_TEAM_USER_ID'] ?? null;
    const careTeamUserEmail =
      args.careTeamUserEmail ?? env['EMR_PATIENT_CARE_TEAM_USER_EMAIL'] ?? null;
    const careTeamRole =
      args.careTeamRole ??
      (env['EMR_PATIENT_CARE_TEAM_ROLE'] as Inputs['careTeamRole'] | undefined) ??
      'primary';
    if (!CARE_TEAM_ROLES.has(careTeamRole)) {
      throw new Error(`Invalid care_team_role: ${careTeamRole}`);
    }

    return {
      databaseUrl,
      mrn,
      firstName,
      lastName,
      dateOfBirth,
      sex,
      careTeamUserId: careTeamUserId === '' ? null : careTeamUserId,
      careTeamUserEmail: careTeamUserEmail === '' ? null : careTeamUserEmail,
      careTeamRole,
      nonInteractive,
    };
  } finally {
    rl?.close();
  }
}

async function createPatient(inputs: Inputs): Promise<void> {
  const client = new Client({ connectionString: inputs.databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');

    // Resolve the care-team target up front so we fail before creating
    // the patient if the user can't be found.
    let resolvedCareTeamUserId: string | null = null;
    if (inputs.careTeamUserId !== null) {
      const userRes = await client.query<{ id: string }>(
        'SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL',
        [inputs.careTeamUserId],
      );
      if (userRes.rowCount === null || userRes.rowCount === 0) {
        throw new Error(`Care-team user not found: ${inputs.careTeamUserId}`);
      }
      resolvedCareTeamUserId = userRes.rows[0]!.id;
    } else if (inputs.careTeamUserEmail !== null) {
      const userRes = await client.query<{ id: string }>(
        'SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL',
        [inputs.careTeamUserEmail],
      );
      if (userRes.rowCount === null || userRes.rowCount === 0) {
        throw new Error(
          `Care-team user not found for email: ${inputs.careTeamUserEmail}`,
        );
      }
      resolvedCareTeamUserId = userRes.rows[0]!.id;
    }

    const existing = await client.query<{ id: string }>(
      'SELECT id FROM patients WHERE mrn = $1',
      [inputs.mrn],
    );
    if (existing.rowCount !== null && existing.rowCount > 0) {
      throw new Error(`Patient already exists with MRN ${inputs.mrn}`);
    }

    const patientRes = await client.query<{ id: string }>(
      `INSERT INTO patients (mrn, first_name, last_name, date_of_birth, sex_at_birth)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        inputs.mrn,
        inputs.firstName,
        inputs.lastName,
        inputs.dateOfBirth,
        inputs.sex,
      ],
    );
    const patientId = patientRes.rows[0]!.id;

    if (resolvedCareTeamUserId !== null) {
      await client.query(
        `INSERT INTO care_team_assignments (patient_id, user_id, role)
         VALUES ($1, $2, $3)`,
        [patientId, resolvedCareTeamUserId, inputs.careTeamRole],
      );
    }

    await client.query('COMMIT');

    process.stdout.write(
      `Created patient ${patientId} (MRN ${inputs.mrn}, ${inputs.firstName} ${inputs.lastName})` +
        (resolvedCareTeamUserId !== null
          ? `; care team: ${resolvedCareTeamUserId} as ${inputs.careTeamRole}.\n`
          : ' (no care-team assignment).\n'),
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const inputs = await collect();
  await createPatient(inputs);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`db-create-patient: ${message}\n`);
  process.exit(1);
});
