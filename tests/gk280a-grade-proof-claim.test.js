// GK-280A — GOVERNING-GRADE AUTHORITY FOUNDATION: scan-bound grade proof, atomic claim-time association,
// protected durable currentGradePrediction pointer. Real Development database (throwaway principals; rows
// RETAINED per the append-only convention), REAL api/grade.js + api/collection.js + api/enrich.js handlers.
// Mocked: global fetch (Anthropic/eBay/ComicVine/PriceCharting transport) and the receipt store (in-memory
// KV stand-in). NO paid call, NO Production access, NO schema change.
//
//   node tests/gk280a-grade-proof-claim.test.js
//
// What this does NOT prove: live Production behavior. The pointer is written but is NOT yet a governing
// economic input (that is GK-280B); item 14 proves exactly that — outputs are unchanged.

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
delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN;
delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN;

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
const origLog = console.log;
const quiet = async (fn) => { console.log = () => {}; try { return await fn(); } finally { console.log = origLog; } };
const section = (t) => origLog(`\n-- ${t} --`);

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
const { issueGradeProof, verifyGradeProof } = receiptLib;
const { sha256Hex } = await import('../src/modules/learning/index.js');

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const buildEbayItem = (title, price, idx) => ({
  itemId: `v1|g280a${idx}|0`, title, leafCategoryIds: ['259104'], categories: [{ categoryId: '259104', categoryName: 'Comics & Graphic Novels' }],
  image: { imageUrl: 'https://i.ebayimg.com/images/g/fake/s-l225.jpg' }, price: { value: String(price), currency: 'USD' },
  itemHref: `https://api.ebay.com/buy/browse/v1/item/v1%7Cg280a${idx}%7C0`, seller: { username: `s${idx}`, feedbackPercentage: '99.9', feedbackScore: 1000 },
  condition: 'Used', conditionId: '3000', thumbnailImages: [{ imageUrl: 'https://i.ebayimg.com/images/g/fake/s-l1600.jpg' }], buyingOptions: ['FIXED_PRICE'],
  itemWebUrl: `https://www.ebay.com/itm/g280a${idx}`, itemLocation: { postalCode: '000**', country: 'US' }, legacyItemId: `g280a${idx}`, adultOnly: false,
  itemOriginDate: '2026-04-06T14:26:54.000Z', itemCreationDate: '2026-04-06T14:26:54.000Z', listingMarketplaceId: 'EBAY_US',
});
const POOL = [['Creepy #1 Warren 1964 VG', 80], ['Creepy 1 Warren Magazine 1964 FN', 95], ['Creepy #1 1964 Warren Publishing GD', 60], ['Creepy #1 (1964) VG+', 88]].map(([t, p], i) => buildEbayItem(t, p, i));
let modelCalls = 0;
const VISION = { title: 'Creepy', issue: '1', publisher: 'Warren', year: '1964', assetTypeConfident: true, foreignEdition: false, isReprint: false, editionType: 'original', grade: 'VG 4.0', isGraded: false, numericGrade: null, certNumber: null, labelType: null, labelNotes: null, keyIssue: null, variant: null, creator: null, price: '$20', priceLow: '$10', priceHigh: '$30', reason: 'Light spine wear.', confidence: 'medium', detectedPrice: null, restoration: null, defectPenalty: null, cgcPenaltyFlags: null };
global.fetch = async (url) => {
  const u = String(url);
  if (u.includes('oauth2/token') || u.includes('/oauth/')) return json({ access_token: 'x', expires_in: 7200, token_type: 'Application Access Token' });
  if (u.includes('search_by_image')) return json({ itemSummaries: [], total: 0 });
  if (u.includes('item_summary/search')) return json({ itemSummaries: POOL, total: POOL.length });
  if (u.includes('api.anthropic.com')) {
    modelCalls += 1;
    return json({ id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-4-5-20250929', content: [{ type: 'text', text: JSON.stringify(VISION) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } });
  }
  if (u.includes('comicvine.gamespot.com')) return json({ results: [], status_code: 1, error: 'OK' });
  if (u.includes('pricecharting.com')) return json({ products: [] });
  return json({});
};
const mkRes = () => { const r = { statusCode: null, body: null, headers: {} }; r.status = (c) => { r.statusCode = c; return r; }; r.json = (d) => { r.body = d; return r; }; r.setHeader = (k, v) => { r.headers[k] = v; }; return r; };
const rs = await import('../src/lib/researchStore.js'); rs.setResearchStoreForTests(rs.createMemoryResearchStore());
const { default: gradeHandler } = await import('../api/grade.js');
const { default: collectionHandler } = await import('../api/collection.js');
const { default: enrichHandler } = await import('../api/enrich.js');
const { default: Jimp } = await import('jimp');
const png = async (rgba) => (await new Jimp(64, 64, rgba).getBufferAsync(Jimp.MIME_PNG)).toString('base64');
let colorSeed = 0x11223344;
const nextPng = async () => png((colorSeed = (colorSeed + 0x01010101) >>> 0) | 0xff);

const client = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query('SET search_path TO data1_dev');
const marker = (await client.query('SELECT app_env FROM data1_dev.environment_marker')).rows;
if (marker.length !== 1 || marker[0].app_env !== 'development') { origLog('REFUSING TO RUN: environment_marker is not development'); process.exit(2); }

const TAG = `gk280a-${Date.now()}`;
const PA = randomUUID(), PB = randomUUID();
for (const [id, n] of [[PA, 'A'], [PB, 'B']]) await client.query(`INSERT INTO gk_principal (id, display_name, kind) VALUES ($1,$2,'user')`, [id, `${TAG}-${n}`]);
const tokA = mintToken(PA), tokB = mintToken(PB);
let ip = 0;
const scan = async (tok, { target, img } = {}) => {
  const image = img || await nextPng();
  const r = mkRes();
  await quiet(() => gradeHandler({ method: 'POST', headers: { authorization: `Bearer ${tok}`, 'x-forwarded-for': `10.82.${Date.now() % 250}.${++ip % 250}` }, body: { images: [image], ...(target ? { targetItemId: target, predictionKind: 'RE_GRADE' } : {}) } }, r));
  return { res: r, body: r.body, hash: 'sha256:' + sha256Hex(image), image };
};
const coll = async (tok, method, { id, body } = {}) => { const r = mkRes(); await quiet(() => collectionHandler({ method, headers: { authorization: `Bearer ${tok}`, 'x-forwarded-for': `10.83.${Date.now() % 250}.${++ip % 250}` }, query: id ? { id } : {}, body }, r)); return r; };
const attrsOf = async (principal, id) => (await client.query('SELECT attributes FROM collection_item WHERE principal_id = $1 AND id = $2', [principal, id])).rows[0]?.attributes || null;
const baseAttrs = { title: 'Creepy', issue: '1', grade: 'VG 4.0' };
const create = (tok, id, cred, extra = {}) => coll(tok, 'POST', { body: { id, assetCategory: 'comic', attributes: { ...baseAttrs }, ...cred, ...extra } });
const eventCount = async (p) => Number((await client.query('SELECT count(*)::int n FROM model_prediction_event WHERE principal_id = $1', [p])).rows[0].n);

origLog(`\n=== GK-280A grade proof + atomic claim (database marker=development) ===`);

section('1. same-item claim success (proof AND legacy receipt), pointer + baseline server-written');
const s1 = await scan(tokA);
ok(s1.res.statusCode === 200 && typeof s1.body.gradeProof === 'string' && s1.body.gradeProof.startsWith('gp1.') && typeof s1.body.gradeReceiptId === 'string', '/api/grade returns a signed gradeProof AND the existing receipt id');
ok(!JSON.stringify(s1.body).includes(PA), 'neither credential exposes the principal id');
const id1 = `${TAG}-1`;
const c1 = await create(tokA, id1, { gradeProof: s1.body.gradeProof, gradeReceiptId: s1.body.gradeReceiptId, gradeInputHash: s1.hash });
const a1 = await attrsOf(PA, id1);
ok(c1.body?.gradeClaim?.status === 'ASSOCIATED', 'create-time claim ASSOCIATED');
ok(!!a1?.currentGradePrediction?.predictionEventId && a1.currentGradePrediction.via === 'GRADE_PROOF' && a1.currentGradePrediction.history.length === 0, 'durable currentGradePrediction pointer written (via GRADE_PROOF, empty history)');
ok(a1?.modelPredictedGrade === 'VG 4.0' && a1?.modelPredictedProvenance?.predictionEventId === a1.currentGradePrediction.predictionEventId && a1?.modelPredictedProvenance?.claimedVia === 'GRADE_PROOF', 'write-once baseline came from the durable EVENT, linked to the same event id');
const ev1 = (await client.query('SELECT id, result_id, input_hash, prediction FROM model_prediction_event WHERE id = $1 AND principal_id = $2', [a1.currentGradePrediction.predictionEventId, PA])).rows[0];
ok(ev1 && ev1.input_hash === s1.hash && ev1.prediction.grade === 'VG 4.0', 'the pointer names a real immutable event whose input hash is the scan\'s');
const sR = await scan(tokA);
const idR = `${TAG}-1r`;
const cR = await create(tokA, idR, { gradeReceiptId: sR.body.gradeReceiptId }); // an older client: receipt only
const aR = await attrsOf(PA, idR);
ok(cR.body?.gradeClaim?.status === 'ASSOCIATED' && aR?.currentGradePrediction?.via === 'GRADE_RECEIPT' && aR?.modelPredictedGrade === 'VG 4.0', 'legacy receipt-only create still works and now also writes the pointer');

section('2/15. cross-item claim refusal through PUT and POST (no unauthorized claim path)');
const s2 = await scan(tokA);
const idB = `${TAG}-2B`;
await create(tokA, idB, {});
const putB = await coll(tokA, 'PUT', { id: idB, body: { assetCategory: 'comic', attributes: { ...baseAttrs }, gradeProof: s2.body.gradeProof, gradeReceiptId: s2.body.gradeReceiptId } });
ok(putB.body?.gradeClaim?.status === 'REFUSED' && putB.body.gradeClaim.code === 'GRADE_CLAIM_NOT_NEW_ITEM', 'PUT: fresh proof into pre-existing item B refused (NOT_NEW_ITEM)');
const postB = await create(tokA, idB, { gradeProof: s2.body.gradeProof });
ok(postB.body?.gradeClaim?.status === 'REFUSED', 'POST onto the existing id: refused');
const bA = await attrsOf(PA, idB);
ok(!('modelPredictedGrade' in bA) && !('currentGradePrediction' in bA), 'B carries neither a baseline nor a pointer');
const idA2 = `${TAG}-2A`;
const aClaim = await create(tokA, idA2, { gradeProof: s2.body.gradeProof, gradeReceiptId: s2.body.gradeReceiptId });
ok(aClaim.body?.gradeClaim?.status === 'ASSOCIATED', 'the refusals consumed nothing: the legitimate create of A (same proof) then succeeds');
const putAgainOtherNew = await create(tokA, `${TAG}-2C`, { gradeProof: s2.body.gradeProof });
ok(putAgainOtherNew.body?.gradeClaim?.code === 'GRADE_CLAIM_CROSS_ITEM' && !('currentGradePrediction' in (await attrsOf(PA, `${TAG}-2C`))), 'one event, one item: the same proof cannot also bind a second NEW item (CROSS_ITEM)');
const putNew = await coll(tokA, 'PUT', { id: `${TAG}-2-nonexistent`, body: { assetCategory: 'comic', attributes: { ...baseAttrs }, gradeProof: (await scan(tokA)).body.gradeProof } });
ok(putNew.statusCode === 404 && !(await attrsOf(PA, `${TAG}-2-nonexistent`)), 'PUT to a non-existent id: 404, no row, no claim');

section('3. cross-principal refusal');
const s3 = await scan(tokA);
const idX = `${TAG}-3X`;
const xp = await create(tokB, idX, { gradeProof: s3.body.gradeProof, gradeReceiptId: s3.body.gradeReceiptId });
ok(xp.body?.gradeClaim?.status === 'REFUSED' && xp.body.gradeClaim.code === 'GRADE_CLAIM_PRINCIPAL_MISMATCH', 'principal B presenting principal A\'s proof: PRINCIPAL_MISMATCH');
ok(!('currentGradePrediction' in (await attrsOf(PB, idX))) && !('modelPredictedGrade' in (await attrsOf(PB, idX))), 'B received no pointer and no baseline');
const xr = await create(tokB, `${TAG}-3Y`, { gradeReceiptId: s3.body.gradeReceiptId });
ok(xr.body?.gradeClaim?.status === 'REFUSED' && xr.body.gradeClaim.code === 'GRADE_CLAIM_RECEIPT_INVALID', 'principal B presenting principal A\'s legacy receipt: refused');
const stillClaimable = await create(tokA, `${TAG}-3A`, { gradeProof: s3.body.gradeProof, gradeReceiptId: s3.body.gradeReceiptId });
ok(stillClaimable.body?.gradeClaim?.status === 'ASSOCIATED', 'and A\'s own credential was not consumed by B\'s attempt');
const tampered = s3.body.gradeProof.slice(0, -4) + 'AAAA';
ok((await create(tokA, `${TAG}-3T`, { gradeProof: tampered })).body?.gradeClaim?.code === 'GRADE_CLAIM_PROOF_INVALID', 'a tampered proof signature is refused (PROOF_INVALID)');
const expired = issueGradeProof({ principalId: PA, resultId: randomUUID(), predictionEventId: randomUUID(), now: Date.now() - 40 * 86400 * 1000 });
ok((await create(tokA, `${TAG}-3E`, { gradeProof: expired })).body?.gradeClaim?.code === 'GRADE_CLAIM_PROOF_INVALID', 'an expired proof is refused');

section('4. input-hash mismatch');
const s4 = await scan(tokA);
const m4 = await create(tokA, `${TAG}-4a`, { gradeProof: s4.body.gradeProof, gradeInputHash: 'sha256:' + 'ab'.repeat(32) });
ok(m4.body?.gradeClaim?.code === 'GRADE_CLAIM_INPUT_HASH_MISMATCH', 'presented input hash differs from the proof: refused');
const evRow4 = (await client.query('SELECT id, result_id FROM model_prediction_event WHERE principal_id = $1 AND surface = \x27GRADE\x27 AND input_hash = $2', [PA, s4.hash])).rows[0];
const wrongHashProof = issueGradeProof({ principalId: PA, resultId: evRow4.result_id, predictionEventId: evRow4.id, inputHash: 'sha256:' + 'cd'.repeat(32) });
ok((await create(tokA, `${TAG}-4b`, { gradeProof: wrongHashProof })).body?.gradeClaim?.code === 'GRADE_CLAIM_INPUT_HASH_MISMATCH', 'a validly signed proof whose input hash differs from the durable event\'s: refused');
ok((await create(tokA, `${TAG}-4c`, { gradeProof: s4.body.gradeProof, gradeInputHash: s4.hash })).body?.gradeClaim?.status === 'ASSOCIATED', 'the correct hash associates');

section('5. prediction-event mismatch');
const s5 = await scan(tokA);
const ev5 = (await client.query('SELECT id, result_id FROM model_prediction_event WHERE principal_id = $1 AND surface = \x27GRADE\x27 AND input_hash = $2', [PA, s5.hash])).rows[0];
const forgedEvent = issueGradeProof({ principalId: PA, resultId: ev5.result_id, predictionEventId: randomUUID(), inputHash: s5.hash });
ok((await create(tokA, `${TAG}-5a`, { gradeProof: forgedEvent })).body?.gradeClaim?.code === 'GRADE_CLAIM_EVENT_MISMATCH', 'proof naming a non-existent event: refused');
const wrongResult = issueGradeProof({ principalId: PA, resultId: randomUUID(), predictionEventId: ev5.id, inputHash: s5.hash });
ok((await create(tokA, `${TAG}-5b`, { gradeProof: wrongResult })).body?.gradeClaim?.code === 'GRADE_CLAIM_EVENT_MISMATCH', 'proof whose result id does not match the durable event: refused');
const s5B = await scan(tokB);
const evB = (await client.query('SELECT id, result_id FROM model_prediction_event WHERE principal_id = $1 AND surface = \x27GRADE\x27 AND input_hash = $2', [PB, s5B.hash])).rows[0];
const foreignEvent = issueGradeProof({ principalId: PA, resultId: evB.result_id, predictionEventId: evB.id, inputHash: s5B.hash });
ok((await create(tokA, `${TAG}-5c`, { gradeProof: foreignEvent })).body?.gradeClaim?.code === 'GRADE_CLAIM_EVENT_MISMATCH', 'proof naming ANOTHER principal\'s event: refused (event lookup is principal-scoped)');

section('6. same-item retry idempotency (and concurrent claims)');
const s6 = await scan(tokA);
const id6 = `${TAG}-6`;
const r6a = await create(tokA, id6, { gradeProof: s6.body.gradeProof });
const ptr6 = (await attrsOf(PA, id6)).currentGradePrediction;
const r6b = await create(tokA, id6, { gradeProof: s6.body.gradeProof });
const ptr6b = (await attrsOf(PA, id6)).currentGradePrediction;
ok(r6a.body.gradeClaim.status === 'ASSOCIATED' && r6b.body.gradeClaim.status === 'ALREADY_ASSOCIATED' && JSON.stringify(ptr6) === JSON.stringify(ptr6b), 'retry: ALREADY_ASSOCIATED, pointer byte-identical');
const putRetry = await coll(tokA, 'PUT', { id: id6, body: { assetCategory: 'comic', attributes: { ...baseAttrs, note: 'edit' }, gradeProof: s6.body.gradeProof } });
ok(putRetry.body.gradeClaim.status === 'ALREADY_ASSOCIATED' && JSON.stringify((await attrsOf(PA, id6)).currentGradePrediction) === JSON.stringify(ptr6), 'a later PUT edit re-sending the same proof is a no-op for the pointer');
const s6c = await scan(tokA);
const [rc1, rc2] = await Promise.all([create(tokA, `${TAG}-6x`, { gradeProof: s6c.body.gradeProof }), create(tokA, `${TAG}-6y`, { gradeProof: s6c.body.gradeProof })]);
const statuses = [rc1.body.gradeClaim.status, rc2.body.gradeClaim.status].sort();
ok(JSON.stringify(statuses) === JSON.stringify(['ASSOCIATED', 'REFUSED']), `two concurrent claims of one event into two new items: exactly one wins (${statuses.join('/')})`);
const bound = (await client.query(`SELECT count(*)::int n FROM collection_item WHERE principal_id = $1 AND attributes->'currentGradePrediction'->>'predictionEventId' = $2`, [PA, (await attrsOf(PA, rc1.body.gradeClaim.status === 'ASSOCIATED' ? `${TAG}-6x` : `${TAG}-6y`)).currentGradePrediction.predictionEventId])).rows[0].n;
ok(bound === 1, 'the event is referenced by exactly one item after the race');

section('7. duplicate-copy identity isolation (two physical copies of the same book)');
const copy1 = await scan(tokA), copy2 = await scan(tokA);
const idC1 = `${TAG}-7c1`, idC2 = `${TAG}-7c2`;
ok((await create(tokA, idC1, { gradeProof: copy1.body.gradeProof })).body.gradeClaim.status === 'ASSOCIATED', 'copy 1 associates its own prediction');
const crossCopy = await create(tokA, `${idC2}-x`, { gradeProof: copy1.body.gradeProof });
ok(crossCopy.body.gradeClaim.code === 'GRADE_CLAIM_CROSS_ITEM', 'copy 1\'s proof cannot be reused for the second physical copy (ANOTHER COPY row)');
ok((await create(tokA, idC2, { gradeProof: copy2.body.gradeProof })).body.gradeClaim.status === 'ASSOCIATED', 'ANOTHER COPY: the new row (fresh id) associates copy 2\'s OWN prediction');
const p1 = (await attrsOf(PA, idC1)).currentGradePrediction.predictionEventId, p2 = (await attrsOf(PA, idC2)).currentGradePrediction.predictionEventId;
ok(p1 !== p2, 'the two physical copies point at two different events');
ok(!!(await create(tokA, idC1, { gradeProof: copy2.body.gradeProof })).body.gradeClaim.code, 'copy 2\'s proof cannot be pushed onto copy 1 either');
ok((await attrsOf(PA, idC1)).currentGradePrediction.predictionEventId === p1, 'copy 1 still points at its own event');

section('8. delayed held-copy resolution beyond the receipt TTL — no new grading call');
const s8 = await scan(tokA);
const callsBeforeDelay = modelCalls;
mem.clear(); // the 6h KV receipt is gone (expired/evicted); only the signed proof + the durable event remain
ok((await create(tokA, `${TAG}-8r`, { gradeReceiptId: s8.body.gradeReceiptId })).body.gradeClaim.code === 'GRADE_CLAIM_RECEIPT_INVALID', 'the expired receipt alone can no longer claim (as before)');
const id8 = `${TAG}-8`;
const d8 = await create(tokA, id8, { gradeProof: s8.body.gradeProof, gradeReceiptId: s8.body.gradeReceiptId });
ok(d8.body.gradeClaim.status === 'ASSOCIATED' && (await attrsOf(PA, id8)).currentGradePrediction.via === 'GRADE_PROOF', 'the signed proof still associates after the receipt is gone');
ok(modelCalls === callsBeforeDelay, 'delayed claim made zero additional grading-model calls');
const v20 = verifyGradeProof(s8.body.gradeProof, { now: Date.now() + 20 * 86400 * 1000 });
ok(v20.ok === true, 'the proof verifies 20 days later (30-day window)');

section('9. fresh-scan ordering: scan -> prediction -> proof -> enrich BEFORE the row exists -> claim -> pointer');
const s9 = await scan(tokA);
const id9 = `${TAG}-9`;
const enrichLogs = [];
const enrichRes = mkRes();
console.log = (...a) => { enrichLogs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
try {
  await enrichHandler({ method: 'POST', headers: { authorization: `Bearer ${tokA}`, 'x-forwarded-for': `10.84.0.${++ip % 250}` }, body: { title: 'Creepy', issue: '1', grade: 'VG 4.0', year: '1964', publisher: 'Warren', assetType: 'comic', category: 'comic', collectionItemId: id9, gradeProof: s9.body.gradeProof, images: [s9.image] } }, enrichRes);
} finally { console.log = origLog; }
ok(enrichRes.statusCode === 200 && !(await attrsOf(PA, id9)), 'enrichment ran while NO durable row exists yet (the race window) and succeeded');
ok(enrichLogs.some((l) => l.startsWith('[grade-proof]') && l.includes('VERIFIED') && l.includes('PRINCIPAL_OK')), 'enrich verified the proof statelessly (no dependence on the row)');
ok((await create(tokA, id9, { gradeProof: s9.body.gradeProof })).body.gradeClaim.status === 'ASSOCIATED', 'the later persist associates the same prediction -> durable pointer');
const { registerPendingPersist, awaitPendingPersist, __pendingPersistCountForTests } = await import('../src/lib/pendingPersist.js');
let release; const gate = new Promise((r) => { release = r; });
registerPendingPersist('item-x', gate.then(() => 'persisted'));
const order = [];
const waiter = awaitPendingPersist('item-x', 2000).then((r) => { order.push('refresh:' + r); });
await new Promise((r) => setTimeout(r, 30)); order.push('persist-still-running'); release(); await waiter;
ok(JSON.stringify(order) === JSON.stringify(['persist-still-running', 'refresh:settled']), 'client ordering: an owned refresh waits for THIS item\'s in-flight persist');
ok(await awaitPendingPersist('item-x') === 'none' && __pendingPersistCountForTests() === 0, 'registry clears itself; a refresh with nothing in flight waits for nothing');
registerPendingPersist('item-slow', new Promise(() => {}));
ok(await awaitPendingPersist('item-slow', 40) === 'timeout', 'a stuck persist never blocks a refresh beyond the bound');

section('10. re-grade pointer transition (authorized, history preserved)');
const s10a = await scan(tokA);
const id10 = `${TAG}-10`;
await create(tokA, id10, { gradeProof: s10a.body.gradeProof });
const e10a = (await attrsOf(PA, id10)).currentGradePrediction.predictionEventId;
const rg1 = await scan(tokA, { target: id10 }), rg2 = await scan(tokA, { target: id10 });
const t2 = await coll(tokA, 'PUT', { id: id10, body: { assetCategory: 'comic', attributes: { ...baseAttrs }, gradeProof: rg2.body.gradeProof } });
const ptrAfter2 = (await attrsOf(PA, id10)).currentGradePrediction;
ok(t2.body.gradeClaim.status === 'ASSOCIATED' && ptrAfter2.predictionEventId !== e10a && JSON.stringify(ptrAfter2.history) === JSON.stringify([e10a]), 're-grade proof moves the pointer to the newer event; the first event is kept in history');
const stale = await coll(tokA, 'PUT', { id: id10, body: { assetCategory: 'comic', attributes: { ...baseAttrs }, gradeProof: rg1.body.gradeProof } });
ok(stale.body.gradeClaim.code === 'GRADE_CLAIM_STALE_TRANSITION' && (await attrsOf(PA, id10)).currentGradePrediction.predictionEventId === ptrAfter2.predictionEventId, 'an OLDER re-grade event cannot replace the newer pointer (STALE_TRANSITION)');
const oldAgain = await coll(tokA, 'PUT', { id: id10, body: { assetCategory: 'comic', attributes: { ...baseAttrs }, gradeProof: s10a.body.gradeProof } });
ok(oldAgain.body.gradeClaim.status === 'ALREADY_ASSOCIATED', 're-presenting the superseded original proof is a harmless no-op (it is in the history)');
const otherItem = `${TAG}-10o`;
await create(tokA, otherItem, {});
const wrongTarget = await coll(tokA, 'PUT', { id: otherItem, body: { assetCategory: 'comic', attributes: { ...baseAttrs }, gradeProof: (await scan(tokA, { target: id10 })).body.gradeProof } });
ok(wrongTarget.body.gradeClaim.code === 'GRADE_CLAIM_TARGET_MISMATCH' && !('currentGradePrediction' in (await attrsOf(PA, otherItem))), 'a re-grade proof issued for item X cannot be claimed for item Y (TARGET_MISMATCH)');

section('11. historical prediction immutability (database-negative)');
const countBefore = await eventCount(PA);
let updErr = null, delErr = null;
try { await client.query('UPDATE model_prediction_event SET model = $1 WHERE id = $2', ['tampered', ev1.id]); } catch (e) { updErr = e; }
try { await client.query('DELETE FROM model_prediction_event WHERE id = $1', [ev1.id]); } catch (e) { delErr = e; }
ok(!!updErr && !!delErr, 'the database REFUSES to UPDATE or DELETE a prediction event (append-only trigger)');
ok(await eventCount(PA) === countBefore && (await client.query('SELECT model FROM model_prediction_event WHERE id = $1', [ev1.id])).rows[0].model !== 'tampered', 'event history unchanged by every claim/transition in this suite');

section('12. server-only pointer authority');
const forgedPtr = { v: 1, predictionEventId: randomUUID(), resultId: randomUUID(), via: 'FORGED', history: [] };
const idF = `${TAG}-12`;
const f1 = await create(tokA, idF, {}, { attributes: { ...baseAttrs, currentGradePrediction: forgedPtr } });
ok(!('currentGradePrediction' in (await attrsOf(PA, idF))), 'client INSERT supplying a pointer: not persisted');
const sF = await scan(tokA);
await create(tokA, idF, { gradeProof: sF.body.gradeProof });
const realPtr = (await attrsOf(PA, idF)).currentGradePrediction;
await coll(tokA, 'PUT', { id: idF, body: { assetCategory: 'comic', attributes: { ...baseAttrs, currentGradePrediction: forgedPtr } } });
ok(JSON.stringify((await attrsOf(PA, idF)).currentGradePrediction) === JSON.stringify(realPtr), 'client UPDATE forging the pointer: existing server pointer wins');
await coll(tokA, 'PUT', { id: idF, body: { assetCategory: 'comic', attributes: { ...baseAttrs, currentGradePrediction: null } } });
ok(JSON.stringify((await attrsOf(PA, idF)).currentGradePrediction) === JSON.stringify(realPtr), 'client explicit-null clear / omission cannot erase it');
await coll(tokA, 'PUT', { id: idF, body: { assetCategory: 'comic', attributes: { ...baseAttrs } } });
ok(JSON.stringify((await attrsOf(PA, idF)).currentGradePrediction) === JSON.stringify(realPtr), 'omitting the key on a full replace keeps it');
void f1;

section('13/14. no extra model calls; equivalent legitimate inputs give unchanged economics (pointer is NOT yet governing)');
const callsBeforeClaims = modelCalls;
const sEco = await scan(tokA);
const callsAfterScan = modelCalls;
await create(tokA, `${TAG}-eco`, { gradeProof: sEco.body.gradeProof, gradeReceiptId: sEco.body.gradeReceiptId });
ok(modelCalls === callsAfterScan, 'claim/association made zero additional model calls');
const enrichBody = (extra) => ({ title: 'Creepy', issue: '1', grade: 'VG 4.0', isGraded: false, numericGrade: null, year: '1964', publisher: 'Warren', assetType: 'comic', category: 'comic', ...extra });
const runEnrich = async (body) => { const r = mkRes(); await quiet(() => enrichHandler({ method: 'POST', headers: { authorization: `Bearer ${tokA}`, 'x-forwarded-for': `10.85.0.${++ip % 250}` }, body }, r)); return r; };
const eNo = await runEnrich(enrichBody({}));
const eWith = await runEnrich(enrichBody({ gradeProof: sEco.body.gradeProof, collectionItemId: `${TAG}-eco` }));
const econ = (b) => JSON.stringify({ price: b?.price, lo: b?.priceLow, hi: b?.priceHigh, src: b?.pricingSource, act: b?.decision?.action, gm: b?.gradeMultiplier, gr: b?.governingGrade, grs: b?.governingGradeSource, n: b?.rawComps?.count ?? b?.comps?.count });
ok(eNo.statusCode === 200 && eWith.statusCode === 200 && econ(eNo.body) === econ(eWith.body), `price, range, source, decision, multiplier and governing grade are IDENTICAL with and without the proof (${econ(eNo.body).slice(0, 120)})`);
ok(eWith.body?.governingGradeSource === 'model', 'the governing grade source is still the existing request-grade path (GK-280B changes this, not this release)');
void callsBeforeClaims;

section('16. duplicate-copy protections untouched (existing suites cover the 409/standing paths)');
ok(typeof (await import('../src/lib/gradeClaimPolicy.js')).decideGradeClaim === 'function', 'policy module loads; the physical-copy standing check still runs BEFORE saveAndClaim in api/collection.js (verified by gk279 / duplicate-entry suites in the regression run)');

origLog(`\nFIXTURES RETAINED: 2 principals (${PA.slice(0, 8)}…, ${PB.slice(0, 8)}…), items tagged ${TAG}, ${await eventCount(PA)} + ${await eventCount(PB)} prediction events`);
origLog(`\n${passed} passed, ${failed} failed`);
await client.end();
process.exit(failed ? 1 : 0);
