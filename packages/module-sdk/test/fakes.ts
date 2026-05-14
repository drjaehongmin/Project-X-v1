// Shared factories for hook tests. Branded IDs are cast at the
// boundary; the runtime is just strings.

import { vi } from 'vitest';
import type {
  AuditEntry,
  AuditEntryId,
  LocationId,
  ModuleEvent,
  ModuleId,
  ModuleServices,
  NonPatientModuleManifest,
  PatientGroupId,
  PatientId,
  PatientModuleManifest,
  PatientModuleProps,
  SessionContext,
  SessionId,
  SessionModuleProps,
  TabId,
  UserId,
  WorkspaceId,
} from '@emr/contracts';
import type { ModuleRuntime } from '../src/context';

const moduleId = 'test-module' as ModuleId;
const userId = 'user-1' as UserId;
const workspaceId = 'ws-1' as WorkspaceId;
const locationId = 'loc-1' as LocationId;
const sessionId = 'session-1' as SessionId;
const patientId = 'patient-1' as PatientId;
const groupId = 'group-1' as PatientGroupId;
const tabId = 'tab-1' as TabId;
const auditEntryId = 'audit-1' as AuditEntryId;

export function makeSession(): SessionContext {
  return {
    id: sessionId,
    workspace: { id: workspaceId, type: 'clinic', displayName: 'Test Clinic' },
    location: { id: locationId, kind: 'vessel', displayName: 'Test Vessel' },
    user: { id: userId, displayName: 'Test User', roles: ['physician'] },
    startedAt: '2026-01-01T00:00:00Z',
  };
}

export function makeServices(): ModuleServices {
  const stubEntry: AuditEntry = {
    id: auditEntryId,
    timestamp: '2026-01-01T00:00:00Z',
    user: userId,
    module: moduleId,
    action: 'noop',
    resource: 'test',
  };
  return {
    audit: {
      log: vi.fn(() => stubEntry),
      list: vi.fn(() => []),
      subscribe: vi.fn(() => () => undefined),
    },
    navigation: {
      openTab: vi.fn(() => tabId),
      openTabInGroup: vi.fn(() => tabId),
      closeTab: vi.fn(async () => true),
      focusTab: vi.fn(),
      openPatientGroup: vi.fn(() => groupId),
      closePatientGroup: vi.fn(async () => true),
      focusPatientGroup: vi.fn(),
    },
    notification: {
      notify: vi.fn(),
      banner: vi.fn(),
      alert: vi.fn(async () => undefined),
      confirm: vi.fn(async () => true),
    },
    permission: {
      can: vi.fn(() => true),
      canAccessPatient: vi.fn(() => true),
      canLaunchModule: vi.fn(() => true),
    },
    data: {
      read: vi.fn(async () => null),
      search: vi.fn(async () => []),
      write: vi.fn(async (_t, r) => r),
      delete: vi.fn(async () => undefined),
    },
  };
}

export function makeSessionProps(): SessionModuleProps {
  return {
    moduleId,
    session: makeSession(),
    services: makeServices(),
  };
}

export function makePatientProps(): PatientModuleProps {
  return {
    ...makeSessionProps(),
    patient: { id: patientId, displayName: 'Test Patient' },
    group: {
      id: groupId,
      patient: { id: patientId, displayName: 'Test Patient' },
      tabIds: [],
    },
  };
}

export function makeSessionManifest(
  scope: 'global' | 'session' | 'general' = 'session',
): NonPatientModuleManifest {
  return {
    id: moduleId,
    displayName: 'Test Module',
    version: '0.1.0',
    scope,
    requires: scope === 'global' ? [] : ['session'],
    services: [],
    permissions: [],
  };
}

export function makePatientManifest(): PatientModuleManifest {
  return {
    id: moduleId,
    displayName: 'Test Patient Module',
    version: '0.1.0',
    scope: 'patient',
    requires: ['session', 'patient'],
    services: [],
    permissions: [],
  };
}

export function makeRuntime(
  variant: 'global' | 'session' | 'general' | 'patient' = 'session',
  emit: (event: ModuleEvent) => void = () => undefined,
): ModuleRuntime {
  if (variant === 'patient') {
    return {
      manifest: makePatientManifest(),
      props: makePatientProps(),
      emit,
    };
  }
  return {
    manifest: makeSessionManifest(variant),
    props: makeSessionProps(),
    emit,
  };
}
