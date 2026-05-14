// Hard-coded clinical fixtures for the prototype data service. Real
// data lands once the FHIR backend wiring exists; this file is the
// single place to look when adjusting what the demo modules see.

import type { Patient } from '@emr/shared';

export const samplePatients: readonly Patient[] = [
  {
    resourceType: 'Patient',
    id: 'patient-fixture-1',
    name: { given: ['Ada'], family: 'Lovelace' },
    birthDate: '1815-12-10',
    gender: 'female',
  },
  {
    resourceType: 'Patient',
    id: 'patient-fixture-2',
    name: { given: ['Alan', 'Mathison'], family: 'Turing' },
    birthDate: '1912-06-23',
    gender: 'male',
  },
  {
    resourceType: 'Patient',
    id: 'patient-fixture-3',
    name: { given: ['Grace'], family: 'Hopper' },
    birthDate: '1906-12-09',
    gender: 'female',
  },
];
