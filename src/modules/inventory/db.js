// src/modules/inventory/db.js — PRIVATE. Mirrors
// src/modules/assets/db.js's own connection discipline exactly (GK-178
// no bare SET search_path, GK-179 assertEnvironmentIdentity gate).

import pg from 'pg';
import { assertEnvironmentIdentity } from '../../lib/environmentGuard.js';

let pool = null;

export function getPool() {
  if (pool) return pool;
  const connectionString = process.env.GRAILKEY_CATALOG_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      '[inventory/db] GRAILKEY_CATALOG_DATABASE_URL is not set in process.env. ' +
      'This module never reads .env files itself — the caller must populate process.env before use.'
    );
  }
  pool = new pg.Pool({ connectionString, max: 5 });
  return pool;
}

export async function acquireConnection() {
  const client = await getPool().connect();
  try {
    await assertEnvironmentIdentity(client);
  } catch (e) {
    client.release();
    throw e;
  }
  return client;
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
