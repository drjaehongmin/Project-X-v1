<!-- controller:ports -->
Controller-assigned ports — frontend: **5209**, backend: **5210** (backend slot reserved; no backend service exists yet). See `~/Projects/Controller-v2/MODULES/project-ports.md` for the registry.
<!-- /controller:ports -->

# Cruise Ship EMR — Architecture Rules

## Documentation Maintenance — Required

These docs are part of every deliverable. Keep them current as you work; stale docs are worse than verbose ones.

- **CHANGELOG.md** — append a bullet under `## Unreleased` for every change that affects behavior, structure, or interface. The `## Unreleased` section is rolled to a dated section externally on git push (see `tools/changelog-roll.sh` if present); do not roll it manually.
- **CURRENT.md** — keep "Active workstreams", "Blockers", "Decisions awaiting input", and "Next up" reflective of reality.
- **PROJECT.md** — update when scope, purpose, success criteria, or status changes.
- **ARCHITECTURE.md** — update the system-design diagram and component list for any non-trivial structural change.
- **docs/modules/<module>.md** — for any module or subsystem introduced or significantly modified, create or update its doc. Each module gets its own file describing purpose, public API, dependencies, key decisions, and ADR links. Create `docs/modules/` on first use.
- **docs/adr/** — for decisions that change the architecture, add a short ADR (Architectural Decision Record) and link it from the relevant module doc and from ARCHITECTURE.md.
- **docs/module-catalog.md** — add a row whenever a module is registered, edited, or removed. The catalog is the canonical inventory of what the shell knows about.

## Reference Docs (Read Before You Build)

These are the load-bearing references for cold-start work. If you're picking up the project in a new session, start here.

- **[`docs/runbooks/add-module.md`](./docs/runbooks/add-module.md)** — the end-to-end recipe for adding a new frontend module: generator, manifest, hooks, DataService usage, audit, navigation, permissions, docs. Mirrors `add-resource.md`.
- **[`docs/runbooks/add-resource.md`](./docs/runbooks/add-resource.md)** — the five-file backend recipe (migration → Kysely type → views → queries → routes → wire), plus permissions and tests. Used by both clinical and reference-data resources.
- **[`docs/runbooks/local-setup.md`](./docs/runbooks/local-setup.md)** — bring the full stack up locally (Postgres, migrations, backend, shell). The smoke-test path.
- **[`docs/data-service.md`](./docs/data-service.md)** — the `DataService` contract used by every module: `read` / `search` / `write` / `delete`, the `RESOURCE_PATHS` map, the `id`-present → PATCH vs absent → POST write dispatch, the `as unknown as T` cast convention, AbortSignal handling, fixture vs HTTP mode.
- **[`docs/architecture.md`](./docs/architecture.md)** — frontend runtime walkthrough (boot, login, module mount).
- **[`docs/request-lifecycle.md`](./docs/request-lifecycle.md)** — backend request lifecycle (auth → RLS → query → audit → projection → response).
- **[`docs/module-catalog.md`](./docs/module-catalog.md)** — current inventory of registered modules and how cross-module navigation works.

These updates happen in the same change as the code they describe, not after. A PR that changes behavior without updating the relevant doc is incomplete.

## Hierarchy and Scopes

The system is organized as nested context scopes, outer to inner:

1. **Workspace Type** — Clinic, Case Management, Clinical Operations, Admin. Determines available modules, terminology, layouts.
2. **Location** — Specific vessel or clinic. Affects providers, schedules, formularies.
3. **User** — Identity, role, permissions, audit identity.
4. **Session** — Workspace + Location + User, established at login.
5. **General Modules** — Session-scoped, patient-independent (schedule, inbox, tasks).
6. **Patient Context Groups** — Multiple concurrent groups per session. Each holds one patient and its bound tabs.
7. **Patient Modules** — Operate inside a patient context group; receive patient as a prop.

Context flows downward only. Modules never reach upward for context — they receive it.

## Module Scopes

Every module declares exactly one scope:

- `global` — Shell-provided services (audit, navigation, notifications). Not user-launchable.
- `session` — Requires session context only (workspace + location + user).
- `general` — Session-scoped, patient-independent.
- `patient` — Requires an active patient context group.

## Module Isolation Rules (Strict)

- Modules **never** import from other modules. ESLint enforces this and will fail the build.
- Modules import only from `@emr/contracts`, `@emr/module-sdk`, `@emr/shared`, and external libs.
- Modules **never** access global state directly. All context and services arrive via props/hooks from the SDK.
- Each module exposes a single public entry point (`src/index.ts`). Internals are private.
- Shared code lives only in `@emr/shared` or `@emr/contracts`. If two modules need the same logic, lift it to `@emr/shared` — do not import it from a sibling module.

## Module Manifest (Required)

Every module declares a manifest with:

- `id` — unique string, kebab-case.
- `displayName` — human-readable name.
- `scope` — `global | session | general | patient`.
- `requires` — explicit list of context objects needed.
- `services` — explicit list of injected services used.
- `permissions` — roles or capabilities required to launch.
- `version` — semver string.

The shell validates the manifest at registration. Modules without a valid manifest do not load.

## Module Lifecycle Contract

Every module implements:

- `onMount(props)` — initial setup with provided context and services.
- `onUnmount()` — cleanup.
- `onContextChange(prev, next)` — react to context updates from the shell.
- `canClose(): boolean | Promise<boolean>` — used by shell for unsaved-state warnings.
- `save?(): Promise<void>` — optional, for modules with persistent state.

## Patient Context Groups

- A session may contain multiple patient context groups simultaneously.
- Each group has exactly one active patient and zero or more patient-scoped tabs.
- Patient-scoped tabs belong to a specific group and never silently switch patients.
- Switching a group's patient is an explicit user action, audited.
- Closing a group prompts for unsaved state across all its tabs.
- Groups are visually distinct so the active patient is unambiguous at all times.

## Services (Injected, Never Instantiated by Modules)

- `AuditService` — log every patient-scope entry and every sensitive action.
- `NavigationService` — open/close/focus tabs and groups. Modules request navigation; shell decides.
- `NotificationService` — toasts, alerts, banners.
- `PermissionService` — `can(action, resource)`. Modules query, never compute permissions themselves.
- `DataService` — read/search/write clinical data. Stubbed in prototype; FHIR-shaped.

Modules receive services via props. They do not import service implementations.

## Permissions Model

Effective permissions = intersection of:
- User role permissions
- Location permissions
- Workspace permissions
- Patient-specific access (care-team, consent, break-glass)

Permissions are checked at: module launch, every service call, every sensitive UI action. Centralized in `PermissionService`.

## Audit Requirements

- Every patient-scope module entry is audited.
- Every read of patient data is audited.
- Every write is audited with before/after.
- Every break-glass or override is audited with reason.
- Audit entries include: user, timestamp, patient (if applicable), module, action, resource.

## Repository Structure