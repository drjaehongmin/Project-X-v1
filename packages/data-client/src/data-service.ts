// HTTP-backed DataService implementing the @emr/contracts interface.
// The shell injects this in place of the in-memory stub from
// @emr/services whenever an API base URL is configured.
//
// The dispatch is by `resourceType` string.  Each resource has a
// fixed URL base (see RESOURCE_PATHS).  read() and search() call GET;
// write() dispatches by `id` presence: a resource with an `id` is
// PATCH'd, one without is POST'd.

import type {
  DataReadOptions,
  DataSearchOptions,
  DataService,
} from '@emr/contracts';

import type { HttpClient } from './fetch.js';
import { HttpError } from './fetch.js';

// ---------- Per-resource wire shapes ----------

export interface PatientSummary {
  readonly id: string;
  readonly mrn: string;
  readonly displayName: string;
  readonly dateOfBirth: string;
  readonly sex?: 'male' | 'female' | 'intersex' | 'unknown' | null;
}

export type EncounterStatus =
  | 'scheduled'
  | 'arrived'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'no_show';

export interface EncounterSummary {
  readonly id: string;
  readonly patientId: string;
  readonly providerId: string;
  readonly facilityId: string;
  readonly encounterTypeId: string | null;
  readonly status: EncounterStatus;
  readonly startTime: string;
  readonly endTime: string | null;
  readonly chiefComplaint: string | null;
  readonly isTelehealth: boolean;
}

export type ProblemStatus = 'active' | 'inactive' | 'resolved';

export interface ProblemSummary {
  readonly id: string;
  readonly patientId: string;
  readonly icd10Code: string | null;
  readonly description: string;
  readonly status: ProblemStatus;
  readonly onsetDate: string | null;
  readonly resolvedDate: string | null;
}

export type AllergenType = 'drug' | 'food' | 'environmental' | 'other';
export type AllergySeverity =
  | 'mild'
  | 'moderate'
  | 'severe'
  | 'life_threatening';
export type AllergyStatus = 'active' | 'inactive' | 'resolved';

export interface AllergySummary {
  readonly id: string;
  readonly patientId: string;
  readonly allergen: string;
  readonly allergenType: AllergenType;
  readonly reaction: string | null;
  readonly severity: AllergySeverity | null;
  readonly status: AllergyStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type UserType = 'staff' | 'provider' | 'admin' | 'patient';

export interface UserSummary {
  readonly id: string;
  readonly email: string;
  readonly firstName: string;
  readonly surname: string;
  readonly userType: UserType;
  readonly isActive: boolean;
  readonly createdAt: string;
}

export interface RoleSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly createdAt: string;
}

export interface UserRoleSummary {
  readonly userId: string;
  readonly roleId: string;
  readonly roleName: string;
  readonly facilityId: string | null;
  readonly facilityName: string | null;
  readonly createdAt: string;
}

// ---------- URL routing ----------

const RESOURCE_PATHS: Readonly<Record<string, string>> = {
  Patient: '/patients',
  Encounter: '/encounters',
  Problem: '/problems',
  Allergy: '/allergies',
  // Admin / IAM surfaces.  `User`, `Role`, `UserRole` all map to
  // distinct URL bases; the generic POST/PATCH dispatch handles them
  // exactly like clinical resources.
  User: '/users',
  Role: '/roles',
  UserRole: '/user-roles',
};

function resourcePath(resourceType: string): string | null {
  return RESOURCE_PATHS[resourceType] ?? null;
}

// ---------- DataService factory ----------

export function createHttpDataService(http: HttpClient): DataService {
  return {
    async read<T = unknown>(
      resourceType: string,
      id: string,
      options?: DataReadOptions,
    ): Promise<T | null> {
      const base = resourcePath(resourceType);
      if (base === null) return null;
      try {
        const data = await http.get<unknown>(`${base}/${id}`, {
          query: { view: 'summary' },
          ...(options?.signal !== undefined && { signal: options.signal }),
        });
        return data as T;
      } catch (err) {
        if (err instanceof HttpError && err.status === 404) return null;
        throw err;
      }
    },

    async search<T = unknown>(
      resourceType: string,
      options?: DataSearchOptions,
    ): Promise<readonly T[]> {
      const base = resourcePath(resourceType);
      if (base === null) return [];
      const params = options?.params ?? {};
      // Pass all string / number params through.  The backend
      // validates required ones (e.g. `patientId` on clinical lists)
      // and surfaces 400 if absent — we don't short-circuit here so
      // admin endpoints like `GET /users` work without forcing a
      // patient context.
      const query: Record<string, string> = { view: 'summary' };
      for (const [key, value] of Object.entries(params)) {
        if (typeof value === 'string' && value !== '') {
          query[key] = value;
        } else if (typeof value === 'number' && Number.isFinite(value)) {
          query[key] = String(value);
        }
      }
      const data = await http.get<readonly unknown[]>(base, {
        query,
        ...(options?.signal !== undefined && { signal: options.signal }),
      });
      return data as readonly T[];
    },

    async write<T = unknown>(resourceType: string, resource: T): Promise<T> {
      const base = resourcePath(resourceType);
      if (base === null) {
        throw new Error(`Unsupported resource type for write: ${resourceType}`);
      }
      // `id` present → PATCH the existing row; absent → POST a new one.
      // The PATCH body is the resource minus its id (id is in the URL).
      const obj =
        typeof resource === 'object' && resource !== null
          ? (resource as Record<string, unknown>)
          : {};
      const id = obj['id'];
      if (typeof id === 'string' && id !== '') {
        const { id: _id, ...patch } = obj;
        void _id;
        const data = await http.patch<unknown>(`${base}/${id}`, patch);
        return data as T;
      }
      const data = await http.post<unknown>(base, obj);
      return data as T;
    },

    async delete(_resourceType: string, _id: string): Promise<void> {
      // No DELETE endpoint surfaced yet; soft-delete via PATCH status
      // is the canonical retirement path for clinical resources.
    },
  };
}

