// Module manifest. Every module declares one of these and the shell
// validates it at registration. The shape is a discriminated union on
// `scope` so the type system enforces:
//
//   `requires` contains 'patient'  ⇒  `scope: 'patient'`
//
// A `NonPatientModuleManifest` cannot list 'patient' in `requires` because
// its `requires` element type excludes it. A manifest that needs the
// patient context must use the `'patient'` branch, which fixes `scope` to
// `'patient'` automatically.

import type { ModuleId } from './ids';

// The four scopes from CLAUDE.md.
//
// - `global`  — shell-provided, not user-launchable (e.g. audit chrome).
// - `session` — needs SessionContext only.
// - `general` — session-scoped, patient-independent.
// - `patient` — runs inside a PatientGroup; receives PatientContext.
export type ModuleScope = 'global' | 'session' | 'general' | 'patient';

// The context objects a module asks the shell to supply.
//
// - 'session' — a SessionContext (which carries workspace/location/user).
// - 'patient' — a PatientContext (only legal for scope: 'patient').
export type ContextRequirement = 'session' | 'patient';

// The set of services a module may request injection of. The shell
// constructs per-module instances and wires them through props.
export type ServiceName =
  | 'audit'
  | 'navigation'
  | 'notification'
  | 'permission'
  | 'data';

export interface ModuleManifestBase {
  readonly id: ModuleId;
  readonly displayName: string;
  // SemVer string, e.g. '0.1.0'.
  readonly version: string;
  readonly services: readonly ServiceName[];
  // Capability identifiers the user must have to launch the module.
  // Matched against PermissionService at launch.
  readonly permissions: readonly string[];
}

export interface NonPatientModuleManifest extends ModuleManifestBase {
  readonly scope: Exclude<ModuleScope, 'patient'>;
  // Non-patient manifests cannot require the patient context.
  readonly requires: readonly Exclude<ContextRequirement, 'patient'>[];
}

export interface PatientModuleManifest extends ModuleManifestBase {
  readonly scope: 'patient';
  readonly requires: readonly ContextRequirement[];
}

export type ModuleManifest = NonPatientModuleManifest | PatientModuleManifest;
