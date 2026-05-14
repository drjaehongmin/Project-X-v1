// Named view shapes for the patients resource.  These declare the
// maximum field set each view may emit; the projection helper and
// Fastify's JSON Schema serializer enforce it at runtime.
//
// Adding a field to a view is intentional and reviewable; accidentally
// selecting an extra column in the query is not enough to leak it.

export const PATIENT_SUMMARY_FIELDS = [
  'id',
  'mrn',
  'displayName',
  'dateOfBirth',
  'sex',
] as const;

export type PatientSummaryField = (typeof PATIENT_SUMMARY_FIELDS)[number];

export type PatientSex = 'male' | 'female' | 'intersex' | 'unknown';

export interface PatientSummaryRow {
  readonly id: string;
  readonly mrn: string;
  readonly displayName: string;
  readonly dateOfBirth: string; // ISO 8601 date (YYYY-MM-DD)
  readonly sex: PatientSex | null;
}

// JSON Schema for response serialization.  Anything not declared here
// is dropped before send, even if the handler accidentally included
// it.  `additionalProperties: false` makes that explicit.
//
// All properties are optional at the schema level so `_elements`
// narrowing is non-breaking — a caller asking for just `id,mrn`
// gets a valid `{ id, mrn }` response.  The `required` invariants
// of a *full* summary (id/mrn/displayName/dateOfBirth always present
// when no _elements is supplied) are enforced by the query + the
// projection step, not by the schema.
export const patientSummarySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
    mrn: { type: 'string' },
    displayName: { type: 'string' },
    dateOfBirth: { type: 'string', format: 'date' },
    sex: {
      type: ['string', 'null'],
      enum: ['male', 'female', 'intersex', 'unknown', null],
    },
  },
} as const;
