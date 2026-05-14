import type { ModuleId, NonPatientModuleManifest } from '@emr/contracts';
import { defineModule, type ModuleDefinition } from '@emr/module-sdk';

import { PatientCreateView } from './Component';

const manifest: NonPatientModuleManifest = {
  id: 'patient-create' as ModuleId,
  displayName: 'Create Patient',
  version: '0.1.0',
  scope: 'general',
  requires: ['session'],
  services: ['data', 'navigation', 'audit'],
  permissions: ['patient.write'],
};

export const patientCreateModule: ModuleDefinition<NonPatientModuleManifest> =
  defineModule(manifest, PatientCreateView);

export default patientCreateModule;
