DROP TRIGGER IF EXISTS vessels_facility_type_check ON vessels;
DROP FUNCTION IF EXISTS vessels_enforce_facility_type();
DROP TABLE IF EXISTS vessels;
ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_facility_fk;
DROP TABLE IF EXISTS facilities;
