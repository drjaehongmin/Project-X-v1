// Permissions helpers. The PermissionService in @emr/services is the
// runtime entry point; this file holds the reusable primitives it
// (and any module that needs to compute permission predicates locally)
// builds on. Both pieces are stubs in the prototype.

export interface PermissionInputs {
  readonly userRoles: readonly string[];
  readonly locationRoles?: readonly string[];
  readonly workspaceRoles?: readonly string[];
  readonly patientRoles?: readonly string[];
}

// In the real system this would intersect the role/location/workspace/
// patient permission sets and apply explicit denies. The prototype is
// fully permissive and signals that with a wildcard.
export function computeEffectivePermissions(
  _inputs: PermissionInputs,
): readonly string[] {
  return ['*'];
}

// Wildcard-aware check. Accepts entries of the form 'action:resource',
// 'action:*', or '*' (everything).
export function permits(
  granted: readonly string[],
  action: string,
  resource: string,
): boolean {
  if (granted.includes('*')) return true;
  if (granted.includes(`${action}:*`)) return true;
  return granted.includes(`${action}:${resource}`);
}
