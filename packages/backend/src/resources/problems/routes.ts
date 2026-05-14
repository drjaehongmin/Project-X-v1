// Problem routes.
//
//   GET /problems/:id          — single row, summary view
//   GET /problems?patientId=…  — patient's problem list, summary view
//
// Both go through withRlsContext + writeAudit + projectView.  Writes
// (POST /problems, PATCH /problems/:id, status transitions) come in a
// follow-up once a UI needs them.

import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { z } from 'zod';

import type { Database } from '../../db/types.js';
import { withRlsContext } from '../../db/rls.js';
import { writeAudit } from '../../audit/writer.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { parseElements, projectView } from '../../lib/view-projection.js';
import { Permissions } from '../../permissions/catalog.js';
import { requirePermission } from '../../permissions/require.js';
import {
  listProblemSummariesByPatient,
  readProblemSummary,
} from './queries.js';
import {
  PROBLEM_SUMMARY_FIELDS,
  problemSummaryListSchema,
  problemSummarySchema,
  type ProblemSummaryRow,
} from './views.js';

interface ProblemRoutesDeps {
  readonly db: Kysely<Database>;
}

const idParamsSchema = z.object({
  id: z.string().uuid(),
});

const summaryQuerySchema = z.object({
  view: z.enum(['summary']).default('summary'),
  _elements: z.string().optional(),
});

const listQuerySchema = z.object({
  view: z.enum(['summary']).default('summary'),
  patientId: z.string().uuid(),
  status: z.enum(['active', 'inactive', 'resolved']).optional(),
  limit: z.coerce.number().int().positive().max(1000).optional(),
  _elements: z.string().optional(),
});

export function registerProblemRoutes(
  app: FastifyInstance,
  deps: ProblemRoutesDeps,
): void {
  app.get(
    '/problems/:id',
    {
      preHandler: [app.requireAuth, requirePermission(Permissions.Problem.Read)],
      schema: {
        response: {
          200: problemSummarySchema,
        },
      },
    },
    async (req) => {
      const params = parse(idParamsSchema, req.params);
      const query = parse(summaryQuerySchema, req.query);
      const elements = parseElements(query._elements);
      const auth = req.auth!;

      const summary = await withRlsContext(
        deps.db,
        rlsCtxFromAuth(auth),
        async (tx) => {
          const row = await readProblemSummary(tx, params.id);
          if (row === null) return null;

          await writeAudit(tx, {
            userId: auth.userId,
            action: 'record.read',
            resourceType: 'Problem',
            resourceId: row.id,
            patientId: row.patientId,
            moduleId: getModuleHeader(req),
            metadata: { view: query.view },
          });
          return row;
        },
      );

      if (summary === null) {
        throw new NotFoundError('Problem');
      }

      return projectView(summary, {
        allowed: PROBLEM_SUMMARY_FIELDS,
        ...(elements !== null && { elements }),
      });
    },
  );

  app.get(
    '/problems',
    {
      preHandler: [app.requireAuth, requirePermission(Permissions.Problem.Read)],
      schema: {
        response: {
          200: problemSummaryListSchema,
        },
      },
    },
    async (req) => {
      const query = parse(listQuerySchema, req.query);
      const elements = parseElements(query._elements);
      const auth = req.auth!;

      const rows = await withRlsContext(
        deps.db,
        rlsCtxFromAuth(auth),
        async (tx) => {
          const list = await listProblemSummariesByPatient(tx, query.patientId, {
            ...(query.status !== undefined && { status: query.status }),
            ...(query.limit !== undefined && { limit: query.limit }),
          });

          await writeAudit(tx, {
            userId: auth.userId,
            action: 'record.list',
            resourceType: 'Problem',
            patientId: query.patientId,
            moduleId: getModuleHeader(req),
            metadata: {
              view: query.view,
              count: list.length,
              ...(query.status !== undefined && { status: query.status }),
            },
          });

          return list;
        },
      );

      return rows.map((row: ProblemSummaryRow) =>
        projectView(row, {
          allowed: PROBLEM_SUMMARY_FIELDS,
          ...(elements !== null && { elements }),
        }),
      );
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

function getModuleHeader(req: {
  headers: Record<string, unknown>;
}): string | undefined {
  const raw = req.headers['x-module-id'];
  return typeof raw === 'string' ? raw : undefined;
}
