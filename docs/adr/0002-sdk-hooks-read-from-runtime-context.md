# 0002 — SDK hooks read from `ModuleRuntimeContext`, not from per-component props

- **Status:** Accepted
- **Date:** 2026-05-11
- **Deciders:** EMR architecture
- **Related modules / docs:** [`packages/module-sdk/src/context.ts`](../../packages/module-sdk/src/context.ts), [`packages/module-sdk/src/defineModule.ts`](../../packages/module-sdk/src/defineModule.ts), [`packages/module-sdk/CLAUDE.md`](../../packages/module-sdk/CLAUDE.md), [`packages/contracts/src/lifecycle.ts`](../../packages/contracts/src/lifecycle.ts), [`ARCHITECTURE.md`](../../ARCHITECTURE.md)

## Context

A module needs access to its session, possibly its patient, the services the shell injected, and a sink for module events (e.g. `unsaved-state-changed`). The shell knows all of this at mount time. There are two ways to get it from the shell to the module's render tree:

1. **Props.** `defineModule(manifest, component)` registers a component typed by the manifest's scope; the shell renders `<Component {...moduleProps} />`. Hooks then become helpers that re-pack the props.
2. **Runtime context.** The shell wraps the component in `<ModuleRuntimeContext.Provider value={runtime}>`; hooks read from that context. The component itself takes no props.

The choice has visible consequences for how modules are written, how the SDK's hooks fail when misused, and how much typing burden the manifest author carries.

## Decision

The SDK installs a single `ModuleRuntimeContext` carrying `{ manifest, props, emit }`. The shell constructs the runtime, wraps the component in the provider, and renders the component with no props. Every hook (`useSessionContext`, `usePatientContext`, `useServices`, `useNavigation`, `useUnsavedState`) reads from this context.

A hook that is illegal for the current scope inspects `runtime.manifest.scope` and throws with an error message naming the module and the hook. `usePatientContext` in a session-scoped module is a runtime error; there is no fallback shape.

## Alternatives considered

- **Pass props directly to the component (option 1 above).** This puts the typing burden on the manifest author: `defineModule(manifest, Component)` would have to type-narrow `Component`'s props from the manifest's `scope`. The win — type-checked props at the component boundary — is real, but it (a) couples every module to a generic dance, (b) forces the shell to render every module differently per scope, and (c) leaves no place to enforce scope-mismatch errors at runtime (the type system would catch most, but dynamic registrations would not). It also makes `useUnsavedState` and similar hooks awkward because they need the event sink, which is not "context the module asked for" — it is wiring.
- **Mixed: pass context via props, services via React context.** Splits the source of truth. Authors would need to know which hook reads from where. Worse ergonomics, no compensating clarity.
- **One big global `ShellContext` exposed to modules.** Lets modules reach for anything. Violates the explicit-context-flow rule in `CLAUDE.md`; the SDK becomes a fig leaf rather than a boundary.

## Consequences

- **Modules are concise.** A component body calls the hooks it needs; the surrounding plumbing is invisible. Compare:
  ```tsx
  function HelloPatient() {
    const { patient } = usePatientContext();
    return <h1>{patient.displayName}</h1>;
  }
  ```
  versus the props-based alternative where the author must type the prop shape correctly to even render.
- **The SDK owns the scope-mismatch check.** Calling `usePatientContext` in a session-scoped module throws with a clear error. The shell never needs to know what hook a module called.
- **The shell is the only party that constructs a `ModuleRuntime`.** This is a feature: it keeps the seam single-purpose. The shell mounts the runtime, swaps it on context changes, and tears it down on unmount.
- **Component props are unused.** Linters will not flag this, but new contributors may try to pass props to `defineModule(manifest, Component)`. Documented in `packages/module-sdk/CLAUDE.md`.
- **A future "module sandbox" (e.g. iframe-isolated modules) cannot rely on React context.** It would need a postMessage bridge that reproduces the same hook surface. We accept that constraint; sandboxing is not on the near roadmap.

## Notes

- The decision intentionally pairs with ADR 0001 (manifest discriminated union). Manifest narrowing makes the props-based alternative more attractive than it would be otherwise, but the runtime-context approach still wins on author ergonomics and on having a single place to enforce scope checks.
- Hooks that need data the runtime does not currently carry (e.g. a `useCanClose` registration) will add fields to `ModuleRuntime`. Keep that surface tight; not everything belongs there.
