# Module Documentation

Per-module documentation lives in this directory. Each module gets its own file describing its purpose, public surface, dependencies, and the decisions behind its shape. For the catalog of modules currently registered with the shell, see [`../module-catalog.md`](../module-catalog.md).

## Convention

- **File name:** `<module-id>.md`, matching the module's `id` field in its manifest (kebab-case). For example, the `hello-inbox` module is documented in `docs/modules/hello-inbox.md`.
- **One module, one file.** Do not bundle modules. Cross-references go through links, not co-location.
- **Update in the same change as the code.** A change that alters a module's API, manifest, scope, dependencies, or behavior must update the module's doc in the same commit/PR. See `CLAUDE.md` → "Documentation Maintenance — Required".

## Required sections

Every module doc should contain:

1. **Purpose** — One paragraph: what this module does and why it exists. If you cannot say why it exists, the module is probably premature.
2. **Manifest summary** — `id`, `displayName`, `scope`, `requires`, `services`, `permissions`, `version`. Keep in sync with the code manifest; the manifest is the source of truth.
3. **Public API** — What the module's `src/index.ts` exports. For most modules this is just the registered module definition; record any additional exports here.
4. **Dependencies** — Internal packages used (`@emr/contracts`, `@emr/module-sdk`, `@emr/shared`) and any external libraries with notable footprint. Sibling-module imports are forbidden — if listed here, it is a bug.
5. **Key decisions** — Short notes on choices that future maintainers would otherwise have to re-derive. Link to ADRs in `docs/adr/` for decisions that affect architecture.
6. **Open questions / known limitations** — Things the next contributor should know before changing the module.

## Template

```markdown
# <module-id>

## Purpose
<one paragraph>

## Manifest summary
- **id:** `<module-id>`
- **displayName:** `<Display Name>`
- **scope:** `global | session | general | patient`
- **requires:** `[...]`
- **services:** `[...]`
- **permissions:** `[...]`
- **version:** `0.1.0`

## Public API
- `default` export: registered module definition from `defineModule(...)`.

## Dependencies
- `@emr/contracts`
- `@emr/module-sdk`
- (others as needed)

## Key decisions
- (link to ADRs where relevant)

## Open questions / known limitations
- (or "None" — be explicit)
```

## Scope reminder

- `global` — shell-provided; not user-launchable.
- `session` — needs `SessionContext` only.
- `general` — session-scoped, patient-independent.
- `patient` — runs inside a patient context group; receives patient via props.

A module's scope determines which hooks are legal. Calling `usePatientContext` from a `session`-scoped module is a runtime error by design (see `@emr/module-sdk`).
