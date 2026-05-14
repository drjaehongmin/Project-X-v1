import { describe, expect, it } from 'vitest';
import type {
  ModuleId,
  ModuleManifest,
  PatientId,
} from '@emr/contracts';
import { createPermissionService } from '../src/permission';

const sessionManifest: ModuleManifest = {
  id: 'test-module' as ModuleId,
  displayName: 'Test',
  version: '0.1.0',
  scope: 'session',
  requires: ['session'],
  services: [],
  permissions: [],
};

const patientManifest: ModuleManifest = {
  id: 'test-patient-module' as ModuleId,
  displayName: 'Test Patient',
  version: '0.1.0',
  scope: 'patient',
  requires: ['session', 'patient'],
  services: [],
  permissions: [],
};

describe('PermissionService stub', () => {
  it('can() returns true for any (action, resource) pair', () => {
    const perm = createPermissionService({ userRoles: ['physician'] });
    expect(perm.can('view', 'Patient')).toBe(true);
    expect(perm.can('write', 'Encounter')).toBe(true);
    expect(perm.can('delete', 'Observation')).toBe(true);
  });

  it('can() is permissive even with an empty role set (prototype)', () => {
    const perm = createPermissionService({ userRoles: [] });
    expect(perm.can('view', 'Patient')).toBe(true);
  });

  it('canAccessPatient always returns true', () => {
    const perm = createPermissionService({ userRoles: ['nurse'] });
    expect(perm.canAccessPatient('p1' as PatientId)).toBe(true);
    expect(perm.canAccessPatient('p2' as PatientId)).toBe(true);
  });

  it('canLaunchModule returns true for any manifest scope', () => {
    const perm = createPermissionService({ userRoles: [] });
    expect(perm.canLaunchModule(sessionManifest)).toBe(true);
    expect(perm.canLaunchModule(patientManifest)).toBe(true);
  });
});
