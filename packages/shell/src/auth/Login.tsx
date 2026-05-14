// Login form. Two flows behind one component:
//
//   - Backend configured (VITE_EMR_API_BASE_URL set, getApi() non-null):
//     POSTs /auth/login, persists tokens, fetches /me/session, builds
//     the frontend SessionContext from the response, signs in.
//
//   - No backend configured: the original hardcoded fake login
//     (`admin` / `Password123`) so frontend-only dev still works.
//
// In both cases the resulting SessionContext shape is identical from
// the shell's perspective — only the data source changes.

import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import type {
  LocationId,
  SessionContext,
  SessionId,
  UserId,
  WorkspaceId,
} from '@emr/contracts';

import { getApi, rememberTokens } from '../api';
import { createShellAuditService } from '../services';
import { useShellStore } from '../store';

const FAKE_USERNAME = 'admin';
const FAKE_PASSWORD = 'Password123';

const FAKE_SESSION = {
  workspace: {
    id: 'ws-clinic' as WorkspaceId,
    type: 'clinic' as const,
    displayName: 'Clinic',
  },
  location: {
    id: 'loc-mv-aurora' as LocationId,
    kind: 'vessel' as const,
    displayName: 'MV Aurora',
  },
  user: {
    id: 'user-admin' as UserId,
    displayName: 'admin',
    roles: ['admin'] as const,
  },
};

// When the backend doesn't pin the session to a specific facility
// (e.g. case-management / clinical-operations / global admin), the
// chrome still needs *something* to render in the Location panel.
// "Cross-facility" is a presentation placeholder; the real scope is
// the user's role/care-team graph evaluated by the backend.
const CROSS_FACILITY_LOCATION = {
  id: 'loc-global' as LocationId,
  kind: 'clinic' as const,
  displayName: 'Cross-facility',
};

export function Login(): JSX.Element {
  const navigate = useNavigate();
  const signIn = useShellStore((s) => s.signIn);

  const api = getApi();
  const backendMode = api !== null;

  const [identity, setIdentity] = useState(''); // email when backend, username when fake
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);

    if (backendMode && api !== null) {
      await submitBackend(api);
    } else {
      submitFake();
    }
  }

  async function submitBackend(api: NonNullable<ReturnType<typeof getApi>>): Promise<void> {
    setBusy(true);
    try {
      const loginRes = await api.auth.login({
        email: identity.trim(),
        password,
      });
      rememberTokens({
        accessToken: loginRes.accessToken,
        refreshToken: loginRes.refreshToken,
      });

      // Fetch the canonical session shape; /me/session is the
      // source of truth for what the SessionContext should contain.
      const me = await api.auth.getSession();

      const location =
        me.location !== null
          ? {
              id: me.location.id as LocationId,
              kind: me.location.kind,
              displayName: me.location.displayName,
            }
          : CROSS_FACILITY_LOCATION;

      const session: SessionContext = {
        id: me.sessionId as SessionId,
        // Workspace selection at login is a Phase 2B feature; until
        // then every backend session lands in the Clinic workspace.
        workspace: FAKE_SESSION.workspace,
        location,
        user: {
          id: me.user.id as UserId,
          displayName: me.user.displayName,
          roles: me.user.roles,
        },
        startedAt: new Date().toISOString(),
      };

      signIn(session);
      const audit = createShellAuditService(session.user.id);
      audit.log({ action: 'auth.signIn', resource: 'session' });
      navigate('/app', { replace: true });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Sign-in failed';
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  function submitFake(): void {
    if (identity !== FAKE_USERNAME || password !== FAKE_PASSWORD) {
      setError('Invalid username or password.');
      return;
    }
    const session: SessionContext = {
      id: `session-${Date.now()}` as SessionId,
      workspace: FAKE_SESSION.workspace,
      location: FAKE_SESSION.location,
      user: {
        id: FAKE_SESSION.user.id,
        displayName: FAKE_SESSION.user.displayName,
        roles: FAKE_SESSION.user.roles,
      },
      startedAt: new Date().toISOString(),
    };
    signIn(session);
    const audit = createShellAuditService(session.user.id);
    audit.log({ action: 'auth.signIn', resource: 'session' });
    navigate('/app', { replace: true });
  }

  const fieldLabel = backendMode ? 'Email' : 'Username';
  const inputType = backendMode ? 'email' : 'text';
  const autoComplete = backendMode ? 'username' : 'username';

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={(e) => void handleSubmit(e)}>
        <h1>Cruise Ship EMR</h1>
        <p className="subtitle">Sign in to begin a session.</p>

        {error !== null && <div className="error-message">{error}</div>}

        <label className="field">
          <span className="field-label">{fieldLabel}</span>
          <input
            type={inputType}
            autoComplete={autoComplete}
            value={identity}
            onChange={(e) => setIdentity(e.target.value)}
            autoFocus
            disabled={busy}
          />
        </label>

        <label className="field">
          <span className="field-label">Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
        </label>

        <button type="submit" className="button-primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        {backendMode ? (
          <div className="login-hint">
            <strong>Authenticating against backend.</strong> Use the
            credentials of a user created via{' '}
            <code>pnpm db-create-admin</code>.
          </div>
        ) : (
          <div className="login-hint">
            <strong>Prototype credentials (no backend):</strong>{' '}
            username <code>admin</code> · password <code>Password123</code>
          </div>
        )}
      </form>
    </div>
  );
}
