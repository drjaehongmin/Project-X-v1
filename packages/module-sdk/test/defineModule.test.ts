import { describe, expect, it } from 'vitest';
import { defineModule } from '../src/defineModule';
import { makePatientManifest, makeSessionManifest } from './fakes';

function NoopComponent(): null {
  return null;
}

describe('defineModule', () => {
  it('pairs the manifest with the component verbatim', () => {
    const manifest = makeSessionManifest('general');
    const def = defineModule(manifest, NoopComponent);
    expect(def.manifest).toBe(manifest);
    expect(def.Component).toBe(NoopComponent);
  });

  it('preserves the manifest scope as a literal for narrowing', () => {
    const def = defineModule(makePatientManifest(), NoopComponent);
    // Type-level narrowing: scope is the patient literal, not the wide
    // ModuleScope union. If this assertion compiles, the generic is doing
    // its job — the test below double-checks the runtime value.
    const scope: 'patient' = def.manifest.scope;
    expect(scope).toBe('patient');
  });
});
