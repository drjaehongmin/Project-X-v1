-- Restore the stub bodies before dropping the tables that back them.
CREATE OR REPLACE FUNCTION app_has_break_glass(_patient_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT FALSE;
$$;

CREATE OR REPLACE FUNCTION app_is_on_care_team(_patient_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT FALSE;
$$;

DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS break_glass_events;
DROP TABLE IF EXISTS care_team_assignments;
