// Module registry. The shell never imports a module's internal source
// directly — it imports a `ModuleDefinition` (manifest + Component) and
// looks it up through the registry. The registry validates every
// manifest at registration time so a broken module never reaches a
// render.

import type {
  ModuleId,
  ModuleManifest,
  ModuleScope,
  ServiceName,
} from '@emr/contracts';
import type { ModuleDefinition } from '@emr/module-sdk';

const KNOWN_SERVICES = new Set<ServiceName>([
  'audit',
  'navigation',
  'notification',
  'permission',
  'data',
]);

const KNOWN_SCOPES = new Set<ModuleScope>([
  'global',
  'session',
  'general',
  'patient',
]);

export interface ModuleRegistry {
  register(def: ModuleDefinition): void;
  get(id: ModuleId): ModuleDefinition | undefined;
  list(filter?: { readonly scope?: ModuleScope }): readonly ModuleDefinition[];
  // Modules a user can launch from the left nav. Excludes 'global'
  // scope (shell-provided, not user-launchable) and applies the
  // supplied permission predicate.
  listLaunchable(
    canLaunch: (def: ModuleDefinition) => boolean,
  ): readonly ModuleDefinition[];
}

export function createModuleRegistry(): ModuleRegistry {
  const modules = new Map<ModuleId, ModuleDefinition>();

  function validate(manifest: ModuleManifest): void {
    if (!manifest.id) {
      throw new Error('Module manifest is missing an id.');
    }
    if (!manifest.displayName) {
      throw new Error(`Module '${manifest.id}' has no displayName.`);
    }
    if (!manifest.version) {
      throw new Error(`Module '${manifest.id}' has no version.`);
    }
    if (!KNOWN_SCOPES.has(manifest.scope)) {
      throw new Error(
        `Module '${manifest.id}' has unknown scope '${manifest.scope}'.`,
      );
    }
    for (const service of manifest.services) {
      if (!KNOWN_SERVICES.has(service)) {
        throw new Error(
          `Module '${manifest.id}' requests unknown service '${service}'.`,
        );
      }
    }
  }

  return {
    register(def) {
      validate(def.manifest);
      if (modules.has(def.manifest.id)) {
        throw new Error(`Duplicate module id: '${def.manifest.id}'.`);
      }
      modules.set(def.manifest.id, def);
    },
    get(id) {
      return modules.get(id);
    },
    list(filter) {
      const all = Array.from(modules.values());
      if (filter?.scope === undefined) return all;
      return all.filter((m) => m.manifest.scope === filter.scope);
    },
    listLaunchable(canLaunch) {
      return Array.from(modules.values())
        .filter((m) => m.manifest.scope !== 'global')
        .filter(canLaunch);
    },
  };
}

// Singleton instance. Populated from `./registered.ts` at boot.
export const moduleRegistry: ModuleRegistry = createModuleRegistry();
