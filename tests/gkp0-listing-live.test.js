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
let addBehavior = 'success'; // success | failure
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
    if (addBehavior === 'failure') return { status: 200, text: async () => '<AddFixedPriceItemResponse><Ack>Failure</Ack><Errors><SeverityCode>Error</SeverityCode><ErrorCode>21919136</ErrorCode><ShortMessage>definitive test refusal</ShortMessage></Errors></AddFixedPriceItemResponse>' };
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
    ...(o.ready && o.q41 ? { q41Override: { priceOverridden: true, manualPrice: 25, lockClassAcknowledged: 'insufficiency', locks: ['no-sold-evidence'], state: 'REVIEW', decision: 'RESEARCH' }, priorLockCodes: ['market-standing-no-sold-evidence'] } : {}),
    ...(o.ready ? { rawComps: { count: 8 }, soldComps: 5, soldCompDiagnostics: { rawCount: 6, verifiedCount: 5, newestDaysAgo: 10 }, pricingSource: 'verified_sold', matchConfidence: { tier: 'HIGH', score: 95 }, identityConfident: true, decision: { action: 'LIST_NOW' } } : {}),
  };
  return { method: 'POST', headers: { authorization: `Bearer ${token}` }, body };
}
// V1.1a -- a publish requires the seller's server-signed APPROVAL of the exact listing package, obtained from the REAL
// api/listing-preview.js "approve" action (never forged). Each call looks like a distinct client (per principal+IP rate limiter).
const previewHandler = (await import(pathToFileURL(path.join(repoRoot, 'api', 'listing-preview.js')).href)).default;
let previewSeq = 0;
async function approveFor(req) {
  const b = req.body || {};
  if (!b.gkAssetId || b.listingApproval) return;
  const pm = String(b.price ?? '').replace(/,/g, '').match(/[\d.]+/);
  const r = mockRes();
  await previewHandler({ method: 'POST', headers: { ...req.headers, 'x-forwarded-for': `gkp0-live-preview-${++previewSeq}` }, body: { action: 'approve', gkAssetId: b.gkAssetId, price: pm ? parseFloat(pm[0]) : null } }, r);
  if (r.statusCode === 200 && r.body?.approval) b.listingApproval = r.body.approval;
}
async function publish(principalId, asset, o) { const res = mockRes(); const req = listReq(principalId, asset, o); await approveFor(req); await listHandler(req, res); return res; }
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

  // ═══ B: concurrency, READY path (no Q41, no attempt ledger) -- the baseline race ═══
  console.log('\n-- B: TWO CONCURRENT requests, same asset, READY path (no Q41) --');
  const probeAsset = await mint(PA, 'ready-probe', READY_AUTHORITY);
  fetchCalls.length = 0;
  const probe = await publish(PA, probeAsset, { ready: true });
  ok(probe.statusCode === 200, `a READY-shaped fixture publishes through the real receipt gate (${probe.statusCode} ${probe.body?.error || ''} ${probe.body?.refusalReason || ''})`);
  if (probe.body?.listingId) created.push({ principalId: PA, gkAssetId: probeAsset.gkAssetId, listingId: probe.body.listingId });
  ok((await ledger(probeAsset.gkAssetId)).length === 0, 'the READY path writes no attempt-ledger row (so the ledger lock never covered it)');
  {
    const asset3 = await mint(PA, 'race-ready', READY_AUTHORITY);
    fetchCalls.length = 0; addDelayMs = 300;
    const [q1, q2] = await Promise.all([publish(PA, asset3, { ready: true }), publish(PA, asset3, { ready: true })]);
    addDelayMs = 0;
    for (const r of [q1, q2]) if (r.body?.listingId) created.push({ principalId: PA, gkAssetId: asset3.gkAssetId, listingId: r.body.listingId });
    const st2 = [q1.statusCode, q2.statusCode].sort();
    const loser = [q1, q2].find((r) => r.statusCode !== 200);
    console.log(`  observed (READY race): statuses=${JSON.stringify(st2)} loser=${loser?.body?.error} AddFixedPriceItem=${addCalls()}`);
    ok(addCalls() === 1, `READY race: exactly ONE provider publication (${addCalls()})`);
    ok(st2[0] === 200 && st2[1] === 409 && loser?.body?.error === 'PUBLICATION_IN_PROGRESS', `READY race: one 200 and one 409 PUBLICATION_IN_PROGRESS (${JSON.stringify(st2)} ${loser?.body?.error})`);
    const uploadsByLoser = fetchCalls.filter((c) => c.type === 'trading' && c.callName === 'GetUser').length;
    ok(uploadsByLoser <= 1, `the refused request made no GetUser / provider call of its own (GetUser calls: ${uploadsByLoser})`);

    // lock released after success: a later sequential request is a DUPLICATE, not "in progress"
    fetchCalls.length = 0;
    const after = await publish(PA, asset3, { ready: true });
    ok(after.statusCode === 409 && after.body?.error === 'DUPLICATE_ACTIVE_LISTING' && fetchCalls.length === 0, `after the winner finishes the mutex is free: next request -> DUPLICATE_ACTIVE_LISTING, zero provider calls (${after.body?.error})`);
  }

  // ═══ B: MIXED race -- READY request vs a request steered onto the Q41 path ═══
  console.log('\n-- B: MIXED concurrent race: one READY request + one Q41-steered request, same asset --');
  {
    const asset4 = await mint(PA, 'race-mixed', READY_AUTHORITY);
    fetchCalls.length = 0; addDelayMs = 300;
    const [m1, m2] = await Promise.all([publish(PA, asset4, { ready: true }), publish(PA, asset4, { ready: true, q41: true })]);
    addDelayMs = 0;
    for (const r of [m1, m2]) if (r.body?.listingId) created.push({ principalId: PA, gkAssetId: asset4.gkAssetId, listingId: r.body.listingId });
    const st3 = [m1.statusCode, m2.statusCode].sort();
    console.log(`  observed (MIXED race): statuses=${JSON.stringify(st3)} errors=${JSON.stringify([m1.body?.error, m2.body?.error])} AddFixedPriceItem=${addCalls()}`);
    ok(addCalls() === 1, `MIXED race: exactly ONE provider publication (${addCalls()})`);
    ok(st3[0] === 200 && st3[1] === 409, `MIXED race: one 200 and one 409 (${JSON.stringify(st3)})`);
  }

  // ═══ B: different assets never block each other ═══
  console.log('\n-- B: concurrent publications of DIFFERENT assets are independent --');
  {
    const x = await mint(PA, 'indep-x', READY_AUTHORITY);
    const y = await mint(PA, 'indep-y', READY_AUTHORITY);
    fetchCalls.length = 0; addDelayMs = 200;
    const [rx, ry] = await Promise.all([publish(PA, x, { ready: true }), publish(PA, y, { ready: true })]);
    addDelayMs = 0;
    for (const [r, as] of [[rx, x], [ry, y]]) if (r.body?.listingId) created.push({ principalId: PA, gkAssetId: as.gkAssetId, listingId: r.body.listingId });
    ok(rx.statusCode === 200 && ry.statusCode === 200 && addCalls() === 2, `two different assets both publish (${rx.statusCode}/${ry.statusCode}, adds=${addCalls()})`);
  }

  // ═══ B: the mutex is released on a provider failure (error path) ═══
  console.log('\n-- B: mutex released on the error path (definitive provider refusal, then retry) --');
  {
    const z = await mint(PA, 'fail-then-ok', READY_AUTHORITY);
    addBehavior = 'failure'; fetchCalls.length = 0;
    const f1 = await publish(PA, z, { ready: true });
    addBehavior = 'success';
    ok(f1.statusCode >= 400 && f1.body?.error !== 'PUBLICATION_IN_PROGRESS', `definitive provider failure -> refused, not stuck (${f1.statusCode} ${f1.body?.error})`);
    fetchCalls.length = 0;
    const f2 = await publish(PA, z, { ready: true });
    if (f2.body?.listingId) created.push({ principalId: PA, gkAssetId: z.gkAssetId, listingId: f2.body.listingId });
    ok(f2.statusCode === 200 && f2.body?.error !== 'PUBLICATION_IN_PROGRESS', `the next request is NOT blocked by the failed one (${f2.statusCode} ${f2.body?.error || ''})`);
  }

  // ═══ unit: the mutex primitive ═══
  console.log('\n-- mutex primitive: exclusivity, release, self-release timer, ownership --');
  {
    const u = await mint(PA, 'mutex-unit', NOT_READY_AUTHORITY);
    const m1 = await A.acquirePublicationMutex({ principalId: PA, gkAssetId: u.gkAssetId });
    const m2 = await A.acquirePublicationMutex({ principalId: PA, gkAssetId: u.gkAssetId });
    ok(m1.acquired === true && m2.acquired === false, 'first acquires, second is refused immediately (no waiting)');
    await m2.release();
    ok((await A.acquirePublicationMutex({ principalId: PA, gkAssetId: u.gkAssetId })).acquired === false, 'a refused release() does not free the holder\'s lock');
    await m1.release();
    const m3 = await A.acquirePublicationMutex({ principalId: PA, gkAssetId: u.gkAssetId });
    ok(m3.acquired === true, 'after the holder releases, the mutex can be taken again');
    await m3.release(); await m3.release(); // idempotent release
    const t1 = await A.acquirePublicationMutex({ principalId: PA, gkAssetId: u.gkAssetId, maxHoldMs: 150 });
    await new Promise((r) => setTimeout(r, 500));
    const t2 = await A.acquirePublicationMutex({ principalId: PA, gkAssetId: u.gkAssetId });
    ok(t1.acquired === true && t2.acquired === true, 'the bounded self-release timer frees a hung holder\'s lock');
    await t2.release();
    let foreignErr = null;
    try { await A.acquirePublicationMutex({ principalId: PB, gkAssetId: u.gkAssetId }); } catch (e) { foreignErr = e; }
    ok(foreignErr && /AuthorizationFailed|not own|owner/i.test(`${foreignErr.name} ${foreignErr.message}`), `a principal that does not own the asset cannot take its mutex (${foreignErr?.name})`);
    const held = await db.query(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND classid::bigint <> 0 AND granted`);
    console.log(`  (info) advisory locks currently granted in this database: ${held.rows[0].n}`);
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
