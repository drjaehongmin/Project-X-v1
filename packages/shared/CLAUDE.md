# @emr/shared — Rules

## Purpose

Cross-cutting utilities that more than one layer needs but that do not belong in `@emr/contracts` (because they have runtime code) or in any single feature module (because two would otherwise duplicate them). Today: FHIR type stubs and permission helpers. Future: date/time helpers, formatting, anything that several modules or services would otherwise reinvent.

## Hard rules

- **Imports only from `@emr/contracts` and external libs.** No `@emr/services`, no `@emr/module-sdk`, no `@emr/shell`. ESLint enforces this.
- **No React.** This package is consumable by services (which run in Node-like contexts) and by modules (which run in the browser). React is a UI concern; if a helper needs hooks, it belongs in `@emr/module-sdk` or in the module itself.
- **No global state.** Helpers should be pure functions or thin builders. Stateful subsystems live in `@emr/services` (audit store, fixtures) or in `@emr/shell` (session, tabs, groups).

## File layout

- `src/fhir.ts` — minimal FHIR R4-shaped types (`FhirResource`, `Patient`, `Practitioner`, `Encounter`, `Observation`, `HumanName`, `Reference`). Each carries the FHIR-standard `resourceType` discriminator. Narrow on purpose; widen as real modules need fields.
- `src/permissions.ts` — `computeEffectivePermissions(inputs)` (stub: returns `['*']`) and `permits(granted, action, resource)` (wildcard-aware predicate).
- `src/index.ts` — barrel; explicit type vs. value exports.

## Conventions

- **`readonly` everywhere on shared types.** Mirrors `@emr/contracts`. Mutability is opt-in, not default.
- **Resource types are discriminated unions on `resourceType`.** Future FHIR resources should extend `FhirResource` and pin their literal `resourceType`. This lets the data service narrow on read.
- **Helpers are pure.** No side effects, no globals, no IO. Tests are trivial; consumers are easy to reason about.

## What goes here

- New FHIR resource shapes that more than one module references.
- Permission/policy primitives that the PermissionService and modules both need to call.
- Date/time, formatting, and other cross-cutting utilities — once a real second consumer needs them. Premature additions stay in the consumer until duplication appears.

## What does NOT go here

- Service implementations (those live in `@emr/services`).
- React components, hooks, or anything that imports React.
- Module-specific helpers used by only one module — keep them in that module's `src/`.
- Anything stateful — even an "in-memory cache." Cache state belongs in services or the shell.
