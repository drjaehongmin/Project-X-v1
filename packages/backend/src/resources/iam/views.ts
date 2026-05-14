// Identity & access-management view shapes.
//
// Three view families live here because the admin module reads and
// writes all three together; splitting them across folders would
// create three near-empty `views.ts` files.  The runbook's
// "one folder per resource" convention is a soft guideline — when an
// admin domain spans tightly-coupled tables, one folder is clearer.
//
// Password fields, MFA secrets, and session tokens never appear in any
// view.  Adding one is a security review concern.

// ---------- UserSummary ---------------------------------------------

export const USER_SUMMARY_FIELDS = [
  'id',
  'email',
  'firstName',
  'surname',
  'userType',
  'isActive',
  'createdAt',
] as const;

export type UserSummaryField = (typeof USER_SUMMARY_FIELDS)[number];

export type UserType = 'staff' | 'provider' | 'admin' | 'patient';

export interface UserSummaryRow {
  readonly id: string;
  readonly email: string;
  readonly firstName: string;
  readonly surname: string;
  readonly userType: UserType;
  readonly isActive: boolean;
  readonly createdAt: string;
}

export const userSummarySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
    email: { type: 'string' },
    firstName: { type: 'string' },
    surname: { type: 'string' },
    userType: {
      type: 'string',
      enum: ['staff', 'provider', 'admin', 'patient'],
    },
    isActive: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
  },
} as const;

export const userSummaryListSchema = {
  type: 'array',
  items: userSummarySchema,
} as const;

// ---------- RoleSummary ---------------------------------------------

export const ROLE_SUMMARY_FIELDS = [
  'id',
  'name',
  'description',
  'createdAt',
] as const;

export type RoleSummaryField = (typeof ROLE_SUMMARY_FIELDS)[number];

export interface RoleSummaryRow {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly createdAt: string;
}

export const roleSummarySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    description: { type: ['string', 'null'] },
    createdAt: { type: 'string', format: 'date-time' },
  },
} as const;

export const roleSummaryListSchema = {
  type: 'array',
  items: roleSummarySchema,
} as const;

// ---------- UserRoleSummary -----------------------------------------
// A single grant row.  Includes role name + (optional) facility name
// joined from the role / facility tables so the admin UI can render
// without a second round-trip.

export const USER_ROLE_SUMMARY_FIELDS = [
  'userId',
  'roleId',
  'roleName',
  'facilityId',
  'facilityName',
  'createdAt',
] as const;

export type UserRoleSummaryField = (typeof USER_ROLE_SUMMARY_FIELDS)[number];

export interface UserRoleSummaryRow {
  readonly userId: string;
  readonly roleId: string;
  readonly roleName: string;
  readonly facilityId: string | null;
  readonly facilityName: string | null;
  readonly createdAt: string;
}

export const userRoleSummarySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    userId: { type: 'string', format: 'uuid' },
    roleId: { type: 'string', format: 'uuid' },
    roleName: { type: 'string' },
    facilityId: { type: ['string', 'null'], format: 'uuid' },
    facilityName: { type: ['string', 'null'] },
    createdAt: { type: 'string', format: 'date-time' },
  },
} as const;

export const userRoleSummaryListSchema = {
  type: 'array',
  items: userRoleSummarySchema,
} as const;
