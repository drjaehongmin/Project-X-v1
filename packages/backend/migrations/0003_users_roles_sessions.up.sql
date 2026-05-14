-- 0003 — Identity and access (SCHEMA.md §1).
-- Users, roles, the user↔role link (scoped to facility or global), and
-- refresh-token sessions.  No seed data.

-- ---------- users ---------------------------------------------------

CREATE TABLE users (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email           citext UNIQUE NOT NULL,
    phone           varchar(20) UNIQUE,
    password_hash   varchar(255),
    first_name      varchar(200) NOT NULL,
    surname         varchar(200) NOT NULL,
    prefix          varchar(30) NOT NULL DEFAULT '',
    suffix          varchar(30) NOT NULL DEFAULT '',
    user_type       varchar(16) NOT NULL CHECK (user_type IN ('staff','provider','admin','patient')),
    mfa_enabled     boolean NOT NULL DEFAULT FALSE,
    mfa_secret      varchar(255),
    last_login_at   timestamptz,
    is_active       boolean NOT NULL DEFAULT TRUE,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz
);

CREATE INDEX users_user_type_idx ON users(user_type) WHERE is_active;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- A user can read/update their own row; admins can read all.
CREATE POLICY users_self_select ON users
    FOR SELECT
    USING (id = app_current_user_id() OR app_is_admin());

CREATE POLICY users_self_update ON users
    FOR UPDATE
    USING (id = app_current_user_id() OR app_is_admin())
    WITH CHECK (id = app_current_user_id() OR app_is_admin());

-- Only admins may insert/delete (registration flows happen via the
-- backend under the admin context).
CREATE POLICY users_admin_insert ON users
    FOR INSERT
    WITH CHECK (app_is_admin());

CREATE POLICY users_admin_delete ON users
    FOR DELETE
    USING (app_is_admin());

-- ---------- roles ---------------------------------------------------

CREATE TABLE roles (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name          varchar(64) UNIQUE NOT NULL,
    description   text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;

-- Reference-style: any authenticated user may read; admins write.
CREATE POLICY roles_select_all ON roles
    FOR SELECT
    USING (app_current_user_id() IS NOT NULL);

CREATE POLICY roles_admin_write ON roles
    FOR ALL
    USING (app_is_admin())
    WITH CHECK (app_is_admin());

-- ---------- user_roles ----------------------------------------------

-- facility_id NULL means the role applies globally for that user (e.g.
-- a system admin not tied to a single ship/clinic).  PK includes the
-- facility column so a user can hold the same role at multiple
-- facilities.
CREATE TABLE user_roles (
    user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id       uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    facility_id   uuid,  -- FK added in 0004 once facilities exists
    created_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, role_id, facility_id)
);

CREATE INDEX user_roles_user_idx ON user_roles(user_id);
CREATE INDEX user_roles_facility_idx ON user_roles(facility_id);

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- A user sees their own role rows; admins see all.
CREATE POLICY user_roles_self_or_admin_select ON user_roles
    FOR SELECT
    USING (user_id = app_current_user_id() OR app_is_admin());

CREATE POLICY user_roles_admin_write ON user_roles
    FOR ALL
    USING (app_is_admin())
    WITH CHECK (app_is_admin());

-- ---------- sessions (refresh-token records) ------------------------

CREATE TABLE sessions (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash    varchar(255) NOT NULL,
    ip_address    inet,
    user_agent    text,
    expires_at    timestamptz NOT NULL,
    revoked_at    timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE INDEX sessions_token_hash_idx ON sessions(token_hash);
CREATE INDEX sessions_active_idx ON sessions(user_id, expires_at) WHERE revoked_at IS NULL;

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY sessions_owner_or_admin_select ON sessions
    FOR SELECT
    USING (user_id = app_current_user_id() OR app_is_admin());

CREATE POLICY sessions_owner_or_admin_write ON sessions
    FOR ALL
    USING (user_id = app_current_user_id() OR app_is_admin())
    WITH CHECK (user_id = app_current_user_id() OR app_is_admin());
