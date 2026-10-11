// GK-281 — ONE LOGICAL SCAN ATTEMPT -> AT MOST ONE PAID GRADING WORKFLOW.
// REAL api/grade.js + api/collection.js handlers, REAL Development Postgres (throwaway principals, rows RETAINED per the
// append-only convention), REAL attempt state machine (src/lib/gradeAttempt.js). Mocked: global fetch (Anthropic / eBay /
// ComicVine / PriceCharting transport) with a PROVIDER-CALL COUNTER, and the Upstash store (in-memory, same contract) wrapped
// in deterministic FAULT INJECTION. NO paid call, NO Production access, NO schema change.
//
//   node tests/gk281-grade-attempt-idempotency.test.js

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
delete process.env.GRADE_ATTEMPT_ENFORCEMENT;
delete process.env.SPEND_GUARD_PRINCIPAL_DAILY_UNITS;

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
const origLog = console.log, origErr = console.error;
const quiet = async (fn) => { console.log = () => {}; console.error = () => {}; try { return await fn(); } finally { console.log = origLog; console.error = origErr; } };
const section = (t) => origLog(`\n-- ${t} --`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
const { verifyGradeProof } = receiptLib;
const { sha256Hex } = await import('../src/modules/learning/index.js');
const A = await import('../src/lib/gradeAttempt.js');
const { principalDayKey } = await import('../src/lib/spendGuard.js');

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const VISION = { title: 'Creepy', issue: '1', publisher: 'Warren', year: '1964', assetTypeConfident: true, foreignEdition: false, isReprint: false, editionType: 'original', grade: 'VG 4.0', isGraded: false, numericGrade: null, certNumber: null, labelType: null, labelNotes: null, keyIssue: null, variant: null, creator: null, price: '$20', priceLow: '$10', priceHigh: '$30', reason: 'Light spine wear.', confidence: 'medium', detectedPrice: null, restoration: null, defectPenalty: null, cgcPenaltyFlags: null };
const LOWCONF = { ...VISION, title: 'Unknown', confidence: 'low' };
const BOOKISH = { ...VISION, title: 'The Rationalists Author', issue: null, reason: 'ISBN on the back; published by a university press.', confidence: 'medium' };
const BOOK = { title: 'The Rationalists', author: 'A. Writer', assetType: 'book', grade: 'Very Good', isGraded: false, confidence: 'medium', reason: 'Book.', publisher: 'Press', year: '2020' };

// ───── provider stub with a call counter and a scripted behavior ─────
let anthropicCalls = 0;
const models = [];
let behavior = () => ({ kind: 'ok', vision: VISION });
let delayMs = 0;
let imageSearchItems = []; // non-empty => the eBay-first (Haiku grade-only) branch the Production incident used
const ebayItem = (title, i) => ({
  itemId: `v1|g281${i}|0`, title, leafCategoryIds: ['259104'], categories: [{ categoryId: '259104', categoryName: 'Comics & Graphic Novels' }],
  image: { imageUrl: 'https://i.ebayimg.com/images/g/fake/s-l225.jpg' }, price: { value: '80', currency: 'USD' },
  itemHref: `https://api.ebay.com/buy/browse/v1/item/v1%7Cg281${i}%7C0`, seller: { username: `s${i}`, feedbackPercentage: '99.9', feedbackScore: 1000 },
  condition: 'Used', conditionId: '3000', thumbnailImages: [{ imageUrl: 'https://i.ebayimg.com/images/g/fake/s-l1600.jpg' }], buyingOptions: ['FIXED_PRICE'],
  itemWebUrl: `https://www.ebay.com/itm/g281${i}`, itemLocation: { postalCode: '000**', country: 'US' }, legacyItemId: `g281${i}`, adultOnly: false,
  itemOriginDate: '2026-04-06T14:26:54.000Z', itemCreationDate: '2026-04-06T14:26:54.000Z', listingMarketplaceId: 'EBAY_US',
});
global.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('oauth2/token') || u.includes('/oauth/')) return json({ access_token: 'x', expires_in: 7200, token_type: 'Application Access Token' });
  if (u.includes('search_by_image')) return json({ itemSummaries: imageSearchItems, total: imageSearchItems.length });
  if (u.includes('item_summary/search')) return json({ itemSummaries: [], total: 0 });
  // The cost/cache AUDIT's token-count request is a free, non-generating Anthropic endpoint: it is not a paid grading call.
  if (u.includes('/messages/count_tokens')) return json({ input_tokens: 100 });
  if (u.includes('api.anthropic.com')) {
    anthropicCalls += 1;
    let model = 'unknown'; try { model = JSON.parse(init.body).model; } catch { /* */ }
    models.push(model);
    if (delayMs) await sleep(delayMs);
    const b = behavior({ model, n: anthropicCalls });
    if (b.kind === 'throw') throw new TypeError('fetch failed');
    if (b.kind === 'http') return json({ type: 'error', error: { type: 'invalid_request_error', message: 'bad' } }, b.status);
    return json({ id: 'm', type: 'message', role: 'assistant', model, content: [{ type: 'text', text: JSON.stringify(b.vision) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } });
  }
  return json({});
};
const mkRes = () => { const r = { statusCode: null, body: null, headers: {} }; r.status = (c) => { r.statusCode = c; return r; }; r.json = (d) => { r.body = d; return r; }; r.setHeader = (k, v) => { r.headers[k] = v; }; return r; };

// ───── attempt/spend store: in-memory, same contract, WITH fault injection ─────
const rs = await import('../src/lib/researchStore.js');
const base = rs.createMemoryResearchStore();
let setFault = null, getFault = false, nonAtomicSetNx = false;
const store = {
  ...base,
  get: async (k) => { if (getFault) throw new rs.ResearchStoreUnavailableError('injected get fault'); return base.get(k); },
  set: async (k, v, t) => { if (setFault && setFault(k, v)) throw new rs.ResearchStoreUnavailableError('injected set fault'); return base.set(k, v, t); },
  setNx: async (k, v, t) => { if (nonAtomicSetNx && k.startsWith('ga:v1:')) { await base.set(k, v, t); return true; } return base.setNx(k, v, t); }, // MUTANT: removes the atomic claim
};
rs.setResearchStoreForTests(store);
const { default: gradeHandler } = await import('../api/grade.js');
const { default: collectionHandler } = await import('../api/collection.js');
const { default: Jimp } = await import('jimp');
let colorSeed = 0x21324354;
const nextPng = async () => (await new Jimp(64, 64, (colorSeed = (colorSeed + 0x01010101) >>> 0) | 0xff).getBufferAsync(Jimp.MIME_PNG)).toString('base64');

const client = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
const marker = (await client.query('SELECT app_env FROM data1_dev.environment_marker')).rows;
if (marker.length !== 1 || marker[0].app_env !== 'development') { origLog('REFUSING TO RUN: environment_marker is not development'); process.exit(2); }

const TAG = `gk281-${Date.now()}`;
const PA = randomUUID(), PB = randomUUID();
for (const [id, n] of [[PA, 'A'], [PB, 'B']]) await client.query(`INSERT INTO data1_dev.gk_principal (id, display_name, kind) VALUES ($1,$2,'user')`, [id, `${TAG}-${n}`]);
const tokA = mintToken(PA), tokB = mintToken(PB);
let ip = 0;
const grade = async (tok, body) => {
  const r = mkRes();
  await quiet(() => gradeHandler({ method: 'POST', headers: { authorization: `Bearer ${tok}`, 'x-forwarded-for': `10.81.${Date.now() % 250}.${++ip % 250}` }, body }, r));
  return r;
};
const coll = async (tok, method, body) => { const r = mkRes(); await quiet(() => collectionHandler({ method, headers: { authorization: `Bearer ${tok}`, 'x-forwarded-for': `10.84.${Date.now() % 250}.${++ip % 250}` }, query: {}, body }, r)); return r; };
const newAttemptId = () => randomUUID();
const eventsFor = async (principal, attemptId) => (await client.query(`SELECT surface, count(*)::int n FROM data1_dev.model_prediction_event WHERE principal_id=$1 AND result_id=$2 GROUP BY surface ORDER BY surface`, [principal, A.deriveResultId(principal, attemptId)])).rows.reduce((o, r) => ({ ...o, [r.surface]: r.n }), {});
const allGradeEvents = async (principal) => Number((await client.query(`SELECT count(*)::int n FROM data1_dev.model_prediction_event WHERE principal_id=$1 AND surface='GRADE'`, [principal])).rows[0].n);
const spent = async (p) => (await base.get(principalDayKey(p))) || 0;
const rec = async (p, a, g = 0) => base.get(A.attemptKey(p, a, g));
const expireLease = async (p, a, g = 0) => { const r = await base.get(A.attemptKey(p, a, g)); r.leaseUntil = Date.now() - 1; await base.set(A.attemptKey(p, a, g), r, 3600); };

origLog(`\n=== GK-281 grade-attempt idempotency (database marker=development) ===`);

section('0. static: lease derives from the real maxDuration; ids and fingerprints');
const vercelCfg = JSON.parse(readFileSync(path.join(repoRoot, 'vercel.json'), 'utf8'));
ok(A.GRADE_FUNCTION_MAX_DURATION_MS === vercelCfg.functions['api/grade.js'].maxDuration * 1000, 'GRADE_FUNCTION_MAX_DURATION_MS mirrors vercel.json functions["api/grade.js"].maxDuration');
ok(A.LEASE_MS > A.GRADE_FUNCTION_MAX_DURATION_MS, 'the lease strictly exceeds the platform kill time (owner provably dead at expiry)');
ok(A.deriveResultId(PA, 'abc-attempt-0000001') === A.deriveResultId(PA, 'abc-attempt-0000001') && A.deriveResultId(PA, 'abc-attempt-0000001') !== A.deriveResultId(PB, 'abc-attempt-0000001') && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(A.deriveResultId(PA, 'abc-attempt-0000001')), 'result id is deterministic, principal-scoped and uuid-shaped');
ok(A.computeAttemptFingerprint({ workflow: 'standard', images: ['a', 'b'] }) !== A.computeAttemptFingerprint({ workflow: 'standard', images: ['a'] }), 'the fingerprint covers EVERY image, not just the first');
ok(A.computeAttemptFingerprint({ workflow: 'standard', images: ['a'] }) !== A.computeAttemptFingerprint({ workflow: 'watch', images: ['a'] }), 'the fingerprint binds the workflow type');

section('1. standard scan under an attempt: one workflow, one event, 3 spend units');
const img1 = await nextPng();
const at1 = newAttemptId();
const c0 = anthropicCalls, s0 = await spent(PA);
const r1 = await grade(tokA, { images: [img1], attemptId: at1, scanId: 's1' });
ok(r1.statusCode === 200 && r1.body.title === 'Creepy' && typeof r1.body.gradeProof === 'string', 'scan succeeds with a grade proof');
ok(anthropicCalls - c0 === 1, `exactly ONE provider call (got ${anthropicCalls - c0})`);
ok((await spent(PA)) - s0 === 3, 'exactly one grade reservation (3 units)');
const ev1 = await eventsFor(PA, at1);
ok(ev1.GRADE === 1 && ev1.IDENTITY === 1, `one GRADE and one IDENTITY event under the deterministic result id (${JSON.stringify(ev1)})`);
const rec1 = await rec(PA, at1);
ok(rec1.state === 'COMPLETED' && rec1.result && !rec1.checkpoint && rec1.gen === 0, 'attempt record is COMPLETED with the replayable result and no checkpoint left');
const claims1 = A && verifyGradeProof(r1.body.gradeProof);
ok(claims1.ok && claims1.claims.r === A.deriveResultId(PA, at1), 'the proof binds the deterministic result id');

section('2/3/15/16. sequential retry and RESPONSE LOSS after durable completion: replay only');
const c2 = anthropicCalls, s2 = await spent(PA), e2 = await allGradeEvents(PA);
const r2 = await grade(tokA, { images: [img1], attemptId: at1, scanId: 's1-retry' });
ok(r2.statusCode === 200 && r2.headers['x-grade-attempt'] === 'replay' && r2.body.attemptReplay === true, 'replayed (header + additive flag)');
ok(r2.body.gradeProof === r1.body.gradeProof && r2.body.title === r1.body.title && r2.body.grade === r1.body.grade, 'the SAME grade proof and original model result are returned');
ok(r2.body.scanId === 's1-retry', 'the replay echoes THIS request\'s scanId (ownership guard stays correct)');
ok(anthropicCalls === c2, 'zero additional provider calls');
ok((await spent(PA)) === s2, 'zero additional spend units reserved');
ok((await allGradeEvents(PA)) === e2, 'no second prediction event');

section('4/6. concurrent identical requests and rapid double submission: one workflow');
delayMs = 250;
const img4 = await nextPng(), at4 = newAttemptId();
const c4 = anthropicCalls, s4 = await spent(PA);
const burst = await Promise.all([1, 2, 3, 4, 5].map((i) => grade(tokA, { images: [img4], attemptId: at4, scanId: `b${i}` })));
delayMs = 0;
const winners = burst.filter((r) => r.statusCode === 200 && !r.body.attemptReplay);
const waiters = burst.filter((r) => r.statusCode === 409 && r.body.error === 'GRADE_ATTEMPT_IN_PROGRESS');
ok(winners.length === 1, `exactly one request ran the workflow (${winners.length})`);
ok(winners.length + waiters.length + burst.filter((r) => r.body?.attemptReplay).length === 5, 'every other request was told to wait (409 IN_PROGRESS) or replayed');
ok(anthropicCalls - c4 === 1, `one provider call for five concurrent requests (${anthropicCalls - c4})`);
ok((await spent(PA)) - s4 === 3, 'one spend reservation for five concurrent requests');
ok((await eventsFor(PA, at4)).GRADE === 1, 'one GRADE event');
ok(waiters.every((r) => r.headers['retry-after']), 'in-flight responses carry retry-after');
const after4 = await grade(tokA, { images: [img4], attemptId: at4 });
ok(after4.statusCode === 200 && after4.body.attemptReplay === true, 'a later request for the same attempt replays');

section('4b. MUTATION: removing the atomic claim makes the SAME scenario fail (the test is sensitive)');
nonAtomicSetNx = true; delayMs = 250;
const img4m = await nextPng(), at4m = newAttemptId();
const c4m = anthropicCalls;
await Promise.all([1, 2, 3].map((i) => grade(tokA, { images: [img4m], attemptId: at4m, scanId: `m${i}` })));
nonAtomicSetNx = false; delayMs = 0;
ok(anthropicCalls - c4m > 1, `with a NON-atomic claim, duplicate paid workflows occur (${anthropicCalls - c4m} provider calls) — proves the claim is what prevents them`);

section('5. same attemptId, different input: refused, nothing mutated');
const c5 = anthropicCalls, s5 = await spent(PA);
const img5 = await nextPng();
const m1 = await grade(tokA, { images: [img5], attemptId: at1 });
ok(m1.statusCode === 409 && m1.body.error === 'GRADE_ATTEMPT_INPUT_MISMATCH', 'different photo under a used attemptId: 409 INPUT_MISMATCH');
const m2 = await grade(tokA, { images: [img1], attemptId: at1, voiceContext: 'new context' });
ok(m2.statusCode === 409 && m2.body.error === 'GRADE_ATTEMPT_INPUT_MISMATCH', 'different workflow parameters (voice context): 409 INPUT_MISMATCH');
const m3 = await grade(tokA, { images: [img1, img5], attemptId: at1 });
ok(m3.statusCode === 409, 'an additional image changes the fingerprint (every image is bound)');
ok(anthropicCalls === c5 && (await spent(PA)) === s5, 'no provider call, no spend');
ok((await rec(PA, at1)).state === 'COMPLETED', 'the original attempt is untouched');

section('7. deliberate re-grade: SAME image, NEW attemptId is allowed (a second workflow)');
const c7 = anthropicCalls, e7 = await allGradeEvents(PA);
const at7 = newAttemptId();
const r7 = await grade(tokA, { images: [img1], attemptId: at7, predictionKind: 'RE_GRADE' });
ok(r7.statusCode === 200 && !r7.body.attemptReplay && anthropicCalls - c7 === 1, 'a new attempt for identical bytes runs a new paid workflow');
ok((await allGradeEvents(PA)) === e7 + 1 && (await eventsFor(PA, at1)).GRADE === 1, 'a new immutable event is appended; the first attempt\'s event is unchanged');

section('8. failure BEFORE invocation is safely retryable under the same attempt');
process.env.SPEND_GUARD_PRINCIPAL_DAILY_UNITS = '0';
const img8 = await nextPng(), at8 = newAttemptId();
const c8 = anthropicCalls;
const f8 = await grade(tokA, { images: [img8], attemptId: at8 });
ok(f8.statusCode === 429 && anthropicCalls === c8, 'spend refusal: 429 and no provider call');
ok((await rec(PA, at8)).state === 'FAILED_BEFORE_INVOCATION', 'the attempt is marked FAILED_BEFORE_INVOCATION');
delete process.env.SPEND_GUARD_PRINCIPAL_DAILY_UNITS;
const f8b = await grade(tokA, { images: [img8], attemptId: at8 });
ok(f8b.statusCode === 200 && anthropicCalls - c8 === 1 && (await rec(PA, at8, 1)).state === 'COMPLETED', 'retry under the SAME attempt proceeds on the next generation and completes once');
// store write failure at the IN_PROGRESS boundary: the call is NEVER made
const img8c = await nextPng(), at8c = newAttemptId();
const c8c = anthropicCalls;
setFault = (k, v) => k.startsWith('ga:v1:') && v?.state === 'IN_PROGRESS';
const f8c = await grade(tokA, { images: [img8c], attemptId: at8c });
setFault = null;
ok(f8c.statusCode === 503 && f8c.body.error === 'GRADE_ATTEMPT_UNAVAILABLE' && anthropicCalls === c8c, 'cannot record IN_PROGRESS => 503 and the provider is never called');
const f8d = await grade(tokA, { images: [img8c], attemptId: at8c });
ok(f8d.statusCode === 200 && anthropicCalls - c8c === 1, 'retry succeeds after the store recovers');
// definitive provider rejection (HTTP 400, no earlier completed call) is unbilled => retryable
const img8e = await nextPng(), at8e = newAttemptId();
const c8e = anthropicCalls;
behavior = () => ({ kind: 'http', status: 400 });
const f8e = await grade(tokA, { images: [img8e], attemptId: at8e });
behavior = () => ({ kind: 'ok', vision: VISION });
ok(f8e.statusCode === 500 && (await rec(PA, at8e)).state === 'FAILED_BEFORE_INVOCATION' && (await rec(PA, at8e)).failure === 'PROVIDER_REJECTED', 'a definitive provider rejection is recorded as unbilled');
const f8f = await grade(tokA, { images: [img8e], attemptId: at8e });
ok(f8f.statusCode === 200 && anthropicCalls - c8e === 2 && (await eventsFor(PA, at8e)).GRADE === 1, 'it can be retried; exactly one event results');

section('9/11. UNCERTAIN provider outcome: no automatic duplicate invocation; no silent new paid call');
const img9 = await nextPng(), at9 = newAttemptId();
behavior = () => ({ kind: 'throw' });
const u9 = await grade(tokA, { images: [img9], attemptId: at9 });
behavior = () => ({ kind: 'ok', vision: VISION });
ok(u9.statusCode === 500, 'the first request fails (connection lost mid-call)');
ok((await rec(PA, at9)).state === 'UNCERTAIN', 'the attempt is UNCERTAIN (a provider call may have been billed)');
const c9 = anthropicCalls, s9 = await spent(PA);
const u9b = await grade(tokA, { images: [img9], attemptId: at9 });
ok(u9b.statusCode === 409 && u9b.body.error === 'GRADE_ATTEMPT_UNCERTAIN' && u9b.body.requiresOperatorAuthorization === true, 'retry under the same attempt: 409 UNCERTAIN, operator authorization required');
ok(anthropicCalls === c9 && (await spent(PA)) === s9, 'NO provider call and NO spend reserved by the retry');
ok(u9b.body.durableEventFound === false && !Object.keys(await eventsFor(PA, at9)).length, 'nothing durable survives; reported honestly');
const u9c = await grade(tokA, { images: [img9], attemptId: newAttemptId() });
ok(u9c.statusCode === 200 && anthropicCalls - c9 === 1, 'only an explicit NEW attempt (operator authorization) pays again');
// an expired IN_PROGRESS is also UNCERTAIN — a lease expiry NEVER authorizes a second workflow
const img9d = await nextPng(), at9d = newAttemptId();
const own = await A.claimAttempt({ principalId: PA, attemptId: at9d, fingerprint: A.computeAttemptFingerprint({ workflow: 'standard', images: [img9d] }), store });
await own.handle.beginInvocation(); // the owner "dies" here: provider may have been invoked
await expireLease(PA, at9d);
const c9d = anthropicCalls;
const u9d = await grade(tokA, { images: [img9d], attemptId: at9d });
ok(u9d.statusCode === 409 && u9d.body.error === 'GRADE_ATTEMPT_UNCERTAIN' && anthropicCalls === c9d, 'stale IN_PROGRESS after lease expiry => UNCERTAIN, never a new paid workflow');
// a stale PENDING is provably unbilled (owner killed before the IN_PROGRESS write) => the next generation proceeds
const img9e = await nextPng(), at9e = newAttemptId();
await A.claimAttempt({ principalId: PA, attemptId: at9e, fingerprint: A.computeAttemptFingerprint({ workflow: 'standard', images: [img9e] }), store }); // claimed, then the owner dies
const live = await grade(tokA, { images: [img9e], attemptId: at9e });
ok(live.statusCode === 409 && live.body.error === 'GRADE_ATTEMPT_IN_PROGRESS', 'a live PENDING lease blocks a second workflow');
await expireLease(PA, at9e);
const stale = await grade(tokA, { images: [img9e], attemptId: at9e });
ok(stale.statusCode === 200 && (await rec(PA, at9e, 0)).state === 'FAILED_BEFORE_INVOCATION' && (await rec(PA, at9e, 1)).state === 'COMPLETED', 'a lease-expired PENDING is failed-before-invocation and the next generation completes');

// malformed / unknown records are never a licence to bill again
const img9f = await nextPng(), at9f = newAttemptId();
await base.set(A.attemptKey(PA, at9f, 0), { v: 1, principalId: PA, attemptId: at9f, gen: 0, fingerprint: A.computeAttemptFingerprint({ workflow: 'standard', images: [img9f] }), workflow: 'standard', state: 'COMPLETED' }, 3600); // COMPLETED but no result
const c9f = anthropicCalls;
const u9f = await grade(tokA, { images: [img9f], attemptId: at9f });
ok(u9f.statusCode === 409 && u9f.body.error === 'GRADE_ATTEMPT_UNCERTAIN' && anthropicCalls === c9f, 'a COMPLETED record with no stored result is UNCERTAIN, never a new paid workflow');
const at9g = newAttemptId(), img9g = await nextPng();
await base.set(A.attemptKey(PA, at9g, 0), { v: 1, principalId: PA, attemptId: at9g, gen: 0, fingerprint: A.computeAttemptFingerprint({ workflow: 'standard', images: [img9g] }), workflow: 'standard', state: 'SOMETHING_NEW' }, 3600);
const u9g = await grade(tokA, { images: [img9g], attemptId: at9g });
ok(u9g.statusCode === 409 && u9g.body.error === 'GRADE_ATTEMPT_UNCERTAIN' && anthropicCalls === c9f, 'an unknown record state fails safe (UNCERTAIN)');

section('10. UNCERTAIN with a durable event: operator resume replays it (zero provider calls, zero spend, one event)');
const img10 = await nextPng(), at10 = newAttemptId();
setFault = (k, v) => k.startsWith('ga:v1:') && v?.state === 'COMPLETED';
const c10 = anthropicCalls;
const o10 = await grade(tokA, { images: [img10], attemptId: at10 });
setFault = null;
ok(o10.statusCode === 200 && anthropicCalls - c10 === 1, 'the operator got the result, but COMPLETED could not be recorded (crash window after the events)');
const r10rec = await rec(PA, at10);
ok(r10rec.state === 'IN_PROGRESS' && r10rec.checkpoint && r10rec.checkpoint.result, 'record is IN_PROGRESS holding the checkpointed result');
const w10 = await grade(tokA, { images: [img10], attemptId: at10 });
ok(w10.statusCode === 409 && w10.body.error === 'GRADE_ATTEMPT_IN_PROGRESS', 'while the lease is live a retry waits');
await expireLease(PA, at10);
const c10b = anthropicCalls, s10 = await spent(PA), e10 = await allGradeEvents(PA);
const v10 = await grade(tokA, { images: [img10], attemptId: at10 });
ok(v10.statusCode === 200 && v10.headers['x-grade-attempt'] === 'recovered' && v10.body.attemptReplay === true, 'resume returns the original result flagged recovered');
ok(v10.body.title === o10.body.title && v10.body.grade === o10.body.grade, 'the original model result is unchanged');
ok(anthropicCalls === c10b && (await spent(PA)) === s10 && (await allGradeEvents(PA)) === e10, 'zero provider calls, zero spend, no second prediction event');
const p10a = verifyGradeProof(o10.body.gradeProof).claims, p10b = verifyGradeProof(v10.body.gradeProof).claims;
ok(p10a.e === p10b.e && p10a.r === p10b.r, 'the recovered proof names the SAME prediction event and result id');
ok((await rec(PA, at10)).state === 'COMPLETED' && (await rec(PA, at10)).recovered === true && !(await rec(PA, at10)).checkpoint, 'the attempt is now COMPLETED (recovered)');
const v10b = await grade(tokA, { images: [img10], attemptId: at10 });
ok(v10b.statusCode === 200 && v10b.headers['x-grade-attempt'] === 'replay', 'after recovery it is an ordinary replay');

section('12. Watch Mode: legitimate multi-pass escalation under ONE attempt');
behavior = ({ model }) => (model.includes('opus') ? { kind: 'ok', vision: VISION } : { kind: 'ok', vision: LOWCONF });
const img12 = await nextPng(), at12 = newAttemptId();
const c12 = anthropicCalls, s12 = await spent(PA); models.length = 0;
const w12 = await grade(tokA, { images: [img12], source: 'watch', attemptId: at12 });
behavior = () => ({ kind: 'ok', vision: VISION });
ok(w12.statusCode === 200 && w12.headers['x-watch-passes'] === '3' && anthropicCalls - c12 === 3, `three passes (Haiku, Haiku, Opus) are ONE workflow (${anthropicCalls - c12} calls, passes=${w12.headers['x-watch-passes']})`);
ok(models.filter((m) => m.includes('haiku')).length === 2 && models.filter((m) => m.includes('opus')).length === 1, 'pass sequence is Haiku, Haiku, Opus');
ok((await spent(PA)) - s12 === 1, 'Watch is accounted as one grade-watch reservation (1 unit)');
ok((await eventsFor(PA, at12)).GRADE === 1, 'one GRADE event for the accepted pass');
const c12b = anthropicCalls;
const w12r = await grade(tokA, { images: [img12], source: 'watch', attemptId: at12 });
ok(w12r.statusCode === 200 && w12r.body.attemptReplay === true && anthropicCalls === c12b, 'replay of a Watch attempt makes zero provider calls');
const w12x = await grade(tokA, { images: [img12], attemptId: at12 });
ok(w12x.statusCode === 409, 'the workflow type is bound: the same attemptId cannot be reused as a standard scan');

section('13. voice-context and book workflows: the existing multi-call sequence belongs to one attempt');
const img13 = await nextPng(), at13 = newAttemptId();
const c13 = anthropicCalls, s13 = await spent(PA);
const v13 = await grade(tokA, { images: [img13], voiceContext: 'seller says near mint', attemptId: at13 });
ok(v13.statusCode === 200 && anthropicCalls - c13 === 2 && (await spent(PA)) - s13 === 3, `voice context => two provider calls under one reservation (${anthropicCalls - c13} calls, ${(await spent(PA)) - s13} units)`);
ok((await eventsFor(PA, at13)).GRADE === 1, 'still one GRADE event');
const c13b = anthropicCalls;
await grade(tokA, { images: [img13], voiceContext: 'seller says near mint', attemptId: at13 });
ok(anthropicCalls === c13b, 'its replay makes zero calls');
let bookSeq = 0; behavior = () => ({ kind: 'ok', vision: (bookSeq++ === 0 ? BOOKISH : BOOK) });
const img13b = await nextPng(), at13b = newAttemptId();
const c13c = anthropicCalls;
const bk = await grade(tokA, { images: [img13b], attemptId: at13b });
behavior = () => ({ kind: 'ok', vision: VISION });
ok(bk.statusCode === 200 && anthropicCalls - c13c === 2 && bk.body.assetType === 'book', `book detection => the initial and BOOK_PROMPT calls are one workflow (${anthropicCalls - c13c} calls)`);

section('14. bulk import: one attempt per file; retry with the original ids replays; a new import is new attempts');
const files = [await nextPng(), await nextPng(), await nextPng()];
const ids = files.map(() => newAttemptId());
const cb = anthropicCalls, sb = await spent(PA);
const first = [];
for (let i = 0; i < 3; i++) first.push(await grade(tokA, { images: [files[i]], attemptId: ids[i] }));
ok(first.every((r) => r.statusCode === 200) && anthropicCalls - cb === 3 && (await spent(PA)) - sb === 9, `three files => three distinct workflows (${anthropicCalls - cb} calls, ${(await spent(PA)) - sb} units)`);
const cb2 = anthropicCalls, sb2 = await spent(PA);
const again = [];
for (let i = 0; i < 3; i++) again.push(await grade(tokA, { images: [files[i]], attemptId: ids[i] }));
ok(again.every((r) => r.body.attemptReplay === true) && anthropicCalls === cb2 && (await spent(PA)) === sb2, 'retrying the batch with the ORIGINAL attemptIds replays all three: no paid calls, no spend');
const fresh = [];
for (let i = 0; i < 3; i++) fresh.push(await grade(tokA, { images: [files[i]], attemptId: newAttemptId() }));
ok(fresh.every((r) => !r.body.attemptReplay) && anthropicCalls - cb2 === 3, 'a NEWLY initiated import of identical files uses new attemptIds => new workflows (bytes alone are not identity)');

section('17. GK-280A authority is preserved: the replayed proof associates exactly once');
const img17 = await nextPng(), at17 = newAttemptId();
const g17 = await grade(tokA, { images: [img17], attemptId: at17 });
const g17r = await grade(tokA, { images: [img17], attemptId: at17 });
const hash17 = 'sha256:' + sha256Hex(img17);
const item17 = `${TAG}-i17`;
const cr = await coll(tokA, 'POST', { id: item17, assetCategory: 'comic', attributes: { title: 'Creepy', issue: '1', grade: 'VG 4.0' }, gradeProof: g17r.body.gradeProof, gradeInputHash: hash17 });
ok(cr.body?.gradeClaim?.status === 'ASSOCIATED', 'the REPLAYED proof is claimed into a new item (ASSOCIATED)');
const ptr = (await client.query(`SELECT attributes->'currentGradePrediction' p FROM data1_dev.collection_item WHERE principal_id=$1 AND id=$2`, [PA, item17])).rows[0].p;
const evRow = (await client.query(`SELECT id, result_id FROM data1_dev.model_prediction_event WHERE principal_id=$1 AND surface='GRADE' AND result_id=$2`, [PA, A.deriveResultId(PA, at17)])).rows;
ok(evRow.length === 1 && ptr.predictionEventId === evRow[0].id, 'the pointer names the attempt\'s single immutable event');
ok(g17.body.gradeProof === g17r.body.gradeProof, 'original and replayed proofs are identical');
const cr2 = await coll(tokA, 'POST', { id: `${TAG}-i17b`, assetCategory: 'comic', attributes: { title: 'Creepy', issue: '1', grade: 'VG 4.0' }, gradeProof: g17.body.gradeProof, gradeInputHash: hash17 });
ok(cr2.body?.gradeClaim?.status === 'REFUSED', 'one event, one item: the same proof cannot associate a second item');

section('18. isolation and leakage');
const c18 = anthropicCalls;
const iso = await grade(tokB, { images: [img1], attemptId: at1 });
ok(iso.statusCode === 200 && !iso.body.attemptReplay && anthropicCalls - c18 === 1, 'principal B using principal A\'s attemptId gets its OWN workflow, never A\'s result');
ok((await rec(PA, at1)).result.title === 'Creepy' && !!(await rec(PB, at1)), 'records are principal-scoped');
const leaky = JSON.stringify([m1.body, u9b.body, w10.body, f8c.body, live.body]);
ok(!leaky.includes('gp1.') && !leaky.includes(PA) && !leaky.includes(process.env.GRAILKEY_SESSION_SECRET), 'refusal/wait bodies carry no proof, receipt, principal id or secret');
const stored = JSON.stringify(await rec(PA, at1));
ok(!stored.includes(img1.slice(0, 200)) && !stored.includes(process.env.GRAILKEY_SESSION_SECRET) && stored.length < 20000, 'the stored attempt record holds no image bytes or secret and is small');
const replayBody = JSON.stringify(r2.body);
ok(!/"_[A-Za-z]+"\s*:/.test(replayBody), 'no client-marker fields appear in a replay');

section('19. legacy requests, enforcement switch, bad ids, store outage');
const c19 = anthropicCalls;
const lg = await grade(tokA, { images: [await nextPng()] });
ok(lg.statusCode === 200 && anthropicCalls - c19 === 1, 'a request with NO attemptId still works (counted bypass during rollout)');
const day = new Date().toISOString().slice(0, 10);
ok((await base.get(`gk:gradeprov:v1:${day}:attempt:legacy_no_attempt:standard:unknown:unknown:unknown`)) >= 1 || Object.keys(base._dump()).some((k) => k.includes(':attempt:legacy_no_attempt:')), 'the bypass is counted, never silent');
process.env.GRADE_ATTEMPT_ENFORCEMENT = 'required';
const c19b = anthropicCalls;
const rq = await grade(tokA, { images: [await nextPng()] });
delete process.env.GRADE_ATTEMPT_ENFORCEMENT;
ok(rq.statusCode === 400 && rq.body.error === 'GRADE_ATTEMPT_REQUIRED' && anthropicCalls === c19b, 'with enforcement=required a request without an attemptId is refused before any paid call');
const bad = await grade(tokA, { images: [await nextPng()], attemptId: 'short' });
ok(bad.statusCode === 400 && bad.body.error === 'GRADE_ATTEMPT_ID_INVALID', 'a malformed attemptId is a 400');
getFault = true;
const c19c = anthropicCalls;
const outage = await grade(tokA, { images: [await nextPng()], attemptId: newAttemptId() });
getFault = false;
ok(outage.statusCode === 503 && outage.body.error === 'GRADE_ATTEMPT_UNAVAILABLE' && anthropicCalls === c19c, 'attempt store outage fails CLOSED before any paid call');

section('20. eBay-first branch (the branch the Production incident used): one grade-only call = one workflow');
imageSearchItems = ['Creepy #1 Warren 1964 VG', 'Creepy 1 Warren Magazine 1964 FN', 'Creepy #1 1964 Warren Publishing GD', 'Creepy #1 (1964) VG+', 'Creepy #1 Warren 1964'].map((t, i) => ebayItem(t, i));
const img20 = await nextPng(), at20 = newAttemptId();
models.length = 0;
const c20 = anthropicCalls, s20 = await spent(PA);
const e20 = await grade(tokA, { images: [img20], attemptId: at20 });
const branch20 = (await client.query(`SELECT prediction->'evidence'->>'branch' b FROM data1_dev.model_prediction_event WHERE principal_id=$1 AND surface='GRADE' AND result_id=$2`, [PA, A.deriveResultId(PA, at20)])).rows[0]?.b;
ok(e20.statusCode === 200 && branch20 === 'HAIKU_EBAY_CONSENSUS', `the eBay-consensus branch ran (event branch=${branch20})`);
ok(anthropicCalls - c20 === 1 && models.length === 1 && models[0].includes('haiku') && (await spent(PA)) - s20 === 3, 'exactly one Haiku grade-only call and one 3-unit reservation');
const c20b = anthropicCalls, s20b = await spent(PA);
const e20r = await grade(tokA, { images: [img20], attemptId: at20 });
ok(e20r.body.attemptReplay === true && e20r.body.gradeProof === e20.body.gradeProof && anthropicCalls === c20b && (await spent(PA)) === s20b, 'its replay: same proof, zero calls, zero spend');
imageSearchItems = [];

origLog(`\n${passed} passed, ${failed} failed`);
await client.end();
process.exit(failed ? 1 : 0);
