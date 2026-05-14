# @emr/module-template — Rules

## Purpose

The starter module. Two jobs:

1. **Seed.** `pnpm new-module <name>` (Step 7) will copy this package, rename it, rewrite the manifest, and register it in the shell. Every new feature module begins here.
2. **Smoke test for the loader.** The shell registers this module so the registry → loader → `ModuleRuntime` → component pipeline has something concrete to mount during development.

## Hard rules

- **Imports only from `@emr/contracts`, `@emr/module-sdk`, `@emr/shared`, and external libs.** No `@emr/services`, no `@emr/shell`. ESLint enforces this.
- **No imports from sibling modules.** Boundaries plugin enforces same-module-only imports for `modules/*` via the captured `name` pattern.
- **Single public entry: `src/index.ts`.** It exports the `ModuleDefinition` returned by `defineModule(manifest, Component)`. The component lives next to it in `src/Component.tsx`. Anything else added to this module (helpers, fixtures, sub-components) stays under `src/` and is private to the module.
- **No clinical features.** This is a template; production modules carry the clinical logic.

## File layout

- `src/index.ts` — manifest + `defineModule(...)`. The default export is the same `ModuleDefinition`. The shell imports from this file (and only this file) via the package name.
- `src/Component.tsx` — the React component. Reads context via SDK hooks; no props. Reads the SessionContext through `useSessionContext`.

## Conventions

- **Manifest scope defaults to `'general'`.** A session-scoped module would be equally valid; a `'patient'`-scoped module would also switch `requires` to include `'patient'` (the discriminated-union type system in `@emr/contracts` enforces that pairing).
- **Component takes no props.** The shell wraps the rendered component in `<ModuleRuntimeContext.Provider>`; everything arrives via hooks. Adding props would mean the shell needs to know how to populate them, which breaks the registry's uniform mount pipeline.
- **The component renders inside `.module-card`.** The shell's `module-content` area provides the padded background; the module should provide its own card to sit on. Demo modules in Step 8 follow the same pattern.

## What goes here when copied

When `pnpm new-module <name>` copies this template, the script will:

- Rename `package.json#name` to `@emr/module-<name>`.
- Rewrite the manifest `id` and `displayName`.
- Optionally change `scope` and `requires` based on the `--scope` flag.
- Register the new module in `packages/shell/src/modules/registered.ts`.

What it will not do automatically:

- Adjust `services` and `permissions`. Authors do that themselves once they know what the module actually needs.
- Add component logic. Authors replace `TemplateView`'s body.
