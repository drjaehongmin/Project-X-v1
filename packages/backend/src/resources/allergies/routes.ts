// Allergy routes — the first resource with a write surface.
//
//   GET    /allergies/:id           — single row, summary view
//   GET    /allergies?patientId=…   — patient's allergy list
//   POST   /allergies               — create
//   PATCH  /allergies/:id           — partial update (reaction/severity/status)
//
// Reads + lists mirror the encounter/problem patterns.  Writes follow
// the same audit + RLS-via-policy contract:
//   - INSERT: row-level WITH CHECK runs `app_can_access_patient` and
//     the role test.  A nurse trying to add an allergy to a patient
//     they're not on the care team for fails at INSERT, not at the
//     audit row.
//   - UPDATE: the row vanishes from the UPDATE's set when RLS filters
//     it out — Kysely's RETURNING then comes back empty, and the
//     route returns 404.  No 403 leakage.

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
  insertAllergy,
  listAllergySummariesByPatient,
  readAllergySummary,
  updateAllergy,
} from './queries.js';
import {
  ALLERGY_SUMMARY_FIELDS,
  allergySummaryListSchema,
  allergySummarySchema,
  type AllergySummaryRow,
} from './views.js';

interface AllergyRoutesDeps {
  readonly db: Kysely<Database>;
}

const idParamsSchema = z.object({ id: z.string().uuid() });

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

const allergenTypeEnum = z.enum(['drug', 'food', 'environmental', 'other']);
const severityEnum = z.enum(['mild', 'moderate', 'severe', 'life_threatening']);
const statusEnum = z.enum(['active', 'inactive', 'resolved']);

const createBodySchema = z.object({
  patientId: z.string().uuid(),
  allergen: z.string().min(1).max(200),
  allergenType: allergenTypeEnum,
  reaction: z.string().max(500).nullable().optional(),
  severity: severityEnum.nullable().optional(),
  status: statusEnum.optional(),
});

// PATCH is strictly partial.  At least one mutable field must be
// provided; otherwise the request is rejected to avoid silent no-ops
// (which would still audit-write and look like a successful change).
const updateBodySchema = z
  .object({
    reaction: z.string().max(500).nullable().optional(),
    severity: severityEnum.nullable().optional(),
    status: statusEnum.optional(),
  })
  .refine(
    (v) =>
      v.reaction !== undefined ||
      v.severity !== undefined ||
      v.status !== undefined,
    { message: 'At least one of reaction, severity, status is required' },
  );

export function registerAllergyRoutes(
  app: FastifyInstance,
  deps: AllergyRoutesDeps,
): void {
  app.get(
    '/allergies/:id',
    {
      preHandler: [app.requireAuth, requirePermission(Permissions.Allergy.Read)],
      schema: { response: { 200: allergySummarySchema } },
    },
    async (req) => {
      const params = parse(idParamsSchema, req.params);
      const query = parse(summaryQuerySchema, req.query);
      const elements = parseElements(query._elements);
      const auth = req.auth!;

      const row = await withRlsContext(
        deps.db,
        rlsCtxFromAuth(auth),
        async (tx) => {
          const found = await readAllergySummary(tx, params.id);
          if (found === null) return null;
          await writeAudit(tx, {
            userId: auth.userId,
            action: 'record.read',
            resourceType: 'Allergy',
            resourceId: found.id,
            patientId: found.patientId,
            moduleId: getModuleHeader(req),
            metadata: { view: query.view },
          });
          return found;
        },
      );

      if (row === null) throw new NotFoundError('Allergy');
      return projectView(row, {
        allowed: ALLERGY_SUMMARY_FIELDS,
        ...(elements !== null && { elements }),
      });
    },
  );

  app.get(
    '/allergies',
    {
      preHandler: [app.requireAuth, requirePermission(Permissions.Allergy.Read)],
      schema: { response: { 200: allergySummaryListSchema } },
    },
    async (req) => {
      const query = parse(listQuerySchema, req.query);
      const elements = parseElements(query._elements);
      const auth = req.auth!;

      const rows = await withRlsContext(
        deps.db,
        rlsCtxFromAuth(auth),
        async (tx) => {
          const list = await listAllergySummariesByPatient(tx, query.patientId, {
            ...(query.status !== undefined && { status: query.status }),
            ...(query.limit !== undefined && { limit: query.limit }),
          });
          await writeAudit(tx, {
            userId: auth.userId,
            action: 'record.list',
            resourceType: 'Allergy',
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

      return rows.map((r: AllergySummaryRow) =>
        projectView(r, {
          allowed: ALLERGY_SUMMARY_FIELDS,
          ...(elements !== null && { elements }),
        }),
      );
    },
  );

  app.post(
    '/allergies',
    {
      preHandler: [app.requireAuth, requirePermission(Permissions.Allergy.Write)],
      schema: { response: { 201: allergySummarySchema } },
    },
    async (req, reply) => {
      const body = parse(createBodySchema, req.body);
      const auth = req.auth!;

      const row = await withRlsContext(deps.db, rlsCtxFromAuth(auth), async (tx) => {
        const inserted = await insertAllergy(tx, {
          patientId: body.patientId,
          allergen: body.allergen,
          allergenType: body.allergenType,
          ...(body.reaction !== undefined && { reaction: body.reaction }),
          ...(body.severity !== undefined && { severity: body.severity }),
          ...(body.status !== undefined && { status: body.status }),
          authorUserId: auth.userId,
        });
        await writeAudit(tx, {
          userId: auth.userId,
          action: 'record.create',
          resourceType: 'Allergy',
          resourceId: inserted.id,
          patientId: inserted.patientId,
          moduleId: getModuleHeader(req),
          metadata: {
            allergen: inserted.allergen,
            allergenType: inserted.allergenType,
            severity: inserted.severity,
            status: inserted.status,
          },
        });
        return inserted;
      });

      reply.code(201);
      return projectView(row, { allowed: ALLERGY_SUMMARY_FIELDS });
    },
  );

  app.patch(
    '/allergies/:id',
    {
      preHandler: [app.requireAuth, requirePermission(Permissions.Allergy.Write)],
      schema: { response: { 200: allergySummarySchema } },
    },
    async (req) => {
      const params = parse(idParamsSchema, req.params);
      const body = parse(updateBodySchema, req.body);
      const auth = req.auth!;

      const row = await withRlsContext(deps.db, rlsCtxFromAuth(auth), async (tx) => {
        const before = await readAllergySummary(tx, params.id);
        if (before === null) return null;
        const updated = await updateAllergy(tx, params.id, {
          ...(body.reaction !== undefined && { reaction: body.reaction }),
          ...(body.severity !== undefined && { severity: body.severity }),
          ...(body.status !== undefined && { status: body.status }),
          editorUserId: auth.userId,
        });
        // The before-read passed RLS but the update could still come
        // back null if a concurrent write soft-deleted the row.
        if (updated === null) return null;
        await writeAudit(tx, {
          userId: auth.userId,
          action: 'record.update',
          resourceType: 'Allergy',
          resourceId: updated.id,
          patientId: updated.patientId,
          moduleId: getModuleHeader(req),
          metadata: {
            changed: changedFields(before, body),
            before: { severity: before.severity, status: before.status },
            after: { severity: updated.severity, status: updated.status },
          },
        });
        return updated;
      });

      if (row === null) throw new NotFoundError('Allergy');
      return projectView(row, { allowed: ALLERGY_SUMMARY_FIELDS });
    },
  );
}

function changedFields(
  before: AllergySummaryRow,
  patch: {
    reaction?: string | null | undefined;
    severity?: unknown;
    status?: unknown;
  },
): readonly string[] {
  const out: string[] = [];
  if (patch.reaction !== undefined && patch.reaction !== before.reaction) {
    out.push('reaction');
  }
  if (patch.severity !== undefined && patch.severity !== before.severity) {
    out.push('severity');
  }
  if (patch.status !== undefined && patch.status !== before.status) {
    out.push('status');
  }
  return out;
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
