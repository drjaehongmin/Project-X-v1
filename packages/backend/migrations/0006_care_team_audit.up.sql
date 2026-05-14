-- 0006 — Care team, break-glass, and the append-only audit log
-- (SCHEMA.md §14).  Closes the loop on patient-access RLS by giving
-- `app_is_on_care_team` and `app_has_break_glass` real bodies.

-- ---------- care_team_assignments -----------------------------------

CREATE TABLE care_team_assignments (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id      uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            varchar(32) NOT NULL CHECK (role IN ('primary','consulting','nurse','admin','other')),
    effective_from  timestamptz NOT NULL DEFAULT now(),
    effective_to    timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX care_team_patient_idx ON care_team_assignments(patient_id);
CREATE INDEX care_team_user_idx ON care_team_assignments(user_id);
CREATE INDEX care_team_active_idx
    ON care_team_assignments(patient_id, user_id)
    WHERE effective_to IS NULL OR effective_to > now();

ALTER TABLE care_team_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY care_team_member_or_admin_select ON care_team_assignments
    FOR SELECT
    USING (user_id = app_current_user_id() OR app_is_admin());

CREATE POLICY care_team_admin_write ON care_team_assignments
    FOR ALL
    USING (app_is_admin())
    WITH CHECK (app_is_admin());

-- Real implementation of the predicate stubbed in 0002.
CREATE OR REPLACE FUNCTION app_is_on_care_team(_patient_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM care_team_assignments
        WHERE patient_id = _patient_id
          AND user_id = app_current_user_id()
          AND effective_from <= now()
          AND (effective_to IS NULL OR effective_to > now())
    );
$$;

-- ---------- break_glass_events --------------------------------------

CREATE TABLE break_glass_events (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    patient_id    uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    reason        text NOT NULL,
    started_at    timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz NOT NULL,
    reviewed_by   uuid REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at   timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX bg_active_idx
    ON break_glass_events(user_id, patient_id, expires_at)
    WHERE expires_at > now();

ALTER TABLE break_glass_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY bg_writer_select ON break_glass_events
    FOR SELECT
    USING (user_id = app_current_user_id() OR app_is_admin());

CREATE POLICY bg_writer_insert ON break_glass_events
    FOR INSERT
    WITH CHECK (user_id = app_current_user_id());

-- Updates/deletes restricted to admins/compliance.
CREATE POLICY bg_admin_update ON break_glass_events
    FOR UPDATE
    USING (app_is_admin())
    WITH CHECK (app_is_admin());

CREATE POLICY bg_admin_delete ON break_glass_events
    FOR DELETE
    USING (app_is_admin());

-- Real implementation of the predicate stubbed in 0002.  Honors the
-- `app.break_glass` flag the backend sets only after writing a
-- break_glass_events row, so the predicate can't grant access
-- unilaterally.
CREATE OR REPLACE FUNCTION app_has_break_glass(_patient_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT app_break_glass_active()
       AND EXISTS (
           SELECT 1 FROM break_glass_events
           WHERE user_id = app_current_user_id()
             AND patient_id = _patient_id
             AND started_at <= now()
             AND expires_at > now()
       );
$$;

-- ---------- audit_logs ----------------------------------------------

CREATE TABLE audit_logs (
    id              bigserial PRIMARY KEY,
    actor_user_id   uuid REFERENCES users(id) ON DELETE SET NULL,
    actor_ip        inet,
    action          varchar(64) NOT NULL,
    resource_type   varchar(64) NOT NULL,
    resource_id     uuid,
    patient_id      uuid REFERENCES patients(id) ON DELETE SET NULL,
    module_id       varchar(64),
    metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_patient_idx ON audit_logs(patient_id, created_at DESC) WHERE patient_id IS NOT NULL;
CREATE INDEX audit_actor_idx ON audit_logs(actor_user_id, created_at DESC) WHERE actor_user_id IS NOT NULL;
CREATE INDEX audit_action_idx ON audit_logs(action, created_at DESC);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Read: compliance/admin only.
CREATE POLICY audit_admin_select ON audit_logs
    FOR SELECT
    USING (app_is_admin() OR app_has_role('compliance'));

-- Append-only: any authenticated user can INSERT a row attributed to
-- themselves; backend writes are always tagged with the actor.  No
-- update/delete policies — the table is immutable from the app side.
CREATE POLICY audit_self_insert ON audit_logs
    FOR INSERT
    WITH CHECK (actor_user_id = app_current_user_id() OR actor_user_id IS NULL);
