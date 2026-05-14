// HTTP-client singletons.  When `VITE_EMR_API_BASE_URL` is set, the
// shell talks to the real backend; otherwise these stay null and
// services.ts falls back to the in-memory fixtures from @emr/services.

import {
  createAuthClient,
  createHttpClient,
  createHttpDataService,
  type AuthClient,
  type HttpClient,
} from '@emr/data-client';
import type { DataService } from '@emr/contracts';

import {
  clearTokens,
  setRefresher,
  setTokens,
  shellTokenStore,
} from './auth/tokenStore';

interface ApiBundle {
  readonly http: HttpClient;
  readonly auth: AuthClient;
  readonly data: DataService;
}

function readBaseUrl(): string | null {
  const url = import.meta.env.VITE_EMR_API_BASE_URL;
  return typeof url === 'string' && url.length > 0 ? url : null;
}

let cached: ApiBundle | null = null;

export function getApi(): ApiBundle | null {
  if (cached !== null) return cached;
  const baseUrl = readBaseUrl();
  if (baseUrl === null) return null;

  const http = createHttpClient({
    baseUrl,
    tokenStore: shellTokenStore,
  });
  const auth = createAuthClient(http);
  const data = createHttpDataService(http);

  // Wire refresh callback once the auth client is in scope.
  setRefresher(async (refreshToken) => {
    try {
      const res = await auth.refresh(refreshToken);
      return {
        accessToken: res.accessToken,
        refreshToken: res.refreshToken,
      };
    } catch {
      return null;
    }
  });

  cached = { http, auth, data };
  return cached;
}

// Persist the tokens that came back from POST /auth/login. The
// data-client's TokenStore reads from the same storage, so any
// subsequent request automatically carries the bearer.
export function rememberTokens(input: {
  accessToken: string;
  refreshToken: string;
}): void {
  setTokens(input);
}

// Forget the tokens. Called from the TopBar sign-out flow after a
// best-effort POST /auth/logout. Safe to call when no tokens are set.
export function forgetTokens(): void {
  clearTokens();
}
