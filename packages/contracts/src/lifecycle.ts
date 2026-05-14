// What the shell hands a module on mount, the lifecycle hooks every
// module implements, and the events modules may emit back to the shell.

import type { ModuleId } from './ids';
import type {
  PatientContext,
  PatientGroup,
  SessionContext,
} from './contexts';
import type {
  AuditService,
  DataService,
  NavigationService,
  NotificationService,
  PermissionService,
} from './services';

// The fully wired services bundle a module receives. Each service is the
// per-module instance (e.g. an AuditService that has the module ID
// pre-bound), not a global singleton.
export interface ModuleServices {
  readonly audit: AuditService;
  readonly navigation: NavigationService;
  readonly notification: NotificationService;
  readonly permission: PermissionService;
  readonly data: DataService;
}

// Common props every launchable module receives.
export interface SessionModuleProps {
  readonly moduleId: ModuleId;
  readonly session: SessionContext;
  readonly services: ModuleServices;
  // Free-form params supplied by whoever opened the tab (typically via
  // NavigationService.openTab). Modules narrow this themselves.
  readonly params?: Readonly<Record<string, unknown>>;
}

// Props for a patient-scoped module. The shell guarantees `group` and
// `patient` are populated; modules never have to check.
export interface PatientModuleProps extends SessionModuleProps {
  readonly group: PatientGroup;
  readonly patient: PatientContext;
}

export type ModuleProps = SessionModuleProps | PatientModuleProps;

// Every module implements this contract. The shell drives it.
export interface ModuleLifecycle<P extends ModuleProps = ModuleProps> {
  onMount(props: P): void | Promise<void>;
  onUnmount(): void | Promise<void>;
  // Called when the shell's context changes under a mounted module
  // (e.g. the active patient in this group is replaced). Modules may
  // re-fetch, reset local state, etc.
  onContextChange(prev: P, next: P): void | Promise<void>;
  // Veto closing if there is unsaved state. The shell will surface the
  // appropriate prompt.
  canClose(): boolean | Promise<boolean>;
  // Optional: persist module state. The shell will call this before
  // close if the module has unsaved state and the user confirms saving.
  save?(): Promise<void>;
}

// Events a module emits back to the shell. Out-of-band signaling for
// state that the shell needs to react to (tab badges, close vetoes,
// title changes). Modules emit; they do not call the shell directly.
export type ModuleEvent =
  | {
      readonly type: 'unsaved-state-changed';
      readonly hasUnsavedState: boolean;
    }
  | { readonly type: 'request-focus' }
  | { readonly type: 'request-close' }
  | { readonly type: 'title-changed'; readonly title: string };
