# DataService Contract

The frontend's only seam to backend data. Modules call `services.data.{read,search,write,delete}`; the shell injects either the in-memory fixture from `@emr/services` (no backend) or the HTTP-backed implementation from `@emr/data-client` (when `VITE_EMR_API_BASE_URL` is set). Either way, modules see the same interface.

The contract itself lives in `@emr/contracts/services.ts`. This doc covers the **conventions** for using it — the parts that aren't expressible in TypeScript.

## Interface

```ts
interface DataService {
  read<T = unknown>(resourceType: string, id: string, options?: DataReadOptions): Promise<T | null>;
  search<T = unknown>(resourceType: string, options?: DataSearchOptions): Promise<readonly T[]>;
  write<T = unknown>(resourceType: string, resource: T): Promise<T>;
  delete(resourceType: string, id: string): Promise<void>;
}
```

`T` is `unknown` at the contract level — narrowing is the caller's responsibility. The wire shapes are owned by the backend resource's view (`packages/backend/src/resources/<name>/views.ts`); export TypeScript types from `@emr/data-client` mirror them.

## URL routing (`RESOURCE_PATHS`)

`@emr/data-client`'s `RESOURCE_PATHS` map keys a resource type string to a URL base. Today:

| Resource type | URL base | Backed by |
|---|---|---|
| `Patient`   | `/patients`    | `resources/patients/` |
| `Encounter` | `/encounters`  | `resources/encounters/` |
| `Problem`   | `/problems`    | `resources/problems/` |
| `Allergy`   | `/allergies`   | `resources/allergies/` |
| `User`      | `/users`       | `resources/iam/` |
| `Role`      | `/roles`       | `resources/iam/` |
| `UserRole`  | `/user-roles`  | `resources/iam/` |

Adding a new resource means one new entry here plus the backend routes. All four `DataService` methods share the map; there's no per-resource branching in the data-client.

Unknown resource types: `read()` and `search()` return `null` / `[]`; `write()` throws `Error('Unsupported resource type for write: ...')`; `delete()` is a no-op (the surface isn't wired yet).

## `read(resourceType, id, options?)`

Returns the resource's **summary view** by default. URL: `GET /<base>/:id?view=summary`.

- **404 (incl. RLS-filtered) → resolves to `null`.** The backend returns 404 for both genuinely-missing rows and rows the caller's RLS context filters out — by design, so existence isn't leaked. Don't try to distinguish them client-side.
- **Other HTTP errors throw `HttpError`** (`@emr/data-client`), with `.status`, `.code`, `.message`, `.details`. Callers can branch on `err.status`.
- **`options.signal`** propagates through to `fetch`. Pass an `AbortSignal` to cancel on unmount.

Caller pattern:

```ts
const summary = await services.data.read<PatientSummary>('Patient', id, { signal });
if (summary === null) {
  // Surface "not found" / "no access" — same UX state.
}
```

## `search(resourceType, options?)`

URL: `GET /<base>?<params>` with `view=summary` always added.

- **All string and finite-number `options.params` pass through to the URL.** No required-field validation client-side. If the backend needs `patientId` (clinical resources do) it returns 400 when missing; the data-client doesn't pre-filter.
- **Returns `readonly T[]`** in whatever order the backend chose (newest-first for encounters, severity-ordered for allergies, alphabetical for roles, etc.). The view documentation tells you the ordering contract.
- **`options.signal`** as above.

Caller pattern:

```ts
const rows = await services.data.search<EncounterSummary>('Encounter', {
  params: { patientId, status: 'completed' },
  signal,
});
```

## `write(resourceType, resource)`

The most subtle method. **Dispatch is by `resource.id` presence**:

- **`id` is a non-empty string** → `PATCH /<base>/:id` with the body (the `id` field is stripped before sending — it's in the URL).
- **`id` is absent or empty** → `POST /<base>` with the full body.

So the same call shape covers both create and update:

```ts
// Create — no id
const created = (await services.data.write('Allergy', {
  patientId,
  allergen: 'Penicillin',
  allergenType: 'drug',
  severity: 'moderate',
})) as unknown as AllergySummary;

// Update — id present, only the fields you want to change
const updated = (await services.data.write('Allergy', {
  id: existingId,
  status: 'resolved',
})) as unknown as AllergySummary;
```

### The `as unknown as <T>` cast

The contract is `write<T>(resourceType, resource: T): Promise<T>` — `T` is both input and output. That's wrong for our use:

- For create, input is a subset of the response (no `id`, no timestamps).
- For PATCH, input is just the changed fields.
- The response in both cases is the full resource summary.

Two clean options at the call site:

1. **Cast via `unknown`** (chosen pattern):
   ```ts
   const row = (await services.data.write('Foo', input)) as unknown as FooSummary;
   ```
2. **Two type parameters** would require widening the contract — not currently done because it'd break every existing caller.

The cast is documented at every call site with a comment like *"DataService.write's `T` is both input and output; widen via unknown."* Don't sneak in a non-`as unknown as` cast — strict-mode TS will reject it.

### Body validation is the backend's job

The data-client doesn't validate the resource body. The backend's zod schema does. A missing required field surfaces as a 400 `HttpError`; an RLS-policy violation surfaces as a different status (varies by route — `INSERT`-with-failing-WITH-CHECK in Postgres surfaces as 500-class).

## `delete(resourceType, id)`

No-op in the current data-client. The canonical deletion pattern for clinical resources is a soft delete via `PATCH` (e.g. `status: 'resolved'` or `status: 'inactive'`) rather than a row removal.

If hard delete becomes needed for a resource, add a `DELETE /<base>/:id` route on the backend and a real implementation here.

## `AbortSignal` conventions

Always tie network calls to a `useEffect`-scoped `AbortController`. The data-client passes the signal to `fetch`; an aborted call rejects with a `DOMException` of name `AbortError`.

```ts
useEffect(() => {
  const controller = new AbortController();
  void services.data
    .read<Foo>('Foo', id, { signal: controller.signal })
    .then((row) => {
      if (controller.signal.aborted) return; // Defensive — avoid setState after unmount.
      // ...
    })
    .catch((err) => {
      if (controller.signal.aborted) return;
      // Surface error.
    });
  return () => controller.abort();
}, [id, services.data]);
```

The `if (signal.aborted) return` guards inside `.then` / `.catch` are belt-and-braces — `fetch` already rejects the promise on abort, but the data-client's await chain still runs `.then` if the body was already received when abort fired.

## Refresh-on-401 (one-shot)

When a request comes back 401, the data-client's `HttpClient` calls `tokenStore.refresh()` once and retries the original request with the new access token. A second 401 (refresh failed, or the new token also rejected) surfaces as an `HttpError` to the caller. Modules don't manage this — it happens at the transport layer.

## `X-Module-Id` header

Every request carries `X-Module-Id: <module id>` so the backend's audit writer can attribute the call. The header comes from the `ModuleHost`'s wired services bundle — you don't set it.

## In-memory fixture mode

When `VITE_EMR_API_BASE_URL` is unset, the shell injects `@emr/services`' `createDataService()` instead. Behavior:

- `read('Patient', id)` returns one of two hardcoded `samplePatients` if `id` matches, else `null`. All other resources return `null`.
- `search(...)` returns `[]` for everything.
- `write(...)` echoes the input. **No persistence.** Useful for component-level UI smoke-testing without a backend; useless for verifying the resource round-trip.
- `delete(...)` is a no-op.

A module written against the contract works in both modes — fixture mode just renders empty states and pretends writes succeeded.

## Adding a new resource type

1. Land the backend resource per `docs/runbooks/add-resource.md`.
2. Add an entry to `RESOURCE_PATHS` in `packages/data-client/src/data-service.ts`.
3. Export a TypeScript type mirror of the resource's summary view from `@emr/data-client`.
4. Modules can now `read` / `search` / `write` / `delete` against the new resource without touching the data-client further.
