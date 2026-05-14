import type { NavigationService } from '@emr/contracts';
import { useServices } from './useServices';

// Sugar over useServices().navigation. Re-exported as its own hook
// because module code almost always reaches for navigation explicitly,
// and reading `useNavigation()` makes intent obvious.
export function useNavigation(): NavigationService {
  return useServices().navigation;
}
