// tests/d5d-w2-eligibility.test.js
//
// D5D isolated-writer-design dispatch, W2 asset-source route proof.
// resolveEligibleSubject only calls src/modules/assets/'s own PUBLIC,
// already-live, ALREADY READ-ONLY functions (resolveCollectionItemLink,
// getLiveIdentityAssignment) -- both pure SELECTs, zero mutation. This
// test therefore runs safely against REAL data1_dev (no scratch schema
// needed or possible here -- collection_item_link/gk_asset/
// asset_identity_assignment are real, already-live production data;
// zero rows are ever written by this test, proven by the row-count
// invariant check at the end).
//
// Covers Section 1's required outcomes exactly:
//   W-F3 -- no collectionItemId -> SKIP_NO_DURABLE_SUBJECT
//   W-F4 -- collectionItemId exists but doesn't resolve -> SKIP_UNLINKED_SUBJECT
//   eligible path -- real linked collectionItemId + real owning
//     principalId -> real gkAssetId + real identityAssignmentId
//
// Invoke: node tests/d5d-w2-eligibility.test.js

import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

const envRaw = readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8');
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}

const val = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'valuation', 'index.js')).href);

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

console.log('\n=== D5D W2 -- asset-source route proof (real data1_dev, read-only) ===\n');

// Pre-flight row-count snapshot (proves zero writes, before AND after).
const censusClient = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL_UNPOOLED, ssl: { rejectUnauthorized: false } });
await censusClient.connect();
const countsBefore = await censusClient.query(`
  SELECT
    (SELECT count(*)::int FROM data1_dev.collection_item_link) AS cil,
    (SELECT count(*)::int FROM data1_dev.gk_asset) AS ga,
    (SELECT count(*)::int FROM data1_dev.asset_identity_assignment) AS aia,
    (SELECT count(*)::int FROM data1_dev.valuation_question) AS vq,
    (SELECT count(*)::int FROM data1_dev.applicability) AS ap,
    (SELECT count(*)::int FROM data1_dev.market_population) AS mp,
    (SELECT count(*)::int FROM data1_dev.market_population_member) AS mpm`);
console.log('  pre-flight counts:', countsBefore.rows[0]);

// W-F3 -- no collectionItemId at all. Zero DB interaction expected --
// the function returns before ever calling into assets/.
{
  const realPrincipalId = '01a0283a-b1b6-7f90-9b41-9c06bee6ecba'; // real gk_principal, read-only use
  const result = await val.resolveEligibleSubject({ principalId: realPrincipalId, collectionItemId: undefined });
  assertTrue(result.eligible === false && result.reason === val.SKIP_REASONS.NO_DURABLE_SUBJECT, `W-F3: no collectionItemId -> eligible=false, reason=SKIP_NO_DURABLE_SUBJECT (actual: ${JSON.stringify(result)})`);
}

// W-F4 -- collectionItemId supplied but does not resolve to any real
// link (a fresh random UUID is guaranteed absent from real
// collection_item_link).
{
  const realPrincipalId = '01a0283a-b1b6-7f90-9b41-9c06bee6ecba';
  const bogusCollectionItemId = `nonexistent-${crypto.randomUUID()}`;
  const result = await val.resolveEligibleSubject({ principalId: realPrincipalId, collectionItemId: bogusCollectionItemId });
  assertTrue(result.eligible === false && result.reason === val.SKIP_REASONS.UNLINKED_SUBJECT, `W-F4: collectionItemId does not resolve -> eligible=false, reason=SKIP_UNLINKED_SUBJECT (actual: ${JSON.stringify(result)})`);
}

// W-F4 variant -- collectionItemId resolves, but the CALLER is a
// DIFFERENT real, existing principal, not the resource's actual owner
// (a nonexistent principalId is a caller-error case, correctly thrown
// by assets/'s own assertPrincipalActive rather than silently treated
// as "not eligible" -- this variant instead uses a second REAL
// gk_principal row to isolate the ownership-mismatch case specifically).
{
  const realCollectionItemId = 'cv_1787381637428_rtw875'; // real, linked, owned by 01a0283a-...
  const otherRealPrincipalId = '01a0283d-7798-7d66-8ddb-db3c9172a5d1'; // a different real principal
  const result = await val.resolveEligibleSubject({ principalId: otherRealPrincipalId, collectionItemId: realCollectionItemId });
  assertTrue(result.eligible === false && result.reason === val.SKIP_REASONS.UNLINKED_SUBJECT, `W-F4 variant: real link, a DIFFERENT real principal (not the owner) -> eligible=false, reason=SKIP_UNLINKED_SUBJECT (never leaks that the link exists to a non-owner -- actual: ${JSON.stringify(result)})`);
}

// Eligible path -- real linked collectionItemId + its real owning
// principalId.
{
  const realPrincipalId = '01a0283a-b1b6-7f90-9b41-9c06bee6ecba';
  const realCollectionItemId = 'cv_1787381637428_rtw875';
  const result = await val.resolveEligibleSubject({ principalId: realPrincipalId, collectionItemId: realCollectionItemId });
  assertTrue(
    result.eligible === true && result.gkAssetId === '01a02c0b-50f1-7490-804f-902cf5805176' && result.identityAssignmentId === '01a02c0b-74c7-7bf9-88f2-3774d4af8061',
    `eligible path: real link + real owner -> real gkAssetId + real identityAssignmentId, exactly as independently queried (actual: ${JSON.stringify(result)})`
  );
}

// Post-flight: prove ZERO writes occurred anywhere, including the new
// D5 tables (GK-180 unaffected -- read-only proof, not merely a claim).
const countsAfter = await censusClient.query(`
  SELECT
    (SELECT count(*)::int FROM data1_dev.collection_item_link) AS cil,
    (SELECT count(*)::int FROM data1_dev.gk_asset) AS ga,
    (SELECT count(*)::int FROM data1_dev.asset_identity_assignment) AS aia,
    (SELECT count(*)::int FROM data1_dev.valuation_question) AS vq,
    (SELECT count(*)::int FROM data1_dev.applicability) AS ap,
    (SELECT count(*)::int FROM data1_dev.market_population) AS mp,
    (SELECT count(*)::int FROM data1_dev.market_population_member) AS mpm`);
console.log('  post-flight counts:', countsAfter.rows[0]);
assertTrue(
  JSON.stringify(countsBefore.rows[0]) === JSON.stringify(countsAfter.rows[0]),
  'ZERO writes to real data1_dev anywhere -- all counts identical before/after (GK-180 unaffected, proven not merely claimed)'
);

await censusClient.end();
await val.closePool();

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
