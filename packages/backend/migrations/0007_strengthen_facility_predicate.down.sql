-- Revert app_is_facility_staff to the narrower 0002 body.

CREATE OR REPLACE FUNCTION app_is_facility_staff(_facility_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT _facility_id = app_current_facility_id() OR app_is_admin();
$$;
