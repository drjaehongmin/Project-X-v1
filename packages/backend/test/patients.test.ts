// Integration tests for the patient summary path.
//
// These talk to a real Postgres (TEST_DATABASE_URL or DATABASE_URL).
// They run only when one of those env vars is set; otherwise the suite
// short-circuits so CI without a DB stays green.

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
  seedUser,
  truncateAll,
} from './helpers/db.js';

const env = readTestEnv();
const runOrSkip = env === null ? describe.skip : describe;

runOrSkip('GET /patients/:id?view=summary', () => {
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

  it('returns 200 with the summary view for a care-team member', async () => {
    const provider = await seedUser(env!, {
      email: 'p1@example.test',
      password: 'CorrectHorseBatteryStaple1!',
      userType: 'provider',
      roleNames: ['provider'],
    });
    const patient = await seedPatient(env!, {
      mrn: 'MRN-0001',
      firstName: 'Ada',
      lastName: 'Lovelace',
      dateOfBirth: '1815-12-10',
      sex: 'female',
    });
    await assignCareTeam(env!, patient.id, provider.id, 'primary');

    const token = await login(provider.email, provider.password);

    const res = await app.inject({
      method: 'GET',
      url: `/patients/${patient.id}?view=summary`,
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      id: patient.id,
      mrn: 'MRN-0001',
      displayName: 'Ada Lovelace',
      dateOfBirth: '1815-12-10',
      sex: 'female',
    });
  });

  it('returns 404 when the caller is not on the care team (RLS-filtered)', async () => {
    const onTeam = await seedUser(env!, {
      email: 'onteam@example.test',
      password: 'CorrectHorseBatteryStaple1!',
      userType: 'provider',
      roleNames: ['provider'],
    });
    const offTeam = await seedUser(env!, {
      email: 'offteam@example.test',
      password: 'CorrectHorseBatteryStaple1!',
      userType: 'provider',
      roleNames: ['provider'],
    });
    const patient = await seedPatient(env!, {
      mrn: 'MRN-0002',
      firstName: 'Grace',
      lastName: 'Hopper',
      dateOfBirth: '1906-12-09',
      sex: 'female',
    });
    await assignCareTeam(env!, patient.id, onTeam.id, 'primary');

    const token = await login(offTeam.email, offTeam.password);

    const res = await app.inject({
      method: 'GET',
      url: `/patients/${patient.id}?view=summary`,
      headers: { Authorization: `Bearer ${token}` },
    });

    // RLS filters the row out; the route can't tell that from a
    // non-existent ID and returns 404 to avoid leaking existence.
    expect(res.statusCode).toBe(404);
  });

  it('returns 401 without a bearer token', async () => {
    const patient = await seedPatient(env!, {
      mrn: 'MRN-0003',
      firstName: 'Edsger',
      lastName: 'Dijkstra',
      dateOfBirth: '1930-05-11',
      sex: 'male',
    });
    const res = await app.inject({
      method: 'GET',
      url: `/patients/${patient.id}?view=summary`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when the role lacks patient.read permission', async () => {
    const unprivileged = await seedUser(env!, {
      email: 'unpriv@example.test',
      password: 'CorrectHorseBatteryStaple1!',
      userType: 'staff',
      // No role grants patient.read.
      roleNames: ['kiosk'],
    });
    const patient = await seedPatient(env!, {
      mrn: 'MRN-0004',
      firstName: 'Alan',
      lastName: 'Turing',
      dateOfBirth: '1912-06-23',
      sex: 'male',
    });
    const token = await login(unprivileged.email, unprivileged.password);

    const res = await app.inject({
      method: 'GET',
      url: `/patients/${patient.id}?view=summary`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('honors _elements to narrow the response shape', async () => {
    const provider = await seedUser(env!, {
      email: 'narrow@example.test',
      password: 'CorrectHorseBatteryStaple1!',
      userType: 'provider',
      roleNames: ['provider'],
    });
    const patient = await seedPatient(env!, {
      mrn: 'MRN-0005',
      firstName: 'Marie',
      lastName: 'Curie',
      dateOfBirth: '1867-11-07',
      sex: 'female',
    });
    await assignCareTeam(env!, patient.id, provider.id, 'primary');

    const token = await login(provider.email, provider.password);

    const res = await app.inject({
      method: 'GET',
      url: `/patients/${patient.id}?view=summary&_elements=id,mrn`,
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body).toEqual({ id: patient.id, mrn: 'MRN-0005' });
  });

  describe('POST /patients', () => {
    it('creates a patient and auto-adds the caller as primary care team', async () => {
      const provider = await seedUser(env!, {
        email: `prov-create-${rand()}@example.test`,
        password: 'CorrectHorseBatteryStaple1!',
        userType: 'provider',
        roleNames: ['provider'],
      });
      const token = await login(provider.email, provider.password);

      const res = await app.inject({
        method: 'POST',
        url: '/patients',
        headers: { Authorization: `Bearer ${token}` },
        payload: {
          mrn: `MRN-${rand()}`,
          firstName: 'New',
          lastName: 'Patient',
          dateOfBirth: '1990-04-15',
          sex: 'female',
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json() as Record<string, unknown>;
      expect(body['displayName']).toBe('New Patient');
      expect(body['dateOfBirth']).toBe('1990-04-15');
      expect(typeof body['id']).toBe('string');

      // The creator should be able to read their own new patient back
      // — proves the care-team self-insert worked under RLS.
      const readBack = await app.inject({
        method: 'GET',
        url: `/patients/${body['id'] as string}?view=summary`,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(readBack.statusCode).toBe(200);
    });

    it('returns 400 on missing required fields', async () => {
      const provider = await seedUser(env!, {
        email: `prov-bad-${rand()}@example.test`,
        password: 'CorrectHorseBatteryStaple1!',
        userType: 'provider',
        roleNames: ['provider'],
      });
      const token = await login(provider.email, provider.password);
      const res = await app.inject({
        method: 'POST',
        url: '/patients',
        headers: { Authorization: `Bearer ${token}` },
        payload: {
          mrn: 'MRN-BAD',
          // firstName missing
          lastName: 'Patient',
          dateOfBirth: '1990-04-15',
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 403 for a role lacking patient.write', async () => {
      const compliance = await seedUser(env!, {
        email: `comp-${rand()}@example.test`,
        password: 'CorrectHorseBatteryStaple1!',
        userType: 'staff',
        roleNames: ['compliance'],
      });
      const token = await login(compliance.email, compliance.password);
      const res = await app.inject({
        method: 'POST',
        url: '/patients',
        headers: { Authorization: `Bearer ${token}` },
        payload: {
          mrn: `MRN-${rand()}`,
          firstName: 'No',
          lastName: 'Permission',
          dateOfBirth: '1990-04-15',
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns 401 without a bearer token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/patients',
        payload: {
          mrn: `MRN-${rand()}`,
          firstName: 'No',
          lastName: 'Token',
          dateOfBirth: '1990-04-15',
        },
      });
      expect(res.statusCode).toBe(401);
    });
  });
});

function rand(): string {
  return Math.random().toString(36).slice(2, 10);
}
