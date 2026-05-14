# @emr/module-patient-create — Rules

## Purpose

Register a new patient in the database. The first general-scope module to *write* through `DataService`. Pairs `data.write('Patient', { mrn, firstName, … })` → `POST /patients` with the backend's care-team self-insert (migration 0011) so the creator becomes the patient's primary care provider and can read the new row back on the next request. Session-local list shows IDs/MRNs of patients created so far so the user has the identifiers at hand while they build chart modules.

## Manifest summary

- **id:** `patient-create`
- **displayName:** `Create Patient`
- **scope:** `general`
- **requires:** `['session']`
- **services:** `['data', 'navigation']`
- **permissions:** `['patient.write']`

## Hard rules

- Imports only from `@emr/contracts`, `@emr/module-sdk`, `@emr/shared`, and external libs. No sibling-module imports.
- Single public entry: `src/index.ts` exports the `ModuleDefinition`.
- Component takes no props. Context arrives via SDK hooks.

## Public API

- `default` / `patientCreateModule`: the registered `ModuleDefinition`.

## Notes

- The "Open patient group" button calls `NavigationService.openPatientGroup` with the newly-created patient. The group appears as a chip in the patient-groups bar but has **no initial tab** — until a patient-scoped chart module is built, the chip is the entire chart UI. That's the canonical signal that another module is needed.
- The list of created patients is session-local (component state). A real `GET /patients?search=` list endpoint is the natural next step; this module will then load the full set on mount instead of only tracking writes from this tab.
- The backend auto-adds the caller as primary care team in the same transaction. To register a patient and assign someone *else* as primary, the admin tool path (`pnpm db-create-patient --care-team-user-email …`) is still the right surface.
