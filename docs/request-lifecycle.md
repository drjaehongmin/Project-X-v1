# Request Lifecycle

The end-to-end path one request travels from a module calling `dataService.read(...)` to the JSON arriving back in its hands. This is the backend-side narrative companion to [`docs/architecture.md`](./architecture.md), which covers the frontend.

If you understand this document, you understand how every PHI byte exits the database — and the four independent layers that have to all agree before it does.

## The path, top to bottom

```
┌─────────────────────────────────────────────────────────────────────┐
│  Module                                                             │
│    services.data.read('Patient', id)                                │
└──────────────────────┬──────────────────────────────────────────────┘
                       │  (DataService from @emr/contracts)
                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│  @emr/data-client — createHttpDataService                           │
│    branches on resourceType → HttpClient.get('/patients/:id')       │
└──────────────────────┬──────────────────────────────────────────────┘
                       │  HTTP request
                       │    Authorization: Bearer <access JWT>
                       │    X-Module-Id: <module manifest id>
                       │    Accept: application/json
                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Backend (Fastify)                                                  │
│                                                                     │
│  1. CORS                                                            │
│       FRONTEND_ORIGIN check                                         │
│  2. requireAuth (preHandler)                                        │
│       jose.jwtVerify → claims                                       │
│       req.auth = { userId, sessionId, facilityId, roles, ... }      │
│  3. requirePermission('patient.read') (preHandler)                  │
│       hasPermission(roles, needed) → 403 if missing                 │
│  4. Handler                                                         │
│       withRlsContext(db, ctx, async (tx) => {                       │
│         set_config('app.user_id', ...)                              │
│         set_config('app.facility_id', ...)                          │
│         set_config('app.roles', ...)                                │
│         set_config('app.break_glass', ...)                          │
│                                                                     │
│         row = readPatientSummary(tx, id)   ◄── RLS evaluates here   │
│                                                                     │
│         writeAudit(tx, { action: 'record.read', ... })              │
│                                                                     │
│         return row                                                  │
│       })                                                            │
│  5. projectView(row, { allowed: PATIENT_SUMMARY_FIELDS, elements }) │
│       Narrow to _elements ∩ allow-list                              │
│  6. Schema serializer (Fastify)                                     │
│       Drop anything not in response[200] JSON Schema                │
└──────────────────────┬──────────────────────────────────────────────┘
                       │  JSON response
                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│  @emr/data-client — fetch.ts                                        │
│    On 200: parse JSON, return                                       │
│    On 401: TokenStore.refresh(), retry once                         │
│    On 4xx/5xx: throw HttpError(status, code, message)               │
└──────────────────────┬──────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Module                                                             │
│    summary returned, component re-renders                           │
└─────────────────────────────────────────────────────────────────────┘
```

Each block is a separate gate. PHI never leaves the database unless every gate above it agrees.

## The four independent gates (in order)

Every authenticated read flows through exactly four checks:

1. **Coarse permission gate.** `requirePermission('<resource>.<action>')` reads `req.auth.roles` and asserts the user has the named permission. Implemented in `packages/backend/src/permissions/require.ts`. Fails with **403** before any DB work happens. Fast and shallow — it doesn't know about specific rows.

2. **Row-Level Security.** Inside `withRlsContext`, Postgres evaluates the policy on every row the handler's SELECT touches. The policy joins through `care_team_assignments`, `break_glass_events`, or `user_roles` depending on the resource scope. A row that doesn't pass disappears from the result set — the handler sees a shorter list (or `null`). Implemented in the migrations (0002 predicates + per-table policies). The handler can't distinguish "missing" from "denied," so it returns **404** rather than 403 — by design, since "the patient with id X doesn't exist for you" is itself information.

3. **View projection.** The handler calls `projectView(row, { allowed, elements })`. `allowed` is the view's field allow-list; `elements` is the caller's `_elements=` query parameter. The result contains the intersection. Anything outside the view's allow-list is dropped, even if the SELECT accidentally pulled it. Implemented in `packages/backend/src/lib/view-projection.ts`.

4. **Schema serializer.** Fastify validates the response against `schema.response[200]` (a JSON Schema). With `additionalProperties: false`, any field outside the schema is stripped before the bytes go on the wire. This is the last-line defense — a bug in the projection or a query that accidentally widened the row never reaches the client. Implemented as a route-level config.

The redundancy is intentional. Any two of the four would suffice in the happy case; we run four because a single bug in any one of them should not be a PHI leak.

## The five things `withRlsContext` does

`withRlsContext(db, ctx, fn)` is the single most load-bearing helper in the backend. Concretely, in `packages/backend/src/db/rls.ts`:

1. Opens a Postgres transaction via Kysely.
2. Issues `SELECT set_config('app.user_id', $1, TRUE), set_config('app.facility_id', $2, TRUE), set_config('app.roles', $3, TRUE), set_config('app.break_glass', $4, TRUE)` — the `TRUE` makes each setting local to the transaction.
3. Hands the transaction to the caller's function.
4. Commits if the function returns; rolls back if it throws (including if the audit insert fails).
5. The settings vanish with the transaction — there's no leak into the next request.

The Postgres RLS predicates (`app_current_user_id()`, `app_is_on_care_team(...)`, `app_is_facility_staff(...)`) all read those `app.*` settings via `current_setting(..., TRUE)`. The trailing `TRUE` means "return NULL if unset" — so if a handler accidentally runs a query outside `withRlsContext`, every predicate returns FALSE and the SELECT returns zero rows. **Fail closed.**

The function is the only seam between application context and database trust. Every PHI read passes through it once.

## The audit row is part of the read

`writeAudit(tx, ...)` runs **inside the same transaction** as the SELECT it audits. Three consequences:

- If the SELECT throws, the audit row rolls back too. There is no audit entry for a read that didn't happen.
- If the audit insert fails (RLS denial, constraint violation), the SELECT rolls back too. The caller gets a 500, but there is no read that wasn't audited.
- The audit row is attributed to `req.auth.userId`. The `audit_logs` INSERT policy enforces `actor_user_id = app_current_user_id() OR actor_user_id IS NULL`. The handler can't forge a different actor even if it wanted to.

The `audit_logs` table has no UPDATE or DELETE policy. It's append-only at the database level, not just by convention.

## How auth tokens flow

Three tokens, three lifetimes:

| Token | Lifetime | Carries | Stored where |
|---|---|---|---|
| Access (JWT) | 15 min | `sub` (user), `sid` (session), `fid` (facility), `roles[]` | Frontend memory + sessionStorage |
| Refresh (opaque) | 30 days | Nothing — the row in `sessions` is the source of truth | Frontend sessionStorage; sha256 hash in DB |
| Session row | 30 days, revocable | `user_id`, `token_hash`, `expires_at`, `revoked_at` | DB |

**Issuance** — `/auth/login` verifies password (argon2id), computes the user's roles for the requested facility (or the global slice when `facilityId` is null), creates a session row inside `withRlsContext`, and returns access + refresh + sessionId.

**Per-request decoding** — `requireAuth` is a Fastify preHandler that pulls the Authorization header, calls `jose.jwtVerify` with the backend's secret, asserts the issuer/audience match, and populates `req.auth`. No DB lookup on the hot path — JWT signature is enough.

**Refresh-on-401** — the data-client catches a 401, calls `auth.refresh(refreshToken)`. The backend looks up the session by `token_hash`, confirms it isn't revoked or expired or owned by a deactivated user, rotates: revokes the old row (`revoked_at = now()`) and inserts a new one. New tokens come back; the data-client retries the original request once.

**Logout** — `/auth/logout` sets `revoked_at` on the active session row. The access token is still valid until it expires (≤ 15 min), but no further refreshes work. For security-critical logout (e.g., suspected breach), invalidating all the user's sessions is a single UPDATE.

## What changes when a module sets `X-Module-Id`

`@emr/data-client` propagates `X-Module-Id` on every outgoing request. The backend reads it in two places:

1. The audit row's `module_id` column — so compliance can answer "which module read this patient's allergies on Tuesday."
2. (Phase 2B+) Cross-checked against the module manifest's `data.reads` declaration. A module asking for a resource/view pair its manifest didn't declare gets a 403, regardless of whether the user has permission. The declaration becomes a contract between the module author and the runtime.

Phase 2A surfaces only the first behavior; the second is wired once `data` lands on `ModuleManifest` in `@emr/contracts`.

## When this picture changes

A few specific phases will edit specific blocks of the diagram:

- **Phase 2A.5** (real login) — the frontend block at the top changes. Login form calls `auth.login(...)`; tokens come from the backend rather than `sessionStorage` set by hand.
- **Phase 2B** (more resources) — each new resource adds a new route and a new view. The lifecycle is identical; only the data shapes differ.
- **Audit endpoints** — the `audit_logs` block flips from write-only (Phase 2A) to read-and-stream (Phase 2B+), but the write path is unchanged.
- **Break-glass elevation** — a future `/auth/break-glass` route writes a `break_glass_events` row and re-issues an access token with `breakGlass: true`. Subsequent requests carry the flag into `withRlsContext`, which sets `app.break_glass=1`, which makes `app_has_break_glass(patient_id)` return true for the affected patient. Same path, one extra setting.
- **AI tool calls** — agents reuse this exact path. The "module" at the top becomes the AI tool layer; the access token is the user's; RLS evaluates the same predicates. No special AI bypass.

## Common misconceptions

- **"RLS is enough, why have a permission gate too?"** RLS hides rows; it doesn't decide whether an endpoint is legal to hit at all. Without the coarse gate, a user with read access to one patient could hit `DELETE /patients/:id` for that patient and rely on UPDATE/DELETE policies to fail. Returning 403 at the door is clearer than returning 200 with zero rows changed.
- **"Why 404 instead of 403 for RLS-filtered rows?"** Because saying "you don't have access to patient X" leaks the existence of patient X. 404 says "no patient X for you" without distinguishing missing from denied.
- **"Can I skip `withRlsContext` if I'm sure the row is public?"** No. The pattern is what makes the codebase auditable. The handful of exceptions (`withSystemContext` for the email lookup at login) are named and reviewable. Adding a third is an ADR-worthy decision.
- **"Why isn't the user-roles permission set baked into the JWT, so a revoke takes effect immediately?"** Tradeoff. Baking it in saves a `user_roles` join on every facility check, but it means a revocation doesn't kick in until the access token expires (≤ 15 min). Live revocation matters more than the saved join. The session row is the authoritative source of "is this user still allowed" — for catastrophic revocation, set `sessions.revoked_at` and the next refresh fails.

## References

- [`packages/backend/CLAUDE.md`](../packages/backend/CLAUDE.md) — backend-internal rules.
- [`packages/backend/src/db/rls.ts`](../packages/backend/src/db/rls.ts) — the `withRlsContext` source.
- [`packages/backend/migrations/0002_rls_predicates.up.sql`](../packages/backend/migrations/0002_rls_predicates.up.sql) — the predicate library.
- [`docs/adr/0004-backend-stack-fastify-postgres.md`](./adr/0004-backend-stack-fastify-postgres.md) — why this stack, why RLS-first.
- [`docs/runbooks/local-setup.md`](./runbooks/local-setup.md) — bring the stack up locally and exercise this path.
- [`docs/runbooks/add-resource.md`](./runbooks/add-resource.md) — the recipe for adding a new resource that fits this lifecycle.
