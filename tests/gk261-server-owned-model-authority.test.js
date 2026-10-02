// tests/gk261-server-owned-model-authority.test.js
//
// GK-261 — SERVER-OWNED MODEL / GRADE AUTHORITY RECEIPT.
//
// GOVERNING LAW: authority is minted by the server from a validated action.
// The client may describe WHAT happened; it may never declare THAT the
// result is authoritative. Five keys are server-owned: modelPredictedGrade,
// modelPredictedGradeReason, modelPredictedGradeConfidence, modelPredictedAt
// (the dispatch's "modelPredictedGradeAt"), identityAuthority — plus the new
// modelPredictedProvenance.
//
// Real Development DB (own throwaway principals, real HMAC tokens, real
// collection rows), REAL api/grade.js + api/collection.js + api/enrich.js
// handlers. Mocked: global fetch only (eBay / Anthropic transport). The
// receipt store is an in-memory stand-in for Upstash KV (Development has no
// KV); the Production certification exercises real KV.
//
// Invoke: node tests/gk261-server-owned-model-authority.test.js

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
if (!process.env.GRAILKEY_SESSION_SECRET) process.env.GRAILKEY_SESSION_SECRET = randomBytes(32).toString('base64url');
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-anthropic-key-unused';
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

console.log('\n=== GK-261 — server-owned model/grade authority (real Development DB + real handlers) ===\n');

const TAG = `gk261-${Date.now()}`;

function mintTestToken(principalId) {
  const payload = { principalId, iat: Date.now(), exp: Date.now() + 12 * 60 * 60 * 1000, epoch: process.env.GRAILKEY_SESSION_EPOCH || '1' };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', process.env.GRAILKEY_SESSION_SECRET).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

// ── in-memory receipt store (stand-in for Upstash KV; same get/set/getdel semantics) ──
const mem = new Map();
const store = {
  async set(k, v, ttl) { mem.set(k, { v: JSON.parse(JSON.stringify(v)), exp: Date.now() + ttl * 1000 }); },
  async get(k) { const e = mem.get(k); if (!e || e.exp < Date.now()) return null; return JSON.parse(JSON.stringify(e.v)); },
  async getdel(k) { const e = mem.get(k); mem.delete(k); if (!e || e.exp < Date.now()) return null; return e.v; },
};
const receiptLib = await import('../src/lib/gradeReceipt.js');
receiptLib.__setReceiptStoreForTests(store);

const client = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query('SET search_path TO data1_dev');

const PA = randomUUID(), PB = randomUUID();
for (const [id, n] of [[PA, 'A'], [PB, 'B']]) {
  await client.query(`INSERT INTO gk_principal (id, display_name, kind) VALUES ($1, $2, 'user')`, [id, `${TAG}-${n}`]);
}
const tokA = mintTestToken(PA), tokB = mintTestToken(PB);
const createdIds = [];

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const VISION = {
  title: 'Creepy', issue: '1', publisher: 'Warren', year: '1964', assetTypeConfident: true,
  grade: 'VG 4.0', isGraded: false, numericGrade: null, certNumber: null, labelType: null, labelNotes: null,
  keyIssue: null, variant: null, creator: null, price: '$20', priceLow: '$10', priceHigh: '$30',
  reason: 'Light spine wear, front cover creasing.', confidence: 'medium', detectedPrice: null,
  restoration: null, defectPenalty: null, cgcPenaltyFlags: null,
};
global.fetch = async (url) => {
  const u = String(url);
  if (u.includes('oauth2/token') || u.includes('/oauth/')) return json({ access_token: 'x', expires_in: 7200, token_type: 'Application Access Token' });
  if (u.includes('search_by_image') || u.includes('item_summary/search')) return json({ itemSummaries: [], total: 0 });
  if (u.includes('api.anthropic.com')) {
    return json({ id: 'msg_t', type: 'message', role: 'assistant', model: 'claude-sonnet-4-5-20250929', content: [{ type: 'text', text: JSON.stringify(VISION) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 5, output_tokens: 5 } });
  }
  if (u.includes('comicvine.gamespot.com')) return json({ results: [], status_code: 1, error: 'OK' });
  if (u.includes('pricecharting.com')) return json({ products: [] });
  return json({});
};
const origLog = console.log;
const quiet = async (fn) => { console.log = () => {}; try { return await fn(); } finally { console.log = origLog; } };

function mkRes() {
  const r = { statusCode: null, body: null, headers: {} };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (d) => { r.body = d; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  return r;
}
const { default: gradeHandler } = await import('../api/grade.js');
const { default: collectionHandler } = await import('../api/collection.js');
const { default: enrichHandler } = await import('../api/enrich.js');
const { default: Jimp } = await import('jimp');
const PNG = (await new Jimp(64, 64, 0xff0000ff).getBufferAsync(Jimp.MIME_PNG)).toString('base64');

let ipCounter = 0;
async function grade(token) {
  const res = mkRes();
  await quiet(() => gradeHandler({ method: 'POST', headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': `10.61.${Date.now() % 250}.${++ipCounter % 250}` }, body: { images: [PNG] } }, res));
  return res;
}
async function coll(token, method, { id, body } = {}) {
  const res = mkRes();
  const headers = { authorization: `Bearer ${token}`, 'x-forwarded-for': `10.62.${Date.now() % 250}.${++ipCounter % 250}` };
  await quiet(() => collectionHandler({ method, headers, query: id ? { id } : {}, body }, res));
  return res;
}
async function row(principal, id) {
  const r = await client.query('SELECT attributes FROM collection_item WHERE principal_id = $1 AND id = $2', [principal, id]);
  return r.rows[0]?.attributes || null;
}
const newId = (s) => { const id = `${TAG}-${s}`; createdIds.push(id); return id; }; // eslint-disable-line

const FORGED = {
  modelPredictedGrade: 'CGC 9.8', modelPredictedGradeReason: 'forged reason', modelPredictedGradeConfidence: 'high',
  modelPredictedAt: 1, modelPredictedGradeAt: 1, modelPredictedProvenance: { standing: 'SERVER_RECEIPT', model: 'forged-model', provider: 'forged' },
  identityAuthority: { title: 'OPERATOR_CONFIRMED', issue: 'OPERATOR_CONFIRMED' },
};
const PROTECTED = Object.keys(FORGED);

try {
  console.log('-- 1. client INSERT supplies all protected fields -> cannot mint them --');
  {
    const id = newId('forged-insert');
    const r = await coll(tokA, 'POST', { body: { id, attributes: { title: 'Creepy', ...FORGED } } });
    assertEq(r.statusCode, 200, 'save itself succeeds');
    const a = await row(PA, id);
    assertTrue(a && PROTECTED.every((k) => !(k in a)), 'CRITICAL: none of the protected keys were persisted from the client INSERT');
    assertEq(a?.title, 'Creepy', 'ordinary fields still persist normally');
  }

  console.log('\n-- 2/3. real receipt flow, then client UPDATE forge + explicit-null clear --');
  const gradeRes = await grade(tokA);
  assertEq(gradeRes.statusCode, 200, 'real /api/grade handler: 200');
  const rid = gradeRes.body?.gradeReceiptId;
  assertTrue(typeof rid === 'string' && rid.startsWith('gr_') && rid.length > 30, 'real /api/grade returns an opaque receipt id');
  assertTrue(!JSON.stringify(gradeRes.body).includes('principal'), 'receipt handle is opaque: response carries no principal material');
  const baselineId = newId('baseline');
  {
    // 4. valid same-principal receipt; 5/6. forged client grade/provider/model alongside
    const r = await coll(tokA, 'POST', { body: { id: baselineId, gradeReceiptId: rid, attributes: { title: 'Creepy', ...FORGED } } });
    assertEq(r.statusCode, 200, 'save with receipt + forged client fields: 200');
    const a = await row(PA, baselineId);
    assertEq(a?.modelPredictedGrade, 'VG 4.0', "CRITICAL (4/5): baseline is the SERVER'S model grade, not the forged 'CGC 9.8'");
    assertEq(a?.modelPredictedGradeReason, gradeRes.body.reason, "reason is the server-returned reason (as served), not the forged one");
    assertEq(a?.modelPredictedGradeConfidence, 'medium', 'confidence comes from the receipt');
    assertTrue(typeof a?.modelPredictedAt === 'number' && a.modelPredictedAt > 1, 'modelPredictedAt is the server receipt issuance time, not the forged 1');
    assertEq(a?.modelPredictedProvenance?.standing, 'SERVER_RECEIPT', 'provenance standing is SERVER_RECEIPT');
    assertEq(a?.modelPredictedProvenance?.provider, 'anthropic', 'CRITICAL (6): provider is the server-known value, forged provider ignored');
    assertEq(a?.modelPredictedProvenance?.model, 'claude-sonnet-4-5-20250929', 'CRITICAL (6): model is the server-known model, forged model ignored');
    assertEq(a?.modelPredictedProvenance?.modelVersion, 'claude-sonnet-4-5-20250929', 'GK-278: modelVersion is now the real version echoed by the API call (was unknown at GK-261 time)');
    assertTrue(/^sha256:[0-9a-f]{16}$/.test(a?.modelPredictedProvenance?.promptVersion || ''), 'GK-278: promptVersion is now a real hash of the prompt text actually sent');
    assertTrue(!('identityAuthority' in a), 'forged identityAuthority alongside a valid receipt still not minted');
    assertTrue(!('modelPredictedGradeAt' in a), 'forged modelPredictedGradeAt alias not minted');
    assertTrue(r.body?.attributes?.modelPredictedGrade === 'VG 4.0', 'save response reflects the server-minted baseline');
  }
  {
    // 2. client UPDATE forge; 3. explicit null clear; both via PUT and via POST upsert
    const before = await row(PA, baselineId);
    let r = await coll(tokA, 'PUT', { id: baselineId, body: { attributes: { title: 'Creepy', ...FORGED } } });
    assertEq(r.statusCode, 200, 'PUT with forged protected fields: 200');
    let a = await row(PA, baselineId);
    assertTrue(PROTECTED.filter((k) => k in before || k in a).every((k) => JSON.stringify(a[k]) === JSON.stringify(before[k])), 'CRITICAL (2): PUT cannot overwrite any protected value');
    const nulls = Object.fromEntries(PROTECTED.map((k) => [k, null]));
    r = await coll(tokA, 'PUT', { id: baselineId, body: { attributes: { title: 'Creepy', ...nulls } } });
    a = await row(PA, baselineId);
    assertTrue(PROTECTED.filter((k) => k in before).every((k) => JSON.stringify(a[k]) === JSON.stringify(before[k])), 'CRITICAL (3): PUT with explicit nulls cannot clear any protected value');
    r = await coll(tokA, 'POST', { body: { id: baselineId, attributes: { title: 'Creepy', ...nulls, ...FORGED } } });
    a = await row(PA, baselineId);
    assertTrue(PROTECTED.filter((k) => k in before).every((k) => JSON.stringify(a[k]) === JSON.stringify(before[k])), 'CRITICAL (2/3): POST upsert (ON CONFLICT) cannot overwrite or clear either');
    r = await coll(tokA, 'PUT', { id: baselineId, body: { attributes: { title: 'Creepy' } } });
    a = await row(PA, baselineId);
    assertEq(a?.modelPredictedGrade, 'VG 4.0', 'omitting the keys also preserves them');
  }

  console.log('\n-- 10. replay of the same receipt --');
  {
    const snapshot = await row(PA, baselineId);
    const r = await coll(tokA, 'PUT', { id: baselineId, body: { gradeReceiptId: rid, attributes: { title: 'Creepy' } } });
    assertEq(r.statusCode, 200, 'replayed receipt: save still succeeds');
    const a = await row(PA, baselineId);
    assertEq(a?.modelPredictedProvenance, snapshot.modelPredictedProvenance, 'replay did not change provenance (single-use + write-once)');
    assertEq(a?.modelPredictedAt, snapshot.modelPredictedAt, 'replay did not change the baseline timestamp');
    // same receipt against a DIFFERENT item
    const other = newId('replay-other');
    await coll(tokA, 'POST', { body: { id: other, attributes: { title: 'Other' } } });
    await coll(tokA, 'PUT', { id: other, body: { gradeReceiptId: rid, attributes: { title: 'Other' } } });
    const o = await row(PA, other);
    assertTrue(!('modelPredictedGrade' in o), 'a consumed receipt cannot mint a baseline on a second item');
  }

  console.log('\n-- 7. cross-principal receipt --');
  {
    const g = await grade(tokA);
    const stolen = g.body.gradeReceiptId;
    const id = newId('cross');
    await coll(tokB, 'POST', { body: { id, gradeReceiptId: stolen, attributes: { title: 'Creepy' } } });
    const b = await row(PB, id);
    assertTrue(b && !('modelPredictedGrade' in b), 'CRITICAL: principal B cannot claim principal A\'s receipt (REFUSED, no baseline)');
    // and the refused attempt did not burn A's receipt
    const idA = newId('cross-owner');
    await coll(tokA, 'POST', { body: { id: idA, gradeReceiptId: stolen, attributes: { title: 'Creepy' } } });
    const a = await row(PA, idA);
    assertEq(a?.modelPredictedGrade, 'VG 4.0', "the rightful owner can still claim after B's refused attempt");
  }

  console.log('\n-- 8. expired receipt --');
  {
    const g = await grade(tokA);
    const key = [...mem.keys()].pop();
    const rec = mem.get(key);
    rec.v.issuedAt = Date.now() - 7 * 60 * 60 * 1000; // older than the 6h TTL window, store entry itself not yet evicted
    const id = newId('expired');
    await coll(tokA, 'POST', { body: { id, gradeReceiptId: g.body.gradeReceiptId, attributes: { title: 'Creepy' } } });
    const a = await row(PA, id);
    assertTrue(a && !('modelPredictedGrade' in a), 'CRITICAL: expired receipt mints no authority');
  }

  console.log('\n-- 9. missing / garbage receipt -> no client fallback --');
  {
    const id = newId('no-receipt');
    const r = await coll(tokA, 'POST', { body: { id, attributes: { title: 'Creepy', ...FORGED } } });
    const a = await row(PA, id);
    assertEq(r.statusCode, 200, 'save without receipt succeeds');
    assertTrue(!('modelPredictedGrade' in a), 'CRITICAL: no receipt => no baseline, even with forged values present');
    const id2 = newId('garbage-receipt');
    await coll(tokA, 'POST', { body: { id: id2, gradeReceiptId: 'gr_notarealreceipt', attributes: { title: 'Creepy' } } });
    await coll(tokA, 'POST', { body: { id: id2, gradeReceiptId: { $ne: 1 }, attributes: { title: 'Creepy' } } });
    const g = await row(PA, id2);
    assertTrue(!('modelPredictedGrade' in g), 'unknown / malformed receipt ids mint nothing and do not error the save');
  }

  console.log('\n-- legacy / historical rows are preserved, not promoted --');
  {
    const id = newId('legacy');
    await client.query(
      `INSERT INTO collection_item (id, principal_id, asset_category, attributes) VALUES ($1,$2,'comic',$3)`,
      [id, PA, JSON.stringify({ title: 'Legacy', modelPredictedGrade: 'FN 6.0', modelPredictedAt: 111, identityAuthority: { title: 'OPERATOR_CONFIRMED' } })]);
    const g = await grade(tokA);
    await coll(tokA, 'PUT', { id, body: { gradeReceiptId: g.body.gradeReceiptId, attributes: { title: 'Legacy', ...FORGED } } });
    const a = await row(PA, id);
    assertEq(a?.modelPredictedGrade, 'FN 6.0', 'legacy client-written value is preserved byte-for-byte (not overwritten by a fresh receipt)');
    assertTrue(!('modelPredictedProvenance' in a), 'legacy row gains NO server provenance (not promoted)');
    assertEq(a?.identityAuthority, { title: 'OPERATOR_CONFIRMED' }, 'legacy identityAuthority untouched');
    assertEq(a?.modelPredictedAt, 111, 'legacy timestamp untouched');
  }

  console.log('\n-- 11/12. identityAuthority: forged, null, and the real server transition --');
  {
    const id = newId('identity');
    await coll(tokA, 'POST', { body: { id, attributes: { title: 'Creepy', issue: '1', year: '1964', publisher: 'Warren', identityAuthority: { title: 'OPERATOR_CONFIRMED' } } } });
    assertTrue(!('identityAuthority' in (await row(PA, id))), 'CRITICAL (11): forged identityAuthority on create is not persisted');
    // real server transition: validated manual correction on an owned item
    const res = mkRes();
    await quiet(() => enrichHandler({
      method: 'POST',
      headers: { authorization: `Bearer ${tokA}`, 'x-forwarded-for': '10.63.0.1' },
      body: {
        title: 'Creepy', issue: '2', year: '1964', publisher: 'Warren', grade: 'VG 4.0', confidence: 'medium', isGraded: false, numericGrade: null,
        images: [`data:image/png;base64,${PNG}`],
        manualIdentity: true, skipVision: true, skipImageSearch: true, identitySource: 'manual',
        manualAuthority: { correctedBy: 'operator', correctedFields: ['issue'] },
        priorIdentity: { title: 'Creepy', issue: '1', year: '1964', publisher: 'Warren' },
        collectionItemId: id, ownedRefresh: true,
      },
    }, res));
    const minted = res.body?.identityAuthority;
    assertEq(minted?.issue, 'OPERATOR_CONFIRMED', 'enrich handler minted identityAuthority from the validated correction');
    const after = await row(PA, id);
    assertEq(after?.identityAuthority?.issue, 'OPERATOR_CONFIRMED', 'CRITICAL: the SERVER durably persisted it (no client round-trip)');
    // 12. client null / forged overwrite cannot erase or widen it
    await coll(tokA, 'PUT', { id, body: { attributes: { title: 'Creepy', identityAuthority: null } } });
    assertEq((await row(PA, id))?.identityAuthority?.issue, 'OPERATOR_CONFIRMED', 'CRITICAL (12): explicit null cannot erase established server identityAuthority');
    await coll(tokA, 'PUT', { id, body: { attributes: { title: 'Creepy', identityAuthority: { title: 'OPERATOR_CONFIRMED', year: 'OPERATOR_CONFIRMED' } } } });
    const widened = (await row(PA, id))?.identityAuthority;
    assertTrue(widened?.issue === 'OPERATOR_CONFIRMED' && !('year' in widened) && !('title' in widened), 'a forged identityAuthority overwrite cannot widen the established authority');
  }

  console.log('\n-- watch-mode result: unknown model recorded as UNKNOWN, not guessed --');
  {
    // direct library check of the no-model contract
    const rid2 = await receiptLib.issueGradeReceipt({ principalId: PA, result: { grade: 'GD 2.0', reason: 'r', confidence: 'low' }, model: null });
    const c = await receiptLib.claimGradeReceipt({ principalId: PA, receiptId: rid2 });
    assertTrue(c.ok && c.baseline.modelPredictedProvenance.model === null && c.baseline.modelPredictedProvenance.provider === null, 'unknown model/provider stay null');
    assertEq(await receiptLib.issueGradeReceipt({ principalId: PA, result: { reason: 'no grade' } }), null, 'no grade => no receipt issued');
    assertEq(await receiptLib.issueGradeReceipt({ principalId: null, result: { grade: 'X' } }), null, 'no principal => no receipt issued');
    // concurrent claims: exactly one winner
    const rid3 = await receiptLib.issueGradeReceipt({ principalId: PA, result: { grade: 'FN 6.0' }, model: 'm' });
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => receiptLib.claimGradeReceipt({ principalId: PA, receiptId: rid3 })));
    assertEq(results.filter((x) => x.ok).length, 1, 'concurrent claims: exactly one succeeds');
  }
} finally {
  if (createdIds.length) await client.query('DELETE FROM collection_item WHERE id = ANY($1::text[])', [createdIds]);
  // GK-278: /api/grade now writes append-only model_prediction_event rows for these principals, so the
  // throwaway principals can no longer be deleted (FK). They are retained by design.
  try { await client.query('DELETE FROM gk_principal WHERE id = ANY($1::uuid[])', [[PA, PB]]); } catch { /* retained: referenced by append-only prediction events */ }
  await client.end();
  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) { console.log('FAILURES:'); failures.forEach((f) => console.log(f)); process.exit(1); }
  process.exit(0);
}
