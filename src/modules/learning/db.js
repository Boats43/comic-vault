// src/modules/learning/db.js -- PRIVATE. Same pattern as src/modules/collection/db.js
// (own pool, assertEnvironmentIdentity before any client is handed out, every query
// schema-qualified -- GK-178 discipline).

import pg from 'pg';
import { assertEnvironmentIdentity } from '../../lib/environmentGuard.js';

let pool = null;

export function getPool() {
  if (pool) return pool;
  const connectionString = process.env.GRAILKEY_CATALOG_DATABASE_URL;
  if (!connectionString) {
    throw new Error('[learning/db] GRAILKEY_CATALOG_DATABASE_URL is not set in process.env.');
  }
  pool = new pg.Pool({ connectionString, max: 3 });
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

// Test/shutdown only.
export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
