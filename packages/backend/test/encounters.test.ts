// Integration tests for the encounters surface.
//
// Mirrors patients.test.ts: skipped via describe.skip when no DB env
// var is set; each test seeds its own fixtures and truncate runs
// between cases.  Covers both endpoints:
//
//   GET /encounters/:id          — single row
//   GET /encounters?patientId=…  — list

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildServer } from '../src/server.js';
import type { BackendConfig } from '../src/config.js';
import { closeDb } from '../src/db/client.js';
import {
  assignCareTeam,
  closeTestPool,
  readTestEnv,
  seedEncounter,
  seedFacility,
  seedPatient,
  seedProvider,
  seedUser,
  truncateAll,
} from './helpers/db.js';

const env = readTestEnv();
const runOrSkip = env === null ? describe.skip : describe;

runOrSkip('Encounters API', () => {
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

  async function setupPatientWithProvider() {
    const facility = await seedFacility(env!, 'MV Aurora', 'vessel');
    const user = await seedUser(env!, {
      email: `provider-${cryptoIsh()}@example.test`,
      password: 'CorrectHorseBatteryStaple1!',
      userType: 'provider',
      roleNames: ['provider'],
    });
    const provider = await seedProvider(env!, {
      userId: user.id,
      defaultFacilityId: facility.id,
    });
    const patient = await seedPatient(env!, {
      mrn: `MRN-${cryptoIsh()}`,
      firstName: 'Encounter',
      lastName: 'Subject',
      dateOfBirth: '1990-01-01',
      sex: 'female',
    });
    await assignCareTeam(env!, patient.id, user.id, 'primary');
    return { facility, user, provider, patient };
  }

  describe('GET /encounters/:id', () => {
    it('returns 200 with the summary view for a care-team member', async () => {
      const { facility, user, provider, patient } = await setupPatientWithProvider();
      const start = '2026-04-15T09:00:00.000Z';
      const end = '2026-04-15T09:30:00.000Z';
      const encounter = await seedEncounter(env!, {
        patientId: patient.id,
        providerId: provider.id,
        facilityId: facility.id,
        status: 'completed',
        startTime: start,
        endTime: end,
        chiefComplaint: 'Sore throat',
        isTelehealth: false,
      });

      const token = await login(user.email, user.password);

      const res = await app.inject({
        method: 'GET',
        url: `/encounters/${encounter.id}?view=summary`,
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        id: encounter.id,
        patientId: patient.id,
        providerId: provider.id,
        facilityId: facility.id,
        encounterTypeId: null,
        status: 'completed',
        startTime: start,
        endTime: end,
        chiefComplaint: 'Sore throat',
        isTelehealth: false,
      });
    });

    it('returns 404 when the caller is not on the care team (RLS-filtered)', async () => {
      const { facility, provider, patient } = await setupPatientWithProvider();
      const offTeam = await seedUser(env!, {
        email: 'offteam-enc@example.test',
        password: 'CorrectHorseBatteryStaple1!',
        userType: 'provider',
        roleNames: ['provider'],
      });
      const encounter = await seedEncounter(env!, {
        patientId: patient.id,
        providerId: provider.id,
        facilityId: facility.id,
      });

      const token = await login(offTeam.email, offTeam.password);

      const res = await app.inject({
        method: 'GET',
        url: `/encounters/${encounter.id}?view=summary`,
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 401 without a bearer token', async () => {
      const { facility, provider, patient } = await setupPatientWithProvider();
      const encounter = await seedEncounter(env!, {
        patientId: patient.id,
        providerId: provider.id,
        facilityId: facility.id,
      });
      const res = await app.inject({
        method: 'GET',
        url: `/encounters/${encounter.id}?view=summary`,
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 403 when the role lacks encounter.read permission', async () => {
      const { facility, provider, patient } = await setupPatientWithProvider();
      const encounter = await seedEncounter(env!, {
        patientId: patient.id,
        providerId: provider.id,
        facilityId: facility.id,
      });
      const unprivileged = await seedUser(env!, {
        email: 'unpriv-enc@example.test',
        password: 'CorrectHorseBatteryStaple1!',
        userType: 'staff',
        roleNames: ['kiosk'],
      });
      const token = await login(unprivileged.email, unprivileged.password);

      const res = await app.inject({
        method: 'GET',
        url: `/encounters/${encounter.id}?view=summary`,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('honors _elements to narrow the response shape', async () => {
      const { facility, user, provider, patient } = await setupPatientWithProvider();
      const encounter = await seedEncounter(env!, {
        patientId: patient.id,
        providerId: provider.id,
        facilityId: facility.id,
        status: 'arrived',
      });
      const token = await login(user.email, user.password);

      const res = await app.inject({
        method: 'GET',
        url: `/encounters/${encounter.id}?view=summary&_elements=id,status`,
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ id: encounter.id, status: 'arrived' });
    });
  });

  describe('GET /encounters?patientId=...', () => {
    it('returns rows for a care-team member, ordered by start_time desc', async () => {
      const { facility, user, provider, patient } = await setupPatientWithProvider();
      const older = await seedEncounter(env!, {
        patientId: patient.id,
        providerId: provider.id,
        facilityId: facility.id,
        startTime: '2026-01-10T08:00:00.000Z',
      });
      const newer = await seedEncounter(env!, {
        patientId: patient.id,
        providerId: provider.id,
        facilityId: facility.id,
        startTime: '2026-04-20T08:00:00.000Z',
      });

      const token = await login(user.email, user.password);

      const res = await app.inject({
        method: 'GET',
        url: `/encounters?view=summary&patientId=${patient.id}`,
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as Array<{ id: string; startTime: string }>;
      expect(body.map((r) => r.id)).toEqual([newer.id, older.id]);
    });

    it('returns an empty array when the caller cannot see the patient (RLS-filtered)', async () => {
      const { facility, provider, patient } = await setupPatientWithProvider();
      await seedEncounter(env!, {
        patientId: patient.id,
        providerId: provider.id,
        facilityId: facility.id,
      });
      const offTeam = await seedUser(env!, {
        email: 'offteam-list@example.test',
        password: 'CorrectHorseBatteryStaple1!',
        userType: 'provider',
        roleNames: ['provider'],
      });
      const token = await login(offTeam.email, offTeam.password);

      const res = await app.inject({
        method: 'GET',
        url: `/encounters?view=summary&patientId=${patient.id}`,
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('returns 400 when patientId is missing', async () => {
      const { user } = await setupPatientWithProvider();
      const token = await login(user.email, user.password);
      const res = await app.inject({
        method: 'GET',
        url: '/encounters?view=summary',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 401 without a bearer token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/encounters?view=summary&patientId=${'00000000-0000-0000-0000-000000000000'}`,
      });
      expect(res.statusCode).toBe(401);
    });

    it('honors _elements to narrow each item in the array', async () => {
      const { facility, user, provider, patient } = await setupPatientWithProvider();
      const enc = await seedEncounter(env!, {
        patientId: patient.id,
        providerId: provider.id,
        facilityId: facility.id,
        status: 'arrived',
      });
      const token = await login(user.email, user.password);

      const res = await app.inject({
        method: 'GET',
        url: `/encounters?view=summary&patientId=${patient.id}&_elements=id,status`,
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([{ id: enc.id, status: 'arrived' }]);
    });
  });
});

// Lightweight unique-ish suffix for emails/MRNs to avoid collisions
// within a single test run.  beforeEach truncates, so a counter would
// also work, but a random base-36 chunk is cheaper to maintain.
function cryptoIsh(): string {
  return Math.random().toString(36).slice(2, 10);
}
