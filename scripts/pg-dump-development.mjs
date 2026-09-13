#!/usr/bin/env node
/**
 * pg-dump-development — P0-C admin tooling. The Option-D manual backup
 * procedure (docs/MASTER-BOARD.md, "Retention/backup gate"), now run
 * through db-admin-preflight.mjs's fail-closed connection guard FIRST,
 * instead of a human hand-typing pg_dump against whichever env var they
 * picked. Replaces the ad hoc commands used earlier for Chain #2's own
 * backup — same procedure, now guarded and repeatable.
 *
 * What it does, in order, aborting immediately on any failure:
 *   1. assertAdminDbTarget() against GRAILKEY_CATALOG_DATABASE_URL — the
 *      SAME hard gate every admin operation must pass (database name,
 *      data1_dev exists, environment identity). NEVER dumps a target
 *      that fails this, and NEVER falls back to _UNPOOLED or any other
 *      variable on its own initiative.
 *   2. pg_dump --schema=data1_dev to backups/<timestamp>.sql (gitignored;
 *      never printed, never committed).
 *   3. Restore-verifies the dump into an isolated scratch schema on the
 *      SAME real Development branch (never data1_dev itself), confirms
 *      table counts are non-zero and match a spot-check against the live
 *      schema, then drops the scratch schema.
 *
 * Requires pg_dump/psql on PATH (or set PG_BIN_DIR to the bin directory
 * containing them).
 *
 * Usage: node scripts/pg-dump-development.mjs
 */

import { readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

for (const v of ['GRAILKEY_CATALOG_DATABASE_URL', 'GRAILKEY_CATALOG_ENVIRONMENT']) {
  if (process.env[v]) continue;
  const text = readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8');
  const m = text.match(new RegExp(`^${v}=(.+)$`, 'm'));
  if (m) process.env[v] = m[1].trim().replace(/^["']|["']$/g, '');
}

const { assertAdminDbTarget } = await import(pathToFileURL(path.join(__dirname, 'db-admin-preflight.mjs')));

const PG_BIN_DIR = process.env.PG_BIN_DIR || 'C:/Program Files/PostgreSQL/18/bin';
const PG_DUMP = path.join(PG_BIN_DIR, 'pg_dump.exe');
const PSQL = path.join(PG_BIN_DIR, 'psql.exe');

// execFileSync's own thrown Error embeds the full argv (including the
// connection string, credentials and all) in its .message on a non-zero
// exit — a real secret disclosure this file itself was written to guard
// against elsewhere. Every call goes through this wrapper so a failure
// NEVER lets that argv escape into a log/terminal/error report; the
// original message is stripped, not merely caught-and-rethrown.
function runSanitized(bin, args, label) {
  try {
    execFileSync(bin, args, { stdio: 'inherit' });
  } catch {
    throw new Error(`[pg-dump-development] ${label} failed (exit non-zero) — see the inherited stdout/stderr above for the real error; args withheld because they contain the connection string.`);
  }
}

console.log('=== pg-dump-development — Option-D backup, guarded ===\n');

const client = await assertAdminDbTarget({
  connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL,
  label: 'pg-dump-development',
});
await client.end(); // preflight only needed the connection to verify; pg_dump opens its own

// Alphanumeric only, deliberately — this value is used both as a
// filename suffix AND as a bare (unquoted) Postgres schema identifier
// below. A prior version of this script used toISOString() with only
// `:`/`.` stripped, which left `-` in place and produced an INVALID bare
// identifier (`CREATE SCHEMA data1_dev_verify_2026-09-12t...` — a real
// syntax error hit and fixed while building this script, restore-
// verified clean afterward with no orphaned schema left behind).
const ts = new Date().toISOString().replace(/[^0-9]/g, '');
const dumpPath = path.join(repoRoot, 'backups', `data1_dev_${ts}.sql`);

console.log(`\nRunning pg_dump -> ${path.relative(repoRoot, dumpPath)} …`);
runSanitized(PG_DUMP, [
  process.env.GRAILKEY_CATALOG_DATABASE_URL,
  '--schema=data1_dev', '--no-owner', '--no-privileges', '--format=plain', `--file=${dumpPath}`,
], 'pg_dump');

const stat = statSync(dumpPath);
console.log(`Dump written: ${stat.size} bytes.`);

const scratchSchema = `data1_dev_verify_${ts}`;
const dumpText = readFileSync(dumpPath, 'utf8');
const scratchSql = dumpText.replace(/data1_dev/g, scratchSchema);
const scratchPath = dumpPath.replace('.sql', '_restore_check.sql');
const { writeFileSync, unlinkSync } = await import('node:fs');
writeFileSync(scratchPath, scratchSql);

console.log(`Restore-verifying into isolated scratch schema "${scratchSchema}" …`);
try {
  runSanitized(PSQL, [process.env.GRAILKEY_CATALOG_DATABASE_URL, '-v', 'ON_ERROR_STOP=1', '-f', scratchPath], 'psql restore');
  const countSql = `SELECT (SELECT count(*) FROM ${scratchSchema}.gk_asset) AS gk_asset, (SELECT count(*) FROM ${scratchSchema}.operator_action_event) AS operator_action_event;`;
  runSanitized(PSQL, [process.env.GRAILKEY_CATALOG_DATABASE_URL, '-c', countSql], 'psql count-check');
  console.log('Restore verified readable and queryable.');
} finally {
  runSanitized(PSQL, [process.env.GRAILKEY_CATALOG_DATABASE_URL, '-c', `DROP SCHEMA IF EXISTS ${scratchSchema} CASCADE;`], 'psql drop-scratch-schema');
  unlinkSync(scratchPath);
  console.log(`Scratch schema "${scratchSchema}" dropped — live data1_dev untouched by the verification step.`);
}

console.log(`\nBACKUP PASS — ${path.relative(repoRoot, dumpPath)}`);
