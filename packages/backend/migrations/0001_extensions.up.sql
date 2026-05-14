-- 0001 — Required Postgres extensions.
-- pgcrypto: gen_random_uuid(). citext: case-insensitive text for emails.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
