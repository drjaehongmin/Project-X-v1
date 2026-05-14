import type { SessionContext } from '@emr/contracts';
import { useModuleRuntime } from '../context';

// Returns the SessionContext supplied by the shell. Valid in session-,
// general-, and patient-scoped modules. Throws in global-scoped modules
// (they have no session by design — they are shell-provided services).
export function useSessionContext(): SessionContext {
  const { manifest, props } = useModuleRuntime();
  if (manifest.scope === 'global') {
    throw new Error(
      `[@emr/module-sdk] useSessionContext is not valid in a global-scoped module ` +
        `('${manifest.id}'). Global modules are shell-provided services and have no session.`,
    );
  }
  return props.session;
}
