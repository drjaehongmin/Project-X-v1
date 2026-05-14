// Backend configuration. Reads from process.env once at startup and
// returns a frozen object so the rest of the app can import a typed,
// validated config rather than reaching into process.env scattered
// across files.

export interface BackendConfig {
  readonly databaseUrl: string;
  readonly port: number;
  readonly frontendOrigin: string;
  readonly jwtSecret: string;
  readonly jwtAccessTtlSeconds: number;
  readonly jwtRefreshTtlSeconds: number;
  readonly logLevel: 'error' | 'warn' | 'info' | 'debug' | 'trace';
  readonly nodeEnv: 'development' | 'production' | 'test';
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Env var ${name} must be an integer, got "${raw}"`);
  }
  return parsed;
}

export function loadConfig(): BackendConfig {
  const nodeEnvRaw = optional('NODE_ENV', 'development');
  const nodeEnv =
    nodeEnvRaw === 'production' || nodeEnvRaw === 'test'
      ? nodeEnvRaw
      : 'development';

  const logLevelRaw = optional('LOG_LEVEL', 'info');
  const allowedLevels = ['error', 'warn', 'info', 'debug', 'trace'] as const;
  const logLevel = (allowedLevels as readonly string[]).includes(logLevelRaw)
    ? (logLevelRaw as BackendConfig['logLevel'])
    : 'info';

  const jwtSecret = required('JWT_SECRET');
  if (jwtSecret.length < 32 && nodeEnv === 'production') {
    throw new Error('JWT_SECRET must be at least 32 bytes in production');
  }

  return Object.freeze({
    databaseUrl: required('DATABASE_URL'),
    port: intEnv('PORT', 5210),
    frontendOrigin: optional('FRONTEND_ORIGIN', 'http://localhost:5209'),
    jwtSecret,
    jwtAccessTtlSeconds: intEnv('JWT_ACCESS_TTL_SECONDS', 900),
    jwtRefreshTtlSeconds: intEnv('JWT_REFRESH_TTL_SECONDS', 2_592_000),
    logLevel,
    nodeEnv,
  });
}
