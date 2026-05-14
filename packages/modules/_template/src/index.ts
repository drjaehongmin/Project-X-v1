// @emr/module-template — public entry point.
//
// Single export: the ModuleDefinition (manifest + Component) the shell
// registers. New modules generated from this template should change:
//   - the package name (in package.json)
//   - the manifest id and displayName
//   - the manifest scope and requires (if not 'general' / ['session'])
//   - the component implementation (in ./Component.tsx)
//
// The shape stays: a manifest object passed to defineModule alongside a
// component that takes no props.

import type { ModuleId, NonPatientModuleManifest } from '@emr/contracts';
import { defineModule, type ModuleDefinition } from '@emr/module-sdk';

import { TemplateView } from './Component';

const manifest: NonPatientModuleManifest = {
  id: 'template' as ModuleId,
  displayName: 'Template',
  version: '0.1.0',
  scope: 'general',
  requires: ['session'],
  services: [],
  permissions: [],
};

export const templateModule: ModuleDefinition<NonPatientModuleManifest> =
  defineModule(manifest, TemplateView);

export default templateModule;
