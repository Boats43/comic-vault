// src/modules/marketplace/db.js — PRIVATE. Never imported outside this
// module (src/modules/marketplace/) — enforced by
// tests/marketplace-module-boundary.test.js.
//
// Lazy pg.Pool singleton — mirrors src/modules/assets/db.js and every
// other module in this project exactly (one pool per module, same
// GRAILKEY_CATALOG_DATABASE_URL, same environment-identity gate on every
// checkout). Does NOT read any .env* file itself.

import pg from 'pg';
import { assertEnvironmentIdentity } from '../../lib/environmentGuard.js';

let pool = null;

export function getPool() {
  if (pool) return pool;
  const connectionString = process.env.GRAILKEY_CATALOG_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      '[marketplace/db] GRAILKEY_CATALOG_DATABASE_URL is not set in process.env. ' +
      'This module never reads .env files itself — the caller (a local script, ' +
      'or Vercel\'s own env injection) must populate process.env before use.'
    );
  }
  pool = new pg.Pool({ connectionString, max: 5 });
  return pool;
}

// GK-179 — every acquisition is gated by assertEnvironmentIdentity()
// before the client is handed to the caller, same as every other module.
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
