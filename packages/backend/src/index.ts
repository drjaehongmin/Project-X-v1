// Public barrel.  The backend is consumed only via HTTP at runtime,
// but the tests import buildServer + helpers from here.

export { buildServer } from './server.js';
export { loadConfig, type BackendConfig } from './config.js';
export { getDb, closeDb } from './db/client.js';
export type { Database } from './db/types.js';
export { withRlsContext, withSystemContext, type RlsContext } from './db/rls.js';
export { hashPassword, verifyPassword } from './auth/password.js';
export { signAccessToken, verifyAccessToken } from './auth/jwt.js';
