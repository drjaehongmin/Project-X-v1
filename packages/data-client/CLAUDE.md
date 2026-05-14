# @emr/data-client — Rules

## Purpose

HTTP client for the backend on the controller-assigned port 5210. Exposes a `DataService` implementation conforming to `@emr/contracts` so the shell can swap the in-memory stub from `@emr/services` for real network-backed reads without modules noticing.

## Hard rules

- **Imports only from `@emr/contracts` and external libs.** No `@emr/services`, no `@emr/shell`. ESLint enforces it.
- **No DOM-specific code beyond `fetch`/`AbortSignal`/`URLSearchParams`.** Runs in browser and Node 20+; everything is available globally.
- **The DataService implementation never persists or caches.** It is a thin pass-through over HTTP. Caching is a future, opt-in decorator.
- **Refresh-on-401 happens once.** A second 401 in the same call surfaces the error. The `TokenStore` is the seam — the shell decides how to persist tokens.

## File layout

- `src/fetch.ts` — `createHttpClient`, `HttpError`, `TokenStore`. Bearer header, JSON encoding, refresh-on-401, `X-Module-Id` propagation.
- `src/auth.ts` — `createAuthClient`. Wraps `/auth/login`, `/auth/refresh`, `/auth/logout`, `/me/session`.
- `src/data-service.ts` — `createHttpDataService`. Implements `DataService` from `@emr/contracts`.
- `src/index.ts` — barrel.

## Conventions

- **Factories, not classes** (matches `@emr/services`).
- **One resource per file** when the surface grows; for Phase 2A the patient read fits in `data-service.ts`.
- **Errors are typed.** Backend error envelopes (`{ error: { code, message, details } }`) deserialize into `HttpError`. Callers can branch on `err.code`/`err.status`.

## What goes here

- HTTP-backed implementations of `@emr/contracts` service interfaces.
- Typed wrappers around per-resource endpoints as they land.

## What does NOT go here

- The `DataService` interface itself (it lives in `@emr/contracts`).
- React hooks (live in `@emr/module-sdk`).
- Backend code or shared SQL types.
