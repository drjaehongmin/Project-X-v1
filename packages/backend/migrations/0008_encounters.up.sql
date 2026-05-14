-- 0008 — Encounters (SCHEMA.md §4), with the two FK dependencies it
-- needs to function: encounter_types (reference data) and providers
-- (facility-scoped staff list).  Both land here rather than in
-- separate migrations because encounters is the first consumer; later
-- migrations may extend either table without revisiting this one.

-- ---------- encounter_types ------------------------------------------
-- Reference data: every authenticated staff member reads, only admins
-- write.  No PHI; no soft delete (codes are stable or replaced
-- in-place).

CREATE TABLE encounter_types (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code        varchar(32) UNIQUE NOT NULL,
    name        varchar(100) NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE encounter_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY encounter_types_authed_select ON encounter_types
    FOR SELECT
    USING (app_current_user_id() IS NOT NULL);

CREATE POLICY encounter_types_admin_write ON encounter_types
    FOR ALL
    USING (app_is_admin())
    WITH CHECK (app_is_admin());

-- ---------- providers ------------------------------------------------
-- A provider is the clinical identity that signs notes, owns orders,
-- and is referenced by encounters.  The row is paired 1:1 with a user
-- (UNIQUE on user_id) when the provider also logs in; legacy /
-- consulting providers may exist without a user row.
--
-- Read: any authenticated staff member at the provider's facility (or
-- with a global role).  Write: admin only.  Credentials and per-role
-- modeling live in a follow-up migration if and when needed.

CREATE TABLE providers (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               uuid UNIQUE REFERENCES users(id) ON DELETE SET NULL,
    npi                   varchar(10) UNIQUE NOT NULL,
    dea_number            varchar(20),
    specialty             varchar(100),
    default_facility_id   uuid REFERENCES facilities(id) ON DELETE SET NULL,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    deleted_at            timestamptz
);

CREATE INDEX providers_user_idx
    ON providers(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX providers_facility_idx
    ON providers(default_facility_id) WHERE default_facility_id IS NOT NULL;

ALTER TABLE providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY providers_staff_select ON providers
    FOR SELECT
    USING (
        app_current_user_id() IS NOT NULL
        AND (
            app_is_admin()
            OR default_facility_id IS NULL
            OR app_is_facility_staff(default_facility_id)
        )
    );

CREATE POLICY providers_admin_write ON providers
    FOR ALL
    USING (app_is_admin())
    WITH CHECK (app_is_admin());

-- ---------- encounters -----------------------------------------------
-- Patient-scoped: care team or admin (via app_can_access_patient).
-- Facility / provider links are denormalized onto the row so reports
-- and indexes don't need to join through patients to filter.

CREATE TABLE encounters (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id          uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    provider_id         uuid NOT NULL REFERENCES providers(id),
    facility_id         uuid NOT NULL REFERENCES facilities(id),
    encounter_type_id   uuid REFERENCES encounter_types(id),
    status              varchar(20) NOT NULL
        CHECK (status IN ('scheduled','arrived','in_progress','completed','cancelled','no_show')),
    start_time          timestamptz NOT NULL,
    end_time            timestamptz,
    chief_complaint     text,
    is_telehealth       boolean NOT NULL DEFAULT false,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    deleted_at          timestamptz,
    CHECK (end_time IS NULL OR end_time >= start_time)
);

CREATE INDEX encounters_patient_start_idx
    ON encounters(patient_id, start_time DESC) WHERE deleted_at IS NULL;
CREATE INDEX encounters_provider_idx
    ON encounters(provider_id) WHERE deleted_at IS NULL;
CREATE INDEX encounters_facility_start_idx
    ON encounters(facility_id, start_time DESC) WHERE deleted_at IS NULL;

ALTER TABLE encounters ENABLE ROW LEVEL SECURITY;

CREATE POLICY encounters_access_select ON encounters
    FOR SELECT
    USING (app_can_access_patient(patient_id));

CREATE POLICY encounters_staff_insert ON encounters
    FOR INSERT
    WITH CHECK (
        app_is_admin()
        OR app_has_role('provider')
        OR app_has_role('clinician')
        OR app_has_role('nurse')
        OR app_has_role('registrar')
    );

CREATE POLICY encounters_access_update ON encounters
    FOR UPDATE
    USING (app_can_access_patient(patient_id))
    WITH CHECK (app_can_access_patient(patient_id));

CREATE POLICY encounters_admin_delete ON encounters
    FOR DELETE
    USING (app_is_admin());
