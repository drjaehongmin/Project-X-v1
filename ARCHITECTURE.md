# Architecture

This document is the entry point for the system's structure. The non-negotiable rules live in `CLAUDE.md`; this file shows how those rules are realized in code.

**Companion docs:**
- [`docs/architecture.md`](./docs/architecture.md) — frontend runtime walkthrough (boot, login, module mount).
- [`docs/request-lifecycle.md`](./docs/request-lifecycle.md) — backend request lifecycle (auth → RLS → query → audit → projection → response).
- [`docs/data-service.md`](./docs/data-service.md) — the `DataService` contract every module uses (read/search/write/delete, dispatch rules, conventions).
- [`docs/runbooks/local-setup.md`](./docs/runbooks/local-setup.md) — bring the full stack up locally.
- [`docs/runbooks/add-resource.md`](./docs/runbooks/add-resource.md) — the five-file recipe for adding a new EMR backend resource.
- [`docs/runbooks/add-module.md`](./docs/runbooks/add-module.md) — the recipe for adding a new frontend module end-to-end.
- [`docs/module-catalog.md`](./docs/module-catalog.md) — inventory of registered modules.
- [`docs/adr/`](./docs/adr/) — per-decision rationale.

## Top-level shape

The repo is split into two cooperating areas:

- **Frontend** — a layered React/Vite shell hosting independent modules. The four-layer model below describes this.
- **Backend** — an independent Fastify + Postgres service serving the API the frontend's `DataService` talks to. Sits at port 5210, imports only `@emr/contracts` for shared types, and never reaches into the frontend layers. See [`packages/backend/CLAUDE.md`](./packages/backend/CLAUDE.md) and [`docs/adr/0004-backend-stack-fastify-postgres.md`](./docs/adr/0004-backend-stack-fastify-postgres.md).

A thin adapter package, **`@emr/data-client`**, sits between the two: it exposes an HTTP-backed `DataService` implementing the contract from `@emr/contracts`, so the shell can swap the in-memory stub for real network reads without modules noticing.

## Four-Layer Model (frontend)

The frontend code is organized into four layers under `packages/`. Dependencies flow strictly downward — an upper layer may depend on layers below it, never the reverse, and never sideways across siblings.

```
┌─────────────────────────────────────────────────────────────┐
│  shell                                                      │
│  - Vite + React application                                 │
│  - Session store, module registry, tab/group manager        │
│  - Hosts modules; never imports their source directly       │
└──────────────────────────┬──────────────────────────────────┘
                           │ depends on
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  modules/*                                                  │
│  - Independent feature units (one public entry each)        │
│  - Receive context + services as props via module-sdk       │
│  - May NOT import from sibling modules                      │
└──────────────────────────┬──────────────────────────────────┘
                           │ depends on
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  module-sdk      services       shared                      │
│  - hooks         - concrete     - FHIR stubs                │
│  - defineModule  - service impl - permissions helpers       │
│                                 - cross-cutting utilities   │
└──────────────────────────┬──────────────────────────────────┘
                           │ depends on
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  contracts                                                  │
│  - Types only, no runtime                                   │
│  - Context shapes, manifest, lifecycle, service interfaces  │
└─────────────────────────────────────────────────────────────┘
```

### Layer responsibilities

| Layer        | What it owns                                                        | What it may import          |
|--------------|---------------------------------------------------------------------|-----------------------------|
| `contracts`  | Pure TypeScript types: contexts, manifest, lifecycle, service APIs. | Nothing internal.           |
| `module-sdk` | `defineModule`, hooks (`useSessionContext`, etc.). No runtime UI.   | `contracts`.                |
| `shared`     | FHIR type stubs, permission helpers, cross-cutting utilities.       | `contracts`.                |
| `services`   | Concrete implementations of service interfaces (prototype stubs).   | `contracts`, `shared`.      |
| `modules/*`  | Feature modules. Single public entry. Isolated from siblings.       | `contracts`, `module-sdk`, `shared`, external libs. |
| `shell`      | The host: registry, routing, chrome, session/group management.      | `contracts`, `module-sdk`, `shared`, `services`, `data-client`, and module manifests via the registry only. |
| `data-client`| HTTP-backed `DataService` + auth client. Bridge to the backend.     | `contracts`. |
| `backend`    | Fastify API server, migrations, RLS, auth, audit. Port 5210.        | `contracts`. No frontend layers. |

## Import Graph (Enforced)

ESLint (`eslint-plugin-boundaries`) enforces the rules above. The graph in textual form:

- `contracts` → (nothing internal)
- `module-sdk` → `contracts`
- `shared` → `contracts`
- `services` → `contracts`, `shared`
- `data-client` → `contracts`
- `backend` → `contracts`
- `modules/<any>` → `contracts`, `module-sdk`, `shared`
- `shell` → `contracts`, `module-sdk`, `shared`, `services`, `data-client`, plus the module registry surface (never a module's internal source)

Forbidden by ESLint:
- `modules/A` importing `modules/B`
- Any module importing from `services`, `data-client`, or `backend` directly
- Any module importing from `shell`
- `services` importing from `module-sdk` or `shell`
- `data-client` importing from anything other than `contracts`
- `backend` importing from any frontend layer
- `contracts` importing from anything in the workspace

## Context Hierarchy (from `CLAUDE.md`)

Context scopes nest from outer to inner. Context flows downward only; nothing reaches upward.

1. **Workspace Type** — Clinic, Case Management, Clinical Operations, Admin. Selects module set, terminology, layouts.
2. **Location** — Vessel or clinic. Selects providers, schedules, formularies, rules.
3. **User** — Identity, role, permissions, audit identity.
4. **Session** — Workspace + Location + User, established at login.
5. **General Modules** — Session-scoped, patient-independent.
6. **Patient Context Groups** — Multiple concurrent groups per session. Each holds one patient and its bound tabs.
7. **Patient Modules** — Operate inside a patient context group; receive patient as a prop.

## Module Scopes

A module declares exactly one scope, validated by the shell at registration:

- `global` — Shell-provided services (audit, navigation, notifications). Not user-launchable.
- `session` — Requires session context only.
- `general` — Session-scoped, patient-independent.
- `patient` — Requires an active patient context group.

## Services (Injected)

Modules never instantiate services. The shell injects them via props:

- `AuditService`
- `NavigationService`
- `NotificationService`
- `PermissionService`
- `DataService`

See `docs/modules/` for per-module structure and `docs/adr/` for architectural decision records.

## Backend (Phase 2A)

The backend lives under `packages/backend/` and listens on the controller-assigned port 5210.

- **Stack** — Node 20 + TypeScript + Fastify + Kysely + Postgres 16, brought up locally via `packages/backend/docker-compose.dev.yml`.
- **RLS-first access control** — every authenticated handler wraps its DB work in `withRlsContext(...)`, which opens a transaction and writes `app.user_id` / `app.facility_id` / `app.roles` / `app.break_glass` as Postgres locals. The RLS policies declared in migrations 0002–0006 evaluate against those locals; a handler that forgets the wrap sees zero rows because the predicates fail closed.
- **Views, not tables, are the contract.** Each endpoint declares a named view (a JSON Schema + a column allow-list). Fastify strips fields not in the schema; the projection helper strips fields not in the allow-list. An optional `_elements=` query parameter narrows that further. Adding a column to a table never changes the response.
- **Auth** — Argon2id password hashing, HS256 JWT access tokens (15 min), opaque rotating refresh tokens stored hashed in `sessions`. Switch to RS256 in production by swapping the key material in `auth/jwt.ts`. Endpoints: `/auth/login`, `/auth/refresh`, `/auth/logout`, `/me/session`.
- **Audit** — every read/write inserts an `audit_logs` row in the same transaction as the work itself; the table is append-only and RLS-restricted to admin/compliance for reads. The frontend's audit panel becomes a view of this log once the read endpoint lands (Phase 2B).
- **Phase 2A surface** — exactly one resource endpoint, `GET /patients/:id?view=summary`, plus the auth and session endpoints. Subsequent resources land per the five-file pattern (migration → views → queries → routes → manifest declaration); the structure is deliberately mechanical.

See [`packages/backend/CLAUDE.md`](./packages/backend/CLAUDE.md) for backend-internal rules, [`docs/request-lifecycle.md`](./docs/request-lifecycle.md) for the end-to-end request narrative, and [`docs/adr/0004-backend-stack-fastify-postgres.md`](./docs/adr/0004-backend-stack-fastify-postgres.md) for the load-bearing decisions. To add a new resource end-to-end, follow [`docs/runbooks/add-resource.md`](./docs/runbooks/add-resource.md). To bring the stack up locally, follow [`docs/runbooks/local-setup.md`](./docs/runbooks/local-setup.md).

## Status

Frontend scaffolding complete. Backend Phase 2A landed: package skeleton, Postgres + migrations 0001–0006, JWT auth, RLS context plumbing, audit writer, and the patient summary endpoint. The shell's `DataService` switches to HTTP when `VITE_EMR_API_BASE_URL` is set, otherwise falls back to in-memory fixtures. Next phase is real feature rollout — scale the resource surface horizontally (encounters → problems → meds → vitals → appointments → inventory) and replace the fake login.
