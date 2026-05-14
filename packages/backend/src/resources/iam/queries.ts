// IAM queries: users, roles, user_roles.  Each takes a Kysely
// Transaction already scoped via withRlsContext.  Password hashing
// (argon2id) is done by the route before insertPatient — keeping
// argon2 out of the query layer leaves these functions pure
// SQL-projection helpers.

import type { Transaction } from 'kysely';

import type { Database } from '../../db/types.js';
import type {
  RoleSummaryRow,
  UserRoleSummaryRow,
  UserSummaryRow,
  UserType,
} from './views.js';

// ---------- Users ---------------------------------------------------

const USER_SUMMARY_COLUMNS = [
  'id',
  'email',
  'first_name',
  'surname',
  'user_type',
  'is_active',
  'created_at',
] as const;

interface UserRow {
  id: string;
  email: string;
  first_name: string;
  surname: string;
  user_type: UserType;
  is_active: boolean;
  created_at: Date | string;
}

export async function listUserSummaries(
  tx: Transaction<Database>,
  options: { limit?: number } = {},
): Promise<readonly UserSummaryRow[]> {
  const limit = options.limit ?? 200;
  const rows = await tx
    .selectFrom('users')
    .select(USER_SUMMARY_COLUMNS)
    .where('deleted_at', 'is', null)
    .orderBy('created_at', 'desc')
    .limit(limit)
    .execute();
  return rows.map(toUserSummary);
}

export interface InsertUserInput {
  readonly email: string;
  readonly passwordHash: string;
  readonly firstName: string;
  readonly surname: string;
  readonly userType: UserType;
}

export async function insertUser(
  tx: Transaction<Database>,
  input: InsertUserInput,
): Promise<UserSummaryRow> {
  const row = await tx
    .insertInto('users')
    .values({
      email: input.email,
      password_hash: input.passwordHash,
      first_name: input.firstName,
      surname: input.surname,
      user_type: input.userType,
    })
    .returning(USER_SUMMARY_COLUMNS)
    .executeTakeFirstOrThrow();
  return toUserSummary(row);
}

function toUserSummary(row: UserRow): UserSummaryRow {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    surname: row.surname,
    userType: row.user_type,
    isActive: row.is_active,
    createdAt: toIso(row.created_at),
  };
}

// ---------- Roles ---------------------------------------------------

const ROLE_SUMMARY_COLUMNS = [
  'id',
  'name',
  'description',
  'created_at',
] as const;

interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  created_at: Date | string;
}

export async function listRoleSummaries(
  tx: Transaction<Database>,
): Promise<readonly RoleSummaryRow[]> {
  const rows = await tx
    .selectFrom('roles')
    .select(ROLE_SUMMARY_COLUMNS)
    .orderBy('name', 'asc')
    .execute();
  return rows.map(toRoleSummary);
}

export interface InsertRoleInput {
  readonly name: string;
  readonly description?: string | null;
}

export async function insertRole(
  tx: Transaction<Database>,
  input: InsertRoleInput,
): Promise<RoleSummaryRow> {
  const row = await tx
    .insertInto('roles')
    .values({
      name: input.name,
      description: input.description ?? null,
    })
    .returning(ROLE_SUMMARY_COLUMNS)
    .executeTakeFirstOrThrow();
  return toRoleSummary(row);
}

function toRoleSummary(row: RoleRow): RoleSummaryRow {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: toIso(row.created_at),
  };
}

// ---------- User-role grants ---------------------------------------

export interface InsertUserRoleInput {
  readonly userId: string;
  readonly roleId: string;
  readonly facilityId?: string | null;
}

// Returns the joined summary so the admin UI can render without a
// re-fetch.  Composite-PK conflict (the grant already exists) is
// caught by the route and surfaced as a 409.
export async function insertUserRole(
  tx: Transaction<Database>,
  input: InsertUserRoleInput,
): Promise<UserRoleSummaryRow> {
  const inserted = await tx
    .insertInto('user_roles')
    .values({
      user_id: input.userId,
      role_id: input.roleId,
      facility_id: input.facilityId ?? null,
    })
    .returning(['user_id', 'role_id', 'facility_id', 'created_at'])
    .executeTakeFirstOrThrow();

  // Hydrate role + facility names.  Two small lookups; not joining
  // inline because Kysely's RETURNING + JOIN gets noisier than it's
  // worth at this surface size.
  const role = await tx
    .selectFrom('roles')
    .select(['id', 'name'])
    .where('id', '=', inserted.role_id)
    .executeTakeFirstOrThrow();

  let facilityName: string | null = null;
  if (inserted.facility_id !== null) {
    const fac = await tx
      .selectFrom('facilities')
      .select(['name'])
      .where('id', '=', inserted.facility_id)
      .executeTakeFirst();
    facilityName = fac?.name ?? null;
  }

  return {
    userId: inserted.user_id,
    roleId: inserted.role_id,
    roleName: role.name,
    facilityId: inserted.facility_id,
    facilityName,
    createdAt: toIso(inserted.created_at),
  };
}

export async function listUserRolesForUser(
  tx: Transaction<Database>,
  userId: string,
): Promise<readonly UserRoleSummaryRow[]> {
  const rows = await tx
    .selectFrom('user_roles')
    .innerJoin('roles', 'roles.id', 'user_roles.role_id')
    .leftJoin('facilities', 'facilities.id', 'user_roles.facility_id')
    .select([
      'user_roles.user_id as user_id',
      'user_roles.role_id as role_id',
      'roles.name as role_name',
      'user_roles.facility_id as facility_id',
      'facilities.name as facility_name',
      'user_roles.created_at as created_at',
    ])
    .where('user_roles.user_id', '=', userId)
    .orderBy('roles.name', 'asc')
    .orderBy('facilities.name', 'asc')
    .execute();

  return rows.map((r) => ({
    userId: r.user_id,
    roleId: r.role_id,
    roleName: r.role_name,
    facilityId: r.facility_id,
    facilityName: r.facility_name,
    createdAt: toIso(r.created_at),
  }));
}

export async function findUserByEmail(
  tx: Transaction<Database>,
  email: string,
): Promise<{ id: string } | null> {
  const row = await tx
    .selectFrom('users')
    .select(['id'])
    .where('email', '=', email)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  return row === undefined ? null : { id: row.id };
}

// ---------- helpers ------------------------------------------------

function toIso(value: Date | string): string {
  return typeof value === 'string' ? value : value.toISOString();
}
