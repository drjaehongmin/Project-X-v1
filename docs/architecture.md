# Cruise Ship EMR — System Architecture (narrative)

This is the runtime-walkthrough companion to [`/ARCHITECTURE.md`](../ARCHITECTURE.md). The root file is the source of truth for the **rules** — the four-layer diagram, the import graph, the responsibilities of each layer. This file walks through the **behavior**: what happens when a user signs in, what each panel of the chrome does at runtime, how a module gets mounted, and where each piece of state lives.

For the rules in source-of-truth form, see [`/ARCHITECTURE.md`](../ARCHITECTURE.md). For the boundaries enforcement, see [`/.eslintrc.cjs`](../.eslintrc.cjs). For per-decision rationale, see [`docs/adr/`](./adr/). For the inventory of registered modules, see [`docs/module-catalog.md`](./module-catalog.md).

## What you see when you boot the app

Vite serves the shell at the configured host/port (default `http://127.0.0.1:5173`; set `PORT=5209` to use the controller-assigned frontend port). The app boots into `/login` because no `SessionContext` exists yet. Signing in with `admin` / `Password123` constructs a synthetic `SessionContext` (Clinic workspace, MV Aurora location, admin user), writes it to the Zustand store, logs an `auth.signIn` audit entry, and routes to `/app`.

`/app` renders the shell chrome:

- **Top Bar** — Cruise Ship EMR brand, three labelled context items (Workspace / Location / User), Sign out button.
- **Modules** — the left nav. Lists every launchable module the active user has permission to open. Patient-scoped modules are filtered out — they reach the screen only via another module's navigation call (see `hello-schedule`).
- **Open Tabs** — strip across the top of the content area. Active tab is highlighted; close button per tab.
- **Active content** — when a tab is selected, the module's component renders inside `.module-card` via `ModuleHost`. When no tab is selected, `HomeView` renders chrome content (not a module).
- **Patient Groups** — strip at the bottom of the content area. Shows one chip per active patient group with a tab count; clicking a chip focuses the group.
- **Audit Log** — right-hand panel. Subscribes to the in-memory audit store; entries appear in real time, newest first.

The login credentials, the hardcoded location, and the patient data fixtures are all in the source. There is no backend.

## Layers, briefly

The codebase splits into six layers under `packages/`, plus a generator script under `tools/` and docs under `docs/`. The import graph is one-way (no upward imports, no sibling imports between modules); see [`/ARCHITECTURE.md`](../ARCHITECTURE.md) for the diagram and the ESLint enforcement.

| Layer | What it owns |
|---|---|
| `contracts` | Pure types: branded IDs, context shapes (`SessionContext`, `PatientContext`, etc.), `ModuleManifest` (discriminated union), `ModuleLifecycle`, the five service interfaces. No runtime. |
| `module-sdk` | `defineModule` + scope-aware hooks (`useSessionContext`, `usePatientContext`, `useServices`, `useNavigation`, `useUnsavedState`). Reads from `ModuleRuntimeContext`. |
| `shared` | FHIR type stubs (`Patient`, `Practitioner`, `Encounter`, `Observation`, `HumanName`, `Reference`), permission helpers (`computeEffectivePermissions`, `permits`). Pure helpers. |
| `services` | Concrete service implementations: in-memory audit store with a scoped-service factory, fixture-returning data service, delegating navigation service, console-log notification stub, permissive permission service. |
| `modules/*` | Independent feature units. Each is a workspace package with a single public entry (`src/index.ts`) exporting a `ModuleDefinition`. The current inventory lives in [`docs/module-catalog.md`](./module-catalog.md). |
| `shell` | The host application — Vite + React, Zustand session/tab/group store, module registry, `ModuleHost` (the only place that builds a `ModuleRuntime`), chrome, login, audit panel. |

Decisions that shape these layers live in [`docs/adr/`](./adr/):

- **[ADR 0001](./adr/0001-module-manifest-discriminated-union.md)** — `ModuleManifest` is a discriminated union on `scope`, encoding `requires: 'patient' ⇒ scope: 'patient'` at the type level.
- **[ADR 0002](./adr/0002-sdk-hooks-read-from-runtime-context.md)** — SDK hooks read from `ModuleRuntimeContext`, not per-component props.
- **[ADR 0003](./adr/0003-services-delegate-to-shell-stores.md)** — services own their own state where possible (audit, data, permission), delegate to a shell-supplied store where not (navigation, notification).

## How a module gets mounted

The shell's module pipeline is a single path. There is no second entry point; if you find one, consolidate it.

1. **Registry population.** `packages/shell/src/main.tsx` imports `registeredModules` (a list of `ModuleDefinition`s) and calls `moduleRegistry.register(def)` for each. The registry validates each manifest at registration: unique ID, valid scope, declared services are real, `id`/`displayName`/`version` non-empty. Invalid manifests throw at boot — the app never reaches a render with a broken module.

2. **Launch.** When a user clicks a launchable module in the LeftNav, the chrome calls `navigationService.openTab({ moduleId })`. The service forwards to the shell's `NavigationStore` (implemented against the Zustand store), which generates a `TabId` and appends a `Tab` record. The active tab updates.

3. **Render.** The `Shell` chrome looks up `activeTab` from the store and renders `<ModuleHost tab={activeTab} />` in the content area.

4. **Mount.** `ModuleHost` is the only file that builds a `ModuleRuntime`. It looks up the module definition in the registry, constructs the right `ModuleProps` variant based on `manifest.scope` (`SessionModuleProps` for session/general, `PatientModuleProps` for patient), wires per-module services (audit pre-scoped to this module's ID and the active user), and renders:

   ```tsx
   <ModuleRuntimeContext.Provider value={{ manifest, props, emit }}>
     <Component />
   </ModuleRuntimeContext.Provider>
   ```

   The module's component takes no props. Everything it needs arrives via SDK hooks that read from `ModuleRuntimeContext` (ADR 0002).

5. **Events back.** When a module emits a `ModuleEvent` (`title-changed`, `request-close`, `request-focus`, `unsaved-state-changed`), `ModuleHost`'s `emit` handler dispatches it to the store. The shell never reaches into the module; the module never reaches into the shell.

## Context flow

Context is one-way: from outer (workspace) to inner (patient). Modules never reach upward.

- **Workspace + Location + User** are established at sign-in. The shell composes them into a `SessionContext` and writes it to the Zustand store.
- **Session-scoped and general-scoped modules** receive the session via `SessionModuleProps`. They have no patient.
- **Patient-scoped modules** receive both session and patient. `ModuleHost` constructs `PatientModuleProps` by looking up the tab's bound `PatientGroup` and pulling out the group's patient. The discriminated union in `@emr/contracts` ensures the manifest's `requires: ['session', 'patient']` lines up with `scope: 'patient'` at compile time.
- **The shell never passes context as props to the component.** It wraps the component in `<ModuleRuntimeContext.Provider value={{ manifest, props, emit }}>`; the module reads via hooks.

## Patient groups

A patient group is a stable container for one patient and the tabs bound to it. The session can hold multiple groups concurrently; each group holds its own list of tab IDs.

- A group is created by `NavigationService.openPatientGroup({ patient, initialTab })`. The shell generates a `PatientGroupId`, appends a `PatientGroup` record, and (if `initialTab` is set) opens the first patient-scoped tab in that group.
- Additional patient-scoped tabs in the same group are opened by `NavigationService.openTabInGroup(groupId, { moduleId })`. The tab inherits the group's patient.
- Closing a group prompts for unsaved state across all its tabs. Step 5 always returns `true`; the `canClose` veto wiring lands when a real SDK hook for it exists.
- The Patient Groups strip at the bottom of the main area shows one chip per group, with the patient's display name and the tab count. Clicking a chip focuses the group and (if it has tabs) its first tab.

Patient-scoped modules cannot launch from the LeftNav. They reach the screen only through `openPatientGroup` or `openTabInGroup`. The canonical example is `hello-schedule`'s "Open Patient Chart" button.

## Services

Five services, all instantiated once in `packages/shell/src/services.ts` and injected into modules via `ModuleHost`. Per ADR 0003, each service either owns its own state or delegates to a shell-supplied store.

- **AuditService** — backed by an in-memory `AuditStore` (a plain array + a `Set` of subscribers). The shell creates one store; each module gets a scoped `AuditService` instance with `moduleId` and `userId` pre-bound — modules cannot spoof identity. The audit panel subscribes to the store and re-renders on every entry.
- **NavigationService** — delegates to a `NavigationStore` the shell implements against `useShellStore.getState()`. The store is the source of truth for tabs and groups; the service is the seam future audit/permission decorators will attach to.
- **NotificationService** — a `console.info` stub for the prototype. The chrome will replace it with real toasts/banners in a later step; the factory signature stays.
- **PermissionService** — permissive stub. `can(action, resource)` delegates to `permits` from `@emr/shared` and returns `true`; `canAccessPatient` and `canLaunchModule` short-circuit to `true`. The seam between policy primitives (in `shared`) and the runtime service (in `services`) is exercised even while the policy itself is a no-op.
- **DataService** — returns `samplePatients` from `packages/services/src/fixtures.ts` for `Patient` reads/searches; null/empty for everything else. `write` echoes the resource back without persisting; `delete` is a no-op.

There is **no backend.** The controller-assigned backend port (5210) is reserved but unused. When a real backend lands, the data service is the natural first replacement; audit-store persistence is the second.

## Audit

Every meaningful action produces an `AuditEntry` with `{ id, timestamp, user, module, action, resource, patient?, before?, after?, reason? }`. The shell uses a `'shell'` module ID for chrome-originated events (sign-in, sign-out, navigation, unsaved-state transitions); modules get their own scoped audit services that pre-bind their `moduleId`.

The audit panel on the right of the chrome subscribes to the store and renders entries newest-first. It is purely a view of in-memory state today; entries are lost on page reload. Persistence is part of the eventual backend.

## Permissions

`PermissionService.can(action, resource)` is the only call site modules use. The runtime service is permissive in the prototype, but the seam is in place — the helper in `@emr/shared`'s `permits(granted, action, resource)` is wildcard-aware, and `computeEffectivePermissions(inputs)` is the future intersection point for role / location / workspace / patient-specific access.

Per the architecture rules in [`/CLAUDE.md`](../CLAUDE.md), permissions are checked at module launch, at every service call, and at every sensitive UI action. Today the launch check is wired (the LeftNav passes `canLaunchModule` into the registry filter); per-service and per-action checks land when policy lands.

## What is stubbed

- No backend, no API server, no database. Data lives in three hardcoded `Patient` fixtures.
- No real authentication. Login is string-compare against `admin` / `Password123`.
- Audit log is in-memory; lost on reload.
- Notifications log to `console.info` instead of rendering toasts.
- Permissions return `true` for everything.
- `canClose` veto is not wired; closing a tab always succeeds.
- No per-tab URLs; the shell uses store state, not the URL, to track the active tab.
- No real test coverage for the shell (the other layers have unit tests — 17 in `@emr/module-sdk`, 20 in `@emr/services`).

## How to extend

- **Add a new module.** `pnpm new-module <name> [--scope=<scope>]`. The script ([`tools/new-module.ts`](../tools/new-module.ts)) copies the template, rewrites the manifest, and registers the new module in the shell. Restart `pnpm dev` after `pnpm install`.
- **Add a new service interface.** Add the interface to `@emr/contracts`. Add a concrete implementation to `@emr/services`. Wire it into `ModuleServices` in both `contracts/src/lifecycle.ts` and `shell/src/services.ts`. Add a new SDK hook if modules will reach for it through a dedicated name.
- **Add a new context object.** Extend `@emr/contracts`, then update `ModuleProps` and the relevant manifest branch. Decide whether the new context implies a new scope or is scope-orthogonal (see ADR 0001's "Notes").
- **Replace the data service.** Implement a network-backed `DataService` in `@emr/services` (or a new package). The interface stays; only the body changes.
- **Persist the audit log.** Implement a network-backed `AuditStore` and wire it in `shell/src/services.ts`. Modules see no change.

## Reference

- [`/CLAUDE.md`](../CLAUDE.md) — non-negotiable architectural rules.
- [`/ARCHITECTURE.md`](../ARCHITECTURE.md) — the import graph, the layer responsibilities, the four scopes.
- [`/PROJECT.md`](../PROJECT.md) — purpose, success criteria, status.
- [`/CURRENT.md`](../CURRENT.md) — what is currently in flight.
- [`/CHANGELOG.md`](../CHANGELOG.md) — recent changes.
- [`docs/adr/`](./adr/) — architectural decision records.
- [`docs/modules/`](./modules/) — per-module documentation.
- [`docs/module-catalog.md`](./module-catalog.md) — inventory of registered modules.
