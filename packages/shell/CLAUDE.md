# @emr/shell — Rules

## Purpose

The host application. Owns the session, the tab/group state, the module registry, and the chrome (top bar, left nav, tab bar, audit panel, patient groups bar). Renders modules through `<ModuleRuntimeContext.Provider>` from `@emr/module-sdk`; modules never see anything else of the shell.

## Hard rules

- **Allowed imports:** `@emr/contracts`, `@emr/module-sdk`, `@emr/shared`, `@emr/services`, `@emr/data-client`, external libs. No imports from a module package's source — only `ModuleDefinition` values via the registry. The boundaries plugin enforces this.
- **The shell is the only party that constructs a `ModuleRuntime`.** `ModuleHost.tsx` is the only file that does so. If you find a second one, consolidate.
- **All navigation goes through `NavigationService`.** Chrome components import `navigationService` from `./services`, not the Zustand store actions. The store is the source of truth, but the seam is the service. This is what lets future cross-cutting concerns (audit-every-navigation, perm-checks, telemetry) attach without changing chrome or modules.
- **The shell does not import module internals.** `registered.ts` imports each module's public `ModuleDefinition`; nothing else under `modules/` reaches further.
- **No clinical features.** The shell renders chrome only.

## File layout

- `index.html`, `vite.config.ts` — Vite app entry.
- `src/main.tsx` — React entry, registers modules at boot.
- `src/App.tsx` — top-level routes (`/login`, `/app`).
- `src/store.ts` — Zustand store: `session`, `tabs`, `groups`, `activeTabId`, `activeGroupId`, and the actions that mutate them.
- `src/services.ts` — singletons (`auditStore`, `navigationService`, `notificationService`, `permissionService`, `dataService`) plus `createModuleServices(moduleId, userId)` for per-module bundles and `createShellAuditService(userId)` for shell-originated audit events.
- `src/modules/registry.ts` — `createModuleRegistry()` + the `moduleRegistry` singleton. Validates each manifest at registration.
- `src/modules/registered.ts` — the list of module definitions registered at boot. Add new modules here.
- `src/modules/ModuleHost.tsx` — the only place that builds a `ModuleRuntime`, wires services, dispatches `ModuleEvent`s back into the store, and renders the registered component.
- `src/auth/Login.tsx` — login form. Two flows behind one component: when `VITE_EMR_API_BASE_URL` is set, calls the backend's `/auth/login` + `/me/session` and persists tokens via `rememberTokens(...)`; otherwise falls back to the hardcoded `admin` / `Password123` pair so frontend-only dev still works.
- `src/auth/tokenStore.ts` — access + refresh tokens in memory + sessionStorage. Exposes the `TokenStore` interface the data-client reads from.
- `src/api.ts` — lazy HTTP-client singleton (auth + data services from `@emr/data-client`); `rememberTokens(...)` / `forgetTokens()` for the login + logout flows.
- `src/chrome/Shell.tsx` — grid layout: TopBar / LeftNav / Main (TabBar + content + PatientGroupBar) / AuditPanel.
- `src/chrome/TopBar.tsx` — workspace / location / user / Sign out.
- `src/chrome/LeftNav.tsx` — "Modules" panel; lists `registry.listLaunchable(canLaunchModule)`.
- `src/chrome/TabBar.tsx` — "Open Tabs" row.
- `src/chrome/AuditPanel.tsx` — "Audit Log" panel; subscribes to `auditStore`.
- `src/chrome/PatientGroupBar.tsx` — "Patient Groups" chips.
- `src/chrome/HomeView.tsx` — shown when no tab is active. Chrome content, not a module.
- `src/styles.css` — plain CSS; every panel has a visible label.

## Conventions

- **Every panel has a header label.** The reviewer should never have to guess what a strip of UI represents. New panels follow the same `.panel` / `.panel-header h2` convention in styles.css.
- **Mutations go through store actions, not `set`.** Chrome components call `useShellStore((s) => s.action)`; `services.ts` calls `useShellStore.getState().action(...)`. Don't reach into the store with a raw `set`.
- **Side-effects on sign-in / sign-out / navigation are audited.** New chrome interactions that change state should produce an audit entry through `createShellAuditService(userId)`.
- **No inline modules in the shell.** All feature modules live in `packages/modules/*`. The shell only references them through their public `ModuleDefinition` via `src/modules/registered.ts`.

## What goes here

- Chrome components, layout, theming.
- Session and tab/group state and the actions that mutate them.
- The module registry and the loader that mounts modules.
- The shell-side `NavigationStore` implementation (lives in `services.ts`).
- New routes (e.g. per-tab URL) once the prototype needs them.

## What does NOT go here

- Service interface definitions (those live in `@emr/contracts`).
- Service implementations beyond shell-state-coupled ones (those live in `@emr/services`).
- Feature module source — feature modules are independent packages under `packages/modules/*` and the shell only imports their `ModuleDefinition`.
- Shared utilities used by services or modules (those live in `@emr/shared`).
