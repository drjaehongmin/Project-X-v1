# 0003 — Services own their own state where possible, delegate to shell-supplied stores where not

- **Status:** Accepted
- **Date:** 2026-05-11
- **Deciders:** EMR architecture
- **Related modules / docs:** [`packages/services/src/audit.ts`](../../packages/services/src/audit.ts), [`packages/services/src/navigation.ts`](../../packages/services/src/navigation.ts), [`packages/services/CLAUDE.md`](../../packages/services/CLAUDE.md), [`ARCHITECTURE.md`](../../ARCHITECTURE.md)

## Context

`@emr/services` contains concrete implementations of every service interface declared in `@emr/contracts`. Two of those services — `NavigationService` and (less obviously) `NotificationService` — operate on state that genuinely lives in the shell: the list of open tabs, the patient groups, focus, the toast/banner DOM. The remaining three (`AuditService`, `PermissionService`, `DataService`) own all the state they need.

The split forces a question: where is the boundary between "service implementation" and "shell state"? If services own everything, the shell becomes an empty wrapper and `services` accumulates UI concerns. If the shell owns everything, services become noise — interfaces wrapped in identity functions. Neither extreme matches the layering rule in `CLAUDE.md` that services are the concrete implementations modules talk to.

## Decision

Services hold their own state when the state is genuinely service-internal; they delegate to a shell-supplied store interface when the state is shell state.

- **`AuditService`** owns its store. `createAuditStore()` returns an `AuditStore` (in-memory buffer + subscribers). `createScopedAuditService(store, { moduleId, userId })` wraps that store with per-module identity pre-binding. The shell instantiates one store and many scoped services.
- **`DataService`** owns its fixtures. Returned by `createDataService()`. Nothing in the shell.
- **`PermissionService`** owns its policy. `createPermissionService({ userRoles })` returns a service that delegates `can` to `@emr/shared`'s `permits` helper and short-circuits the rest. Nothing in the shell.
- **`NavigationService`** delegates to a `NavigationStore` the shell implements. The store interface lives in `@emr/services`; the implementation lives in `@emr/shell` against its Zustand store. The factory `createNavigationService(store)` is the seam.
- **`NotificationService`** is a `console.info` stub in `@emr/services` for the prototype. The shell replaces it with a chrome-rendering implementation in Step 5; the factory shape stays.

## Alternatives considered

- **All state in services.** Push tab/group/notification state into `@emr/services`. Forces the package to import React (so it can render toasts and a tab bar), which violates the layering rule that services are headless. Also makes Step-5 work harder because the shell can't own its own UI tree.
- **All state in shell, services are interfaces only.** `@emr/services` becomes a directory of factories that just return their input. Saves a layer, but loses the seam where cross-cutting concerns (audit-every-navigation, permission-check-every-write) would attach. The decoration point we want to keep is exactly the factory boundary.
- **Services as React context providers.** Mixes UI with policy. Couples the audit logger to the React tree, which makes testing audit logic require jsdom for no good reason.

## Consequences

- The shell will, in Step 5, implement `NavigationStore` against its Zustand store and pass it to `createNavigationService`. The contract is one-way: services depend on the store interface, not on the implementation.
- Adding cross-cutting behavior (audit-every-navigation, permission-checks on writes) is done by wrapping the factory output, not by editing the shell. Example: `createAuditingNavigationService(store, audit)` would compose with `createNavigationService` and live in `@emr/services`.
- `@emr/services` stays headless: no React, no DOM, no shell imports. ESLint's boundaries plugin enforces this — the `from: 'services'` rule allows only `contracts` and `shared`.
- Modules are unaffected. They receive `ModuleServices` regardless of where each implementation got its state. The split is invisible to module authors.
- Tests for stateful services (audit, data, permission) run under `environment: 'node'` — no jsdom needed.

## Notes

The `NotificationService` stub is the only case where the prototype's implementation is genuinely throwaway. Once the shell renders real toasts, `console.info` goes away. That's expected and not a violation of the rule — the factory signature stays the same; only the body changes.
