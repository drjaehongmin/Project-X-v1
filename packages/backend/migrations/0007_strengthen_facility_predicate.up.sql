-- 0007 — Strengthen app_is_facility_staff to support cross-facility
-- workspaces (case management, clinical operations).
--
-- The 0002 stub returned true only for the *currently scoped*
-- facility in the JWT plus admin.  That works for single-facility
-- clinic users but rejects case managers and ops users who legitimately
-- cover multiple ships or who hold a global role
-- (user_roles.facility_id IS NULL).
--
-- The new body honors all four of:
--   1. Admin (global override).
--   2. The currently scoped facility (legacy single-facility sessions).
--   3. A user_roles row at the specific facility.
--   4. A global role (user_roles.facility_id IS NULL).
--
-- See docs/adr/0005-strengthen-facility-staff-predicate.md for the
-- rationale and alternatives considered.

CREATE OR REPLACE FUNCTION app_is_facility_staff(_facility_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT
        app_is_admin()
        OR _facility_id = app_current_facility_id()
        OR EXISTS (
            SELECT 1 FROM user_roles
            WHERE user_id = app_current_user_id()
              AND (facility_id = _facility_id OR facility_id IS NULL)
        );
$$;
