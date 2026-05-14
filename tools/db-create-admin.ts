#!/usr/bin/env tsx
// db-create-admin — bootstrap a user (typically the first admin)
// against the EMR database.  Reads connection info from DATABASE_URL.
//
// Three modes of operation, in order of precedence per field:
//   1. CLI flag (e.g. `--email a@b.c`).
//   2. Environment variable (`EMR_BOOTSTRAP_EMAIL`, `EMR_BOOTSTRAP_PASSWORD`, ...).
//   3. Interactive prompt (only if stdin is a TTY).
//
// The script never seeds dummy data into committed migrations.  It is
// an operator tool: someone with DB credentials runs it once to create
// the first user, or scripts it from a secure bootstrap pipeline.
//
// Usage:
//   pnpm db-create-admin                              # fully interactive
//   pnpm db-create-admin --email a@b.c --role admin   # mixed
//   EMR_BOOTSTRAP_PASSWORD=... pnpm db-create-admin --email a@b.c --role admin --non-interactive

import argon2 from 'argon2';
import { Client } from 'pg';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { stdin as input, stdout as output } from 'node:process';

interface Inputs {
  databaseUrl: string;
  email: string;
  password: string;
  firstName: string;
  surname: string;
  userType: 'staff' | 'provider' | 'admin' | 'patient';
  roleName: string;
  facilityId: string | null;
  nonInteractive: boolean;
}

const USAGE = `
Usage: pnpm db-create-admin [options]

Options:
  --email <email>            User email (also: EMR_BOOTSTRAP_EMAIL)
  --password <password>      Plaintext password (also: EMR_BOOTSTRAP_PASSWORD)
  --first-name <name>        Given name (default: prompt)
  --surname <name>           Family name (default: prompt)
  --user-type <type>         staff | provider | admin | patient (default: admin)
  --role <name>              Role to grant (default: admin)
  --facility-id <uuid>       Scope the role to a facility; omit for a global role
  --database-url <url>       Postgres connection string (also: DATABASE_URL)
  --non-interactive          Fail rather than prompt for missing fields
  -h, --help                 Show this help and exit
`;

// Control-character codes used by the hidden-input prompt.  Kept as
// String.fromCharCode so the source file itself never contains raw
// control bytes (which some editors and pipelines mangle).
const CTRL_C = String.fromCharCode(3);
const CTRL_D = String.fromCharCode(4);
const DEL = String.fromCharCode(127);

function parseArguments(): Partial<Inputs> & { help?: boolean } {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      password: { type: 'string' },
      'first-name': { type: 'string' },
      surname: { type: 'string' },
      'user-type': { type: 'string' },
      role: { type: 'string' },
      'facility-id': { type: 'string' },
      'database-url': { type: 'string' },
      'non-interactive': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
    allowPositionals: false,
  });

  const result: Partial<Inputs> & { help?: boolean } = {};
  if (values.help) result.help = true;
  if (typeof values.email === 'string') result.email = values.email;
  if (typeof values.password === 'string') result.password = values.password;
  if (typeof values['first-name'] === 'string') result.firstName = values['first-name'];
  if (typeof values.surname === 'string') result.surname = values.surname;
  if (typeof values['user-type'] === 'string') {
    const t = values['user-type'];
    if (t !== 'staff' && t !== 'provider' && t !== 'admin' && t !== 'patient') {
      throw new Error(`Invalid --user-type: ${t}`);
    }
    result.userType = t;
  }
  if (typeof values.role === 'string') result.roleName = values.role;
  if (typeof values['facility-id'] === 'string') {
    result.facilityId = values['facility-id'];
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

// Promise-based hidden-input prompt.  Sets the raw mode flag on stdin
// so the password doesn't echo, and reassembles on backspace/enter.
async function promptHidden(label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    output.write(`${label}: `);
    if (!input.isTTY) {
      reject(new Error('Cannot read hidden input from a non-TTY stdin'));
      return;
    }
    const wasRaw = input.isRaw;
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');

    let value = '';
    const handler = (ch: string): void => {
      // Enter / Ctrl-D — finish.
      if (ch === '\n' || ch === '\r' || ch === CTRL_D) {
        input.setRawMode(wasRaw);
        input.pause();
        input.removeListener('data', handler);
        output.write('\n');
        resolve(value);
        return;
      }
      // Ctrl-C — abort.
      if (ch === CTRL_C) {
        input.setRawMode(wasRaw);
        input.pause();
        input.removeListener('data', handler);
        output.write('\n');
        reject(new Error('Aborted'));
        return;
      }
      // Backspace / DEL.
      if (ch === DEL || ch === '\b') {
        if (value.length > 0) {
          value = value.slice(0, -1);
          output.write('\b \b');
        }
        return;
      }
      value += ch;
      output.write('*');
    };
    input.on('data', handler);
  });
}

async function collect(): Promise<Inputs> {
  const args = parseArguments();
  if (args.help === true) {
    process.stdout.write(USAGE);
    process.exit(0);
  }

  const env = process.env;
  const fields: Record<string, string | undefined> = {
    databaseUrl: args.databaseUrl ?? env['DATABASE_URL'],
    email: args.email ?? env['EMR_BOOTSTRAP_EMAIL'],
    password: args.password ?? env['EMR_BOOTSTRAP_PASSWORD'],
    firstName: args.firstName ?? env['EMR_BOOTSTRAP_FIRST_NAME'],
    surname: args.surname ?? env['EMR_BOOTSTRAP_SURNAME'],
    userType: args.userType ?? env['EMR_BOOTSTRAP_USER_TYPE'] ?? 'admin',
    roleName: args.roleName ?? env['EMR_BOOTSTRAP_ROLE'] ?? 'admin',
    facilityId:
      args.facilityId !== undefined
        ? args.facilityId
        : env['EMR_BOOTSTRAP_FACILITY_ID'],
  };

  const nonInteractive = args.nonInteractive === true || !input.isTTY;

  // databaseUrl is non-negotiable — without it we can't proceed.
  if (fields.databaseUrl === undefined || fields.databaseUrl === '') {
    throw new Error(
      'DATABASE_URL is required (set the env var or pass --database-url)',
    );
  }

  const rl = nonInteractive
    ? null
    : createInterface({ input, output, terminal: true });

  try {
    if (fields.email === undefined || fields.email === '') {
      if (rl === null) throw new Error('Missing required field: email');
      fields.email = await promptText(rl, 'Email');
    }
    if (fields.firstName === undefined || fields.firstName === '') {
      if (rl === null) fields.firstName = 'Admin';
      else fields.firstName = await promptText(rl, 'First name', 'Admin');
    }
    if (fields.surname === undefined || fields.surname === '') {
      if (rl === null) fields.surname = 'User';
      else fields.surname = await promptText(rl, 'Surname', 'User');
    }
    if (fields.password === undefined || fields.password === '') {
      if (rl === null) {
        throw new Error(
          'Missing required field: password (set EMR_BOOTSTRAP_PASSWORD or --password)',
        );
      }
      fields.password = await promptHidden('Password (hidden)');
      const confirm = await promptHidden('Confirm password');
      if (confirm !== fields.password) {
        throw new Error('Passwords do not match');
      }
    }
  } finally {
    rl?.close();
  }

  if (fields.password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }

  const userType = fields.userType;
  if (
    userType !== 'staff' &&
    userType !== 'provider' &&
    userType !== 'admin' &&
    userType !== 'patient'
  ) {
    throw new Error(`Invalid user_type: ${userType}`);
  }

  return {
    databaseUrl: fields.databaseUrl,
    email: fields.email!,
    password: fields.password,
    firstName: fields.firstName!,
    surname: fields.surname!,
    userType,
    roleName: fields.roleName!,
    facilityId:
      fields.facilityId === undefined || fields.facilityId === ''
        ? null
        : fields.facilityId,
    nonInteractive,
  };
}

async function createUser(inputs: Inputs): Promise<void> {
  const passwordHash = await argon2.hash(inputs.password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  const client = new Client({ connectionString: inputs.databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query<{ id: string }>(
      'SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL',
      [inputs.email],
    );
    if (existing.rowCount !== null && existing.rowCount > 0) {
      throw new Error(`User already exists with email ${inputs.email}`);
    }

    const userRes = await client.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, first_name, surname, user_type)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [inputs.email, passwordHash, inputs.firstName, inputs.surname, inputs.userType],
    );
    const userId = userRes.rows[0]!.id;

    const roleRes = await client.query<{ id: string }>(
      `INSERT INTO roles (name)
       VALUES ($1)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [inputs.roleName],
    );
    const roleId = roleRes.rows[0]!.id;

    if (inputs.facilityId !== null) {
      const facCheck = await client.query<{ id: string }>(
        'SELECT id FROM facilities WHERE id = $1 AND deleted_at IS NULL',
        [inputs.facilityId],
      );
      if (facCheck.rowCount === null || facCheck.rowCount === 0) {
        throw new Error(`Facility not found: ${inputs.facilityId}`);
      }
    }

    await client.query(
      `INSERT INTO user_roles (user_id, role_id, facility_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, role_id, facility_id) DO NOTHING`,
      [userId, roleId, inputs.facilityId],
    );

    await client.query('COMMIT');

    process.stdout.write(
      `Created user ${userId} (${inputs.email}) with role "${inputs.roleName}"` +
        (inputs.facilityId === null
          ? ' (global scope).\n'
          : ` at facility ${inputs.facilityId}.\n`),
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
  await createUser(inputs);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`db-create-admin: ${message}\n`);
  process.exit(1);
});
