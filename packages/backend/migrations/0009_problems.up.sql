-- 0009 — Problems (SCHEMA.md §4).
-- The problem list — long-running clinical concerns attached to a
-- patient.  ICD-10-CM codes are stored as plain varchar here; the FK to
-- `icd10_cm_codes(code)` lands when the catalog table does.  Until then
-- the column carries an opaque string the routes neither validate nor
-- look up.

CREATE TABLE problems (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id      uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    icd10_code      varchar(10),
    description     varchar(500) NOT NULL,
    status          varchar(16) NOT NULL
        CHECK (status IN ('active','inactive','resolved')),
    onset_date      date,
    resolved_date   date,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz,
    -- A `resolved` problem must have a resolved_date and an onset_date
    -- that does not follow it; loose enforcement (NULL onset still
    -- allowed) so a legacy import doesn't reject.
    CHECK (
        resolved_date IS NULL
        OR onset_date IS NULL
        OR resolved_date >= onset_date
    ),
    CHECK (
        status <> 'resolved' OR resolved_date IS NOT NULL
    )
);

CREATE INDEX problems_patient_status_idx
    ON problems(patient_id, status) WHERE deleted_at IS NULL;
CREATE INDEX problems_icd10_idx
    ON problems(icd10_code) WHERE icd10_code IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE problems ENABLE ROW LEVEL SECURITY;

CREATE POLICY problems_access_select ON problems
    FOR SELECT
    USING (app_can_access_patient(patient_id));

CREATE POLICY problems_staff_insert ON problems
    FOR INSERT
    WITH CHECK (
        app_is_admin()
        OR app_has_role('provider')
        OR app_has_role('clinician')
        OR app_has_role('nurse')
    );

CREATE POLICY problems_access_update ON problems
    FOR UPDATE
    USING (app_can_access_patient(patient_id))
    WITH CHECK (app_can_access_patient(patient_id));

CREATE POLICY problems_admin_delete ON problems
    FOR DELETE
    USING (app_is_admin());
