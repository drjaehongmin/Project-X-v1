// The shell's Zustand store. One store, three slices:
//   - session: who is signed in and what context they have
//   - tabs:    top-level (session/general) tabs
//   - groups:  patient context groups, each holding its own tab list
//
// Mutations go through actions (openTab/closeTab/...) so the
// NavigationStore implementation can call them by name without poking
// at internal shape. The store is the only writeable state in the
// shell; everything else reads from it.

import { create } from 'zustand';
import type {
  ModuleId,
  OpenPatientGroupRequest,
  OpenTabRequest,
  PatientContext,
  PatientGroup,
  PatientGroupId,
  SessionContext,
  TabId,
} from '@emr/contracts';

export interface Tab {
  readonly id: TabId;
  readonly moduleId: ModuleId;
  readonly title: string;
  readonly groupId?: PatientGroupId;
  readonly params?: Readonly<Record<string, unknown>>;
}

export interface ShellState {
  // ----- data -----
  readonly session: SessionContext | null;
  readonly tabs: readonly Tab[];
  readonly groups: readonly PatientGroup[];
  readonly activeTabId: TabId | null;
  readonly activeGroupId: PatientGroupId | null;

  // ----- session -----
  signIn: (session: SessionContext) => void;
  signOut: () => void;

  // ----- tabs -----
  // The title is supplied by the caller (the shell reads it from the
  // module's manifest.displayName when opening). Modules may emit
  // 'title-changed' later; setTabTitle handles that.
  openTab: (req: OpenTabRequest, opts: { title: string }) => TabId;
  openTabInGroup: (
    groupId: PatientGroupId,
    req: OpenTabRequest,
    opts: { title: string },
  ) => TabId;
  closeTab: (id: TabId) => Promise<boolean>;
  focusTab: (id: TabId) => void;
  setTabTitle: (id: TabId, title: string) => void;

  // ----- groups -----
  openPatientGroup: (req: OpenPatientGroupRequest, opts?: { title?: string }) =>
    PatientGroupId;
  closePatientGroup: (id: PatientGroupId) => Promise<boolean>;
  focusPatientGroup: (id: PatientGroupId) => void;
}

let tabCounter = 0;
let groupCounter = 0;

function nextTabId(): TabId {
  tabCounter += 1;
  return `tab-${Date.now()}-${tabCounter}` as TabId;
}

function nextGroupId(): PatientGroupId {
  groupCounter += 1;
  return `group-${Date.now()}-${groupCounter}` as PatientGroupId;
}

function appendTabIdToGroup(
  group: PatientGroup,
  tabId: TabId,
): PatientGroup {
  return { ...group, tabIds: [...group.tabIds, tabId] };
}

function removeTabIdFromGroup(
  group: PatientGroup,
  tabId: TabId,
): PatientGroup {
  return { ...group, tabIds: group.tabIds.filter((id) => id !== tabId) };
}

export const useShellStore = create<ShellState>((set, get) => ({
  session: null,
  tabs: [],
  groups: [],
  activeTabId: null,
  activeGroupId: null,

  signIn(session) {
    set({ session, tabs: [], groups: [], activeTabId: null, activeGroupId: null });
  },

  signOut() {
    set({
      session: null,
      tabs: [],
      groups: [],
      activeTabId: null,
      activeGroupId: null,
    });
  },

  openTab(req, opts) {
    const id = nextTabId();
    const tab: Tab = {
      id,
      moduleId: req.moduleId,
      title: opts.title,
      ...(req.params !== undefined && { params: req.params }),
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: id }));
    return id;
  },

  openTabInGroup(groupId, req, opts) {
    const id = nextTabId();
    const tab: Tab = {
      id,
      moduleId: req.moduleId,
      title: opts.title,
      groupId,
      ...(req.params !== undefined && { params: req.params }),
    };
    set((s) => ({
      tabs: [...s.tabs, tab],
      groups: s.groups.map((g) =>
        g.id === groupId ? appendTabIdToGroup(g, id) : g,
      ),
      activeTabId: id,
      activeGroupId: groupId,
    }));
    return id;
  },

  async closeTab(id) {
    // No canClose veto wiring yet; modules that need it will register
    // a handler through a future SDK hook. For Step 5 close always
    // succeeds.
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab) return false;
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== id);
      const groups = tab.groupId
        ? s.groups.map((g) =>
            g.id === tab.groupId ? removeTabIdFromGroup(g, id) : g,
          )
        : s.groups;
      const activeTabId = s.activeTabId === id ? (tabs[0]?.id ?? null) : s.activeTabId;
      return { tabs, groups, activeTabId };
    });
    return true;
  },

  focusTab(id) {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab) return;
    set({
      activeTabId: id,
      ...(tab.groupId !== undefined && { activeGroupId: tab.groupId }),
    });
  },

  setTabTitle(id, title) {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, title } : t)),
    }));
  },

  openPatientGroup(req, opts) {
    const id = nextGroupId();
    const patient: PatientContext = req.patient;
    const group: PatientGroup = { id, patient, tabIds: [] };
    set((s) => ({ groups: [...s.groups, group], activeGroupId: id }));

    if (req.initialTab !== undefined) {
      get().openTabInGroup(id, req.initialTab, {
        title: opts?.title ?? 'Patient tab',
      });
    }
    return id;
  },

  async closePatientGroup(id) {
    const group = get().groups.find((g) => g.id === id);
    if (!group) return false;
    // Close every tab in the group first. closeTab is async but is
    // pure-sync in this prototype.
    for (const tabId of group.tabIds) {
      await get().closeTab(tabId);
    }
    set((s) => {
      const groups = s.groups.filter((g) => g.id !== id);
      const activeGroupId =
        s.activeGroupId === id ? (groups[0]?.id ?? null) : s.activeGroupId;
      return { groups, activeGroupId };
    });
    return true;
  },

  focusPatientGroup(id) {
    const group = get().groups.find((g) => g.id === id);
    if (!group) return;
    set({ activeGroupId: id });
    // If the group has tabs, focus the first one.
    const firstTab = group.tabIds[0];
    if (firstTab !== undefined) {
      get().focusTab(firstTab);
    }
  },
}));
