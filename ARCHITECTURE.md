## Hierarchy Levels (Outer to Inner)

### Session Foundation
- **Workspace Type** — Clinic, Case Management, Inpatient, Telehealth, etc.
  - Determines module set, default layouts, terminology, and workflows
- **Location** — Specific clinic, hospital, or unit
  - Affects providers, schedules, formularies, order sets, and regulatory rules
- **User** — Identity, role, and access level
  - Drives permissions, audit identity, and module availability
- **Session Scope** — Workspace + Location + User established at login; rarely changes mid-session

### Session-Level Modules
- **General Access Modules** — Patient-independent; scoped to the session
  - Examples: schedule, inbox, tasks, reports, communications

### Patient Context
- **Patient Context Groups** — Multiple can exist concurrently within a session
  - Each group holds its own patient and associated patient-scoped tabs
- **Patient-Level Modules** — Operate within a patient context group
  - Receive the patient as a prop