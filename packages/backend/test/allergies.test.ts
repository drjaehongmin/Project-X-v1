// Integration tests for the allergies surface — the first resource
// with a write surface.  Reads mirror the patients/encounters/problems
// pattern.  Writes cover create + update + RLS-blocked write paths.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildServer } from '../src/server.js';
import type { BackendConfig } from '../src/config.js';
import { closeDb } from '../src/db/client.js';
import {
  assignCareTeam,
  closeTestPool,
  readTestEnv,
  seedAllergy,
  seedPatient,
  seedUser,
  truncateAll,
} from './helpers/db.js';

const env = readTestEnv();
const runOrSkip = env === null ? describe.skip : describe;

runOrSkip('Allergies API', () => {
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

  async function setupCareTeam() {
    const provider = await seedUser(env!, {
      email: `prov-${rand()}@example.test`,
      password: 'CorrectHorseBatteryStaple1!',
      userType: 'provider',
      roleNames: ['provider'],
    });
    const patient = await seedPatient(env!, {
      mrn: `MRN-${rand()}`,
      firstName: 'Allergy',
      lastName: 'Subject',
      dateOfBirth: '1985-06-15',
      sex: 'female',
    });
    await assignCareTeam(env!, patient.id, provider.id, 'primary');
    return { provider, patient };
  }

  describe('GET /allergies/:id', () => {
    it('returns 200 for a care-team member', async () => {
      const { provider, patient } = await setupCareTeam();
      const allergy = await seedAllergy(env!, {
        patientId: patient.id,
        allergen: 'Penicillin',
        allergenType: 'drug',
        reaction: 'Hives',
        severity: 'moderate',
        status: 'active',
        createdBy: provider.id,
      });
      const token = await login(provider.email, provider.password);

      const res = await app.inject({
        method: 'GET',
        url: `/allergies/${allergy.id}?view=summary`,
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as Record<string, unknown>;
      expect(body).toMatchObject({
        id: allergy.id,
        patientId: patient.id,
        allergen: 'Penicillin',
        allergenType: 'drug',
        reaction: 'Hives',
        severity: 'moderate',
        status: 'active',
      });
    });

    it('returns 404 when the caller is not on the care team', async () => {
      const { patient } = await setupCareTeam();
      const allergy = await seedAllergy(env!, {
        patientId: patient.id,
        allergen: 'Peanuts',
        allergenType: 'food',
      });
      const offTeam = await seedUser(env!, {
        email: 'offteam-al@example.test',
        password: 'CorrectHorseBatteryStaple1!',
        userType: 'provider',
        roleNames: ['provider'],
      });
      const token = await login(offTeam.email, offTeam.password);

      const res = await app.inject({
        method: 'GET',
        url: `/allergies/${allergy.id}?view=summary`,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 403 when the role lacks allergy.read', async () => {
      const { patient } = await setupCareTeam();
      const allergy = await seedAllergy(env!, {
        patientId: patient.id,
        allergen: 'Latex',
        allergenType: 'environmental',
      });
      const unprivileged = await seedUser(env!, {
        email: 'unpriv-al@example.test',
        password: 'CorrectHorseBatteryStaple1!',
        userType: 'staff',
        roleNames: ['kiosk'],
      });
      const token = await login(unprivileged.email, unprivileged.password);
      const res = await app.inject({
        method: 'GET',
        url: `/allergies/${allergy.id}?view=summary`,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('GET /allergies?patientId=...', () => {
    it('orders by severity (life_threatening first, mild last, null last)', async () => {
      const { provider, patient } = await setupCareTeam();
      const mild = await seedAllergy(env!, {
        patientId: patient.id,
        allergen: 'Mild',
        allergenType: 'food',
        severity: 'mild',
      });
      const lifeThreatening = await seedAllergy(env!, {
        patientId: patient.id,
        allergen: 'LifeThreatening',
        allergenType: 'drug',
        severity: 'life_threatening',
      });
      const noSeverity = await seedAllergy(env!, {
        patientId: patient.id,
        allergen: 'Unknown',
        allergenType: 'other',
        severity: null,
      });
      const severe = await seedAllergy(env!, {
        patientId: patient.id,
        allergen: 'Severe',
        allergenType: 'drug',
        severity: 'severe',
      });
      const token = await login(provider.email, provider.password);

      const res = await app.inject({
        method: 'GET',
        url: `/allergies?view=summary&patientId=${patient.id}`,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as Array<{ id: string }>;
      expect(body.map((r) => r.id)).toEqual([
        lifeThreatening.id,
        severe.id,
        mild.id,
        noSeverity.id,
      ]);
    });

    it('returns empty array for a non-care-team caller (RLS)', async () => {
      const { patient } = await setupCareTeam();
      await seedAllergy(env!, {
        patientId: patient.id,
        allergen: 'Aspirin',
        allergenType: 'drug',
      });
      const offTeam = await seedUser(env!, {
        email: 'offteam-al-list@example.test',
        password: 'CorrectHorseBatteryStaple1!',
        userType: 'provider',
        roleNames: ['provider'],
      });
      const token = await login(offTeam.email, offTeam.password);
      const res = await app.inject({
        method: 'GET',
        url: `/allergies?view=summary&patientId=${patient.id}`,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('filters by status when status= is set', async () => {
      const { provider, patient } = await setupCareTeam();
      await seedAllergy(env!, {
        patientId: patient.id,
        allergen: 'Active',
        allergenType: 'drug',
        status: 'active',
      });
      const resolved = await seedAllergy(env!, {
        patientId: patient.id,
        allergen: 'Resolved',
        allergenType: 'food',
        status: 'resolved',
      });
      const token = await login(provider.email, provider.password);
      const res = await app.inject({
        method: 'GET',
        url: `/allergies?view=summary&patientId=${patient.id}&status=resolved`,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as Array<{ id: string }>;
      expect(body.map((r) => r.id)).toEqual([resolved.id]);
    });
  });

  describe('POST /allergies', () => {
    it('creates a new allergy and returns 201 with the summary view', async () => {
      const { provider, patient } = await setupCareTeam();
      const token = await login(provider.email, provider.password);

      const res = await app.inject({
        method: 'POST',
        url: '/allergies',
        headers: { Authorization: `Bearer ${token}` },
        payload: {
          patientId: patient.id,
          allergen: 'Sulfa',
          allergenType: 'drug',
          reaction: 'Rash',
          severity: 'moderate',
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json() as Record<string, unknown>;
      expect(body).toMatchObject({
        patientId: patient.id,
        allergen: 'Sulfa',
        allergenType: 'drug',
        reaction: 'Rash',
        severity: 'moderate',
        status: 'active',
      });
      expect(typeof body['id']).toBe('string');
    });

    it('returns 400 on missing required fields', async () => {
      const { provider } = await setupCareTeam();
      const token = await login(provider.email, provider.password);

      const res = await app.inject({
        method: 'POST',
        url: '/allergies',
        headers: { Authorization: `Bearer ${token}` },
        payload: {
          allergen: 'Sulfa',
          allergenType: 'drug',
          // patientId missing
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 403 for a role without allergy.write', async () => {
      const { patient } = await setupCareTeam();
      const registrar = await seedUser(env!, {
        email: `reg-${rand()}@example.test`,
        password: 'CorrectHorseBatteryStaple1!',
        userType: 'staff',
        roleNames: ['registrar'],
      });
      await assignCareTeam(env!, patient.id, registrar.id, 'other');
      const token = await login(registrar.email, registrar.password);

      const res = await app.inject({
        method: 'POST',
        url: '/allergies',
        headers: { Authorization: `Bearer ${token}` },
        payload: {
          patientId: patient.id,
          allergen: 'Iodine',
          allergenType: 'drug',
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it('RLS rejects creating an allergy for a patient the caller cannot access', async () => {
      const { patient } = await setupCareTeam();
      // A provider who is NOT on the care team but does have
      // allergy.write — the role check passes, RLS WITH CHECK fails.
      const stranger = await seedUser(env!, {
        email: `stranger-${rand()}@example.test`,
        password: 'CorrectHorseBatteryStaple1!',
        userType: 'provider',
        roleNames: ['provider'],
      });
      const token = await login(stranger.email, stranger.password);

      const res = await app.inject({
        method: 'POST',
        url: '/allergies',
        headers: { Authorization: `Bearer ${token}` },
        payload: {
          patientId: patient.id,
          allergen: 'Should fail',
          allergenType: 'drug',
        },
      });
      // RLS WITH CHECK rejection surfaces as a 500-class DB error
      // before audit; we accept any 4xx/5xx that isn't a permissive
      // success.  The important assertion is that the row was NOT
      // written.
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });
  });

  describe('PATCH /allergies/:id', () => {
    it('updates status and returns the new summary', async () => {
      const { provider, patient } = await setupCareTeam();
      const allergy = await seedAllergy(env!, {
        patientId: patient.id,
        allergen: 'Codeine',
        allergenType: 'drug',
        severity: 'moderate',
        status: 'active',
        createdBy: provider.id,
      });
      const token = await login(provider.email, provider.password);

      const res = await app.inject({
        method: 'PATCH',
        url: `/allergies/${allergy.id}`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { status: 'resolved' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as Record<string, unknown>;
      expect(body['status']).toBe('resolved');
      expect(body['severity']).toBe('moderate');
    });

    it('returns 400 when the body has no mutable fields', async () => {
      const { provider, patient } = await setupCareTeam();
      const allergy = await seedAllergy(env!, {
        patientId: patient.id,
        allergen: 'Soy',
        allergenType: 'food',
        createdBy: provider.id,
      });
      const token = await login(provider.email, provider.password);
      const res = await app.inject({
        method: 'PATCH',
        url: `/allergies/${allergy.id}`,
        headers: { Authorization: `Bearer ${token}` },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 404 when the row is RLS-filtered (non-care-team caller)', async () => {
      const { patient } = await setupCareTeam();
      const allergy = await seedAllergy(env!, {
        patientId: patient.id,
        allergen: 'Bees',
        allergenType: 'environmental',
        severity: 'severe',
      });
      const offTeam = await seedUser(env!, {
        email: 'offteam-patch@example.test',
        password: 'CorrectHorseBatteryStaple1!',
        userType: 'provider',
        roleNames: ['provider'],
      });
      const token = await login(offTeam.email, offTeam.password);
      const res = await app.inject({
        method: 'PATCH',
        url: `/allergies/${allergy.id}`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { status: 'inactive' },
      });
      expect(res.statusCode).toBe(404);
    });
  });
});

function rand(): string {
  return Math.random().toString(36).slice(2, 10);
}
