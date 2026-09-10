// src/lib/environmentGuard.js — GK-179 shared connection-identity guard.
//
// One assertion helper, called from every module's own acquireConnection()
// (assets/db.js, auth/db.js, valuation/db.js) rather than three
// independently implemented guard algorithms. Verifies a just-acquired
// pg client is actually connected to the database identity the runtime
// expects, before any ordinary domain query executes.
//
// Isolation itself is GRAILKEY_CATALOG_DATABASE_URL -> a distinct Neon
// branch. This guard does not provide isolation — it only tells the
// runtime whether the identity it landed on is the one it is permitted
// to accept, and refuses otherwise.
//
// NO CACHING, DELIBERATE: this runs a fresh query on every
// acquireConnection() call, never memoized by process or by any other
// key. GK-178 (docs/DATABASE-MIGRATION-STATUS.md) proved a Neon
// PgBouncer transaction-pooling connection can be silently routed to a
// different physical backend between calls on what looks like "the same"
// pool — a cached-by-process identity result could therefore assert
// PASS for a connection that is no longer the one it verified. Caching
// this check would reintroduce that exact hazard class for identity
// verification instead of schema resolution. The cost is one extra
// round trip per acquisition; see the guard-overhead measurement in
// tests/gk179-environment-guard-latency.test.js for the real number.

const ALLOWED_ENVIRONMENTS = ['development', 'preview', 'production'];

export class EnvironmentIdentityError extends Error {
  constructor(message, reason) {
    super(message);
    this.name = 'EnvironmentIdentityError';
    this.reason = reason; // machine-readable reason code, see ALLOWED_ENVIRONMENTS usage below
  }
}

// Reason codes, exhaustive — every one is a FAIL CLOSED outcome:
//   EXPECTED_ENV_UNSET     — GRAILKEY_CATALOG_ENVIRONMENT not set
//   EXPECTED_ENV_INVALID   — set, but not development/preview/production
//   MARKER_QUERY_ERROR     — query failed for any reason, including the
//                            marker table not existing (42P01) or a
//                            connection/permission error
//   MARKER_EMPTY           — table exists, zero rows
//   MARKER_MULTIPLE_ROWS   — more than one row (structurally should be
//                            impossible under the singleton constraint;
//                            treated as a guard failure, not undefined
//                            behavior, if it somehow occurs)
//   MARKER_MISMATCH        — exactly one row, value does not match

export async function assertEnvironmentIdentity(client) {
  const expected = process.env.GRAILKEY_CATALOG_ENVIRONMENT;

  if (!expected) {
    throw new EnvironmentIdentityError(
      'GRAILKEY_CATALOG_ENVIRONMENT is not set — refusing to proceed. No default, no inference from hostname, no fallback to development.',
      'EXPECTED_ENV_UNSET'
    );
  }
  if (!ALLOWED_ENVIRONMENTS.includes(expected)) {
    throw new EnvironmentIdentityError(
      `GRAILKEY_CATALOG_ENVIRONMENT="${expected}" is not one of ${ALLOWED_ENVIRONMENTS.join('/')} — refusing to proceed.`,
      'EXPECTED_ENV_INVALID'
    );
  }

  let result;
  try {
    result = await client.query('SELECT app_env FROM data1_dev.environment_marker');
  } catch (e) {
    throw new EnvironmentIdentityError(
      `environment_marker could not be read — refusing to proceed (fail closed): ${e.message}`,
      'MARKER_QUERY_ERROR'
    );
  }

  if (result.rowCount === 0) {
    throw new EnvironmentIdentityError(
      'environment_marker is empty — a database with no identity is not a database this application will use.',
      'MARKER_EMPTY'
    );
  }
  if (result.rowCount > 1) {
    throw new EnvironmentIdentityError(
      `environment_marker has ${result.rowCount} rows — expected exactly 1. Refusing to proceed.`,
      'MARKER_MULTIPLE_ROWS'
    );
  }

  const actual = result.rows[0].app_env;
  if (actual !== expected) {
    throw new EnvironmentIdentityError(
      `environment_marker.app_env="${actual}" does not match GRAILKEY_CATALOG_ENVIRONMENT="${expected}" — refusing to proceed.`,
      'MARKER_MISMATCH'
    );
  }

  return actual;
}
