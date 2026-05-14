import type { ModuleServices } from '@emr/contracts';
import { useModuleRuntime } from '../context';

// Returns the per-module services bundle the shell injected. Each
// service in the bundle is scoped to this module (e.g. audit entries
// are pre-bound to the module's ID).
export function useServices(): ModuleServices {
  const { manifest, props } = useModuleRuntime();
  if (manifest.scope === 'global') {
    throw new Error(
      `[@emr/module-sdk] useServices is not valid in a global-scoped module ` +
        `('${manifest.id}'). Global modules are themselves shell-provided services.`,
    );
  }
  return props.services;
}
