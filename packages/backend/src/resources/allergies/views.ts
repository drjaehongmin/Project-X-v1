// Named view shapes for the allergies resource.  Summary is the only
// view today and backs both the single GET and the list.  Writes echo
// the same shape so callers get a populated record back without a
// second round-trip.

export const ALLERGY_SUMMARY_FIELDS = [
  'id',
  'patientId',
  'allergen',
  'allergenType',
  'reaction',
  'severity',
  'status',
  'createdAt',
  'updatedAt',
] as const;

export type AllergySummaryField = (typeof ALLERGY_SUMMARY_FIELDS)[number];

export type AllergenType = 'drug' | 'food' | 'environmental' | 'other';
export type AllergySeverity =
  | 'mild'
  | 'moderate'
  | 'severe'
  | 'life_threatening';
export type AllergyStatus = 'active' | 'inactive' | 'resolved';

export interface AllergySummaryRow {
  readonly id: string;
  readonly patientId: string;
  readonly allergen: string;
  readonly allergenType: AllergenType;
  readonly reaction: string | null;
  readonly severity: AllergySeverity | null;
  readonly status: AllergyStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const allergySummarySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
    patientId: { type: 'string', format: 'uuid' },
    allergen: { type: 'string' },
    allergenType: {
      type: 'string',
      enum: ['drug', 'food', 'environmental', 'other'],
    },
    reaction: { type: ['string', 'null'] },
    severity: {
      type: ['string', 'null'],
      enum: ['mild', 'moderate', 'severe', 'life_threatening', null],
    },
    status: { type: 'string', enum: ['active', 'inactive', 'resolved'] },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

export const allergySummaryListSchema = {
  type: 'array',
  items: allergySummarySchema,
} as const;
