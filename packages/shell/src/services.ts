// Service wiring. Owns the singletons (audit store + the
// always-the-same-instance navigation/notification/permission/data
// services) and exposes a per-module factory that the ModuleHost calls
// when it mounts a module.
//
// `shellAuditService` is a scoped audit service the shell itself uses
// for chrome-originated events (login, navigation). It pre-binds
// module='shell' so audit entries from shell internals are
// distinguishable from module-originated entries.

import type {
  AuditService,
  DataService,
  ModuleId,
  ModuleServices,
  NavigationService,
  NotificationService,
  PermissionService,
  UserId,
} from '@emr/contracts';
import {
  createAuditStore,
  createDataService,
  createNavigationService,
  createNotificationService,
  createPermissionService,
  createScopedAuditService,
  type AuditStore,
  type NavigationStore,
} from '@emr/services';

import { getApi } from './api';
import { useShellStore } from './store';

// ---------- Audit ----------

export const auditStore: AuditStore = createAuditStore();

const SHELL_MODULE_ID = 'shell' as ModuleId;

export function createShellAuditService(userId: UserId): AuditService {
  return createScopedAuditService(auditStore, {
    moduleId: SHELL_MODULE_ID,
    userId,
  });
}

// ---------- Navigation ----------

// NavigationStore implementation against the Zustand store. The shell
// owns tab/group state, so it implements the NavigationStore interface
// declared in @emr/services. The store's actions are reached through
// `useShellStore.getState()` so the implementation works both inside
// and outside React renders.
const navigationStoreImpl: NavigationStore = {
  openTab(req) {
    const title = resolveModuleTitle(req.moduleId);
    return useShellStore.getState().openTab(req, { title });
  },
  openTabInGroup(groupId, req) {
    const title = resolveModuleTitle(req.moduleId);
    return useShellStore.getState().openTabInGroup(groupId, req, { title });
  },
  closeTab(id) {
    return useShellStore.getState().closeTab(id);
  },
  focusTab(id) {
    useShellStore.getState().focusTab(id);
  },
  openPatientGroup(req) {
    const title =
      req.initialTab !== undefined
        ? resolveModuleTitle(req.initialTab.moduleId)
        : 'Patient tab';
    return useShellStore.getState().openPatientGroup(req, { title });
  },
  closePatientGroup(id) {
    return useShellStore.getState().closePatientGroup(id);
  },
  focusPatientGroup(id) {
    useShellStore.getState().focusPatientGroup(id);
  },
};

export const navigationService: NavigationService =
  createNavigationService(navigationStoreImpl);

// ---------- The rest ----------

export const notificationService: NotificationService =
  createNotificationService();
export const permissionService: PermissionService = createPermissionService({
  userRoles: ['admin'],
});
// When `VITE_EMR_API_BASE_URL` is set, route DataService through the
// HTTP-backed client in @emr/data-client. Otherwise fall back to the
// in-memory fixtures from @emr/services so dev without a backend
// still renders the demo modules.
export const dataService: DataService = getApi()?.data ?? createDataService();

// ---------- Per-module bundle ----------

// Resolved lazily — the registry is imported by callers and we don't
// want a circular dep here, so we accept a resolver function.
let titleResolver: (moduleId: ModuleId) => string = () => 'Tab';
export function setModuleTitleResolver(
  resolver: (moduleId: ModuleId) => string,
): void {
  titleResolver = resolver;
}
function resolveModuleTitle(moduleId: ModuleId): string {
  return titleResolver(moduleId);
}

export function createModuleServices(
  moduleId: ModuleId,
  userId: UserId,
): ModuleServices {
  return {
    audit: createScopedAuditService(auditStore, { moduleId, userId }),
    navigation: navigationService,
    notification: notificationService,
    permission: permissionService,
    data: dataService,
  };
}
