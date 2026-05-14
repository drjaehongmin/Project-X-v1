// Encounter routes.  Two endpoints land in Phase 2B:
//
//   GET /encounters/:id           — single row, summary view
//   GET /encounters?patientId=…   — patient's history, summary view
//
// Both go through withRlsContext + writeAudit + projectView.  Writes
// (POST /encounters, PATCH /encounters/:id/status) come in a follow-up
// once the scheduling module needs them.

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
  listEncounterSummariesByPatient,
  readEncounterSummary,
} from './queries.js';
import {
  ENCOUNTER_SUMMARY_FIELDS,
  encounterSummaryListSchema,
  encounterSummarySchema,
  type EncounterSummaryRow,
} from './views.js';

interface EncounterRoutesDeps {
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
  // Optional caller-supplied cap; the query has its own default and
  // hard maximum so a runaway value can't blow up the response.
  limit: z.coerce.number().int().positive().max(500).optional(),
  _elements: z.string().optional(),
});

export function registerEncounterRoutes(
  app: FastifyInstance,
  deps: EncounterRoutesDeps,
): void {
  app.get(
    '/encounters/:id',
    {
      preHandler: [app.requireAuth, requirePermission(Permissions.Encounter.Read)],
      schema: {
        response: {
          200: encounterSummarySchema,
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
          const row = await readEncounterSummary(tx, params.id);
          if (row === null) return null;

          await writeAudit(tx, {
            userId: auth.userId,
            action: 'record.read',
            resourceType: 'Encounter',
            resourceId: row.id,
            patientId: row.patientId,
            moduleId: getModuleHeader(req),
            metadata: { view: query.view },
          });

          return row;
        },
      );

      if (summary === null) {
        // RLS-filtered rows look identical to missing rows by design —
        // 404 instead of 403 avoids leaking the encounter's existence.
        throw new NotFoundError('Encounter');
      }

      return projectView(summary, {
        allowed: ENCOUNTER_SUMMARY_FIELDS,
        ...(elements !== null && { elements }),
      });
    },
  );

  app.get(
    '/encounters',
    {
      preHandler: [app.requireAuth, requirePermission(Permissions.Encounter.Read)],
      schema: {
        response: {
          200: encounterSummaryListSchema,
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
          const list = await listEncounterSummariesByPatient(
            tx,
            query.patientId,
            { ...(query.limit !== undefined && { limit: query.limit }) },
          );

          // Audit the list operation once with the result count; per-row
          // audits would dwarf actual data volume for high-cardinality
          // lists.  Compliance can correlate to the SELECTs via the
          // `metadata.count` field.
          await writeAudit(tx, {
            userId: auth.userId,
            action: 'record.list',
            resourceType: 'Encounter',
            patientId: query.patientId,
            moduleId: getModuleHeader(req),
            metadata: { view: query.view, count: list.length },
          });

          return list;
        },
      );

      return rows.map((row: EncounterSummaryRow) =>
        projectView(row, {
          allowed: ENCOUNTER_SUMMARY_FIELDS,
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
