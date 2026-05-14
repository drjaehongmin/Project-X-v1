# Add a New Module

The recipe for landing a new EMR feature module end-to-end — from the generator to the registered, gated, audited tab. Following this top-to-bottom produces a working module that compiles, lints, mounts in the shell, and exercises whatever backend resources it consumes.

If you find yourself improvising, stop and amend this runbook. Drift here is what makes future agents slower than they should be.

This is the **frontend** counterpart to [`add-resource.md`](./add-resource.md). If your module needs a backend table or endpoint that doesn't exist yet, land the resource first via that recipe, then build the module against it.

## Pick the scope

The manifest's `scope` field decides where the module mounts and what context it receives. Pick one **before** generating:

- `session` — has a `SessionContext`. Launchable from the LeftNav. Use for inboxes, dashboards, anything that doesn't bind to a single patient.
- `general` — same as `session` today; the distinction exists for the manifest type system. Use for admin / configuration / cross-patient workflows (e.g. `patient-create`, `admin-users`).
- `patient` — has both `SessionContext` and `PatientContext`. **Hidden from the LeftNav** — only reachable through another module's `NavigationService.openPatientGroup` or `openTabInGroup` call. Use for chart views, problem lists, allergy management — anything bound to a single patient.
- `global` — shell-provided service hosts. Not user-launchable. Don't generate these by hand; the shell registers them inline if needed.

Picking the wrong scope and changing later means re-doing the manifest's discriminated-union branch. Worth getting right up front.

## Step 1 — Generate the package

```
pnpm new-module <name> [--scope=session|general|patient]
```

The generator:
- Creates `packages/modules/<name>/` from `packages/modules/_template/`.
- Rewrites `package.json#name` to `@emr/module-<name>`.
- Writes `src/index.ts` with a stub manifest (correct discriminated-union branch for the scope).
- Writes `src/Component.tsx` with a minimal view using the right hook (`useSessionContext` for session/general, `usePatientContext` for patient).
- Writes a stub `CLAUDE.md` keyed to the module.
- Registers the new module in `packages/shell/src/modules/registered.ts`, `packages/shell/package.json`, and `packages/shell/tsconfig.json`.

Then:

```
pnpm install            # links the new workspace package
```

## Step 2 — Flesh out the manifest

`src/index.ts`:

```ts
const manifest: NonPatientModuleManifest = {
  id: 'my-module' as ModuleId,
  displayName: 'Display Name',     // shown in the LeftNav, tab bar, audit entries
  version: '0.1.0',
  scope: 'general',                // pre-set by the generator
  requires: ['session'],           // see below
  services: ['data', 'audit'],     // which services you call
  permissions: ['patient.write'],  // gate `canLaunchModule`
};
```

**Manifest checklist:**
- [ ] `id` is kebab-case and unique across the registry.
- [ ] `services` lists every service you call. Mismatch isn't enforced at runtime today, but lying here makes the module's surface area opaque.
- [ ] `permissions` lists capabilities the caller must have to **launch** the module (`PermissionService.canLaunchModule`). This is *coarser* than the per-action gating done by the backend; the backend's `requirePermission` is the source of truth for every individual call.
- [ ] `requires` matches your component's hook usage:
  - Patient-scoped modules: `['session', 'patient']`.
  - Otherwise: `['session']` (or `[]` for global).
- [ ] `version` follows semver. Bump on breaking changes to a module's persistent contract (URL params, exported types, etc.).

## Step 3 — Component shape

Hard rules from `@emr/module-sdk`:

- **Component takes no props.** Context arrives via hooks.
- **Hooks fail loudly outside their valid scope.** `usePatientContext` in a session-scoped module throws; `useServices` in a global-scoped module throws.
- **Imports**: only `@emr/contracts`, `@emr/module-sdk`, `@emr/shared`, and external libs. No sibling-module imports. ESLint enforces this.

Canonical hook usage:

```tsx
import { useSessionContext, usePatientContext, useServices, useNavigation } from '@emr/module-sdk';

export function MyModuleView(): JSX.Element {
  const session = useSessionContext();          // session/general/patient scopes
  const { patient, group } = usePatientContext(); // patient scope only — throws elsewhere
  const services = useServices();               // session/general/patient — throws on global
  const navigation = useNavigation();           // sugar for services.navigation
  // ...
}
```

## Step 4 — Read / search / write via DataService

The full DataService contract is documented in [`docs/data-service.md`](../data-service.md). Quick reference:

```ts
// Read one — null on 404 (incl. RLS-filtered)
const patient = await services.data.read<PatientSummary>('Patient', id, { signal });

// Search — params pass through to the URL
const encounters = await services.data.search<EncounterSummary>('Encounter', {
  params: { patientId, status: 'completed' },
  signal,
});

// Write — `id` present → PATCH; absent → POST
const created = (await services.data.write('Patient', {
  mrn, firstName, lastName, dateOfBirth, sex,
})) as unknown as PatientSummary;

const updated = (await services.data.write('Allergy', {
  id,                          // dispatches as PATCH
  status: 'resolved',
})) as unknown as AllergySummary;
```

**Conventions:**
- **Always pass an `AbortSignal`** from a single `AbortController` you create in a `useEffect`. Clean up by calling `controller.abort()` on unmount or before re-firing.
- **Loading / error / empty states are explicit.** No silent fallbacks. The `AsyncList<T>` / `AsyncValue<T>` pattern in `hello-patient-summary` (historical) and `patient-create` is the canonical shape.
- **Cast write results** via `as unknown as <T>` — `DataService.write<T>(resourceType, resource)` makes `T` both the input and output type, which doesn't fit create (input is a subset, output is full) or PATCH (input is the diff). The cast is documented; lint accepts it.

## Step 5 — Audit

The chrome's `AuditPanel` subscribes to the in-memory frontend `auditStore`; the backend writes to its own Postgres `audit_logs` table and those don't reach the panel (until a backend-poll endpoint lands).

So:

- **Lifecycle audit is automatic.** `ModuleHost` writes `module.opened` / `module.closed` on every mount/unmount. You don't need to do this.
- **Audit user-initiated state changes** explicitly via `services.audit.log({ action, resource, patient? })`. Example: after a successful `data.write`, log `<resource>.create` or `<resource>.update`. The backend will also audit at the database level; this frontend entry is what gives the user immediate visual feedback.
- **Never spoof identity.** The shell pre-binds `user` / `module` / `id` / `timestamp` — your `AuditLogInput` is just `action` / `resource` / optional `patient` / `before` / `after` / `reason`.

## Step 6 — Navigation

All navigation goes through `services.navigation` (or the sugar hook `useNavigation()`). The store is the source of truth; the service is the seam.

```ts
// Open a tab in the current session (general or session scope only)
navigation.openTab({ moduleId: 'other-module' as ModuleId });

// Open a new patient group; if `initialTab` is omitted the group has no
// tabs (useful when launching from a creation flow)
navigation.openPatientGroup({
  patient: { id: patientId, displayName },
  initialTab: { moduleId: 'patient-summary' as ModuleId },
});

// Add a sibling tab in the *same* patient group (patient-scoped modules)
navigation.openTabInGroup(group.id, { moduleId: 'patient-allergies' as ModuleId });
```

**Cross-module navigation is by string ID** — never import another module's source. The boundaries plugin will fail the build if you try.

## Step 7 — Register dependencies on services

Update the manifest's `services` list whenever you add a hook usage:

| Hook                            | Manifest entry |
|---------------------------------|----------------|
| `useServices().data.*`          | `'data'`       |
| `useServices().audit.*`         | `'audit'`      |
| `useNavigation()` / `services.navigation.*` | `'navigation'` |
| `useServices().notification.*`  | `'notification'` |
| `useServices().permission.*`    | `'permission'` |

It's documentation, not enforcement — but other developers (and Claude in future sessions) read the manifest first.

## Step 8 — Permissions

Two layers:

- **`manifest.permissions`** — gate the *launch* (LeftNav filtering, `canLaunchModule`). Keep this minimal — usually just one capability.
- **Backend `requirePermission(...)`** — gates each call. The backend is the source of truth; your module's `permissions` field is operator-visible documentation.

To grant a new permission to a role, edit `packages/backend/src/permissions/{catalog,compute}.ts`. The admin role today gets everything; other roles get specific subsets.

## Step 9 — Per-module doc

Update `packages/modules/<name>/CLAUDE.md` to describe:

- **Purpose** — what the module does and why it exists.
- **Manifest summary** — copy the manifest fields verbatim.
- **Hard rules** — keep the standard four (imports, single public entry, no props, hook usage).
- **Public API** — the `default` / `<name>Module` export.
- **Notes** — anything non-obvious. Backend endpoints consumed, audit events emitted, navigation entries, design tradeoffs.

If the module makes a significant architectural choice (e.g. a new SDK hook, a new permission category, a new render target), also write an ADR under `docs/adr/`.

Update `docs/module-catalog.md` to add a row in the inventory table. If the module is patient-scoped, document the canonical entry point (which other module opens it).

## Step 10 — Tests

Today, frontend modules don't have unit tests (only `@emr/module-sdk` and `@emr/services` do). The pattern when modules grow tests:

- Test files under `packages/modules/<name>/test/*.test.tsx`.
- `@testing-library/react` + `vitest`, environment `jsdom`.
- The `test/fakes.ts` pattern in `@emr/module-sdk` is the canonical way to build a fake `ModuleRuntime` so the component renders with a real `ModuleRuntimeContext.Provider` around it.

Until module-level tests are needed, lean on:
- `pnpm typecheck` — catches the manifest discriminated-union violations, missing hook deps, etc.
- `pnpm lint` — boundary plugin catches cross-module imports.
- Backend integration tests — they cover the resource the module talks to.

## Step 11 — Doc updates (the same PR)

- `CHANGELOG.md` — append a bullet under `## Unreleased`.
- `CURRENT.md` — mention the module under "Active workstreams" or "Next up" depending on state.
- `docs/module-catalog.md` — add the row.
- `docs/modules/<name>.md` — if it's substantial enough to warrant per-module narrative beyond the per-package `CLAUDE.md`.
- `PROJECT.md` — only if the module changes the success criteria (rare).

A PR that adds a module without updating the catalog is incomplete.

## What you do NOT do when adding a module

- **Do not import another module's source.** Cross-module references go by string ID through `NavigationService`. The boundaries plugin fails the build otherwise.
- **Do not instantiate services.** Always `useServices()`. Constructing a service in module code defeats the per-module audit identity binding.
- **Do not reach into the Zustand store.** Modules don't know `useShellStore` exists — `services.navigation` is the seam.
- **Do not pass props to the component.** The shell renders `<Component />` with no props. Context arrives via hooks.
- **Do not bypass `withRlsContext` on the backend.** Patient-scope reads must round-trip the JWT into Postgres locals. (Not your concern at the module layer, but worth knowing if the resource side is broken.)
- **Do not write CSS-in-JS or import a CSS framework.** Plain CSS in `packages/shell/src/styles.css`. Reuse the existing classes (`module-card`, `demo-list`, `demo-row`, `button-secondary`, etc. — to be renamed to neutral primitives in a future pass).
- **Do not embed plaintext secrets in the module.** Tokens are managed by `@emr/data-client`'s `TokenStore`; the shell wires it.

## Time budget

A module that consumes existing backend resources and fits the read/search/write patterns above lands in **about an hour** of focused work. Anything materially longer usually means:

- The module needs a new backend resource (land that first per `add-resource.md`).
- The module needs a new SDK affordance (a new hook, a new render target) — that's an ADR.
- The module is doing too much in one component — break it up.

If you're past two hours and not done, stop and check whether you've actually picked the right scope or whether you're inventing patterns the architecture doesn't support yet.
