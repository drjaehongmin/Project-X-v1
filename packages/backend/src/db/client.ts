// Singleton Kysely instance backed by a pg.Pool.  The pool size is
// modest; the backend is the only consumer in dev.

import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

import type { BackendConfig } from '../config.js';
import type { Database } from './types.js';

let dbSingleton: Kysely<Database> | null = null;
let poolSingleton: pg.Pool | null = null;

export function getDb(config: BackendConfig): Kysely<Database> {
  if (dbSingleton !== null) return dbSingleton;

  poolSingleton = new pg.Pool({
    connectionString: config.databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
  });

  dbSingleton = new Kysely<Database>({
    dialect: new PostgresDialect({ pool: poolSingleton }),
  });

  return dbSingleton;
}

export async function closeDb(): Promise<void> {
  if (dbSingleton !== null) {
    await dbSingleton.destroy();
    dbSingleton = null;
  }
  poolSingleton = null;
}
