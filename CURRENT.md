# Current State

Snapshot of in-flight work. Keep this honest — stale entries are worse than missing entries.

## Active workstreams

- **Documentation pass for cold-start sessions.** Landed. Two new reference docs — `docs/runbooks/add-module.md` (the frontend equivalent of `add-resource.md`) and `docs/data-service.md` (the `DataService` contract reference, including the `id`-present → PATCH vs absent → POST write dispatch and the `as unknown as T` cast convention). `CLAUDE.md` grows a "Reference Docs (Read Before You Build)" section so a fresh Claude session knows what to skim before touching code. `ARCHITECTURE.md`'s companion-docs list updated to match.
- **Phase 2D — Admin IAM module.** Landed. New `admin-users` module is the second registered module and the operator's tool for managing users, roles, and `user_roles` grants (the runtime RLS-scoping knob). Backend: `resources/iam/` covers `GET/POST /users`, `GET/POST /roles`, `GET/POST /user-roles` — admin-only at the app layer plus existing row-level policies from migration 0003. New permissions `User.{Read,Write}` and `Role.{Read,Write}` granted only to admin. Data-client extends `RESOURCE_PATHS` with the three IAM resources; `search()` no longer requires `patientId` (passes all params through, backend validates). 9-case integration suite at `test/iam.test.ts`. Workspace gates: `pnpm typecheck` ✓, `pnpm lint` ✓, `pnpm test` ✓ (37 passed, 52 skipped pending a DB).
- **Phase 2C — Patient bootstrap + demo cleanup.** Landed. The shell now ships with `patient-create` and `admin-users` registered. `patient-create` POSTs to `POST /patients`, which inserts the patient and adds the caller to the care team as primary in the same transaction (enabled by migration `0011_care_team_self_insert`). All legacy demo modules and their per-module docs were deleted; `docs/module-catalog.md` rewritten. From this point the workspace is genuinely empty of test/demo content — the next module added is a real clinical surface.
- **AuditPanel — frontend lifecycle + write events visible.** Landed. `ModuleHost` emits `module.opened` / `module.closed` per tab; `patient-create` logs `patient.create` after a successful POST. The panel still only sees frontend-emitted events — backend `audit_logs` rows are persisted but not surfaced; that's the "Next up" piece.

Backend resource surface as of today: **patients, encounters, problems, allergies, plus the IAM admin tables (users, roles, user_roles)**. See `CHANGELOG.md` for the full landing history per phase.

## Blockers

- None.

## Decisions awaiting input

- **Workspace selection at login.** Real backend login currently always lands in the "Clinic" workspace because the backend doesn't yet model workspace-type selection. Candidate: add a workspace picker (or auto-derive from user roles) and pass it through `/auth/login` so the JWT carries the active workspace.
- **Facility selection at login.** Login intentionally returns all the user's roles when no `facilityId` is supplied; future flow could let the user pick a single facility post-login to narrow the session. Not urgent — RLS handles multi-facility correctly with the strengthened predicate from Phase 2B.0.

## Next up

- **Rename `demo-*` CSS classes to neutral primitives.** `.demo-list`, `.demo-row`, `.demo-row-main`, `.demo-row-from`, `.demo-row-subject`, `.demo-row-meta`, `.demo-row-unread` are named for legacy demos that no longer exist. They're now the de facto list/row pattern used by `patient-create` and `admin-users`. Suggested rename: `.list-card` / `.list-row` / `.row-main` / `.row-title` / `.row-subtitle` / `.row-meta` / `.row-highlight`. Pure CSS + sed pass across two modules; no behavior change.
- **Backend `audit_logs` → AuditPanel.** The chrome panel only shows frontend-emitted events (`auth.signIn`, `module.opened`, `patient.create`, etc.). Backend writes (`record.read`, `record.create`, `record.list`, `record.update`) accumulate in Postgres but never reach the panel. Land `GET /audit?patientId=…&since=…` (admin/compliance via `audit.read` permission) and have the panel poll or stream from it; merge the two streams in `AuditPanel.tsx` so the user sees the full picture.
- **First patient-scoped module.** `patient-create`'s "Open patient group" button opens a group with zero tabs because no patient-scoped module is registered. Run `pnpm new-module patient-summary --scope=patient` and wire it to `data.read('Patient', id)` + the encounter / problem / allergy backend endpoints (which already exist and audit + RLS-gate correctly).
- **Patient list endpoint.** `patient-create`'s "Created this session" list is component-local — it only knows about patients created in the current tab. A `GET /patients?search=…` endpoint backing `data.search('Patient', { params: { q } })` is the right next backend surface. Currently the only way to find an existing patient's UUID is through Postgres directly.
- **Smoke-test the live stack.** Bring up Postgres + backend + shell with `VITE_EMR_API_BASE_URL=http://localhost:5210`; `pnpm db-create-admin`, log in, open **Create Patient** from the LeftNav, submit the form, verify the row is in Postgres (`SELECT * FROM patients`) and `audit_logs` has a `record.create` row.
- **`useCanClose` SDK hook + dirty-state guard.** `patient-create`'s and `admin-users`' forms have unsaved state but don't warn on tab close. First forcing function for the hook in `@emr/module-sdk`.
- **Open longer-term:** per-tab URL routing, RS256 JWT for production.
