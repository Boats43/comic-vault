// src/modules/assets/db.js — PRIVATE. Never imported outside this module
// (src/modules/assets/) — enforced by tests/assets-module-boundary.test.js
// (S3-11, DATA-1B).
//
// Lazy pg.Pool singleton. Reads GRAILKEY_CATALOG_DATABASE_URL (the
// POOLED variant, via Neon's own PgBouncer — same env var
// C:\grailkey-data\data-1\lib.mjs already used, not the _UNPOOLED /
// _NON_POOLING sibling) directly from process.env. Does NOT read any
// .env* file itself — that's a local-script concern (see
// scripts/query-scanlog.mjs's own "this repo has no dotenv dependency"
// convention), pushed to callers, so a real Vercel deployment's
// env-injected process.env works unmodified. See
// docs/adr/DATA-1B-ASSET-SERVICE-DESIGN.md, Section 4, for the full
// driver-choice rationale (pg over @neondatabase/serverless, for now).

import pg from 'pg';

let pool = null;

export function getPool() {
  if (pool) return pool;
  const connectionString = process.env.GRAILKEY_CATALOG_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      '[assets/db] GRAILKEY_CATALOG_DATABASE_URL is not set in process.env. ' +
      'This module never reads .env files itself — the caller (a local script, ' +
      'or Vercel\'s own env injection) must populate process.env before use.'
    );
  }
  pool = new pg.Pool({ connectionString, max: 5 });
  return pool;
}

// One connection, search_path already set to data1_dev, for the duration
// of a single service-function call. Callers MUST release() in a
// finally block.
export async function acquireConnection() {
  const client = await getPool().connect();
  await client.query('SET search_path TO data1_dev');
  return client;
}

// Test/shutdown only — closes the pool. Never called from service.js
// itself (a long-lived module has no natural "done" moment); exists so
// proof scripts can exit cleanly.
export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
