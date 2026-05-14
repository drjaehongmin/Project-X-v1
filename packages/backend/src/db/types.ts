// Kysely table interfaces. Hand-maintained while the schema is small;
// once we run `kysely-codegen`, generated types replace this file.

import type { ColumnType, Generated } from 'kysely';

export interface UsersTable {
  id: Generated<string>;
  email: string;
  phone: string | null;
  password_hash: string | null;
  first_name: string;
  surname: string;
  // Schema defaults to '' so these are not required on insert.
  prefix: ColumnType<string, string | undefined, string>;
  suffix: ColumnType<string, string | undefined, string>;
  user_type: 'staff' | 'provider' | 'admin' | 'patient';
  mfa_enabled: ColumnType<boolean, boolean | undefined, boolean>;
  mfa_secret: string | null;
  last_login_at: ColumnType<Date | null, string | Date | null, string | Date | null>;
  is_active: ColumnType<boolean, boolean | undefined, boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deleted_at: ColumnType<Date | null, string | Date | null, string | Date | null>;
}

export interface RolesTable {
  id: Generated<string>;
  name: string;
  description: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface UserRolesTable {
  user_id: string;
  role_id: string;
  facility_id: string | null;
  created_at: Generated<Date>;
}

export interface SessionsTable {
  id: Generated<string>;
  user_id: string;
  token_hash: string;
  ip_address: string | null;
  user_agent: string | null;
  expires_at: ColumnType<Date, string | Date, string | Date>;
  revoked_at: ColumnType<Date | null, string | Date | null, string | Date | null>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface FacilitiesTable {
  id: Generated<string>;
  name: string;
  facility_type: 'vessel' | 'clinic' | 'hospital' | 'office' | 'other';
  address: string | null;
  phone: string | null;
  npi: string | null;
  timezone: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deleted_at: ColumnType<Date | null, string | Date | null, string | Date | null>;
}

export interface VesselsTable {
  id: Generated<string>;
  facility_id: string;
  brand: string | null;
  vessel_class: string | null;
  year_built: number | null;
  imo_number: string;
  flag_country: string | null;
  guest_capacity: number | null;
  crew_capacity: number | null;
  gross_tonnage: number | null;
  current_latitude: number | null;
  current_longitude: number | null;
  position_recorded_at: ColumnType<Date | null, string | Date | null, string | Date | null>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PatientsTable {
  id: Generated<string>;
  mrn: string;
  user_id: string | null;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  date_of_birth: ColumnType<Date, string | Date, string | Date>;
  sex_at_birth: 'male' | 'female' | 'intersex' | 'unknown' | null;
  gender_identity: string | null;
  race: string | null;
  ethnicity: string | null;
  preferred_language: ColumnType<string, string | undefined, string>;
  marital_status: string | null;
  ssn_encrypted: Buffer | null;
  deceased_at: ColumnType<Date | null, string | Date | null, string | Date | null>;
  merged_into_id: string | null;
  nationality: string | null;
  country_of_residence: string | null;
  crew_id: string | null;
  employment_position: string | null;
  employment_department: string | null;
  date_of_joining: ColumnType<Date | null, string | Date | null, string | Date | null>;
  date_of_departure: ColumnType<Date | null, string | Date | null, string | Date | null>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deleted_at: ColumnType<Date | null, string | Date | null, string | Date | null>;
}

export interface CareTeamAssignmentsTable {
  id: Generated<string>;
  patient_id: string;
  user_id: string;
  role: 'primary' | 'consulting' | 'nurse' | 'admin' | 'other';
  effective_from: ColumnType<Date, string | Date | undefined, string | Date>;
  effective_to: ColumnType<Date | null, string | Date | null, string | Date | null>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface BreakGlassEventsTable {
  id: Generated<string>;
  user_id: string;
  patient_id: string;
  reason: string;
  started_at: ColumnType<Date, string | Date | undefined, string | Date>;
  expires_at: ColumnType<Date, string | Date, string | Date>;
  reviewed_by: string | null;
  reviewed_at: ColumnType<Date | null, string | Date | null, string | Date | null>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface EncounterTypesTable {
  id: Generated<string>;
  code: string;
  name: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ProvidersTable {
  id: Generated<string>;
  user_id: string | null;
  npi: string;
  dea_number: string | null;
  specialty: string | null;
  default_facility_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deleted_at: ColumnType<Date | null, string | Date | null, string | Date | null>;
}

export interface AllergiesTable {
  id: Generated<string>;
  patient_id: string;
  allergen: string;
  allergen_type: 'drug' | 'food' | 'environmental' | 'other';
  reaction: string | null;
  severity: 'mild' | 'moderate' | 'severe' | 'life_threatening' | null;
  status: ColumnType<
    'active' | 'inactive' | 'resolved',
    'active' | 'inactive' | 'resolved' | undefined,
    'active' | 'inactive' | 'resolved'
  >;
  created_by: string | null;
  updated_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deleted_at: ColumnType<Date | null, string | Date | null, string | Date | null>;
}

export interface ProblemsTable {
  id: Generated<string>;
  patient_id: string;
  icd10_code: string | null;
  description: string;
  status: 'active' | 'inactive' | 'resolved';
  onset_date: ColumnType<Date | null, string | Date | null, string | Date | null>;
  resolved_date: ColumnType<Date | null, string | Date | null, string | Date | null>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deleted_at: ColumnType<Date | null, string | Date | null, string | Date | null>;
}

export interface EncountersTable {
  id: Generated<string>;
  patient_id: string;
  provider_id: string;
  facility_id: string;
  encounter_type_id: string | null;
  status: 'scheduled' | 'arrived' | 'in_progress' | 'completed' | 'cancelled' | 'no_show';
  start_time: ColumnType<Date, string | Date, string | Date>;
  end_time: ColumnType<Date | null, string | Date | null, string | Date | null>;
  chief_complaint: string | null;
  is_telehealth: ColumnType<boolean, boolean | undefined, boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deleted_at: ColumnType<Date | null, string | Date | null, string | Date | null>;
}

export interface AuditLogsTable {
  id: Generated<number>;
  actor_user_id: string | null;
  actor_ip: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  patient_id: string | null;
  module_id: string | null;
  metadata: ColumnType<Record<string, unknown>, Record<string, unknown> | undefined, Record<string, unknown>>;
  created_at: Generated<Date>;
}

export interface Database {
  users: UsersTable;
  roles: RolesTable;
  user_roles: UserRolesTable;
  sessions: SessionsTable;
  facilities: FacilitiesTable;
  vessels: VesselsTable;
  patients: PatientsTable;
  care_team_assignments: CareTeamAssignmentsTable;
  break_glass_events: BreakGlassEventsTable;
  encounter_types: EncounterTypesTable;
  providers: ProvidersTable;
  encounters: EncountersTable;
  problems: ProblemsTable;
  allergies: AllergiesTable;
  audit_logs: AuditLogsTable;
}
