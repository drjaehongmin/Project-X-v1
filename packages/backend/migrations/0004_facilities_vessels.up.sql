-- 0004 — Facilities and the vessels child table (SCHEMA.md §2).
-- A facility may be a vessel, clinic, hospital, office, or other; only
-- vessel facilities have a row in `vessels`.

CREATE TABLE facilities (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name            varchar(200) NOT NULL,
    facility_type   varchar(16) NOT NULL CHECK (facility_type IN ('vessel','clinic','hospital','office','other')),
    address         text,
    phone           varchar(20),
    npi             varchar(10) UNIQUE,
    timezone        varchar(64) NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz
);

CREATE INDEX facilities_type_idx ON facilities(facility_type);

ALTER TABLE facilities ENABLE ROW LEVEL SECURITY;

CREATE POLICY facilities_staff_select ON facilities
    FOR SELECT
    USING (app_is_facility_staff(id));

CREATE POLICY facilities_admin_write ON facilities
    FOR ALL
    USING (app_is_admin())
    WITH CHECK (app_is_admin());

-- Now that facilities exists, attach the deferred FK on user_roles.
ALTER TABLE user_roles
    ADD CONSTRAINT user_roles_facility_fk
    FOREIGN KEY (facility_id) REFERENCES facilities(id) ON DELETE CASCADE;

-- ---------- vessels -------------------------------------------------

CREATE TABLE vessels (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    facility_id            uuid UNIQUE NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
    brand                  varchar(150),
    vessel_class           varchar(100),
    year_built             smallint CHECK (year_built BETWEEN 1800 AND extract(year FROM current_date)::int + 5),
    imo_number             varchar(15) UNIQUE NOT NULL,
    flag_country           varchar(2),
    guest_capacity         integer CHECK (guest_capacity >= 0),
    crew_capacity          integer CHECK (crew_capacity >= 0),
    gross_tonnage          integer CHECK (gross_tonnage >= 0),
    current_latitude       numeric(9,6) CHECK (current_latitude BETWEEN -90 AND 90),
    current_longitude      numeric(9,6) CHECK (current_longitude BETWEEN -180 AND 180),
    position_recorded_at   timestamptz,
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now()
);

-- Application/trigger enforces `facilities.facility_type = 'vessel'` for
-- the linked row; a SQL CHECK cannot cross rows.
CREATE OR REPLACE FUNCTION vessels_enforce_facility_type()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM facilities
        WHERE id = NEW.facility_id AND facility_type = 'vessel'
    ) THEN
        RAISE EXCEPTION 'vessels.facility_id must reference a facility with facility_type = ''vessel''';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER vessels_facility_type_check
    BEFORE INSERT OR UPDATE OF facility_id ON vessels
    FOR EACH ROW EXECUTE FUNCTION vessels_enforce_facility_type();

ALTER TABLE vessels ENABLE ROW LEVEL SECURITY;

-- vessels inherits its linked facility's access.
CREATE POLICY vessels_inherit_facility_select ON vessels
    FOR SELECT
    USING (app_is_facility_staff(facility_id));

CREATE POLICY vessels_admin_write ON vessels
    FOR ALL
    USING (app_is_admin())
    WITH CHECK (app_is_admin());
