// tests/gk213c-durable-grading-authority.test.js
//
// GK-213C — durable owned grading-authority fallback. Closes the one
// confirmed blocker from GK-213's final pre-push closure audit:
// reIdentifyBook and submitManualCorrection are legitimate existing-owned-
// item economic recomputation paths that never threaded grading-authority
// fields into their /api/enrich requests, so a response from either could
// silently price from the fresh/model grade despite an established
// durable operator override.
//
// Real Development DB (own throwaway principal, real HMAC tokens, real
// collection rows), real /api/enrich handler invocation (mocked eBay/PC
// fetch only — same convention as tests/gk255-economic-authority-boundary
// .test.js). Every "durable row" scenario is a genuine DB row read through
// the real GK-254/GK-213C authority-resolution code, not a hand-built fixture.
//
// Invoke: node tests/gk213c-durable-grading-authority.test.js

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
process.env.EBAY_APP_ID = process.env.EBAY_APP_ID || 'test-app-id';
process.env.EBAY_CERT_ID = process.env.EBAY_CERT_ID || 'test-cert-id';
process.env.PRICECHARTING_TOKEN = process.env.PRICECHARTING_TOKEN || 'test-pc-token';

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};
const assertEq = (actual, expected, label) => assertTrue(JSON.stringify(actual) === JSON.stringify(expected), `${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);

console.log('\n=== GK-213C — durable owned grading-authority fallback (real Development DB + real handler) ===\n');

const TAG = `gk213c-${Date.now()}`;

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

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}
function wireEmptyEbayMocks() {
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('oauth2/token') || u.includes('/oauth/')) return jsonResponse({ access_token: 'x', expires_in: 7200, token_type: 'Application Access Token' });
    if (u.includes('search_by_image') || u.includes('item_summary/search')) return jsonResponse({ itemSummaries: [], total: 0 });
    if (u.includes('comicvine.gamespot.com')) return jsonResponse({ results: [], status_code: 1, error: 'OK' });
    if (u.includes('pricecharting.com')) return jsonResponse({ products: [] });
    return jsonResponse({});
  };
}

async function callEnrich(body) {
  wireEmptyEbayMocks();
  const capturedLogs = [];
  const originalConsoleLog = console.log;
  console.log = (...args) => { capturedLogs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); };
  const handlerModule = await import('../api/enrich.js?gk213c-' + Math.random());
  const handler = handlerModule.default;
  const req = { method: 'POST', headers: { authorization: `Bearer ${token}` }, body };
  let capturedBody = null;
  const res = { status: (c) => ({ json: (d) => { capturedBody = d; } }), setHeader: () => {} };
  let threw = null;
  try { await handler(req, res); } catch (err) { threw = err; }
  console.log = originalConsoleLog;
  return { body: capturedBody, logs: capturedLogs, threw };
}

async function createOwnedItem(idSuffix, attributes) {
  const id = `${TAG}-${idSuffix}`;
  createdIds.push(id);
  await client.query(
    `INSERT INTO collection_item (id, principal_id, asset_category, attributes) VALUES ($1, $2, 'comic', $3)`,
    [id, PRINCIPAL, JSON.stringify({ title: 'Test Comic', ...attributes })]
  );
  return id;
}

try {
  console.log('-- 1. owned reIdentify — operator grade durable fallback --\n');
  {
    const id = await createOwnedItem('reident-grade', { gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: 'VF 8.0', operatorGradeNumeric: 8.0, isGraded: false });
    const { body, logs, threw } = await callEnrich({
      title: 'Test Comic', year: '1990', publisher: 'Marvel', assetType: 'comic',
      grade: 'GD 2.0', isGraded: false, numericGrade: null, confidence: 'high',
      images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='],
      collectionItemId: id, ownedReidentify: true,
      // deliberately NO gradeAuthority/operatorGrade/etc. — the exact gap
    });
    assertTrue(threw === null, 'no exception');
    assertTrue(logs.some((l) => l.includes('[owned-grading-authority] durable fallback applied')), 'durable fallback log fired');
    assertEq(body?.governingGrade, 'VF 8.0', 'effective operator authority comes from durable row — pricing uses VF 8.0, not the fresh GD 2.0');
    assertEq(body?.governingGradeSource, 'operator', 'governing source is operator');
  }

  console.log('\n-- 2. owned reIdentify — raw format durable fallback --\n');
  {
    const id = await createOwnedItem('reident-format', { gradingFormatAuthority: 'OPERATOR_CONFIRMED', operatorIsGraded: false });
    const { body, threw } = await callEnrich({
      title: 'Test Comic', year: '1990', publisher: 'Marvel', assetType: 'comic',
      grade: 'FN 6.0', isGraded: true, numericGrade: 9.4, confidence: 'high', // fresh Vision says isGraded=true
      images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='],
      collectionItemId: id, ownedReidentify: true,
    });
    assertTrue(threw === null, 'no exception');
    assertEq(body?.governingIsGraded, false, 'governing format is RAW despite fresh Vision isGraded=true');
    assertEq(body?.governingGradingFormatSource, 'operator', 'source is operator');
  }

  console.log('\n-- 3. manual identity correction — operator-grade durable fallback --\n');
  {
    const id = await createOwnedItem('manualcorrect-grade', { gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: 'NM 9.0', operatorGradeNumeric: 9.0, isGraded: false });
    const { body, threw } = await callEnrich({
      manualIdentity: true, skipVision: true, skipImageSearch: true, identitySource: 'manual', confidence: 'HIGH',
      title: 'Test Comic', issue: '1', year: '1990', publisher: 'Marvel',
      grade: 'GD 2.0', isGraded: false, numericGrade: null,
      collectionItemId: id, ownedRefresh: true,
      manualAuthority: { correctedBy: 'operator', correctedFields: ['title'] },
      priorIdentity: { title: 'Test Comic', issue: '1', year: '1990', publisher: 'Marvel' },
    });
    assertTrue(threw === null, `no exception (${threw ? threw.message : ''})`);
    assertEq(body?.governingGrade, 'NM 9.0', 'identity correction proceeds; durable operator grade still governs economics');
  }

  console.log('\n-- 4. manual identity correction — format durable fallback --\n');
  {
    const id = await createOwnedItem('manualcorrect-format', { gradingFormatAuthority: 'OPERATOR_CONFIRMED', operatorIsGraded: false });
    const { body, threw } = await callEnrich({
      manualIdentity: true, skipVision: true, skipImageSearch: true, identitySource: 'manual', confidence: 'HIGH',
      title: 'Test Comic', issue: '1', year: '1990', publisher: 'Marvel',
      grade: 'FN 6.0', isGraded: true, numericGrade: 9.4,
      collectionItemId: id, ownedRefresh: true,
      manualAuthority: { correctedBy: 'operator', correctedFields: ['title'] },
      priorIdentity: { title: 'Test Comic', issue: '1', year: '1990', publisher: 'Marvel' },
    });
    assertTrue(threw === null, `no exception (${threw ? threw.message : ''})`);
    assertEq(body?.governingIsGraded, false, 'durable format override remains governing through a manual identity correction');
  }

  console.log('\n-- 5. explicit SET must be distinguishable from fallback --\n');
  {
    const id = await createOwnedItem('explicit-set', {}); // durable row has NO operator grade authority at all
    const { body, threw } = await callEnrich({
      title: 'Test Comic', year: '1990', publisher: 'Marvel', assetType: 'comic',
      grade: 'GD 2.0', isGraded: false, numericGrade: null, confidence: 'high',
      skipImageSearch: true,
      collectionItemId: id, ownedRefresh: true,
      gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: 'VG 4.0', operatorGradeNumeric: 4.0, // explicit, request-present
    });
    assertTrue(threw === null, 'no exception');
    assertEq(body?.governingGrade, 'VG 4.0', 'request-present value governs this response (legitimate SET, no durable row to fall back to)');
  }

  console.log('\n-- 6. explicit CHANGE --\n');
  {
    const id = await createOwnedItem('explicit-change', { gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: 'VG 4.0', operatorGradeNumeric: 4.0 });
    const { body, threw } = await callEnrich({
      title: 'Test Comic', year: '1990', publisher: 'Marvel', assetType: 'comic',
      grade: 'GD 2.0', isGraded: false, numericGrade: null, confidence: 'high',
      skipImageSearch: true,
      collectionItemId: id, ownedRefresh: true,
      gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: 'NM 9.0', operatorGradeNumeric: 9.0, // new value, request-present
    });
    assertTrue(threw === null, 'no exception');
    assertEq(body?.governingGrade, 'NM 9.0', 'request-present NEW value governs this response, not the durable OLD value');
  }

  console.log('\n-- 7. explicit CLEAR --\n');
  {
    const id = await createOwnedItem('explicit-clear', { gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: 'VF 8.0', operatorGradeNumeric: 8.0 });
    const { body, threw } = await callEnrich({
      title: 'Test Comic', year: '1990', publisher: 'Marvel', assetType: 'comic',
      grade: 'FN 6.0', isGraded: false, numericGrade: null, confidence: 'high',
      skipImageSearch: true,
      collectionItemId: id, ownedRefresh: true,
      gradeAuthority: null, operatorGrade: null, operatorGradeNumeric: null, // explicit CLEAR, own-properties present with null
    });
    assertTrue(threw === null, 'no exception');
    assertEq(body?.governingGrade, 'FN 6.0', 'the durable VF 8.0 is NOT resurrected — governing grade returns to the current automated grade (explicit null means CLEAR, not "unknown, consult durable")');
    assertEq(body?.governingGradeSource, 'model', 'source correctly attributed to model');
  }

  console.log('\n-- 8. format CLEAR --\n');
  {
    const id = await createOwnedItem('format-clear', { gradingFormatAuthority: 'OPERATOR_CONFIRMED', operatorIsGraded: false });
    const { body, threw } = await callEnrich({
      title: 'Test Comic', year: '1990', publisher: 'Marvel', assetType: 'comic',
      grade: 'FN 6.0', isGraded: false, numericGrade: null, confidence: 'high',
      skipImageSearch: true,
      collectionItemId: id, ownedRefresh: true,
      gradingFormatAuthority: null, operatorIsGraded: null,
    });
    assertTrue(threw === null, 'no exception');
    assertEq(body?.governingGradingFormatSource, 'model', 'the durable RAW override is NOT resurrected — resolver falls back to model tier');
  }

  console.log('\n-- 9. auth fail-closed regression --\n');
  {
    const id = await createOwnedItem('auth-failclosed', { gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: 'VF 8.0', operatorGradeNumeric: 8.0 });
    wireEmptyEbayMocks();
    const handlerModule = await import('../api/enrich.js?gk213c-authfail-' + Math.random());
    const handler = handlerModule.default;
    const req = { method: 'POST', headers: {}, body: { // NO authorization header at all
      title: 'Test Comic', year: '1990', publisher: 'Marvel', assetType: 'comic', grade: 'GD 2.0', isGraded: false,
      collectionItemId: id, ownedRefresh: true,
    } };
    let capturedBody = null;
    const res = { status: (c) => ({ json: (d) => { capturedBody = d; } }), setHeader: () => {} };
    await handler(req, res);
    assertTrue(capturedBody?.ownedAssetAuthRequired === true, 'existing GK-254 fail-closed behavior remains byte-for-byte intact — auth failure refuses BEFORE any grading-authority resolution');
    assertTrue(capturedBody?.refusedToPrice === true, 'refusedToPrice true, no fallback to client-asserted authority when durable-owned authorization fails');
    assertTrue(!('governingGrade' in capturedBody), 'no governingGrade computed at all on the fail-closed exit — confirms durable authority was never consulted, let alone client authority substituted');
  }

  console.log('\n-- 10. durable category regression (GK-253/254 unchanged) --\n');
  {
    const id = await createOwnedItem('category-regression', { gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: 'VF 8.0', operatorGradeNumeric: 8.0 });
    const { body, threw } = await callEnrich({
      title: 'Test Comic', year: '1990', publisher: 'Marvel', assetType: 'book', // client asserts wrong category
      grade: 'GD 2.0', isGraded: false, numericGrade: null, confidence: 'high',
      skipImageSearch: true,
      collectionItemId: id, ownedRefresh: true,
    });
    assertTrue(threw === null, 'no exception');
    assertEq(body?.assetType, 'comic', 'durable category authority (GK-253/254) still pins assetType from the real row, completely unaffected by GK-213C');
  }

  console.log('\n-- 11. UNHYDRATED auto-refresh: real pickGradingAuthorityFields proof --\n');
  {
    const { pickGradingAuthorityFields } = await import('../src/lib/gradeAuthority.js');
    const unhydratedItem = { id: 'x', title: 'Test Comic', grade: 'FN 6.0' }; // genuinely no grading-authority keys at all
    const projected = pickGradingAuthorityFields(unhydratedItem);
    assertEq(projected, {}, 'an unhydrated item projects to an EMPTY object — all five keys absent, none synthesized as null');
    assertTrue(!('gradeAuthority' in projected), 'gradeAuthority key is not merely null — it does not exist as an own-property at all');

    // Real end-to-end proof: this exact object spread into a durable-fallback-eligible request.
    const id = await createOwnedItem('unhydrated-autorefresh', { gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: 'VF 8.0', operatorGradeNumeric: 8.0 });
    const requestBody = {
      title: 'Test Comic', year: '1990', publisher: 'Marvel', assetType: 'comic',
      grade: 'FN 6.0', isGraded: false, numericGrade: null, confidence: 'high',
      skipImageSearch: true,
      collectionItemId: id, ownedRefresh: true,
      ...pickGradingAuthorityFields(unhydratedItem), // adds nothing
    };
    assertTrue(!('gradeAuthority' in requestBody), 'FAIL if any absent client field arrived as an own-property null — confirmed absent in the real request body object');
    const { body, threw } = await callEnrich(requestBody);
    assertTrue(threw === null, 'no exception');
    assertEq(body?.governingGrade, 'VF 8.0', 'server durable fallback executes — effective operatorGrade comes from the durable row');
    assertEq(body?.governingGradeSource, 'operator', 'source correctly attributed to operator (durable)');
  }

  console.log('\n-- 12. UNHYDRATED manual refreshMarketData: same proof, same durable row class --\n');
  {
    const { pickGradingAuthorityFields } = await import('../src/lib/gradeAuthority.js');
    const unhydratedItem = { id: 'y', title: 'Test Comic', grade: 'FN 6.0' };
    const id = await createOwnedItem('unhydrated-manualrefresh', { gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: 'NM 9.0', operatorGradeNumeric: 9.0 });
    const requestBody = {
      title: 'Test Comic', year: '1990', publisher: 'Marvel', assetType: 'comic',
      grade: 'FN 6.0', isGraded: false, numericGrade: null, confidence: 'high',
      skipImageSearch: true,
      collectionItemId: id, ownedRefresh: true,
      ...pickGradingAuthorityFields(unhydratedItem),
    };
    const keys = Object.keys(requestBody);
    assertTrue(!keys.includes('gradeAuthority') && !keys.includes('operatorGrade') && !keys.includes('operatorGradeNumeric') && !keys.includes('operatorIsGraded') && !keys.includes('gradingFormatAuthority'), 'FAIL if any authority field arrived as own-property null — confirmed all five absent from the real request body');
    const { body, threw } = await callEnrich(requestBody);
    assertTrue(threw === null, 'no exception');
    assertEq(body?.governingGrade, 'NM 9.0', 'durable fallback fires — operator grade remains governing, no synthesized null anywhere');
  }

  console.log('\n-- 13. CLEAR still distinguishable from unhydrated (same helper, two real item shapes) --\n');
  {
    const { pickGradingAuthorityFields, clearOperatorGrade, clearOperatorGradingFormat } = await import('../src/lib/gradeAuthority.js');
    const priorItem = { id: 'z', title: 'Test Comic', gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: 'VF 8.0', operatorGradeNumeric: 8.0 };
    const clearedItem = { ...priorItem, ...clearOperatorGrade(), ...clearOperatorGradingFormat() };
    const projected = pickGradingAuthorityFields(clearedItem);

    assertTrue(Object.prototype.hasOwnProperty.call(projected, 'gradeAuthority'), 'TEST 13: gradeAuthority IS an own-property (present, not absent)');
    assertEq(projected.gradeAuthority, null, 'TEST 13: gradeAuthority is PRESENT WITH NULL');
    assertTrue(Object.prototype.hasOwnProperty.call(projected, 'operatorGrade'), 'TEST 13: operatorGrade IS an own-property');
    assertEq(projected.operatorGrade, null, 'TEST 13: operatorGrade is PRESENT WITH NULL');
    assertTrue(Object.prototype.hasOwnProperty.call(projected, 'operatorGradeNumeric'), 'TEST 13: operatorGradeNumeric IS an own-property');
    assertTrue(Object.prototype.hasOwnProperty.call(projected, 'gradingFormatAuthority'), 'TEST 13: gradingFormatAuthority IS an own-property (from clearOperatorGradingFormat)');
    assertEq(projected.gradingFormatAuthority, null, 'TEST 13: gradingFormatAuthority is PRESENT WITH NULL');

    // Contrast directly against TEST 11's unhydrated projection — same
    // function, two genuinely different real object shapes, observably
    // different results: this IS the required proof, not an inference.
    const unhydratedProjected = pickGradingAuthorityFields({ id: 'x', title: 'Test Comic' });
    assertTrue(!('gradeAuthority' in unhydratedProjected) && ('gradeAuthority' in projected), 'TEST 11 vs TEST 13: identical helper, observably different request bodies — ABSENT vs PRESENT-WITH-NULL, proven side by side');

    // Real end-to-end: the durable value must NOT be resurrected.
    const id = await createOwnedItem('clear-vs-unhydrated', { gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: 'VF 8.0', operatorGradeNumeric: 8.0, gradingFormatAuthority: 'OPERATOR_CONFIRMED', operatorIsGraded: false });
    const requestBody = {
      title: 'Test Comic', year: '1990', publisher: 'Marvel', assetType: 'comic',
      grade: 'FN 6.0', isGraded: false, numericGrade: null, confidence: 'high',
      skipImageSearch: true,
      collectionItemId: id, ownedRefresh: true,
      ...projected,
    };
    const { body, threw } = await callEnrich(requestBody);
    assertTrue(threw === null, 'no exception');
    assertEq(body?.governingGrade, 'FN 6.0', 'request-present null outranks the durable VF 8.0 — durable value is NOT resurrected, governing grade returns to current automated grade');
  }
} finally {
  if (createdIds.length) await client.query('DELETE FROM collection_item WHERE principal_id = $1 AND id = ANY($2::text[])', [PRINCIPAL, createdIds]);
  await client.query('DELETE FROM gk_principal WHERE id = $1', [PRINCIPAL]);
  await client.end();

  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) {
    console.log('FAILURES:');
    failures.forEach((f) => console.log(f));
    process.exit(1);
  }
  process.exit(0);
}
