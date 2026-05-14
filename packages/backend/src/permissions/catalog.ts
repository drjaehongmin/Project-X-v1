// Canonical permission strings.  Each is `<resource>.<action>`; the
// router uses these as the argument to `requirePermission` so a quick
// grep tells you every place a permission is checked.
//
// This list grows alongside resources.  Phase 2A defines only what the
// patient summary path needs.

export const Permissions = {
  Patient: {
    Read: 'patient.read',
    Write: 'patient.write',
    Delete: 'patient.delete',
  },
  Encounter: {
    Read: 'encounter.read',
    Write: 'encounter.write',
  },
  Problem: {
    Read: 'problem.read',
    Write: 'problem.write',
  },
  Allergy: {
    Read: 'allergy.read',
    Write: 'allergy.write',
  },
  // Identity & access management.  Role.Read is broader than the
  // others (any authenticated user may read the role list, matching
  // the `roles_select_all` RLS policy from migration 0003); Role.Write
  // and both User permissions are admin-only.  user_roles
  // grant/revoke is gated by User.Write since changing a user's role
  // set is a user-management operation.
  User: {
    Read: 'user.read',
    Write: 'user.write',
  },
  Role: {
    Read: 'role.read',
    Write: 'role.write',
  },
  Audit: {
    Read: 'audit.read',
  },
} as const;

// Permission strings, derived from the catalog.  Discriminated as a
// string union so the preHandler accepts only known values.
export type Permission =
  | (typeof Permissions.Patient)[keyof typeof Permissions.Patient]
  | (typeof Permissions.Encounter)[keyof typeof Permissions.Encounter]
  | (typeof Permissions.Problem)[keyof typeof Permissions.Problem]
  | (typeof Permissions.Allergy)[keyof typeof Permissions.Allergy]
  | (typeof Permissions.User)[keyof typeof Permissions.User]
  | (typeof Permissions.Role)[keyof typeof Permissions.Role]
  | (typeof Permissions.Audit)[keyof typeof Permissions.Audit];
