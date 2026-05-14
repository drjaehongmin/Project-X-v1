-- 0010 — Allergies (SCHEMA.md §4).
-- Per-patient allergy list.  `allergen` is free-text (no catalog FK)
-- so the table is self-contained; coding to RxNorm / SNOMED can be
-- added later as an optional `code` + `code_system` pair without a
-- breaking change.

CREATE TABLE allergies (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id      uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    allergen        varchar(200) NOT NULL,
    allergen_type   varchar(20) NOT NULL
        CHECK (allergen_type IN ('drug','food','environmental','other')),
    reaction        varchar(500),
    severity        varchar(20)
        CHECK (severity IN ('mild','moderate','severe','life_threatening')),
    status          varchar(16) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active','inactive','resolved')),
    -- Author + redactor for clinical attribution.  `created_by` is set
    -- by the route from `app_current_user_id()`; we don't trust the
    -- payload.
    created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
    updated_by      uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz
);

CREATE INDEX allergies_patient_status_idx
    ON allergies(patient_id, status) WHERE deleted_at IS NULL;
CREATE INDEX allergies_severity_idx
    ON allergies(patient_id, severity)
    WHERE severity IN ('severe','life_threatening') AND deleted_at IS NULL;

ALTER TABLE allergies ENABLE ROW LEVEL SECURITY;

CREATE POLICY allergies_access_select ON allergies
    FOR SELECT
    USING (app_can_access_patient(patient_id));

-- Insert: any clinical role (plus admin) may add to a patient's
-- allergy list.  The patient-scope check happens at the row level
-- via the WITH CHECK; without care-team access the new row would be
-- invisible to its author, so the policy refuses the insert.
CREATE POLICY allergies_staff_insert ON allergies
    FOR INSERT
    WITH CHECK (
        (
            app_is_admin()
            OR app_has_role('provider')
            OR app_has_role('clinician')
            OR app_has_role('nurse')
        )
        AND app_can_access_patient(patient_id)
    );

CREATE POLICY allergies_access_update ON allergies
    FOR UPDATE
    USING (app_can_access_patient(patient_id))
    WITH CHECK (app_can_access_patient(patient_id));

CREATE POLICY allergies_admin_delete ON allergies
    FOR DELETE
    USING (app_is_admin());
