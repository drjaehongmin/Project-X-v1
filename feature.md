# Feature Inventory — Workspaces, Sessions, and Modules

_Created 2026-05-10_

Derived from `ARCHITECTURE.md`, `FEATURES/features-phase-1.md`, and `IDEAS/*`. Organized by the architectural hierarchy: **Workspace Type → Session Scope → Modules (Session-Level + Patient-Level)**.

---

## 1. Workspace Types

A workspace type determines the module set, default layouts, terminology, and workflows available to a session.

| Workspace | Purpose | Default Module Set |
| --- | --- | --- |
| **Clinic / Outpatient** | Ambulatory visits, scheduled encounters, primary and specialty care | Scheduling, Encounters, Orders, Prescriptions, Billing, Patient Portal |
| **Inpatient** | Hospital admission, rounding, bed management | Census, Rounding, Orders/CPOE, MAR, Discharge Planning |
| **Case Management** | Longitudinal patient coordination, social and care plans | Caseloads, Care Plans, Tasks, Referrals, Communications |
| **Telehealth** | Virtual consultations, video-first workflow | Virtual Waiting Room, Video Console, e-Prescribing, Visit Summary |
| **Emergency / Urgent Care** | Walk-in triage and rapid throughput | Triage, Tracking Board, Quick Orders, Disposition |
| **Imaging / PACS** | X-ray and ultrasound capture and review | Worklist, Viewer, Reporting, Sign-off |
| **Lab** | Specimen handling, result entry, result release | Order Queue, Specimen Tracking, Result Entry |
| **Billing / RCM** | Revenue cycle, claims, statements | Charges, Claims, Payments, AR |
| **Administration** | System configuration, user/facility/master-data management | User Admin, Facility Admin, Master Data, Audit |
| **Patient Portal** | Patient-facing self-service | Appointments, Results, Messaging, Bill Pay, Telehealth |

---

## 2. Session Scope

A session is established at login as `Workspace + Location + User` and rarely changes mid-session.

### Session Foundation
- **Workspace selection** — chooses the active workspace type
- **Location selection** — clinic, hospital, unit, or vessel context; affects providers, schedules, formulary, and regulatory rules
- **User identity** — authenticated user, role bundle, and access level
- **Session establishment** — token issue, expiry, idle timeout, lockout

### Session Lifecycle
- Login / SSO / MFA challenge
- Break-the-glass emergency access (with mandatory logging)
- Session refresh and re-authentication for sensitive actions (EPCS, bulk export)
- Session timeout, manual sign-out, and forced revocation
- Audit trail of session events
- Concurrent session management across devices

### Session State
- Active workspace + location + user (immutable for session)
- Open **patient context groups** (multiple, concurrent)
- Open module tabs (session-level and per-patient-context)
- User preferences scoped to the session (layout, density, theme)
- Pinned items, recent items, notifications

---

## 3. Session-Level Modules (Patient-Independent)

These modules operate at the session scope and do **not** require a patient context.

### 3.1 Scheduling
- Calendar views (day, week, month, provider, resource)
- Appointment booking, rescheduling, cancellation
- Recurring appointments and templates
- Provider/resource availability and blocking
- Waitlist management
- No-show tracking
- Appointment reminders (SMS, email, WhatsApp)

### 3.2 Inbox / Tasks
- Personal and role-based inbox
- Task assignment, delegation, and pools
- Result acknowledgement queue
- Refill request queue
- Document signing queue
- Clinical decision support alerts feed

### 3.3 Communications
- Internal staff-to-staff chat (DMs and channels)
- Group/team channels
- File and image sharing within chat
- Patient-context messaging (link chat to patient record)
- Read receipts and presence
- Notification routing across channels (in-app, email, WhatsApp)

### 3.4 Reports & Analytics
- Operational dashboards
- Clinical quality measures
- Patient panel reports
- Population health metrics
- Custom report builder
- Regulatory reporting (MIPS, etc.)
- Data export to CDW (separate reporting database)

### 3.5 Worklists
- Provider worklist (today's panel)
- Lab/imaging order worklist
- Imaging read worklist (PACS)
- Billing/charge review worklist
- Referrals out / in tracking

### 3.6 Administration
- User and role management
- Facility, department, and room management
- Provider and credential management
- Master data (drugs, labs, codes, order sets, templates)
- System configuration and preferences
- Audit log viewer
- Integration / API configuration
- Webhook and websocket endpoint management
- License and credential tracking

### 3.7 Security & Compliance
- Access control policy editor (RBAC)
- MFA enrollment and enforcement
- Audit log search and export
- Data subject requests (export, deletion, rectification, restriction)
- Consent management and withdrawal propagation
- Break-glass log review
- SIEM / anomaly alerts dashboard
- Key management and rotation status
- Backup status and restore tests
- ROPAs, DPIAs, BAAs/DPAs registry

### 3.8 Interoperability
- HL7 v2 inbound/outbound monitor
- FHIR API explorer
- C-CDA send/receive
- Direct secure messaging
- HIE connectivity dashboard
- Mapping and transformation rules
- Customizable API + websocket endpoints (admin-configurable)

### 3.9 Billing & Revenue Cycle (session-level views)
- Charge review queue
- Claims status board
- Payment posting
- AR aging
- Patient statement runs

### 3.10 Imaging Worklist (PACS — session-level)
- Pending studies
- In-progress reads
- Reports awaiting sign-off
- Study search across patients

### 3.11 AI Assistant (Session-Level)
- Ambient documentation assist
- Cross-record search and summarization
- Smart drafting (notes, replies, orders)
- Embedded copilots within session modules

### 3.12 Notifications & Alerts Center
- Critical lab value alerts
- Drug-drug / drug-allergy alerts (review)
- Preventive care reminders
- System alerts (downtime, ePrescribe, integrations)

---

## 4. Patient-Level Modules (Operate Within a Patient Context Group)

These modules receive the active patient as a prop. Multiple patient context groups can be open in one session.

### 4.1 Patient Header / Banner
- Demographics summary
- Allergies, problems, code status quick view
- Active encounters and alerts

### 4.2 Demographics & Registration
- Personal info, contacts, emergency contacts
- Insurance and coverage
- Consent and privacy preferences
- MRN, identifiers, and merge tools

### 4.3 Chart Summary
- Snapshot of problems, meds, allergies, recent vitals, recent results

### 4.4 Encounters / Visits
- Encounter timeline
- Visit notes (SOAP, progress, procedure)
- Templates and smart phrases
- Co-sign workflows

### 4.5 Problems
- Problem list (active, resolved, chronic)
- ICD-10-CM linkage
- Onset, status, and history

### 4.6 Medications
- Active medication list
- Reconciliation (admission, transfer, discharge)
- Prescription writing (e-Prescribing)
- EPCS for controlled substances
- Refill management
- Drug interaction and allergy checking
- Formulary lookup
- Medication history (external)

### 4.7 Allergies & Adverse Reactions
- Allergy list with severity, reaction, source
- Reconciliation against orders/meds

### 4.8 Orders (CPOE)
- Labs, imaging, procedures, referrals, nursing orders
- Order sets and favorites
- Order status tracking
- Cosignature and approval flows

### 4.9 Results
- Lab results (numeric, text, structured)
- Imaging results and links to studies
- Trending and graphing
- Acknowledgement and routing

### 4.10 Diagnoses & Coding
- ICD-10-CM coding workspace
- Code search, validation, hierarchy navigation
- Problem-to-diagnosis linking

### 4.11 Vitals & Flowsheets
- Vital signs entry and trends
- Flowsheets (intake/output, neuro checks, etc.)

### 4.12 Histories
- Medical, surgical, family, social
- Reproductive, immunization, travel

### 4.13 Immunizations
- Records, due/overdue, registry sync

### 4.14 Imaging (PACS Viewer — Patient-Scoped)
- Study and series navigation
- Viewer tools (zoom, pan, rotate, brightness/contrast, measure)
- DICOM and non-DICOM (X-ray, US) support
- Reporting and sign-off
- Image download and share
- Link images to encounter

### 4.15 Documents
- Scanned documents
- External records
- C-CDA imports
- Patient-uploaded documents

### 4.16 Referrals & Consults
- Outgoing referral requests
- Incoming consult responses
- Referral status tracking

### 4.17 Care Plans
- Goals, interventions, outcomes
- Care team membership
- Task generation tied to plan

### 4.18 Patient Communications
- Secure messages with the patient
- Patient-linked staff chat threads
- WhatsApp / SMS / email touchpoints (where consented)

### 4.19 Telehealth Console (Patient-Scoped)
- Pre-visit checks
- Video / audio call
- In-call screen share, chat, file share
- Recording with consent
- e-Prescribing during visit
- Post-visit summary

### 4.20 Billing (Patient-Scoped)
- Charge capture for encounter
- Patient statements and invoices
- Payment posting
- Patient AR view

### 4.21 Patient Portal Linkage (Provider View)
- Portal access status
- Patient-initiated requests (refill, appointment)
- Shared documents and result release

### 4.22 Audit / Disclosures (Patient-Scoped)
- Access history on this record
- Accounting of disclosures
- Break-glass events on this patient

### 4.23 AI Copilots (Patient-Scoped)
- Visit summarization
- Note drafting from ambient capture
- Differential diagnosis suggestions
- Risk scores and care-gap surfacing

---

## 5. Cross-Cutting Concerns (Not Modules — Apply to All)

- **RBAC and least-privilege** enforced at the module and field level
- **Audit logging** for every read/write/export/admin action
- **Encryption** in transit (TLS 1.2+) and at rest (AES-256)
- **Tenant/location isolation** via RLS
- **Consent enforcement** propagated to downstream systems
- **Data minimization and retention** per category
- **AI-native data layer** — feature embeddings, vector search, model-callable tools
- **Integration surface** — REST, FHIR, HL7, websockets, customizable webhooks

---

## 6. Open Questions / Phase-2 Candidates

- Multi-tenant model (single DB + RLS vs. DB-per-tenant)
- Mobile / native app surfaces
- Marketplace / plugin system for third-party modules
- AI agent runtime: where agents live and how they are scoped (session vs. patient context)
- Offline mode (telehealth on poor links, field/inpatient)
- CDW sync cadence and PHI handling in reporting store
