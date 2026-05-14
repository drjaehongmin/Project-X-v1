import { describe, expect, it } from 'vitest';
import type { Patient } from '@emr/shared';
import { createDataService } from '../src/data';
import { samplePatients } from '../src/fixtures';

describe('DataService stub', () => {
  it('search("Patient") returns the seeded fixtures', async () => {
    const data = createDataService();
    const patients = await data.search<Patient>('Patient');
    expect(patients).toHaveLength(samplePatients.length);
  });

  it('read("Patient", id) returns the matching fixture', async () => {
    const data = createDataService();
    const patient = await data.read<Patient>('Patient', 'patient-fixture-1');
    expect(patient?.name.family).toBe('Lovelace');
  });

  it('read returns null for an unknown id', async () => {
    const data = createDataService();
    expect(await data.read('Patient', 'no-such-id')).toBeNull();
  });

  it('search returns an empty array for unknown resource types', async () => {
    const data = createDataService();
    expect(await data.search('Observation')).toEqual([]);
  });

  it('read returns null for unknown resource types', async () => {
    const data = createDataService();
    expect(await data.read('Encounter', 'anything')).toBeNull();
  });

  it('write echoes the resource back without persisting', async () => {
    const data = createDataService();
    const newPatient: Patient = {
      resourceType: 'Patient',
      id: 'temp-1',
      name: { given: ['New'], family: 'Person' },
    };
    expect(await data.write('Patient', newPatient)).toBe(newPatient);
    // Confirm non-persistence: a subsequent read should not find it.
    expect(await data.read('Patient', 'temp-1')).toBeNull();
  });

  it('delete is a no-op', async () => {
    const data = createDataService();
    await expect(
      data.delete('Patient', 'patient-fixture-1'),
    ).resolves.toBeUndefined();
    // Fixture is still readable (delete did nothing).
    expect(await data.read('Patient', 'patient-fixture-1')).not.toBeNull();
  });
});
