// Service interfaces. Modules never instantiate these — the shell
// injects per-module instances via props. Each interface here is the
// contract; concrete (prototype-stub) implementations live in
// @emr/services.

import type {
  AuditEntryId,
  ModuleId,
  PatientGroupId,
  PatientId,
  TabId,
  UserId,
} from './ids';
import type { PatientContext } from './contexts';
import type { ModuleManifest } from './manifest';

// AuditService -------------------------------------------------------------

export interface AuditEntry {
  readonly id: AuditEntryId;
  // ISO 8601.
  readonly timestamp: string;
  readonly user: UserId;
  readonly module: ModuleId;
  readonly action: string;
  readonly resource: string;
  readonly patient?: PatientId;
  readonly before?: unknown;
  readonly after?: unknown;
  // Required for break-glass / override paths.
  readonly reason?: string;
}

// The fields a module supplies when logging. The shell pre-binds the
// other fields (`id`, `timestamp`, `user`, `module`) from session and
// module identity, so a module can neither spoof another user nor
// misattribute the audit entry to another module.
export interface AuditLogInput {
  readonly action: string;
  readonly resource: string;
  readonly patient?: PatientId;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly reason?: string;
}

export interface AuditFilter {
  readonly user?: UserId;
  readonly patient?: PatientId;
  readonly module?: ModuleId;
  // ISO 8601 bounds.
  readonly since?: string;
  readonly until?: string;
}

export interface AuditService {
  log(entry: AuditLogInput): AuditEntry;
  list(filter?: AuditFilter): readonly AuditEntry[];
  // Returns an unsubscribe function. The shell's audit panel uses this.
  subscribe(listener: (entry: AuditEntry) => void): () => void;
}

// NavigationService --------------------------------------------------------

export interface OpenTabRequest {
  readonly moduleId: ModuleId;
  readonly params?: Readonly<Record<string, unknown>>;
}

export interface OpenPatientGroupRequest {
  readonly patient: PatientContext;
  // Optional: open this module as the group's first tab in the same call.
  readonly initialTab?: OpenTabRequest;
}

// Modules request navigation; the shell decides whether to honor it
// (permissions, scope compatibility, unsaved-state prompts).
export interface NavigationService {
  // Open a session- or general-scoped module as a top-level tab.
  openTab(req: OpenTabRequest): TabId;

  // Open a patient-scoped module as a tab inside an existing group.
  openTabInGroup(groupId: PatientGroupId, req: OpenTabRequest): TabId;

  // Resolves to false if a module's canClose() returned false.
  closeTab(id: TabId): Promise<boolean>;

  focusTab(id: TabId): void;

  openPatientGroup(req: OpenPatientGroupRequest): PatientGroupId;

  // Closing a group prompts for unsaved state across all its tabs.
  closePatientGroup(id: PatientGroupId): Promise<boolean>;

  focusPatientGroup(id: PatientGroupId): void;
}

// NotificationService ------------------------------------------------------

export type NotificationLevel = 'info' | 'success' | 'warning' | 'error';

export interface NotificationAction {
  readonly label: string;
  readonly run: () => void;
}

export interface NotificationOptions {
  readonly level?: NotificationLevel;
  readonly durationMs?: number;
  readonly actions?: readonly NotificationAction[];
}

export interface NotificationService {
  // Transient toast.
  notify(message: string, options?: NotificationOptions): void;
  // Sticky banner in the chrome.
  banner(message: string, options?: NotificationOptions): void;
  // Modal alert; resolves when the user dismisses.
  alert(message: string): Promise<void>;
  // Modal confirm; resolves true on confirm, false on cancel.
  confirm(message: string): Promise<boolean>;
}

// PermissionService --------------------------------------------------------

// Effective permissions are the intersection of user role, location,
// workspace, and patient-specific access. Modules never compute this
// themselves — they ask.
export interface PermissionService {
  can(action: string, resource: string): boolean;
  canAccessPatient(patientId: PatientId): boolean;
  canLaunchModule(manifest: ModuleManifest): boolean;
}

// DataService --------------------------------------------------------------

export interface DataReadOptions {
  readonly signal?: AbortSignal;
}

export interface DataSearchOptions extends DataReadOptions {
  // FHIR-shaped search parameters. The prototype implementation ignores
  // these and returns fixtures; real backends translate them to queries.
  readonly params?: Readonly<Record<string, unknown>>;
}

// FHIR-shaped facade. Resource type is a string (e.g. 'Patient',
// 'Observation'); the resource payload is `unknown` at this layer and is
// narrowed by callers using the FHIR type stubs in @emr/shared.
export interface DataService {
  read<T = unknown>(
    resourceType: string,
    id: string,
    options?: DataReadOptions,
  ): Promise<T | null>;

  search<T = unknown>(
    resourceType: string,
    options?: DataSearchOptions,
  ): Promise<readonly T[]>;

  write<T = unknown>(resourceType: string, resource: T): Promise<T>;

  delete(resourceType: string, id: string): Promise<void>;
}
