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

// One connection, for the duration of a single service-function call.
// Callers MUST release() in a finally block.
//
// GK-178 (2026-09-03) — this used to also run `SET search_path TO
// data1_dev` here, once per checkout, on the theory that it would
// persist for the connection's lifetime. It does not: this pool's
// connection string resolves to a Neon PgBouncer transaction-pooling
// endpoint, which does not guarantee that a `SET` issued as its own
// statement survives to any later statement on the "same" pg.Pool
// client — proven with real pg_backend_pid() drift mid-operation and
// real 42P01 "relation does not exist" errors, reproducible at 3
// concurrent operations (docs/DATABASE-MIGRATION-STATUS.md, "GK-178").
// The fix is architectural, not a retry or a bigger pool: every query
// in repository.js/idempotency.js/service.js is now schema-qualified
// (`data1_dev.<table>`) instead, which needs no session state at all —
// correct regardless of concurrency, pool warmth, or which physical
// backend PgBouncer happens to route a given statement to. Do not
// reintroduce a bare `SET search_path` here as a "convenience" — it
// would silently reintroduce this exact hazard.
export async function acquireConnection() {
  return getPool().connect();
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
