#!/usr/bin/env node
/**
 * db-admin-preflight — P0-C (POST-OPERATORACTION P0 dispatch, ADMIN/
 * CONNECTION SAFETY).
 *
 * Evidence this exists at all: during Outcome #1's own Option-D backup
 * step, `GRAILKEY_CATALOG_DATABASE_URL_UNPOOLED` in the root
 * .env.development.local was found resolving to a completely unrelated
 * Neon database ("bookforge", public schema only, no data1_dev) while
 * the pooled `GRAILKEY_CATALOG_DATABASE_URL` resolved correctly. That
 * was caught only because a human manually ran `\dn`/`current_database()`
 * before dumping. This module makes that check mandatory and automatic
 * for any admin tool (pg_dump, a future migration runner, ad hoc SQL)
 * instead of relying on a human remembering to look.
 *
 * What this DOES verify, as a hard gate, before returning a usable
 * connection:
 *   1. current_database() matches the expected database name.
 *   2. The data1_dev schema genuinely exists.
 *   3. data1_dev.environment_marker.app_env matches
 *      GRAILKEY_CATALOG_ENVIRONMENT — reuses src/lib/environmentGuard.js's
 *      OWN assertEnvironmentIdentity() verbatim (the same fail-closed
 *      check every production module's acquireConnection() already
 *      runs, GK-179) rather than re-implementing an equivalent, possibly
 *      drifting second copy of the same rule.
 *
 * What this DOES NOT verify, disclosed rather than silently skipped:
 *   Neon project/branch identity cannot be independently confirmed from
 *   here — there is no neonctl, no NEON_API_KEY, no MCP Neon-management
 *   tool in this project (docs/DATABASE-MIGRATION-STATUS.md's own
 *   standing capability gap), and a Neon endpoint hostname does not
 *   legibly embed the project id in any form this script could check
 *   (confirmed by direct comparison — the project id string does not
 *   appear as a hostname substring in either the pooled or unpooled
 *   connection strings). The hostname actually used is still logged
 *   (structure only — see redactHost below) so a human can cross-check
 *   it against the Neon Console when in doubt; this is a disclosed gap,
 *   not a silent one, matching this repo's own "DISCLOSED GAP, not
 *   invented silently" convention (see GK-142's Section 3 for the
 *   precedent this phrasing borrows).
 *
 * Usage (programmatic, the intended path for any future admin script):
 *   import { assertAdminDbTarget } from './db-admin-preflight.mjs';
 *   const client = await assertAdminDbTarget({ connectionString, label: 'pg_dump' });
 *   // ... use client, then client.end() yourself — this function does
 *   // not release/close it, matching pg.Client's own ownership model.
 *
 * Usage (CLI diagnostic — never prints the connection string itself):
 *   node scripts/db-admin-preflight.mjs                  # checks GRAILKEY_CATALOG_DATABASE_URL
 *   node scripts/db-admin-preflight.mjs --unpooled        # checks the _UNPOOLED variant instead
 *   node scripts/db-admin-preflight.mjs --env-var=SOME_OTHER_URL_VAR
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { Client } from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

export const DEFAULT_EXPECTED_DATABASE = 'neondb';

export class AdminConnectionMismatchError extends Error {
  constructor(message, reason) {
    super(message);
    this.name = 'AdminConnectionMismatchError';
    this.reason = reason;
  }
}

// Never returns/logs anything containing user/password — hostname alone
// is not a credential, but this still strips anything before an "@" or
// after a port, defensively, in case a caller ever passes a full URL by
// mistake into a context that logs this return value.
export function redactHost(connectionString) {
  try {
    const u = new URL(connectionString);
    return u.hostname;
  } catch {
    return '(unparseable)';
  }
}

/**
 * Hard gate. Throws AdminConnectionMismatchError (never lets a caller
 * proceed to real SQL/pg_dump) on any mismatch. Returns a connected,
 * verified pg.Client on success — caller owns it (must .end() it).
 */
export async function assertAdminDbTarget({
  connectionString,
  label = 'admin operation',
  expectedDatabase = process.env.GRAILKEY_CATALOG_EXPECTED_DATABASE || DEFAULT_EXPECTED_DATABASE,
} = {}) {
  if (!connectionString) {
    throw new AdminConnectionMismatchError(
      `[db-admin-preflight] ${label}: no connection string provided — refusing to proceed with no target to verify.`,
      'NO_CONNECTION_STRING'
    );
  }
  const host = redactHost(connectionString);
  console.log(`  [db-admin-preflight] ${label}: connecting to host "${host}" for verification (project/branch identity not independently checkable here — see file header)…`);

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
  } catch (e) {
    throw new AdminConnectionMismatchError(
      `[db-admin-preflight] ${label}: could not connect to host "${host}": ${e.message}`,
      'CONNECT_FAILED'
    );
  }

  try {
    const dbRes = await client.query('SELECT current_database() AS db');
    const actualDatabase = dbRes.rows[0]?.db;
    if (actualDatabase !== expectedDatabase) {
      throw new AdminConnectionMismatchError(
        `[db-admin-preflight] ${label}: ABORTING — connected to database "${actualDatabase}" on host "${host}", ` +
        `expected "${expectedDatabase}". This is exactly the class of mismatch that silently pointed ` +
        `GRAILKEY_CATALOG_DATABASE_URL_UNPOOLED at an unrelated "bookforge" database — refusing to run any SQL/pg_dump against it.`,
        'DATABASE_MISMATCH'
      );
    }

    const schemaRes = await client.query(
      `SELECT 1 FROM information_schema.schemata WHERE schema_name = 'data1_dev'`
    );
    if (schemaRes.rowCount === 0) {
      throw new AdminConnectionMismatchError(
        `[db-admin-preflight] ${label}: ABORTING — database "${actualDatabase}" on host "${host}" has no data1_dev ` +
        `schema at all. Refusing to run any SQL/pg_dump against a target that isn't GrailKey's own catalog database.`,
        'SCHEMA_MISSING'
      );
    }

    // Reuse the SAME environment-identity check every production module's
    // acquireConnection() already runs (GK-179) — one rule, one place.
    const { assertEnvironmentIdentity } = await import(
      pathToFileURL(path.join(repoRoot, 'src', 'lib', 'environmentGuard.js'))
    );
    try {
      await assertEnvironmentIdentity(client);
    } catch (e) {
      throw new AdminConnectionMismatchError(
        `[db-admin-preflight] ${label}: ABORTING — environment-identity check failed on host "${host}": ${e.message}`,
        e.reason || 'ENVIRONMENT_IDENTITY_FAILED'
      );
    }

    console.log(`  [db-admin-preflight] ${label}: PASSED — database "${actualDatabase}", data1_dev present, environment identity confirmed.`);
    return client;
  } catch (e) {
    await client.end().catch(() => {});
    throw e;
  }
}

// --- CLI entrypoint ---
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  const envVarArg = args.find((a) => a.startsWith('--env-var='));
  const envVar = envVarArg
    ? envVarArg.slice('--env-var='.length)
    : args.includes('--unpooled')
      ? 'GRAILKEY_CATALOG_DATABASE_URL_UNPOOLED'
      : 'GRAILKEY_CATALOG_DATABASE_URL';

  for (const v of [envVar, 'GRAILKEY_CATALOG_ENVIRONMENT']) {
    if (process.env[v]) continue;
    const text = readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8');
    const m = text.match(new RegExp(`^${v}=(.+)$`, 'm'));
    if (m) process.env[v] = m[1].trim().replace(/^["']|["']$/g, '');
  }

  console.log(`[db-admin-preflight] checking ${envVar}…`);
  try {
    const client = await assertAdminDbTarget({
      connectionString: process.env[envVar],
      label: `CLI check of ${envVar}`,
    });
    await client.end();
    console.log('[db-admin-preflight] RESULT: SAFE TO PROCEED');
    process.exit(0);
  } catch (e) {
    console.log(`[db-admin-preflight] RESULT: ABORT — ${e.message}`);
    process.exit(1);
  }
}
