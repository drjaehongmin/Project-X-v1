// The canonical list of modules the shell knows about. The shell never
// reaches past this file to import a module's source directly; each
// module is added by its public package entry.
//
// `_template` is the generator source — not registered here on
// purpose. Real modules live alongside it under `packages/modules/*`
// and are added by running `pnpm new-module <name> [--scope=...]`.

import { patientCreateModule } from '@emr/module-patient-create';
import { adminUsersModule } from '@emr/module-admin-users';
import type { ModuleDefinition } from '@emr/module-sdk';

export const registeredModules: readonly ModuleDefinition[] = [
  patientCreateModule,
  adminUsersModule,
];
