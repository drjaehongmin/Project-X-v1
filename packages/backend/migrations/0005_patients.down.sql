-- Restore the stub body before dropping the table that backs it.
CREATE OR REPLACE FUNCTION app_is_self_patient(_patient_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT FALSE;
$$;

DROP TABLE IF EXISTS patients;
