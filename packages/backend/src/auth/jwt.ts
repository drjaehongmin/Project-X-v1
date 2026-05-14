// JWT issuance and verification.  HS256 in dev (single shared secret);
// switch to RS256 in production by replacing the key material here.
//
// The access token carries the identifying claims (userId, facilityId,
// roles) and is short-lived; the refresh token is opaque from a JWT
// perspective — we store its hash in `sessions.token_hash` and rotate
// on every refresh.

import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

import type { BackendConfig } from '../config.js';

export interface AccessTokenClaims {
  readonly sub: string; // user id
  readonly sid: string; // session id (refresh-token row id)
  readonly fid: string | null; // facility id (active session scope)
  readonly roles: readonly string[];
}

const ISSUER = 'emr-backend';
const AUDIENCE = 'emr-frontend';

export async function signAccessToken(
  config: BackendConfig,
  claims: AccessTokenClaims,
): Promise<string> {
  const secret = new TextEncoder().encode(config.jwtSecret);
  return new SignJWT({
    fid: claims.fid,
    roles: claims.roles,
    sid: claims.sid,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${config.jwtAccessTtlSeconds}s`)
    .sign(secret);
}

export async function verifyAccessToken(
  config: BackendConfig,
  token: string,
): Promise<AccessTokenClaims> {
  const secret = new TextEncoder().encode(config.jwtSecret);
  const { payload } = await jwtVerify(token, secret, {
    issuer: ISSUER,
    audience: AUDIENCE,
  });
  const sub = payload.sub;
  const sid = payload['sid'];
  const fid = payload['fid'];
  const roles = payload['roles'];

  if (typeof sub !== 'string') throw new Error('Token missing sub');
  if (typeof sid !== 'string') throw new Error('Token missing sid');
  if (!Array.isArray(roles) || roles.some((r) => typeof r !== 'string')) {
    throw new Error('Token missing roles');
  }

  return {
    sub,
    sid,
    fid: typeof fid === 'string' ? fid : null,
    roles: roles as string[],
  };
}

// Refresh tokens are opaque; we generate random bytes, return the raw
// value to the client once, and store only the hash.
export function generateRefreshToken(): { raw: string; hash: string } {
  const raw = randomBytes(48).toString('base64url');
  return { raw, hash: hashRefreshToken(raw) };
}

export function hashRefreshToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
