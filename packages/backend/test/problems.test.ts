// Integration tests for the problems surface.
//
// Mirrors patients.test.ts / encounters.test.ts: skipped via
// describe.skip when no DB env var is set; each test seeds its own
// fixtures and truncate runs between cases.  Covers both endpoints:
//
//   GET /problems/:id            — single row
//   GET /problems?patientId=…    — list (with optional status filter)

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildServer } from '../src/server.js';
import type { BackendConfig } from '../src/config.js';
import { closeDb } from '../src/db/client.js';
import {
  assignCareTeam,
  closeTestPool,
  readTestEnv,
  seedPatient,
  seedProblem,
  seedUser,
  truncateAll,
} from './helpers/db.js';

const env = readTestEnv();
const runOrSkip = env === null ? describe.skip : describe;

runOrSkip('Problems API', () => {
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
    const body = res.json() as { accessToken: string };
    return body.accessToken;
  }

  async function setupCareTeam() {
    const provider = await seedUser(env!, {
      email: `prov-${rand()}@example.test`,
      password: 'CorrectHorseBatteryStaple1!',
      userType: 'provider',
      roleNames: ['provider'],
    });
    const patient = await seedPatient(env!, {
      mrn: `MRN-${rand()}`,
      firstName: 'Problem',
      lastName: 'Subject',
      dateOfBirth: '1985-06-15',
      sex: 'male',
    });
    await assignCareTeam(env!, patient.id, provider.id, 'primary');
    return { provider, patient };
  }

  describe('GET /problems/:id', () => {
    it('returns 200 with the summary view for a care-team member', async () => {
      const { provider, patient } = await setupCareTeam();
      const problem = await seedProblem(env!, {
        patientId: patient.id,
        description: 'Essential hypertension',
        icd10Code: 'I10',
        status: 'active',
        onsetDate: '2025-03-04',
      });
      const token = await login(provider.email, provider.password);

      const res = await app.inject({
        method: 'GET',
        url: `/problems/${problem.id}?view=summary`,
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        id: problem.id,
        patientId: patient.id,
        icd10Code: 'I10',
        description: 'Essential hypertension',
        status: 'active',
        onsetDate: '2025-03-04',
        resolvedDate: null,
      });
    });

    it('returns 404 when the caller is not on the care team (RLS-filtered)', async () => {
      const { patient } = await setupCareTeam();
      const problem = await seedProblem(env!, {
        patientId: patient.id,
        description: 'Asthma',
        icd10Code: 'J45.909',
        status: 'active',
      });
      const offTeam = await seedUser(env!, {
        email: 'offteam-prob@example.test',
        password: 'CorrectHorseBatteryStaple1!',
        userType: 'provider',
        roleNames: ['provider'],
      });
      const token = await login(offTeam.email, offTeam.password);

      const res = await app.inject({
        method: 'GET',
        url: `/problems/${problem.id}?view=summary`,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 401 without a bearer token', async () => {
      const { patient } = await setupCareTeam();
      const problem = await seedProblem(env!, {
        patientId: patient.id,
        description: 'Type 2 diabetes',
        icd10Code: 'E11.9',
      });
      const res = await app.inject({
        method: 'GET',
        url: `/problems/${problem.id}?view=summary`,
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 403 when the role lacks problem.read permission', async () => {
      const { patient } = await setupCareTeam();
      const problem = await seedProblem(env!, {
        patientId: patient.id,
        description: 'Migraine',
      });
      const unprivileged = await seedUser(env!, {
        email: 'unpriv-prob@example.test',
        password: 'CorrectHorseBatteryStaple1!',
        userType: 'staff',
        roleNames: ['kiosk'],
      });
      const token = await login(unprivileged.email, unprivileged.password);

      const res = await app.inject({
        method: 'GET',
        url: `/problems/${problem.id}?view=summary`,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('honors _elements to narrow the response shape', async () => {
      const { provider, patient } = await setupCareTeam();
      const problem = await seedProblem(env!, {
        patientId: patient.id,
        description: 'GERD',
        icd10Code: 'K21.9',
        status: 'active',
      });
      const token = await login(provider.email, provider.password);

      const res = await app.inject({
        method: 'GET',
        url: `/problems/${problem.id}?view=summary&_elements=id,description`,
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ id: problem.id, description: 'GERD' });
    });
  });

  describe('GET /problems?patientId=...', () => {
    it('returns active before inactive before resolved, then by onset desc', async () => {
      const { provider, patient } = await setupCareTeam();
      const inactive = await seedProblem(env!, {
        patientId: patient.id,
        description: 'Inactive condition',
        status: 'inactive',
        onsetDate: '2024-01-01',
      });
      const resolvedOld = await seedProblem(env!, {
        patientId: patient.id,
        description: 'Old resolved condition',
        status: 'resolved',
        onsetDate: '2020-01-01',
        resolvedDate: '2021-01-01',
      });
      const activeRecent = await seedProblem(env!, {
        patientId: patient.id,
        description: 'Recent active',
        status: 'active',
        onsetDate: '2026-03-01',
      });
      const activeOld = await seedProblem(env!, {
        patientId: patient.id,
        description: 'Old active',
        status: 'active',
        onsetDate: '2024-06-15',
      });

      const token = await login(provider.email, provider.password);
      const res = await app.inject({
        method: 'GET',
        url: `/problems?view=summary&patientId=${patient.id}`,
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as Array<{ id: string }>;
      expect(body.map((r) => r.id)).toEqual([
        activeRecent.id, // active, newer onset
        activeOld.id,    // active, older onset
        inactive.id,     // inactive
        resolvedOld.id,  // resolved
      ]);
    });

    it('filters by status when ?status= is provided', async () => {
      const { provider, patient } = await setupCareTeam();
      await seedProblem(env!, {
        patientId: patient.id,
        description: 'Active 1',
        status: 'active',
      });
      const resolved = await seedProblem(env!, {
        patientId: patient.id,
        description: 'Resolved 1',
        status: 'resolved',
        resolvedDate: '2025-12-01',
      });
      const token = await login(provider.email, provider.password);

      const res = await app.inject({
        method: 'GET',
        url: `/problems?view=summary&patientId=${patient.id}&status=resolved`,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as Array<{ id: string; status: string }>;
      expect(body.map((r) => r.id)).toEqual([resolved.id]);
      expect(body[0]!.status).toBe('resolved');
    });

    it('returns an empty array when the caller cannot see the patient (RLS-filtered)', async () => {
      const { patient } = await setupCareTeam();
      await seedProblem(env!, {
        patientId: patient.id,
        description: 'Hidden problem',
        status: 'active',
      });
      const offTeam = await seedUser(env!, {
        email: 'offteam-prob-list@example.test',
        password: 'CorrectHorseBatteryStaple1!',
        userType: 'provider',
        roleNames: ['provider'],
      });
      const token = await login(offTeam.email, offTeam.password);

      const res = await app.inject({
        method: 'GET',
        url: `/problems?view=summary&patientId=${patient.id}`,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('returns 400 when patientId is missing', async () => {
      const { provider } = await setupCareTeam();
      const token = await login(provider.email, provider.password);
      const res = await app.inject({
        method: 'GET',
        url: '/problems?view=summary',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 401 without a bearer token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/problems?view=summary&patientId=${'00000000-0000-0000-0000-000000000000'}`,
      });
      expect(res.statusCode).toBe(401);
    });

    it('honors _elements to narrow each item', async () => {
      const { provider, patient } = await setupCareTeam();
      const prob = await seedProblem(env!, {
        patientId: patient.id,
        description: 'Allergic rhinitis',
        icd10Code: 'J30.9',
        status: 'active',
      });
      const token = await login(provider.email, provider.password);

      const res = await app.inject({
        method: 'GET',
        url: `/problems?view=summary&patientId=${patient.id}&_elements=id,icd10Code`,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([{ id: prob.id, icd10Code: 'J30.9' }]);
    });
  });
});

function rand(): string {
  return Math.random().toString(36).slice(2, 10);
}
