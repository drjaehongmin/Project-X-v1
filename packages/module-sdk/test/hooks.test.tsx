import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ReactNode } from 'react';
import type { ModuleEvent } from '@emr/contracts';

import {
  ModuleRuntimeContext,
  useNavigation,
  usePatientContext,
  useServices,
  useSessionContext,
  useUnsavedState,
  type ModuleRuntime,
} from '../src/index';
import { makeRuntime } from './fakes';

function wrap(runtime: ModuleRuntime) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ModuleRuntimeContext.Provider value={runtime}>
        {children}
      </ModuleRuntimeContext.Provider>
    );
  };
}

// React logs caught render errors via console.error. The tests below
// deliberately trigger them; silence the noise so test output stays
// readable. Restored after every test.
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('useSessionContext', () => {
  it('returns the session from the runtime', () => {
    const runtime = makeRuntime('session');
    const { result } = renderHook(() => useSessionContext(), {
      wrapper: wrap(runtime),
    });
    expect(result.current).toBe(runtime.props.session);
  });

  it('throws when called outside a module render tree', () => {
    expect(() => renderHook(() => useSessionContext())).toThrowError(
      /Hook called outside a module render tree/,
    );
  });

  it('throws in a global-scoped module', () => {
    const runtime = makeRuntime('global');
    expect(() =>
      renderHook(() => useSessionContext(), { wrapper: wrap(runtime) }),
    ).toThrowError(/global-scoped module/);
  });
});

describe('usePatientContext', () => {
  it('returns patient and group for a patient-scoped module', () => {
    const runtime = makeRuntime('patient');
    const { result } = renderHook(() => usePatientContext(), {
      wrapper: wrap(runtime),
    });
    expect(result.current.patient).toBe(
      'patient' in runtime.props ? runtime.props.patient : null,
    );
    expect(result.current.group).toBe(
      'group' in runtime.props ? runtime.props.group : null,
    );
  });

  it('throws in a session-scoped module', () => {
    const runtime = makeRuntime('session');
    expect(() =>
      renderHook(() => usePatientContext(), { wrapper: wrap(runtime) }),
    ).toThrowError(/only valid in a patient-scoped module/);
  });

  it('throws in a general-scoped module', () => {
    const runtime = makeRuntime('general');
    expect(() =>
      renderHook(() => usePatientContext(), { wrapper: wrap(runtime) }),
    ).toThrowError(/only valid in a patient-scoped module/);
  });

  it('throws outside a module render tree', () => {
    expect(() => renderHook(() => usePatientContext())).toThrowError(
      /Hook called outside a module render tree/,
    );
  });
});

describe('useServices', () => {
  it('returns the services bundle', () => {
    const runtime = makeRuntime('general');
    const { result } = renderHook(() => useServices(), {
      wrapper: wrap(runtime),
    });
    expect(result.current).toBe(runtime.props.services);
  });

  it('throws in a global-scoped module', () => {
    const runtime = makeRuntime('global');
    expect(() =>
      renderHook(() => useServices(), { wrapper: wrap(runtime) }),
    ).toThrowError(/global-scoped module/);
  });
});

describe('useNavigation', () => {
  it('returns the navigation service', () => {
    const runtime = makeRuntime('session');
    const { result } = renderHook(() => useNavigation(), {
      wrapper: wrap(runtime),
    });
    expect(result.current).toBe(runtime.props.services.navigation);
  });

  it('throws outside a module render tree', () => {
    expect(() => renderHook(() => useNavigation())).toThrowError(
      /Hook called outside a module render tree/,
    );
  });
});

describe('useUnsavedState', () => {
  it('starts with the given initial value and does not emit on mount', () => {
    const events: ModuleEvent[] = [];
    const runtime = makeRuntime('session', (e) => events.push(e));
    const { result } = renderHook(() => useUnsavedState(false), {
      wrapper: wrap(runtime),
    });
    expect(result.current[0]).toBe(false);
    expect(events).toEqual([]);
  });

  it('emits unsaved-state-changed on transitions and updates value', () => {
    const events: ModuleEvent[] = [];
    const runtime = makeRuntime('session', (e) => events.push(e));
    const { result } = renderHook(() => useUnsavedState(false), {
      wrapper: wrap(runtime),
    });

    act(() => {
      result.current[1](true);
    });
    expect(result.current[0]).toBe(true);
    expect(events).toEqual([
      { type: 'unsaved-state-changed', hasUnsavedState: true },
    ]);

    act(() => {
      result.current[1](false);
    });
    expect(result.current[0]).toBe(false);
    expect(events).toEqual([
      { type: 'unsaved-state-changed', hasUnsavedState: true },
      { type: 'unsaved-state-changed', hasUnsavedState: false },
    ]);
  });

  it('does not emit when the setter is called with the same value', () => {
    const events: ModuleEvent[] = [];
    const runtime = makeRuntime('session', (e) => events.push(e));
    const { result } = renderHook(() => useUnsavedState(true), {
      wrapper: wrap(runtime),
    });

    act(() => {
      result.current[1](true);
    });
    act(() => {
      result.current[1](true);
    });
    expect(events).toEqual([]);
  });

  it('throws outside a module render tree', () => {
    expect(() => renderHook(() => useUnsavedState())).toThrowError(
      /Hook called outside a module render tree/,
    );
  });
});
