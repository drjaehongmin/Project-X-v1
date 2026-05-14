# 0005 — Strengthen `app_is_facility_staff` to support cross-facility workspaces

- **Status:** Accepted
- **Date:** 2026-05-12
- **Deciders:** J
- **Related modules / docs:** [`packages/backend/migrations/0007_strengthen_facility_predicate.up.sql`](../../packages/backend/migrations/0007_strengthen_facility_predicate.up.sql), [`/SCHEMA.md`](../../SCHEMA.md) §1 (`user_roles`), `app_is_facility_staff` in [`packages/backend/migrations/0002_rls_predicates.up.sql`](../../packages/backend/migrations/0002_rls_predicates.up.sql)

## Context

`SCHEMA.md` §1 makes `user_roles.facility_id` nullable — a `NULL` value means the role applies globally. The PK is `(user_id, role_id, facility_id)` so a user can also hold the same role at many facilities. Both shapes are intentional: they let case managers cover multiple ships and let clinical-operations users see fleet-wide data.

The RLS predicate `app_is_facility_staff(_facility_id)` is the gate for facility-level rows (`facilities`, `vessels`, and later `departments`, `rooms`, `provider_schedules`, etc.). The Phase 2A stub in migration 0002 was:

```sql
SELECT _facility_id = app_current_facility_id() OR app_is_admin();
```

That body only honors the *currently scoped* facility from the JWT (`app.facility_id` set by `withRlsContext`) plus a global admin override. It does not read `user_roles`, so it fails closed for two legitimate cases:

1. A user holding `user_roles` rows at multiple facilities and operating on rows for a facility other than the one currently active in their session.
2. A user holding a global role (`user_roles.facility_id IS NULL`) — case managers and clinical-operations users typically have this shape.

Patient-level access already works across facilities because `app_can_access_patient` joins through `care_team_assignments`, which has no facility column. The gap is purely on facility-level tables.

## Decision

Redefine `app_is_facility_staff(_facility_id)` to honor four cases — admin, the currently scoped facility, an explicit per-facility role, or a global role:

```sql
SELECT
    app_is_admin()
    OR _facility_id = app_current_facility_id()
    OR EXISTS (
        SELECT 1 FROM user_roles
        WHERE user_id = app_current_user_id()
          AND (facility_id = _facility_id OR facility_id IS NULL)
    );
```

The change ships as migration `0007_strengthen_facility_predicate.up.sql` using `CREATE OR REPLACE FUNCTION`. Existing policies that reference `app_is_facility_staff` (on `facilities`, `vessels`) pick up the new body automatically — no policy rewrites needed.

## Alternatives considered

- **Bake the facility set into the JWT** — at login, compute the user's full set of permitted facilities and ship it as `fids[]` in the access token; the predicate reads from a Postgres setting populated from that array. Avoids the extra `user_roles` join per check. Rejected for Phase 2B.0 because the set can change between token issuance and refresh (an admin grants a new facility role mid-session), and stale `fids[]` would mask a revocation. Worth revisiting if profiling shows the join is hot.
- **Per-resource policy** — write the cross-facility predicate inline in each table's policy rather than centralizing it. Rejected because the predicate is reused on every facility-scoped table; centralizing keeps the rule in one place and the policies thin.
- **Separate predicate for global roles** — `app_has_global_role()` + keep `app_is_facility_staff` narrow. Rejected because callers would have to remember to `OR` the two; one composite predicate makes the policy author's job impossible to get subtly wrong.
- **Leave it narrow and force users to switch `fid` per request** — would make case management feel like a multi-tab dance. Rejected as a UX regression for a fix that's a single migration.

## Consequences

**Makes easier:**
- Case managers and clinical-operations users with multi-facility or global roles can read facility-level data across their full scope from one session.
- A session with `fid=null` (cross-facility scope) becomes meaningful — facility access derives from `user_roles`, not from a single active facility.
- New facility-scoped tables in Phase 2B (departments, rooms, schedules) inherit cross-facility access automatically.

**Makes harder:**
- The predicate now joins `user_roles` on every facility-level read. The table is small and the lookup is keyed (`user_roles(user_id)` index), so cost should be negligible — but it's worth watching once volume grows.
- Revocation latency: a removed `user_roles` row takes effect immediately for facility-level access (good), but the JWT's `roles[]` claim used by `requirePermission` still reflects the old set until the token expires. Per-row access is the load-bearing layer; coarse permissions catch up at the next refresh.

**Obligations introduced:**
- Future facility-scoped predicates (e.g. `app_can_access_department(...)`) should follow the same pattern: combine admin override, current-facility shortcut, and a `user_roles` existence check.
- The `db-create-admin` CLI (Phase 2A.5) and any other admin tooling must be able to write `user_roles` rows with `facility_id IS NULL` for global roles.

## Notes

- This is the first migration written in the `0007+` range that simply updates a predicate without adding tables. The pattern (`CREATE OR REPLACE FUNCTION` with no other DDL) is the canonical way to evolve the predicate library without dropping dependent policies.
- The matching down-migration restores the 0002 stub body verbatim.
- No frontend changes are required. The shell sees identical responses, just for more facilities.
