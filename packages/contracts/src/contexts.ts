// Context shapes the shell establishes and hands to modules as props.
// Context flows downward only; modules never mutate or reach upward.

import type {
  WorkspaceId,
  LocationId,
  UserId,
  SessionId,
  PatientId,
  PatientGroupId,
  TabId,
  ModuleId,
} from './ids';

export type WorkspaceType =
  | 'clinic'
  | 'case-management'
  | 'clinical-operations'
  | 'admin';

export interface WorkspaceContext {
  readonly id: WorkspaceId;
  readonly type: WorkspaceType;
  readonly displayName: string;
}

export type LocationKind = 'vessel' | 'clinic';

export interface LocationContext {
  readonly id: LocationId;
  readonly kind: LocationKind;
  readonly displayName: string;
}

export interface UserContext {
  readonly id: UserId;
  readonly displayName: string;
  // Role membership (e.g. 'physician', 'nurse'). Effective permissions are
  // computed by PermissionService from this plus location/workspace context.
  readonly roles: readonly string[];
}

export interface SessionContext {
  readonly id: SessionId;
  readonly workspace: WorkspaceContext;
  readonly location: LocationContext;
  readonly user: UserContext;
  // ISO 8601 timestamp of when the session was established at login.
  readonly startedAt: string;
}

export interface PatientContext {
  readonly id: PatientId;
  readonly displayName: string;
}

// A patient context group binds one patient to a set of patient-scoped tabs.
// Multiple groups may exist concurrently in a session; tabs never silently
// switch patients between groups.
export interface PatientGroup {
  readonly id: PatientGroupId;
  readonly patient: PatientContext;
  readonly tabIds: readonly TabId[];
}

// Lightweight tab descriptor surfaced to modules that need to know what
// else lives in their group. The shell owns full tab state; this is the
// public-contract shape.
export interface TabDescriptor {
  readonly id: TabId;
  readonly moduleId: ModuleId;
  readonly title: string;
  readonly groupId?: PatientGroupId;
}
