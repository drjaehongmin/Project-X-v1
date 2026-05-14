// Maps a request's roles to a permission set.  This is the coarse
// gate; RLS in Postgres is the fine gate, and per-field response
// filtering is the third layer.
//
// Phase 2A keeps the mapping in code.  When roles + permissions become
// admin-editable, this moves to a `role_permissions` table queried
// once per request and cached.

import { Permissions, type Permission } from './catalog.js';

const ROLE_GRANTS: Record<string, readonly Permission[]> = {
  admin: [
    Permissions.Patient.Read,
    Permissions.Patient.Write,
    Permissions.Patient.Delete,
    Permissions.Encounter.Read,
    Permissions.Encounter.Write,
    Permissions.Problem.Read,
    Permissions.Problem.Write,
    Permissions.Allergy.Read,
    Permissions.Allergy.Write,
    Permissions.User.Read,
    Permissions.User.Write,
    Permissions.Role.Read,
    Permissions.Role.Write,
    Permissions.Audit.Read,
  ],
  provider: [
    Permissions.Patient.Read,
    Permissions.Patient.Write,
    Permissions.Encounter.Read,
    Permissions.Encounter.Write,
    Permissions.Problem.Read,
    Permissions.Problem.Write,
    Permissions.Allergy.Read,
    Permissions.Allergy.Write,
  ],
  clinician: [
    Permissions.Patient.Read,
    Permissions.Patient.Write,
    Permissions.Encounter.Read,
    Permissions.Encounter.Write,
    Permissions.Problem.Read,
    Permissions.Problem.Write,
    Permissions.Allergy.Read,
    Permissions.Allergy.Write,
  ],
  nurse: [
    Permissions.Patient.Read,
    Permissions.Patient.Write,
    Permissions.Encounter.Read,
    Permissions.Encounter.Write,
    // Nurses read problems but do not author them; status transitions
    // (e.g. mark resolved) still go through provider/clinician roles.
    Permissions.Problem.Read,
    // Allergies are different: nurses commonly intake them at triage,
    // so write is granted here.
    Permissions.Allergy.Read,
    Permissions.Allergy.Write,
  ],
  registrar: [
    Permissions.Patient.Read,
    Permissions.Patient.Write,
    Permissions.Encounter.Read,
    Permissions.Encounter.Write,
    Permissions.Problem.Read,
    Permissions.Allergy.Read,
  ],
  compliance: [Permissions.Audit.Read],
  // A patient may read their own problem / encounter / allergy lists
  // via the patient portal; RLS narrows each to rows tied to their
  // own patient_id through app_is_self_patient.
  patient: [
    Permissions.Patient.Read,
    Permissions.Encounter.Read,
    Permissions.Problem.Read,
    Permissions.Allergy.Read,
  ],
};

export function effectivePermissions(
  roles: readonly string[],
): readonly Permission[] {
  const set = new Set<Permission>();
  for (const role of roles) {
    const grants = ROLE_GRANTS[role];
    if (grants !== undefined) {
      for (const p of grants) set.add(p);
    }
  }
  return Array.from(set);
}

export function hasPermission(
  roles: readonly string[],
  needed: Permission,
): boolean {
  for (const role of roles) {
    const grants = ROLE_GRANTS[role];
    if (grants !== undefined && grants.includes(needed)) return true;
  }
  return false;
}
