// Top Bar — shows the active session (workspace, location, user) and a
// Sign out button. Every value has a small label above it so reviewers
// can tell at a glance what each piece of context is.

import { useNavigate } from 'react-router-dom';
import { forgetTokens, getApi } from '../api';
import { useShellStore } from '../store';
import { createShellAuditService } from '../services';

export function TopBar(): JSX.Element | null {
  const session = useShellStore((s) => s.session);
  const signOut = useShellStore((s) => s.signOut);
  const navigate = useNavigate();
  if (!session) return null;

  async function handleSignOut(): Promise<void> {
    if (session) {
      const audit = createShellAuditService(session.user.id);
      audit.log({ action: 'auth.signOut', resource: 'session' });
    }
    // When the backend is configured, revoke the refresh token
    // server-side before clearing local state.  Best-effort — if the
    // server is unreachable we still sign the user out locally.
    const api = getApi();
    if (api !== null) {
      try {
        await api.auth.logout();
      } catch {
        // ignore — local sign-out still proceeds
      }
      forgetTokens();
    }
    signOut();
    navigate('/login', { replace: true });
  }

  return (
    <header className="topbar" aria-label="Top bar">
      <span className="topbar-brand">Cruise Ship EMR</span>

      <div className="topbar-context" aria-label="Active session context">
        <div className="context-item">
          <span className="context-label">Workspace</span>
          <span className="context-value">{session.workspace.displayName}</span>
        </div>
        <div className="context-item">
          <span className="context-label">Location</span>
          <span className="context-value">{session.location.displayName}</span>
        </div>
        <div className="context-item">
          <span className="context-label">User</span>
          <span className="context-value">{session.user.displayName}</span>
        </div>
      </div>

      <button
        className="signout-button"
        onClick={() => void handleSignOut()}
        aria-label="Sign out"
      >
        Sign out
      </button>
    </header>
  );
}
