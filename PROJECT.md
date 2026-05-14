# Cruise Ship EMR

## Purpose

A modular electronic medical record system designed for cruise ship medical operations and adjacent care settings (clinic, case management, clinical operations, admin). The system is built as a shell hosting independent modules so that clinical features can evolve without destabilizing the core, and so that workspace types (clinic vs. case management vs. ops) can compose different module sets from the same base.

The architectural priorities — strict module isolation, explicit context flow, injected services, auditable access — are not stylistic preferences. They exist because the system handles patient health information in a setting where multiple patients may be open concurrently, providers rotate frequently, and connectivity is intermittent. Mixing patient contexts or losing audit fidelity has real clinical and regulatory consequences.

## Success Criteria

The scaffolding phase is successful when:

- The repo compiles, lints, type-checks, and tests cleanly under pnpm.
- The shell boots to a fake login, establishes a `SessionContext`, and renders the chrome (top bar, left nav, tab bar, audit panel).
- The four-layer architecture (`contracts`, `module-sdk`, `services`, `shell`) is enforced by ESLint such that an illegal import fails the build.
- At least one registered module launches through the registry, receives context and services via props, and exercises the module → SDK → service contract end-to-end. (Today: `patient-create`, which writes to the live backend.)
- `NavigationService` is the sole path for opening tabs and creating patient groups; no module reaches out of its scope.
- A `pnpm new-module` generator scaffolds a working module from the template.
- Every doc listed under "Documentation Maintenance" in `CLAUDE.md` exists and is current.

Beyond scaffolding, broader success will be measured by whether real clinical modules can be added without modifying the shell, without weakening type contracts, and without bypassing services.

## Current Status

**Foundation in place; demo modules removed.** The repo compiles, lints, typechecks, and tests cleanly under pnpm. The shell runs on Vite (`PORT=5209 pnpm dev`), boots into login, and renders the labelled chrome. The four-layer architecture is ESLint-enforced. `NavigationService` is the sole path for opening tabs and creating patient groups. `pnpm new-module` scaffolds new modules from the template.

The backend on `:5210` is live: Fastify + Kysely + Postgres 16, JWT auth, RLS-context plumbing, append-only audit log, view-projection, and four resource surfaces (patients, encounters, problems, allergies) covering read + write where applicable. The shell's `DataService` switches to the real HTTP-backed implementation from `@emr/data-client` when `VITE_EMR_API_BASE_URL` is set.

The only registered module today is `patient-create` — a general-scope form that creates a patient via `POST /patients`, with the caller auto-added to the care team in the same transaction. From here, the next module added is the first real clinical surface.

See `CURRENT.md` for active workstreams and `CHANGELOG.md` for recent changes. See `docs/architecture.md` for a runtime walkthrough and `docs/module-catalog.md` for the registered-modules inventory.
