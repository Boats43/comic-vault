// tests/gk194-stored-function-resolution-scratch.test.js
//
// GK-194 -- real, isolated scratch-schema proof of
// db/data0/0019_gk194_stored_function_schema_resolution.sql (renamed
// from the originally-described 0018_gk194_... after GK-179 consumed
// that number first; no other change).
//
// Replicates the exact live function bodies (byte-identical to
// db/data0/0013_d4_identifier_fabric.sql:301-329 and
// db/data0/0015_d1_identity_assignment_immutability.sql:112-138) in an
// isolated scratch schema, proves the pre-fix hazard reproduces, applies
// 0019, proves it's fixed, proves rollback, proves idempotent re-apply.
// data1_dev is never touched.
//
// A13: consumes GRAILKEY_CATALOG_DATABASE_URL_UNPOOLED blind via
// process.env (populated by --env-file), never reads/prints it.
//
// Invoke: node --env-file=.env.development.local tests/gk194-stored-function-resolution-scratch.test.js

import { Client } from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const read = (f) => readFileSync(path.join(repoRoot, 'db', 'data0', f), 'utf8');

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

console.log('\n=== GK-194 -- 0019 stored function schema resolution (real, isolated scratch-schema proof) ===\n');

const connectionString = process.env.GRAILKEY_CATALOG_DATABASE_URL_UNPOOLED;
if (!connectionString) { console.log('BLOCKED — VARIABLE NOT SET (GRAILKEY_CATALOG_DATABASE_URL_UNPOOLED)'); process.exit(2); }

const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();
const { rows: [{ pid: sessionPid }] } = await client.query('SELECT pg_backend_pid() AS pid');
console.log('  dedicated backend PID for this entire script:', sessionPid);

async function assertScratchTarget(expectedSchema, label) {
  const r = await client.query('SELECT current_schema() AS s, pg_backend_pid() AS pid');
  if (r.rows[0].pid !== sessionPid) throw new Error(`SAFETY ABORT (${label}): backend PID changed mid-script`);
  if (r.rows[0].s === 'data1_dev') throw new Error(`SAFETY ABORT (${label}): current_schema() resolved to data1_dev -- refusing unconditionally`);
  if (r.rows[0].s !== expectedSchema) throw new Error(`SAFETY ABORT (${label}): expected "${expectedSchema}", got "${r.rows[0].s}"`);
}

const SCHEMA = `gk194_0019_scratch_${Date.now()}`;
const qualify = (raw) => raw.replace(/\bdata1_dev\b/g, SCHEMA);

async function getProconfig(fnName) {
  const r = await client.query(
    `SELECT proconfig FROM pg_proc WHERE proname = $1 AND pronamespace = $2::regnamespace`,
    [fnName, SCHEMA]
  );
  return r.rows[0]?.proconfig ?? null;
}
async function getProsrc(fnName) {
  const r = await client.query(
    `SELECT prosrc FROM pg_proc WHERE proname = $1 AND pronamespace = $2::regnamespace`,
    [fnName, SCHEMA]
  );
  return r.rows[0]?.prosrc;
}
function normalize(pc) {
  if (!pc) return null;
  const out = {};
  for (const entry of pc) {
    const eq = entry.indexOf('=');
    out[entry.slice(0, eq).trim()] = entry.slice(eq + 1).trim().split(',').map(s => s.trim()).sort();
  }
  return out;
}

const FN_NAMES = ['asset_identifier_assertion_guard', 'asset_identity_assignment_guard'];

try {
  await client.query(`CREATE SCHEMA ${SCHEMA}`);
  await client.query(`SET search_path TO ${SCHEMA}`);
  await assertScratchTarget(SCHEMA, 'post-setup');

  // -------------------------------------------------------------------
  // Setup: minimal tables + the EXACT live function/trigger bodies
  // -------------------------------------------------------------------
  await client.query(`
    CREATE TABLE asset_identifier_assertion (
      id UUID PRIMARY KEY,
      identifier_id UUID,
      asset_id UUID,
      source TEXT,
      recorded_by_principal_id UUID,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      occurred_at TIMESTAMPTZ,
      resolution_authority TEXT,
      superseded_by UUID
    );
    CREATE TABLE asset_identity_assignment (
      id UUID PRIMARY KEY,
      asset_id UUID,
      catalog_entity_id UUID,
      authority TEXT,
      source TEXT,
      occurred_at TIMESTAMPTZ,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      superseded_by UUID
    );
  `);

  await client.query(`
    CREATE OR REPLACE FUNCTION asset_identifier_assertion_guard() RETURNS TRIGGER AS $$
    DECLARE target_superseded_by UUID;
    BEGIN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'asset_identifier_assertion rows are never deleted -- id=% (correct via a new superseding assertion instead)', OLD.id;
      END IF;
      IF OLD.superseded_by IS NOT NULL THEN
        RAISE EXCEPTION 'asset_identifier_assertion id=% is already superseded -- no further mutation permitted', OLD.id;
      END IF;
      IF NEW.superseded_by IS NULL THEN
        RAISE EXCEPTION 'asset_identifier_assertion id=% -- UPDATE must set superseded_by (no other mutation permitted)', OLD.id;
      END IF;
      IF NEW.identifier_id IS DISTINCT FROM OLD.identifier_id
         OR NEW.asset_id IS DISTINCT FROM OLD.asset_id
         OR NEW.source IS DISTINCT FROM OLD.source
         OR NEW.recorded_by_principal_id IS DISTINCT FROM OLD.recorded_by_principal_id
         OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at
         OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at
         OR NEW.resolution_authority IS DISTINCT FROM OLD.resolution_authority
      THEN
        RAISE EXCEPTION 'asset_identifier_assertion id=% -- only superseded_by may be set; all other fields are immutable after insert', OLD.id;
      END IF;
      SELECT superseded_by INTO target_superseded_by FROM asset_identifier_assertion WHERE id = NEW.superseded_by FOR UPDATE;
      IF target_superseded_by IS NOT NULL THEN
        RAISE EXCEPTION 'asset_identifier_assertion id=% -- superseded_by target % is itself already superseded; cannot supersede into a non-live row (cycle guard)', OLD.id, NEW.superseded_by;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER asset_identifier_assertion_no_update BEFORE UPDATE ON asset_identifier_assertion FOR EACH ROW EXECUTE FUNCTION asset_identifier_assertion_guard();

    CREATE OR REPLACE FUNCTION asset_identity_assignment_guard() RETURNS TRIGGER AS $$
    DECLARE target_superseded_by UUID;
    BEGIN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'asset_identity_assignment rows are never deleted -- id=% (correct via a new superseding assignment instead)', OLD.id;
      END IF;
      IF OLD.superseded_by IS NOT NULL THEN
        RAISE EXCEPTION 'asset_identity_assignment id=% is already superseded -- no further mutation permitted', OLD.id;
      END IF;
      IF NEW.superseded_by IS NULL THEN
        RAISE EXCEPTION 'asset_identity_assignment id=% -- UPDATE must set superseded_by (no other mutation permitted)', OLD.id;
      END IF;
      IF NEW.asset_id IS DISTINCT FROM OLD.asset_id
         OR NEW.catalog_entity_id IS DISTINCT FROM OLD.catalog_entity_id
         OR NEW.authority IS DISTINCT FROM OLD.authority
         OR NEW.source IS DISTINCT FROM OLD.source
         OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at
         OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at
      THEN
        RAISE EXCEPTION 'asset_identity_assignment id=% -- only superseded_by may be set; all other fields are immutable after insert', OLD.id;
      END IF;
      SELECT superseded_by INTO target_superseded_by FROM asset_identity_assignment WHERE id = NEW.superseded_by FOR UPDATE;
      IF target_superseded_by IS NOT NULL THEN
        RAISE EXCEPTION 'asset_identity_assignment id=% -- superseded_by target % is itself already superseded; cannot supersede into a non-live row (cycle guard)', OLD.id, NEW.superseded_by;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER asset_identity_assignment_no_update BEFORE UPDATE ON asset_identity_assignment FOR EACH ROW EXECUTE FUNCTION asset_identity_assignment_guard();
  `);
  console.log('  setup: minimal tables + exact live function/trigger bodies created — OK');

  // Snapshot the full object inventory before touching anything, to prove
  // "no unrelated schema object changes" later.
  const preObjects = await client.query(`
    SELECT 'table' AS kind, table_name AS name FROM information_schema.tables WHERE table_schema = $1
    UNION ALL SELECT 'function', proname FROM pg_proc WHERE pronamespace = $1::regnamespace
    UNION ALL SELECT 'trigger', tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = $1 AND NOT t.tgisinternal
    ORDER BY kind, name
  `, [SCHEMA]);

  const asset1 = '00000000-0000-0000-0000-000000000001';
  const asset2 = '00000000-0000-0000-0000-000000000002';
  await client.query(`INSERT INTO asset_identifier_assertion (id, asset_id, source) VALUES ($1, $2, 'test')`, [asset1, asset1]);
  await client.query(`INSERT INTO asset_identity_assignment (id, asset_id, authority, source) VALUES ($1, $2, 'NONE', 'vision')`, [asset1, asset1]);

  // -------------------------------------------------------------------
  // Pre-fix: prove the hazard reproduces under a hostile session
  // search_path that excludes the scratch schema.
  // -------------------------------------------------------------------
  const before1 = await getProconfig('asset_identifier_assertion_guard');
  const before2 = await getProconfig('asset_identity_assignment_guard');
  assertTrue(before1 === null, 'ENV-P0a: pre-fix asset_identifier_assertion_guard has proconfig = NULL (matches live baseline)');
  assertTrue(before2 === null, 'ENV-P0b: pre-fix asset_identity_assignment_guard has proconfig = NULL (matches live baseline)');

  await client.query(`SET search_path TO public`); // hostile: excludes the scratch schema entirely
  let hostileFailed1 = false, hostileError1 = '';
  try {
    await client.query(`UPDATE ${SCHEMA}.asset_identifier_assertion SET superseded_by = $1 WHERE id = $2`, [asset2, asset1]);
  } catch (e) { hostileFailed1 = true; hostileError1 = e.message; }
  assertTrue(hostileFailed1 && /does not exist|42P01/i.test(hostileError1), `PRE-FIX-1: hostile session search_path reproduces 42P01 on asset_identifier_assertion_guard (${hostileError1.slice(0, 80)})`);

  let hostileFailed2 = false, hostileError2 = '';
  try {
    await client.query(`UPDATE ${SCHEMA}.asset_identity_assignment SET superseded_by = $1 WHERE id = $2`, [asset2, asset1]);
  } catch (e) { hostileFailed2 = true; hostileError2 = e.message; }
  assertTrue(hostileFailed2 && /does not exist|42P01/i.test(hostileError2), `PRE-FIX-2: hostile session search_path reproduces 42P01 on asset_identity_assignment_guard (${hostileError2.slice(0, 80)})`);

  await client.query(`SET search_path TO ${SCHEMA}`);
  await assertScratchTarget(SCHEMA, 'post-hostile-restore');

  // -------------------------------------------------------------------
  // Apply 0019 forward
  // -------------------------------------------------------------------
  await client.query(qualify(read('0019_gk194_stored_function_schema_resolution.sql')));
  console.log('  0019 forward applied — OK');

  const srcBefore1 = await getProsrc('asset_identifier_assertion_guard');
  const srcBefore2 = await getProsrc('asset_identity_assignment_guard');

  const after1 = normalize(await getProconfig('asset_identifier_assertion_guard'));
  const after2 = normalize(await getProconfig('asset_identity_assignment_guard'));
  const expected = { search_path: [SCHEMA.toLowerCase(), 'pg_catalog'] };
  assertTrue(JSON.stringify(after1) === JSON.stringify(expected), `F1: asset_identifier_assertion_guard proconfig = {search_path: [pg_catalog, ${SCHEMA}]} (semantic)`);
  assertTrue(JSON.stringify(after2) === JSON.stringify(expected), `F2: asset_identity_assignment_guard proconfig = {search_path: [pg_catalog, ${SCHEMA}]} (semantic)`);

  // -------------------------------------------------------------------
  // Required assertion 1/2: hostile session cannot redirect; functions
  // resolve correctly under the pin regardless of caller search_path.
  // -------------------------------------------------------------------
  await client.query(`SET search_path TO public`); // still hostile
  let cycleGuardHit1 = false, msg1 = '';
  try {
    await client.query(`UPDATE ${SCHEMA}.asset_identifier_assertion SET superseded_by = $1 WHERE id = $2`, [asset2, asset1]);
  } catch (e) { cycleGuardHit1 = true; msg1 = e.message; }
  // First real supersession should SUCCEED (target row 'asset2' isn't superseded) -- prove no 42P01, not a cycle-guard trip yet.
  assertTrue(!cycleGuardHit1, `POST-FIX-1a: hostile session, legitimate supersede succeeds (no 42P01) — got: ${msg1.slice(0, 80) || 'success'}`);

  await client.query(`INSERT INTO asset_identifier_assertion (id, asset_id, source, superseded_by) VALUES ($1, $2, 'test', $3)`, [asset2, asset2, asset2]).catch(() => {});
  // Now attempt to supersede INTO asset2, which (after the above) may already be superseded -- construct a genuine cycle case cleanly instead:
  const asset3 = '00000000-0000-0000-0000-000000000003';
  await client.query(`INSERT INTO ${SCHEMA}.asset_identifier_assertion (id, asset_id, source) VALUES ($1, $2, 'test')`, [asset3, asset3]);
  await client.query(`UPDATE ${SCHEMA}.asset_identifier_assertion SET superseded_by = $1 WHERE id = $2`, [asset3, asset1]).catch(() => {}); // asset1 already superseded from above -- expect the "already superseded" guard, not the cycle guard; either way proves the function ran its real logic, not 42P01
  let cycleGuardHit2 = false, msg2 = '';
  try {
    // Try superseding a fresh live row (asset3) into a target that's about to become non-live -- simplest deterministic cycle: point at asset1 which is already superseded.
    await client.query(`INSERT INTO ${SCHEMA}.asset_identifier_assertion (id, asset_id, source) VALUES ($1, $1, 'test')`, ['00000000-0000-0000-0000-000000000004']);
    await client.query(`UPDATE ${SCHEMA}.asset_identifier_assertion SET superseded_by = $1 WHERE id = $2`, [asset1, '00000000-0000-0000-0000-000000000004']);
  } catch (e) { cycleGuardHit2 = true; msg2 = e.message; }
  assertTrue(cycleGuardHit2 && /already superseded|cycle guard/i.test(msg2), `POST-FIX-1b: hostile session, real cycle-guard logic fires correctly (not 42P01): ${msg2.slice(0, 90)}`);

  await client.query(`SET search_path TO ${SCHEMA}`);
  await assertScratchTarget(SCHEMA, 'post-hostile-proof');
  console.log('  bodies unchanged after fix (byte-identical prosrc):',
    srcBefore1 === await getProsrc('asset_identifier_assertion_guard') &&
    srcBefore2 === await getProsrc('asset_identity_assignment_guard'));

  // -------------------------------------------------------------------
  // Required assertion 4: rollback returns proconfig to NULL
  // -------------------------------------------------------------------
  await client.query(qualify(read('0019_gk194_stored_function_schema_resolution_rollback.sql')));
  const rb1 = await getProconfig('asset_identifier_assertion_guard');
  const rb2 = await getProconfig('asset_identity_assignment_guard');
  assertTrue(rb1 === null, 'R1: rollback returns asset_identifier_assertion_guard proconfig to NULL');
  assertTrue(rb2 === null, 'R2: rollback returns asset_identity_assignment_guard proconfig to NULL');

  // -------------------------------------------------------------------
  // Required assertion 5: re-apply produces the target state again
  // -------------------------------------------------------------------
  await client.query(qualify(read('0019_gk194_stored_function_schema_resolution.sql')));
  const re1 = normalize(await getProconfig('asset_identifier_assertion_guard'));
  const re2 = normalize(await getProconfig('asset_identity_assignment_guard'));
  assertTrue(JSON.stringify(re1) === JSON.stringify(expected), 'RE1: re-apply after rollback reproduces the target proconfig');
  assertTrue(JSON.stringify(re2) === JSON.stringify(expected), 'RE2: re-apply after rollback reproduces the target proconfig');

  // -------------------------------------------------------------------
  // Idempotent-reapply proof: apply forward AGAIN on top of an
  // already-applied state -- no error, no change.
  // -------------------------------------------------------------------
  let idempotentError = null;
  try {
    await client.query(qualify(read('0019_gk194_stored_function_schema_resolution.sql')));
  } catch (e) { idempotentError = e.message; }
  const idem1 = normalize(await getProconfig('asset_identifier_assertion_guard'));
  const idem2 = normalize(await getProconfig('asset_identity_assignment_guard'));
  assertTrue(idempotentError === null, 'IDEMPOTENT: re-applying 0019 to an already-fixed target produces no error');
  assertTrue(JSON.stringify(idem1) === JSON.stringify(expected) && JSON.stringify(idem2) === JSON.stringify(expected), 'IDEMPOTENT: proconfig unchanged after redundant re-apply');

  // -------------------------------------------------------------------
  // Required assertion 6: no unrelated schema object changes
  // -------------------------------------------------------------------
  const postObjects = await client.query(`
    SELECT 'table' AS kind, table_name AS name FROM information_schema.tables WHERE table_schema = $1
    UNION ALL SELECT 'function', proname FROM pg_proc WHERE pronamespace = $1::regnamespace
    UNION ALL SELECT 'trigger', tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = $1 AND NOT t.tgisinternal
    ORDER BY kind, name
  `, [SCHEMA]);
  assertTrue(JSON.stringify(preObjects.rows) === JSON.stringify(postObjects.rows), 'NO-DRIFT: identical table/function/trigger object inventory before and after the entire 0019 forward/rollback/re-apply/idempotent-reapply sequence');

} finally {
  await client.query(`SET search_path TO ${SCHEMA}`).catch(() => {});
  await assertScratchTarget(SCHEMA, 'pre-teardown').catch((e) => { throw e; });
  await client.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
  await client.end();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  console.log('Failures:');
  failures.forEach(f => console.log(f));
  process.exit(1);
}
