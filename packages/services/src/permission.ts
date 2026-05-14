// Stub PermissionService. The prototype is fully permissive: every
// `can` check, every patient-access check, and every module launch is
// allowed. The shape exists so modules can call PermissionService
// uniformly — the real policy lands once roles, locations, workspaces,
// and patient consent are wired through to the backend.
//
// `can` delegates to the wildcard-aware `permits` helper in
// `@emr/shared` so the seam between policy primitives (shared) and the
// runtime service (this file) is exercised even while the policy
// itself is a no-op.

import type {
  ModuleManifest,
  PatientId,
  PermissionService,
} from '@emr/contracts';
import { computeEffectivePermissions, permits } from '@emr/shared';

export interface PermissionContext {
  readonly userRoles: readonly string[];
}

export function createPermissionService(
  ctx: PermissionContext,
): PermissionService {
  const granted = computeEffectivePermissions({ userRoles: ctx.userRoles });

  return {
    can(action: string, resource: string): boolean {
      return permits(granted, action, resource);
    },
    canAccessPatient(_patientId: PatientId): boolean {
      return true;
    },
    canLaunchModule(_manifest: ModuleManifest): boolean {
      return true;
    },
  };
}
