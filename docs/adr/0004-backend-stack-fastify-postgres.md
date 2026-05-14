# 0004 — Backend stack: Fastify + Kysely + Postgres with database-enforced RLS

- **Status:** Accepted
- **Date:** 2026-05-12
- **Deciders:** J
- **Related modules / docs:** [`/SCHEMA.md`](../../SCHEMA.md), [`packages/backend/CLAUDE.md`](../../packages/backend/CLAUDE.md), [`/ARCHITECTURE.md`](../../ARCHITECTURE.md)

## Context

The shell scaffolding is complete. The next phase needs a backend on the controller-assigned port 5210 that the frontend's `DataService` can talk to. The data model is the EMR schema in `SCHEMA.md`: ~100 tables, PHI-heavy, with a strict hierarchical access model (workspace → location → user, plus per-patient care-team / break-glass). Phase-2A's job is to prove a vertical slice (patient summary read) end-to-end so subsequent resources can be added mechanically.

The decision space spans three independent axes: HTTP framework, query layer, and where access control is enforced.

## Decision

The backend is a TypeScript Fastify server, talking to Postgres via Kysely on the raw `pg` driver. Access control is enforced primarily by **Postgres Row-Level Security** evaluated against per-transaction settings (`app.user_id`, `app.facility_id`, `app.roles`, `app.break_glass`) that the backend writes before any authenticated query. The backend layers permission checks (a coarse `requirePermission(...)` preHandler) and view-shaped response projection on top, so every PHI exit path crosses at least three independent gates.

## Alternatives considered

- **A FHIR server (HAPI, Aidbox)** — would force our data model into FHIR's resource shapes from day one. Half our domain (case management, AI chat, inventory) isn't FHIR-native, and the divergence between an internal model and a vendored FHIR model creates a translation tax forever. We will stay FHIR-shaped at the API edge (resource types, sparse `_elements` reads) without committing to a FHIR storage backend.
- **Express or NestJS instead of Fastify** — both work. Fastify's first-class JSON-Schema response serializer is load-bearing for the "only what the frontend asked for" rule: schemas attached to routes strip any extra fields before the response leaves the process. NestJS adds DI complexity we don't need at this size; Express requires bolting on the serializer.
- **Prisma or TypeORM instead of Kysely** — both abstract too much. RLS + per-request session settings depend on issuing queries on a known transaction, with us in control of the connection and the SET LOCAL statements. Kysely is a typed query builder, not an ORM; we keep query shape under our control while still getting types.
- **Permission checks only in application code, not RLS** — would mean a single forgotten check or a future bug becomes a PHI breach. RLS is the load-bearing layer because it fails closed: if the request context isn't set or the predicate doesn't match, queries return zero rows.
- **A separate authn service (Auth0, Clerk, etc.)** — defers a problem we can do in-house at this stage (HS256 JWTs in dev, RS256 in prod, refresh tokens rotated through `sessions`). The user model is deeply tied to clinical access (care-team membership, break-glass) and a third-party authn provider has no view into that.

## Consequences

**Makes easier:**
- A new resource is a five-file pattern: migration + RLS policies → views.ts → queries.ts → routes.ts → manifest declaration. The structure is mechanical.
- Adding new fields to a table never breaks the frontend, because views (not tables) are the public contract.
- An RLS-filtered row looks like a missing row to the caller — no information leak about whether a patient exists outside the caller's care.
- Tests can run against a real Postgres in CI; in-memory mocks would mask the load-bearing predicate logic.

**Makes harder:**
- Every authenticated handler must remember to wrap its work in `withRlsContext(...)`. The convention is documented and ESLint can be extended to flag bare `db.selectFrom(...)` outside that wrap, but until then it relies on review.
- Predicate evolution is a CREATE OR REPLACE pattern — stubs in 0002, real bodies in 0005/0006. Down-migrations must restore stubs before dropping tables.
- Public bootstrap paths (`/auth/login` looking up users by email) need `withSystemContext`, which bypasses RLS. That bypass must never return raw rows to the caller.

**Obligations introduced:**
- Every new table that holds PHI or facility-scoped data ships in the same migration as its RLS policy. Untrusted reads from a table without RLS are now a build-time failure (a CI lint will check `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` for any new table under `packages/backend/migrations/`).
- Every new endpoint declares a named view; ad-hoc `SELECT * FROM ...` is not allowed.
- The `withSystemContext` bypass is documented as a sharp tool. Each use is reviewable as a small list of files.

## Notes

- Phase 2A delivers: package skeleton; `docker-compose.dev.yml` (Postgres 16); migrations 0001–0006 (extensions, RLS predicates, users/roles/sessions, facilities/vessels, patients, care-team + audit_logs); auth (`/auth/login`, `/auth/refresh`, `/auth/logout`, `/me/session`); one resource endpoint (`GET /patients/:id?view=summary`); `@emr/data-client` with an HTTP-backed `DataService`; shell wired to use it when `VITE_EMR_API_BASE_URL` is set; integration tests covering care-team allow, RLS deny, 401, 403, and `_elements` narrowing.
- The frontend's existing fake login (`admin`/`Password123`) is unchanged in Phase 2A. Real login lands in Phase 2A.5 once we decide on the dev-bootstrap workflow (admin CLI vs. one-shot env-driven first user).
- HS256 with a shared secret is the dev default for JWT signing. Production must switch to RS256 with a keypair; the swap is a `jose.importSPKI` / `importPKCS8` change in `auth/jwt.ts`.
