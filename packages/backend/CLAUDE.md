# @emr/backend — Rules

## Purpose

The HTTP API the frontend talks to. Fastify + Kysely + Postgres. Owns the migration set, the RLS-context plumbing, JWT issuance, the audit writer, and every resource endpoint. Listens on the controller-assigned port 5210.

## Hard rules

- **No imports from any frontend layer.** `@emr/contracts` is allowed (shared types); `@emr/services`, `@emr/module-sdk`, `@emr/shell`, `@emr/data-client`, and any `@emr/module-*` are not. ESLint enforces it.
- **Every authenticated handler wraps its DB work in `withRlsContext(...)`.** Calling `db.selectFrom(...)` outside the wrap is a bug — RLS predicates read `app.user_id` / `app.facility_id` / `app.roles` / `app.break_glass` from per-transaction settings, so without the wrap predicates fail closed and queries return zero rows. The handful of public bootstrap paths (`/auth/login` looking up a user by email) use `withSystemContext` and never return raw rows to the caller.
- **Every response goes through a view.** A view is two things: a JSON Schema attached to the route (`schema.response[200]`) and a field allow-list passed to `projectView`. Fastify strips anything not in the schema; the projection strips anything not in the allow-list. Both fire; one is enough but two is correct.
- **Every read/write is audited.** Handlers call `writeAudit(tx, ...)` inside the same transaction so a query failure rolls back the audit row too. Module ID comes from the `X-Module-Id` header set by `@emr/data-client`; absence is acceptable but logged.
- **No seed data committed to source.** Migrations create schema only. Bootstrap users are an admin-tool concern, not a migration concern.

## File layout

- `migrations/` — `XXXX_<name>.up.sql` + `.down.sql` pairs. Run with `pnpm db:migrate`. Numbering is sequential; never reorder once landed.
- `src/main.ts` — entry. Loads config, builds the server, listens, traps SIGINT/SIGTERM for graceful shutdown.
- `src/server.ts` — Fastify factory. Composes plugins, registers routes. Used by `main.ts` and by integration tests via `app.inject`.
- `src/config.ts` — env reader with explicit defaults; loaded once at boot.
- `src/db/client.ts` — `getDb(config)` singleton.
- `src/db/types.ts` — Kysely table interfaces. Hand-maintained until `kysely-codegen` is introduced.
- `src/db/rls.ts` — `withRlsContext` (the load-bearing helper) and `withSystemContext` (bypass for boot paths).
- `src/auth/` — password hashing (argon2id), JWT sign/verify (HS256 dev / RS256 prod), Fastify plugin, login/refresh/logout routes.
- `src/permissions/` — catalog (canonical strings), compute (role → permission), require (preHandler factory).
- `src/audit/writer.ts` — `writeAudit(tx, input)` insert helper. The shape of the row matches `SCHEMA.md` §14.
- `src/resources/<name>/` — one folder per resource. Each owns `views.ts`, `queries.ts`, `routes.ts`, optional `schema.ts`. The folder exports a `register<Name>Routes(app, deps)` function called once from `server.ts`.
- `src/plugins/` — generic Fastify plugins: error handler, (later) CORS, request-id, module-header validator.
- `src/lib/` — pure helpers (`errors.ts`, `view-projection.ts`).
- `test/` — integration tests against a real Postgres. Skipped when `TEST_DATABASE_URL`/`DATABASE_URL` is unset.

## Conventions

- **Factories, not classes** — matches the rest of the workspace.
- **Plain SQL migrations.** No DSL. `node-pg-migrate` runs each `.up.sql` file in order; the matching `.down.sql` defines the rollback. Cross-migration `CREATE OR REPLACE FUNCTION` is the canonical way to evolve predicates without dropping dependent policies.
- **Predicate stubs in `0002`, real bodies later.** Functions like `app_is_on_care_team` are declared in `0002` returning FALSE so policies can be written against them, then redefined in `0005`/`0006` once the backing tables exist. Down migrations restore the stub before dropping the table.
- **404 instead of 403 for RLS-filtered rows.** A row the caller cannot see is indistinguishable from a row that doesn't exist — and saying "you don't have access to patient X" leaks the patient's existence. Explicit permission failures (`requirePermission`) still return 403.
- **`_elements` is additive.** It can only narrow the view's allow-list; it can never widen it. The projection helper handles the intersection.

## What goes here

- New resources (one folder under `src/resources/`).
- New views on existing resources (add to `views.ts`, route to the new view).
- New migrations that add tables, columns, or RLS policies.
- New predicates in the RLS predicate library when a new access pattern emerges.
- Admin/bootstrap CLI scripts (under `tools/` at repo root, not under `src/`).

## What does NOT go here

- React, JSX, browser-specific code.
- The `DataService` interface (lives in `@emr/contracts`).
- HTTP client code (lives in `@emr/data-client`).
- Seed data for dev or production. Bootstrap a first admin through an admin tool you run by hand.
