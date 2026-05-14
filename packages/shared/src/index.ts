// @emr/shared — FHIR type stubs, permissions helpers, and other
// cross-cutting utilities that more than one layer needs.

export type {
  FhirResource,
  HumanName,
  Patient,
  Practitioner,
  Reference,
  Encounter,
  Observation,
} from './fhir';

export {
  computeEffectivePermissions,
  permits,
} from './permissions';
export type { PermissionInputs } from './permissions';
