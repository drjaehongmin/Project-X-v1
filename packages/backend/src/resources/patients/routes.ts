// Patient routes.
//
//   GET  /patients/:id   — single row, summary view (read)
//   POST /patients       — create a new patient and add the caller as
//                          primary care provider in the same tx
//
// The POST surface is the first patient-write endpoint.  It pairs
// `patient.write` (preHandler) with the `patients_staff_insert` RLS
// policy (row-level) and the `care_team_self_insert` RLS policy
// (migration 0011) so a clinician can register a patient and become
// their first care provider without an admin step.

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
  assignSelfToCareTeam,
  insertPatient,
  readPatientSummary,
} from './queries.js';
import { PATIENT_SUMMARY_FIELDS, patientSummarySchema } from './views.js';

interface PatientRoutesDeps {
  readonly db: Kysely<Database>;
}

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const querySchema = z.object({
  view: z.enum(['summary']).default('summary'),
  _elements: z.string().optional(),
});

const sexEnum = z.enum(['male', 'female', 'intersex', 'unknown']);
// ISO 8601 date (YYYY-MM-DD).  The migration's CHECK enforces
// `<= current_date`; here we only enforce the shape.
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
// Two-letter ISO 3166-1 alpha-2 country code.  Case-insensitive on
// input; backend normalizes to uppercase.
const iso3166 = z.string().regex(/^[A-Za-z]{2}$/);

const createBodySchema = z.object({
  mrn: z.string().min(1).max(20),
  firstName: z.string().min(1).max(100),
  middleName: z.string().max(100).nullable().optional(),
  lastName: z.string().min(1).max(100),
  dateOfBirth: isoDate,
  sex: sexEnum.nullable().optional(),
  nationality: iso3166.nullable().optional(),
  countryOfResidence: iso3166.nullable().optional(),
});

export function registerPatientRoutes(
  app: FastifyInstance,
  deps: PatientRoutesDeps,
): void {
  app.get(
    '/patients/:id',
    {
      preHandler: [app.requireAuth, requirePermission(Permissions.Patient.Read)],
      schema: {
        response: {
          200: patientSummarySchema,
        },
      },
    },
    async (req) => {
      const paramsResult = paramsSchema.safeParse(req.params);
      if (!paramsResult.success) {
        throw new ValidationError('Invalid patient id', {
          issues: paramsResult.error.issues,
        });
      }
      const queryResult = querySchema.safeParse(req.query);
      if (!queryResult.success) {
        throw new ValidationError('Invalid query', {
          issues: queryResult.error.issues,
        });
      }

      const { id } = paramsResult.data;
      const elements = parseElements(queryResult.data._elements);
      const auth = req.auth!;

      const summary = await withRlsContext(
        deps.db,
        {
          userId: auth.userId,
          facilityId: auth.facilityId,
          roles: auth.roles,
          breakGlass: auth.breakGlass,
        },
        async (tx) => {
          const row = await readPatientSummary(tx, id);
          if (row === null) return null;

          // Audit the successful read inside the same tx so a write
          // failure rolls back together.
          await writeAudit(tx, {
            userId: auth.userId,
            action: 'record.read',
            resourceType: 'Patient',
            resourceId: id,
            patientId: id,
            moduleId: getModuleHeader(req),
            metadata: { view: queryResult.data.view },
          });

          return row;
        },
      );

      if (summary === null) {
        // RLS-filtered rows look identical to missing rows by design —
        // returning 404 avoids leaking whether the patient exists.
        throw new NotFoundError('Patient');
      }

      return projectView(summary, {
        allowed: PATIENT_SUMMARY_FIELDS,
        ...(elements !== null && { elements }),
      });
    },
  );

  app.post(
    '/patients',
    {
      preHandler: [app.requireAuth, requirePermission(Permissions.Patient.Write)],
      schema: {
        response: {
          201: patientSummarySchema,
        },
      },
    },
    async (req, reply) => {
      const bodyResult = createBodySchema.safeParse(req.body);
      if (!bodyResult.success) {
        throw new ValidationError('Invalid patient', {
          issues: bodyResult.error.issues,
        });
      }
      const body = bodyResult.data;
      const auth = req.auth!;

      // Insert + self-add-to-care-team + audit, all in one transaction
      // so a failure anywhere rolls every step back.  The care-team
      // self-insert is gated by migration 0011's policy (a caller may
      // add themselves to a patient's care team).
      const summary = await withRlsContext(
        deps.db,
        {
          userId: auth.userId,
          facilityId: auth.facilityId,
          roles: auth.roles,
          breakGlass: auth.breakGlass,
        },
        async (tx) => {
          const created = await insertPatient(tx, {
            mrn: body.mrn,
            firstName: body.firstName,
            ...(body.middleName !== undefined && { middleName: body.middleName }),
            lastName: body.lastName,
            dateOfBirth: body.dateOfBirth,
            ...(body.sex !== undefined && { sex: body.sex }),
            ...(body.nationality !== undefined && {
              nationality:
                body.nationality === null ? null : body.nationality.toUpperCase(),
            }),
            ...(body.countryOfResidence !== undefined && {
              countryOfResidence:
                body.countryOfResidence === null
                  ? null
                  : body.countryOfResidence.toUpperCase(),
            }),
          });

          await assignSelfToCareTeam(tx, created.id, auth.userId, 'primary');

          await writeAudit(tx, {
            userId: auth.userId,
            action: 'record.create',
            resourceType: 'Patient',
            resourceId: created.id,
            patientId: created.id,
            moduleId: getModuleHeader(req),
            metadata: {
              mrn: created.mrn,
              careTeam: 'self-primary',
            },
          });

          return created;
        },
      );

      reply.code(201);
      return projectView(summary, { allowed: PATIENT_SUMMARY_FIELDS });
    },
  );
}

function getModuleHeader(req: { headers: Record<string, unknown> }): string | undefined {
  const raw = req.headers['x-module-id'];
  return typeof raw === 'string' ? raw : undefined;
}
