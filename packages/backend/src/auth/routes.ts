// Auth endpoints: /auth/login, /auth/refresh, /auth/logout, /me/session.
// /auth/break-glass is in-scope for Phase 2A but stays a stub until
// the patient endpoint exists to demonstrate the elevation in context.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import { z } from 'zod';

import type { BackendConfig } from '../config.js';
import type { Database } from '../db/types.js';
import { withSystemContext, withRlsContext } from '../db/rls.js';
import {
  UnauthorizedError,
  ValidationError,
} from '../lib/errors.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
} from './jwt.js';
import { verifyPassword } from './password.js';

interface AuthRoutesDeps {
  readonly config: BackendConfig;
  readonly db: Kysely<Database>;
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  facilityId: z.string().uuid().nullable().optional(),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ValidationError('Invalid request body', {
      issues: result.error.issues,
    });
  }
  return result.data;
}

export function registerAuthRoutes(
  app: FastifyInstance,
  deps: AuthRoutesDeps,
): void {
  // -------- POST /auth/login -----------------------------------------
  app.post('/auth/login', async (req) => {
    const { email, password, facilityId } = parse(loginSchema, req.body);

    const result = await withSystemContext(deps.db, async (db) => {
      const user = await db
        .selectFrom('users')
        .select(['id', 'password_hash', 'is_active', 'first_name', 'surname'])
        .where('email', '=', email)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (user === undefined || user.password_hash === null) return null;
      if (!user.is_active) return null;

      const passwordOk = await verifyPassword(password, user.password_hash);
      if (!passwordOk) return null;

      // Compute the role set for this session.  Two cases:
      //   - facilityId supplied: narrow to global roles + roles at the
      //     requested facility.  Used by clients that want to scope the
      //     session to a single ship/clinic.
      //   - facilityId omitted: return the user's complete role set
      //     across every facility.  Required for case-management /
      //     clinical-operations users (one login covers many ships).
      //     The strengthened `app_is_facility_staff` predicate (ADR
      //     0005, migration 0007) makes a session with `fid=null`
      //     usable across every facility the user has access to.
      const roleRows = await db
        .selectFrom('user_roles')
        .innerJoin('roles', 'roles.id', 'user_roles.role_id')
        .select(['roles.name as name', 'user_roles.facility_id as facility_id'])
        .where('user_roles.user_id', '=', user.id)
        .execute();

      const fid = facilityId ?? null;
      const filtered =
        fid === null
          ? roleRows
          : roleRows.filter(
              (r) => r.facility_id === null || r.facility_id === fid,
            );
      const roles = Array.from(new Set(filtered.map((r) => r.name)));

      return { user, roles, fid };
    });

    if (result === null) {
      throw new UnauthorizedError('Invalid credentials');
    }

    const { user, roles, fid } = result;

    // Issue refresh token + session row (under the user's RLS context
    // so policy fires; the user-owned policy allows the insert).
    const refresh = generateRefreshToken();
    const expiresAt = new Date(
      Date.now() + deps.config.jwtRefreshTtlSeconds * 1_000,
    );

    const session = await withRlsContext(
      deps.db,
      {
        userId: user.id,
        facilityId: fid,
        roles,
        breakGlass: false,
      },
      async (tx) =>
        tx
          .insertInto('sessions')
          .values({
            user_id: user.id,
            token_hash: refresh.hash,
            ip_address: requestIp(req),
            user_agent: req.headers['user-agent'] ?? null,
            expires_at: expiresAt,
          })
          .returning('id')
          .executeTakeFirstOrThrow(),
    );

    // Update last_login_at outside the RLS-scoped tx to avoid wrapping
    // a second statement; the user's own policy permits this UPDATE.
    await withRlsContext(
      deps.db,
      { userId: user.id, facilityId: fid, roles, breakGlass: false },
      async (tx) => {
        await tx
          .updateTable('users')
          .set({ last_login_at: new Date(), updated_at: new Date() })
          .where('id', '=', user.id)
          .execute();
      },
    );

    const accessToken = await signAccessToken(deps.config, {
      sub: user.id,
      sid: session.id,
      fid,
      roles,
    });

    return {
      accessToken,
      refreshToken: refresh.raw,
      sessionId: session.id,
      expiresIn: deps.config.jwtAccessTtlSeconds,
      user: {
        id: user.id,
        displayName: [user.first_name, user.surname].filter(Boolean).join(' '),
        roles,
      },
    };
  });

  // -------- POST /auth/refresh ---------------------------------------
  app.post('/auth/refresh', async (req) => {
    const { refreshToken } = parse(refreshSchema, req.body);
    const hash = hashRefreshToken(refreshToken);

    const session = await withSystemContext(deps.db, async (db) =>
      db
        .selectFrom('sessions')
        .innerJoin('users', 'users.id', 'sessions.user_id')
        .select([
          'sessions.id as session_id',
          'sessions.user_id as user_id',
          'sessions.expires_at as expires_at',
          'sessions.revoked_at as revoked_at',
          'users.is_active as is_active',
        ])
        .where('sessions.token_hash', '=', hash)
        .executeTakeFirst(),
    );

    if (
      session === undefined ||
      session.revoked_at !== null ||
      session.expires_at <= new Date() ||
      !session.is_active
    ) {
      throw new UnauthorizedError('Invalid or expired refresh token');
    }

    // Compute roles fresh — they may have changed since issuance.
    const roleRows = await withSystemContext(deps.db, async (db) =>
      db
        .selectFrom('user_roles')
        .innerJoin('roles', 'roles.id', 'user_roles.role_id')
        .select(['roles.name as name', 'user_roles.facility_id as facility_id'])
        .where('user_roles.user_id', '=', session.user_id)
        .execute(),
    );

    // Same shape as /auth/login with no facilityId — return the full
    // role set so the refreshed session keeps cross-facility access.
    const roles = Array.from(new Set(roleRows.map((r) => r.name)));
    const fid: string | null = null;

    // Rotate: revoke old, issue new.
    const next = generateRefreshToken();
    const nextExpiresAt = new Date(
      Date.now() + deps.config.jwtRefreshTtlSeconds * 1_000,
    );

    const newSession = await withRlsContext(
      deps.db,
      {
        userId: session.user_id,
        facilityId: fid,
        roles,
        breakGlass: false,
      },
      async (tx) => {
        await tx
          .updateTable('sessions')
          .set({ revoked_at: new Date(), updated_at: new Date() })
          .where('id', '=', session.session_id)
          .execute();
        return tx
          .insertInto('sessions')
          .values({
            user_id: session.user_id,
            token_hash: next.hash,
            expires_at: nextExpiresAt,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
      },
    );

    const accessToken = await signAccessToken(deps.config, {
      sub: session.user_id,
      sid: newSession.id,
      fid,
      roles,
    });

    return {
      accessToken,
      refreshToken: next.raw,
      sessionId: newSession.id,
      expiresIn: deps.config.jwtAccessTtlSeconds,
    };
  });

  // -------- POST /auth/logout ----------------------------------------
  app.post(
    '/auth/logout',
    { preHandler: [app.requireAuth] },
    async (req) => {
      const auth = req.auth!;
      await withRlsContext(
        deps.db,
        {
          userId: auth.userId,
          facilityId: auth.facilityId,
          roles: auth.roles,
          breakGlass: false,
        },
        async (tx) => {
          await tx
            .updateTable('sessions')
            .set({ revoked_at: new Date(), updated_at: new Date() })
            .where('id', '=', auth.sessionId)
            .execute();
        },
      );
      return { ok: true };
    },
  );

  // -------- GET /me/session ------------------------------------------
  // Returns the SessionContext-shaped payload the frontend uses to
  // build its in-memory session.  Shape mirrors @emr/contracts'
  // SessionContext (with one nested location shape).
  app.get(
    '/me/session',
    { preHandler: [app.requireAuth] },
    async (req) => {
      const auth = req.auth!;

      return withRlsContext(
        deps.db,
        {
          userId: auth.userId,
          facilityId: auth.facilityId,
          roles: auth.roles,
          breakGlass: false,
        },
        async (tx) => {
          const user = await tx
            .selectFrom('users')
            .select(['id', 'first_name', 'surname'])
            .where('id', '=', auth.userId)
            .executeTakeFirstOrThrow();

          let location: {
            id: string;
            kind: 'vessel' | 'clinic';
            displayName: string;
          } | null = null;
          if (auth.facilityId !== null) {
            const facility = await tx
              .selectFrom('facilities')
              .select(['id', 'name', 'facility_type'])
              .where('id', '=', auth.facilityId)
              .executeTakeFirst();
            if (facility !== undefined) {
              location = {
                id: facility.id,
                kind: facility.facility_type === 'vessel' ? 'vessel' : 'clinic',
                displayName: facility.name,
              };
            }
          }

          return {
            sessionId: auth.sessionId,
            user: {
              id: user.id,
              displayName: [user.first_name, user.surname]
                .filter(Boolean)
                .join(' '),
              roles: auth.roles,
            },
            location,
            facilityId: auth.facilityId,
          };
        },
      );
    },
  );
}

function requestIp(req: FastifyRequest): string | null {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) {
    return fwd.split(',')[0]!.trim();
  }
  return req.ip ?? null;
}
