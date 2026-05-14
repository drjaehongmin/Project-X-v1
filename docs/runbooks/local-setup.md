# Local Setup

Start-to-finish guide to a working full-stack EMR on a dev machine — Postgres, backend on `:5210`, shell on `:5209`, real data flowing through both. Follow top to bottom; each block is a single command unless noted.

If anything in this runbook is wrong, fix it the same PR as the code that breaks it. A stale runbook costs every contributor (and every future Claude session) far more than a few extra minutes of editing.

## Prerequisites

- **Node 20.10+** and **pnpm 9+** — match the `engines` field in the root `package.json`.
- **A Postgres 16 instance the backend can reach.** Three supported paths:
  - Docker (easiest, default).
  - A native install (`apt install postgresql-16`, `brew install postgresql@16`).
  - A managed/cloud DB (Supabase, Neon, RDS) — point `DATABASE_URL` at it.
- **Git, the usual.**

If you take the managed-DB path, skip the Docker step and set `DATABASE_URL` directly.

## 1. Install workspace dependencies

```bash
pnpm install
```

This installs every workspace package, including `@emr/backend` and `@emr/data-client`. Run from the repo root.

## 2. Bring up Postgres

### Option A — Docker (default)

```bash
pnpm --filter @emr/backend db:up
```

Postgres 16 listens on `localhost:5432` with user `emr`, password `emr`, database `emr`. Data persists in the named volume `emr-postgres-dev-data`. To wipe state, `pnpm --filter @emr/backend db:reset` brings the volume down, back up, and runs migrations.

### Option B — Native install

```bash
createuser -s emr
createdb -O emr emr
psql -d emr -c "ALTER USER emr WITH PASSWORD 'emr';"
```

Or use whatever credentials you prefer — then update `packages/backend/.env`.

### Option C — Managed DB

Skip to step 3. Make sure your URL grants the `pgcrypto` and `citext` extensions (most managed providers do by default; the migration enables them with `CREATE EXTENSION IF NOT EXISTS`).

## 3. Configure backend environment

```bash
cp packages/backend/.env.example packages/backend/.env
```

Open `packages/backend/.env` and confirm:

- `DATABASE_URL` matches the Postgres you just brought up. Default is `postgres://emr:emr@localhost:5432/emr`.
- `JWT_SECRET` is a string of at least 32 bytes. The default in `.env.example` is fine for local dev. **Never use the default in production.**
- `PORT=5210` (the controller-assigned slot — don't change without updating `CLAUDE.md`).
- `FRONTEND_ORIGIN=http://localhost:5209` so CORS allows the shell.

The backend reads these at boot; `process.env` overrides `.env`, so CI/staging can override without touching the file.

## 4. Run migrations

```bash
pnpm --filter @emr/backend db:migrate
```

Applies `migrations/0001_extensions.up.sql` through the latest. Idempotent — running twice is a no-op. To roll back the most recent migration, `pnpm --filter @emr/backend db:migrate:down`.

After this step, the database has:
- All RLS predicates from 0002 (with stub bodies for `app_is_on_care_team`, `app_is_self_patient`, `app_has_break_glass` that are replaced in 0005/0006).
- The strengthened `app_is_facility_staff` from 0007.
- Empty `users`, `roles`, `user_roles`, `sessions`, `facilities`, `vessels`, `patients`, `care_team_assignments`, `break_glass_events`, `audit_logs` tables.

No data — every table starts empty.

## 5. Bootstrap a first admin user

There is no seed data. To log in, create at least one user. The `db-create-admin` CLI handles this — interactive by default, scriptable with flags or env vars.

**Interactive (recommended for first-time setup):**

```bash
DATABASE_URL=postgres://emr:emr@localhost:5432/emr pnpm db-create-admin
```

The script prompts for email, first name, surname, and a hidden password (with confirmation). It defaults to `--user-type admin --role admin --facility-id <null>`, which gives the new user a global admin role — fine for the first user. For non-admin test users, pass `--user-type` / `--role` / `--facility-id` explicitly.

**Non-interactive (CI, scripted bootstrap):**

```bash
DATABASE_URL=... \
EMR_BOOTSTRAP_PASSWORD='CorrectHorseBatteryStaple1!' \
pnpm db-create-admin \
  --email admin@example.test \
  --first-name Admin --surname User \
  --role admin \
  --non-interactive
```

Useful flags:

- `--user-type <staff|provider|admin|patient>` — default `admin`.
- `--role <name>` — created in `roles` on first use; reused on subsequent calls.
- `--facility-id <uuid>` — scope the role to a facility. Omit for a global role (`facility_id IS NULL`).
- `--database-url <url>` — override `$DATABASE_URL`.

All fields also accept `EMR_BOOTSTRAP_*` env vars (`EMR_BOOTSTRAP_EMAIL`, `EMR_BOOTSTRAP_PASSWORD`, `EMR_BOOTSTRAP_FIRST_NAME`, `EMR_BOOTSTRAP_SURNAME`, `EMR_BOOTSTRAP_USER_TYPE`, `EMR_BOOTSTRAP_ROLE`, `EMR_BOOTSTRAP_FACILITY_ID`). Precedence is CLI flag → env var → interactive prompt.

The script:
1. Validates the user doesn't already exist (`email` is `UNIQUE` + soft-delete aware).
2. Hashes the password with argon2id (same params as the backend).
3. Inserts the user, ensures the role row exists, links via `user_roles`.
4. Wraps the whole operation in a single transaction — partial failures roll back.

## 6. Start the backend

```bash
pnpm --filter @emr/backend dev
```

Watch for `Server listening on http://0.0.0.0:5210` in the output. Hit `GET http://localhost:5210/health` to confirm it answers `{ ok: true }`.

A quick login test:

```bash
curl -s -X POST http://localhost:5210/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.test","password":"Password123"}' | jq
```

You should see `accessToken`, `refreshToken`, `sessionId`, `expiresIn`, `user`. Keep the access token for the next step.

## 7. Start the shell (and point it at the backend)

```bash
VITE_EMR_API_BASE_URL=http://localhost:5210 pnpm dev
```

Vite serves on `http://localhost:5209`. The Login form detects the env var and switches to **real backend mode**: it POSTs to `/auth/login` with the email + password you set in step 5, persists the access + refresh tokens, and pulls the canonical session shape from `/me/session`. Sign-in fails surface the backend error message directly.

Without the env var, the shell falls back to the in-memory `DataService` from `@emr/services` (fixtures only) and the Login form accepts the hardcoded `admin` / `Password123` pair. Useful for frontend-only dev when no backend is running.

Sign-out (the button in the TopBar) calls `POST /auth/logout` to revoke the refresh-token row server-side, clears local tokens, and routes back to `/login`. Local sign-out still proceeds if the server is unreachable.

## 8. Verify the patient summary path

The smallest end-to-end check that proves every layer is wired:

1. **Insert a patient** (psql or via a future endpoint):
   ```sql
   INSERT INTO patients (mrn, first_name, last_name, date_of_birth, sex_at_birth)
   VALUES ('MRN-0001', 'Ada', 'Lovelace', '1815-12-10', 'female');
   ```
2. **Add the admin to the patient's care team** so RLS permits the read (admin would pass anyway, but exercising the predicate is the point):
   ```sql
   INSERT INTO care_team_assignments (patient_id, user_id, role)
   SELECT p.id, u.id, 'admin'
   FROM patients p, users u
   WHERE p.mrn = 'MRN-0001' AND u.email = 'admin@example.test';
   ```
3. **Hit the endpoint**:
   ```bash
   curl -s "http://localhost:5210/patients/$(psql -At "$DATABASE_URL" -c "SELECT id FROM patients WHERE mrn = 'MRN-0001'")?view=summary" \
     -H "Authorization: Bearer $ACCESS_TOKEN" | jq
   ```
   Response:
   ```json
   { "id": "...", "mrn": "MRN-0001", "displayName": "Ada Lovelace", "dateOfBirth": "1815-12-10", "sex": "female" }
   ```
4. **Confirm the audit row landed**:
   ```sql
   SELECT action, resource_type, patient_id, module_id FROM audit_logs ORDER BY id DESC LIMIT 1;
   ```
   Expect `record.read | Patient | <id> | <module_id or NULL>`.

If all four work, every layer of the stack — JWT → permissions → RLS context → query → projection → audit — is functioning.

## 9. Run the test suite

```bash
TEST_DATABASE_URL="$DATABASE_URL" pnpm --filter @emr/backend test
```

`packages/backend/test/patients.test.ts` runs against the Postgres at that URL. Tests truncate every table between cases — **do not point this at a database with data you care about.** If `TEST_DATABASE_URL`/`DATABASE_URL` is unset the suite skips silently (CI-friendly).

The frontend tests (`@emr/module-sdk`, `@emr/services`) run with `pnpm test` from the root and don't need a DB.

## Common gotchas

- **"Server returns 404 for a patient I just inserted."** The RLS predicate `app_can_access_patient` requires `is_admin OR is_self_patient OR is_on_care_team OR has_break_glass`. Add the user to `care_team_assignments` (or use an admin user) and try again. The 404 is intentional — a row the caller can't see is indistinguishable from a missing row, by design.
- **"Migrations fail with 'permission denied to create extension'."** Some managed Postgres providers restrict `CREATE EXTENSION`. Enable `pgcrypto` and `citext` via the provider's UI first, then re-run.
- **"Frontend says 'CORS error'."** Check `FRONTEND_ORIGIN` in `packages/backend/.env`. It must match the Vite dev server's origin (`http://localhost:5209` by default).
- **"Tests pass instantly but produce no output."** They were skipped. Set `TEST_DATABASE_URL` (or `DATABASE_URL`) to a reachable Postgres.
- **"`JWT_SECRET must be at least 32 bytes in production`."** You set `NODE_ENV=production` without bumping the secret. Either use a long secret or stay in `development`.
- **"`Token missing roles`."** The user has no `user_roles` rows. Insert at least one — global (`facility_id IS NULL`) for an admin, or facility-scoped for a regular user.

## Next steps

- Phase 2A.5 lands the `db-create-admin` CLI and the real Login swap, which removes steps 5 and 7's manual paths.
- Phase 2B+ adds new resources; the recipe lives in [`docs/runbooks/add-resource.md`](./add-resource.md).
- For the request lifecycle (frontend → backend → DB → response), see [`docs/request-lifecycle.md`](../request-lifecycle.md).
