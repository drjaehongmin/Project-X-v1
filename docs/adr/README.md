# Architectural Decision Records

Architectural Decision Records (ADRs) capture choices that shape the architecture: trade-offs considered, the option taken, and the consequences. They exist so that six months from now, a contributor can answer "why is it this way?" without spelunking through git history or guessing.

## When to write one

Write an ADR when a decision:

- Changes how layers, modules, or services relate to each other.
- Adds, removes, or replaces a cross-cutting dependency (state library, routing, validation, audit transport, etc.).
- Locks in a contract that other code will rely on (manifest shape, lifecycle hooks, permission model).
- Has plausible alternatives that a future contributor might otherwise re-litigate.

Do not write an ADR for minor refactors, local style choices, or decisions confined to a single module's internals. Those belong in the module's doc, in code comments where genuinely non-obvious, or nowhere at all.

## Convention

- **File name:** `NNNN-short-kebab-title.md`, where `NNNN` is a zero-padded sequence number (`0001`, `0002`, …). Numbers are never reused; superseded ADRs stay in place and are marked superseded.
- **One decision per ADR.** If you find yourself writing about two decisions, split them.
- **Status lifecycle:** `Proposed` → `Accepted` → optionally `Superseded by NNNN` or `Deprecated`. Do not silently rewrite an accepted ADR — supersede it with a new one and link both directions.
- **Cross-link.** Link the ADR from the relevant module doc (`docs/modules/<module>.md`) and from `ARCHITECTURE.md` if the decision is system-wide.

## Template

Use `adr-template.md` as the starting point for each new ADR. Copy it to `NNNN-<title>.md` and fill in the sections.

## Index

- [0001 — Encode the manifest scope/requires invariant via a discriminated union](0001-module-manifest-discriminated-union.md) — Accepted, 2026-05-11.
- [0002 — SDK hooks read from `ModuleRuntimeContext`, not from per-component props](0002-sdk-hooks-read-from-runtime-context.md) — Accepted, 2026-05-11.
- [0003 — Services own their own state where possible, delegate to shell-supplied stores where not](0003-services-delegate-to-shell-stores.md) — Accepted, 2026-05-11.
- [0004 — Backend stack: Fastify + Kysely + Postgres with database-enforced RLS](0004-backend-stack-fastify-postgres.md) — Accepted, 2026-05-12.
- [0005 — Strengthen `app_is_facility_staff` to support cross-facility workspaces](0005-strengthen-facility-staff-predicate.md) — Accepted, 2026-05-12.
