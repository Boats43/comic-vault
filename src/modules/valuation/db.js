// src/modules/valuation/db.js — PRIVATE. Never imported outside this
// module (src/modules/valuation/) — enforced by
// tests/valuation-module-boundary.test.js, mirroring
// tests/assets-module-boundary.test.js (S3-11, DATA-1B) exactly.
//
// D5D isolated-writer-design dispatch (GrailKey, 2026-09-03) — this
// module has ZERO production call sites. No file under api/ imports
// anything from src/modules/valuation/, proven by the boundary test.
// Runtime wiring into any live request path is explicitly HOLD until
// Milestone Ten's independent phone proof closes (CLAUDE.md, "WHAT
// MUST NOT BE DONE").
//
// Own pool, separate from src/modules/assets/'s own pool -- two pools
// against the same Neon instance is normal and safe (each independently
// capped at max:5); this module never imports assets/db.js.

import pg from 'pg';
import { assertEnvironmentIdentity } from '../../lib/environmentGuard.js';

let pool = null;

export function getPool() {
  if (pool) return pool;
  const connectionString = process.env.GRAILKEY_CATALOG_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      '[valuation/db] GRAILKEY_CATALOG_DATABASE_URL is not set in process.env. ' +
      'This module never reads .env files itself -- the caller must populate process.env before use.'
    );
  }
  pool = new pg.Pool({ connectionString, max: 5 });
  return pool;
}

// GK-178 discipline, reused verbatim (the same hazard class this
// project already proved live for src/modules/assets/db.js and
// src/modules/auth/db.js): NEVER issue a bare `SET search_path` here.
// Every query in repository.js/idempotency.js/service.js is
// schema-qualified (`data1_dev.<table>`) instead -- correct regardless
// of concurrency, pool warmth, or which physical PgBouncer backend a
// given statement lands on.
// GK-179 (2026-09-09) — see src/modules/assets/db.js's own
// acquireConnection() header for the full rationale; identical shape
// here, sharing the one assertEnvironmentIdentity() helper. Valuation
// has zero production call sites (D5D, GK-180) — this wiring is dormant
// in production traffic today but keeps the module consistent with its
// two siblings the moment it is ever wired live.
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
