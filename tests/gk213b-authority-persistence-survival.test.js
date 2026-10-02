// tests/gk213b-authority-persistence-survival.test.js
//
// GK-213B (Operator Authority), K3 — "authority/provenance must survive
// partial writes." collection_item.attributes is otherwise a deliberate
// FULL REPLACE (db/data0/0026's own design, mirrors IndexedDB putComic()
// exactly). GK-213A/B place economically/legally meaningful authority
// facts (identityAuthority, modelPredictedGrade*, operatorGrade*,
// gradeAuthority, operatorIsGraded, gradingFormatAuthority) inside that
// same JSONB blob — an ordinary client write that legitimately omits
// those keys (any caller that doesn't know about them at all) must never
// be read as "delete the established authority."
//
// GK-260 CLOSURE PASS UPDATE (same repository.js file, different keys):
// the six grade/grading-format authority keys (operatorGrade/
// operatorGradeNumeric/operatorGradeSetAt/gradeAuthority/operatorIsGraded/
// gradingFormatAuthority) got a STRONGER guarantee than "survives
// omission" — GK-260 found that an ordinary /api/collection write could
// previously plant a FORGED value for these six directly (this file's own
// original assertions, ironically, encoded that forgeable behavior as
// "correct" — they asserted a raw attributes.operatorGrade sent through
// this exact endpoint would persist and survive). These six are now FULLY
// IMMUNE to this ordinary write path in both directions (can't be set,
// changed, or cleared here at all) — the only legitimate way to change
// them is applyGradingAuthorityPatch (src/modules/collection/service.js),
// called exclusively by api/enrich.js after a validated operator action
// (see tests/gk260-server-owned-grade-authority.test.js, scenarios 14-19).
// This file's assertions for those six keys are updated accordingly; the
// remaining four keys (identityAuthority, modelPredictedGrade*) keep their
// original omission-survives/explicit-null-clears behavior, unchanged and
// re-proven here as a regression check that GK-260 did not disturb them.
//
// Real Development DB, real /api/collection.js handler, real HMAC tokens
// — same convention as tests/collection-endpoint-live-proof.test.js. Uses
// its own throwaway principal, never touches Jimmy's real rows, cleans up
// every row it creates.
//
// Invoke: node tests/gk213b-authority-persistence-survival.test.js

import { readFileSync } from 'node:fs';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

const envRaw = readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8');
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}
process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';
if (!process.env.GRAILKEY_SESSION_SECRET) {
  process.env.GRAILKEY_SESSION_SECRET = randomBytes(32).toString('base64url');
}

const collectionRoute = (await import(pathToFileURL(path.join(repoRoot, 'api', 'collection.js')).href)).default;
const { closePool } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'collection', 'index.js')).href);

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};
const assertEq = (actual, expected, label) => assertTrue(JSON.stringify(actual) === JSON.stringify(expected), `${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);

function mockRes() {
  const res = { statusCode: null, body: null, headers: {} };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

console.log('\n=== GK-213B K3 — authority/provenance persistence survival (real Development DB) ===\n');

const TAG = `gk213b-k3-${Date.now()}`;

function mintTestToken(principalId) {
  const secret = process.env.GRAILKEY_SESSION_SECRET;
  const now = Date.now();
  const payload = { principalId, iat: now, exp: now + 12 * 60 * 60 * 1000, epoch: process.env.GRAILKEY_SESSION_EPOCH || '1' };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

const client = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query('SET search_path TO data1_dev');

const PRINCIPAL = randomUUID();
await client.query(`INSERT INTO gk_principal (id, display_name, kind) VALUES ($1, $2, 'user')`, [PRINCIPAL, `${TAG}-fixture`]);
const token = mintTestToken(PRINCIPAL);
const createdIds = [];

try {
  const ITEM_ID = `${TAG}-item`;
  createdIds.push(ITEM_ID);

  const fullAuthorityAttributes = {
    title: 'House of Secrets',
    identityAuthority: { title: 'OPERATOR_CONFIRMED' },
    modelPredictedGrade: 'GD 2.0',
    modelPredictedGradeReason: 'Initial AI read',
    modelPredictedGradeConfidence: 'high',
    modelPredictedAt: 1700000000000,
    operatorGrade: 'VF 7.5',
    operatorGradeNumeric: 7.5,
    operatorGradeSetAt: 1700000001000,
    gradeAuthority: 'OPERATOR_CONFIRMED',
    operatorIsGraded: false,
    gradingFormatAuthority: 'OPERATOR_CONFIRMED',
  };

  // GK-261 — identityAuthority / modelPredictedGrade* are now FULLY server-owned: an
  // ordinary client create can no longer persist them (previously "unchanged, out of
  // GK-260 scope"). This suite's SURVIVAL assertions therefore seed those values the
  // only way a pre-GK-261 historical row could hold them — directly in the DB — and
  // prove ordinary writes preserve them byte-for-byte (historical claims preserved,
  // neither promoted nor erased). Forge/clear/overwrite closure is
  // tests/gk261-server-owned-model-authority.test.js.
  const seedLegacyServerOwned = async (id) => {
    await client.query(
      `UPDATE collection_item SET attributes = attributes || $3::jsonb WHERE principal_id = $1 AND id = $2`,
      [PRINCIPAL, id, JSON.stringify({
        identityAuthority: fullAuthorityAttributes.identityAuthority,
        modelPredictedGrade: fullAuthorityAttributes.modelPredictedGrade,
        modelPredictedGradeReason: fullAuthorityAttributes.modelPredictedGradeReason,
        modelPredictedGradeConfidence: fullAuthorityAttributes.modelPredictedGradeConfidence,
        modelPredictedAt: fullAuthorityAttributes.modelPredictedAt,
      })]
    );
  };

  console.log('-- 1. create with a payload claiming full authority/provenance state --\n');
  {
    const req = { method: 'POST', headers: { authorization: `Bearer ${token}` }, query: {}, body: { id: ITEM_ID, assetCategory: 'comic', attributes: fullAuthorityAttributes } };
    const res = mockRes();
    await collectionRoute(req, res);
    assertTrue(res.statusCode === 200, `create -> 200 (got ${res.statusCode})`);
    assertTrue(!('identityAuthority' in (res.body?.attributes || {})), 'CRITICAL (GK-261): identityAuthority is NOT persisted on create via the ordinary path');
    assertTrue(!('modelPredictedGrade' in (res.body?.attributes || {})), 'CRITICAL (GK-261): modelPredictedGrade is NOT persisted on create via the ordinary path');
    await seedLegacyServerOwned(ITEM_ID);
    // GK-260: the ordinary create path can never plant these six, even at
    // create time — this is the exact "forged insertion on a new row" gap
    // GK-260's closure pass found and fixed (repository.js's
    // stripFullyProtectedGradingKeysSql, applied to upsertItem's INSERT
    // VALUES, not just its ON CONFLICT branch).
    assertTrue(!('operatorGrade' in (res.body?.attributes || {})), 'CRITICAL (GK-260): operatorGrade is NOT persisted on create via the ordinary path, even though the payload claimed it');
    assertTrue(!('gradeAuthority' in (res.body?.attributes || {})), 'CRITICAL (GK-260): gradeAuthority is NOT persisted on create via the ordinary path');
  }

  console.log('\n-- 2. THE REQUIRED TEST: ordinary update that OMITS every authority/provenance key --\n');
  {
    // Simulates a caller with zero awareness of these fields at all (an
    // old client, or a future caller that only ever touches its own
    // narrow concern) — e.g. only `title`/`price` in the payload.
    const ordinaryUpdatePayload = { title: 'House of Secrets', price: '$45.00', someUnrelatedField: 'x' };
    assertTrue(!('identityAuthority' in ordinaryUpdatePayload), 'sanity: payload genuinely omits identityAuthority');
    assertTrue(!('operatorGrade' in ordinaryUpdatePayload), 'sanity: payload genuinely omits operatorGrade');

    const req = { method: 'PUT', headers: { authorization: `Bearer ${token}` }, query: { id: ITEM_ID }, body: { attributes: ordinaryUpdatePayload } };
    const res = mockRes();
    await collectionRoute(req, res);
    assertTrue(res.statusCode === 200, `ordinary update -> 200 (got ${res.statusCode})`);

    // Reload independently from the DB (not trusting the handler's own
    // echoed response) — the actual persisted row is what matters.
    const reloaded = await client.query('SELECT attributes FROM collection_item WHERE principal_id = $1 AND id = $2', [PRINCIPAL, ITEM_ID]);
    const attrs = reloaded.rows[0].attributes;

    assertEq(attrs.price, '$45.00', 'ordinary field (price) DID update — full-replace semantics intact for non-authority fields');
    assertEq(attrs.someUnrelatedField, 'x', 'a genuinely new ordinary field is also accepted normally');
    assertEq(attrs.identityAuthority, { title: 'OPERATOR_CONFIRMED' }, 'SURVIVED: identityAuthority (K3 required result; historical value preserved)');
    assertEq(attrs.modelPredictedGrade, 'GD 2.0', 'SURVIVED: modelPredictedGrade (historical value preserved; GK-261 full immunity)');
    assertEq(attrs.modelPredictedGradeReason, 'Initial AI read', 'SURVIVED: modelPredictedGradeReason (historical value preserved; GK-261 full immunity)');
    assertEq(attrs.modelPredictedGradeConfidence, 'high', 'SURVIVED: modelPredictedGradeConfidence (historical value preserved; GK-261 full immunity)');
    assertEq(attrs.modelPredictedAt, 1700000000000, 'SURVIVED: modelPredictedAt (historical value preserved; GK-261 full immunity)');
    // GK-260: never persisted in the first place (test 1) — still absent.
    assertTrue(!('operatorGrade' in attrs), 'GK-260: operatorGrade remains absent (was never persisted via the ordinary path)');
    assertTrue(!('gradeAuthority' in attrs), 'GK-260: gradeAuthority remains absent');
    assertTrue(!('gradingFormatAuthority' in attrs), 'GK-260: gradingFormatAuthority remains absent');
  }

  console.log('\n-- 3. explicit CLEAR still works — presence with null value overwrites, not just omission-preserves --\n');
  {
    const clearPayload = { title: 'House of Secrets', price: '$45.00', gradeAuthority: null, operatorGrade: null, operatorGradeNumeric: null, operatorGradeSetAt: null };
    const req = { method: 'PUT', headers: { authorization: `Bearer ${token}` }, query: { id: ITEM_ID }, body: { attributes: clearPayload } };
    const res = mockRes();
    await collectionRoute(req, res);
    assertTrue(res.statusCode === 200, `clear update -> 200 (got ${res.statusCode})`);

    const reloaded = await client.query('SELECT attributes FROM collection_item WHERE principal_id = $1 AND id = $2', [PRINCIPAL, ITEM_ID]);
    const attrs = reloaded.rows[0].attributes;
    // GK-260: these were never established via the ordinary path (test 1),
    // so an explicit-null send through it is a harmless no-op — still
    // absent, not a real "clear" (there is nothing to clear here; the real
    // clear-of-an-established-value proof lives in
    // tests/gk260-server-owned-grade-authority.test.js scenario 16, via a
    // row seeded with REAL authority through the legitimate internal path).
    assertTrue(!('gradeAuthority' in attrs), 'GK-260: gradeAuthority still absent (explicit null through the ordinary path is a no-op, never establishes or persists anything)');
    assertTrue(!('operatorGrade' in attrs), 'GK-260: operatorGrade still absent');
    // Fields NOT mentioned in this clear payload (identityAuthority,
    // modelPredictedGrade*) must still survive — proving the (unchanged)
    // per-key protection for those four keys still holds.
    assertEq(attrs.identityAuthority, { title: 'OPERATOR_CONFIRMED' }, 'identityAuthority STILL survives (not mentioned in this clear payload, historical value preserved)');
    assertEq(attrs.modelPredictedGrade, 'GD 2.0', 'modelPredictedGrade STILL survives (not mentioned in this clear payload, historical value preserved)');
  }

  console.log('\n-- 4. same survival property on the upsertItem (POST-to-existing-id) path --\n');
  const ITEM_ID2 = `${TAG}-item2`;
  createdIds.push(ITEM_ID2);
  {
    // Create with full authority state.
    let req = { method: 'POST', headers: { authorization: `Bearer ${token}` }, query: {}, body: { id: ITEM_ID2, assetCategory: 'comic', attributes: fullAuthorityAttributes } };
    let res = mockRes();
    await collectionRoute(req, res);
    assertTrue(res.statusCode === 200, `item2 create -> 200 (got ${res.statusCode})`);
    await seedLegacyServerOwned(ITEM_ID2);

    // Re-POST to the SAME id (upsertItem's ON CONFLICT DO UPDATE path) with
    // an ordinary payload that omits every authority key.
    req = { method: 'POST', headers: { authorization: `Bearer ${token}` }, query: {}, body: { id: ITEM_ID2, assetCategory: 'comic', attributes: { title: 'House of Secrets', condition: 'Fine' } } };
    res = mockRes();
    await collectionRoute(req, res);
    assertTrue(res.statusCode === 200, `item2 re-POST (upsert path) -> 200 (got ${res.statusCode})`);

    const reloaded = await client.query('SELECT attributes FROM collection_item WHERE principal_id = $1 AND id = $2', [PRINCIPAL, ITEM_ID2]);
    const attrs = reloaded.rows[0].attributes;
    assertEq(attrs.condition, 'Fine', 'upsert path: new ordinary field accepted');
    // GK-260: operatorGrade was never persisted by the initial create
    // (fullAuthorityAttributes claims it, but the ordinary path never
    // writes it — same as test 1) — still absent through ON CONFLICT too.
    assertTrue(!('operatorGrade' in attrs), 'GK-260: operatorGrade absent through ON CONFLICT DO UPDATE (never persisted in the first place)');
    assertEq(attrs.identityAuthority, { title: 'OPERATOR_CONFIRMED' }, 'upsert path: SURVIVED identityAuthority through ON CONFLICT DO UPDATE (historical value preserved; GK-261 full immunity)');
  }

  console.log('\n-- 5. no-authority-ever item is completely unaffected (no null-key pollution) --\n');
  const ITEM_ID3 = `${TAG}-item3`;
  createdIds.push(ITEM_ID3);
  {
    const req = { method: 'POST', headers: { authorization: `Bearer ${token}` }, query: {}, body: { id: ITEM_ID3, assetCategory: 'comic', attributes: { title: 'Plain Item' } } };
    const res = mockRes();
    await collectionRoute(req, res);
    assertTrue(res.statusCode === 200, `item3 create -> 200 (got ${res.statusCode})`);
    const reloaded = await client.query('SELECT attributes FROM collection_item WHERE principal_id = $1 AND id = $2', [PRINCIPAL, ITEM_ID3]);
    const attrs = reloaded.rows[0].attributes;
    assertTrue(!('gradeAuthority' in attrs), 'an item that never had any authority state gets no phantom null keys injected (jsonb_strip_nulls working correctly)');
    assertTrue(!('identityAuthority' in attrs), 'same for identityAuthority — no pollution for ordinary items');
    assertEq(Object.keys(attrs), ['title'], 'attributes contains exactly what was sent, nothing more');
  }
} finally {
  if (createdIds.length) await client.query('DELETE FROM collection_item WHERE principal_id = $1 AND id = ANY($2::text[])', [PRINCIPAL, createdIds]);
  await client.query('DELETE FROM gk_principal WHERE id = $1', [PRINCIPAL]);
  await client.end();
  await closePool();

  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) {
    console.log('FAILURES:');
    failures.forEach((f) => console.log(f));
    process.exit(1);
  }
  process.exit(0);
}
