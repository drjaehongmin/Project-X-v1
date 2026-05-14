// Mounts a single registered module inside a tab. Constructs the
// `ModuleRuntime`, wires the per-module services bundle (audit pre-bound
// to this module's ID), wraps the rendered component in
// `<ModuleRuntimeContext.Provider>`, and dispatches the module's events
// back to the shell.

import { useEffect, useMemo } from 'react';
import { ModuleRuntimeContext, type ModuleRuntime } from '@emr/module-sdk';
import type {
  ModuleEvent,
  ModuleProps,
  PatientModuleProps,
  SessionModuleProps,
} from '@emr/contracts';

import { useShellStore, type Tab } from '../store';
import { createModuleServices } from '../services';
import { moduleRegistry } from './registry';

export function ModuleHost({ tab }: { tab: Tab }): JSX.Element {
  const session = useShellStore((s) => s.session);
  const groups = useShellStore((s) => s.groups);
  const setTabTitle = useShellStore((s) => s.setTabTitle);
  const closeTab = useShellStore((s) => s.closeTab);

  const def = moduleRegistry.get(tab.moduleId);
  if (!def) {
    return (
      <div className="module-card">
        <h2>Module not found</h2>
        <p>
          The registry has no entry for{' '}
          <code>{String(tab.moduleId)}</code>. This tab points at a
          module that is not registered.
        </p>
      </div>
    );
  }
  if (!session) {
    return (
      <div className="module-card">
        <h2>No session</h2>
        <p>The shell rendered a module tab without an active session.</p>
      </div>
    );
  }

  const services = useMemo(
    () => createModuleServices(def.manifest.id, session.user.id),
    [def.manifest.id, session.user.id],
  );

  const props: ModuleProps = useMemo(() => {
    if (def.manifest.scope === 'patient') {
      const group = groups.find((g) => g.id === tab.groupId);
      if (!group) {
        // The tab was opened patient-scoped but its group is gone.
        // Surfaced as a render error rather than a silent fallback.
        throw new Error(
          `Patient-scoped tab '${String(tab.id)}' has no parent group.`,
        );
      }
      const p: PatientModuleProps = {
        moduleId: def.manifest.id,
        session,
        services,
        group,
        patient: group.patient,
        ...(tab.params !== undefined && { params: tab.params }),
      };
      return p;
    }
    const p: SessionModuleProps = {
      moduleId: def.manifest.id,
      session,
      services,
      ...(tab.params !== undefined && { params: tab.params }),
    };
    return p;
  }, [def.manifest.id, def.manifest.scope, session, services, groups, tab.id, tab.groupId, tab.params]);

  const runtime: ModuleRuntime = useMemo(
    () => ({
      manifest: def.manifest,
      props,
      emit(event: ModuleEvent) {
        switch (event.type) {
          case 'title-changed':
            setTabTitle(tab.id, event.title);
            return;
          case 'request-close':
            void closeTab(tab.id);
            return;
          case 'request-focus':
            useShellStore.getState().focusTab(tab.id);
            return;
          case 'unsaved-state-changed':
            // The shell will use this to drive close prompts and tab
            // badges in a later step. For Step 5 we just route it
            // through the audit log so the signal is visible.
            services.audit.log({
              action: event.hasUnsavedState
                ? 'tab.unsavedState.on'
                : 'tab.unsavedState.off',
              resource: String(tab.id),
            });
            return;
        }
      },
    }),
    [def.manifest, props, setTabTitle, closeTab, tab.id, services],
  );

  // Lifecycle audit: log when a tab mounts the module and when it
  // unmounts.  Useful both for the chrome's AuditPanel (so opening any
  // module visibly registers) and as a frontend mirror of the backend's
  // own per-resource audit rows.  Patient-scoped tabs include the
  // bound patient on the entry so the panel filters cleanly.
  const auditPatientId =
    def.manifest.scope === 'patient'
      ? (props as PatientModuleProps).patient.id
      : undefined;
  useEffect(() => {
    services.audit.log({
      action: 'module.opened',
      resource: String(tab.id),
      ...(auditPatientId !== undefined && { patient: auditPatientId }),
    });
    return () => {
      services.audit.log({
        action: 'module.closed',
        resource: String(tab.id),
        ...(auditPatientId !== undefined && { patient: auditPatientId }),
      });
    };
    // Re-run if the tab id changes (defensive — tabs shouldn't change
    // their id) or the module identity changes (e.g. registry reload).
    // `services` is stable per (moduleId, userId) by the useMemo above.
  }, [tab.id, def.manifest.id, services, auditPatientId]);

  const Component = def.Component;

  return (
    <ModuleRuntimeContext.Provider value={runtime}>
      <Component />
    </ModuleRuntimeContext.Provider>
  );
}
