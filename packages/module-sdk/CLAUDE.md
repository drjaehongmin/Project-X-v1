# @emr/module-sdk — Rules

## Purpose

What a module author imports: `defineModule(manifest, component)` plus the hooks that read context and services. Nothing else. Modules never import services, context state, or shell internals directly — this package is the only seam they touch.

## Hard rules

- **Imports only from `@emr/contracts` and external libs** (`react`, etc.). No `@emr/shared`, no `@emr/services`, no `@emr/shell`. ESLint enforces this.
- **No service implementations live here.** The SDK passes service interfaces from `@emr/contracts` through; concrete implementations are in `@emr/services`.
- **Hooks fail loudly outside their valid scope.** `usePatientContext` in a session-scoped module throws. `useSessionContext` in a global module throws. These are usage errors the SDK refuses to paper over with `undefined` / no-op fallbacks; silently returning the wrong shape would let modules access state they should not.
- **Hooks read from `ModuleRuntimeContext`, not from props passed to the component.** The shell wraps the component in `<ModuleRuntimeContext.Provider>`; the component itself is rendered with no props. See `docs/adr/0002-sdk-hooks-read-from-runtime-context.md`.

## File layout

- `src/defineModule.ts` — `defineModule` + `ModuleDefinition<M>`.
- `src/context.ts` — `ModuleRuntime`, `ModuleRuntimeContext`, internal `useModuleRuntime` helper.
- `src/hooks/useSessionContext.ts` — session getter; throws on global.
- `src/hooks/usePatientContext.ts` — patient + group getter; throws unless scope is `'patient'`.
- `src/hooks/useServices.ts` — services bundle; throws on global.
- `src/hooks/useNavigation.ts` — sugar over `useServices().navigation`.
- `src/hooks/useUnsavedState.ts` — local flag + emits `unsaved-state-changed` on transitions.
- `src/index.ts` — public barrel.
- `test/` — Vitest + `@testing-library/react`; `test/fakes.ts` builds fake props/manifests/runtimes.
- `vitest.config.ts` — `environment: 'jsdom'`, scoped to `test/**/*.test.{ts,tsx}`.

## Conventions

- **Error messages name the offending module and the hook.** `[@emr/module-sdk] usePatientContext is only valid in a patient-scoped module ('hello-inbox' has scope 'session').` Authors should be able to fix the bug from the error alone.
- **`useUnsavedState` emits only on transitions.** Calling the setter with the current value is a no-op.
- **`defineModule` is a pass-through.** Runtime manifest validation is the shell's job, at registration. Putting it here would either duplicate the check or split the source of truth.

## What goes here

- New hooks that wrap `ModuleRuntimeContext` (e.g. `useAudit`, `useCanClose`).
- Type-level helpers tied to `defineModule` (e.g. inferring component prop types from the manifest).
- Test fakes for SDK-internal types.

## What does NOT go here

- Concrete service implementations (`@emr/services`).
- Shared utilities or FHIR helpers (`@emr/shared`).
- The module registry, tab manager, or anything that owns shell state (`@emr/shell`).
- Hooks that need a feature module's internal state — those live in the module.
