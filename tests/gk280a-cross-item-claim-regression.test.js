// GK-280A — concrete cross-item grade-claim regression. SELF-CONTAINED so the SAME file runs against the
// pre-fix tree (records the defect) and the fixed tree (asserts the refusal).
//
// Real Development database (throwaway principals; rows are RETAINED per the append-only convention),
// REAL api/grade.js + api/collection.js handlers; mocked: global fetch (Anthropic/eBay transport) and the
// receipt store (in-memory stand-in for KV). No paid call. No Production access.
//
//   Scenario: ONE principal owns item A and item B. B has NO model baseline. A's scan produced a
//   server-issued grade receipt. The client then presents A's receipt while writing B.
//   PRE-FIX  : the server writes A's model baseline into B (defect).
//   POST-FIX : the server refuses the claim; B gets no baseline and no pointer; A's own claim still works.
//
//   node tests/gk280a-cross-item-claim-regression.test.js

import { readFileSync } from 'node:fs';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const line of readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}
process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';
if (!process.env.GRAILKEY_SESSION_SECRET) process.env.GRAILKEY_SESSION_SECRET = randomBytes(32).toString('base64url');
process.env.ANTHROPIC_API_KEY = 'test-anthropic-key-unused';
process.env.EBAY_APP_ID = process.env.EBAY_APP_ID || 'test-app-id';
process.env.EBAY_CERT_ID = process.env.EBAY_CERT_ID || 'test-cert-id';
process.env.PRICECHARTING_TOKEN = process.env.PRICECHARTING_TOKEN || 'test-pc-token';

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
const origLog = console.log;
const quiet = async (fn) => { console.log = () => {}; try { return await fn(); } finally { console.log = origLog; } };

const mintToken = (principalId) => {
  const payload = { principalId, iat: Date.now(), exp: Date.now() + 12 * 3600 * 1000, epoch: process.env.GRAILKEY_SESSION_EPOCH || '1' };
  const b = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${b}.${createHmac('sha256', process.env.GRAILKEY_SESSION_SECRET).update(b).digest('base64url')}`;
};
const mem = new Map();
const receiptLib = await import('../src/lib/gradeReceipt.js');
receiptLib.__setReceiptStoreForTests({
  async set(k, v, ttl) { mem.set(k, { v: JSON.parse(JSON.stringify(v)), exp: Date.now() + ttl * 1000 }); },
  async get(k) { const e = mem.get(k); return e && e.exp >= Date.now() ? JSON.parse(JSON.stringify(e.v)) : null; },
  async getdel(k) { const e = mem.get(k); mem.delete(k); return e && e.exp >= Date.now() ? e.v : null; },
});
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let visionCalls = 0;
global.fetch = async (url) => {
  const u = String(url);
  if (u.includes('oauth2/token') || u.includes('/oauth/')) return json({ access_token: 'x', expires_in: 7200, token_type: 'Application Access Token' });
  if (u.includes('search_by_image') || u.includes('item_summary/search')) return json({ itemSummaries: [], total: 0 });
  if (u.includes('api.anthropic.com')) {
    visionCalls += 1;
    return json({ id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-4-5-20250929', content: [{ type: 'text', text: JSON.stringify({
      title: 'Creepy', issue: '1', publisher: 'Warren', year: '1964', assetTypeConfident: true, grade: 'VG 4.0', isGraded: false, numericGrade: null,
      certNumber: null, labelType: null, labelNotes: null, keyIssue: null, variant: null, creator: null, price: '$20', priceLow: '$10', priceHigh: '$30',
      reason: 'Light spine wear.', confidence: 'medium', detectedPrice: null, restoration: null, defectPenalty: null, cgcPenaltyFlags: null }) }],
      stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } });
  }
  if (u.includes('comicvine.gamespot.com')) return json({ results: [], status_code: 1, error: 'OK' });
  if (u.includes('pricecharting.com')) return json({ products: [] });
  return json({});
};
const mkRes = () => { const r = { statusCode: null, body: null, headers: {} }; r.status = (c) => { r.statusCode = c; return r; }; r.json = (d) => { r.body = d; return r; }; r.setHeader = (k, v) => { r.headers[k] = v; }; return r; };
const rs = await import('../src/lib/researchStore.js'); rs.setResearchStoreForTests(rs.createMemoryResearchStore());
const { default: gradeHandler } = await import('../api/grade.js');
const { default: collectionHandler } = await import('../api/collection.js');
const { default: Jimp } = await import('jimp');
const PNG = (await new Jimp(64, 64, 0xff0000ff).getBufferAsync(Jimp.MIME_PNG)).toString('base64');

const client = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query('SET search_path TO data1_dev');
const marker = (await client.query('SELECT app_env FROM data1_dev.environment_marker')).rows;
if (marker.length !== 1 || marker[0].app_env !== 'development') { origLog('REFUSING TO RUN: environment_marker is not development'); process.exit(2); }

const TAG = `gk280a-reg-${Date.now()}`;
const PA = randomUUID();
await client.query(`INSERT INTO gk_principal (id, display_name, kind) VALUES ($1,$2,'user')`, [PA, `${TAG}-A`]);
const tokA = mintToken(PA);
let ip = 0;
const grade = async () => { const r = mkRes(); await quiet(() => gradeHandler({ method: 'POST', headers: { authorization: `Bearer ${tokA}`, 'x-forwarded-for': `10.80.${Date.now() % 250}.${++ip % 250}` }, body: { images: [PNG] } }, r)); return r; };
const coll = async (method, { id, body } = {}) => { const r = mkRes(); await quiet(() => collectionHandler({ method, headers: { authorization: `Bearer ${tokA}`, 'x-forwarded-for': `10.81.${Date.now() % 250}.${++ip % 250}` }, query: id ? { id } : {}, body }, r)); return r; };
const attrs = async (id) => (await client.query('SELECT attributes FROM collection_item WHERE principal_id = $1 AND id = $2', [PA, id])).rows[0]?.attributes || null;

origLog(`\n=== GK-280A cross-item claim regression (database marker=development) ===\n`);
const idA = `${TAG}-A-item`, idB = `${TAG}-B-item`;

// B exists first, with NO model baseline (a legacy / unclaimed item).
const bCreate = await coll('POST', { body: { id: idB, assetCategory: 'comic', attributes: { title: 'Creepy', issue: '1', grade: 'VG 4.0' } } });
ok(bCreate.statusCode === 200, 'item B created without any credential');
ok(!('modelPredictedGrade' in (await attrs(idB))), 'item B starts with NO model baseline');

// A's scan: server-issued credentials.
const g = await grade();
ok(g.statusCode === 200 && typeof g.body?.gradeReceiptId === 'string', 'A\'s scan returns a server-issued grade receipt');
const callsAfterGrade = visionCalls; // all grading-model calls happen in /api/grade; claims must add none
const FIXED = typeof g.body?.gradeProof === 'string'; // present only on a GK-280A tree
origLog(`  (tree under test: ${FIXED ? 'GK-280A FIXED' : 'PRE-FIX'}; gradeProof issued: ${FIXED})`);
const cred = { gradeReceiptId: g.body.gradeReceiptId, ...(FIXED ? { gradeProof: g.body.gradeProof } : {}) };

// THE DEFECT: present A's credential while writing B (existing item) — via PUT.
const claimIntoB = await coll('PUT', { id: idB, body: { assetCategory: 'comic', attributes: { title: 'Creepy', issue: '1', grade: 'VG 4.0' }, ...cred } });
const bAfter = await attrs(idB);
const bGotBaseline = !!bAfter && 'modelPredictedGrade' in bAfter;
origLog(`  OBSERVED: PUT B with A's credential -> HTTP ${claimIntoB.statusCode}; B baseline written: ${bGotBaseline}; gradeClaim: ${JSON.stringify(claimIntoB.body?.gradeClaim ?? null)}`);

if (!FIXED) {
  ok(claimIntoB.statusCode === 200 && bGotBaseline, 'PRE-FIX DEFECT REPRODUCED: A\'s receipt was claimed into B (B now carries A\'s model baseline)');
} else {
  ok(claimIntoB.statusCode === 200 && claimIntoB.body?.gradeClaim?.status === 'REFUSED', 'FIXED: the claim into the pre-existing item B is explicitly REFUSED');
  ok(!bGotBaseline && !('currentGradePrediction' in (bAfter || {})), 'FIXED: B received neither a baseline nor a pointer');
  ok(['GRADE_CLAIM_NOT_NEW_ITEM'].includes(claimIntoB.body?.gradeClaim?.code), 'FIXED: refusal code is GRADE_CLAIM_NOT_NEW_ITEM');
  // same credential via POST (upsert onto the existing id) is also refused
  const viaPost = await coll('POST', { body: { id: idB, assetCategory: 'comic', attributes: { title: 'Creepy', issue: '1' }, ...cred } });
  ok(viaPost.body?.gradeClaim?.status === 'REFUSED' && !('modelPredictedGrade' in (await attrs(idB))), 'FIXED: the same credential via POST onto existing B is also refused');
  // and A, created legitimately, still claims
  const aCreate = await coll('POST', { body: { id: idA, assetCategory: 'comic', attributes: { title: 'Creepy', issue: '1', grade: 'VG 4.0' }, ...cred } });
  const aAttrs = await attrs(idA);
  ok(aCreate.body?.gradeClaim?.status === 'ASSOCIATED' && !!aAttrs?.currentGradePrediction?.predictionEventId && 'modelPredictedGrade' in aAttrs, 'FIXED: the legitimate create of A still associates its own prediction (pointer + baseline)');
}
ok(visionCalls === callsAfterGrade, `claiming made no additional grading-model calls (${callsAfterGrade} -> ${visionCalls})`);

origLog(`\nFIXTURES RETAINED: principal ${PA.slice(0, 8)}…, items ${idA}, ${idB}`);
origLog(`\n${passed} passed, ${failed} failed`);
await client.end();
process.exit(failed ? 1 : 0);
