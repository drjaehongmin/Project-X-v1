// IAM routes — the admin surface for users, roles, and user-role
// grants.  All endpoints are admin-gated at the application layer via
// `requirePermission`; RLS on the underlying tables (migrations 0003,
// 0007) re-checks at the row level.
//
//   GET  /users               — list (admin)
//   POST /users               — create (admin), argon2id-hashes the password
//   GET  /roles               — list (admin)
//   POST /roles               — create (admin)
//   POST /user-roles          — grant a role to a user with optional facility
//   GET  /user-roles?userId=… — list grants for a user (admin)

import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { z } from 'zod';

import type { Database } from '../../db/types.js';
import { withRlsContext } from '../../db/rls.js';
import { writeAudit } from '../../audit/writer.js';
import { ConflictError, ValidationError } from '../../lib/errors.js';
import { parseElements, projectView } from '../../lib/view-projection.js';
import { Permissions } from '../../permissions/catalog.js';
import { requirePermission } from '../../permissions/require.js';
import { hashPassword } from '../../auth/password.js';
import {
  findUserByEmail,
  insertRole,
  insertUser,
  insertUserRole,
  listRoleSummaries,
  listUserRolesForUser,
  listUserSummaries,
} from './queries.js';
import {
  ROLE_SUMMARY_FIELDS,
  USER_ROLE_SUMMARY_FIELDS,
  USER_SUMMARY_FIELDS,
  roleSummaryListSchema,
  roleSummarySchema,
  userRoleSummaryListSchema,
  userRoleSummarySchema,
  userSummaryListSchema,
  userSummarySchema,
} from './views.js';

interface IamRoutesDeps {
  readonly db: Kysely<Database>;
}

const listQuerySchema = z.object({
  view: z.enum(['summary']).default('summary'),
  limit: z.coerce.number().int().positive().max(1000).optional(),
  _elements: z.string().optional(),
});

const userRoleListQuerySchema = z.object({
  view: z.enum(['summary']).default('summary'),
  userId: z.string().uuid(),
  _elements: z.string().optional(),
});

const userTypeEnum = z.enum(['staff', 'provider', 'admin', 'patient']);

const createUserBodySchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(200),
  firstName: z.string().min(1).max(200),
  surname: z.string().min(1).max(200),
  userType: userTypeEnum.default('staff'),
});

const createRoleBodySchema = z.object({
  name: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/i),
  description: z.string().max(1000).nullable().optional(),
});

const createUserRoleBodySchema = z.object({
  userId: z.string().uuid(),
  roleId: z.string().uuid(),
  facilityId: z.string().uuid().nullable().optional(),
});

export function registerIamRoutes(
  app: FastifyInstance,
  deps: IamRoutesDeps,
): void {
  // ---------- users ----------

  app.get(
    '/users',
    {
      preHandler: [app.requireAuth, requirePermission(Permissions.User.Read)],
      schema: { response: { 200: userSummaryListSchema } },
    },
    async (req) => {
      const query = parse(listQuerySchema, req.query);
      const elements = parseElements(query._elements);
      const auth = req.auth!;

      const rows = await withRlsContext(deps.db, rlsCtxFromAuth(auth), async (tx) => {
        const list = await listUserSummaries(tx, {
          ...(query.limit !== undefined && { limit: query.limit }),
        });
        await writeAudit(tx, {
          userId: auth.userId,
          action: 'record.list',
          resourceType: 'User',
          moduleId: getModuleHeader(req),
          metadata: { view: query.view, count: list.length },
        });
        return list;
      });

      return rows.map((r) =>
        projectView(r, {
          allowed: USER_SUMMARY_FIELDS,
          ...(elements !== null && { elements }),
        }),
      );
    },
  );

  app.post(
    '/users',
    {
      preHandler: [app.requireAuth, requirePermission(Permissions.User.Write)],
      schema: { response: { 201: userSummarySchema } },
    },
    async (req, reply) => {
      const body = parse(createUserBodySchema, req.body);
      const auth = req.auth!;

      // Hash outside the transaction — argon2id is expensive and we
      // don't want the tx holding a connection while we burn CPU.
      const passwordHash = await hashPassword(body.password);

      const row = await withRlsContext(deps.db, rlsCtxFromAuth(auth), async (tx) => {
        // Duplicate-email check up front for a clean 409.  The UNIQUE
        // constraint on `users.email` would also catch this — but at
        // 500 cost via a constraint violation; this is the polite path.
        const existing = await findUserByEmail(tx, body.email);
        if (existing !== null) {
          throw new ConflictError(`User already exists: ${body.email}`);
        }
        const inserted = await insertUser(tx, {
          email: body.email,
          passwordHash,
          firstName: body.firstName,
          surname: body.surname,
          // zod `.default('staff')` materializes the value at runtime,
          // but the inferred output type still includes `undefined` in
          // some versions — the explicit fallback keeps the call site
          // tidy.
          userType: body.userType ?? 'staff',
        });
        await writeAudit(tx, {
          userId: auth.userId,
          action: 'record.create',
          resourceType: 'User',
          resourceId: inserted.id,
          moduleId: getModuleHeader(req),
          metadata: { email: inserted.email, userType: inserted.userType },
        });
        return inserted;
      });

      reply.code(201);
      return projectView(row, { allowed: USER_SUMMARY_FIELDS });
    },
  );

  // ---------- roles ----------

  app.get(
    '/roles',
    {
      preHandler: [app.requireAuth, requirePermission(Permissions.Role.Read)],
      schema: { response: { 200: roleSummaryListSchema } },
    },
    async (req) => {
      const query = parse(listQuerySchema, req.query);
      const elements = parseElements(query._elements);
      const auth = req.auth!;

      const rows = await withRlsContext(deps.db, rlsCtxFromAuth(auth), async (tx) => {
        const list = await listRoleSummaries(tx);
        await writeAudit(tx, {
          userId: auth.userId,
          action: 'record.list',
          resourceType: 'Role',
          moduleId: getModuleHeader(req),
          metadata: { view: query.view, count: list.length },
        });
        return list;
      });

      return rows.map((r) =>
        projectView(r, {
          allowed: ROLE_SUMMARY_FIELDS,
          ...(elements !== null && { elements }),
        }),
      );
    },
  );

  app.post(
    '/roles',
    {
      preHandler: [app.requireAuth, requirePermission(Permissions.Role.Write)],
      schema: { response: { 201: roleSummarySchema } },
    },
    async (req, reply) => {
      const body = parse(createRoleBodySchema, req.body);
      const auth = req.auth!;

      const row = await withRlsContext(deps.db, rlsCtxFromAuth(auth), async (tx) => {
        const inserted = await insertRole(tx, {
          name: body.name,
          ...(body.description !== undefined && { description: body.description }),
        });
        await writeAudit(tx, {
          userId: auth.userId,
          action: 'record.create',
          resourceType: 'Role',
          resourceId: inserted.id,
          moduleId: getModuleHeader(req),
          metadata: { name: inserted.name },
        });
        return inserted;
      });

      reply.code(201);
      return projectView(row, { allowed: ROLE_SUMMARY_FIELDS });
    },
  );

  // ---------- user-roles (grants) ----------

  app.get(
    '/user-roles',
    {
      preHandler: [app.requireAuth, requirePermission(Permissions.User.Read)],
      schema: { response: { 200: userRoleSummaryListSchema } },
    },
    async (req) => {
      const query = parse(userRoleListQuerySchema, req.query);
      const elements = parseElements(query._elements);
      const auth = req.auth!;

      const rows = await withRlsContext(deps.db, rlsCtxFromAuth(auth), async (tx) => {
        const list = await listUserRolesForUser(tx, query.userId);
        await writeAudit(tx, {
          userId: auth.userId,
          action: 'record.list',
          resourceType: 'UserRole',
          moduleId: getModuleHeader(req),
          metadata: { view: query.view, targetUserId: query.userId, count: list.length },
        });
        return list;
      });

      return rows.map((r) =>
        projectView(r, {
          allowed: USER_ROLE_SUMMARY_FIELDS,
          ...(elements !== null && { elements }),
        }),
      );
    },
  );

  app.post(
    '/user-roles',
    {
      preHandler: [app.requireAuth, requirePermission(Permissions.User.Write)],
      schema: { response: { 201: userRoleSummarySchema } },
    },
    async (req, reply) => {
      const body = parse(createUserRoleBodySchema, req.body);
      const auth = req.auth!;

      const row = await withRlsContext(deps.db, rlsCtxFromAuth(auth), async (tx) => {
        try {
          const inserted = await insertUserRole(tx, {
            userId: body.userId,
            roleId: body.roleId,
            ...(body.facilityId !== undefined && { facilityId: body.facilityId }),
          });
          await writeAudit(tx, {
            userId: auth.userId,
            action: 'record.create',
            resourceType: 'UserRole',
            resourceId: inserted.roleId,
            moduleId: getModuleHeader(req),
            metadata: {
              targetUserId: inserted.userId,
              roleName: inserted.roleName,
              facilityId: inserted.facilityId,
            },
          });
          return inserted;
        } catch (err) {
          // Composite-PK violation surfaces as a Postgres unique-violation
          // (SQLSTATE 23505).  Translate to a clean 409.
          if (isUniqueViolation(err)) {
            throw new ConflictError('User already has this role grant');
          }
          throw err;
        }
      });

      reply.code(201);
      return projectView(row, { allowed: USER_ROLE_SUMMARY_FIELDS });
    },
  );
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ValidationError('Invalid request', { issues: result.error.issues });
  }
  return result.data;
}

function rlsCtxFromAuth(auth: NonNullable<import('fastify').FastifyRequest['auth']>) {
  return {
    userId: auth.userId,
    facilityId: auth.facilityId,
    roles: auth.roles,
    breakGlass: auth.breakGlass,
  };
}

function getModuleHeader(req: { headers: Record<string, unknown> }): string | undefined {
  const raw = req.headers['x-module-id'];
  return typeof raw === 'string' ? raw : undefined;
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return code === '23505';
}
