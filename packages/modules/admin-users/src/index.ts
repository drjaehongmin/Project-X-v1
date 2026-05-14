import type { ModuleId, NonPatientModuleManifest } from '@emr/contracts';
import { defineModule, type ModuleDefinition } from '@emr/module-sdk';

import { AdminUsersView } from './Component';

const manifest: NonPatientModuleManifest = {
  id: 'admin-users' as ModuleId,
  displayName: 'Admin Users',
  version: '0.1.0',
  scope: 'general',
  requires: ['session'],
  services: [],
  permissions: [],
};

export const adminUsersModule: ModuleDefinition<NonPatientModuleManifest> =
  defineModule(manifest, AdminUsersView);

export default adminUsersModule;
