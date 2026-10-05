// tests/gk278-learning-spine.test.js
//
// GK-278 -- MINIMUM LEARNING SPINE. Real Development database, REAL handlers
// (api/grade.js, api/collection.js, api/enrich.js) and the real modules. Mocked: global
// fetch only (eBay / Anthropic transport) and the receipt store (in-memory stand-in for KV).
//
// GRAILKEY LEARNS FROM HISTORY WITHOUT REWRITING HISTORY.
//   MODEL PREDICTION != OPERATOR LABEL != ADJUDICATED AUTHORITY != REALIZED OUTCOME
//
// The event tables and decision_event are append-only by DB trigger, so this suite's
// events/assets/principals are RETAINED (never deleted); all assertions are scoped to
// this run's own fresh principals/items.
//
// Invoke: node tests/gk278-learning-spine.test.js

import { readFileSync } from 'node:fs';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const line of readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}
process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';
if (!process.env.GRAILKEY_SESSION_SECRET) process.env.GRAILKEY_SESSION_SECRET = randomBytes(32).toString('base64url');
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-anthropic-key-unused';
process.env.EBAY_APP_ID = process.env.EBAY_APP_ID || 'test-app-id';
process.env.EBAY_CERT_ID = process.env.EBAY_CERT_ID || 'test-cert-id';
process.env.PRICECHARTING_TOKEN = process.env.PRICECHARTING_TOKEN || 'test-pc-token';

let passed = 0, failed = 0; const failures = [];
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; failures.push(l); console.log(`  ✗ ${l}`); } };
const eq = (a, b, l) => ok(JSON.stringify(a) === JSON.stringify(b), `${l} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`);
const rejects = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

console.log('\n=== GK-278 -- Minimum Learning Spine (real Development DB + real handlers) ===\n');

const TAG = `gk278-${Date.now()}`;
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

const client = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query('SET search_path TO data1_dev');
const PA = randomUUID(), PB = randomUUID();
for (const [id, n] of [[PA, 'A'], [PB, 'B']]) await client.query(`INSERT INTO gk_principal (id, display_name, kind) VALUES ($1,$2,'user')`, [id, `${TAG}-${n}`]);
const tokA = mintToken(PA), tokB = mintToken(PB);

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let VISION = {
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
    return json({ id: 'msg_t', type: 'message', role: 'assistant', model: 'claude-sonnet-4-5-20250929', content: [{ type: 'text', text: JSON.stringify(VISION) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 123, output_tokens: 45 } });
  }
  if (u.includes('comicvine.gamespot.com')) return json({ results: [], status_code: 1, error: 'OK' });
  if (u.includes('pricecharting.com')) return json({ products: [] });
  return json({});
};
const origLog = console.log;
const quiet = async (fn) => { console.log = () => {}; try { return await fn(); } finally { console.log = origLog; } };
const mkRes = () => { const r = { statusCode: null, body: null }; r.status = (c) => { r.statusCode = c; return r; }; r.json = (d) => { r.body = d; return r; }; r.setHeader = () => {}; return r; };

const { default: gradeHandler } = await import('../api/grade.js');
const { default: collectionHandler } = await import('../api/collection.js');
const { default: enrichHandler } = await import('../api/enrich.js');
const { default: Jimp } = await import('jimp');
const PNG = (await new Jimp(64, 64, 0xff0000ff).getBufferAsync(Jimp.MIME_PNG)).toString('base64');
const learning = await import('../src/modules/learning/index.js');
const collection = await import('../src/modules/collection/index.js');
const assets = await import('../src/modules/assets/index.js');
const mapping = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'capture', 'mapping.js')));
const bridge = await import('../src/lib/outcome1RuntimeBridge.js');
const snap = await import('../src/lib/decisionAuthoritySnapshot.js');

let ip = 0;
const grade = async (token, imgs = [PNG]) => { const r = mkRes(); await quiet(() => gradeHandler({ method: 'POST', headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': `10.78.${Date.now() % 250}.${++ip % 250}` }, body: { images: imgs } }, r)); return r; };
const coll = async (token, method, { id, body } = {}) => { const r = mkRes(); await quiet(() => collectionHandler({ method, headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': `10.79.${Date.now() % 250}.${++ip % 250}` }, query: id ? { id } : {}, body }, r)); return r; };
const enrich = async (token, body) => { const r = mkRes(); await quiet(() => enrichHandler({ method: 'POST', headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': `10.80.${Date.now() % 250}.${++ip % 250}` }, body }, r)); return r; };
const preds = async (principal) => (await client.query('SELECT * FROM model_prediction_event WHERE principal_id=$1 ORDER BY id', [principal])).rows;
const corrs = async (principal, item) => (await client.query('SELECT * FROM operator_correction_event WHERE principal_id=$1 AND collection_item_id=$2 ORDER BY id', [principal, item])).rows;
const attrsOf = async (principal, id) => (await client.query('SELECT attributes FROM collection_item WHERE principal_id=$1 AND id=$2', [principal, id])).rows[0]?.attributes;
const itemId = (s) => `${TAG}-${s}`;
const enrichBase = (id, extra) => ({ title: 'Creepy', issue: '1', year: '1964', publisher: 'Warren', assetType: 'comic', grade: 'VG 4.0', isGraded: false, numericGrade: null, confidence: 'high', skipImageSearch: true, collectionItemId: id, ownedRefresh: true, ...extra });

try {
  console.log('-- MODEL PREDICTION -- real /api/grade -> server-written events --\n');
  const g1 = await grade(tokA);
  eq(g1.statusCode, 200, 'T1 real /api/grade: 200');
  const p1 = await preds(PA);
  const gradeEv = p1.find((r) => r.surface === 'GRADE');
  const identEv = p1.find((r) => r.surface === 'IDENTITY');
  ok(!!gradeEv && !!identEv, 'T1 the actual server model response created GRADE and IDENTITY prediction events (Vision path)');
  eq(gradeEv?.prediction?.grade, 'VG 4.0', 'T1 GRADE event carries the server-observed grade');
  eq(identEv?.prediction?.title, 'Creepy', 'T1 IDENTITY event carries the server-observed identity');
  eq([gradeEv?.provider, gradeEv?.model, gradeEv?.model_version], ['anthropic', 'claude-sonnet-4-5-20250929', 'claude-sonnet-4-5-20250929'], 'T3 provider/model/model_version come from the real API call (requested model + echoed version)');
  ok(/^sha256:[0-9a-f]{16}$/.test(gradeEv?.prompt_version || ''), 'prompt_version is a real hash of the prompt text actually sent (not invented)');
  ok(/^sha256:[0-9a-f]{64}$/.test(gradeEv?.input_hash || '') && !JSON.stringify(gradeEv).includes(PNG.slice(0, 40)), 'input_hash recorded; raw image bytes are NOT stored');
  eq(gradeEv?.usage?.input_tokens, 123, 'usage metadata recorded only because the API returned it');
  ok(gradeEv?.idempotency_key?.startsWith('pred-v1:') && gradeEv?.result_id, 'server-derived idempotency identity (no client key)');
  ok(!('gradeReceiptId' in (g1.body.prediction || {})) && !JSON.stringify(g1.body).includes(gradeEv.id), 'the prediction event id is not handed to the client');

  console.log('\n-- T2/T3 client cannot create events or forge provenance --\n');
  const before = (await preds(PA)).length;
  const cid = itemId('forge');
  const forge = await coll(tokA, 'POST', { body: { assetCategory: 'comic', id: cid, attributes: { title: 'Creepy', modelPredictionEvent: { provider: 'forged' }, modelPredictedProvenance: { predictionEventId: randomUUID(), provider: 'forged', model: 'forged' }, modelPredictedGrade: 'CGC 9.8' } } });
  eq(forge.statusCode, 200, 'T2 save with forged prediction material succeeds as an ordinary save');
  eq((await preds(PA)).length, before, 'T2 forged payload created ZERO prediction events');
  const fa = await attrsOf(PA, cid);
  ok(!('modelPredictedProvenance' in fa) && !('modelPredictedGrade' in fa), 'T3 forged provenance / predictionEventId / grade not persisted on the item');
  const evFiles = (await import('node:fs')).readdirSync(path.join(repoRoot, 'api')).filter((f) => f.endsWith('.js'));
  const importers = evFiles.filter((f) => /recordModelPrediction/.test(readFileSync(path.join(repoRoot, 'api', f), 'utf8')));
  eq(importers, ['grade.js'], 'T2 only api/grade.js (server inference path) references the prediction writer; no HTTP route accepts one');

  console.log('\n-- T4/T5 idempotency --\n');
  const rid = randomUUID();
  const pay = { grade: 'FN 6.0', confidence: 'high' };
  const a = await learning.recordModelPrediction({ principalId: PA, surface: 'GRADE', resultId: rid, prediction: pay, provider: 'anthropic', model: 'm' });
  const b = await learning.recordModelPrediction({ principalId: PA, surface: 'GRADE', resultId: rid, prediction: { confidence: 'high', grade: 'FN 6.0' }, provider: 'anthropic', model: 'm' });
  ok(a.replayed === false && b.replayed === true && a.eventId === b.eventId, 'T4 same inference result replayed -> same durable event, no duplicate');
  eq((await client.query('SELECT count(*)::int n FROM model_prediction_event WHERE result_id=$1', [rid])).rows[0].n, 1, 'T4 exactly one row for that result');
  const conflict = await rejects(() => learning.recordModelPrediction({ principalId: PA, surface: 'GRADE', resultId: rid, prediction: { grade: 'NM 9.4' }, provider: 'anthropic', model: 'm' }));
  ok(conflict && /IdempotencyConflict/.test(conflict.name), 'T4 same result id with a DIFFERENT payload is refused (no contradictory twin)');
  const c = await learning.recordModelPrediction({ principalId: PA, surface: 'GRADE', resultId: randomUUID(), prediction: pay, provider: 'anthropic', model: 'm' });
  ok(c.replayed === false && c.eventId !== a.eventId, 'T5 a different inference (new result id) creates a separate event');
  const g2 = await grade(tokA);
  ok((await preds(PA)).filter((r) => r.surface === 'GRADE').length >= 3 && g2.body.gradeReceiptId !== g1.body.gradeReceiptId, 'T5 a second real scan appends a separate GRADE event');

  console.log('\n-- T6/T7 prediction events are immutable --\n');
  const u = await rejects(() => client.query(`UPDATE model_prediction_event SET model='x' WHERE id=$1`, [gradeEv.id]));
  const d = await rejects(() => client.query(`DELETE FROM model_prediction_event WHERE id=$1`, [gradeEv.id]));
  ok(u && /append-only/.test(u.message), 'T6 UPDATE rejected by trigger');
  ok(d && /append-only/.test(d.message), 'T7 DELETE rejected by trigger');
  const t = await rejects(() => client.query(`TRUNCATE model_prediction_event`));
  ok(!!t, 'TRUNCATE of the prediction ledger refused (FK reference and trigger both guard it)');
  const t2 = await rejects(() => client.query(`TRUNCATE operator_correction_event`));
  ok(t2 && /append-only/.test(t2.message), 'TRUNCATE of the correction ledger rejected by the append-only trigger');

  console.log('\n-- receipt -> item linkage (prediction event referenced by the server-owned baseline) --\n');
  const cid2 = itemId('item2');
  const g3 = await grade(tokA);
  const s2 = await coll(tokA, 'POST', { body: { assetCategory: 'comic', id: cid2, gradeReceiptId: g3.body.gradeReceiptId, attributes: { title: 'Creepy', issue: '1', year: '1964', publisher: 'Warren' } } });
  eq(s2.statusCode, 200, 'save with receipt');
  const a2 = await attrsOf(PA, cid2);
  const latestGrade = (await preds(PA)).filter((r) => r.surface === 'GRADE').pop();
  eq(a2?.modelPredictedProvenance?.predictionEventId, latestGrade?.id, 'the item baseline provenance references the exact durable GRADE prediction event');
  eq(a2?.modelPredictedProvenance?.modelVersion, 'claude-sonnet-4-5-20250929', 'receipt now carries the real model version');

  console.log('\n-- OPERATOR CORRECTION -- real /api/enrich owned grade action --\n');
  const r1 = await enrich(tokA, enrichBase(cid2, { operatorGradeAction: 'SET', operatorGradeValue: 'VF 8.0' }));
  eq(r1.statusCode, 200, 'T8 operator SET grade through the real handler');
  let ev = await corrs(PA, cid2);
  const gev = ev.find((r) => r.surface === 'GRADE');
  ok(!!gev && gev.action === 'SET', 'T8 accepted grade correction created a GRADE operator_correction_event');
  eq(gev?.before_value, { operatorGrade: null, operatorGradeNumeric: null }, 'T10 before value preserved (null: nothing was set)');
  eq(gev?.after_value?.operatorGrade, 'VF 8.0', 'T10 after value preserved');
  eq(gev?.authority_before, { gradeAuthority: null }, 'T11 authority before preserved');
  eq(gev?.authority_after, { gradeAuthority: 'OPERATOR_CONFIRMED' }, 'T11 authority after preserved');
  eq(gev?.related_prediction_event_id, latestGrade?.id, 'T12 related model prediction linked (from the server-owned item provenance)');
  eq(gev?.source, 'enrich-owned-action', 'source recorded (server-set)');
  const st = await attrsOf(PA, cid2);
  eq([st.operatorGrade, st.gradeAuthority], ['VF 8.0', 'OPERATOR_CONFIRMED'], 'T13 the current-state mutation committed with the event');
  const r2 = await enrich(tokA, enrichBase(cid2, { operatorGradeAction: 'SET', operatorGradeValue: 'VF 8.0' }));
  eq((await corrs(PA, cid2)).filter((r) => r.surface === 'GRADE').length, 1, 'replaying the identical SET creates no second event (no logical change = no mutation, no event)');
  await enrich(tokA, enrichBase(cid2, { operatorGradeAction: 'SET', operatorGradeValue: 'FN 6.0' }));
  ev = (await corrs(PA, cid2)).filter((r) => r.surface === 'GRADE');
  eq(ev.length, 2, 'a genuinely different grade appends a second event (history, not overwrite)');
  eq([ev[1].before_value.operatorGrade, ev[1].after_value.operatorGrade], ['VF 8.0', 'FN 6.0'], 'second event: before/after chain preserved');
  eq(ev[0].after_value.operatorGrade, 'VF 8.0', 'first event unchanged by the later correction');
  await enrich(tokA, enrichBase(cid2, { operatorGradeAction: 'CLEAR' }));
  ev = (await corrs(PA, cid2)).filter((r) => r.surface === 'GRADE');
  eq([ev.length, ev[2]?.action], [3, 'CLEAR'], 'CLEAR is itself a recorded event');
  await enrich(tokA, enrichBase(cid2, { gradingFormatAction: 'SET_RAW' }));
  ok((await corrs(PA, cid2)).some((r) => r.surface === 'GRADING_FORMAT' && r.after_value.operatorIsGraded === false), 'grading-format correction is its own surface event');

  console.log('\n-- T9 identity correction -- real validated manual correction --\n');
  const cid3 = itemId('identity');
  await coll(tokA, 'POST', { body: { assetCategory: 'comic', id: cid3, attributes: { title: 'Creepy', issue: '1', year: '1964', publisher: 'Warren' } } });
  await enrich(tokA, enrichBase(cid3, {
    issue: '2', images: [`data:image/png;base64,${PNG}`], skipVision: true, manualIdentity: true, identitySource: 'manual',
    manualAuthority: { correctedBy: 'operator', correctedFields: ['issue'] }, priorIdentity: { title: 'Creepy', issue: '1', year: '1964', publisher: 'Warren' },
  }));
  const iev = (await corrs(PA, cid3)).find((r) => r.surface === 'IDENTITY');
  ok(!!iev && iev.action === 'CORRECT', 'T9 identity correction created an IDENTITY operator_correction_event');
  eq(iev?.before_value, { issue: '1' }, 'identity before value read from the DURABLE row (not the client)');
  eq(iev?.after_value, { issue: '2' }, 'identity after value (the operator label)');
  eq([iev?.authority_before, iev?.authority_after], [{}, { issue: 'OPERATOR_CONFIRMED' }], 'identity authority before/after preserved');
  eq((await attrsOf(PA, cid3))?.identityAuthority, { issue: 'OPERATOR_CONFIRMED' }, 'identity authority mutation committed with the event');

  console.log('\n-- T13/T14 atomicity: injected failure leaves NEITHER --\n');
  const cid4 = itemId('atomic-a'), cid5 = itemId('atomic-b');
  for (const x of [cid4, cid5]) await client.query(`INSERT INTO collection_item (id, principal_id, asset_category, attributes) VALUES ($1,$2,'comic','{"title":"Atomic"}')`, [x, PA]);
  // (a) the EVENT insert fails after the state UPDATE ran
  await client.query(`CREATE OR REPLACE FUNCTION gk278_fail_event() RETURNS trigger AS $$ BEGIN IF NEW.collection_item_id = '${cid4}' THEN RAISE EXCEPTION 'gk278 injected event failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
  await client.query(`CREATE TRIGGER gk278_fail_event_trg BEFORE INSERT ON operator_correction_event FOR EACH ROW EXECUTE FUNCTION gk278_fail_event()`);
  // (b) the STATE update fails after... (event written second, so make UPDATE itself fail first on cid5)
  await client.query(`CREATE OR REPLACE FUNCTION gk278_fail_state() RETURNS trigger AS $$ BEGIN IF NEW.id = '${cid5}' AND NEW.attributes ? 'operatorGrade' THEN RAISE EXCEPTION 'gk278 injected state failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
  await client.query(`CREATE TRIGGER gk278_fail_state_trg BEFORE UPDATE ON collection_item FOR EACH ROW EXECUTE FUNCTION gk278_fail_state()`);
  try {
    const patch = { operatorGrade: 'NM 9.4', operatorGradeNumeric: 9.4, operatorGradeSetAt: Date.now(), gradeAuthority: 'OPERATOR_CONFIRMED' };
    const e1 = await rejects(() => collection.applyGradingAuthorityPatch({ principalId: PA, id: cid4, patch }));
    ok(e1 && /injected event failure/.test(e1.message), 'T14a event insert failed (injected) after the mutation ran');
    ok(!('operatorGrade' in (await attrsOf(PA, cid4))), 'T14a state mutation ROLLED BACK (no mutation without its event)');
    eq((await corrs(PA, cid4)).length, 0, 'T14a no event survives');
    const e2 = await rejects(() => collection.applyGradingAuthorityPatch({ principalId: PA, id: cid5, patch }));
    ok(e2 && /injected state failure/.test(e2.message), 'T14b state mutation failed (injected)');
    eq((await corrs(PA, cid5)).length, 0, 'T14b no correction event without its accepted mutation');
  } finally {
    await client.query('DROP TRIGGER IF EXISTS gk278_fail_event_trg ON operator_correction_event');
    await client.query('DROP TRIGGER IF EXISTS gk278_fail_state_trg ON collection_item');
    await client.query('DROP FUNCTION IF EXISTS gk278_fail_event()');
    await client.query('DROP FUNCTION IF EXISTS gk278_fail_state()');
  }
  const okAtomic = await collection.applyGradingAuthorityPatch({ principalId: PA, id: cid4, patch: { operatorGrade: 'NM 9.4', operatorGradeNumeric: 9.4, operatorGradeSetAt: Date.now(), gradeAuthority: 'OPERATOR_CONFIRMED' } });
  ok(okAtomic.correctionEventIds.length === 1 && (await attrsOf(PA, cid4)).operatorGrade === 'NM 9.4', 'control: with the injection removed, mutation + event commit together');

  console.log('\n-- T15/T16 correction events are immutable --\n');
  const cev = (await corrs(PA, cid2))[0];
  ok(/append-only/.test((await rejects(() => client.query(`UPDATE operator_correction_event SET reason='x' WHERE id=$1`, [cev.id])))?.message || ''), 'T15 UPDATE rejected');
  ok(/append-only/.test((await rejects(() => client.query(`DELETE FROM operator_correction_event WHERE id=$1`, [cev.id])))?.message || ''), 'T16 DELETE rejected');

  console.log('\n-- T23-T25 principal / asset safety --\n');
  const cidB = itemId('principalB');
  await client.query(`INSERT INTO collection_item (id, principal_id, asset_category, attributes) VALUES ($1,$2,'comic','{"title":"B item"}')`, [cidB, PB]);
  const foreignPred = await learning.recordModelPrediction({ principalId: PB, surface: 'GRADE', resultId: randomUUID(), prediction: { grade: 'GD 2.0' }, provider: 'anthropic', model: 'm' });
  const crossPrincipal = await rejects(() => client.query(`INSERT INTO operator_correction_event (principal_id, collection_item_id, surface, action, before_value, after_value, authority_before, authority_after, related_prediction_event_id, idempotency_key) VALUES ($1,$2,'GRADE','SET','{}','{}','{}','{}',$3,$4)`, [PA, cid2, foreignPred.eventId, `${TAG}-x1`]));
  ok(crossPrincipal && /foreign key|violates/i.test(crossPrincipal.message), 'T23 cross-principal prediction linkage refused by composite FK');
  const noItem = await rejects(() => client.query(`INSERT INTO operator_correction_event (principal_id, collection_item_id, surface, action, before_value, after_value, authority_before, authority_after, idempotency_key) VALUES ($1,$2,'GRADE','SET','{}','{}','{}','{}',$3)`, [PA, cidB, `${TAG}-x2`]));
  ok(noItem && /does not exist for this principal/.test(noItem.message), 'T23 a correction cannot target another principal\'s collection item');

  const basis = mapping.buildCaptureBasis(PA, { correlationId: `${TAG}-s`, scanlogKey: `${TAG}-sl`, book: { title: 'GK-278 asset' } });
  const mint = await assets.createPhysicalAsset({ principalId: PA, captureBasis: basis, assetClass: 'comic', source: 'gk278-test', idempotencyKey: `${TAG}:mint` });
  const basis2 = mapping.buildCaptureBasis(PA, { correlationId: `${TAG}-s2`, scanlogKey: `${TAG}-sl2`, book: { title: 'GK-278 other asset' } });
  const mint2 = await assets.createPhysicalAsset({ principalId: PA, captureBasis: basis2, assetClass: 'comic', source: 'gk278-test', idempotencyKey: `${TAG}:mint2` });
  await assets.linkCollectionItem({ principalId: PA, collectionItemId: cid2, gkAssetId: mint.assetId, idempotencyKey: `${TAG}:link` });
  const wrongAsset = await rejects(() => collection.applyGradingAuthorityPatch({
    principalId: PA, id: cid2, patch: { operatorGrade: 'GD 2.0', operatorGradeNumeric: 2, operatorGradeSetAt: Date.now(), gradeAuthority: 'OPERATOR_CONFIRMED' },
    correction: { gkAssetId: mint2.assetId, source: 'test' },
  }));
  ok(wrongAsset && /not the canonical link/.test(wrongAsset.message), 'T24 wrong gkAsset linkage refused (guard trigger), and the whole transaction rolled back');
  ok((await attrsOf(PA, cid2)).gradeAuthority === null || (await attrsOf(PA, cid2)).operatorGrade !== 'GD 2.0', 'T24 refused correction left the state untouched');
  const rightAsset = await collection.applyGradingAuthorityPatch({
    principalId: PA, id: cid2, patch: { operatorGrade: 'GD 2.0', operatorGradeNumeric: 2, operatorGradeSetAt: Date.now(), gradeAuthority: 'OPERATOR_CONFIRMED' },
    correction: { gkAssetId: mint.assetId, source: 'test' },
  });
  ok(rightAsset.correctionEventIds.length === 1, 'T25 the canonical collection_item -> gkAsset linkage is accepted');
  eq((await corrs(PA, cid2)).pop().gk_asset_id, mint.assetId, 'T25 event carries the canonical gkAssetId');
  const viaHandler = await enrich(tokA, enrichBase(cid2, { operatorGradeAction: 'SET', operatorGradeValue: 'FR 1.0' }));
  eq((await corrs(PA, cid2)).pop().gk_asset_id, mint.assetId, 'T25 real handler path resolves the canonical gkAssetId from collection_item_link (server-side)');

  console.log('\n-- DECISION SNAPSHOT --\n');
  const fakeOut = { title: 'Creepy', issue: '1', year: '1964', publisher: 'Warren', variantNote: null, governingGrade: 'FR 1.0', governingGradeSource: 'operator', gradeAuthority: 'OPERATOR_CONFIRMED', governingIsGraded: false, governingGradingFormatSource: 'operator', assetType: 'comic', pricingSource: 'pc_estimate', matchConfidence: { tier: 'HIGH' }, soldCompDiagnostics: { rawCount: 5, verifiedCount: 2, newestDaysAgo: 30 }, issueAuthority: { status: 'trusted' } };
  const durable = await attrsOf(PA, cid2);
  const attempt = (price, extraSource) => bridge.attemptOutcome1({
    enabled: true, environment: 'development', principalId: PA, gkAssetId: mint.assetId, marketPopulationId: null,
    priceString: price, decision: { action: 'LIST_LOW', timestamp: Date.now(), warnings: [] }, gradeAssumption: 1, evidenceKey: 'pc_estimate|HIGH',
    buildSha: 'abc1234', correlationId: randomUUID(), recordEconomicDecision: assets.recordEconomicDecision, authoritySnapshotSource: extraSource,
  });
  const d1 = await attempt('$42.50', { out: fakeOut, durable, durableCategoryAuthority: 'comic' });
  ok(d1.attempted && d1.result?.decisionEventId, 'T17 server-derived decision written');
  const drow = (await client.query('SELECT d.*, v.id vid, v.value_amount::text amt FROM decision_event d JOIN valuation_event v ON v.id=d.valuation_event_id WHERE d.id=$1', [d1.result.decisionEventId])).rows[0];
  const sn = drow.authority_snapshot;
  eq(sn?.snapshotVersion, 'das-v1', 'T17 decision stores an authority snapshot');
  eq([sn.grade.governingGrade, sn.grade.governingGradeSource, sn.grade.gradeAuthority], ['FR 1.0', 'operator', 'OPERATOR_CONFIRMED'], 'snapshot: governing grade + authority');
  eq(sn.identity.identityAuthority, durable.identityAuthority ?? {}, 'snapshot: identity authority standing from the DURABLE row');
  eq([sn.category.assetType, sn.category.durableCategoryAuthority], ['comic', 'comic'], 'snapshot: category authority');
  eq([sn.market.soldEvidence.rawCount, sn.market.soldEvidence.verifiedCount, sn.market.soldEvidence.newestDaysAgo], [5, 2, 30], 'snapshot: market evidence standing');
  eq(sn.references.modelPredictionEventId, latestGrade.id, 'snapshot: prediction event reference (from server-owned provenance)');
  eq(sn.decision.action, 'LIST_LOW', 'snapshot: decision action');
  ok(!JSON.stringify(sn).includes('images') && !('attributes' in sn), 'T18 snapshot is a whitelist projection (no row dump, no images)');
  eq(drow.valuation_event_id, drow.vid, 'T20 decision still references the exact valuation anchor (values are NOT duplicated into the snapshot)');
  ok(!JSON.stringify(sn).includes('42.5'), 'T20 snapshot carries no valuation values');

  const hostile = snap.buildDecisionAuthoritySnapshot({ ...fakeOut, hacked: 'x', attributes: { a: 1 } }, { ...durable, injected: 'y' }, { buildSha: 'abc1234' });
  ok(!('hacked' in hostile) && !JSON.stringify(hostile).includes('"injected"'), 'T18/T19 unlisted fields cannot enter the snapshot');
  const direct = await rejects(() => assets.recordEconomicDecision({ principalId: PA, gkAssetId: mint.assetId, valueAmount: 1, buildSha: 'abc1234', recommendation: 'RESEARCH', semanticFingerprint: 'econ-v1:fake', authoritySnapshot: 'not an object' }));
  ok(direct && /authoritySnapshot must be an object/.test(direct.message), 'T19 a non-object snapshot is refused');
  const reqBodySrc = readFileSync(path.join(repoRoot, 'api', 'enrich.js'), 'utf8');
  ok(!/req\.body[^;\n]*authoritySnapshot|authoritySnapshot[^;\n]*req\.body/.test(reqBodySrc), 'T19 no api/enrich.js line sources authoritySnapshot from req.body');
  ok(!/authoritySnapshot/.test(readFileSync(path.join(repoRoot, 'src', 'modules', 'capture', 'service.js'), 'utf8')), 'T19 the capture path (client-facing) has no snapshot parameter');

  const d1b = await attempt('$42.50', { out: fakeOut, durable, durableCategoryAuthority: 'comic' });
  ok(d1b.replayed === true && d1b.result.decisionEventId === d1.result.decisionEventId, 'T22 identical decision retry is still an idempotent replay (snapshot is not part of the fingerprint)');
  eq((await client.query('SELECT count(*)::int n FROM decision_event WHERE asset_id=$1', [mint.assetId])).rows[0].n, 1, 'T22 no duplicate decision row');
  const d0 = await assets.recordDecision({ principalId: PA, gkAssetId: mint.assetId, recommendation: 'RESEARCH', reasonCodes: [], idempotencyKey: `${TAG}:legacy-style`, correlationId: randomUUID() });
  eq((await client.query('SELECT authority_snapshot FROM decision_event WHERE id=$1', [d0.decisionEventId])).rows[0].authority_snapshot, null, 'T21 a decision written without a snapshot stays NULL and is accepted (historical shape)');
  const hist = await client.query('SELECT count(*)::int total, count(authority_snapshot)::int nn FROM decision_event');
  ok(hist.rows[0].total > hist.rows[0].nn, 'T21 pre-existing decision rows remain NULL (no backfill)');
  ok(/append-only/.test((await rejects(() => client.query(`UPDATE decision_event SET authority_snapshot='{}' WHERE id=$1`, [d1.result.decisionEventId])))?.message || ''), 'decision_event remains immutable (cannot rewrite a snapshot)');

  console.log('\n-- learning module boundary --\n');
  {
    const fsx = await import('node:fs');
    const walk = (dir, out = []) => { for (const e of fsx.readdirSync(dir)) { if (e === 'node_modules' || e === 'dist') continue; const f = path.join(dir, e); if (fsx.statSync(f).isDirectory()) walk(f, out); else if (/\.(js|jsx|mjs)$/.test(e)) out.push(f); } return out; };
    const files = [...walk(path.join(repoRoot, 'api')), ...walk(path.join(repoRoot, 'src'))].filter((f) => !f.includes(path.join('src', 'modules', 'learning')));
    const privateImports = files.filter((f) => /modules\/learning\/(db|repository)\.js/.test(fsx.readFileSync(f, 'utf8')));
    eq(privateImports, [], 'db.js / repository.js of the learning module are never imported outside it');
    const writerUsers = files.filter((f) => /appendOperatorCorrectionEventTx/.test(fsx.readFileSync(f, 'utf8'))).map((f) => path.relative(repoRoot, f).split(path.sep).join('/'));
    eq(writerUsers, ['src/modules/collection/service.js'], 'only the collection module (inside its own transaction) appends correction events');
  }

  console.log('\n-- fact-class separation --\n');
  const colNames = (await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='data1_dev' AND table_name IN ('model_prediction_event','operator_correction_event')`)).rows.map((r) => r.column_name);
  ok(!colNames.some((c) => /truth|ground|verified/i.test(c)), 'no column implies ground truth / verified truth');
  ok(!colNames.some((c) => /gross|net|payout|fee|ship/i.test(c)), 'realized-outcome economics live elsewhere (outcome_event), not in prediction/correction history');
} finally {
  // Retained by design: the event tables, decision_event and valuation_event are append-only.
  await client.end();
  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) { console.log('FAILURES:'); failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
  process.exit(0);
}
