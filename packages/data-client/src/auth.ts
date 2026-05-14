// Auth surface used by the shell to log in / refresh / sign out
// against the real backend.  The shell wires the returned tokens
// through to its TokenStore.

import type { HttpClient } from './fetch.js';

export interface LoginInput {
  readonly email: string;
  readonly password: string;
  readonly facilityId?: string | null;
}

export interface LoginResponse {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly sessionId: string;
  readonly expiresIn: number;
  readonly user: {
    readonly id: string;
    readonly displayName: string;
    readonly roles: readonly string[];
  };
}

export interface RefreshResponse {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly sessionId: string;
  readonly expiresIn: number;
}

export interface SessionResponse {
  readonly sessionId: string;
  readonly facilityId: string | null;
  readonly location: {
    readonly id: string;
    readonly kind: 'vessel' | 'clinic';
    readonly displayName: string;
  } | null;
  readonly user: {
    readonly id: string;
    readonly displayName: string;
    readonly roles: readonly string[];
  };
}

export interface AuthClient {
  login(input: LoginInput): Promise<LoginResponse>;
  refresh(refreshToken: string): Promise<RefreshResponse>;
  logout(): Promise<void>;
  getSession(): Promise<SessionResponse>;
}

export function createAuthClient(http: HttpClient): AuthClient {
  return {
    login(input) {
      return http.post<LoginResponse>('/auth/login', input);
    },
    refresh(refreshToken) {
      return http.post<RefreshResponse>('/auth/refresh', { refreshToken });
    },
    async logout() {
      await http.post<{ ok: boolean }>('/auth/logout', {});
    },
    getSession() {
      return http.get<SessionResponse>('/me/session');
    },
  };
}
