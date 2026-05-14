// In-memory + sessionStorage-backed token store.  The data-client's
// HTTP layer reads the access token before each request and asks us to
// refresh on a 401.
//
// Persisting tokens in sessionStorage (not localStorage) means they
// survive a reload of the tab but not the browser process — a sensible
// default for an EMR.  Real production wiring would put refresh tokens
// in an httpOnly cookie; the access token in memory is fine.

import type { TokenStore } from '@emr/data-client';

const ACCESS_KEY = 'emr.access_token';
const REFRESH_KEY = 'emr.refresh_token';

interface ShellTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
}

let memory: ShellTokens | null = null;
let refresher: ((refreshToken: string) => Promise<ShellTokens | null>) | null = null;

function readFromStorage(): ShellTokens | null {
  if (typeof sessionStorage === 'undefined') return null;
  const accessToken = sessionStorage.getItem(ACCESS_KEY);
  const refreshToken = sessionStorage.getItem(REFRESH_KEY);
  if (accessToken === null || refreshToken === null) return null;
  return { accessToken, refreshToken };
}

function writeToStorage(tokens: ShellTokens | null): void {
  if (typeof sessionStorage === 'undefined') return;
  if (tokens === null) {
    sessionStorage.removeItem(ACCESS_KEY);
    sessionStorage.removeItem(REFRESH_KEY);
    return;
  }
  sessionStorage.setItem(ACCESS_KEY, tokens.accessToken);
  sessionStorage.setItem(REFRESH_KEY, tokens.refreshToken);
}

export function setTokens(tokens: ShellTokens | null): void {
  memory = tokens;
  writeToStorage(tokens);
}

export function getTokens(): ShellTokens | null {
  if (memory === null) memory = readFromStorage();
  return memory;
}

export function clearTokens(): void {
  setTokens(null);
}

export function setRefresher(
  fn: (refreshToken: string) => Promise<ShellTokens | null>,
): void {
  refresher = fn;
}

// Adapter to the data-client TokenStore interface.
export const shellTokenStore: TokenStore = {
  getAccessToken() {
    return getTokens()?.accessToken ?? null;
  },
  async refresh(): Promise<string | null> {
    const current = getTokens();
    if (current === null || refresher === null) return null;
    const next = await refresher(current.refreshToken);
    if (next === null) {
      clearTokens();
      return null;
    }
    setTokens(next);
    return next.accessToken;
  },
};
