-- 0005 — Patients (SCHEMA.md §3).
-- Includes international identity (nationality, country_of_residence)
-- and crew-specific fields (crew_id, employment_*, date_of_joining,
-- date_of_departure).  Child tables (addresses, contacts, etc.) land in
-- later migrations once their endpoints are needed.

CREATE TABLE patients (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mrn                     varchar(20) UNIQUE NOT NULL,
    user_id                 uuid REFERENCES users(id) ON DELETE SET NULL,
    first_name              varchar(100) NOT NULL,
    middle_name             varchar(100),
    last_name               varchar(100) NOT NULL,
    date_of_birth           date NOT NULL CHECK (date_of_birth <= current_date),
    sex_at_birth            varchar(16) CHECK (sex_at_birth IN ('male','female','intersex','unknown')),
    gender_identity         varchar(50),
    race                    varchar(100),
    ethnicity               varchar(100),
    preferred_language      varchar(10) NOT NULL DEFAULT 'en',
    marital_status          varchar(20),
    ssn_encrypted           bytea,
    deceased_at             timestamptz,
    merged_into_id          uuid REFERENCES patients(id) ON DELETE SET NULL,
    nationality             varchar(2),
    country_of_residence    varchar(2),
    crew_id                 varchar(50),
    employment_position     varchar(150),
    employment_department   varchar(100),
    date_of_joining         date,
    date_of_departure       date,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    deleted_at              timestamptz,
    CHECK (date_of_departure IS NULL OR date_of_joining IS NULL OR date_of_departure >= date_of_joining)
);

CREATE INDEX patients_mrn_idx ON patients(mrn);
CREATE INDEX patients_name_dob_idx ON patients(last_name, first_name, date_of_birth);
CREATE INDEX patients_user_idx ON patients(user_id) WHERE user_id IS NOT NULL;

-- Now that `patients` exists, swap in the real `is_self_patient` body.
CREATE OR REPLACE FUNCTION app_is_self_patient(_patient_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM patients
        WHERE id = _patient_id
          AND user_id = app_current_user_id()
          AND deleted_at IS NULL
    );
$$;

ALTER TABLE patients ENABLE ROW LEVEL SECURITY;

-- Patient access composite: admin, self, care team, or break-glass.
-- `app_can_access_patient` is defined in 0002; care-team and
-- break-glass bodies are filled in by 0006.
CREATE POLICY patients_access_select ON patients
    FOR SELECT
    USING (app_can_access_patient(id));

-- Inserts: providers or admins.  Patients cannot self-register through
-- the API (registration is a separate admin flow).
CREATE POLICY patients_staff_insert ON patients
    FOR INSERT
    WITH CHECK (
        app_is_admin()
        OR app_has_role('provider')
        OR app_has_role('clinician')
        OR app_has_role('registrar')
    );

-- Updates: anyone with read access, plus a per-column allow-list
-- enforced at the application layer.  At the row level we mirror the
-- read predicate so RLS doesn't deny edits the application has already
-- authorized.  Per-column filtering (e.g. patient may only update
-- demographics on their own record) is enforced in route handlers.
CREATE POLICY patients_access_update ON patients
    FOR UPDATE
    USING (app_can_access_patient(id))
    WITH CHECK (app_can_access_patient(id));

CREATE POLICY patients_admin_delete ON patients
    FOR DELETE
    USING (app_is_admin());
