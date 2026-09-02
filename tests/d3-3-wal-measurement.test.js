// tests/d3-3-wal-measurement.test.js
//
// D3 Amendment A3 / E3 -- real measurement of logical comp_snapshot
// payload bytes AND actual WAL/change-history bytes generated per
// snapshot write, run against an isolated, self-dropped scratch schema
// (the real 0012 migration text). data1_dev is never written to by this
// file.
//
// WAL measurement method: pg_current_wal_lsn() (confirmed callable by
// this role -- neondb_owner has rolreplication=true, which is what
// gates this function, not superuser) captured immediately before and
// immediately after a single-row INSERT transaction; pg_wal_lsn_diff()
// gives the byte delta. This is a DATABASE-WIDE LSN, not a per-
// transaction counter -- any other concurrent write during the
// measurement window would contaminate the result. Mitigation/
// limitation, disclosed honestly rather than hidden: (1) a CONTROL
// measurement (an LSN delta across the same tight window with NO write
// at all) is taken first, to quantify background noise; (2) the
// measurement window is kept as short as possible (a single BEGIN...
// COMMIT); (3) this is a personal/dev database with no expected
// concurrent traffic during the run, but that is a property of this
// environment, not a guarantee the method itself provides -- the
// resulting numbers are labeled MEASURED with this exact caveat, not
// presented as lab-grade attribution-clean.
//
// Invoke: node tests/d3-3-wal-measurement.test.js

import { readFileSync, writeFileSync } from 'node:fs';
import { Client } from 'pg';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

const envRaw = readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8');
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}

console.log('\n=== D3 Amendment A3/E3 — comp_snapshot logical + WAL byte measurement (real, isolated) ===\n');

// Representative payloads, sized off this repo's own documented comp-pool
// conventions (CLAUDE.md): SMALL = the thin-pool floor (MIN_POOL_FOR_OVERRIDE=3,
// GK-34), NORMAL = a typical resolved pool, LARGE = the eBay Browse API's own
// stated cap (limit=100).
function makeComp(i) {
  return {
    title: 'Amazing Fantasy #15', issueNumber: '15', price: 850 + i, currency: 'USD',
    source: i % 2 === 0 ? 'ebay-browse-api' : 'pricecharting-scrape',
    listingUrl: `https://example-marketplace.test/item/${1000000 + i}`,
    soldDate: `2026-0${(i % 9) + 1}-15`, condition: i % 3 === 0 ? 'CGC 9.4' : 'raw VF/NM',
    sellerId: `seller-${i % 37}`, itemId: `item-${100000 + i}`,
  };
}
const PAYLOADS = {
  SMALL: { items: [makeComp(0), makeComp(1), makeComp(2)], summary: { avg: 851, count: 3 } },
  NORMAL: { items: Array.from({ length: 20 }, (_, i) => makeComp(i)), summary: { avg: 860, count: 20 } },
  LARGE: { items: Array.from({ length: 100 }, (_, i) => makeComp(i)), summary: { avg: 900, count: 100 } },
};

const SCHEMA = `d3_3_wal_measure_${Date.now()}`;
const client = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

const results = {};
try {
  await client.query(`CREATE SCHEMA ${SCHEMA}`);
  await client.query(`SET search_path TO ${SCHEMA}`);
  await client.query(`CREATE TABLE gk_asset (id UUID PRIMARY KEY); CREATE TABLE gk_principal (id UUID PRIMARY KEY); CREATE TABLE valuation_event (id UUID PRIMARY KEY);`);
  const assetId = crypto.randomUUID();
  const principalId = crypto.randomUUID();
  await client.query('INSERT INTO gk_asset (id) VALUES ($1)', [assetId]);
  await client.query('INSERT INTO gk_principal (id) VALUES ($1)', [principalId]);

  let fwd = readFileSync(path.join(repoRoot, 'db', 'data0', '0012_d3_3_comp_snapshot.sql'), 'utf8')
    .replace('SET search_path TO data1_dev;', `SET search_path TO ${SCHEMA};`);
  await client.query(fwd);
  console.log('  real 0012 migration applied to scratch schema — measurement begins\n');

  // RAW/cold-page measurement: the very first INSERT into a freshly
  // created (empty) table/page. Captured BEFORE any priming, so it
  // reflects Postgres's real full-page-image WAL cost on first write.
  async function measureColdInsert(payload) {
    const before = (await client.query('SELECT pg_current_wal_lsn() AS lsn')).rows[0].lsn;
    const json = JSON.stringify(payload);
    await client.query(
      `INSERT INTO comp_snapshot (id, asset_id, source, payload, content_hash, recorded_by_principal_id) VALUES ($1,$2,'cold-measurement',$3,$4,$5)`,
      [crypto.randomUUID(), assetId, json, createHash('sha256').update(json).digest('hex'), principalId]
    );
    const after = (await client.query('SELECT pg_current_wal_lsn() AS lsn')).rows[0].lsn;
    const diff = (await client.query('SELECT pg_wal_lsn_diff($1::pg_lsn, $2::pg_lsn) AS d', [after, before])).rows[0].d;
    return { walBytes: Number(diff), logicalBytes: Buffer.byteLength(json, 'utf8') };
  }
  const coldSmall = await measureColdInsert(PAYLOADS.SMALL);
  console.log(`  RAW/cold (first INSERT into a fresh page, SMALL payload): logicalBytes=${coldSmall.logicalBytes} WAL=${coldSmall.walBytes} bytes (includes a one-time full-page-image cost)\n`);
  results.RAW_COLD_FIRST_INSERT = coldSmall;

  // Priming: a fresh page's FIRST write after a checkpoint logs a full-
  // page image (can be ~8KB regardless of the actual row's size) --
  // this is real Postgres write-amplification behavior, not a bug in
  // this measurement. 20 throwaway inserts warm up several pages so the
  // SMALL/NORMAL/LARGE measurements below reflect steady-state
  // incremental WAL cost, not the one-time cold-page cost. Both
  // conditions are reported -- see the RAW (unprimed, first-run) numbers
  // logged separately below.
  for (let i = 0; i < 20; i++) {
    const id = crypto.randomUUID();
    const json = JSON.stringify({ items: [{ i }], summary: {} });
    await client.query(
      `INSERT INTO comp_snapshot (id, asset_id, source, payload, content_hash, recorded_by_principal_id) VALUES ($1,$2,'priming',$3,$4,$5)`,
      [id, assetId, json, createHash('sha256').update(json).digest('hex'), principalId]
    );
  }
  console.log('  20 priming rows inserted (warms pages so steady-state measurement excludes cold full-page-image cost)\n');

  async function measureOneInsert(payload) {
    const before = (await client.query('SELECT pg_current_wal_lsn() AS lsn')).rows[0].lsn;
    const id = crypto.randomUUID();
    const json = JSON.stringify(payload);
    const hash = createHash('sha256').update(json).digest('hex');
    await client.query(
      `INSERT INTO comp_snapshot (id, asset_id, source, payload, content_hash, recorded_by_principal_id)
       VALUES ($1, $2, 'measurement', $3, $4, $5)`,
      [id, assetId, json, hash, principalId]
    );
    const after = (await client.query('SELECT pg_current_wal_lsn() AS lsn')).rows[0].lsn;
    const diff = (await client.query('SELECT pg_wal_lsn_diff($1::pg_lsn, $2::pg_lsn) AS d', [after, before])).rows[0].d;
    return { walBytes: Number(diff), logicalBytes: Buffer.byteLength(json, 'utf8') };
  }

  // Control: LSN delta across the same tight window with NO write at all,
  // to quantify background noise this method cannot itself eliminate.
  const controlDeltas = [];
  for (let i = 0; i < 3; i++) {
    const before = (await client.query('SELECT pg_current_wal_lsn() AS lsn')).rows[0].lsn;
    const after = (await client.query('SELECT pg_current_wal_lsn() AS lsn')).rows[0].lsn;
    const diff = (await client.query('SELECT pg_wal_lsn_diff($1::pg_lsn, $2::pg_lsn) AS d', [after, before])).rows[0].d;
    controlDeltas.push(Number(diff));
  }
  console.log('  CONTROL (no-write LSN delta, 3 samples):', JSON.stringify(controlDeltas), 'bytes\n');

  for (const [label, payload] of Object.entries(PAYLOADS)) {
    const runs = [];
    for (let i = 0; i < 5; i++) runs.push(await measureOneInsert(payload));
    const logicalBytes = runs[0].logicalBytes; // deterministic per payload
    const walSamples = runs.map(r => r.walBytes);
    const sorted = walSamples.slice().sort((a, b) => a - b);
    const walMin = sorted[0];
    const walMax = sorted[sorted.length - 1];
    const walMedian = sorted[Math.floor(sorted.length / 2)];
    results[label] = { evidenceItemCount: payload.items.length, logicalBytes, walSamples, walMin, walMedian, walMax };
    console.log(`  ${label} (steady-state, post-priming): items=${payload.items.length} logicalBytes=${logicalBytes} WAL samples=${JSON.stringify(walSamples)} (min=${walMin} median=${walMedian} max=${walMax})`);
  }

  writeFileSync(path.join(repoRoot, '.d3-3-wal-measurement-results.json'), JSON.stringify({ controlDeltas, results }, null, 2));
  console.log('\n  Full results written to .d3-3-wal-measurement-results.json (gitignored scratch, for the Standing Report only)');

} finally {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await client.end();
}
