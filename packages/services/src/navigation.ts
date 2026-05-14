// NavigationService is mostly a pass-through over a shell-supplied
// store: the shell owns tab/group state (it has to — it renders them),
// and the service is the public-facing surface that modules talk to.
//
// The factory exists so the services package can later add cross-cutting
// behavior (audit on every navigation, permission checks, telemetry)
// without the shell or modules changing. For the Step 4 stub the wrapper
// simply forwards every call.

import type {
  NavigationService,
  OpenPatientGroupRequest,
  OpenTabRequest,
  PatientGroupId,
  TabId,
} from '@emr/contracts';

// Shell-side state container. The shell implements this in Step 5
// against its Zustand store; the services package never instantiates
// one of these itself.
export interface NavigationStore {
  openTab(req: OpenTabRequest): TabId;
  openTabInGroup(groupId: PatientGroupId, req: OpenTabRequest): TabId;
  closeTab(id: TabId): Promise<boolean>;
  focusTab(id: TabId): void;
  openPatientGroup(req: OpenPatientGroupRequest): PatientGroupId;
  closePatientGroup(id: PatientGroupId): Promise<boolean>;
  focusPatientGroup(id: PatientGroupId): void;
}

export function createNavigationService(
  store: NavigationStore,
): NavigationService {
  return {
    openTab: (req) => store.openTab(req),
    openTabInGroup: (groupId, req) => store.openTabInGroup(groupId, req),
    closeTab: (id) => store.closeTab(id),
    focusTab: (id) => store.focusTab(id),
    openPatientGroup: (req) => store.openPatientGroup(req),
    closePatientGroup: (id) => store.closePatientGroup(id),
    focusPatientGroup: (id) => store.focusPatientGroup(id),
  };
}
