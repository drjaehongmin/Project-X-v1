# Database Schema

_Created 2026-05-10_

Schema for the EMR system described in `FEATURES/features-phase-1.md`. Targets a PostgreSQL-style database with row-level security (RLS).

## Conventions

- All tables use `id` (`uuid`, primary key, default `gen_random_uuid()`).
- All tables include `created_at` (`timestamptz`, NOT NULL, default `now()`) and `updated_at` (`timestamptz`, NOT NULL, default `now()`).
- Soft deletes use `deleted_at` (`timestamptz`, nullable).
- Foreign keys use `<table>_id` (e.g., `patient_id`).
- Currency stored as `numeric(12,2)`.
- Enums declared as Postgres `enum` types or `text` with `CHECK` constraints.
- All PHI tables have RLS enabled.

---

## 1. Identity and Access

### users
Staff, providers, admins, and patients all map to a `users` row.

Columns:
- `id` uuid, PK
- `email` varchar(320), UNIQUE, NOT NULL
- `phone` varchar(20), UNIQUE, nullable
- `password_hash` varchar(255), nullable (null for SSO)
- `first_name` varchar(200), NOT NULL
- `surname` varchar(200), NOT NULL
- `prefix` varchar(30), NOT NULL
- `suffix` varchar(30), NOT NULL
- `user_type` enum(`staff`, `provider`, `admin`, `patient`), NOT NULL
- `mfa_enabled` boolean, NOT NULL, default false
- `mfa_secret` varchar(255), nullable
- `last_login_at` timestamptz, nullable
- `is_active` boolean, NOT NULL, default true

### roles
- `id` uuid, PK
- `name` varchar(64), UNIQUE, NOT NULL
- `description` text

### user_roles
- `user_id` uuid, FK → users(id), ON DELETE CASCADE
- `role_id` uuid, FK → roles(id), ON DELETE CASCADE
- `location_id` uuid, FK → facilities(id), nullable (role scoped to location, which can be vessel)
- PK (`user_id`, `role_id`, `facility_id`)

### sessions
- `id` uuid, PK
- `user_id` uuid, FK → users(id)
- `token_hash` varchar(255), NOT NULL
- `ip_address` inet
- `user_agent` text
- `expires_at` timestamptz, NOT NULL
- `revoked_at` timestamptz, nullable

**RLS:**
- `users`: a user can SELECT/UPDATE their own row; admins SELECT all.
- `user_roles`: SELECT limited to the same facility's admins; users see their own roles.
- `sessions`: only the owning user; admins read-only for audit.

---

## 2. Facilities and Providers

### facilities
- `id` uuid, PK
- `name` varchar(200), NOT NULL
- `address` text
- `phone` varchar(20)
- `npi` varchar(10), UNIQUE, nullable
- `timezone` varchar(64), NOT NULL

### departments
- `id` uuid, PK
- `facility_id` uuid, FK → facilities(id)
- `name` varchar(100), NOT NULL
- UNIQUE (`facility_id`, `name`)

### rooms
- `id` uuid, PK
- `facility_id` uuid, FK → facilities(id)
- `department_id` uuid, FK → departments(id), nullable
- `name` varchar(64), NOT NULL
- `room_type` enum(`exam`, `procedure`, `imaging`, `tele`, `other`)

### providers
- `id` uuid, PK
- `user_id` uuid, FK → users(id), UNIQUE
- `npi` varchar(10), UNIQUE, NOT NULL
- `dea_number` varchar(20), nullable (encrypted)
- `specialty` varchar(100)
- `default_facility_id` uuid, FK → facilities(id)

### provider_credentials
- `id` uuid, PK
- `provider_id` uuid, FK → providers(id)
- `credential_type` enum(`license`, `board_cert`, `dea`, `other`)
- `number` varchar(100), NOT NULL
- `issuing_authority` varchar(200)
- `issued_date` date
- `expiry_date` date
- `status` enum(`active`, `expired`, `suspended`, `revoked`)

**RLS:**
- All facility/provider tables: SELECT for users with role at the facility; modify by facility admins only.

---

## 3. Patients

### patients
- `id` uuid, PK
- `mrn` varchar(20), UNIQUE, NOT NULL
- `user_id` uuid, FK → users(id), nullable (linked when patient has portal account)
- `first_name` varchar(100), NOT NULL
- `middle_name` varchar(100)
- `last_name` varchar(100), NOT NULL
- `date_of_birth` date, NOT NULL
- `sex_at_birth` enum(`male`, `female`, `intersex`, `unknown`)
- `gender_identity` varchar(50)
- `race` varchar(100)
- `ethnicity` varchar(100)
- `preferred_language` varchar(10), default `en`
- `marital_status` varchar(20)
- `ssn_encrypted` bytea, nullable
- `deceased_at` timestamptz, nullable
- `merged_into_id` uuid, FK → patients(id), nullable (for merged duplicates)
- CHECK (`date_of_birth` <= current_date)

### patient_addresses
- `id` uuid, PK
- `patient_id` uuid, FK → patients(id)
- `address_type` enum(`home`, `mailing`, `work`, `other`)
- `line1` varchar(200), NOT NULL
- `line2` varchar(200)
- `city` varchar(100), NOT NULL
- `state` varchar(50), NOT NULL
- `postal_code` varchar(20), NOT NULL
- `country` varchar(2), default `US`
- `is_primary` boolean, default false

### patient_contacts
- `id` uuid, PK
- `patient_id` uuid, FK → patients(id)
- `contact_type` enum(`phone`, `email`, `other`)
- `value` varchar(255), NOT NULL
- `is_primary` boolean, default false

### emergency_contacts
- `id` uuid, PK
- `patient_id` uuid, FK → patients(id)
- `name` varchar(200), NOT NULL
- `relationship` varchar(50)
- `phone` varchar(20), NOT NULL
- `email` varchar(320)

### patient_consents
- `id` uuid, PK
- `patient_id` uuid, FK → patients(id)
- `consent_type` enum(`hipaa`, `treatment`, `telehealth`, `recording`, `marketing`)
- `granted` boolean, NOT NULL
- `signed_at` timestamptz, NOT NULL
- `signed_by` varchar(200)
- `document_url` text

### insurance_plans
- `id` uuid, PK
- `payer_name` varchar(200), NOT NULL
- `plan_name` varchar(200)
- `payer_id` varchar(50)

### patient_insurances
- `id` uuid, PK
- `patient_id` uuid, FK → patients(id)
- `insurance_plan_id` uuid, FK → insurance_plans(id)
- `member_id` varchar(100), NOT NULL
- `group_number` varchar(100)
- `priority` enum(`primary`, `secondary`, `tertiary`)
- `subscriber_name` varchar(200)
- `relationship_to_subscriber` varchar(50)
- `effective_from` date
- `effective_to` date

**RLS:**
- `patients` and child tables: SELECT for users on the patient's care team OR admins at the facility; the patient themselves (via `user_id`) sees their own record.
- INSERT/UPDATE: providers and admins; patients can update demographics on their own record.

---

## 4. Encounters and Clinical Documentation

### encounter_types
- `id` uuid, PK
- `code` varchar(32), UNIQUE
- `name` varchar(100)

### encounters
- `id` uuid, PK
- `patient_id` uuid, FK → patients(id)
- `provider_id` uuid, FK → providers(id)
- `facility_id` uuid, FK → facilities(id)
- `encounter_type_id` uuid, FK → encounter_types(id)
- `status` enum(`scheduled`, `arrived`, `in_progress`, `completed`, `cancelled`, `no_show`)
- `start_time` timestamptz, NOT NULL
- `end_time` timestamptz
- `chief_complaint` text
- `is_telehealth` boolean, default false

### note_templates
- `id` uuid, PK
- `name` varchar(100), NOT NULL
- `specialty` varchar(100)
- `body_template` text, NOT NULL
- `created_by` uuid, FK → users(id)

### clinical_notes
- `id` uuid, PK
- `encounter_id` uuid, FK → encounters(id)
- `provider_id` uuid, FK → providers(id)
- `note_type` enum(`soap`, `progress`, `procedure`, `discharge`, `other`)
- `subjective` text
- `objective` text
- `assessment` text
- `plan` text
- `body` text (free-form when not SOAP)
- `signed_at` timestamptz, nullable
- `signed_by` uuid, FK → providers(id), nullable
- `addended_from_id` uuid, FK → clinical_notes(id), nullable

### problems
- `id` uuid, PK
- `patient_id` uuid, FK → patients(id)
- `icd10_code` varchar(10), FK → icd10_cm_codes(code), nullable
- `description` varchar(500), NOT NULL
- `status` enum(`active`, `inactive`, `resolved`)
- `onset_date` date
- `resolved_date` date

### allergies
- `id` uuid, PK
- `patient_id` uuid, FK → patients(id)
- `allergen` varchar(200), NOT NULL
- `allergen_type` enum(`drug`, `food`, `environmental`, `other`)
- `reaction` varchar(500)
- `severity` enum(`mild`, `moderate`, `severe`, `life_threatening`)
- `status` enum(`active`, `inactive`, `resolved`)

### medications
- `id` uuid, PK
- `patient_id` uuid, FK → patients(id)
- `drug_id` uuid, FK → drug_catalog(id)
- `dose` varchar(100)
- `route` varchar(50)
- `frequency` varchar(100)
- `start_date` date
- `end_date` date
- `is_active` boolean, default true
- `source` enum(`prescribed`, `reported`, `reconciled`)

### immunizations
- `id` uuid, PK
- `patient_id` uuid, FK → patients(id)
- `vaccine_code` varchar(20), NOT NULL (CVX)
- `vaccine_name` varchar(200)
- `administered_at` timestamptz
- `administered_by` uuid, FK → providers(id)
- `lot_number` varchar(50)
- `dose_number` smallint

### vitals
- `id` uuid, PK
- `encounter_id` uuid, FK → encounters(id)
- `recorded_at` timestamptz, NOT NULL
- `height_cm` numeric(5,2)
- `weight_kg` numeric(5,2)
- `bmi` numeric(5,2) (generated)
- `systolic_bp` smallint, CHECK between 0 and 300
- `diastolic_bp` smallint, CHECK between 0 and 200
- `heart_rate` smallint, CHECK between 0 and 300
- `respiratory_rate` smallint, CHECK between 0 and 100
- `temperature_c` numeric(4,2)
- `spo2` smallint, CHECK between 0 and 100
- `pain_score` smallint, CHECK between 0 and 10

### patient_history
- `id` uuid, PK
- `patient_id` uuid, FK → patients(id)
- `category` enum(`medical`, `surgical`, `family`, `social`)
- `description` text, NOT NULL
- `recorded_at` timestamptz, default now()

**RLS:**
- All clinical tables follow patient access rules — care team + facility admins.
- `clinical_notes`: only the authoring provider may UPDATE before signing; after signing, only addendums.

---

## 5. Orders and Results

### orders
- `id` uuid, PK
- `encounter_id` uuid, FK → encounters(id)
- `patient_id` uuid, FK → patients(id)
- `ordered_by` uuid, FK → providers(id)
- `order_type` enum(`lab`, `imaging`, `referral`, `procedure`, `other`)
- `status` enum(`draft`, `signed`, `sent`, `in_progress`, `completed`, `cancelled`)
- `priority` enum(`routine`, `urgent`, `stat`)
- `placed_at` timestamptz
- `signed_at` timestamptz

### lab_orders
- `id` uuid, PK
- `order_id` uuid, FK → orders(id), UNIQUE
- `loinc_code` varchar(20)
- `test_name` varchar(200), NOT NULL
- `specimen_type` varchar(100)

### lab_results
- `id` uuid, PK
- `lab_order_id` uuid, FK → lab_orders(id)
- `loinc_code` varchar(20)
- `name` varchar(200)
- `value` varchar(255)
- `value_numeric` numeric(15,4)
- `unit` varchar(50)
- `reference_range` varchar(100)
- `flag` enum(`normal`, `high`, `low`, `critical_high`, `critical_low`, `abnormal`)
- `result_at` timestamptz
- `reviewed_by` uuid, FK → providers(id), nullable
- `reviewed_at` timestamptz

### imaging_orders
- `id` uuid, PK
- `order_id` uuid, FK → orders(id), UNIQUE
- `modality` enum(`xray`, `ultrasound`, `ct`, `mri`, `other`)
- `body_part` varchar(100)
- `clinical_indication` text

### referrals
- `id` uuid, PK
- `order_id` uuid, FK → orders(id), UNIQUE
- `referred_to_provider_id` uuid, FK → providers(id), nullable
- `external_provider_name` varchar(200)
- `reason` text
- `status` enum(`pending`, `accepted`, `completed`, `declined`)

**RLS:** patient-scoped; ordering provider sees own; care team sees patient's orders.

---

## 6. Prescriptions

### drug_catalog
- `id` uuid, PK
- `rxnorm_code` varchar(20), UNIQUE
- `name` varchar(255), NOT NULL
- `generic_name` varchar(255)
- `strength` varchar(100)
- `form` varchar(50)
- `is_controlled` boolean
- `controlled_schedule` smallint, CHECK between 1 and 5

### drug_interactions
- `id` uuid, PK
- `drug_a_id` uuid, FK → drug_catalog(id)
- `drug_b_id` uuid, FK → drug_catalog(id)
- `severity` enum(`minor`, `moderate`, `major`, `contraindicated`)
- `description` text
- UNIQUE (`drug_a_id`, `drug_b_id`)

### formulary_entries
- `id` uuid, PK
- `insurance_plan_id` uuid, FK → insurance_plans(id)
- `drug_id` uuid, FK → drug_catalog(id)
- `tier` smallint
- `prior_auth_required` boolean

### prescriptions
- `id` uuid, PK
- `patient_id` uuid, FK → patients(id)
- `provider_id` uuid, FK → providers(id)
- `drug_id` uuid, FK → drug_catalog(id)
- `dose` varchar(100), NOT NULL
- `route` varchar(50), NOT NULL
- `frequency` varchar(100), NOT NULL
- `quantity` numeric(10,2), NOT NULL
- `unit` varchar(50)
- `refills_authorized` smallint, default 0
- `refills_remaining` smallint, default 0
- `dispense_as_written` boolean, default false
- `pharmacy_id` uuid, FK → pharmacies(id), nullable
- `status` enum(`draft`, `transmitted`, `filled`, `cancelled`, `expired`)
- `signed_at` timestamptz
- `epcs_signature` text (for controlled substances)

### pharmacies
- `id` uuid, PK
- `ncpdp_id` varchar(20), UNIQUE
- `name` varchar(200)
- `address` text
- `phone` varchar(20)

### prescription_refills
- `id` uuid, PK
- `prescription_id` uuid, FK → prescriptions(id)
- `requested_at` timestamptz, default now()
- `requested_by` uuid, FK → users(id)
- `status` enum(`pending`, `approved`, `denied`)
- `approved_by` uuid, FK → providers(id)
- `approved_at` timestamptz

**RLS:** patient-scoped. Controlled-substance fields require provider with active DEA credential (enforced in policy).

---

## 7. Diagnosis and Coding

### icd10_cm_codes (reference data)
- `code` varchar(10), PK
- `description` text, NOT NULL
- `is_billable` boolean
- `chapter` varchar(100)
- `category` varchar(100)

### icd10_pcs_codes
- `code` varchar(10), PK
- `description` text

### cpt_codes
- `code` varchar(10), PK
- `description` text
- `category` varchar(100)

### encounter_diagnoses
- `id` uuid, PK
- `encounter_id` uuid, FK → encounters(id)
- `icd10_code` varchar(10), FK → icd10_cm_codes(code)
- `is_primary` boolean, default false
- `rank` smallint
- UNIQUE (`encounter_id`, `icd10_code`)

**RLS:** reference tables (`icd10_*`, `cpt_*`) are public read. `encounter_diagnoses` is patient-scoped.

---

## 8. Scheduling

### appointment_types
- `id` uuid, PK
- `name` varchar(100)
- `duration_minutes` smallint, NOT NULL
- `color` varchar(7) (hex)

### provider_schedules
- `id` uuid, PK
- `provider_id` uuid, FK → providers(id)
- `facility_id` uuid, FK → facilities(id)
- `day_of_week` smallint, CHECK between 0 and 6
- `start_time` time
- `end_time` time
- `effective_from` date
- `effective_to` date

### appointments
- `id` uuid, PK
- `patient_id` uuid, FK → patients(id)
- `provider_id` uuid, FK → providers(id)
- `facility_id` uuid, FK → facilities(id)
- `room_id` uuid, FK → rooms(id), nullable
- `appointment_type_id` uuid, FK → appointment_types(id)
- `start_time` timestamptz, NOT NULL
- `end_time` timestamptz, NOT NULL
- `status` enum(`scheduled`, `confirmed`, `arrived`, `in_room`, `completed`, `cancelled`, `no_show`)
- `is_telehealth` boolean, default false
- `recurrence_rule` text (RFC 5545 RRULE)
- `parent_appointment_id` uuid, FK → appointments(id), nullable
- `notes` text
- CHECK (`end_time` > `start_time`)
- EXCLUDE constraint: no overlapping appointments per provider

### waitlist
- `id` uuid, PK
- `patient_id` uuid, FK → patients(id)
- `provider_id` uuid, FK → providers(id), nullable
- `appointment_type_id` uuid, FK → appointment_types(id)
- `desired_window_start` timestamptz
- `desired_window_end` timestamptz
- `priority` smallint, default 0
- `status` enum(`waiting`, `offered`, `scheduled`, `cancelled`)

### appointment_reminders
- `id` uuid, PK
- `appointment_id` uuid, FK → appointments(id)
- `channel` enum(`sms`, `email`, `whatsapp`, `voice`)
- `scheduled_at` timestamptz
- `sent_at` timestamptz, nullable
- `status` enum(`pending`, `sent`, `failed`)

**RLS:** patients see only their own appointments; staff see appointments at their facility.

---

## 9. Billing and Revenue Cycle

### charges
- `id` uuid, PK
- `encounter_id` uuid, FK → encounters(id)
- `cpt_code` varchar(10), FK → cpt_codes(code)
- `icd10_code` varchar(10), FK → icd10_cm_codes(code)
- `units` numeric(8,2), default 1
- `unit_amount` numeric(12,2), NOT NULL
- `total_amount` numeric(12,2), NOT NULL (generated: units * unit_amount)
- `modifiers` varchar(20)[]
- `status` enum(`draft`, `posted`, `billed`, `paid`, `voided`)

### claims
- `id` uuid, PK
- `claim_number` varchar(50), UNIQUE
- `patient_id` uuid, FK → patients(id)
- `patient_insurance_id` uuid, FK → patient_insurances(id)
- `encounter_id` uuid, FK → encounters(id)
- `claim_type` enum(`cms1500`, `ub04`)
- `total_amount` numeric(12,2)
- `submitted_at` timestamptz
- `status` enum(`draft`, `submitted`, `accepted`, `rejected`, `paid`, `denied`, `appealed`)

### claim_items
- `id` uuid, PK
- `claim_id` uuid, FK → claims(id)
- `charge_id` uuid, FK → charges(id)
- `amount` numeric(12,2)

### payments
- `id` uuid, PK
- `patient_id` uuid, FK → patients(id), nullable
- `claim_id` uuid, FK → claims(id), nullable
- `payment_type` enum(`patient`, `insurance`, `adjustment`, `refund`)
- `method` enum(`cash`, `card`, `check`, `ach`, `eob`)
- `amount` numeric(12,2), NOT NULL
- `received_at` timestamptz, NOT NULL
- `reference_number` varchar(100)

### statements
- `id` uuid, PK
- `patient_id` uuid, FK → patients(id)
- `period_start` date
- `period_end` date
- `balance` numeric(12,2)
- `sent_at` timestamptz
- `status` enum(`draft`, `sent`, `paid`)

### eligibility_checks
- `id` uuid, PK
- `patient_insurance_id` uuid, FK → patient_insurances(id)
- `checked_at` timestamptz
- `is_eligible` boolean
- `response_payload` jsonb

**RLS:** patient-scoped; billing staff role can read all charges/claims at their facility.

---

## 10. PACS (X-ray and Ultrasound)

### imaging_studies
- `id` uuid, PK
- `patient_id` uuid, FK → patients(id)
- `imaging_order_id` uuid, FK → imaging_orders(id), nullable
- `study_uid` varchar(64), UNIQUE (DICOM Study Instance UID)
- `accession_number` varchar(50), UNIQUE
- `modality` enum(`xray`, `ultrasound`)
- `study_description` varchar(255)
- `body_part` varchar(100)
- `study_date` timestamptz, NOT NULL
- `performed_by` uuid, FK → users(id), nullable

### imaging_series
- `id` uuid, PK
- `study_id` uuid, FK → imaging_studies(id) ON DELETE CASCADE
- `series_uid` varchar(64), UNIQUE
- `series_number` smallint
- `description` varchar(255)
- `instance_count` integer, default 0

### imaging_instances
- `id` uuid, PK
- `series_id` uuid, FK → imaging_series(id) ON DELETE CASCADE
- `sop_instance_uid` varchar(64), UNIQUE
- `instance_number` smallint
- `storage_url` text, NOT NULL (object-storage path to DICOM file)
- `thumbnail_url` text
- `width_px` integer
- `height_px` integer
- `file_size_bytes` bigint

### imaging_reports
- `id` uuid, PK
- `study_id` uuid, FK → imaging_studies(id)
- `radiologist_id` uuid, FK → providers(id)
- `findings` text
- `impression` text
- `status` enum(`draft`, `preliminary`, `final`, `addended`)
- `signed_at` timestamptz, nullable
- `addended_from_id` uuid, FK → imaging_reports(id), nullable

**RLS:** patient-scoped reads; only assigned radiologists/providers can author reports; signed reports are immutable (addendums only).

---

## 11. Telemedicine

### video_sessions
- `id` uuid, PK
- `appointment_id` uuid, FK → appointments(id), nullable, UNIQUE
- `room_code` varchar(64), UNIQUE
- `started_at` timestamptz
- `ended_at` timestamptz
- `status` enum(`scheduled`, `in_progress`, `ended`, `cancelled`)
- `provider_id` uuid, FK → providers(id)

### session_participants
- `id` uuid, PK
- `session_id` uuid, FK → video_sessions(id) ON DELETE CASCADE
- `user_id` uuid, FK → users(id), nullable
- `display_name` varchar(200)
- `role` enum(`host`, `provider`, `patient`, `observer`, `interpreter`)
- `joined_at` timestamptz
- `left_at` timestamptz

### session_recordings
- `id` uuid, PK
- `session_id` uuid, FK → video_sessions(id)
- `storage_url` text, NOT NULL
- `duration_seconds` integer
- `consent_id` uuid, FK → patient_consents(id), NOT NULL

### session_chat_messages
- `id` uuid, PK
- `session_id` uuid, FK → video_sessions(id) ON DELETE CASCADE
- `sender_id` uuid, FK → users(id)
- `body` text
- `sent_at` timestamptz, default now()

**RLS:** only session participants can read session rows and chat; recordings require valid `patient_consents` linkage and provider role.

---

## 12. Communication

### chat_channels
- `id` uuid, PK
- `name` varchar(100)
- `channel_type` enum(`direct`, `group`, `team`, `patient_context`)
- `facility_id` uuid, FK → facilities(id), nullable
- `patient_id` uuid, FK → patients(id), nullable (for patient-context channels)
- `created_by` uuid, FK → users(id)
- `is_archived` boolean, default false

### channel_members
- `channel_id` uuid, FK → chat_channels(id) ON DELETE CASCADE
- `user_id` uuid, FK → users(id) ON DELETE CASCADE
- `role` enum(`owner`, `member`)
- `joined_at` timestamptz, default now()
- `last_read_at` timestamptz
- PK (`channel_id`, `user_id`)

### chat_messages
- `id` uuid, PK
- `channel_id` uuid, FK → chat_channels(id) ON DELETE CASCADE
- `sender_id` uuid, FK → users(id)
- `body` text
- `attachment_url` text
- `attachment_mime` varchar(100)
- `parent_message_id` uuid, FK → chat_messages(id), nullable (threads)
- `edited_at` timestamptz
- `deleted_at` timestamptz

### chat_read_receipts
- `message_id` uuid, FK → chat_messages(id) ON DELETE CASCADE
- `user_id` uuid, FK → users(id)
- `read_at` timestamptz, default now()
- PK (`message_id`, `user_id`)

### email_messages
- `id` uuid, PK
- `direction` enum(`outbound`, `inbound`)
- `to_address` varchar(320), NOT NULL
- `from_address` varchar(320), NOT NULL
- `subject` varchar(500)
- `body_text` text
- `body_html` text
- `template_id` uuid, FK → message_templates(id), nullable
- `patient_id` uuid, FK → patients(id), nullable
- `appointment_id` uuid, FK → appointments(id), nullable
- `status` enum(`queued`, `sent`, `delivered`, `bounced`, `failed`)
- `provider_message_id` varchar(255) (vendor ID)
- `sent_at` timestamptz

### whatsapp_messages
- `id` uuid, PK
- `direction` enum(`outbound`, `inbound`)
- `to_number` varchar(20), NOT NULL
- `from_number` varchar(20), NOT NULL
- `body` text
- `media_url` text
- `template_name` varchar(100) (WhatsApp Business templates)
- `patient_id` uuid, FK → patients(id), nullable
- `appointment_id` uuid, FK → appointments(id), nullable
- `status` enum(`queued`, `sent`, `delivered`, `read`, `failed`)
- `provider_message_id` varchar(255)
- `sent_at` timestamptz

### message_templates
- `id` uuid, PK
- `name` varchar(100), UNIQUE
- `channel` enum(`email`, `sms`, `whatsapp`, `internal`)
- `subject` varchar(500)
- `body` text, NOT NULL
- `variables` jsonb (template variable schema)

### notifications
- `id` uuid, PK
- `user_id` uuid, FK → users(id)
- `category` enum(`clinical_alert`, `task`, `appointment`, `result`, `message`, `system`)
- `title` varchar(255)
- `body` text
- `link` text
- `read_at` timestamptz, nullable
- `created_at` timestamptz, default now()

### notification_preferences
- `user_id` uuid, FK → users(id), PK
- `email_enabled` boolean, default true
- `sms_enabled` boolean, default false
- `whatsapp_enabled` boolean, default false
- `push_enabled` boolean, default true
- `quiet_hours_start` time
- `quiet_hours_end` time

**RLS:**
- `chat_channels` / `chat_messages`: SELECT requires membership in `channel_members`. Patient-context channels additionally require care-team access to the linked patient.
- `email_messages` / `whatsapp_messages`: facility staff at the patient's facility, plus the patient via portal (their own messages only).
- `notifications`: only the recipient.

---

## 13. Reporting

### quality_measures
- `id` uuid, PK
- `code` varchar(50), UNIQUE
- `name` varchar(255)
- `description` text
- `measure_type` enum(`process`, `outcome`, `structure`, `patient_experience`)

### quality_measure_results
- `id` uuid, PK
- `measure_id` uuid, FK → quality_measures(id)
- `period_start` date
- `period_end` date
- `numerator` integer
- `denominator` integer
- `value` numeric(8,4) (generated: numerator / NULLIF(denominator,0))
- `facility_id` uuid, FK → facilities(id)

### saved_reports
- `id` uuid, PK
- `name` varchar(200)
- `definition` jsonb (query/filters)
- `created_by` uuid, FK → users(id)
- `is_shared` boolean, default false

**RLS:** facility-scoped; reports authored by user are private unless `is_shared`.

---

## 14. Audit and Security

### audit_logs
- `id` bigserial, PK
- `actor_user_id` uuid, FK → users(id), nullable
- `actor_ip` inet
- `action` varchar(64), NOT NULL (e.g., `record.read`, `record.update`)
- `resource_type` varchar(64), NOT NULL
- `resource_id` uuid
- `patient_id` uuid, FK → patients(id), nullable
- `metadata` jsonb
- `created_at` timestamptz, default now()
- INDEX on (`patient_id`, `created_at`), (`actor_user_id`, `created_at`)

### break_glass_events
- `id` uuid, PK
- `user_id` uuid, FK → users(id)
- `patient_id` uuid, FK → patients(id)
- `reason` text, NOT NULL
- `started_at` timestamptz, default now()
- `expires_at` timestamptz, NOT NULL
- `reviewed_by` uuid, FK → users(id), nullable
- `reviewed_at` timestamptz

### care_team_assignments
- `id` uuid, PK
- `patient_id` uuid, FK → patients(id)
- `user_id` uuid, FK → users(id)
- `role` enum(`primary`, `consulting`, `nurse`, `admin`, `other`)
- `effective_from` timestamptz, default now()
- `effective_to` timestamptz, nullable

**RLS:**
- `audit_logs`: append-only; SELECT only by compliance/admin role.
- `break_glass_events`: writer is the user; SELECT for compliance role.
- `care_team_assignments`: drives RLS for patient access — most patient policies join through this table.

---

## 15. Public Health

### reportable_conditions (reference)
- `id` uuid, PK
- `condition_code` varchar(20), UNIQUE, NOT NULL
- `name` varchar(255), NOT NULL
- `icd10_codes` varchar(10)[]
- `jurisdiction` varchar(100) (state/country)
- `reporting_timeframe_hours` integer
- `is_urgent` boolean, default false

### disease_reports
- `id` uuid, PK
- `patient_id` uuid, FK → patients(id)
- `reportable_condition_id` uuid, FK → reportable_conditions(id)
- `reported_by` uuid, FK → users(id)
- `diagnosis_date` date, NOT NULL
- `onset_date` date
- `lab_confirmed` boolean, default false
- `report_status` enum(`draft`, `submitted`, `accepted`, `rejected`, `withdrawn`)
- `jurisdiction` varchar(100)
- `submitted_at` timestamptz, nullable
- `external_reference` varchar(100) (jurisdiction's case number)
- `notes` text

### outbreaks
- `id` uuid, PK
- `name` varchar(200), NOT NULL
- `pathogen` varchar(200)
- `reportable_condition_id` uuid, FK → reportable_conditions(id), nullable
- `start_date` date, NOT NULL
- `end_date` date, nullable
- `jurisdiction` varchar(100)
- `status` enum(`active`, `contained`, `closed`)
- `description` text

### outbreak_cases
- `id` uuid, PK
- `outbreak_id` uuid, FK → outbreaks(id)
- `patient_id` uuid, FK → patients(id)
- `onset_date` date
- `exposure_source` varchar(255)
- `case_classification` enum(`suspected`, `probable`, `confirmed`, `ruled_out`)
- UNIQUE (`outbreak_id`, `patient_id`)

### contact_tracing
- `id` uuid, PK
- `index_case_patient_id` uuid, FK → patients(id)
- `outbreak_id` uuid, FK → outbreaks(id), nullable
- `contact_patient_id` uuid, FK → patients(id), nullable (if known to system)
- `contact_name` varchar(200) (when not in system)
- `contact_phone` varchar(20)
- `contact_email` varchar(320)
- `relationship` varchar(100)
- `exposure_date` date
- `exposure_setting` varchar(255)
- `monitoring_start` date
- `monitoring_end` date
- `status` enum(`identified`, `notified`, `monitoring`, `completed`, `lost_to_followup`)
- `assigned_to` uuid, FK → users(id), nullable

### screening_programs
- `id` uuid, PK
- `name` varchar(200), NOT NULL
- `screening_type` enum(`cancer`, `std`, `hiv`, `tb`, `mental_health`, `cardiovascular`, `other`)
- `target_population` text
- `start_date` date
- `end_date` date
- `is_active` boolean, default true

### screening_results
- `id` uuid, PK
- `screening_program_id` uuid, FK → screening_programs(id)
- `patient_id` uuid, FK → patients(id)
- `screened_at` timestamptz, NOT NULL
- `result` enum(`negative`, `positive`, `indeterminate`, `pending`)
- `referred_for_followup` boolean, default false
- `followup_notes` text

### vaccination_campaigns
- `id` uuid, PK
- `name` varchar(200), NOT NULL
- `vaccine_codes` varchar(20)[] (CVX codes)
- `target_population` text
- `start_date` date
- `end_date` date
- `doses_administered` integer, default 0
- `is_active` boolean, default true

### immunization_registry_submissions
- `id` uuid, PK
- `immunization_id` uuid, FK → immunizations(id)
- `registry_name` varchar(100), NOT NULL (e.g., state IIS)
- `submitted_at` timestamptz
- `status` enum(`queued`, `submitted`, `accepted`, `rejected`)
- `response_payload` jsonb

### public_health_alerts
- `id` uuid, PK
- `alert_type` enum(`advisory`, `alert`, `warning`, `update`)
- `title` varchar(255), NOT NULL
- `body` text, NOT NULL
- `jurisdiction` varchar(100)
- `effective_from` timestamptz
- `effective_to` timestamptz
- `source` varchar(200) (issuing authority)

**RLS:**
- `disease_reports`, `outbreak_cases`, `contact_tracing`, `screening_results`: patient-scoped by care team OR a dedicated `public_health` role at the patient's facility/jurisdiction.
- `outbreaks`, `screening_programs`, `vaccination_campaigns`, `public_health_alerts`: readable by all staff; writable by `public_health` role.
- `reportable_conditions`: reference table, public read.

---

## 16. Case Management

### external_providers
- `id` uuid, PK
- `name` varchar(200), NOT NULL
- `npi` varchar(10), nullable
- `organization` varchar(200)
- `specialty` varchar(100)
- `phone` varchar(20)
- `email` varchar(320)
- `fax` varchar(20)
- `address` text
- `is_active` boolean, default true

### cases
- `id` uuid, PK
- `case_number` varchar(50), UNIQUE, NOT NULL
- `patient_id` uuid, FK → patients(id)
- `case_manager_id` uuid, FK → users(id)
- `case_type` enum(`chronic_care`, `behavioral_health`, `social_services`, `transition_of_care`, `complex_care`, `other`)
- `status` enum(`open`, `active`, `on_hold`, `closed`)
- `priority` enum(`low`, `medium`, `high`, `urgent`)
- `opened_at` timestamptz, NOT NULL, default now()
- `closed_at` timestamptz, nullable
- `closure_reason` varchar(255)
- `summary` text

### case_team_members
- `case_id` uuid, FK → cases(id) ON DELETE CASCADE
- `user_id` uuid, FK → users(id) ON DELETE CASCADE
- `role` enum(`case_manager`, `social_worker`, `nurse`, `physician`, `behavioral_health`, `other`)
- `joined_at` timestamptz, default now()
- `removed_at` timestamptz, nullable
- PK (`case_id`, `user_id`)

### case_notes
- `id` uuid, PK
- `case_id` uuid, FK → cases(id)
- `author_id` uuid, FK → users(id)
- `note_type` enum(`progress`, `assessment`, `plan`, `communication`, `intake`, `discharge`, `other`)
- `body` text, NOT NULL
- `contact_method` enum(`in_person`, `phone`, `email`, `video`, `whatsapp`, `other`), nullable
- `contact_at` timestamptz, nullable
- `signed_at` timestamptz, nullable

### case_external_encounters
Encounters with external providers (referrals, calls, records exchange).

- `id` uuid, PK
- `case_id` uuid, FK → cases(id)
- `patient_id` uuid, FK → patients(id)
- `external_provider_id` uuid, FK → external_providers(id)
- `encounter_date` timestamptz, NOT NULL
- `encounter_type` enum(`referral`, `consult`, `phone_call`, `fax`, `email`, `records_request`, `records_received`, `joint_visit`)
- `summary` text
- `documents` text[] (object-storage URLs)
- `recorded_by` uuid, FK → users(id)
- `followup_required` boolean, default false
- `followup_due` date

### case_goals
- `id` uuid, PK
- `case_id` uuid, FK → cases(id)
- `description` text, NOT NULL
- `target_date` date
- `status` enum(`open`, `in_progress`, `achieved`, `not_achieved`, `deferred`)
- `achieved_at` timestamptz

### case_documents
- `id` uuid, PK
- `case_id` uuid, FK → cases(id)
- `name` varchar(255), NOT NULL
- `document_type` varchar(100)
- `storage_url` text, NOT NULL
- `mime_type` varchar(100)
- `uploaded_by` uuid, FK → users(id)

**RLS:**
- All `case_*` tables: SELECT requires membership in `case_team_members` for the case OR an admin role.
- `case_notes`: only the author can UPDATE before signing; signed notes are immutable (use addendums via comments — see Section 17).
- `external_providers`: reference-style; writable by admins, readable by all staff.

---

## 17. Note Interactions (Comments, Tasks, Likes, Approvals)

Cross-cutting polymorphic tables that attach to any "note-like" record. The pair (`notable_type`, `notable_id`) identifies the target. Allowed `notable_type` values:

- `clinical_note`
- `case_note`
- `case_external_encounter`
- `imaging_report`
- `lab_result`
- `disease_report`
- `progress_note`

Application-level enforcement validates `notable_type` against the allowed set and ensures the `notable_id` exists in the corresponding table.

### note_comments
- `id` uuid, PK
- `notable_type` varchar(64), NOT NULL
- `notable_id` uuid, NOT NULL
- `author_id` uuid, FK → users(id)
- `body` text, NOT NULL
- `parent_comment_id` uuid, FK → note_comments(id), nullable (threaded replies)
- `edited_at` timestamptz, nullable
- `deleted_at` timestamptz, nullable
- INDEX (`notable_type`, `notable_id`, `created_at`)

### note_tasks
- `id` uuid, PK
- `notable_type` varchar(64), NOT NULL
- `notable_id` uuid, NOT NULL
- `title` varchar(255), NOT NULL
- `description` text
- `assigned_to` uuid, FK → users(id), NOT NULL
- `assigned_by` uuid, FK → users(id), NOT NULL
- `due_at` timestamptz, nullable
- `priority` enum(`low`, `medium`, `high`, `urgent`), default `medium`
- `status` enum(`open`, `in_progress`, `completed`, `cancelled`), default `open`
- `completed_at` timestamptz, nullable
- `completed_by` uuid, FK → users(id), nullable
- INDEX (`assigned_to`, `status`)
- INDEX (`notable_type`, `notable_id`)

### note_reactions
- `id` uuid, PK
- `notable_type` varchar(64), NOT NULL
- `notable_id` uuid, NOT NULL
- `user_id` uuid, FK → users(id)
- `reaction_type` enum(`like`, `important`, `acknowledge`), default `like`
- `created_at` timestamptz, default now()
- UNIQUE (`notable_type`, `notable_id`, `user_id`, `reaction_type`)

### note_approvals
- `id` uuid, PK
- `notable_type` varchar(64), NOT NULL
- `notable_id` uuid, NOT NULL
- `approver_id` uuid, FK → users(id)
- `approval_status` enum(`approved`, `rejected`, `changes_requested`), NOT NULL
- `comment` text
- `decided_at` timestamptz, default now()
- `superseded_by_id` uuid, FK → note_approvals(id), nullable (later decision overrides)
- INDEX (`notable_type`, `notable_id`, `decided_at` DESC)

### note_approval_requirements (optional)
Defines, per `notable_type`, which roles must approve before a note is considered finalized.

- `id` uuid, PK
- `notable_type` varchar(64), NOT NULL
- `required_role_id` uuid, FK → roles(id)
- `min_approvals` smallint, default 1
- UNIQUE (`notable_type`, `required_role_id`)

**RLS:**
- All four tables: SELECT requires that the user can read the underlying `notable_type`/`notable_id` row (policy joins through to the parent table — clinical_notes' care-team check, case_notes' team-member check, etc.).
- `note_comments`: author may UPDATE/soft-delete their own comment; others may not.
- `note_tasks`: visible to `assigned_to`, `assigned_by`, and the care team / case team for the parent. Only `assigned_to` (or admin) may transition to `completed`.
- `note_reactions`: a user may only INSERT/DELETE their own reaction.
- `note_approvals`: only users holding the role required by `note_approval_requirements` for that `notable_type` may INSERT.

---

## 18. AI Chat and AI-Generated Reports

Tables backing the in-app AI assistant (chat over patient/case context) and AI-generated reports (case summaries, billing summaries, etc.). All AI tables use the same `(subject_type, subject_id)` polymorphic pattern as Note Interactions for grounding.

### ai_conversations
- `id` uuid, PK
- `user_id` uuid, FK → users(id)
- `title` varchar(255)
- `subject_type` enum(`patient`, `case`, `encounter`, `claim`, `billing_period`, `general`), NOT NULL
- `subject_id` uuid, nullable (null for `general`)
- `model` varchar(64), NOT NULL (e.g., `claude-opus-4-7`)
- `system_prompt_id` uuid, FK → ai_prompt_templates(id), nullable
- `status` enum(`active`, `archived`, `deleted`), default `active`
- `last_message_at` timestamptz, nullable
- INDEX (`user_id`, `last_message_at` DESC)
- INDEX (`subject_type`, `subject_id`)

### ai_messages
- `id` uuid, PK
- `conversation_id` uuid, FK → ai_conversations(id) ON DELETE CASCADE
- `role` enum(`user`, `assistant`, `system`, `tool`), NOT NULL
- `content` text, NOT NULL
- `parent_message_id` uuid, FK → ai_messages(id), nullable (for edits/regenerations)
- `model` varchar(64) (assistant turns)
- `tokens_input` integer
- `tokens_output` integer
- `latency_ms` integer
- `tool_name` varchar(100) (when `role = tool`)
- `tool_payload` jsonb
- `flagged` boolean, default false (safety/PII flags)
- INDEX (`conversation_id`, `created_at`)

### ai_message_citations
Provenance for assistant turns — which records the model grounded its response on.

- `id` uuid, PK
- `message_id` uuid, FK → ai_messages(id) ON DELETE CASCADE
- `source_type` varchar(64), NOT NULL (e.g., `clinical_note`, `lab_result`, `case_note`, `imaging_report`)
- `source_id` uuid, NOT NULL
- `excerpt` text
- `relevance_score` numeric(4,3)
- INDEX (`message_id`)

### ai_prompt_templates
Reusable prompt templates for chat system prompts and report generation.

- `id` uuid, PK
- `name` varchar(200), UNIQUE, NOT NULL
- `purpose` enum(`chat_system`, `case_summary`, `billing_summary`, `patient_summary`, `encounter_summary`, `claim_narrative`, `quality_review`, `other`)
- `prompt` text, NOT NULL
- `variables` jsonb (declared template variables)
- `output_schema` jsonb, nullable (for structured outputs)
- `model` varchar(64) (recommended model)
- `version` integer, default 1
- `is_active` boolean, default true
- `created_by` uuid, FK → users(id)

### ai_reports
AI-generated reports (case summaries, billing rollups, encounter abstracts, claim narratives, etc.).

- `id` uuid, PK
- `report_type` enum(`case_summary`, `billing_summary`, `patient_summary`, `encounter_summary`, `claim_narrative`, `quality_review`, `discharge_summary`, `referral_letter`, `other`), NOT NULL
- `subject_type` enum(`patient`, `case`, `encounter`, `claim`, `billing_period`, `outbreak`), NOT NULL
- `subject_id` uuid, NOT NULL
- `requested_by` uuid, FK → users(id), NOT NULL
- `prompt_template_id` uuid, FK → ai_prompt_templates(id), nullable
- `model` varchar(64), NOT NULL
- `parameters` jsonb (date ranges, filters, etc.)
- `output_format` enum(`markdown`, `html`, `pdf`, `json`, `text`), default `markdown`
- `output_text` text (inline output)
- `output_url` text (object-storage URL for large/binary outputs)
- `output_structured` jsonb (when `output_format = json`)
- `status` enum(`queued`, `running`, `completed`, `failed`, `cancelled`), default `queued`
- `error_message` text
- `tokens_input` integer
- `tokens_output` integer
- `generated_at` timestamptz, nullable
- `expires_at` timestamptz, nullable (cache lifetime)
- INDEX (`subject_type`, `subject_id`, `report_type`, `generated_at` DESC)
- INDEX (`requested_by`, `created_at` DESC)

### ai_report_sources
Provenance for a generated report — what records were fed into it. Critical for audit.

- `id` uuid, PK
- `report_id` uuid, FK → ai_reports(id) ON DELETE CASCADE
- `source_type` varchar(64), NOT NULL
- `source_id` uuid, NOT NULL
- `included_at` timestamptz, default now()
- INDEX (`report_id`)
- INDEX (`source_type`, `source_id`)

### ai_feedback
User ratings on AI outputs (chat turns or reports), used for tuning and review.

- `id` uuid, PK
- `target_type` enum(`message`, `report`), NOT NULL
- `target_id` uuid, NOT NULL
- `user_id` uuid, FK → users(id)
- `rating` enum(`thumbs_up`, `thumbs_down`)
- `category` enum(`accuracy`, `helpfulness`, `safety`, `formatting`, `other`), nullable
- `comment` text
- UNIQUE (`target_type`, `target_id`, `user_id`)

### ai_usage_log
Per-call cost and token accounting for monitoring and billing.

- `id` bigserial, PK
- `user_id` uuid, FK → users(id)
- `feature` enum(`chat`, `report`, `summary`, `tool_call`, `embedding`), NOT NULL
- `model` varchar(64), NOT NULL
- `conversation_id` uuid, FK → ai_conversations(id), nullable
- `report_id` uuid, FK → ai_reports(id), nullable
- `tokens_input` integer, NOT NULL
- `tokens_output` integer, NOT NULL
- `tokens_cache_read` integer, default 0
- `tokens_cache_write` integer, default 0
- `cost_usd` numeric(10,5)
- `created_at` timestamptz, default now()
- INDEX (`user_id`, `created_at` DESC)
- INDEX (`feature`, `created_at` DESC)

### ai_safety_events
Records when AI output was blocked, flagged, or modified by guardrails.

- `id` uuid, PK
- `message_id` uuid, FK → ai_messages(id), nullable
- `report_id` uuid, FK → ai_reports(id), nullable
- `event_type` enum(`prompt_injection`, `phi_leak`, `policy_violation`, `hallucination_flag`, `unauthorized_access`)
- `severity` enum(`info`, `warning`, `critical`)
- `details` jsonb
- `acted_on` boolean, default false
- `reviewed_by` uuid, FK → users(id), nullable

**RLS:**
- `ai_conversations` / `ai_messages` / `ai_message_citations`: SELECT for the owning `user_id` only; admins/compliance read-only for audit. When `subject_type/subject_id` is set, the runtime additionally checks the user has access to that subject before allowing INSERT — no chatting about a patient you can't already see.
- `ai_reports` / `ai_report_sources`: SELECT requires read access to the underlying subject (patient via care team, case via case team, claim via billing role). Writers must have read access at the time of generation; the resulting report inherits subject-based access.
- AI-generated reports can be routed through `note_approvals` (Section 17) with `notable_type = 'ai_report'` to require human sign-off before they become part of the chart.
- `ai_usage_log`, `ai_safety_events`: admin/compliance only.
- `ai_prompt_templates`: SELECT for all staff; INSERT/UPDATE by admin or designated `ai_admin` role.
- All AI access to PHI is mirrored into `audit_logs` (Section 14) — every record fed into a prompt produces a `record.read` audit entry attributed to the requesting user.

---

## 19. Inventory Management

Tracks supplies, medications, and assets across locations, with par/min/recommended levels and a direct linkage from consumption events to billing charges (Section 9).

### inventory_items
The master catalog. One row per distinct SKU regardless of location.

- `id` uuid, PK
- `sku` varchar(64), UNIQUE, NOT NULL
- `name` varchar(255), NOT NULL
- `item_type` enum(`supply`, `medication`, `asset`, `equipment`, `consumable`), NOT NULL
- `description` text
- `category` varchar(100)
- `unit_of_measure` varchar(50), NOT NULL (e.g., `each`, `box`, `ml`, `mg`, `vial`)
- `drug_id` uuid, FK → drug_catalog(id), nullable (set when `item_type = medication`)
- `cpt_code` varchar(10), FK → cpt_codes(code), nullable (billing code)
- `hcpcs_code` varchar(10), nullable
- `default_charge_amount` numeric(12,2), nullable (default unit charge when billable)
- `is_billable` boolean, default false
- `is_controlled` boolean, default false (controlled substance)
- `controlled_schedule` smallint, CHECK between 1 and 5, nullable
- `requires_lot_tracking` boolean, default false
- `requires_serial_tracking` boolean, default false
- `shelf_life_days` integer, nullable
- `is_active` boolean, default true
- CHECK (`drug_id` IS NULL OR `item_type` = 'medication')

### inventory_locations
Storage locations within facilities. Hierarchical (a cart inside a stockroom inside a facility).

- `id` uuid, PK
- `facility_id` uuid, FK → facilities(id)
- `parent_location_id` uuid, FK → inventory_locations(id), nullable
- `name` varchar(100), NOT NULL
- `location_type` enum(`stockroom`, `pharmacy`, `cart`, `room`, `fridge`, `freezer`, `vault`, `other`)
- `is_active` boolean, default true
- UNIQUE (`facility_id`, `parent_location_id`, `name`)

### inventory_stock_levels
Quantity per item per location, with par levels driving reorder alerts. **One row per (item, location)**.

- `id` uuid, PK
- `item_id` uuid, FK → inventory_items(id)
- `location_id` uuid, FK → inventory_locations(id)
- `quantity_on_hand` numeric(14,3), NOT NULL, default 0
- `quantity_reserved` numeric(14,3), NOT NULL, default 0
- `quantity_available` numeric(14,3), generated (`on_hand - reserved`)
- `min_level` numeric(14,3), default 0 (reorder trigger)
- `recommended_level` numeric(14,3), default 0 (target par level)
- `max_level` numeric(14,3), nullable
- `reorder_quantity` numeric(14,3), nullable (default order qty when below min)
- `last_counted_at` timestamptz, nullable
- UNIQUE (`item_id`, `location_id`)
- CHECK (`recommended_level` >= `min_level`)
- CHECK (`max_level` IS NULL OR `max_level` >= `recommended_level`)

### inventory_lots
Lot tracking for medications, vaccines, and lot-controlled supplies.

- `id` uuid, PK
- `item_id` uuid, FK → inventory_items(id)
- `lot_number` varchar(100), NOT NULL
- `expiry_date` date, NOT NULL
- `received_at` timestamptz, default now()
- `supplier_id` uuid, FK → suppliers(id), nullable
- `cost_per_unit` numeric(12,4)
- `manufacturer` varchar(200)
- `recall_status` enum(`none`, `voluntary`, `mandatory`), default `none`
- UNIQUE (`item_id`, `lot_number`)

### inventory_lot_stock
Quantity of a specific lot at a specific location.

- `id` uuid, PK
- `lot_id` uuid, FK → inventory_lots(id)
- `location_id` uuid, FK → inventory_locations(id)
- `quantity` numeric(14,3), NOT NULL, default 0
- UNIQUE (`lot_id`, `location_id`)

### assets
Serial-tracked individual equipment items (one row per physical unit).

- `id` uuid, PK
- `item_id` uuid, FK → inventory_items(id)
- `serial_number` varchar(100), UNIQUE, NOT NULL
- `asset_tag` varchar(50), UNIQUE
- `location_id` uuid, FK → inventory_locations(id)
- `status` enum(`available`, `in_use`, `maintenance`, `retired`, `lost`, `disposed`)
- `assigned_to` uuid, FK → users(id), nullable
- `purchased_at` date
- `purchase_cost` numeric(12,2)
- `warranty_expires` date
- `next_maintenance_due` date
- `notes` text

### asset_maintenance_log
- `id` uuid, PK
- `asset_id` uuid, FK → assets(id)
- `maintenance_type` enum(`preventive`, `repair`, `calibration`, `inspection`, `decommission`)
- `performed_at` timestamptz, NOT NULL
- `performed_by` uuid, FK → users(id), nullable
- `vendor` varchar(200), nullable
- `cost` numeric(12,2)
- `notes` text
- `next_due` date

### suppliers
- `id` uuid, PK
- `name` varchar(200), NOT NULL
- `contact_name` varchar(200)
- `phone` varchar(20)
- `email` varchar(320)
- `address` text
- `account_number` varchar(100)
- `is_active` boolean, default true

### purchase_orders
- `id` uuid, PK
- `po_number` varchar(50), UNIQUE, NOT NULL
- `supplier_id` uuid, FK → suppliers(id)
- `facility_id` uuid, FK → facilities(id)
- `status` enum(`draft`, `submitted`, `approved`, `received`, `partially_received`, `cancelled`)
- `total_amount` numeric(14,2)
- `ordered_at` timestamptz
- `expected_at` date
- `received_at` timestamptz
- `created_by` uuid, FK → users(id)

### purchase_order_items
- `id` uuid, PK
- `purchase_order_id` uuid, FK → purchase_orders(id) ON DELETE CASCADE
- `item_id` uuid, FK → inventory_items(id)
- `quantity_ordered` numeric(14,3), NOT NULL
- `quantity_received` numeric(14,3), default 0
- `unit_cost` numeric(12,4), NOT NULL
- `line_total` numeric(14,2), generated (`quantity_ordered * unit_cost`)

### inventory_transactions
Append-only ledger. Every change to `inventory_stock_levels.quantity_on_hand` is recorded here. Source of truth for audits, FIFO/expiry tracking, and the billing linkage below.

- `id` bigserial, PK
- `item_id` uuid, FK → inventory_items(id)
- `location_id` uuid, FK → inventory_locations(id)
- `lot_id` uuid, FK → inventory_lots(id), nullable
- `transaction_type` enum(`receipt`, `issue`, `dispense`, `transfer_out`, `transfer_in`, `adjustment`, `return`, `waste`, `expired`, `count`, `recall`)
- `quantity` numeric(14,3), NOT NULL (positive = inbound, negative = outbound)
- `unit_cost` numeric(12,4), nullable
- `reference_type` varchar(64), nullable (e.g., `encounter`, `prescription`, `charge`, `purchase_order`, `transfer`)
- `reference_id` uuid, nullable
- `charge_id` uuid, FK → charges(id), nullable (direct billing linkage — see below)
- `prescription_id` uuid, FK → prescriptions(id), nullable
- `encounter_id` uuid, FK → encounters(id), nullable
- `performed_by` uuid, FK → users(id)
- `reason` varchar(255)
- `created_at` timestamptz, default now()
- INDEX (`item_id`, `location_id`, `created_at` DESC)
- INDEX (`charge_id`)
- INDEX (`encounter_id`)

### inventory_alerts
- `id` uuid, PK
- `alert_type` enum(`low_stock`, `out_of_stock`, `expiring_soon`, `expired`, `recall`, `maintenance_due`, `overstock`)
- `item_id` uuid, FK → inventory_items(id), nullable
- `location_id` uuid, FK → inventory_locations(id), nullable
- `lot_id` uuid, FK → inventory_lots(id), nullable
- `asset_id` uuid, FK → assets(id), nullable
- `severity` enum(`info`, `warning`, `critical`)
- `triggered_at` timestamptz, default now()
- `resolved_at` timestamptz, nullable
- `resolved_by` uuid, FK → users(id), nullable

### Billing linkage

When a billable inventory item is consumed (medication dispensed, supply issued during a procedure), the system creates **both** an `inventory_transactions` row **and** a `charges` row, joined two ways:

1. `inventory_transactions.charge_id` → `charges.id` (the consumption that triggered the charge).
2. The existing `charges` table gains an optional reference back to inventory:
    - `charges.inventory_item_id` uuid, FK → inventory_items(id), nullable
    - `charges.inventory_transaction_id` bigint, FK → inventory_transactions(id), nullable

Notes on the linkage:
- A single encounter can produce multiple inventory transactions, each generating its own charge line (or rolled into one charge with units > 1).
- Non-billable items (e.g., generic supplies, internal-use assets) generate transactions but no charge — `charge_id` stays NULL.
- For controlled substances, the dispense transaction must reference both `prescription_id` and `charge_id` for DEA reporting and billing alignment.
- Reversals (`return`, voided charges) post a compensating `inventory_transactions` row with negated quantity and a link to the original transaction via `reference_type = 'inventory_transaction'`, `reference_id = <original.id>`.

### Reorder logic

A row in `inventory_stock_levels` is below par when `quantity_available < min_level`. A nightly job (or trigger) creates a `low_stock` alert and optionally drafts a `purchase_orders` row at `reorder_quantity` from the preferred supplier. `recommended_level` is the target the PO aims to restock to: suggested order qty = `recommended_level - quantity_available`.

**RLS:**
- `inventory_items`, `suppliers`: reference-style. SELECT for all staff; INSERT/UPDATE by `inventory_admin` role.
- `inventory_locations`, `inventory_stock_levels`, `inventory_lots`, `inventory_lot_stock`, `assets`: SELECT for staff at the location's facility; modify by `inventory_admin` or `pharmacy` role (for medications).
- `inventory_transactions`: append-only — no UPDATE/DELETE policies. SELECT scoped to the location's facility; full access for compliance.
- `purchase_orders` / `purchase_order_items`: facility-scoped; create/approve gated on `purchasing` role.
- `inventory_alerts`: SELECT for staff at the affected facility; resolve restricted to `inventory_admin`.
- Controlled-substance transactions (where `inventory_items.is_controlled = true`) require the acting user to hold an active `pharmacy` or `provider` role with valid DEA credential, enforced in policy.

---

## RLS Policy Patterns

A few reusable predicates referenced above:

**`is_on_care_team(patient_id, user_id)`** — true if `care_team_assignments` has an active row.

**`is_facility_staff(facility_id, user_id)`** — true if `user_roles` joins user to a role at the facility.

**`is_self_patient(patient_id, user_id)`** — true if `patients.user_id = user_id`.

**`has_break_glass(patient_id, user_id)`** — true if `break_glass_events` has an active, non-expired entry; access is logged.

**`is_admin(user_id)`** — true if user has admin role.

Default patient-scoped SELECT policy:
```
USING (
  is_self_patient(patient_id, current_user_id())
  OR is_on_care_team(patient_id, current_user_id())
  OR has_break_glass(patient_id, current_user_id())
  OR is_admin(current_user_id())
)
```

INSERT/UPDATE policies tighten this to staff/providers only and reject patient-self writes outside permitted columns (demographics, contacts, consents).

Reference tables (ICD-10, CPT, drug catalog, etc.) have RLS disabled or policies that allow `SELECT` to all authenticated users.

---

## Indexes (high-traffic only)

- `patients(mrn)`, `patients(last_name, first_name, date_of_birth)`
- `encounters(patient_id, start_time DESC)`
- `appointments(provider_id, start_time)`, `appointments(patient_id, start_time)`
- `lab_results(lab_order_id)`, partial index on `flag IN ('critical_high','critical_low')`
- `chat_messages(channel_id, created_at DESC)`
- `audit_logs(patient_id, created_at DESC)`
- `imaging_studies(patient_id, study_date DESC)`

---

## Notes

- Encryption-at-rest assumed at the storage layer; columns flagged `encrypted` use application-level envelope encryption (e.g., DEA numbers, SSN).
- Reference code tables (ICD-10-CM/PCS, CPT, LOINC, RxNorm, CVX) are seeded from external sources and refreshed periodically.
- Object storage (DICOM files, recordings, attachments) sits outside the relational DB; tables hold only URLs and metadata.
