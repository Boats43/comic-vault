// src/modules/buyer/db.js — PRIVATE. Never imported outside this module
// (src/modules/buyer/) — mirrors src/modules/assets/db.js's own
// boundary and connection discipline exactly (see that file's header
// for the full GK-178/GK-179 rationale, restated only briefly here).
//
// A separate pg.Pool from assets/auth's own pools, same connection
// string (GRAILKEY_CATALOG_DATABASE_URL, pooled). Every query in
// repository.js is schema-qualified (data1_dev.<table>) — no bare
// `SET search_path` is ever issued here, for the same pooled-connection
// session-state reason assets/db.js documents (GK-178).

import pg from 'pg';
import { assertEnvironmentIdentity } from '../../lib/environmentGuard.js';

let pool = null;

export function getPool() {
  if (pool) return pool;
  const connectionString = process.env.GRAILKEY_CATALOG_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      '[buyer/db] GRAILKEY_CATALOG_DATABASE_URL is not set in process.env. ' +
      'This module never reads .env files itself — the caller (a local script, ' +
      'or Vercel\'s own env injection) must populate process.env before use.'
    );
  }
  pool = new pg.Pool({ connectionString, max: 5 });
  return pool;
}

// One connection, for the duration of a single service-function call.
// Callers MUST release() in a finally block. Gated by
// assertEnvironmentIdentity() before the client is handed to the caller
// — same GK-179 fail-closed law every other module's acquireConnection()
// enforces.
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
