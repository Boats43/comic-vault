// src/modules/auth/db.js — PRIVATE. Never imported outside
// src/modules/auth/ — enforced by tests/auth-module-boundary.test.js.
//
// Same shape as src/modules/assets/db.js — a separate lazy pg.Pool
// singleton, deliberately not sharing a pool with the Asset Service
// (each module owns its own persistence, per the established module-
// boundary discipline — a future split of auth onto its own datastore
// would not require touching assets/ at all). Same env var
// (GRAILKEY_CATALOG_DATABASE_URL) and the same data1_dev schema — the
// principal_credential table lives alongside gk_principal, not in a
// separate database.

import pg from 'pg';

let pool = null;

export function getPool() {
  if (pool) return pool;
  const connectionString = process.env.GRAILKEY_CATALOG_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      '[auth/db] GRAILKEY_CATALOG_DATABASE_URL is not set in process.env. ' +
      'This module never reads .env files itself.'
    );
  }
  pool = new pg.Pool({ connectionString, max: 5 });
  return pool;
}

// GK-178 (2026-09-03) — no longer runs `SET search_path TO data1_dev`
// here; see src/modules/assets/db.js's own acquireConnection() header
// for the full rationale (Neon PgBouncer transaction-pooling does not
// guarantee a bare SET survives to later statements). auth/repository.js
// now schema-qualifies every table reference instead.
export async function acquireConnection() {
  return getPool().connect();
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
