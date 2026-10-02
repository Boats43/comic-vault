// tests/gk277-capture-decision-ingress-closed.test.js
//
// GK-277 -- CLIENT RECOMMENDATION != DURABLE ECONOMIC DECISION AUTHORITY.
// Real api/capture-scan.js handler + real Development data1_dev: an attacker-shaped
// capture payload (client recommendation, arbitrary reasons, economic-looking and
// legacy decision-shaped fields) must still capture successfully, but must create
// ZERO decision_event rows (and zero valuation_event rows). Plus the server-owned
// writer regression, consumer-safety (trust standing + GK-274 scorer) and static
// proof that the capture module can no longer reach a decision writer.
//
// decision_event/valuation_event are DB-immutable (0034): this test's own rows are
// retained, never deleted. Counts are scoped to this run's own fresh assets.
//
// Invoke: node tests/gk277-capture-decision-ingress-closed.test.js

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
delete process.env.MILESTONE_TEN_H8_PASS; delete process.env.MILESTONE_TEN_H8_BOOTSTRAP;

const url = (...p) => pathToFileURL(path.join(repoRoot, ...p)).href;
const captureScanRoute = (await import(url('api', 'capture-scan.js'))).default;
const assets = await import(url('src', 'modules', 'assets', 'index.js'));
const { createCollectionItem } = await import(url('src', 'modules', 'collection', 'index.js'));
const bridge = await import(url('src', 'lib', 'outcome1RuntimeBridge.js'));
const trust = await import(url('src', 'lib', 'decisionTrust.js'));
const scoring = await import(url('src', 'lib', 'predictionErrorScoring.js'));

let passed = 0, failed = 0; const failures = [];
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; failures.push(l); console.log(`  ✗ ${l}`); } };
const mockRes = () => { const r = { statusCode: null, body: null }; r.setHeader = () => {}; r.status = (c) => { r.statusCode = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };

const JIMMY = '01a0283a-b1b6-7f90-9b41-9c06bee6ecba';
const TAG = `gk277-${Date.now()}`;
const mintToken = (principalId) => {
  const now = Date.now();
  const payload = { principalId, iat: now, exp: now + 12 * 3600 * 1000, epoch: process.env.GRAILKEY_SESSION_EPOCH || '1' };
  const b = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${b}.${createHmac('sha256', process.env.GRAILKEY_SESSION_SECRET).update(b).digest('base64url')}`;
};
const token = mintToken(JIMMY);
const ONE_PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

const client = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query('SET search_path TO data1_dev');
const counts = async (assetId) => ({
  d: (await client.query('SELECT count(*)::int n FROM decision_event WHERE asset_id=$1', [assetId])).rows[0].n,
  v: (await client.query('SELECT count(*)::int n FROM valuation_event WHERE asset_id=$1', [assetId])).rows[0].n,
});
const totals = async () => (await client.query('SELECT (SELECT count(*) FROM decision_event)::int d, (SELECT count(*) FROM valuation_event)::int v')).rows[0];

async function capture(itemId, scanPayloadExtra, bodyExtra = {}) {
  await createCollectionItem({ principalId: JIMMY, id: itemId, assetCategory: 'comic', attributes: { title: 'GK-277 test', issue: '1', year: '2020' } });
  const key = randomUUID();
  const body = {
    scanPayload: { correlationId: key, collectionItemId: itemId, book: { title: 'GK-277 test', issue: '1', year: '2020' }, ...scanPayloadExtra },
    photos: [{ bytes: ONE_PX, contentType: 'image/png', captureRole: 'capture-photo' }],
    idempotencyKey: key, copyDisposition: { choice: 'ANOTHER_COPY' }, ...bodyExtra, // GK-279: repeat captures of one book identity need the explicit operator choice
  };
  const res = mockRes();
  await captureScanRoute({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body }, res);
  return res;
}

console.log('\n=== GK-277 — capture/save cannot mint a durable decision_event ===\n');
const createdItems = [];
try {
  console.log('-- attacker-shaped payload: LIST_NOW + arbitrary reasons + economic/legacy decision-shaped fields --');
  const tTotals0 = await totals();
  const itemA = `${TAG}-a`; createdItems.push(itemA);
  const resA = await capture(itemA, {
    outcome: { decisionAction: 'LIST_NOW', pricingSource: 'attacker-reason', price: '$999999.00', gradeMultiplier: 9, reasonCodes: ['attacker'], decision: { action: 'LIST_NOW', blockers: [], warnings: ['x'] }, recommendation: 'LIST_NOW' },
    decision: { action: 'LIST_NOW', recommendation: 'LIST_NOW', reasonCodes: ['attacker-reason'] },
    recommendation: 'LIST_NOW', decisionAction: 'LIST_NOW', valuationEventId: '00000000-0000-7000-8000-000000000000',
    valueAmount: 999999, provenance: 'SERVER_DERIVED', buildSha: 'forged',
  }, { decision: { action: 'LIST_NOW' }, recommendation: 'LIST_NOW', provenance: 'SERVER_DERIVED' });
  ok(resA.statusCode === 200 && !!resA.body?.gkAssetId, `capture/save itself still succeeds (status ${resA.statusCode})`);
  const cA = await counts(resA.body?.gkAssetId);
  ok(cA.d === 0, 'decision_event delta = 0: the client-supplied LIST_NOW became NO durable decision');
  ok(cA.v === 0, 'valuation_event delta = 0 (GK-276 still holds)');
  ok(resA.body?.decision === null && resA.body?.valuation === null, 'capture response reports decision: null / valuation: null');
  const tTotals1 = await totals();
  ok(tTotals1.d === tTotals0.d && tTotals1.v === tTotals0.v, 'GLOBAL decision_event/valuation_event totals unchanged by the whole capture');

  console.log('\n-- explicit null / absence does not resurrect a client decision writer --');
  const itemB = `${TAG}-b`; createdItems.push(itemB);
  const resB = await capture(itemB, { outcome: { decisionAction: null, pricingSource: null, price: null } });
  ok(resB.statusCode === 200 && (await counts(resB.body?.gkAssetId)).d === 0, 'decisionAction: null -> still no decision');
  const itemC = `${TAG}-c`; createdItems.push(itemC);
  const resC = await capture(itemC, {});
  ok(resC.statusCode === 200 && (await counts(resC.body?.gkAssetId)).d === 0, 'no outcome block at all -> still no decision');
  const itemD = `${TAG}-d`; createdItems.push(itemD);
  const resD = await capture(itemD, { outcome: { decisionAction: '' } });
  ok(resD.statusCode === 200 && (await counts(resD.body?.gkAssetId)).d === 0, "empty-string decisionAction -> still no decision");

  console.log('\n-- static: the capture module cannot reach any decision writer --');
  const svc = readFileSync(path.join(repoRoot, 'src', 'modules', 'capture', 'service.js'), 'utf8').replace(/\/\/.*$/gm, '');
  const map = readFileSync(path.join(repoRoot, 'src', 'modules', 'capture', 'mapping.js'), 'utf8').replace(/\/\/.*$/gm, '');
  ok(!/recordDecision|recordEconomicDecision|insertDecisionEvent|decision_event/.test(svc), 'capture/service.js references no decision writer');
  ok(!/hasDecision|mapDecision|decisionAction/.test(map.replace(/scanPayload\.outcome[^\n]*pricingSource[^\n]*/g, '')) || !/export function (hasDecision|mapDecision)/.test(map), 'capture/mapping.js exports no hasDecision/mapDecision');

  console.log('\n-- the certified server-owned writer still works (Development regression) --');
  const basis = (await import(url('src', 'modules', 'capture', 'mapping.js'))).buildCaptureBasis(JIMMY, { correlationId: `${TAG}-s`, scanlogKey: `${TAG}-sl`, book: { title: 'GK-277 server writer' } });
  const mint = await assets.createPhysicalAsset({ principalId: JIMMY, captureBasis: basis, assetClass: 'comic', source: 'gk277-test', idempotencyKey: `${TAG}:mint` });
  const gk = mint.assetId;
  const decision = { action: 'LIST_LOW', confidence: 'medium', blockers: [], warnings: ['thin-pool'], timestamp: 1789000000000 };
  const run = (over = {}) => bridge.attemptOutcome1({
    enabled: true, environment: 'development', principalId: JIMMY, gkAssetId: gk, priceString: '$42.50', decision, gradeAssumption: 4,
    evidenceKey: 'ebay-active|HIGH', buildSha: 'abc1234', correlationId: randomUUID(), recordEconomicDecision: assets.recordEconomicDecision, ...over,
  });
  const w1 = await run();
  const c1 = await counts(gk);
  ok(w1.attempted && !w1.declineReason && c1.d === 1 && c1.v === 1, 'trusted server-derived request -> exactly one valuation + one decision');
  const w2 = await run();
  const c2 = await counts(gk);
  ok(w2.replayed === true && w2.result.decisionEventId === w1.result.decisionEventId && w2.result.valuationEventId === w1.result.valuationEventId && c2.d === 1 && c2.v === 1, 'identical retry -> same ids, no duplicate pair');
  const prod = await run({ environment: 'production', allowlistRaw: gk, explicitIntent: true, buildSha: 'unknown' });
  ok(prod.declineReason === 'build-identity-unavailable', 'missing build identity -> refused (production gate)');
  const noPrice = await run({ priceString: null });
  ok(noPrice.declineReason === 'no-prediction' && (await counts(gk)).d === 1, 'no server-derived price/authority -> refused, nothing written');
  const row = (await client.query('SELECT v.provenance FROM decision_event d JOIN valuation_event v ON v.id = d.valuation_event_id WHERE d.id = $1', [w1.result.decisionEventId])).rows[0];
  ok(row?.provenance === 'SERVER_DERIVED', 'the written decision is anchored to a SERVER_DERIVED valuation');

  console.log('\n-- consumer safety: old client-origin decisions cannot be promoted --');
  const T = trust.DECISION_TRUST;
  const vals = [{ id: 'v-s', provenance: 'SERVER_DERIVED' }, { id: 'v-c', provenance: 'CLIENT_ASSERTED' }, { id: 'v-o', provenance: 'OPERATOR_OVERRIDE' }, { id: 'v-l', provenance: 'LEGACY_UNKNOWN' }];
  ok(trust.decisionTrustStanding({ valuation_event_id: 'v-s' }, vals) === T.SERVER_DERIVED && trust.decisionTrustLabel(T.SERVER_DERIVED) === null, 'decision anchored to SERVER_DERIVED valuation -> trusted, no warning label');
  ok(trust.decisionTrustStanding({ valuation_event_id: 'v-c' }, vals) === T.CLIENT_ORIGIN_UNTRUSTED, 'decision anchored to CLIENT_ASSERTED valuation -> CLIENT_ORIGIN_UNTRUSTED');
  ok(trust.decisionTrustStanding({ valuation_event_id: 'v-l' }, vals) === T.CLIENT_ORIGIN_UNTRUSTED, 'LEGACY_UNKNOWN anchor -> untrusted');
  ok(trust.decisionTrustStanding({ valuation_event_id: 'v-o' }, vals) === T.OPERATOR_ANCHORED, 'OPERATOR_OVERRIDE anchor -> operator-anchored (not engine)');
  ok(trust.decisionTrustStanding({ valuation_event_id: null }, vals) === T.UNANCHORED_UNTRUSTED && trust.decisionTrustStanding({ valuation_event_id: 'missing' }, vals) === T.CLIENT_ORIGIN_UNTRUSTED && trust.decisionTrustStanding(null, vals) === T.UNANCHORED_UNTRUSTED, 'unanchored / dangling / absent decision -> untrusted');
  ok(trust.decisionTrustLabel(T.CLIENT_ORIGIN_UNTRUSTED) === 'client-origin, not authoritative', 'untrusted decisions carry a visible non-authoritative label');
  const unanchored = scoring.resolveHistoricalAnchor({ decisionEventId: 'd', anchor: { valuationEventId: null, valuation: null } });
  const clientAnch = scoring.resolveHistoricalAnchor({ decisionEventId: 'd', anchor: { valuationEventId: 'v', valuation: { valuationEventId: 'v', valueAmount: 10, provenance: 'CLIENT_ASSERTED', buildSha: 'unknown' } } });
  ok(unanchored.ok === false && clientAnch.ok === false, 'GK-274 scoring refuses BOTH an unanchored decision and a client-anchored one (engine scoring cannot be fed an old client decision)');
  const sPanel = readFileSync(path.join(repoRoot, 'src', 'components', 'GrailKeyOperatorPanel.jsx'), 'utf8');
  ok(/decisionTrustLabel\(decisionTrustStanding\(latestDecision, valuations\)\)/.test(sPanel), 'the operator panel labels a non-server-derived recommendation');
} catch (e) {
  failed++; failures.push('FATAL ' + (e.stack || e.message)); console.log('  ✗ FATAL:', e.stack || e.message);
} finally {
  try { for (const id of createdItems) await client.query('DELETE FROM collection_item WHERE id = $1', [id]).catch(() => {}); } catch (e) { /* best effort */ }
  await client.end();
  await assets.closePool();
  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed) { failures.forEach((f) => console.log('  ✗', f)); process.exit(1); }
  process.exit(0);
}
