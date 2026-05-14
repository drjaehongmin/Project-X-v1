# @emr/module-admin-users — Rules

## Purpose

The IAM admin surface. Three workflows in one card: create a user (`POST /users`), create a role (`POST /roles`), and grant a role to a user with optional facility scope (`POST /user-roles`). The grant step is what *sets row-based security at runtime* — a `user_roles` row narrows what `app_current_roles()` and `app_current_facility_id()` return at login, which RLS policies on every clinical table consult.

The module does **not** modify RLS policies — those live in SQL migrations and stay in code (a UI that writes Postgres policies is a security antipattern).

## Manifest summary

- **id:** `admin-users`
- **displayName:** `Admin · Users & Access`
- **scope:** `general`
- **requires:** `['session']`
- **services:** `['data', 'audit']`
- **permissions:** `['user.write']`

## Hard rules

- Imports only from `@emr/contracts`, `@emr/module-sdk`, `@emr/shared`, and external libs. No sibling-module imports.
- Single public entry: `src/index.ts` exports the `ModuleDefinition`.
- Component takes no props. Context arrives via SDK hooks.

## Public API

- `default` / `adminUsersModule`: the registered `ModuleDefinition`.

## Notes

- The module assumes the caller has `user.write`, which today is granted only to the `admin` role (`packages/backend/src/permissions/compute.ts`). Non-admins see the module in their LeftNav if `PermissionService.canLaunchModule` allows it (the stub today permits everything); a real `PermissionService` would filter the module out.
- Password fields are POSTed in plaintext over HTTPS; the backend argon2id-hashes them. The data-client transports them along with other resource fields.
- The selected user's grants list refreshes when the user changes. Granting a duplicate (same `user_id` + `role_id` + `facility_id`) returns 409 from the backend — surfaced inline as an error string.
- The "Facility UUID" field is intentionally a free-text input. A facility picker is the right UX once a facilities-list endpoint exists; until then, paste the UUID from `SELECT id FROM facilities`.
- Revocation isn't supported in v1. To remove a grant, use `psql` directly. `DELETE /user-roles` with a composite-PK body is the natural follow-up.
