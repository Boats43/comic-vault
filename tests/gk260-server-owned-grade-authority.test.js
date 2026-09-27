// tests/gk260-server-owned-grade-authority.test.js
//
// GK-260 — SERVER-OWNED WRITE AUTHORITY (grade / grading-format).
//
// GOVERNING LAW: authority is minted by the server from a validated
// operator action. Authority is NEVER accepted merely because a request
// body says a value is authoritative. The client may describe WHAT the
// operator did (operatorGradeAction/gradingFormatAction); it may never
// declare THAT the resulting state is authoritative
// (gradeAuthority/gradingFormatAuthority/operatorGrade/operatorGradeNumeric/
// operatorIsGraded/operatorGradeSetAt sent directly).
//
// Root cause closed by this dispatch: pre-GK-260, api/enrich.js trusted
// five of these six fields verbatim from req.body — gradeAuthority,
// operatorGrade, operatorGradeNumeric, operatorIsGraded,
// gradingFormatAuthority (operatorGradeSetAt was never destructured from
// req.body at all — see Section 3 below) — a request-body-present value
// outranked even the durable owned row, unconditionally, regardless of
// authentication. A forged `gradeAuthority:'OPERATOR_CONFIRMED'` was
// indistinguishable from a real operator action, on ANY /api/enrich call
// including a completely unauthenticated fresh scan.
//
// CLOSURE PASS (same ticket, GK-260 final authority-boundary closure):
// found and closed a SECOND path to the same class of exposure —
// api/enrich.js's durable-row fallback trusted collection_item.attributes
// unconditionally, but the pre-existing PROTECTED_AUTHORITY_KEYS mechanism
// (src/modules/collection/repository.js) only protected these six fields
// from ACCIDENTAL OMISSION on an ordinary /api/collection write, never
// from a FORGED INSERTION/OVERWRITE — a client could durably plant
// gradeAuthority:'OPERATOR_CONFIRMED' straight into its own collection_item
// row via the ordinary write path, and a later /api/enrich call would
// trust it as real, durable operator authority. Closed by making these six
// keys FULLY immune to the ordinary write path (FULLY_PROTECTED_GRADING_KEYS)
// and adding a new internal-only write path (applyGradingAuthorityPatch)
// that is the ONLY way they may change, called exclusively by api/enrich.js
// after a validated action.
//
// Real Development DB (own throwaway principal, real HMAC tokens, real
// collection rows) for the owned-item scenarios, real /api/enrich handler
// invocation throughout (mocked eBay/PC fetch only) — same convention as
// tests/gk213c-durable-grading-authority.test.js.
//
// Invoke: node tests/gk260-server-owned-grade-authority.test.js

import { readFileSync } from 'node:fs';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
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

console.log('\n=== GK-260 — server-owned grade/grading-format write authority (real Development DB + real handler) ===\n');

const TAG = `gk260-${Date.now()}`;

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

async function callEnrich(body, headers = { authorization: `Bearer ${token}` }) {
  wireEmptyEbayMocks();
  const capturedLogs = [];
  const originalConsoleLog = console.log;
  console.log = (...args) => { capturedLogs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); };
  const handlerModule = await import('../api/enrich.js?gk260-' + Math.random());
  const handler = handlerModule.default;
  const req = { method: 'POST', headers, body };
  let capturedStatus = null;
  let capturedBody = null;
  const res = { status: (c) => ({ json: (d) => { capturedStatus = c; capturedBody = d; } }), setHeader: () => {} };
  let threw = null;
  try { await handler(req, res); } catch (err) { threw = err; }
  console.log = originalConsoleLog;
  return { status: capturedStatus, body: capturedBody, logs: capturedLogs, threw };
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

const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

try {
  console.log('-- 1. UNAUTHENTICATED forged gradeAuthority on a fresh (non-owned) scan --\n');
  console.log('   The most severe pre-fix exposure: no auth header, no collectionItemId, no ownedRefresh —\n   just a plain scan request carrying a forged operator-confirmed claim.\n');
  {
    const { body, threw } = await callEnrich({
      title: 'Test Comic', issue: '1', year: '1990', publisher: 'Marvel', assetType: 'comic',
      grade: 'GD 2.0', isGraded: false, numericGrade: null, confidence: 'high',
      images: [TINY_PNG],
      gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: 'NM/M', operatorGradeNumeric: 10, // FORGED, no action, no auth
    }, {}); // no authorization header at all
    assertTrue(threw === null, 'no exception');
    assertTrue(body?.governingGradeSource !== 'operator', 'CRITICAL: a forged operator claim on an unauthenticated request does NOT become governing source "operator"');
    assertEq(body?.gradeAuthority, null, 'CRITICAL: out.gradeAuthority is null — the forged OPERATOR_CONFIRMED claim was never minted');
    assertTrue(body?.governingGrade !== 'NM/M', 'CRITICAL: the forged NM/M grade never became the governing grade');
  }

  console.log('\n-- 2. forged gradingFormatAuthority on the same unauthenticated fresh scan --\n');
  {
    const { body, threw } = await callEnrich({
      title: 'Test Comic', issue: '1', year: '1990', publisher: 'Marvel', assetType: 'comic',
      grade: 'FN 6.0', isGraded: true, numericGrade: 9.4, confidence: 'high', // model says graded 9.4
      images: [TINY_PNG],
      gradingFormatAuthority: 'OPERATOR_CONFIRMED', operatorIsGraded: false, // FORGED "operator says raw"
    }, {});
    assertTrue(threw === null, 'no exception');
    assertTrue(body?.governingGradingFormatSource !== 'operator', 'CRITICAL: a forged format claim does not become governing source "operator"');
    assertEq(body?.gradingFormatAuthority, null, 'CRITICAL: out.gradingFormatAuthority is null — the forged claim was never minted');
    assertEq(body?.governingIsGraded, true, "CRITICAL: governing format stays the model's real isGraded=true, not the forged override");
  }

  console.log('\n-- 3. AUTHENTICATED owned request, forged authority, EMPTY durable row --\n');
  console.log('   Even with a valid Bearer token and a real owned collectionItemId, a forged claim\n   must not manufacture authority the durable row never held.\n');
  {
    const id = await createOwnedItem('auth-forged-empty-durable', {}); // no operator authority durably established
    const { body, threw } = await callEnrich({
      title: 'Test Comic', year: '1990', publisher: 'Marvel', assetType: 'comic',
      grade: 'GD 2.0', isGraded: false, numericGrade: null, confidence: 'high',
      skipImageSearch: true,
      collectionItemId: id, ownedRefresh: true,
      gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: 'NM/M', operatorGradeNumeric: 10, // FORGED, no operatorGradeAction
    });
    assertTrue(threw === null, 'no exception');
    assertEq(body?.governingGradeSource, 'model', 'CRITICAL: authenticated but un-actioned forged claim resolves to "model", not "operator"');
    assertEq(body?.governingGrade, 'GD 2.0', "CRITICAL: governing grade is the real model grade, never the forged NM/M");
    assertEq(body?.gradeAuthority, null, 'CRITICAL: out.gradeAuthority stays null — no durable row, no action, no authority');
  }

  console.log('\n-- 4. AUTHENTICATED owned request, forged authority CANNOT override a DIFFERENT real durable value --\n');
  {
    const id = await createOwnedItem('auth-forged-overrides-durable', { gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: 'VG 4.0', operatorGradeNumeric: 4.0 });
    const { body, threw } = await callEnrich({
      title: 'Test Comic', year: '1990', publisher: 'Marvel', assetType: 'comic',
      grade: 'GD 2.0', isGraded: false, numericGrade: null, confidence: 'high',
      skipImageSearch: true,
      collectionItemId: id, ownedRefresh: true,
      gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: 'NM/M', operatorGradeNumeric: 10, // FORGED CHANGE attempt, no action
    });
    assertTrue(threw === null, 'no exception');
    assertEq(body?.governingGrade, 'VG 4.0', 'CRITICAL: the real durable VG 4.0 governs — the forged NM/M request value cannot silently override it');
  }

  console.log('\n-- 5. forged CLEAR (raw null fields) through an unrelated ordinary request CANNOT clear durable authority --\n');
  {
    const id = await createOwnedItem('forged-clear-cannot-wipe', { gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: 'VF 8.0', operatorGradeNumeric: 8.0 });
    const { body, threw } = await callEnrich({
      title: 'Test Comic', year: '1990', publisher: 'Marvel', assetType: 'comic',
      grade: 'FN 6.0', isGraded: false, numericGrade: null, confidence: 'high',
      skipImageSearch: true,
      collectionItemId: id, ownedRefresh: true,
      gradeAuthority: null, operatorGrade: null, operatorGradeNumeric: null, // raw own-property null, NO operatorGradeAction:'CLEAR'
    });
    assertTrue(threw === null, 'no exception');
    assertEq(body?.governingGrade, 'VF 8.0', 'CRITICAL: the real durable operator grade survives an un-actioned raw-null request — only a validated CLEAR action may clear it');
    assertEq(body?.gradeAuthority, 'OPERATOR_CONFIRMED', 'gradeAuthority remains OPERATOR_CONFIRMED — durable row wins');
  }

  console.log('\n-- 6. server-minted operatorGradeSetAt — client timestamp never trusted --\n');
  {
    const id = await createOwnedItem('timestamp-not-trusted', {});
    const forgedTimestamp = 1;
    const before = Date.now();
    const { body, threw } = await callEnrich({
      title: 'Test Comic', year: '1990', publisher: 'Marvel', assetType: 'comic',
      grade: 'GD 2.0', isGraded: false, numericGrade: null, confidence: 'high',
      skipImageSearch: true,
      collectionItemId: id, ownedRefresh: true,
      operatorGradeAction: 'SET', operatorGradeValue: 'VG 4.0',
      operatorGradeSetAt: forgedTimestamp, // FORGED — must be ignored
    });
    const after = Date.now();
    assertTrue(threw === null, 'no exception');
    assertTrue(typeof body?.operatorGradeSetAt === 'number' && body.operatorGradeSetAt >= before && body.operatorGradeSetAt <= after,
      `server-minted operatorGradeSetAt is a real server-clock timestamp (${body?.operatorGradeSetAt}), never the forged ${forgedTimestamp}`);
  }

  console.log('\n-- 7. operatorGradeNumeric/label consistency is structural, not a separate forgeable field --\n');
  console.log('   The action protocol takes ONE validated string (operatorGradeValue); a mismatched\n   separate numeric field is no longer even a shape the client can express.\n');
  {
    const id = await createOwnedItem('numeric-label-structural', {});
    const { body, threw } = await callEnrich({
      title: 'Test Comic', year: '1990', publisher: 'Marvel', assetType: 'comic',
      grade: 'GD 2.0', isGraded: false, numericGrade: null, confidence: 'high',
      skipImageSearch: true,
      collectionItemId: id, ownedRefresh: true,
      operatorGradeAction: 'SET', operatorGradeValue: 'VG 4.0',
      operatorGradeNumeric: 999, // FORGED separate field, structurally irrelevant to the action protocol
    });
    assertTrue(threw === null, 'no exception');
    assertEq(body?.operatorGradeNumeric, 4, 'server derives the numeric grade FROM operatorGradeValue itself (4), never from a separately forged operatorGradeNumeric (999)');
  }

  console.log('\n-- 8. malformed operatorGradeValue is rejected (400), not silently defaulted --\n');
  {
    const id = await createOwnedItem('malformed-set-rejected', {});
    const { status, body, threw } = await callEnrich({
      title: 'Test Comic', year: '1990', publisher: 'Marvel', assetType: 'comic',
      grade: 'GD 2.0', isGraded: false, numericGrade: null, confidence: 'high',
      skipImageSearch: true,
      collectionItemId: id, ownedRefresh: true,
      operatorGradeAction: 'SET', operatorGradeValue: 'not a real grade',
    });
    assertTrue(threw === null, 'no exception');
    assertEq(status, 400, 'malformed operatorGradeValue is rejected with HTTP 400');
    assertTrue(!!body?.error, 'error message present');
  }

  console.log('\n-- 9. unrecognized operatorGradeAction is rejected (400) --\n');
  {
    const id = await createOwnedItem('unrecognized-action-rejected', {});
    const { status, threw } = await callEnrich({
      title: 'Test Comic', year: '1990', publisher: 'Marvel', assetType: 'comic',
      grade: 'GD 2.0', isGraded: false, numericGrade: null, confidence: 'high',
      skipImageSearch: true,
      collectionItemId: id, ownedRefresh: true,
      operatorGradeAction: 'DELETE_EVERYTHING',
    });
    assertTrue(threw === null, 'no exception');
    assertEq(status, 400, 'unrecognized operatorGradeAction is rejected with HTTP 400');
  }

  console.log('\n-- 10. real SET still works end-to-end (positive control) --\n');
  {
    const id = await createOwnedItem('real-set-still-works', {});
    const { body, threw } = await callEnrich({
      title: 'Test Comic', year: '1990', publisher: 'Marvel', assetType: 'comic',
      grade: 'GD 2.0', isGraded: false, numericGrade: null, confidence: 'high',
      skipImageSearch: true,
      collectionItemId: id, ownedRefresh: true,
      operatorGradeAction: 'SET', operatorGradeValue: 'VG 4.0',
    });
    assertTrue(threw === null, 'no exception');
    assertEq(body?.governingGrade, 'VG 4.0', 'a validated SET action correctly becomes governing');
    assertEq(body?.governingGradeSource, 'operator', 'source correctly attributed to operator');
    assertEq(body?.gradeAuthority, 'OPERATOR_CONFIRMED', 'gradeAuthority minted');
  }

  console.log('\n-- 11. real CLEAR still works end-to-end (positive control) --\n');
  {
    const id = await createOwnedItem('real-clear-still-works', { gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: 'VF 8.0', operatorGradeNumeric: 8.0 });
    const { body, threw } = await callEnrich({
      title: 'Test Comic', year: '1990', publisher: 'Marvel', assetType: 'comic',
      grade: 'FN 6.0', isGraded: false, numericGrade: null, confidence: 'high',
      skipImageSearch: true,
      collectionItemId: id, ownedRefresh: true,
      operatorGradeAction: 'CLEAR',
    });
    assertTrue(threw === null, 'no exception');
    assertEq(body?.governingGrade, 'FN 6.0', 'a validated CLEAR correctly returns governing grade to the model estimate');
    assertEq(body?.gradeAuthority, null, 'gradeAuthority cleared');
  }

  console.log('\n-- 12. real grading-format SET_GRADED / SET_RAW / CLEAR still work (positive control) --\n');
  {
    const id = await createOwnedItem('real-format-actions-still-work', {});
    const setRaw = await callEnrich({
      title: 'Test Comic', year: '1990', publisher: 'Marvel', assetType: 'comic',
      grade: 'FN 6.0', isGraded: true, numericGrade: 9.4, confidence: 'high',
      skipImageSearch: true,
      collectionItemId: id, ownedRefresh: true,
      gradingFormatAction: 'SET_RAW',
    });
    assertEq(setRaw.body?.governingIsGraded, false, 'SET_RAW correctly overrides the model isGraded=true');
    assertEq(setRaw.body?.governingGradingFormatSource, 'operator', 'source is operator after SET_RAW');

    const setGraded = await callEnrich({
      title: 'Test Comic', year: '1990', publisher: 'Marvel', assetType: 'comic',
      grade: 'FN 6.0', isGraded: false, numericGrade: null, confidence: 'high',
      skipImageSearch: true,
      collectionItemId: id, ownedRefresh: true,
      gradingFormatAction: 'SET_GRADED',
    });
    assertEq(setGraded.body?.governingIsGraded, true, 'SET_GRADED correctly overrides the model isGraded=false');
  }

  console.log('\n-- 13. whole-attributes protection mechanism present (source-text check) --\n');
  {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../src/modules/collection/repository.js', import.meta.url), 'utf8');
    assertTrue(src.includes('PROTECTED_AUTHORITY_KEYS'), 'PROTECTED_AUTHORITY_KEYS mechanism still present');
    assertTrue(src.includes('FULLY_PROTECTED_GRADING_KEYS'), 'FULLY_PROTECTED_GRADING_KEYS (this closure pass\'s strengthened mechanism) present');
    assertTrue(src.includes("'gradeAuthority'") && src.includes("'operatorGrade'"), 'grade-authority fields remain in the protected key lists');
  }

  console.log('\n=== CLOSURE PASS: /api/collection forged-insertion chain ===\n');
  const { createCollectionItem, updateCollectionItem, getMyCollectionItem, applyGradingAuthorityPatch } = await import('../src/modules/collection/index.js');

  console.log('\n-- 14. forged insertion on a NEW row via ordinary createCollectionItem --\n');
  {
    const id = `${TAG}-forged-new-row`;
    createdIds.push(id);
    await createCollectionItem({
      principalId: PRINCIPAL, id, assetCategory: 'comic',
      attributes: { title: 'Forged New', gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: 'NM/M', operatorGradeNumeric: 10, gradingFormatAuthority: 'OPERATOR_CONFIRMED', operatorIsGraded: false },
    });
    const row = await getMyCollectionItem({ principalId: PRINCIPAL, id });
    assertTrue(!('gradeAuthority' in row.attributes), 'CRITICAL: forged gradeAuthority on a brand-new row via ordinary create is NOT persisted — key absent entirely');
    assertTrue(!('operatorGrade' in row.attributes), 'CRITICAL: forged operatorGrade not persisted');
    assertTrue(!('gradingFormatAuthority' in row.attributes), 'CRITICAL: forged gradingFormatAuthority not persisted');
    assertEq(row.attributes.title, 'Forged New', 'ordinary non-authority fields still write normally');
  }

  console.log('\n-- 15. forged OVERWRITE on an EXISTING row with real authority --\n');
  {
    const id = `${TAG}-forged-overwrite`;
    createdIds.push(id);
    await client.query(
      `INSERT INTO collection_item (id, principal_id, asset_category, attributes) VALUES ($1, $2, 'comic', $3)`,
      [id, PRINCIPAL, JSON.stringify({ title: 'Real Auth', gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: 'VG 4.0', operatorGradeNumeric: 4.0 })]
    );
    await updateCollectionItem({
      principalId: PRINCIPAL, id,
      attributes: { title: 'Real Auth Updated', gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: 'NM/M', operatorGradeNumeric: 10 }, // forged OVERWRITE attempt
    });
    const row = await getMyCollectionItem({ principalId: PRINCIPAL, id });
    assertEq(row.attributes.operatorGrade, 'VG 4.0', 'CRITICAL: the real VG 4.0 survives — an ordinary write cannot overwrite it with a forged NM/M');
    assertEq(row.attributes.title, 'Real Auth Updated', 'ordinary field (title) still updates normally alongside the protected fields');
  }

  console.log('\n-- 16. forged NULL/CLEAR on an EXISTING row with real authority --\n');
  {
    const id = `${TAG}-forged-clear`;
    createdIds.push(id);
    await client.query(
      `INSERT INTO collection_item (id, principal_id, asset_category, attributes) VALUES ($1, $2, 'comic', $3)`,
      [id, PRINCIPAL, JSON.stringify({ title: 'Real Auth', gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: 'VF 8.0', operatorGradeNumeric: 8.0 })]
    );
    await updateCollectionItem({
      principalId: PRINCIPAL, id,
      attributes: { title: 'Real Auth', gradeAuthority: null, operatorGrade: null, operatorGradeNumeric: null }, // forged CLEAR attempt
    });
    const row = await getMyCollectionItem({ principalId: PRINCIPAL, id });
    assertEq(row.attributes.gradeAuthority, 'OPERATOR_CONFIRMED', 'CRITICAL: an ordinary write cannot clear real authority by sending null');
    assertEq(row.attributes.operatorGrade, 'VF 8.0', 'CRITICAL: the real operator grade survives a forged null attempt');
  }

  console.log('\n-- 17. unrelated attributes update preserves protected authority (regression) --\n');
  {
    const id = `${TAG}-unrelated-update`;
    createdIds.push(id);
    await client.query(
      `INSERT INTO collection_item (id, principal_id, asset_category, attributes) VALUES ($1, $2, 'comic', $3)`,
      [id, PRINCIPAL, JSON.stringify({ title: 'Original', gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: 'FN 6.0', operatorGradeNumeric: 6.0 })]
    );
    // A caller that has never heard of grading authority (e.g. "Add Photo") sends a whole attributes replace that simply omits these keys.
    await updateCollectionItem({ principalId: PRINCIPAL, id, attributes: { title: 'Original', remoteImages: ['x.jpg'] } });
    const row = await getMyCollectionItem({ principalId: PRINCIPAL, id });
    assertEq(row.attributes.gradeAuthority, 'OPERATOR_CONFIRMED', 'an ordinary unrelated update (omitting these keys) still preserves real authority');
    assertEq(row.attributes.operatorGrade, 'FN 6.0', 'real operator grade untouched by an unrelated field update');
    assertEq(row.attributes.remoteImages, ['x.jpg'], 'the unrelated field itself still writes correctly');
  }

  console.log('\n-- 18. legitimate applyGradingAuthorityPatch SET/CHANGE/CLEAR all persist correctly --\n');
  {
    const id = `${TAG}-legit-patch`;
    createdIds.push(id);
    await client.query(`INSERT INTO collection_item (id, principal_id, asset_category, attributes) VALUES ($1, $2, 'comic', $3)`, [id, PRINCIPAL, JSON.stringify({ title: 'Legit' })]);

    await applyGradingAuthorityPatch({ principalId: PRINCIPAL, id, patch: { gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: 'VG 4.0', operatorGradeNumeric: 4.0, operatorGradeSetAt: Date.now() } });
    let row = await getMyCollectionItem({ principalId: PRINCIPAL, id });
    assertEq(row.attributes.operatorGrade, 'VG 4.0', 'SET via applyGradingAuthorityPatch persists');
    assertEq(row.attributes.title, 'Legit', 'unrelated field (title) untouched by the targeted patch');

    await applyGradingAuthorityPatch({ principalId: PRINCIPAL, id, patch: { gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: 'NM 9.0', operatorGradeNumeric: 9.0, operatorGradeSetAt: Date.now() } });
    row = await getMyCollectionItem({ principalId: PRINCIPAL, id });
    assertEq(row.attributes.operatorGrade, 'NM 9.0', 'CHANGE via applyGradingAuthorityPatch persists');

    await applyGradingAuthorityPatch({ principalId: PRINCIPAL, id, patch: { gradeAuthority: null, operatorGrade: null, operatorGradeNumeric: null, operatorGradeSetAt: null } });
    row = await getMyCollectionItem({ principalId: PRINCIPAL, id });
    assertEq(row.attributes.gradeAuthority, null, 'CLEAR via applyGradingAuthorityPatch persists (own-property null, durable clear)');
    assertEq(row.attributes.title, 'Legit', 'unrelated field (title) still untouched after the CLEAR patch');
  }

  console.log('\n-- 19. attempting to smuggle a non-grading field through applyGradingAuthorityPatch is filtered (defense in depth) --\n');
  {
    const id = `${TAG}-patch-filtered`;
    createdIds.push(id);
    await client.query(`INSERT INTO collection_item (id, principal_id, asset_category, attributes) VALUES ($1, $2, 'comic', $3)`, [id, PRINCIPAL, JSON.stringify({ title: 'Filtered', price: 5 })]);
    await applyGradingAuthorityPatch({ principalId: PRINCIPAL, id, patch: { gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: 'VG 4.0', price: 999999, title: 'HACKED' } });
    const row = await getMyCollectionItem({ principalId: PRINCIPAL, id });
    assertEq(row.attributes.operatorGrade, 'VG 4.0', 'the real grading field still applies');
    assertEq(row.attributes.price, 5, 'CRITICAL: a smuggled non-grading field (price) inside the patch object is filtered out, never written');
    assertEq(row.attributes.title, 'Filtered', 'CRITICAL: a smuggled title inside the patch object is filtered out, never written');
  }

  console.log('\n-- 20. end-to-end durable write-back: a validated SET action via the real /api/enrich handler survives to an independent later read --\n');
  {
    const id = await createOwnedItem('e2e-durable-writeback', {}); // starts with NO operator authority at all
    const { body, threw } = await callEnrich({
      title: 'Test Comic', year: '1990', publisher: 'Marvel', assetType: 'comic',
      grade: 'GD 2.0', isGraded: false, numericGrade: null, confidence: 'high',
      skipImageSearch: true,
      collectionItemId: id, ownedRefresh: true,
      operatorGradeAction: 'SET', operatorGradeValue: 'VG 4.0',
    });
    assertTrue(threw === null, 'no exception');
    assertEq(body?.governingGrade, 'VG 4.0', 'the SET action governs this response as before');
    assertTrue(!body?.gradingAuthorityPersistFailed, 'no durable persist failure reported');

    // Independent proof: read the row DIRECTLY via raw SQL — not through
    // another /api/enrich call — confirming the server itself durably
    // wrote the minted authority, with no client round-trip involved at all.
    const raw = await client.query('SELECT attributes FROM collection_item WHERE principal_id = $1 AND id = $2', [PRINCIPAL, id]);
    assertEq(raw.rows[0]?.attributes?.operatorGrade, 'VG 4.0', 'CRITICAL: the server itself durably persisted the validated SET — no client PUT round-trip was involved');
    assertEq(raw.rows[0]?.attributes?.gradeAuthority, 'OPERATOR_CONFIRMED', 'gradeAuthority durably persisted by the server');
    assertTrue(typeof raw.rows[0]?.attributes?.operatorGradeSetAt === 'number', 'operatorGradeSetAt durably persisted as a real server timestamp');

    // A completely independent SECOND /api/enrich call, with NO action and
    // NO grading fields resent at all, must still resolve the durable value.
    const second = await callEnrich({
      title: 'Test Comic', year: '1990', publisher: 'Marvel', assetType: 'comic',
      grade: 'FN 6.0', isGraded: false, numericGrade: null, confidence: 'high', // model grade changed since — must not matter
      skipImageSearch: true,
      collectionItemId: id, ownedRefresh: true,
      // no operatorGradeAction, no raw grading fields at all
    });
    assertEq(second.body?.governingGrade, 'VG 4.0', 'a fully independent later request, resending nothing, still resolves the durably persisted operator grade');
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
