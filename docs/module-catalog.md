# Module Catalog

The inventory of every module the shell registers today. Each row links to its per-module doc in `docs/modules/<id>.md` when one exists; per-package source lives in `packages/modules/<id>/`.

For the conventions per-module docs follow, see [`docs/modules/README.md`](./modules/README.md). For the runtime walkthrough that shows how these get mounted, see [`docs/architecture.md`](./architecture.md).

## Inventory

| ID | Display Name | Scope | Package | Purpose |
|---|---|---|---|---|
| `patient-create` | Create Patient | general | `@emr/module-patient-create` | Register a new patient in the database. Posts to `POST /patients`; the backend auto-adds the caller to the patient's care team so the new row is immediately visible. First module to *write* through `DataService`. |
| `admin-users` | Admin · Users & Access | general | `@emr/module-admin-users` | Admin IAM surface. Create users (`POST /users`), create roles (`POST /roles`), grant roles to users with optional facility scope (`POST /user-roles`). The grant step is the runtime RLS-scoping knob — a `user_roles` row narrows what `app_current_roles()` and `app_current_facility_id()` return at login. Gated by the `user.write` permission (admin role only). |

`packages/modules/_template` is the source the `pnpm new-module` generator copies from. It is **not** registered with the shell.

## Visible set in the LeftNav

The LeftNav lists every launchable module the active user has permission to open, except patient-scoped modules. With the registrations above, the LeftNav shows **two entries**: Create Patient (for callers with `patient.write`) and Admin · Users & Access (for callers with `user.write`, i.e. admin role only).

Patient-scoped modules launch in one of two ways:

- **New group** — `NavigationService.openPatientGroup({ patient, initialTab })` creates a `PatientGroup` bound to the given patient and opens the requested module as the group's first tab. `patient-create`'s "Open patient group" button calls this without an `initialTab`, which leaves the group with no tabs until a patient-scoped module is built.
- **Sibling tab** — `NavigationService.openTabInGroup(groupId, { moduleId })` adds another patient-scoped tab to an existing group. The new tab inherits the group's patient.

## Cross-module navigation is by string ID

No module imports another. Cross-module references go through the registry as `'<id>' as ModuleId` and the boundaries plugin's same-module-only rule for `modules/*` (configured in [`.eslintrc.cjs`](../.eslintrc.cjs)) makes this safe by construction — `modules/A` importing `modules/B` fails lint.

## Adding a new module

```
pnpm new-module <name> [--scope=<global|session|general|patient>]
```

The script copies `packages/modules/_template`, rewrites `package.json#name`, the manifest (`id`, `displayName`, `scope`, `requires`, type-narrowed to `NonPatientModuleManifest` or `PatientModuleManifest`), and the component (heading is the capitalized name; the right hook for the scope), then registers the new module in `packages/shell/src/modules/registered.ts`, `packages/shell/package.json` (sorted), and `packages/shell/tsconfig.json` references.

Run `pnpm install` to link the new workspace package, then restart `pnpm dev`. Add a `docs/modules/<id>.md` describing the manifest, public API, dependencies, key decisions, and known limitations — the template in [`docs/modules/README.md`](./modules/README.md).

## What's next

There are no patient-scoped modules registered today. The natural next step is `pnpm new-module patient-summary --scope=patient` (or similar) to render the chart content for a patient opened via `patient-create`'s "Open patient group" button.
