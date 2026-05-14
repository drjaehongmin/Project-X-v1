// Stub DataService. Read/search return fixtures from src/fixtures.ts
// for known resource types; everything else is empty/null. Write echoes
// the resource back; delete is a no-op. The prototype's only goal here
// is to give demo modules something concrete to render.

import type { DataService } from '@emr/contracts';
import { samplePatients } from './fixtures';

export function createDataService(): DataService {
  return {
    async read<T = unknown>(
      resourceType: string,
      id: string,
    ): Promise<T | null> {
      if (resourceType === 'Patient') {
        const found = samplePatients.find((p) => p.id === id);
        return (found ?? null) as T | null;
      }
      return null;
    },

    async search<T = unknown>(resourceType: string): Promise<readonly T[]> {
      if (resourceType === 'Patient') {
        return samplePatients as unknown as readonly T[];
      }
      return [];
    },

    async write<T = unknown>(_resourceType: string, resource: T): Promise<T> {
      return resource;
    },

    async delete(_resourceType: string, _id: string): Promise<void> {
      // no-op; the stub does not persist anything.
    },
  };
}
