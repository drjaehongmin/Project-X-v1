-- 0011 — Allow a user to add themselves to a patient's care team.
--
-- The 0006 policy (`care_team_admin_write FOR ALL`) restricted every
-- write to admins.  That blocks the canonical workflow where a
-- clinician registers a new patient and is automatically added as
-- primary care provider in the same transaction.
--
-- This migration adds a permissive INSERT policy alongside the admin
-- one.  PostgreSQL ORs same-command policies, so the effective rule
-- becomes: a user may INSERT a care_team_assignments row when the row
-- attributes the membership to themselves, OR when they are an admin
-- (the original case).
--
-- UPDATE / DELETE remain admin-only via the existing FOR ALL policy
-- (which still applies to those commands).  Audit captures who added
-- whom; the patient-create route writes a `record.create` row for
-- both the patient and the care-team membership.

CREATE POLICY care_team_self_insert ON care_team_assignments
    FOR INSERT
    WITH CHECK (
        user_id = app_current_user_id()
        OR app_is_admin()
    );
