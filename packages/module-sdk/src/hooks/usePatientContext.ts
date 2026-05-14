import type { PatientContext, PatientGroup } from '@emr/contracts';
import { useModuleRuntime } from '../context';

export interface PatientContextValue {
  readonly patient: PatientContext;
  readonly group: PatientGroup;
}

// Returns the PatientContext + PatientGroup the module is bound to.
// Valid only in patient-scoped modules. Throws everywhere else — calling
// usePatientContext from a session- or general-scoped module is a usage
// error the SDK refuses to paper over.
export function usePatientContext(): PatientContextValue {
  const { manifest, props } = useModuleRuntime();
  if (manifest.scope !== 'patient') {
    throw new Error(
      `[@emr/module-sdk] usePatientContext is only valid in a patient-scoped module ` +
        `('${manifest.id}' has scope '${manifest.scope}'). Use useSessionContext or move ` +
        `this code into a patient-scoped module.`,
    );
  }
  // The shell guarantees patient-scoped modules receive PatientModuleProps.
  // The `in` narrow makes that explicit to the type system without a cast.
  if (!('patient' in props)) {
    throw new Error(
      `[@emr/module-sdk] Patient-scoped module '${manifest.id}' was mounted without ` +
        `PatientModuleProps. This is a shell bug.`,
    );
  }
  return { patient: props.patient, group: props.group };
}
