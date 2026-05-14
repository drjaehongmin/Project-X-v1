# 0001 — Encode the manifest scope/requires invariant via a discriminated union

- **Status:** Accepted
- **Date:** 2026-05-11
- **Deciders:** EMR architecture
- **Related modules / docs:** [`packages/contracts/src/manifest.ts`](../../packages/contracts/src/manifest.ts), [`packages/contracts/CLAUDE.md`](../../packages/contracts/CLAUDE.md), [`ARCHITECTURE.md`](../../ARCHITECTURE.md)

## Context

Every module ships a manifest with a `scope` (`global | session | general | patient`) and a `requires` list of context objects it expects the shell to inject (currently `'session' | 'patient'`). The architecture rule from `CLAUDE.md` is:

> A module that lists `'patient'` in `requires` must declare `scope: 'patient'`.

That invariant has to hold somewhere. The options are (a) trust authors to get it right, (b) enforce at runtime when the shell validates the manifest at registration, or (c) enforce in the type system so a wrong manifest fails to compile.

The manifest is the contract that gates module loading and permission checks. A mismatched scope/requires is the kind of error that does not surface until a user clicks the wrong button — exactly the case where compile-time enforcement pays off.

## Decision

`ModuleManifest` is a discriminated union on `scope`:

```ts
type ModuleManifest = NonPatientModuleManifest | PatientModuleManifest;

interface NonPatientModuleManifest extends ModuleManifestBase {
  readonly scope: Exclude<ModuleScope, 'patient'>;
  readonly requires: readonly Exclude<ContextRequirement, 'patient'>[];
}

interface PatientModuleManifest extends ModuleManifestBase {
  readonly scope: 'patient';
  readonly requires: readonly ContextRequirement[];
}
```

The `NonPatientModuleManifest.requires` element type excludes `'patient'`, so any literal that puts `'patient'` in `requires` cannot satisfy that branch and is forced into the `'patient'` branch — which fixes `scope` to `'patient'`. The invariant is now a property of the type, not a property of a runtime check or a code-review habit.

## Alternatives considered

- **Runtime validation only.** The shell would `throw` on registration when scope and requires disagree. Loses compile-time feedback; mistakes only surface when modules try to launch. Also forces every consumer (the SDK's `defineModule`, the registry, tests) to either repeat the check or trust it has run.
- **Single non-discriminated `ModuleManifest` with a `requires: ContextRequirement[]` field, plus a separate type-level helper that asserts the constraint.** Adds a layer of indirection and pushes the assertion off the manifest itself. The discriminated union is the manifest, not an annotation on it.
- **Drop `requires` and derive it from `scope`.** Cleanest until a future scope needs more context objects than `scope` alone implies. We expect future requirements (e.g. encounter context) that are orthogonal to scope; keeping `requires` explicit gives us the seam without another breaking change.

## Consequences

- Authors who try to write a patient manifest with `scope: 'session'` get a TypeScript error on the manifest literal itself, with a message naming the offending field.
- `defineModule(manifest, component)` (lands in Step 3) can use the same union for parameter typing, so the component's props type narrows automatically based on the manifest's `scope`.
- Future context requirements added to `ContextRequirement` need to be classified: do they imply a specific scope (and thus belong only in the patient branch), or are they scope-orthogonal (and belong in `ModuleManifestBase` or both branches)? Without that classification step, the constraint is not actually being maintained.
- The shell still validates manifests at registration — but the validation is now about runtime concerns (unique IDs, advertised services exist, version is parsable), not about the scope/requires invariant.

## Notes

If `ContextRequirement` grows enough that more invariants emerge (e.g. some future requirement implies a non-patient scope), the union may need to split further. Add a new branch rather than weakening the existing ones — never collapse the union back to a single interface to "make adding things easier."
