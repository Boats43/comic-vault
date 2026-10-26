// tests/gkp0-listing-live.test.js
//
// GK-P0 LISTING RECONCILIATION (2026-10-26) -- Package A (durable listing association, owner isolation)
// and Package B (duplicate protection, including truly concurrent publication requests) against the REAL
// api/list-ebay.js + api/assets.js handlers and the REAL Development Postgres. global.fetch is replaced
// before the handlers are imported and refuses any URL it does not recognise: NO live eBay call is possible
// and no live listing is created.
//
// Fixtures: throwaway principals/assets minted per run (permanent append-only Development fixtures, the
// repo convention -- B1 live tests do the same). Every listing id this run creates is closed with a
// DELISTED outcome before exit.
//
//   node tests/gkp0-listing-live.test.js

import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { metaFetch, shippingResponse, mockState } from './helpers/ebayPacketMocks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
for (const line of readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}
process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';
if (!process.env.GRAILKEY_SESSION_SECRET) process.env.GRAILKEY_SESSION_SECRET = randomBytes(32).toString('base64url');
process.env.GRAILKEY_MARKETPLACE_CREDENTIAL_KEY = randomBytes(32).toString('base64url');
delete process.env.EBAY_AUTH_TOKEN; delete process.env.EBAY_USER_REFRESH_TOKEN;

let passed = 0, failed = 0;
const failures = [];
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; failures.push(l); console.log(`  ✗ ${l}`); } };
function mockRes() {
  const res = { statusCode: null, body: null, headers: {} };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

// ── eBay mock: the ONLY network surface. ──
const fetchCalls = [];
let addDelayMs = 0;
let itemCounter = 0;
const nextItemId = () => `${Date.now()}${++itemCounter}`.slice(-12);
mockState.mediaImageUrl = 'https://i.ebayimg.com/hosted/gkp0-picture.jpg';
const TINY_PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
global.fetch = async (url, opts = {}) => {
  const urlStr = String(url);
  const __m = metaFetch(urlStr, opts); if (__m) return __m;
  if (urlStr.includes('identity/v1/oauth2/token')) {
    fetchCalls.push({ type: 'refresh' });
    return { ok: true, status: 200, json: async () => ({ access_token: `access-${Date.now()}`, expires_in: 7200 }) };
  }
  const callName = opts?.headers?.['X-EBAY-API-CALL-NAME'];
  if (!callName) throw new Error(`test fetch mock: unexpected non-Trading call to "${urlStr}" -- a live call is impossible`);
  fetchCalls.push({ type: 'trading', callName });
  if (callName === 'GeteBayDetails') return shippingResponse();
  if (callName === 'GetUser') return { status: 200, text: async () => '<?xml version="1.0"?><GetUserResponse><Ack>Success</Ack><User><UserID>gkp0-seller</UserID><Site>US</Site></User></GetUserResponse>' };
  if (callName === 'AddFixedPriceItem') {
    if (addDelayMs) await new Promise((r) => setTimeout(r, addDelayMs));
    return { status: 200, text: async () => `<AddFixedPriceItemResponse><Ack>Success</Ack><ItemID>${nextItemId()}</ItemID></AddFixedPriceItemResponse>` };
  }
  throw new Error(`test fetch mock: unexpected eBay call "${callName}"`);
};
const addCalls = () => fetchCalls.filter((c) => c.type === 'trading' && c.callName === 'AddFixedPriceItem').length;
const anyTrading = () => fetchCalls.some((c) => c.type === 'trading');

const { issueToken } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'auth', 'token.js')).href);
const { upsertMarketplaceConnection } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'marketplace', 'index.js')).href);
const { CONNECT_SCOPES } = await import(pathToFileURL(path.join(repoRoot, 'src', 'lib', 'ebayUserOAuth.js')).href);
const A = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'assets', 'index.js')).href);
const { enrollAsset } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'inventory', 'index.js')).href);
const { createCollectionItem, updateCollectionItem } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'collection', 'index.js')).href);
const { issueAuthorityReceipt, computeEvidenceVersion } = await import(pathToFileURL(path.join(repoRoot, 'src', 'lib', 'authorityReceipt.js')).href);
const listHandler = (await import(pathToFileURL(path.join(repoRoot, 'api', 'list-ebay.js')).href)).default;
const assetsHandler = (await import(pathToFileURL(path.join(repoRoot, 'api', 'assets.js')).href)).default;

const db = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const nonce = (l) => `gkp0-${l}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
async function newPrincipal(label) {
  const id = (await db.query('SELECT uuidv7() AS id')).rows[0].id;
  await db.query(`INSERT INTO data1_dev.gk_principal (id, display_name, kind) VALUES ($1, $2, 'operator')`, [id, label]);
  return id;
}

// Receipt-bound authority values. NOT_READY: no sold evidence -> operator Q41 path (the real OML shape).
const NOT_READY_AUTHORITY = { decision: { action: 'RESEARCH', confidence: 'low' }, pricingSource: 'active_ask_derived', matchConfidence: { tier: 'HIGH', score: 93 }, identityConfident: true };
// READY-shaped: verified sold evidence -> deriveActionAuthority READY -> no Q41 / no attempt-ledger path.
const READY_AUTHORITY = {
  decision: { action: 'LIST_NOW', confidence: 'high' }, pricingSource: 'verified_sold', matchConfidence: { tier: 'HIGH', score: 95 },
  soldCompDiagnostics: { rawCount: 6, verifiedCount: 5, newestDaysAgo: 10 }, identityConfident: true,
  rawComps: { count: 8 }, soldComps: 5,
};

async function mint(principalId, label, authority) {
  const n = nonce(label);
  const { assetId: gkAssetId } = await A.createPhysicalAsset({ principalId, captureBasis: { test: true, label, n }, assetClass: 'comic', source: 'test-fixture', idempotencyKey: `${n}-mint` });
  await enrollAsset({ principalId, gkAssetId, idempotencyKey: `${n}-enroll` });
  const canonicalId = `cv_${n}`;
  const plainAttrs = { title: 'GKP0 Test Comic', issue: '1', year: '1990', publisher: 'Test Publisher' };
  await createCollectionItem({ principalId, id: canonicalId, assetCategory: 'comic', attributes: plainAttrs });
  await A.linkCollectionItem({ principalId, collectionItemId: canonicalId, gkAssetId, idempotencyKey: `${n}-link` });
  const { decisionEventId } = await A.recordDecision({ principalId, gkAssetId, recommendation: authority.decision.action, idempotencyKey: `${n}-decision` });
  await A.attachMedia({ principalId, gkAssetId, bytes: Buffer.from(TINY_PNG_DATA_URL.split(',')[1], 'base64'), contentType: 'image/png', captureRole: 'capture-photo', idempotencyKey: `${n}-photo` });
  const { operatorActionEventId } = await A.recordOperatorAction({ principalId, gkAssetId, decisionEventId, actionCode: 'LIST', actionValueAmount: 25, source: 'test-fixture', idempotencyKey: `${n}-action` });
  const hashes = await A.getAssetMediaContentHashes({ principalId, gkAssetId });
  const authorityReceipt = issueAuthorityReceipt({ principalId, binding: { collectionItemId: canonicalId, gkAssetId, evidenceVersion: computeEvidenceVersion(hashes) }, response: { title: plainAttrs.title, issue: plainAttrs.issue, year: plainAttrs.year, ...authority } });
  await updateCollectionItem({ principalId, id: canonicalId, assetCategory: 'comic', attributes: { ...plainAttrs, authorityReceipt } });
  return { gkAssetId, decisionEventId, operatorActionEventId, principalId, canonicalId };
}
function listReq(principalId, asset, o = {}) {
  const { token } = issueToken({ principalId });
  const body = {
    title: 'CLIENT TITLE (ignored)', publisher: 'x', year: '1990', price: '$25.00', grade: 'VF',
    gkAssetId: asset.gkAssetId, decisionEventId: asset.decisionEventId, operatorActionEventId: asset.operatorActionEventId, images: [TINY_PNG_DATA_URL],
    ...(o.ready ? {} : { q41Override: { priceOverridden: true, manualPrice: 25, lockClassAcknowledged: 'insufficiency', locks: ['no-sold-evidence'], state: 'REVIEW', decision: 'RESEARCH' } }),
    ...(o.ready ? { rawComps: { count: 8 }, soldComps: 5, soldCompDiagnostics: { rawCount: 6, verifiedCount: 5, newestDaysAgo: 10 }, pricingSource: 'verified_sold', matchConfidence: { tier: 'HIGH', score: 95 }, identityConfident: true, decision: { action: 'LIST_NOW' } } : {}),
  };
  return { method: 'POST', headers: { authorization: `Bearer ${token}` }, body };
}
async function publish(principalId, asset, o) { const res = mockRes(); await listHandler(listReq(principalId, asset, o), res); return res; }
let ipSeq = 0;
async function listingsFor(principalId, withToken = true) {
  const res = mockRes();
  const headers = { 'x-forwarded-for': `10.9.${Math.floor(++ipSeq / 200)}.${ipSeq % 200}` };
  if (withToken) headers.authorization = `Bearer ${issueToken({ principalId }).token}`;
  await assetsHandler({ method: 'GET', headers, query: { listings: '1' } }, res);
  return res;
}
async function ledger(assetId) { return (await db.query(`SELECT phase FROM data1_dev.operator_authority_event WHERE gk_asset_id = $1 ORDER BY recorded_at, id`, [assetId])).rows.map((r) => r.phase); }

console.log('\n=== GK-P0 live: durable listing association + duplicate/concurrency protection (real handlers, real Development DB, mocked eBay) ===\n');

const PA = await newPrincipal('gkp0-principal-a');
const PB = await newPrincipal('gkp0-principal-b');
for (const [p, tag] of [[PA, 'a'], [PB, 'b']]) {
  await upsertMarketplaceConnection({ principalId: p, provider: 'EBAY', providerUserId: `gkp0-ebay-${tag}-${nonce('i')}`, refreshCredential: `fake-refresh-${tag}-${nonce('r')}`, grantedScopes: [...CONNECT_SCOPES] });
}
const created = []; // { principalId, gkAssetId, listingId }

try {
  // ═══ A: publish -> durable association -> API restores it ═══
  console.log('-- A: publish once (Q41 path) -> durable LISTED; the API restores the association --');
  const asset1 = await mint(PA, 'one', NOT_READY_AUTHORITY);
  fetchCalls.length = 0;
  const pub1 = await publish(PA, asset1);
  ok(pub1.statusCode === 200 && pub1.body?.ok === true, `publish succeeds (${pub1.statusCode} ${pub1.body?.error || ''} ${pub1.body?.refusalReason || ''})`);
  ok(addCalls() === 1, 'exactly one AddFixedPriceItem call');
  const listing1 = pub1.body?.listingId;
  if (listing1) created.push({ principalId: PA, gkAssetId: asset1.gkAssetId, listingId: listing1 });

  const own = await listingsFor(PA);
  ok(own.statusCode === 200 && Array.isArray(own.body?.listings), `GET /api/assets?listings=1 -> 200 listings[] (${own.statusCode})`);
  const mine = (own.body?.listings || []).filter((l) => l.externalListingId === listing1);
  ok(mine.length === 1, `exactly one summary for this listing (${mine.length})`);
  ok(mine[0]?.state === 'LISTED' && mine[0]?.gkAssetId === asset1.gkAssetId && mine[0]?.collectionItemId === asset1.canonicalId && mine[0]?.channel === 'ebay', 'state LISTED, correct asset, correct catalogue item id, channel ebay');
  ok(mine[0]?.askAmount === 25 && Number.isFinite(mine[0]?.listedAt), 'ask amount ($25.00 approved price) and listed-at come from the durable row');
  ok(JSON.stringify(await ledger(asset1.gkAssetId)) === JSON.stringify(['AUTHORIZED', 'SUBMITTED', 'LISTED_CONFIRMED']), 'attempt ledger shows the full AUTHORIZED -> SUBMITTED -> LISTED_CONFIRMED chain');

  // ═══ A: owner isolation ═══
  console.log('\n-- A: owner/principal isolation --');
  const foreign = await listingsFor(PB);
  ok(foreign.statusCode === 200 && (foreign.body?.listings || []).every((l) => l.externalListingId !== listing1 && l.gkAssetId !== asset1.gkAssetId), 'a different authenticated principal sees none of the owner\'s listings');
  const anon = await listingsFor(PA, false);
  ok(anon.statusCode === 401, `no token -> 401 (${anon.statusCode})`);
  const q = await db.query(`SELECT count(*)::int AS n FROM data1_dev.outcome_event WHERE external_listing_id = $1`, [listing1]);
  ok(q.rows[0].n === 1, 'the read endpoint wrote nothing (one outcome row, the LISTED one)');

  // ═══ B: stale local state vs active durable LISTED ═══
  console.log('\n-- B: client believes UNLISTED but a durable LISTED exists -> refused before ANY provider call --');
  fetchCalls.length = 0;
  const dup = await publish(PA, asset1);
  ok(dup.statusCode === 409 && dup.body?.error === 'DUPLICATE_ACTIVE_LISTING', `second publish -> 409 DUPLICATE_ACTIVE_LISTING (${dup.statusCode} ${dup.body?.error})`);
  ok(!anyTrading() && fetchCalls.length === 0, `ZERO provider calls of any kind (${JSON.stringify(fetchCalls)})`);
  ok((await ledger(asset1.gkAssetId)).length === 3, 'no new attempt-ledger row was written by the refused duplicate');

  // ═══ B: terminal event flips durable state ═══
  console.log('\n-- B: a terminal outcome is reflected in the durable read --');
  await A.recordOutcomeEvent({ principalId: PA, gkAssetId: asset1.gkAssetId, outcomeType: 'DELISTED', channel: 'ebay', externalListingId: listing1, idempotencyKey: `gkp0-close-${listing1}` });
  const afterClose = await listingsFor(PA);
  ok((afterClose.body?.listings || []).find((l) => l.externalListingId === listing1)?.state === 'DELISTED', 'durable state follows the ledger: DELISTED (an ended listing is not SOLD)');
  ok(!(afterClose.body?.listings || []).some((l) => l.state === 'SOLD' && l.externalListingId === listing1), 'no SOLD fabricated from a DELISTED/ended listing');

  // ═══ B: concurrency, Q41/OPERATOR_MANUAL path ═══
  console.log('\n-- B: TWO CONCURRENT requests, same asset, Q41/OPERATOR_MANUAL path --');
  const asset2 = await mint(PA, 'race-q41', NOT_READY_AUTHORITY);
  fetchCalls.length = 0; addDelayMs = 300;
  const [r1, r2] = await Promise.all([publish(PA, asset2), publish(PA, asset2)]);
  addDelayMs = 0;
  for (const r of [r1, r2]) if (r.body?.listingId) created.push({ principalId: PA, gkAssetId: asset2.gkAssetId, listingId: r.body.listingId });
  const st = [r1.statusCode, r2.statusCode].sort();
  console.log(`  observed: statuses=${JSON.stringify(st)} errors=${JSON.stringify([r1.body?.error, r2.body?.error])} AddFixedPriceItem=${addCalls()}`);
  ok(addCalls() === 1, `exactly ONE provider publication under a race (${addCalls()})`);
  ok(st[0] === 200 && st[1] === 409, `one 200 and one 409 (${JSON.stringify(st)})`);

  // ═══ B: concurrency, READY path (no Q41, no attempt ledger) ═══
  console.log('\n-- B: TWO CONCURRENT requests, same asset, READY path (no Q41) --');
  const probeAsset = await mint(PA, 'ready-probe', READY_AUTHORITY);
  const probe = await publish(PA, probeAsset, { ready: true });
  const readyConstructed = probe.statusCode === 200;
  if (probe.body?.listingId) created.push({ principalId: PA, gkAssetId: probeAsset.gkAssetId, listingId: probe.body.listingId });
  console.log(`  READY fixture constructible: ${readyConstructed} (probe status ${probe.statusCode} ${probe.body?.error || ''} ${probe.body?.refusalReason || ''})`);
  if (readyConstructed) {
    const probeLedger = await ledger(probeAsset.gkAssetId);
    ok(probeLedger.length === 0, `READY path writes NO attempt-ledger rows (${JSON.stringify(probeLedger)}) -- the path takes no per-asset lock`);
    const asset3 = await mint(PA, 'race-ready', READY_AUTHORITY);
    fetchCalls.length = 0; addDelayMs = 300;
    const [q1, q2] = await Promise.all([publish(PA, asset3, { ready: true }), publish(PA, asset3, { ready: true })]);
    addDelayMs = 0;
    for (const r of [q1, q2]) if (r.body?.listingId) created.push({ principalId: PA, gkAssetId: asset3.gkAssetId, listingId: r.body.listingId });
    const st2 = [q1.statusCode, q2.statusCode].sort();
    console.log(`  observed (READY race): statuses=${JSON.stringify(st2)} errors=${JSON.stringify([q1.body?.error, q2.body?.error])} AddFixedPriceItem=${addCalls()}`);
    // A MEASUREMENT of current behaviour, reported either way; not asserted green.
    console.log(`  >>> READY-path race verdict: ${addCalls() === 1 ? 'SAFE (one publication)' : addCalls() >= 2 ? 'UNSAFE -- DUPLICATE PUBLICATION UNDER RACE (' + addCalls() + ' provider calls)' : 'no publication'}`);
  } else {
    console.log('  READY-path race NOT measured: a READY-shaped fixture could not be constructed through the real receipt gate.');
  }
} finally {
  for (const c of created) {
    try {
      const has = await db.query(`SELECT 1 FROM data1_dev.outcome_event WHERE external_listing_id = $1 AND outcome_type = 'DELISTED'`, [c.listingId]);
      if (!has.rowCount) await A.recordOutcomeEvent({ principalId: c.principalId, gkAssetId: c.gkAssetId, outcomeType: 'DELISTED', channel: 'ebay', externalListingId: c.listingId, idempotencyKey: `gkp0-close-${c.listingId}` });
    } catch (e) { console.log('  (cleanup) close failed for', c.listingId, e.message); }
  }
  await db.end();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) { console.log('Failures:'); failures.forEach((f) => console.log(`  ✗ ${f}`)); process.exit(1); }
process.exit(0);
