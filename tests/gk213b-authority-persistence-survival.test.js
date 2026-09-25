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

  console.log('-- 1. create with full authority/provenance state --\n');
  {
    const req = { method: 'POST', headers: { authorization: `Bearer ${token}` }, query: {}, body: { id: ITEM_ID, assetCategory: 'comic', attributes: fullAuthorityAttributes } };
    const res = mockRes();
    await collectionRoute(req, res);
    assertTrue(res.statusCode === 200, `create -> 200 (got ${res.statusCode})`);
    assertEq(res.body?.attributes?.operatorGrade, 'VF 7.5', 'operatorGrade persisted on create');
    assertEq(res.body?.attributes?.gradeAuthority, 'OPERATOR_CONFIRMED', 'gradeAuthority persisted on create');
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
    assertTrue(!('modelPredictedGrade' in attrs) === false, 'modelPredictedGrade key still present at all');
    assertEq(attrs.identityAuthority, { title: 'OPERATOR_CONFIRMED' }, 'SURVIVED: identityAuthority (K3 required result)');
    assertEq(attrs.modelPredictedGrade, 'GD 2.0', 'SURVIVED: modelPredictedGrade');
    assertEq(attrs.modelPredictedGradeReason, 'Initial AI read', 'SURVIVED: modelPredictedGradeReason');
    assertEq(attrs.modelPredictedGradeConfidence, 'high', 'SURVIVED: modelPredictedGradeConfidence');
    assertEq(attrs.modelPredictedAt, 1700000000000, 'SURVIVED: modelPredictedAt');
    assertEq(attrs.operatorGrade, 'VF 7.5', 'SURVIVED: operatorGrade');
    assertEq(attrs.operatorGradeNumeric, 7.5, 'SURVIVED: operatorGradeNumeric');
    assertEq(attrs.operatorGradeSetAt, 1700000001000, 'SURVIVED: operatorGradeSetAt');
    assertEq(attrs.gradeAuthority, 'OPERATOR_CONFIRMED', 'SURVIVED: gradeAuthority');
    assertEq(attrs.operatorIsGraded, false, 'SURVIVED: operatorIsGraded (explicit false, not dropped)');
    assertEq(attrs.gradingFormatAuthority, 'OPERATOR_CONFIRMED', 'SURVIVED: gradingFormatAuthority');
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
    assertTrue(attrs.gradeAuthority == null, 'explicit clear DOES null gradeAuthority (presence with null wins over the old non-null value)');
    assertTrue(attrs.operatorGrade == null, 'explicit clear DOES null operatorGrade');
    // Fields NOT mentioned in this clear payload (identityAuthority,
    // gradingFormatAuthority, modelPredictedGrade*) must still survive —
    // proving the protection is per-key, not "any authority write disables
    // protection for the whole write."
    assertEq(attrs.identityAuthority, { title: 'OPERATOR_CONFIRMED' }, 'identityAuthority STILL survives (not mentioned in this clear payload)');
    assertEq(attrs.gradingFormatAuthority, 'OPERATOR_CONFIRMED', 'gradingFormatAuthority STILL survives (not mentioned in this clear payload)');
    assertEq(attrs.modelPredictedGrade, 'GD 2.0', 'modelPredictedGrade STILL survives (not mentioned in this clear payload)');
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

    // Re-POST to the SAME id (upsertItem's ON CONFLICT DO UPDATE path) with
    // an ordinary payload that omits every authority key.
    req = { method: 'POST', headers: { authorization: `Bearer ${token}` }, query: {}, body: { id: ITEM_ID2, assetCategory: 'comic', attributes: { title: 'House of Secrets', condition: 'Fine' } } };
    res = mockRes();
    await collectionRoute(req, res);
    assertTrue(res.statusCode === 200, `item2 re-POST (upsert path) -> 200 (got ${res.statusCode})`);

    const reloaded = await client.query('SELECT attributes FROM collection_item WHERE principal_id = $1 AND id = $2', [PRINCIPAL, ITEM_ID2]);
    const attrs = reloaded.rows[0].attributes;
    assertEq(attrs.condition, 'Fine', 'upsert path: new ordinary field accepted');
    assertEq(attrs.operatorGrade, 'VF 7.5', 'upsert path: SURVIVED operatorGrade through ON CONFLICT DO UPDATE');
    assertEq(attrs.identityAuthority, { title: 'OPERATOR_CONFIRMED' }, 'upsert path: SURVIVED identityAuthority through ON CONFLICT DO UPDATE');
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
