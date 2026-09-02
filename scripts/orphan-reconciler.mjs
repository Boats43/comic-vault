// scripts/orphan-reconciler.mjs — GrailKey media orphan reconciler.
//
// Report-only by default (D2.3, GrailKey Physical Asset Protocol Compatibility
// Matrix / Append-only supporting invariant: "Garbage collection is report-only
// by default; destructive action requires an explicit flag."). Classifies every
// data1_dev.media row and every real storage object into five states that must
// never be conflated:
//
//   A. STORAGE_OBJECT_WITHOUT_MEDIA_ROW — an object sitting in a backend store
//      with nothing in data1_dev pointing at it.
//   B. MEDIA_ROW_OBJECT_UNREACHABLE     — a data1_dev row whose object_uri was
//      actually checked and confirmed not to resolve to a live object.
//   C. MALFORMED_OR_UNSUPPORTED_URI      — a non-null object_uri that does not
//      match any known scheme. NEVER an automatic GC candidate, regardless of
//      --confirm-delete.
//   D. UNDETERMINED                      — reachability could not be
//      established (most commonly: missing provider credentials). This is
//      NEVER treated as unreachable just because verification capability is
//      absent — it is its own state, reported separately from B.
//   E. METADATA_ONLY_NO_OBJECT_URI       — object_uri is NULL. Not an orphan
//      object, never an automatic GC candidate. This pass does not infer WHY
//      a row is metadata-only (e.g. "awaiting capture", "test fixture") —
//      only durable evidence (a cited log line, event row, or ticket) may
//      establish that; none was consulted here, so none is claimed.
//
// Deletion is gated behind an explicit --confirm-delete flag and is NOT wired
// to do anything yet in this pass — the flag is recognized and refused, on
// purpose, per this train's instruction not to run destructive reconciliation.
//
// Usage:
//   node scripts/orphan-reconciler.mjs                  # report-only (default)
//   node scripts/orphan-reconciler.mjs --confirm-delete  # refused this train, see below

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

const CONFIRM_DELETE = process.argv.includes('--confirm-delete');
const LOCALFS_ROOT = process.env.MEDIA_LOCALFS_ROOT || 'C:\\grailkey-data\\data-1\\media-store';

function loadEnv(envPath) {
  const raw = readFileSync(envPath, 'utf8');
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
  return env;
}

function classifyScheme(objectUri) {
  if (objectUri === null || objectUri === undefined) return 'null';
  if (typeof objectUri === 'string' && objectUri.startsWith('localfs://')) return 'localfs';
  if (typeof objectUri === 'string' && /^https:\/\//.test(objectUri)) return 'https';
  return 'malformed';
}

// Walk the real localfs store and derive each file's own localfs:// object_uri
// (root/sha256/<xx>/<hash> -> localfs://sha256/<xx>/<hash>), matching
// contentAddress.js's deriveKey() format exactly.
function listLocalfsObjects(root) {
  const found = [];
  const shaRoot = path.join(root, 'sha256');
  let shardDirs = [];
  try {
    shardDirs = readdirSync(shaRoot);
  } catch (e) {
    if (e.code === 'ENOENT') return { found, reachable: true, note: 'store root has no sha256/ directory yet' };
    return { found, reachable: false, note: `cannot list ${shaRoot}: ${e.message}` };
  }
  for (const shard of shardDirs) {
    const shardPath = path.join(shaRoot, shard);
    let entries = [];
    try {
      entries = readdirSync(shardPath).filter((f) => statSync(path.join(shardPath, f)).isFile());
    } catch {
      continue;
    }
    for (const hash of entries) {
      found.push(`localfs://sha256/${shard}/${hash}`);
    }
  }
  return { found, reachable: true };
}

async function main() {
  const envPath = path.join(process.cwd(), '.env.development.local');
  const env = loadEnv(envPath);
  const connStr = env.GRAILKEY_CATALOG_DATABASE_URL;
  if (!connStr) {
    console.error('GRAILKEY_CATALOG_DATABASE_URL not found in .env.development.local — aborting.');
    process.exit(1);
  }

  const client = new Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const rowsRes = await client.query(
    `SELECT id, asset_id, object_uri, media_type, captured_at FROM data1_dev.media ORDER BY captured_at`
  );
  await client.end();

  const rows = rowsRes.rows;
  const byScheme = { null: [], localfs: [], https: [], malformed: [] };
  for (const r of rows) byScheme[classifyScheme(r.object_uri)].push(r);

  console.log(`=== GrailKey Orphan Reconciler — REPORT-ONLY (5-state) ===`);
  console.log(`data1_dev.media rows: ${rows.length}`);

  // --- E. METADATA_ONLY_NO_OBJECT_URI ---
  console.log(`\n--- E. METADATA_ONLY_NO_OBJECT_URI: ${byScheme.null.length} ---`);
  console.log(`  (object_uri IS NULL. Not an orphan object, never an automatic GC candidate.`);
  console.log(`   Provenance/reason NOT inferred — no log/event evidence was consulted this pass.)`);
  for (const r of byScheme.null) {
    console.log(`  id=${r.id} asset_id=${r.asset_id} media_type=${r.media_type} captured_at=${r.captured_at?.toISOString?.() ?? r.captured_at}`);
  }

  // --- C. MALFORMED_OR_UNSUPPORTED_URI ---
  console.log(`\n--- C. MALFORMED_OR_UNSUPPORTED_URI: ${byScheme.malformed.length} ---`);
  console.log(`  (never an automatic GC candidate, regardless of --confirm-delete)`);
  for (const r of byScheme.malformed) {
    console.log(`  id=${r.id} asset_id=${r.asset_id} object_uri=${JSON.stringify(r.object_uri)}`);
  }

  // --- B / D — real reachability check via the public media contract, never
  // the private drivers directly (module boundary law). ---
  const media = await import('../src/modules/media/index.js');
  process.env.MEDIA_LOCALFS_ROOT = LOCALFS_ROOT;

  const categoryB = [];
  const categoryD = [];
  for (const r of [...byScheme.localfs, ...byScheme.https]) {
    try {
      const result = await media.head({ objectUri: r.object_uri });
      if (result.exists) continue;
      categoryB.push({ row: r, reason: 'head() ran successfully and reported exists:false' });
    } catch (e) {
      if (e.constructor?.name === 'NotProvisionedError') {
        // Verification capability itself is absent (e.g. no BLOB_READ_WRITE_TOKEN)
        // — this is UNDETERMINED, never treated as unreachable.
        categoryD.push({ row: r, reason: e.message });
      } else {
        categoryB.push({ row: r, reason: `head() threw ${e.constructor?.name || 'Error'}: ${e.message}` });
      }
    }
  }

  console.log(`\n--- B. MEDIA_ROW_OBJECT_UNREACHABLE: ${categoryB.length} ---`);
  console.log(`  (reachability WAS checked — this is a confirmed miss, not a capability gap)`);
  for (const { row: r, reason } of categoryB) {
    console.log(`  id=${r.id} asset_id=${r.asset_id} object_uri=${r.object_uri} — ${reason}`);
  }

  console.log(`\n--- D. UNDETERMINED: ${categoryD.length} ---`);
  console.log(`  (reachability could NOT be established — e.g. missing provider credentials.`);
  console.log(`   Never counted as unreachable merely because verification capability is absent.)`);
  for (const { row: r, reason } of categoryD) {
    console.log(`  id=${r.id} asset_id=${r.asset_id} object_uri=${r.object_uri} — ${reason}`);
  }

  // --- A. STORAGE_OBJECT_WITHOUT_MEDIA_ROW — localfs backend only; the
  // vercel-blob backend requires BLOB_READ_WRITE_TOKEN + blob.list(), not
  // available in this environment, so it is reported as UNDETERMINED rather
  // than silently assumed to be zero. ---
  const localStore = listLocalfsObjects(LOCALFS_ROOT);
  const dbLocalfsUris = new Set(byScheme.localfs.map((r) => r.object_uri));
  const orphanObjects = localStore.reachable
    ? localStore.found.filter((uri) => !dbLocalfsUris.has(uri))
    : [];

  console.log(`\n--- A. STORAGE_OBJECT_WITHOUT_MEDIA_ROW — localfs backend (root: ${LOCALFS_ROOT}) ---`);
  if (!localStore.reachable) {
    console.log(`  UNDETERMINED: ${localStore.note}`);
  } else {
    console.log(`  objects on disk: ${localStore.found.length}, orphaned (no matching DB row): ${orphanObjects.length}`);
    for (const uri of orphanObjects) console.log(`  ${uri}`);
  }
  console.log(`  vercel-blob backend: UNDETERMINED (BLOB_READ_WRITE_TOKEN not available in this environment — blob.list() cannot run here; NOT assumed to be zero)`);

  console.log(`\n=== Summary ===`);
  console.log(`  A. STORAGE_OBJECT_WITHOUT_MEDIA_ROW (localfs): ${orphanObjects.length}  (blob backend: UNDETERMINED)`);
  console.log(`  B. MEDIA_ROW_OBJECT_UNREACHABLE:               ${categoryB.length}`);
  console.log(`  C. MALFORMED_OR_UNSUPPORTED_URI:               ${byScheme.malformed.length}`);
  console.log(`  D. UNDETERMINED:                                ${categoryD.length}`);
  console.log(`  E. METADATA_ONLY_NO_OBJECT_URI:                 ${byScheme.null.length}`);
  console.log(`\n=== Gate result: REPORT-ONLY. No deletion performed. ===`);

  if (CONFIRM_DELETE) {
    console.log(
      '\n--confirm-delete was passed but is deliberately NOT wired to perform deletion in this ' +
      'pass — destructive reconciliation is explicitly out of scope for this train per instruction. Refusing.'
    );
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('orphan-reconciler failed:', e);
  process.exit(1);
});
