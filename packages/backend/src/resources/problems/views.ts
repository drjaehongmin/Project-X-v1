// Named view shapes for the problems resource.  The summary view backs
// both the single GET and the patient-scoped list.  When richer
// detail (history of status changes, linked encounters) is needed it
// gets its own view alongside.

export const PROBLEM_SUMMARY_FIELDS = [
  'id',
  'patientId',
  'icd10Code',
  'description',
  'status',
  'onsetDate',
  'resolvedDate',
] as const;

export type ProblemSummaryField = (typeof PROBLEM_SUMMARY_FIELDS)[number];

export type ProblemStatus = 'active' | 'inactive' | 'resolved';

export interface ProblemSummaryRow {
  readonly id: string;
  readonly patientId: string;
  readonly icd10Code: string | null;
  readonly description: string;
  readonly status: ProblemStatus;
  readonly onsetDate: string | null;       // ISO 8601 date (YYYY-MM-DD)
  readonly resolvedDate: string | null;    // ISO 8601 date (YYYY-MM-DD)
}

export const problemSummarySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
    patientId: { type: 'string', format: 'uuid' },
    icd10Code: { type: ['string', 'null'] },
    description: { type: 'string' },
    status: { type: 'string', enum: ['active', 'inactive', 'resolved'] },
    onsetDate: { type: ['string', 'null'], format: 'date' },
    resolvedDate: { type: ['string', 'null'], format: 'date' },
  },
} as const;

export const problemSummaryListSchema = {
  type: 'array',
  items: problemSummarySchema,
} as const;
