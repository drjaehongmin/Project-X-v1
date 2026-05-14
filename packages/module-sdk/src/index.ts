// @emr/module-sdk — defineModule + the hooks modules call to read
// context and services.

export { defineModule } from './defineModule';
export type { ModuleDefinition } from './defineModule';

export { ModuleRuntimeContext, useModuleRuntime } from './context';
export type { ModuleRuntime } from './context';

export { useSessionContext } from './hooks/useSessionContext';
export { usePatientContext } from './hooks/usePatientContext';
export type { PatientContextValue } from './hooks/usePatientContext';
export { useServices } from './hooks/useServices';
export { useNavigation } from './hooks/useNavigation';
export { useUnsavedState } from './hooks/useUnsavedState';
export type { UseUnsavedStateResult } from './hooks/useUnsavedState';
