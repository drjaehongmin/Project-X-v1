// Helpers for the "only what the frontend asked for" guarantee.
//
// A view declares the maximum set of fields a response may contain.
// The route handler builds an object with those fields; an optional
// `_elements` query parameter further narrows the result to a subset.
// Anything not in the view is silently dropped; anything not in
// `_elements` is filtered out before serialization.

// Any object — view rows are typed with explicit keys (no index sig)
// so `Record<string, unknown>` would reject them under
// `exactOptionalPropertyTypes`.  `object` accepts them and the helper
// casts internally to read by string key.
export type ViewShape = object;

export interface ProjectionOptions {
  // Allow-list of field names defined by the view.  Anything outside
  // this list is dropped, even if `_elements` requested it.
  readonly allowed: readonly string[];
  // Optional caller-supplied subset.  When provided, the result is the
  // intersection of `allowed` ∩ `elements`.  When omitted, all
  // `allowed` fields are returned.
  readonly elements?: readonly string[];
}

export function projectView<T extends ViewShape>(
  row: T,
  options: ProjectionOptions,
): Partial<T> {
  const allowedSet = new Set(options.allowed);
  const requestedSet =
    options.elements === undefined
      ? allowedSet
      : new Set(options.elements.filter((f) => allowedSet.has(f)));

  const source = row as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of requestedSet) {
    if (key in source) {
      result[key] = source[key];
    }
  }
  return result as Partial<T>;
}

// Parses a CSV-style `_elements` query value into a string array.
// Trims whitespace, filters empty entries, dedupes.  Returns null when
// the input is missing or empty (caller should treat as "all fields").
export function parseElements(raw: unknown): readonly string[] | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (trimmed !== '') seen.add(trimmed);
  }
  return seen.size === 0 ? null : Array.from(seen);
}
