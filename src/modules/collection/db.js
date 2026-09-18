// src/modules/collection/db.js — PRIVATE. Never imported outside this
// module (src/modules/collection/) — enforced by
// tests/collection-module-boundary.test.js.
//
// Byte-for-byte the same pattern as src/modules/assets/db.js (and
// src/modules/auth/db.js, src/modules/valuation/db.js): a lazy pg.Pool
// singleton reading GRAILKEY_CATALOG_DATABASE_URL directly from
// process.env, and an acquireConnection() that runs
// assertEnvironmentIdentity() before ever handing a client to a caller.
// Deliberately not shared/imported from assets/db.js — db.js is PRIVATE
// to its own module by this repo's own module-boundary convention
// (assets-module-boundary.test.js, S3-11); every module that needs a
// connection gets its own copy of this same, small file rather than
// reaching across a module boundary for it.
//
// GK-178: every query in repository.js is schema-qualified
// (data1_dev.<table>) — no `SET search_path` here, ever (see
// assets/db.js's own header for the full incident this guards against).

import pg from 'pg';
import { assertEnvironmentIdentity } from '../../lib/environmentGuard.js';

let pool = null;

export function getPool() {
  if (pool) return pool;
  const connectionString = process.env.GRAILKEY_CATALOG_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      '[collection/db] GRAILKEY_CATALOG_DATABASE_URL is not set in process.env. ' +
      'This module never reads .env files itself — the caller (a local script, ' +
      'or Vercel\'s own env injection) must populate process.env before use.'
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

// Test/shutdown only.
export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
