// The single seam through which authenticated DB work happens.
//
// Every authenticated handler wraps its queries in `withRlsContext`,
// which opens a transaction, runs `SET LOCAL app.user_id = ...` (and
// friends) so the RLS predicates in 0002–0006 evaluate against the
// caller, and tears the transaction down at the end.  Forgetting the
// wrap means RLS predicates see unset settings and fail closed — the
// query returns zero rows.

import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';

import type { Database } from './types.js';

export interface RlsContext {
  readonly userId: string;
  readonly facilityId: string | null;
  readonly roles: readonly string[];
  // Set true only when the caller is operating under an active
  // break_glass_events row written earlier in the same flow.
  readonly breakGlass: boolean;
}

// Postgres rejects identifiers / values containing arbitrary text via
// SET LOCAL, so we restrict roles to a safe character class before
// joining them.  This is a defensive belt — the JWT layer should never
// hand a malformed role in the first place.
const SAFE_ROLE = /^[a-z0-9_-]+$/i;

function safeRoles(roles: readonly string[]): string {
  return roles.filter((r) => SAFE_ROLE.test(r)).join(',');
}

export async function withRlsContext<T>(
  db: Kysely<Database>,
  ctx: RlsContext,
  fn: (tx: Transaction<Database>) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(async (tx) => {
    await sql`SELECT
      set_config('app.user_id', ${ctx.userId}, TRUE),
      set_config('app.facility_id', ${ctx.facilityId ?? ''}, TRUE),
      set_config('app.roles', ${safeRoles(ctx.roles)}, TRUE),
      set_config('app.break_glass', ${ctx.breakGlass ? '1' : '0'}, TRUE)
    `.execute(tx);
    return fn(tx);
  });
}

// Used for endpoints that must run without an authenticated user
// (e.g. /auth/login looking up a user by email).  Bypasses RLS by
// running as the table owner — never expose its results directly.
export async function withSystemContext<T>(
  db: Kysely<Database>,
  fn: (db: Kysely<Database>) => Promise<T>,
): Promise<T> {
  // The pool user is the table owner in dev; RLS is bypassed for owners
  // by default.  In production this should run as a separate
  // SECURITY DEFINER function or a privileged role — out of scope for
  // Phase 2A.
  return fn(db);
}
