# @emr/contracts — Rules

## Purpose

The type-only foundation of the system. Every other layer imports from here. Context shapes, the module manifest, the lifecycle interface, the five service interfaces, branded IDs, and module event types live here and only here.

## Hard rules

- **Types only.** No `class`, no `function`, no `const` with a value, no `enum`, no `instanceof`. Every export is a `type` or `interface`. `tsc -b` should emit `.d.ts` files only — no `.js` output. The public barrel uses `export type *` to make that boundary explicit.
- **No internal imports.** This package sits at the bottom of the import graph. It may not import from any `@emr/*` package. External imports are limited to platform types (`AbortSignal`, etc.).
- **No side effects on import.** Automatic if you stick to the rule above; do not break it.

## Conventions

- **Branded IDs.** Every entity ID is a string branded with a unique tag (see `src/ids.ts`). Use the branded type, not raw `string`. Constructors live at the system boundary (in `@emr/services` or the shell), not here.
- **`readonly` everywhere.** Contracts are immutable from a consumer's perspective. Use `readonly` on every property and `readonly T[]` for arrays.
- **Optional fields use `?`, not `T | undefined`.** This package compiles under `exactOptionalPropertyTypes`; the two are different and `?` is what we want for "may be absent."
- **Discriminated unions over flag fields.** Where a field's legality depends on another field, encode the dependency by splitting the type into a discriminated union rather than relying on runtime validation. See `ModuleManifest` for the canonical example: it is a union on `scope`, and the `requires: 'patient'` ⇒ `scope: 'patient'` invariant falls out of the union shape (`NonPatientModuleManifest.requires` excludes `'patient'`, so a manifest that lists patient context cannot match that branch). Documented in `docs/adr/0001-module-manifest-discriminated-union.md`.

## File layout

- `src/ids.ts` — branded ID types.
- `src/contexts.ts` — Workspace/Location/User/Session/Patient/Group shapes.
- `src/manifest.ts` — `ModuleScope`, `ContextRequirement`, `ServiceName`, `ModuleManifest` (discriminated union).
- `src/services.ts` — the five service interfaces and their supporting types.
- `src/lifecycle.ts` — `ModuleServices`, `ModuleProps`, `ModuleLifecycle`, `ModuleEvent`.
- `src/index.ts` — `export type *` from each file. The only public surface.

## What goes here

- New context shapes that the shell hands to modules.
- New service interfaces the shell injects.
- Changes to the module manifest or lifecycle contract.
- Module event types the SDK lets modules emit.

## What does NOT go here

- Helper functions, factories, validators, or anything callable (those live in `@emr/shared` or, for service implementations, `@emr/services`).
- React components or hooks (those live in `@emr/module-sdk` or in modules).
- Runtime constants and enums (use `const` objects in `@emr/shared` if you need named values; `enum` is banned project-wide for this package).
