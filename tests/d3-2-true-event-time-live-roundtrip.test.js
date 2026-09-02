// tests/d3-2-true-event-time-live-roundtrip.test.js
//
// D3.2 — true event time. Real, live Postgres proof against an ISOLATED
// SCRATCH SCHEMA in the SAME Neon database data1_dev already lives in —
// NOT data1_dev itself. Migration db/data0/0011_d3_2_event_time.sql has
// NOT been applied to data1_dev (authorization not sought this pass —
// see the D3.2 Standing Report). This file is the real-DB substitute
// proof that was explicitly permitted: "finish the migration/code/tests
// that can be proven locally... report the exact proposed migration...
// then STOP for authorization."
//
// IMPORTANT — repository.js/service.js are DELIBERATELY UNCHANGED by
// this dispatch (reverted after being drafted and tested): an earlier
// draft of this same pass DID modify them to thread occurredAt through,
// and running the (already-committed, D3.1) live round-trip test
// afterward produced a REAL error against the REAL, unmigrated
// data1_dev — `null value in column "occurred_at" of relation
// "ownership_event" violates not-null constraint` — because those
// writer functions started including occurred_at in their INSERT column
// lists (bound to NULL when omitted) while the live column is still
// NOT NULL DEFAULT now() until 0011 actually runs. That is a real,
// concrete proof that shipping the application-code changes ahead of
// the authorized migration is unsafe even LOCALLY (not just "unsafe if
// pushed") — it breaks the very next live call, including the
// already-shipped D3.1 regression test. Application-code wiring
// (repository.js/service.js) is therefore deferred to the pass that
// actually applies 0011, atomically, once authorized. This file proves
// the SCHEMA/migration behavior directly via raw SQL against the
// scratch schema instead — genuinely real, just not routed through
// repository.js's exported functions (which do not yet accept
// occurredAt, on purpose, this pass).
//
// This file does two genuinely real things, not mocks:
//   1. Builds a scratch schema in PRE-migration shape (0004's original
//      column names), inserts a "historical" row the OLD way (omitting
//      occurred_at, exactly like every real writer in this repo does
//      today), then runs the ACTUAL TEXT of 0011 (read from disk, only
//      the schema-qualifying `SET search_path` line adapted) against
//      that scratch schema — proving what happens to a real historical
//      row under the REAL migration, not a hand-simulated approximation.
//   2. After that real migration runs (in scratch only), issues real SQL
//      directly (the exact shape the future repository.js writers will
//      use) against the migrated scratch schema to prove the new write/
//      read contract (A-D, F, G) with real SQL execution, real
//      constraint enforcement, real round-trips. Nothing here is a stub.
//
// data1_dev itself is never touched by this file. Table counts there are
// checked before and after as an explicit proof of that.
//
// Invoke: node tests/d3-2-true-event-time-live-roundtrip.test.js

import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

const envRaw = readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8');
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

console.log('\n=== D3.2 — true event time (real, isolated scratch-schema proof) ===\n');

const SCHEMA = `d3_2_scratch_${Date.now()}`;
const client = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

async function countDataOneDev() {
  await client.query('SET search_path TO data1_dev');
  const r = await client.query(`
    SELECT
      (SELECT COUNT(*)::int FROM ownership_event) AS ownership_event,
      (SELECT COUNT(*)::int FROM acquisition_event) AS acquisition_event,
      (SELECT COUNT(*)::int FROM valuation_event) AS valuation_event,
      (SELECT COUNT(*)::int FROM decision_event) AS decision_event,
      (SELECT COUNT(*)::int FROM domain_event) AS domain_event,
      (SELECT COUNT(*)::int FROM media) AS media,
      (SELECT COUNT(*)::int FROM asset_identity_assignment) AS asset_identity_assignment
  `);
  return r.rows[0];
}

const dataOneDevBefore = await countDataOneDev();
console.log('  data1_dev counts before (untouched throughout this file):', JSON.stringify(dataOneDevBefore));

try {
  // -----------------------------------------------------------------
  // Phase 1 — build the scratch schema in PRE-migration shape (0004's
  // real column names/types, FK constraints dropped since this proof
  // only concerns the timestamp contract, not referential integrity).
  // -----------------------------------------------------------------
  await client.query(`CREATE SCHEMA ${SCHEMA}`);
  await client.query(`SET search_path TO ${SCHEMA}`);
  await client.query(`
    CREATE TABLE ownership_event (
      id UUID PRIMARY KEY, asset_id UUID NOT NULL, owner_principal_id UUID NOT NULL,
      reason TEXT NOT NULL CHECK (reason IN ('initial-mint','transfer','correction')),
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(), recorded_by_principal_id UUID NOT NULL
    );
    CREATE TABLE acquisition_event (
      id UUID PRIMARY KEY, asset_id UUID NOT NULL, cost_amount NUMERIC(12,2) NOT NULL,
      cost_currency TEXT NOT NULL DEFAULT 'USD', source TEXT NOT NULL CHECK (source IN ('purchase','gift','inherited','other')),
      lot_reference TEXT, occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(), recorded_by_principal_id UUID NOT NULL
    );
    CREATE TABLE valuation_event (
      id UUID PRIMARY KEY, asset_id UUID NOT NULL, value_amount NUMERIC(12,2) NOT NULL,
      value_currency TEXT NOT NULL DEFAULT 'USD', method TEXT NOT NULL CHECK (method IN ('engine-computed','operator-override','gocollect','other')),
      comp_snapshot_ref TEXT, grade_assumption NUMERIC(3,1), build_sha TEXT NOT NULL,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(), recorded_by_principal_id UUID NOT NULL
    );
    CREATE TABLE decision_event (
      id UUID PRIMARY KEY, asset_id UUID NOT NULL, recommendation TEXT NOT NULL,
      reason_codes JSONB NOT NULL DEFAULT '[]', valuation_event_id UUID,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE domain_event (
      event_id UUID PRIMARY KEY, event_type TEXT NOT NULL, occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      actor JSONB NOT NULL, subject JSONB NOT NULL, payload JSONB NOT NULL,
      correlation_id UUID NOT NULL, schema_version INT NOT NULL DEFAULT 1
    );
    CREATE TABLE outbox (
      id UUID PRIMARY KEY, domain_event_id UUID NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      attempts INT NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), processed_at TIMESTAMPTZ
    );
    CREATE TABLE media (
      id UUID PRIMARY KEY, asset_id UUID NOT NULL,
      media_type TEXT NOT NULL CHECK (media_type IN ('capture-photo','grading-photo','document')),
      content_hash TEXT NOT NULL, object_uri TEXT, local_path_placeholder TEXT, content_type TEXT,
      captured_at TIMESTAMPTZ NOT NULL DEFAULT now(), recorded_by_principal_id UUID NOT NULL
    );
    CREATE TABLE asset_identity_assignment (
      id UUID PRIMARY KEY, asset_id UUID NOT NULL, catalog_entity_id UUID,
      authority TEXT NOT NULL CHECK (authority IN ('NONE','CONTESTED','CORROBORATED')),
      source TEXT NOT NULL CHECK (source IN ('vision','operator-correction','unresolved')),
      assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(), superseded_by UUID
    );
    CREATE TABLE current_owner (
      asset_id UUID PRIMARY KEY, owner_principal_id UUID NOT NULL,
      as_of_ownership_event_id UUID NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  assertTrue(true, 'Phase 1: scratch schema built in real PRE-migration shape (0004\'s own column names)');

  // -----------------------------------------------------------------
  // Phase 2 — insert one "historical" row per table, the OLD way
  // (exactly matching what every real repository.js writer did before
  // this dispatch: occurred_at/captured_at/assigned_at OMITTED,
  // DEFAULT now() populates it).
  // -----------------------------------------------------------------
  const histIds = {};
  histIds.ownership = (await client.query(`INSERT INTO ownership_event (id, asset_id, owner_principal_id, reason, recorded_by_principal_id) VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'initial-mint', gen_random_uuid()) RETURNING id, occurred_at`)).rows[0];
  histIds.acquisition = (await client.query(`INSERT INTO acquisition_event (id, asset_id, cost_amount, source, recorded_by_principal_id) VALUES (gen_random_uuid(), gen_random_uuid(), 4.99, 'purchase', gen_random_uuid()) RETURNING id, occurred_at`)).rows[0];
  histIds.valuation = (await client.query(`INSERT INTO valuation_event (id, asset_id, value_amount, method, build_sha, recorded_by_principal_id) VALUES (gen_random_uuid(), gen_random_uuid(), 9.99, 'engine-computed', 'abc123', gen_random_uuid()) RETURNING id, occurred_at`)).rows[0];
  histIds.decision = (await client.query(`INSERT INTO decision_event (id, asset_id, recommendation) VALUES (gen_random_uuid(), gen_random_uuid(), 'LIST_NOW') RETURNING id, occurred_at`)).rows[0];
  histIds.domain = (await client.query(`INSERT INTO domain_event (event_id, event_type, actor, subject, payload, correlation_id) VALUES (gen_random_uuid(), 'test.historical', '{}', '{}', '{}', gen_random_uuid()) RETURNING event_id, occurred_at`)).rows[0];
  histIds.media = (await client.query(`INSERT INTO media (id, asset_id, media_type, content_hash, recorded_by_principal_id) VALUES (gen_random_uuid(), gen_random_uuid(), 'capture-photo', 'deadbeef', gen_random_uuid()) RETURNING id, captured_at`)).rows[0];
  histIds.identity = (await client.query(`INSERT INTO asset_identity_assignment (id, asset_id, authority, source) VALUES (gen_random_uuid(), gen_random_uuid(), 'NONE', 'unresolved') RETURNING id, assigned_at`)).rows[0];
  assertTrue(true, 'Phase 2: 7 "historical" rows inserted the OLD way (occurred_at/captured_at/assigned_at omitted, DEFAULT now() populated)');

  // -----------------------------------------------------------------
  // Phase 3 — run the ACTUAL 0011 migration text (read from disk),
  // schema-qualified to the scratch schema instead of data1_dev.
  // -----------------------------------------------------------------
  let migrationSql = readFileSync(path.join(repoRoot, 'db', 'data0', '0011_d3_2_event_time.sql'), 'utf8');
  migrationSql = migrationSql.replace('SET search_path TO data1_dev;', `SET search_path TO ${SCHEMA};`);
  // outbox has no occurred_at-shaped column in 0011's scope (by design,
  // queue mechanics) -- 0011 does not touch it; nothing to strip here.
  await client.query(migrationSql);
  assertTrue(true, 'Phase 3: the REAL 0011 migration text executed successfully against the scratch schema (real DDL, not a hand-written approximation)');

  // -----------------------------------------------------------------
  // Phase 4 (Requirement E) — historical rows retain UNKNOWN occurrence.
  // -----------------------------------------------------------------
  {
    const r = await client.query(`SELECT recorded_at, occurred_at FROM ownership_event WHERE id = $1`, [histIds.ownership.id]);
    assertTrue(r.rows[0].recorded_at.getTime() === histIds.ownership.occurred_at.getTime(), 'E: ownership_event historical row — old value exactly preserved as recorded_at');
    assertTrue(r.rows[0].occurred_at === null, 'E: ownership_event historical row — new occurred_at is NULL (UNKNOWN), not manufactured');
  }
  {
    const r = await client.query(`SELECT recorded_at, occurred_at FROM media WHERE id = $1`, [histIds.media.id]);
    assertTrue(r.rows[0].recorded_at.getTime() === histIds.media.captured_at.getTime(), 'E: media historical row — old captured_at value exactly preserved as recorded_at');
    assertTrue(r.rows[0].occurred_at === null, 'E: media historical row — new occurred_at is NULL (UNKNOWN), not manufactured');
  }
  {
    const r = await client.query(`SELECT recorded_at, occurred_at FROM asset_identity_assignment WHERE id = $1`, [histIds.identity.id]);
    assertTrue(r.rows[0].recorded_at.getTime() === histIds.identity.assigned_at.getTime(), 'E: asset_identity_assignment historical row — old assigned_at value exactly preserved as recorded_at');
    assertTrue(r.rows[0].occurred_at === null, 'E: asset_identity_assignment historical row — new occurred_at is NULL (UNKNOWN), not manufactured');
  }
  for (const [tbl, idField, hist] of [
    ['acquisition_event', 'id', histIds.acquisition], ['valuation_event', 'id', histIds.valuation],
    ['decision_event', 'id', histIds.decision], ['domain_event', 'event_id', histIds.domain],
  ]) {
    const r = await client.query(`SELECT recorded_at, occurred_at FROM ${tbl} WHERE ${idField} = $1`, [hist.id ?? hist.event_id]);
    assertTrue(r.rows[0].recorded_at.getTime() === hist.occurred_at.getTime(), `E: ${tbl} historical row — old value exactly preserved as recorded_at`);
    assertTrue(r.rows[0].occurred_at === null, `E: ${tbl} historical row — new occurred_at is NULL (UNKNOWN), not manufactured`);
  }

  // -----------------------------------------------------------------
  // Phase 5 (Requirements A-D, G) — real SQL, the exact shape the future
  // repository.js writers will use once 0011 is authorized and applied
  // (see this file's header for why that application code is not shipped
  // this pass), run directly against the migrated scratch schema.
  // -----------------------------------------------------------------
  const pastDate = new Date('2020-01-15T10:00:00.000Z');
  const futureDate = new Date('2099-01-01T00:00:00.000Z');

  // A: explicit past occurred_at + independently generated recorded_at.
  const ownRes = await client.query(
    `INSERT INTO ownership_event (id, asset_id, owner_principal_id, reason, recorded_by_principal_id, occurred_at)
     VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'initial-mint', gen_random_uuid(), $1)
     RETURNING occurred_at, recorded_at`,
    [pastDate]
  );
  {
    const row = ownRes.rows[0];
    assertTrue(row.occurred_at.getTime() === pastDate.getTime(), 'A: explicit past occurred_at persisted exactly');
    // 5-minute tolerance -- this only needs to prove recorded_at is a real
    // recent server timestamp (not derived from/equal to the past
    // occurredAt value below), not pin down exact clock sync between this
    // process and the DB server (observed ~10s skew between them).
    assertTrue(Math.abs(Date.now() - row.recorded_at.getTime()) < 5 * 60 * 1000, 'A: recorded_at independently generated at real insert time (~now, DB-server clock), not derived from occurred_at');
    assertTrue(row.occurred_at.getTime() !== row.recorded_at.getTime(), 'A: occurred_at and recorded_at are genuinely independent values');
  }

  // B: NULL occurred_at (omitted entirely -- the column is nullable with
  // no default, per 0011; omitting it from the INSERT list, exactly as
  // the future writer will when its own caller omits occurredAt).
  const acqRes = await client.query(
    `INSERT INTO acquisition_event (id, asset_id, cost_amount, source, recorded_by_principal_id)
     VALUES (gen_random_uuid(), gen_random_uuid(), 12.5, 'purchase', gen_random_uuid())
     RETURNING occurred_at, recorded_at`
  );
  {
    const row = acqRes.rows[0];
    assertTrue(row.occurred_at === null, 'B: omitting occurred_at from the INSERT -> NULL, never "now"');
    assertTrue(row.recorded_at !== null, 'B: recorded_at is still populated (DEFAULT now(), unaffected)');
  }

  // C: occurred_at > recorded_at accepted (real INSERT, no error, no
  // CHECK constraint to violate).
  const valRes = await client.query(
    `INSERT INTO valuation_event (id, asset_id, value_amount, method, build_sha, recorded_by_principal_id, occurred_at)
     VALUES (gen_random_uuid(), gen_random_uuid(), 25, 'engine-computed', 'test-sha', gen_random_uuid(), $1)
     RETURNING occurred_at, recorded_at`,
    [futureDate]
  );
  {
    const row = valRes.rows[0];
    assertTrue(row.occurred_at.getTime() === futureDate.getTime(), 'C: occurred_at > recorded_at (a future-dated assertion) accepted without error, persisted exactly');
    assertTrue(row.occurred_at.getTime() > row.recorded_at.getTime(), 'C: occurred_at genuinely greater than recorded_at, confirmed by direct comparison');
  }

  // D + G: decision_event, domain_event, media, asset_identity_assignment
  // -- real round-trip, and the schema itself remains backward-compatible
  // with the exact old INSERT shape (occurred_at/captured_at/assigned_at
  // omitted) since recorded_at keeps its own DEFAULT now() unconditionally.
  const decRes = await client.query(
    `INSERT INTO decision_event (id, asset_id, recommendation, occurred_at) VALUES (gen_random_uuid(), gen_random_uuid(), 'RESEARCH', $1) RETURNING occurred_at, recorded_at`,
    [pastDate]
  );
  assertTrue(decRes.rows[0].occurred_at.getTime() === pastDate.getTime() && decRes.rows[0].recorded_at !== null, 'D: decision_event exact read-back of both fields');

  const domRes = await client.query(
    `INSERT INTO domain_event (event_id, event_type, actor, subject, payload, correlation_id) VALUES (gen_random_uuid(), 'test.g', '{}', '{}', '{}', gen_random_uuid()) RETURNING occurred_at, recorded_at`
  );
  assertTrue(domRes.rows[0].occurred_at === null && domRes.rows[0].recorded_at !== null, 'G: domain_event INSERT in the exact OLD shape (occurred_at omitted, exactly like every existing writeDomainEvent call today) still succeeds post-migration, occurred_at NULL');

  const mediaRes = await client.query(
    `INSERT INTO media (id, asset_id, media_type, content_hash, recorded_by_principal_id) VALUES (gen_random_uuid(), gen_random_uuid(), 'capture-photo', 'abc', gen_random_uuid()) RETURNING occurred_at, recorded_at`
  );
  assertTrue(mediaRes.rows[0].occurred_at === null && mediaRes.rows[0].recorded_at !== null, 'G: media INSERT in the exact OLD shape still succeeds post-migration, occurred_at NULL');

  const identRes = await client.query(
    `INSERT INTO asset_identity_assignment (id, asset_id, authority, source) VALUES (gen_random_uuid(), gen_random_uuid(), 'NONE', 'unresolved') RETURNING occurred_at, recorded_at`
  );
  assertTrue(identRes.rows[0].occurred_at === null && identRes.rows[0].recorded_at !== null, 'G: asset_identity_assignment INSERT in the exact OLD shape still succeeds post-migration, occurred_at NULL');

  // -----------------------------------------------------------------
  // Requirement F — no chronology CHECK constraint exists anywhere in
  // the migrated scratch schema.
  // -----------------------------------------------------------------
  const checks = await client.query(
    `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
     WHERE connamespace = $1::regnamespace AND contype = 'c'`,
    [SCHEMA]
  );
  const chronologyCheck = checks.rows.find(r => /occurred_at/i.test(r.def) && /recorded_at/i.test(r.def));
  assertTrue(chronologyCheck === undefined, `F: no CHECK constraint referencing both occurred_at and recorded_at exists (found ${checks.rows.length} total CHECK constraints, none chronological)`);

} finally {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  const dataOneDevAfter = await countDataOneDev();
  console.log('  data1_dev counts after (must be identical):', JSON.stringify(dataOneDevAfter));
  assertTrue(
    JSON.stringify(dataOneDevAfter) === JSON.stringify(dataOneDevBefore),
    'data1_dev is completely untouched by this entire proof — all counts identical before/after'
  );
  await client.end();
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('FAILURES:');
  failures.forEach((f) => console.log(f));
}
process.exit(failed > 0 ? 1 : 0);
