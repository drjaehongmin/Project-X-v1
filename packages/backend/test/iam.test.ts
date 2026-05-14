// Integration tests for the IAM admin surface: users, roles,
// user_roles.  All endpoints are admin-only at the application layer
// AND at the row level (RLS policies from migration 0003 +
// `0007_strengthen_facility_predicate`).
//
// Each test seeds a fresh admin user, logs in, exercises the endpoint,
// and asserts on the response.  truncate-between-tests keeps state
// clean.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { buildServer } from '../src/server.js';
import type { BackendConfig } from '../src/config.js';
import { closeDb } from '../src/db/client.js';
import {
  closeTestPool,
  getTestPool,
  readTestEnv,
  seedUser,
  truncateAll,
} from './helpers/db.js';

const env = readTestEnv();
const runOrSkip = env === null ? describe.skip : describe;

runOrSkip('IAM API', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const config: BackendConfig = Object.freeze({
      databaseUrl: env!.databaseUrl,
      port: 0,
      frontendOrigin: 'http://localhost:5209',
      jwtSecret: env!.jwtSecret,
      jwtAccessTtlSeconds: 900,
      jwtRefreshTtlSeconds: 2_592_000,
      logLevel: 'error',
      nodeEnv: 'test',
    });
    process.env['DATABASE_URL'] = env!.databaseUrl;
    process.env['JWT_SECRET'] = env!.jwtSecret;
    app = await buildServer(config);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
    await closeTestPool();
  });

  beforeEach(async () => {
    await truncateAll(env!);
  });

  async function login(email: string, password: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password },
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { accessToken: string }).accessToken;
  }

  async function seedAdmin(): Promise<{ email: string; password: string; id: string }> {
    const u = await seedUser(env!, {
      email: `admin-${rand()}@example.test`,
      password: 'AdminPass1!',
      userType: 'admin',
      roleNames: ['admin'],
    });
    return { email: u.email, password: u.password, id: u.id };
  }

  async function fetchRoleId(name: string): Promise<string> {
    const p: pg.Pool = getTestPool(env!);
    const res = await p.query<{ id: string }>(
      'SELECT id FROM roles WHERE name = $1',
      [name],
    );
    return res.rows[0]!.id;
  }

  describe('POST /users', () => {
    it('creates a new user and returns 201 (admin)', async () => {
      const admin = await seedAdmin();
      const token = await login(admin.email, admin.password);

      const res = await app.inject({
        method: 'POST',
        url: '/users',
        headers: { Authorization: `Bearer ${token}` },
        payload: {
          email: `created-${rand()}@example.test`,
          password: 'NewPass1234!',
          firstName: 'New',
          surname: 'User',
          userType: 'staff',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as Record<string, unknown>;
      expect(body['userType']).toBe('staff');
      expect(body['isActive']).toBe(true);
      expect(typeof body['id']).toBe('string');
      // Password fields never leak.
      expect(body['passwordHash']).toBeUndefined();
      expect(body['password']).toBeUndefined();
    });

    it('returns 409 on duplicate email', async () => {
      const admin = await seedAdmin();
      const token = await login(admin.email, admin.password);
      const email = `dup-${rand()}@example.test`;
      const first = await app.inject({
        method: 'POST',
        url: '/users',
        headers: { Authorization: `Bearer ${token}` },
        payload: {
          email,
          password: 'NewPass1234!',
          firstName: 'Dup',
          surname: 'User',
          userType: 'staff',
        },
      });
      expect(first.statusCode).toBe(201);

      const second = await app.inject({
        method: 'POST',
        url: '/users',
        headers: { Authorization: `Bearer ${token}` },
        payload: {
          email,
          password: 'NewPass1234!',
          firstName: 'Dup2',
          surname: 'User',
          userType: 'staff',
        },
      });
      expect(second.statusCode).toBe(409);
    });

    it('returns 403 for a non-admin role', async () => {
      const provider = await seedUser(env!, {
        email: `prov-${rand()}@example.test`,
        password: 'ProvPass1!',
        userType: 'provider',
        roleNames: ['provider'],
      });
      const token = await login(provider.email, provider.password);
      const res = await app.inject({
        method: 'POST',
        url: '/users',
        headers: { Authorization: `Bearer ${token}` },
        payload: {
          email: `forbidden-${rand()}@example.test`,
          password: 'NewPass1234!',
          firstName: 'No',
          surname: 'Permission',
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns 400 on a weak password (<8 chars)', async () => {
      const admin = await seedAdmin();
      const token = await login(admin.email, admin.password);
      const res = await app.inject({
        method: 'POST',
        url: '/users',
        headers: { Authorization: `Bearer ${token}` },
        payload: {
          email: `weak-${rand()}@example.test`,
          password: 'short',
          firstName: 'A',
          surname: 'B',
        },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /users', () => {
    it('lists users for an admin caller', async () => {
      const admin = await seedAdmin();
      // Seed a second user so the list has > 1 entry.
      await seedUser(env!, {
        email: `extra-${rand()}@example.test`,
        password: 'Pass1234!',
        userType: 'staff',
        roleNames: [],
      });
      const token = await login(admin.email, admin.password);

      const res = await app.inject({
        method: 'GET',
        url: '/users?view=summary',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as Array<Record<string, unknown>>;
      expect(body.length).toBeGreaterThanOrEqual(2);
      // No password leakage in any row.
      for (const row of body) {
        expect(row['passwordHash']).toBeUndefined();
      }
    });

    it('returns 403 for a non-admin role', async () => {
      const provider = await seedUser(env!, {
        email: `prov-list-${rand()}@example.test`,
        password: 'ProvPass1!',
        userType: 'provider',
        roleNames: ['provider'],
      });
      const token = await login(provider.email, provider.password);
      const res = await app.inject({
        method: 'GET',
        url: '/users?view=summary',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('Roles + UserRoles', () => {
    it('creates a role and grants it to a user (with optional facility)', async () => {
      const admin = await seedAdmin();
      const target = await seedUser(env!, {
        email: `target-${rand()}@example.test`,
        password: 'TargetPass1!',
        userType: 'staff',
        roleNames: [],
      });
      const token = await login(admin.email, admin.password);

      // Create a new role.
      const roleRes = await app.inject({
        method: 'POST',
        url: '/roles',
        headers: { Authorization: `Bearer ${token}` },
        payload: { name: `qa-${rand()}`, description: 'QA tester' },
      });
      expect(roleRes.statusCode).toBe(201);
      const role = roleRes.json() as { id: string; name: string };

      // Grant the role to the target user (global scope: no facilityId).
      const grantRes = await app.inject({
        method: 'POST',
        url: '/user-roles',
        headers: { Authorization: `Bearer ${token}` },
        payload: { userId: target.id, roleId: role.id },
      });
      expect(grantRes.statusCode).toBe(201);
      const grant = grantRes.json() as Record<string, unknown>;
      expect(grant['userId']).toBe(target.id);
      expect(grant['roleId']).toBe(role.id);
      expect(grant['roleName']).toBe(role.name);
      expect(grant['facilityId']).toBeNull();

      // Confirm via the listing endpoint.
      const listRes = await app.inject({
        method: 'GET',
        url: `/user-roles?userId=${target.id}`,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(listRes.statusCode).toBe(200);
      const list = listRes.json() as Array<Record<string, unknown>>;
      expect(list.some((r) => r['roleId'] === role.id)).toBe(true);
    });

    it('returns 409 on duplicate grant (same user, role, facility)', async () => {
      const admin = await seedAdmin();
      const target = await seedUser(env!, {
        email: `target-${rand()}@example.test`,
        password: 'TargetPass1!',
        userType: 'staff',
        roleNames: [],
      });
      const token = await login(admin.email, admin.password);
      const roleId = await fetchRoleId('admin'); // exists from seedAdmin

      const first = await app.inject({
        method: 'POST',
        url: '/user-roles',
        headers: { Authorization: `Bearer ${token}` },
        payload: { userId: target.id, roleId },
      });
      expect(first.statusCode).toBe(201);

      const dup = await app.inject({
        method: 'POST',
        url: '/user-roles',
        headers: { Authorization: `Bearer ${token}` },
        payload: { userId: target.id, roleId },
      });
      expect(dup.statusCode).toBe(409);
    });

    it('returns 403 for a non-admin caller', async () => {
      const provider = await seedUser(env!, {
        email: `prov-iam-${rand()}@example.test`,
        password: 'ProvPass1!',
        userType: 'provider',
        roleNames: ['provider'],
      });
      const token = await login(provider.email, provider.password);

      const res = await app.inject({
        method: 'POST',
        url: '/roles',
        headers: { Authorization: `Bearer ${token}` },
        payload: { name: `forbidden-${rand()}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });
});

function rand(): string {
  return Math.random().toString(36).slice(2, 10);
}
