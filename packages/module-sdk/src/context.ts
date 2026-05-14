// The runtime context that the shell installs around each mounted module.
//
// Modules never read this directly. They call SDK hooks
// (useSessionContext, usePatientContext, etc.), which pull from this
// context. The shell is the only place that constructs a
// ModuleRuntime and renders <ModuleRuntimeContext.Provider>.

import { createContext, useContext } from 'react';
import type {
  ModuleEvent,
  ModuleManifest,
  ModuleProps,
} from '@emr/contracts';

export interface ModuleRuntime {
  readonly manifest: ModuleManifest;
  readonly props: ModuleProps;
  // Sink for events the module emits (unsaved-state, focus, close,
  // title). The shell decides what to do with each event.
  readonly emit: (event: ModuleEvent) => void;
}

export const ModuleRuntimeContext = createContext<ModuleRuntime | null>(null);

ModuleRuntimeContext.displayName = 'ModuleRuntimeContext';

// Internal helper used by every hook. Centralizes the "called outside a
// module tree" error so all hooks fail the same way and the shell can
// pattern-match if it ever needs to.
export function useModuleRuntime(): ModuleRuntime {
  const runtime = useContext(ModuleRuntimeContext);
  if (runtime === null) {
    throw new Error(
      '[@emr/module-sdk] Hook called outside a module render tree. ' +
        'Modules must be rendered by the shell inside <ModuleRuntimeContext.Provider>.',
    );
  }
  return runtime;
}
