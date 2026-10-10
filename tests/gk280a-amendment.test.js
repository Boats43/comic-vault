// GK-280A FINAL CERTIFICATION AMENDMENT — transactional races, refusal observability, client acknowledgment,
// day-31 held-copy behavior. Real Development database (throwaway principals; append-only rows RETAINED),
// REAL api/grade.js + api/collection.js handlers and the REAL client persistence code (fake IndexedDB).
// Mocked: global fetch for model/eBay transport only. NO paid call, NO Production access, NO schema change.
//
//   node tests/gk280a-amendment.test.js

import 'fake-indexeddb/auto';
import './helpers/installBrowserSession.js';
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
delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN;
const REAL_DB_URL = process.env.GRAILKEY_CATALOG_DATABASE_URL;

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
const { sha256Hex, closePool: closeLearningPool } = await import('../src/modules/learning/index.js');
const { saveCollectionItemWithGradeClaim } = await import('../src/modules/collection/index.js');

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let modelCalls = 0;
const VISION = { title: 'Creepy', issue: '1', publisher: 'Warren', year: '1964', assetTypeConfident: true, foreignEdition: false, isReprint: false, editionType: 'original', grade: 'VG 4.0', isGraded: false, numericGrade: null, certNumber: null, labelType: null, labelNotes: null, keyIssue: null, variant: null, creator: null, price: '$20', priceLow: '$10', priceHigh: '$30', reason: 'Light spine wear.', confidence: 'medium', detectedPrice: null, restoration: null, defectPenalty: null, cgcPenaltyFlags: null };
const mkRes = () => { const r = { statusCode: null, body: null, headers: {} }; r.status = (c) => { r.statusCode = c; return r; }; r.json = (d) => { r.body = d; return r; }; r.setHeader = (k, v) => { r.headers[k] = v; }; return r; };
let routeToCollection = null; // set below once the handler is loaded
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith('/api/collection')) return routeToCollection(u, opts);
  if (u.includes('oauth2/token') || u.includes('/oauth/')) return json({ access_token: 'x', expires_in: 7200, token_type: 'Application Access Token' });
  if (u.includes('search_by_image') || u.includes('item_summary/search')) return json({ itemSummaries: [], total: 0 });
  if (u.includes('api.anthropic.com')) { modelCalls += 1; return json({ id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-4-5-20250929', content: [{ type: 'text', text: JSON.stringify(VISION) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } }); }
  if (u.includes('comicvine.gamespot.com')) return json({ results: [], status_code: 1, error: 'OK' });
  if (u.includes('pricecharting.com')) return json({ products: [] });
  return json({});
};
const rs = await import('../src/lib/researchStore.js');
const counters = rs.createMemoryResearchStore(); rs.setResearchStoreForTests(counters);
const { default: gradeHandler } = await import('../api/grade.js');
const { default: collectionHandler } = await import('../api/collection.js');
const { default: Jimp } = await import('jimp');
let seed = 0x21324354;
const nextPng = async () => (await new Jimp(64, 64, ((seed = (seed + 0x01010101) >>> 0) | 0xff)).getBufferAsync(Jimp.MIME_PNG)).toString('base64');

const client = new Client({ connectionString: REAL_DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query('SET search_path TO data1_dev');
const marker = (await client.query('SELECT app_env FROM data1_dev.environment_marker')).rows;
if (marker.length !== 1 || marker[0].app_env !== 'development') { origLog('REFUSING TO RUN: environment_marker is not development'); process.exit(2); }

const TAG = `gk280a-am-${Date.now()}`;
const PA = randomUUID();
await client.query(`INSERT INTO gk_principal (id, display_name, kind) VALUES ($1,$2,'user')`, [PA, `${TAG}-A`]);
const tokA = mintToken(PA);
let ip = 0;
const scan = async ({ target } = {}) => {
  const image = await nextPng();
  const r = mkRes();
  await quiet(() => gradeHandler({ method: 'POST', headers: { authorization: `Bearer ${tokA}`, 'x-forwarded-for': `10.86.${Date.now() % 250}.${++ip % 250}` }, body: { images: [image], ...(target ? { targetItemId: target, predictionKind: 'RE_GRADE' } : {}) } }, r));
  const hash = 'sha256:' + sha256Hex(image);
  const ev = (await client.query('SELECT id, result_id, created_at FROM model_prediction_event WHERE principal_id = $1 AND surface = \x27GRADE\x27 AND input_hash = $2', [PA, hash])).rows[0];
  return { proof: r.body.gradeProof, receipt: r.body.gradeReceiptId, eventId: ev.id, resultId: ev.result_id, createdAtMs: new Date(ev.created_at).getTime() };
};
const coll = async (method, { id, body } = {}) => { const r = mkRes(); await quiet(() => collectionHandler({ method, headers: { authorization: `Bearer ${tokA}`, 'x-forwarded-for': `10.87.${Date.now() % 250}.${++ip % 250}` }, query: id ? { id } : {}, body }, r)); return r; };
routeToCollection = async (u, opts) => {
  const r = mkRes(); const body = opts.body ? JSON.parse(opts.body) : undefined;
  const headers = {}; for (const [k, v] of Object.entries(opts.headers || {})) headers[k.toLowerCase()] = v;
  const m = u.match(/[?&]id=([^&]+)/);
  await quiet(() => collectionHandler({ method: opts.method || 'GET', headers: { ...headers, 'x-forwarded-for': `10.88.${Date.now() % 250}.${++ip % 250}` }, query: m ? { id: decodeURIComponent(m[1]) } : {}, body }, r));
  return new Response(JSON.stringify(r.body), { status: r.statusCode, headers: { 'content-type': 'application/json' } });
};
const baseAttrs = { title: 'Creepy', issue: '1', grade: 'VG 4.0' };
const create = (id, cred, extra = {}) => coll('POST', { body: { id, assetCategory: 'comic', attributes: { ...baseAttrs, ...extra }, ...cred } });
const regrade = (id, cred) => coll('PUT', { id, body: { assetCategory: 'comic', attributes: { ...baseAttrs }, ...cred } });
const attrsOf = async (id) => (await client.query('SELECT attributes FROM collection_item WHERE principal_id = $1 AND id = $2', [PA, id])).rows[0]?.attributes || null;
const dump = () => counters._dump();
const day = new Date().toISOString().slice(0, 10);

origLog('\n=== GK-280A amendment (database marker=development) ===');

section('2A. Race A — two distinct items, one prediction event (10 trials)');
{
  let okTrials = 0, partial = 0;
  for (let t = 0; t < 10; t++) {
    const s = await scan();
    const [x, y] = [`${TAG}-RA${t}-x`, `${TAG}-RA${t}-y`];
    const results = await Promise.all(t % 2 ? [create(x, { gradeProof: s.proof }), create(y, { gradeProof: s.proof })] : [create(y, { gradeProof: s.proof }), create(x, { gradeProof: s.proof })]);
    const statuses = results.map((r) => r.body.gradeClaim.status).sort();
    const ax = await attrsOf(x), ay = await attrsOf(y);
    const winners = [ax, ay].filter((a) => a?.currentGradePrediction?.predictionEventId === s.eventId).length;
    const loser = [ax, ay].find((a) => !a?.currentGradePrediction);
    const bound = Number((await client.query(`SELECT count(*)::int n FROM collection_item WHERE principal_id = $1 AND (attributes->'currentGradePrediction'->>'predictionEventId' = $2 OR attributes->'modelPredictedProvenance'->>'predictionEventId' = $2)`, [PA, s.eventId])).rows[0].n);
    const loserCode = results.map((r) => r.body.gradeClaim).find((c) => c.status === 'REFUSED')?.code;
    if (statuses.join() === 'ASSOCIATED,REFUSED' && winners === 1 && bound === 1 && loserCode === 'GRADE_CLAIM_CROSS_ITEM' && loser && !('modelPredictedGrade' in loser) && ax && ay) okTrials++;
    else partial++;
  }
  ok(okTrials === 10 && partial === 0, `10/10 trials: exactly one ASSOCIATED, one deterministic REFUSED (CROSS_ITEM); event bound to exactly one item; loser saved with NO pointer and NO baseline (${okTrials} ok / ${partial} bad)`);
}

section('2B. Race B — one item, two prediction events (12 trials, both launch orders)');
{
  let okTrials = 0, bad = [];
  for (let t = 0; t < 12; t++) {
    const id = `${TAG}-RB${t}`;
    const s0 = await scan();
    await create(id, { gradeProof: s0.proof });
    const rgOld = await scan({ target: id }), rgNew = await scan({ target: id });
    const calls = t % 2 ? [regrade(id, { gradeProof: rgNew.proof }), regrade(id, { gradeProof: rgOld.proof })] : [regrade(id, { gradeProof: rgOld.proof }), regrade(id, { gradeProof: rgNew.proof })];
    const [r1, r2] = await Promise.all(calls);
    const byProof = t % 2 ? { new: r1, old: r2 } : { old: r1, new: r2 };
    const p = (await attrsOf(id)).currentGradePrediction;
    const hist = p.history;
    const dupFree = new Set(hist).size === hist.length;
    const finalIsNewest = p.predictionEventId === rgNew.eventId;
    const newOk = byProof.new.body.gradeClaim.status === 'ASSOCIATED';
    const oldStatus = byProof.old.body.gradeClaim;
    const histValid = (oldStatus.status === 'ASSOCIATED' && JSON.stringify(hist) === JSON.stringify([s0.eventId, rgOld.eventId]))
                   || (oldStatus.status === 'REFUSED' && oldStatus.code === 'GRADE_CLAIM_STALE_TRANSITION' && JSON.stringify(hist) === JSON.stringify([s0.eventId]));
    if (dupFree && finalIsNewest && newOk && histValid && !hist.includes(rgNew.eventId)) okTrials++; else bad.push({ t, finalIsNewest, newOk, hist: hist.length, old: oldStatus.status + ':' + oldStatus.code });
  }
  ok(okTrials === 12, `12/12 trials: final pointer is ALWAYS the newest event; no stale overwrite; no lost update; history has no duplicate/missing entry for an accepted transition${bad.length ? ' ' + JSON.stringify(bad) : ''}`);
}

section('2B-create. Two fresh proofs racing to CREATE the same item id (8 trials)');
{
  let okTrials = 0, bad = [];
  for (let t = 0; t < 8; t++) {
    const id = `${TAG}-RC${t}`;
    const [s1, s2] = [await scan(), await scan()];
    const [c1, c2] = await Promise.all([create(id, { gradeProof: s1.proof }), create(id, { gradeProof: s2.proof })]);
    const a = await attrsOf(id); const p = a.currentGradePrediction;
    const st = [c1.body.gradeClaim, c2.body.gradeClaim];
    const one = st.filter((c) => c.status === 'ASSOCIATED').length === 1 && st.filter((c) => c.status === 'REFUSED' && c.code === 'GRADE_CLAIM_NOT_NEW_ITEM').length === 1;
    const winnerEvent = st[0].status === 'ASSOCIATED' ? s1.eventId : s2.eventId;
    if (one && p.predictionEventId === winnerEvent && p.history.length === 0) okTrials++; else bad.push({ t, st: st.map((c) => c.status + ':' + c.code), hist: p?.history?.length });
  }
  ok(okTrials === 8, `8/8 trials: one create wins, the other is refused (NOT_NEW_ITEM); the pointer is never overridden and history stays empty${bad.length ? ' ' + JSON.stringify(bad) : ''}`);
}

section('2B-rollback. a failure mid-transaction preserves the previous valid pointer');
{
  const id = `${TAG}-RBK`;
  const s0 = await scan(); await create(id, { gradeProof: s0.proof });
  const before = await client.query('SELECT attributes, updated_at FROM collection_item WHERE principal_id = $1 AND id = $2', [PA, id]);
  const rg = await scan({ target: id });
  let threw = null;
  try {
    await saveCollectionItemWithGradeClaim({ principalId: PA, id, assetCategory: 'comic', attributes: { ...baseAttrs, rollbackMarker: 'must-not-persist' }, mode: 'update',
      claim: { eventId: rg.eventId, resultId: rg.resultId, targetItemId: id, eventCreatedAtMs: rg.createdAtMs, via: 'GRADE_PROOF', baseline: { modelPredictedGrade: 10n } } }); // BigInt: serialization fails AFTER the pointer was set
  } catch (e) { threw = e; }
  const after = await client.query('SELECT attributes, updated_at FROM collection_item WHERE principal_id = $1 AND id = $2', [PA, id]);
  ok(!!threw, 'the injected mid-transaction failure surfaces as an error (nothing swallowed)');
  ok(JSON.stringify(after.rows[0].attributes) === JSON.stringify(before.rows[0].attributes) && +after.rows[0].updated_at === +before.rows[0].updated_at, 'ROLLBACK: attributes (pointer, history, baseline, the attempted edit) and updated_at are byte-identical to before');
  const again = await regrade(id, { gradeProof: rg.proof });
  ok(again.body.gradeClaim.status === 'ASSOCIATED' && (await attrsOf(id)).currentGradePrediction.predictionEventId === rg.eventId, 'locks were released by the rollback: the same transition then succeeds normally');
}

section('3. refusal observability: structured counters (existing infrastructure), bounded reason, no sensitive data');
{
  const key = (o, c) => `gk:gradeprov:v1:${day}:claim:${o}:${c}:unknown:unknown:unknown`;
  const keys = Object.keys(dump()).filter((k) => k.startsWith(`gk:gradeprov:v1:${day}:claim:`));
  const outcomes = new Set(keys.map((k) => k.split(':')[5]));
  ok(['associated', 'already_associated', 'refused'].every((o) => outcomes.has(o)) || ['associated', 'refused'].every((o) => outcomes.has(o)), `claim outcomes are counted (${[...outcomes].join(', ')})`);
  ok(keys.every((k) => k.endsWith(':unknown') && !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(k) && !k.includes(PA)), 'every claim key ends in the neutral predictionKind segment and contains no uuid, principal, grade or title');
  const allowed = new Set(['NONE', 'OTHER', ...['CROSS_ITEM', 'TARGET_MISMATCH', 'NOT_NEW_ITEM', 'TARGET_NOT_EXISTING', 'STALE_TRANSITION', 'PRINCIPAL_MISMATCH', 'INPUT_HASH_MISMATCH', 'EVENT_MISMATCH', 'PROOF_INVALID', 'RECEIPT_INVALID'].map((c) => 'GRADE_CLAIM_' + c)]);
  ok(keys.every((k) => allowed.has(k.split(':')[6])), 'the refusal reason is drawn from the bounded GRADE_CLAIM_* vocabulary only');
  ok(Number(dump()[key('refused', 'GRADE_CLAIM_CROSS_ITEM')]) >= 10 && Number(dump()[key('refused', 'GRADE_CLAIM_STALE_TRANSITION')] ?? 0) >= 0, 'Race A refusals are visible as refused/CROSS_ITEM counts');
  const predRecKeys = () => JSON.stringify(Object.entries(dump()).filter(([k]) => /:(prediction|receipt):/.test(k)).sort());
  const snap = predRecKeys();
  const s = await scan(); const snap2 = predRecKeys();
  for (let i = 0; i < 3; i++) await create(`${TAG}-OBS${i}`, { gradeProof: s.proof }); // 1 associate + 2 refusals, no scans
  ok(predRecKeys() === snap2 && snap2 !== snap, 'claim events add NOTHING to the prediction/receipt counters or their FIRST_GRADE/RE_GRADE denominators (only the scan itself did)');
}

section('3. client acknowledgment (real persistCollectionItem + fake IndexedDB + real server)');
{
  localStorage.setItem('gk_session_token', tokA);
  localStorage.setItem('gk_session_expires_at', String(Date.now() + 3600_000));
  const { persistCollectionItem } = await import('../src/lib/collectionPersistence.js');
  const { getAllComics } = await import('../src/db.js');
  const localOf = async (id) => (await getAllComics()).find((c) => c.id === id);
  const entry = (id, s) => ({ id, timestamp: Date.now(), title: 'Creepy', issue: '1', grade: 'VG 4.0', assetCategory: 'comic', images: [], _gradeProof: s.proof, _gradeReceiptId: s.receipt });

  const s1 = await scan(); const idOk = `${TAG}-CL-ok`;
  await quiet(() => persistCollectionItem(entry(idOk, s1)));
  const l1 = await localOf(idOk);
  ok(l1?._syncStatus === 'synced' && l1._gradeClaimStatus === 'ASSOCIATED' && !l1._gradeProof && !l1._gradeReceiptId, 'ASSOCIATED: local entry synced, claim recorded ASSOCIATED, single-purpose credentials dropped');
  ok((await attrsOf(idOk))?.currentGradePrediction?.predictionEventId === s1.eventId, '…and the server pointer exists');

  const idPre = `${TAG}-CL-pre`;
  await create(idPre, {});
  const s2 = await scan();
  await quiet(() => persistCollectionItem(entry(idPre, s2)));
  const l2 = await localOf(idPre);
  ok(l2?._syncStatus === 'synced' && l2._gradeClaimStatus === 'REFUSED' && l2._gradeClaimCode === 'GRADE_CLAIM_NOT_NEW_ITEM' && !l2._gradeProof, 'REFUSED: the three facts are distinguishable — item persistence succeeded (synced), claim REFUSED (bounded code), credentials dropped');
  ok(!(await attrsOf(idPre))?.currentGradePrediction, '…and the server really has no association (local state matches server state)');
  const markerNotPushed = (await attrsOf(idPre));
  ok(!('_gradeClaimStatus' in markerNotPushed) && !('_gradeClaimCode' in markerNotPushed), 'the local-only markers are never pushed into server attributes');

  const s3 = await scan(); const idUn = `${TAG}-CL-unavail`;
  process.env.GRAILKEY_CATALOG_DATABASE_URL = 'postgres://nobody:none@127.0.0.1:1/none';
  await closeLearningPool(); // the learning module re-reads the (now unreachable) URL: event lookup fails transiently
  const pending = await quiet(() => persistCollectionItem(entry(idUn, s3)));
  process.env.GRAILKEY_CATALOG_DATABASE_URL = REAL_DB_URL;
  await closeLearningPool();
  const l3 = await localOf(idUn);
  ok(l3?._syncStatus === 'pending' && !l3._gradeClaimStatus && l3._gradeProof === s3.proof, 'UNAVAILABLE (server 503): item stays pending, NO claim status recorded, the credential is kept for retry');
  ok(!(await attrsOf(idUn)), '…and nothing was written server-side');
  const toRetry = await localOf(idUn);
  await quiet(() => persistCollectionItem(toRetry));
  const l3b = await localOf(idUn);
  ok(l3b?._syncStatus === 'synced' && l3b._gradeClaimStatus === 'ASSOCIATED' && (await attrsOf(idUn))?.currentGradePrediction?.predictionEventId === s3.eventId, 'the retry then associates the same prediction (nothing stranded by the transient failure)');
  void pending;
  const unavail = Object.keys(dump()).filter((k) => k.includes(':claim:unavailable:'));
  ok(unavail.length === 1 && Number(dump()[unavail[0]]) >= 1, 'the 503 was counted as claim/unavailable');
}

section('4. day-31 held copy: ANOTHER COPY after the 30-day proof lifetime (time-controlled)');
{
  const DAY = 86400 * 1000;
  const s = await scan();
  const evRow = (await client.query('SELECT id, result_id, input_hash FROM model_prediction_event WHERE id = $1 AND principal_id = $2', [s.eventId, PA])).rows[0];
  const proofAt = (ageDays) => issueGradeProof({ principalId: PA, resultId: evRow.result_id, predictionEventId: evRow.id, inputHash: evRow.input_hash, now: Date.now() - ageDays * DAY });
  ok(verifyGradeProof(proofAt(29.9)).ok === true && verifyGradeProof(proofAt(30.1)).reason === 'PROOF_EXPIRED', 'boundary: a proof aged 29.9 days verifies; aged 30.1 days is PROOF_EXPIRED');
  const d29 = await create(`${TAG}-D29`, { gradeProof: proofAt(29.9) });
  ok(d29.body.gradeClaim.status === 'ASSOCIATED', 'day 29.9: ANOTHER COPY associates normally');
  const s31 = await scan();
  const ev31 = (await client.query('SELECT id, result_id, input_hash FROM model_prediction_event WHERE id = $1 AND principal_id = $2', [s31.eventId, PA])).rows[0];
  const p31 = issueGradeProof({ principalId: PA, resultId: ev31.result_id, predictionEventId: ev31.id, inputHash: ev31.input_hash, now: Date.now() - 31 * DAY });
  const d31 = await create(`${TAG}-D31`, { gradeProof: p31, gradeReceiptId: s31.receipt });
  const row31 = await attrsOf(`${TAG}-D31`);
  ok(d31.statusCode === 200 && !!row31, 'day 31: the collection item IS saved (ordinary save semantics)');
  ok(d31.body.gradeClaim.status === 'REFUSED' && d31.body.gradeClaim.code === 'GRADE_CLAIM_PROOF_INVALID', 'day 31: the grade claim is REFUSED, with the bounded PROOF_INVALID code');
  ok(!row31.currentGradePrediction, 'day 31: the server has NO association — it cannot appear claimed');
  ok(!('modelPredictedGrade' in row31), 'day 31: no server baseline was minted either (the still-live legacy receipt did NOT rescue it: an invalid proof refuses the whole credential set)');
  const { persistCollectionItem } = await import('../src/lib/collectionPersistence.js');
  const { getAllComics } = await import('../src/db.js');
  await quiet(() => persistCollectionItem({ id: `${TAG}-D31c`, timestamp: Date.now(), title: 'Creepy', issue: '1', grade: 'VG 4.0', assetCategory: 'comic', images: [], _gradeProof: p31, _gradeReceiptId: s31.receipt }));
  const l31 = (await getAllComics()).find((c) => c.id === `${TAG}-D31c`);
  ok(l31?._syncStatus === 'synced' && l31._gradeClaimStatus === 'REFUSED' && l31._gradeClaimCode === 'GRADE_CLAIM_PROOF_INVALID', 'day 31: the CLIENT detects the refusal (synced + REFUSED marker) — it is never shown as associated');
  const claims = JSON.parse(Buffer.from(p31.split('.')[1], 'base64url').toString('utf8'));
  ok(claims.e === s31.eventId && claims.r === ev31.result_id && claims.h === ev31.input_hash && claims.p === PA, 'the held record keeps the expired proof; its claims still name the immutable event, result and input hash (evidence retained)');
  // Recovery: the refused day-31 item is not stranded. A user-initiated re-grade of THAT item (target = its id) issues a
  // fresh proof and associates through the re-grade rule; the alternative (GK-280B) is operator confirmation with no model call.
  const rec31 = await scan({ target: `${TAG}-D31` });
  const recovered = await regrade(`${TAG}-D31`, { gradeProof: rec31.proof });
  ok(recovered.body.gradeClaim.status === 'ASSOCIATED' && (await attrsOf(`${TAG}-D31`))?.currentGradePrediction?.predictionEventId === rec31.eventId, 'day-31 item is recoverable: a user-initiated re-grade of that item associates safely (one paid call, explicit user action)');
  const refusedKey = Object.keys(dump()).find((k) => k.includes(':claim:refused:GRADE_CLAIM_PROOF_INVALID:'));
  ok(!!refusedKey, 'day-31 refusals are counted (claim/refused/PROOF_INVALID)');
  const apiFiles = (await import('node:fs')).readdirSync(path.join(repoRoot, 'api'));
  const reissue = apiFiles.filter((f) => /reissue|regrade-proof|proof/i.test(f));
  ok(reissue.length === 0, 'there is NO server-side proof re-issuance endpoint today (verified: no api/*proof*/reissue file); expiry was NOT extended as a workaround');
}

origLog(`\nFIXTURES RETAINED: 1 principal (${PA.slice(0, 8)}…), items tagged ${TAG}`);
origLog(`\n${passed} passed, ${failed} failed`);
await client.end();
process.exit(failed ? 1 : 0);
