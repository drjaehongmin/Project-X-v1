-- 0002 — RLS context and reusable policy predicates.
--
-- The backend opens every request inside a transaction and calls
-- `SET LOCAL app.user_id = '<uuid>'` (and friends) before issuing any
-- query. RLS policies read those settings via `current_setting(...)` so
-- each row is filtered against the caller's identity automatically.
--
-- Helpers below are STABLE so the planner can cache them, and
-- SECURITY DEFINER on the *-aware ones so they can read the
-- care_team_assignments and break_glass_events tables even from a
-- restricted role.  We accept that this puts the predicates in TCB and
-- gate that with revoking EXECUTE from PUBLIC at the bottom.

-- ---------- Context accessors ---------------------------------------

-- Returns the user id bound to the current request, or NULL when no
-- context has been set (which causes every policy to deny).
CREATE OR REPLACE FUNCTION app_current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
    SELECT NULLIF(current_setting('app.user_id', TRUE), '')::uuid;
$$;

-- Returns the facility id bound to the current request, NULL otherwise.
CREATE OR REPLACE FUNCTION app_current_facility_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
    SELECT NULLIF(current_setting('app.facility_id', TRUE), '')::uuid;
$$;

-- The roles for the current request, as a text[]. Pre-computed by the
-- backend from the JWT and `user_roles`, narrowed to the active
-- facility.  Returns '{}' when unset.
CREATE OR REPLACE FUNCTION app_current_roles()
RETURNS text[]
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(
        string_to_array(NULLIF(current_setting('app.roles', TRUE), ''), ','),
        ARRAY[]::text[]
    );
$$;

-- Whether the current request is under an active break-glass grant.
-- The backend sets `app.break_glass` to '1' after writing a
-- `break_glass_events` row; predicates below honor that flag.
CREATE OR REPLACE FUNCTION app_break_glass_active()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT current_setting('app.break_glass', TRUE) = '1';
$$;

-- ---------- Role predicates -----------------------------------------

CREATE OR REPLACE FUNCTION app_has_role(role_name text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT role_name = ANY(app_current_roles());
$$;

CREATE OR REPLACE FUNCTION app_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT app_has_role('admin');
$$;

-- ---------- Patient-access predicates -------------------------------

-- Stubs at this layer — concrete implementations live in 0006 once the
-- backing tables exist. Defined here as CREATE OR REPLACE so 0006 can
-- swap in real bodies without dropping dependent policies.

CREATE OR REPLACE FUNCTION app_is_on_care_team(_patient_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT FALSE;  -- 0006 redefines this against care_team_assignments
$$;

CREATE OR REPLACE FUNCTION app_is_self_patient(_patient_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT FALSE;  -- 0005 redefines this against patients.user_id
$$;

CREATE OR REPLACE FUNCTION app_has_break_glass(_patient_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT FALSE;  -- 0006 redefines this against break_glass_events
$$;

-- Composite predicate every patient-scoped policy joins through.
CREATE OR REPLACE FUNCTION app_can_access_patient(_patient_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT
        app_is_admin()
        OR app_is_self_patient(_patient_id)
        OR app_is_on_care_team(_patient_id)
        OR app_has_break_glass(_patient_id);
$$;

-- ---------- Facility-staff predicate --------------------------------

CREATE OR REPLACE FUNCTION app_is_facility_staff(_facility_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    -- The backend sets app.facility_id from the active session token; a
    -- request scoped to facility X may read facility-X rows. Global
    -- roles (user_roles.facility_id IS NULL) are honored elsewhere by
    -- the role check; this predicate is the facility-equality test.
    SELECT _facility_id = app_current_facility_id() OR app_is_admin();
$$;
