// defineModule — the only sanctioned way for a module to declare itself.
//
// The function is a pass-through that pairs a manifest with a component.
// The shell does the runtime validation (unique IDs, declared services
// exist, permissions are sane). defineModule's job is to give authors a
// single import to discover, and to lock the (manifest, component) pair
// at the type level.

import type { ComponentType } from 'react';
import type { ModuleManifest } from '@emr/contracts';

export interface ModuleDefinition<
  M extends ModuleManifest = ModuleManifest,
> {
  readonly manifest: M;
  // The shell renders this with no props; everything arrives via hooks
  // that read from <ModuleRuntimeContext.Provider>.
  readonly Component: ComponentType;
}

export function defineModule<M extends ModuleManifest>(
  manifest: M,
  Component: ComponentType,
): ModuleDefinition<M> {
  return { manifest, Component };
}
