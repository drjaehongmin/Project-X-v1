// Vite-injected env typings.  Vite replaces `import.meta.env.<KEY>` at
// build time; this declaration teaches the TypeScript compiler about
// the shape of `import.meta.env` so callers compile under `strict`.
//
// Only `VITE_*`-prefixed variables are exposed by Vite — adding a
// non-VITE key here would compile but never receive a value at runtime.

interface ImportMetaEnv {
  // Backend base URL; when set, the shell talks to the real API. When
  // unset, services.ts falls back to the in-memory fixtures from
  // @emr/services.
  readonly VITE_EMR_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
