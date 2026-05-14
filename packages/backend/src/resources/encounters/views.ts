// Named view shapes for the encounters resource.  The same summary
// shape is used for both the single-row GET /encounters/:id and the
// list GET /encounters?patientId=...; the list endpoint just wraps it
// in an array.  When detail / billing / vitals-bound views are added,
// they get their own constants and schemas here.

export const ENCOUNTER_SUMMARY_FIELDS = [
  'id',
  'patientId',
  'providerId',
  'facilityId',
  'encounterTypeId',
  'status',
  'startTime',
  'endTime',
  'chiefComplaint',
  'isTelehealth',
] as const;

export type EncounterSummaryField = (typeof ENCOUNTER_SUMMARY_FIELDS)[number];

export type EncounterStatus =
  | 'scheduled'
  | 'arrived'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'no_show';

export interface EncounterSummaryRow {
  readonly id: string;
  readonly patientId: string;
  readonly providerId: string;
  readonly facilityId: string;
  readonly encounterTypeId: string | null;
  readonly status: EncounterStatus;
  readonly startTime: string; // ISO 8601 timestamp
  readonly endTime: string | null;
  readonly chiefComplaint: string | null;
  readonly isTelehealth: boolean;
}

// JSON Schema for response serialization.  No `required` field — the
// `_elements` narrowing must remain non-breaking.
export const encounterSummarySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
    patientId: { type: 'string', format: 'uuid' },
    providerId: { type: 'string', format: 'uuid' },
    facilityId: { type: 'string', format: 'uuid' },
    encounterTypeId: { type: ['string', 'null'], format: 'uuid' },
    status: {
      type: 'string',
      enum: [
        'scheduled',
        'arrived',
        'in_progress',
        'completed',
        'cancelled',
        'no_show',
      ],
    },
    startTime: { type: 'string', format: 'date-time' },
    endTime: { type: ['string', 'null'], format: 'date-time' },
    chiefComplaint: { type: ['string', 'null'] },
    isTelehealth: { type: 'boolean' },
  },
} as const;

// List response wraps the summary objects in an array.  Wrapping in an
// object would let us add paging metadata later without a breaking
// change, but Phase 2B keeps the surface bare-bones — pagination is a
// later add.
export const encounterSummaryListSchema = {
  type: 'array',
  items: encounterSummarySchema,
} as const;
