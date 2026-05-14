# @emr/services — Rules

## Purpose

Concrete implementations of the service interfaces declared in `@emr/contracts`. The shell instantiates these and injects per-module instances through props; modules never import this package directly (ESLint enforces it).

## Hard rules

- **Imports only from `@emr/contracts`, `@emr/shared`, and external libs.** No `@emr/module-sdk`, no `@emr/shell`. ESLint enforces this.
- **No React.** Services are headless and runnable in a Node test environment. UI lives in modules and the shell.
- **Services do not own shell state.** Tab lists, group lists, focus, the audit panel UI — these live in `@emr/shell`. Services either hold their own state (audit store, fixtures) or delegate to a shell-supplied store (navigation). Documented in `docs/adr/0003-services-delegate-to-shell-stores.md`.
- **Per-module scoping is the shell's job.** The shell builds a per-module `AuditService` with `createScopedAuditService(store, { moduleId, userId })`. Modules cannot spoof identity because they never see the unscoped store.

## File layout

- `src/audit.ts` — `AuditStore`, `createAuditStore()`, `createScopedAuditService(store, scope)`. In-memory; subscribers notified on every log.
- `src/data.ts` — `createDataService()`. Reads/searches return fixtures from `fixtures.ts` for `Patient`; everything else is empty/null. Write echoes; delete no-ops.
- `src/fixtures.ts` — hard-coded `samplePatients`. Single place to look when adjusting what demo modules see.
- `src/navigation.ts` — `NavigationStore` (shell-implemented) + `createNavigationService(store)` factory that wraps it.
- `src/notification.ts` — `createNotificationService()` that logs to `console.info`. The real chrome replaces this in Step 5.
- `src/permission.ts` — `createPermissionService({ userRoles })`. `can` delegates to `permits` from `@emr/shared` (exercises the seam); `canAccessPatient` and `canLaunchModule` short-circuit to `true`.
- `src/index.ts` — barrel.

## Conventions

- **Factories, not classes.** Every entry point is a `createXxxService(...)` function. Classes would invite inheritance and shared mutable state across modules; closures keep state local and per-instance.
- **`exactOptionalPropertyTypes`-friendly construction.** When building objects with optional fields (e.g. `AuditEntry`), spread conditionally rather than assigning `undefined`. The audit service does this; new services should follow.
- **Logs and warnings go through `console.info` / `console.warn`.** The shell can later replace these with a structured logger. Tests should not depend on console output.
- **Module-level mutable state is allowed for ID counters.** Audit entry IDs use a closed-over counter inside `audit.ts`. UUIDs would be better in production; for the prototype, monotone counters are deterministic and cheap. Tag any such counter with a comment explaining it.

## What goes here

- New service implementations that conform to an interface in `@emr/contracts`.
- Stores/state containers that those services need (audit log buffer, fixtures, etc.).
- Cross-cutting decorators around services (e.g. an `auditingNavigationService(inner, audit)` that wraps every nav call with an audit entry) — once a real consumer wants them.

## What does NOT go here

- Service interfaces themselves (those live in `@emr/contracts`).
- React-aware helpers — those live in `@emr/module-sdk` or the module.
- Tab/group state, session state, module registry — those live in `@emr/shell`.
- Shared helpers used by both services and modules — those live in `@emr/shared`.
