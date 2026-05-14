import { useCallback, useRef, useState } from 'react';
import { useModuleRuntime } from '../context';

export type UseUnsavedStateResult = readonly [
  hasUnsavedState: boolean,
  setUnsavedState: (next: boolean) => void,
];

// Tracks an unsaved-state flag for the module and notifies the shell on
// every change. The shell uses these signals to drive close prompts and
// tab badges. Emitting only happens on transitions (no spurious events
// when the setter is called with the same value).
export function useUnsavedState(
  initial = false,
): UseUnsavedStateResult {
  const { emit } = useModuleRuntime();
  const currentRef = useRef(initial);
  const [hasUnsavedState, setHasUnsavedStateInternal] = useState(initial);

  const setUnsavedState = useCallback(
    (next: boolean) => {
      if (currentRef.current === next) return;
      currentRef.current = next;
      setHasUnsavedStateInternal(next);
      emit({ type: 'unsaved-state-changed', hasUnsavedState: next });
    },
    [emit],
  );

  return [hasUnsavedState, setUnsavedState];
}
