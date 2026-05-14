// Top-level routes. /login when there is no session, /app otherwise.
// react-router handles redirects; the store is the source of truth.

import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { Login } from './auth/Login';
import { Shell } from './chrome/Shell';
import { useShellStore } from './store';
import { setModuleTitleResolver } from './services';
import { moduleRegistry } from './modules/registry';
import type { ModuleId } from '@emr/contracts';

export function App(): JSX.Element {
  const hasSession = useShellStore((s) => s.session !== null);

  // Wire the title resolver so NavigationService.openTab can derive a
  // tab title from a module's manifest without the services file
  // importing the registry directly (avoiding a circular dep).
  useEffect(() => {
    setModuleTitleResolver((id: ModuleId) => {
      const def = moduleRegistry.get(id);
      return def?.manifest.displayName ?? 'Tab';
    });
  }, []);

  return (
    <Routes>
      <Route
        path="/login"
        element={hasSession ? <Navigate to="/app" replace /> : <Login />}
      />
      <Route path="/app" element={<Shell />} />
      <Route
        path="*"
        element={<Navigate to={hasSession ? '/app' : '/login'} replace />}
      />
    </Routes>
  );
}
