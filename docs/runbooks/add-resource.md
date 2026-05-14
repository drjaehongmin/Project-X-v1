# Add a New Resource

The recipe for landing a new EMR resource end-to-end — from the database row to the module manifest. Following this top-to-bottom produces a working `GET /<resource>/:id?view=<name>` (and equivalents) with RLS, audit, and view-projection in place.

If you find yourself improvising, stop and amend this runbook. Drift here is what makes future agents slower than they should be.

## The five-file pattern

Every resource is the same five files (plus a migration). Pick `encounters` as the running example.

| File | What it owns |
|---|---|
| `packages/backend/migrations/NNNN_encounters.up.sql` (+ `.down.sql`) | Schema + RLS policies. |
| `packages/backend/src/db/types.ts` | Kysely table interface (one new entry). |
| `packages/backend/src/resources/encounters/views.ts` | Named view shapes (allow-list + JSON Schema). |
| `packages/backend/src/resources/encounters/queries.ts` | Kysely SELECTs that project view columns. |
| `packages/backend/src/resources/encounters/routes.ts` | Fastify routes (preHandlers, projection, audit). |
| `packages/backend/src/resources/encounters/index.ts` | Barrel that exports `register<Name>Routes`. |
| `packages/backend/src/server.ts` | Register the routes (one-line change). |

Optional, if a module consumes the new resource:
- `packages/modules/<module>/src/index.ts` — add the resource/view pair to the module's manifest `data.reads`.

## Step 0 — Pick the scope

Decide which access pattern applies. The choice determines the RLS policy template.

- **Patient-scoped.** Rows reference `patient_id`. Use `app_can_access_patient(patient_id)`. Most clinical tables fall here: encounters, problems, allergies, medications, vitals, orders, results, etc.
- **Facility-scoped.** Rows reference `facility_id` (or one of its descendants like department). Use `app_is_facility_staff(facility_id)`. Examples: rooms, provider_schedules, appointment_types.
- **Owner-scoped.** Rows reference `user_id` of an author or assignee. Use `<owner_col> = app_current_user_id()`. Examples: saved_reports, notification_preferences.
- **Reference data.** No PHI, public to all authenticated staff. SELECT policy is `app_current_user_id() IS NOT NULL`; writes are admin-only. Examples: drug_catalog, icd10_cm_codes.

If a resource is patient-scoped *and* facility-scoped (e.g. encounters reference both), the patient predicate wins for reads — care-team membership is more restrictive than facility staff, and it's the field that matters for PHI.

## Step 1 — Migration

Create both files next to the existing ones. Number sequentially.

`packages/backend/migrations/NNNN_<resource>.up.sql`:

```sql
-- NNNN — <resource> (SCHEMA.md §<section>).
-- One-line description of why this table exists.

CREATE TABLE <resource> (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- domain columns; mirror SCHEMA.md exactly
    patient_id      uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    -- ...
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz
);

CREATE INDEX <resource>_patient_idx ON <resource>(patient_id);

ALTER TABLE <resource> ENABLE ROW LEVEL SECURITY;

-- Patient-scoped template. Adjust the predicate for facility/owner/reference scopes.
CREATE POLICY <resource>_access_select ON <resource>
    FOR SELECT
    USING (app_can_access_patient(patient_id));

CREATE POLICY <resource>_staff_insert ON <resource>
    FOR INSERT
    WITH CHECK (
        app_is_admin()
        OR app_has_role('provider')
        OR app_has_role('clinician')
        OR app_has_role('nurse')
    );

CREATE POLICY <resource>_access_update ON <resource>
    FOR UPDATE
    USING (app_can_access_patient(patient_id))
    WITH CHECK (app_can_access_patient(patient_id));

CREATE POLICY <resource>_admin_delete ON <resource>
    FOR DELETE
    USING (app_is_admin());
```

`packages/backend/migrations/NNNN_<resource>.down.sql`:

```sql
DROP TABLE IF EXISTS <resource>;
```

Run `pnpm --filter @emr/backend db:migrate` to apply.

**Migration checklist:**
- [ ] `id` is `uuid PRIMARY KEY DEFAULT gen_random_uuid()`.
- [ ] `created_at` / `updated_at` defaulted; `deleted_at` nullable.
- [ ] Indexes for every column you'll filter on (FKs to parents are the common ones).
- [ ] `ENABLE ROW LEVEL SECURITY` is in this file, not deferred.
- [ ] At least one SELECT policy; INSERT/UPDATE/DELETE policies where the resource supports them.
- [ ] The matching `.down.sql` reverses the up.

## Step 2 — Kysely table type

Add an interface in `packages/backend/src/db/types.ts` and an entry on `Database`:

```ts
export interface EncountersTable {
  id: Generated<string>;
  patient_id: string;
  provider_id: string;
  facility_id: string;
  encounter_type_id: string | null;
  status: 'scheduled' | 'arrived' | 'in_progress' | 'completed' | 'cancelled' | 'no_show';
  start_time: ColumnType<Date, string | Date, string | Date>;
  end_time: ColumnType<Date | null, string | Date | null, string | Date | null>;
  chief_complaint: string | null;
  is_telehealth: ColumnType<boolean, boolean | undefined, boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deleted_at: ColumnType<Date | null, string | Date | null, string | Date | null>;
}

export interface Database {
  // ... existing
  encounters: EncountersTable;
}
```

Mirror nullability from the migration. Use `Generated<T>` for columns the DB sets (defaults, sequences) and `ColumnType<Read, Insert, Update>` for columns whose insert/update shape differs from the read shape (dates, timestamps, jsonb).

## Step 3 — Views

`packages/backend/src/resources/encounters/views.ts`:

```ts
export const ENCOUNTER_SUMMARY_FIELDS = [
  'id',
  'patientId',
  'providerId',
  'startTime',
  'status',
  'chiefComplaint',
] as const;

export type EncounterSummaryField = (typeof ENCOUNTER_SUMMARY_FIELDS)[number];

export interface EncounterSummaryRow {
  readonly id: string;
  readonly patientId: string;
  readonly providerId: string;
  readonly startTime: string; // ISO 8601
  readonly status: 'scheduled' | 'arrived' | 'in_progress' | 'completed' | 'cancelled' | 'no_show';
  readonly chiefComplaint: string | null;
}

export const encounterSummarySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
    patientId: { type: 'string', format: 'uuid' },
    providerId: { type: 'string', format: 'uuid' },
    startTime: { type: 'string', format: 'date-time' },
    status: { type: 'string', enum: ['scheduled', 'arrived', 'in_progress', 'completed', 'cancelled', 'no_show'] },
    chiefComplaint: { type: ['string', 'null'] },
  },
} as const;
```

**Views checklist:**
- [ ] Field names are **camelCase** (the wire shape, not the DB shape).
- [ ] `additionalProperties: false` — Fastify strips anything else.
- [ ] `required: [...]` is **omitted** so `_elements` narrowing doesn't violate the schema.
- [ ] One view per use case; views with overlapping fields are fine, but don't mix view shapes in one schema.

## Step 4 — Queries

`packages/backend/src/resources/encounters/queries.ts`:

```ts
import type { Transaction } from 'kysely';
import type { Database } from '../../db/types.js';
import type { EncounterSummaryRow } from './views.js';

export async function readEncounterSummary(
  tx: Transaction<Database>,
  id: string,
): Promise<EncounterSummaryRow | null> {
  const row = await tx
    .selectFrom('encounters')
    .select([
      'id',
      'patient_id',
      'provider_id',
      'start_time',
      'status',
      'chief_complaint',
    ])
    .where('id', '=', id)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (row === undefined) return null;
  return {
    id: row.id,
    patientId: row.patient_id,
    providerId: row.provider_id,
    startTime: toIso(row.start_time),
    status: row.status,
    chiefComplaint: row.chief_complaint,
  };
}

function toIso(value: Date | string): string {
  return typeof value === 'string' ? value : value.toISOString();
}
```

**Query checklist:**
- [ ] Each query takes a `Transaction<Database>` — the route wraps it in `withRlsContext`.
- [ ] `.select([...])` lists only the columns the view needs. No `selectAll()`.
- [ ] `.where('deleted_at', 'is', null)` if the table supports soft deletes.
- [ ] Map snake_case DB columns to camelCase view shape inside the function — the route never sees raw DB shape.

## Step 5 — Routes

`packages/backend/src/resources/encounters/routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { z } from 'zod';

import type { Database } from '../../db/types.js';
import { withRlsContext } from '../../db/rls.js';
import { writeAudit } from '../../audit/writer.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { parseElements, projectView } from '../../lib/view-projection.js';
import { Permissions } from '../../permissions/catalog.js';
import { requirePermission } from '../../permissions/require.js';
import { readEncounterSummary } from './queries.js';
import { ENCOUNTER_SUMMARY_FIELDS, encounterSummarySchema } from './views.js';

const paramsSchema = z.object({ id: z.string().uuid() });
const querySchema = z.object({
  view: z.enum(['summary']).default('summary'),
  _elements: z.string().optional(),
});

export function registerEncounterRoutes(
  app: FastifyInstance,
  deps: { db: Kysely<Database> },
): void {
  app.get(
    '/encounters/:id',
    {
      preHandler: [
        app.requireAuth,
        requirePermission(Permissions.Encounter.Read),
      ],
      schema: { response: { 200: encounterSummarySchema } },
    },
    async (req) => {
      const params = parse(paramsSchema, req.params);
      const query = parse(querySchema, req.query);
      const elements = parseElements(query._elements);
      const auth = req.auth!;

      const row = await withRlsContext(
        deps.db,
        {
          userId: auth.userId,
          facilityId: auth.facilityId,
          roles: auth.roles,
          breakGlass: auth.breakGlass,
        },
        async (tx) => {
          const found = await readEncounterSummary(tx, params.id);
          if (found === null) return null;
          await writeAudit(tx, {
            userId: auth.userId,
            action: 'record.read',
            resourceType: 'Encounter',
            resourceId: params.id,
            patientId: found.patientId,
            moduleId: moduleHeader(req),
            metadata: { view: query.view },
          });
          return found;
        },
      );

      if (row === null) throw new NotFoundError('Encounter');

      return projectView(row, {
        allowed: ENCOUNTER_SUMMARY_FIELDS,
        ...(elements !== null && { elements }),
      });
    },
  );
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ValidationError('Invalid request', { issues: result.error.issues });
  }
  return result.data;
}

function moduleHeader(req: { headers: Record<string, unknown> }): string | undefined {
  const raw = req.headers['x-module-id'];
  return typeof raw === 'string' ? raw : undefined;
}
```

**Route checklist:**
- [ ] `preHandler: [app.requireAuth, requirePermission(...)]` — auth first, permission second.
- [ ] `schema.response[200]` set to the view's JSON Schema.
- [ ] All DB work inside `withRlsContext(deps.db, { ... }, async (tx) => { ... })`. No top-level `db.selectFrom(...)`.
- [ ] `writeAudit(tx, ...)` lives inside the same transaction as the read.
- [ ] `404` on `null` rows. Never `403` for RLS-filtered rows (that leaks existence).
- [ ] `projectView(...)` is the last step before return.

`packages/backend/src/resources/encounters/index.ts`:

```ts
export * from './queries.js';
export * from './views.js';
export { registerEncounterRoutes } from './routes.js';
```

## Step 6 — Wire it up in server.ts

```ts
// packages/backend/src/server.ts
import { registerEncounterRoutes } from './resources/encounters/index.js';
// ...
registerEncounterRoutes(app, { db });
```

One line per resource.

## Step 7 — Permissions catalog

Add the resource's permission strings to `packages/backend/src/permissions/catalog.ts`:

```ts
export const Permissions = {
  // ... existing
  Encounter: {
    Read: 'encounter.read',
    Write: 'encounter.write',
  },
} as const;
```

And grant them to the relevant roles in `packages/backend/src/permissions/compute.ts`:

```ts
const ROLE_GRANTS: Record<string, readonly Permission[]> = {
  admin: [
    // ...existing
    Permissions.Encounter.Read,
    Permissions.Encounter.Write,
  ],
  provider: [
    // ...existing
    Permissions.Encounter.Read,
    Permissions.Encounter.Write,
  ],
  // ...
};
```

## Step 8 — Tests

Add a test file at `packages/backend/test/<resource>.test.ts`. Mirror the structure of `patients.test.ts`. **Minimum coverage:**

- 200 for a caller with access (admin or on care team) — assert the response shape matches the view.
- 404 for a caller without access — proves RLS-deny path.
- 401 with no bearer token.
- 403 for a role lacking the permission (use a role like `kiosk` that has no grants).
- `_elements=` narrows the response to the requested fields.

The `beforeEach(() => truncateAll(env))` keeps tests isolated. The `runOrSkip` pattern at the top of the file keeps CI green when no DB is available.

## Step 9 — Module manifest declaration

If a frontend module consumes the resource, add the resource/view pair to the module's manifest under `data.reads`. The runtime will reject `X-Module-Id` headers that request resources the manifest hasn't declared.

(Note: the `data` field on `ModuleManifest` is part of the planned enforcement work; if it's not in `@emr/contracts` yet at the time you read this, the runtime check is a no-op but the declaration in the manifest is still encouraged as documentation.)

## Step 10 — Data-client surface

If the new resource is consumed by the frontend, add a typed wrapper in `packages/data-client/src/data-service.ts` (or its own file once the surface grows). Keep the `DataService` contract in `@emr/contracts` unchanged — branch internally on `resourceType`:

```ts
async read<T = unknown>(resourceType, id, options) {
  if (resourceType === 'Patient') { /* existing */ }
  if (resourceType === 'Encounter') {
    try {
      const data = await http.get<EncounterSummary>(`/encounters/${id}`, {
        query: { view: 'summary' },
        ...(options?.signal !== undefined && { signal: options.signal }),
      });
      return data as unknown as T;
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) return null;
      throw err;
    }
  }
  return null;
}
```

When the resource surface grows beyond a handful of `if` branches, split into per-resource client modules. Until then, the inline branching is the lighter pattern.

## Doc updates (the same PR)

- `CHANGELOG.md` — under `## Unreleased`, one bullet describing the new resource, its policy scope, and the views it exposes.
- `docs/modules/<module>.md` — if a module's manifest changed.
- `ARCHITECTURE.md` — only if the addition introduces a new layer or import edge. Most resource additions don't touch it.

A new ADR is only warranted if the resource introduces a new pattern (e.g. polymorphic FK, jsonb-as-first-class, append-only ledger). Routine resources don't get ADRs.

## What you do NOT do when adding a resource

- **Do not add seed data.** Migrations create schema only. If a test needs rows, the test creates them in `beforeEach`.
- **Do not bypass `withRlsContext`.** The `withSystemContext` helper is reserved for two paths in the entire codebase (user lookup at login and refresh token lookup). New resources never use it.
- **Do not return raw DB rows.** Routes return view-shaped objects; the projection helper enforces the shape; the JSON Schema enforces it again.
- **Do not return 403 when RLS filters a row.** Use 404. The route can't even tell that the row exists.
- **Do not extend the JWT payload.** If a new claim is genuinely needed, that's an ADR-worthy decision (token bloat, revocation cost). Most "I need X at the predicate" needs are solved by a `user_roles` join in the predicate, not by stuffing more into the token.

## Time budget

A resource that fits the templates above lands in roughly an hour of focused work. Anything taking materially longer usually means the resource doesn't fit a template — and that's a signal to think about whether you're inventing a new pattern (in which case write the ADR first) or fighting one that exists (in which case fix the runbook).
