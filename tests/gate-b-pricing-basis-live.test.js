// tests/gate-b-pricing-basis-live.test.js
//
// GATE B (2026-10-21) -- REAL api/list-ebay.js handler + REAL Development Postgres + a mocked eBay fetch ONLY (a live eBay call is impossible: every unknown URL throws).
// Throwaway principals/assets are minted per run (permanent append-only Development fixtures, the repo convention). No Production access, no real asset, no Q41 against a real asset.
//   T1  mixed-generation pricing is refused BEFORE any eBay call and writes no authority row
//   T2  a coherent bundle is authorized; the AUTHORIZED row's evidence.pricingBasis is read back from the database
//   T3  REFUSED and null-price states cannot pass
//   T4  wrong-variant evidence cannot pass
//   T5  same-count / same-source substitution is NOT detected -- the stored snapshot says so (PARTIAL)
//   T6  the snapshot already exists when the provider call is made
//   T7  the snapshot is unchanged after a full-replace Collection write, and cannot be updated in place
//   T8  oversized and incomplete evidence are handled safely
//   T9  the approved price and a qualified engine prediction stay separate; no qualified prediction -> NOT_MEASURABLE
//   T10 NEGATIVE CONTROL: with the preflight and the service guard removed, the mixed-generation row reaches eBay (the tests can fail)
//   Invoke: GK_ENV_FILE=<path to .env.development.local> node tests/gate-b-pricing-basis-live.test.js

import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { metaFetch, shippingResponse, mockState } from './helpers/ebayPacketMocks.js';
import { __resetMetadataCachesForTests as resetMetadataCaches } from '../src/lib/ebayListingMetadata.js';
import { OML_FIVE, REGULAR_SIXTEEN, coherentBundle, historicalMixedRow } from './helpers/pricingBundleFixtures.js';
import { writeFileSync, unlinkSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
for (const line of readFileSync(process.env.GK_ENV_FILE || path.join(repoRoot, '.env.development.local'), 'utf8').split(/\r?\n/)) {
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

// ── eBay mock: the ONLY network surface. Unknown URLs/calls throw, so a live call is impossible. ──
const fetchCalls = [];
let addBehavior = 'success';          // success | definitive | system-error | http500 | network | noack
let addDelayMs = 0;
let orderProbe = null;                // async () => void, runs AT the moment AddFixedPriceItem is reached
let itemCounter = 0;
let lastAddBody = '';
const nextItemId = () => `b1-item-${Date.now()}-${++itemCounter}`;
const FAKE_HOSTED_URL = 'https://i.ebayimg.com/hosted/b1-picture.jpg';
mockState.mediaImageUrl = FAKE_HOSTED_URL;
const TINY_PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
global.fetch = async (url, opts = {}) => {
  const urlStr = String(url);
  const __m = metaFetch(urlStr, opts); if (__m) return __m;
  if (urlStr.includes('identity/v1/oauth2/token')) {
    const rc = new URLSearchParams(String(opts.body || '')).get('refresh_token');
    fetchCalls.push({ type: 'refresh' });
    return { ok: true, status: 200, json: async () => ({ access_token: `access-for-${rc}`, expires_in: 7200 }) };
  }
  const callName = opts?.headers?.['X-EBAY-API-CALL-NAME'];
  if (!callName) throw new Error(`test fetch mock: unexpected non-Trading call to "${urlStr}" -- a live call is impossible`);
  fetchCalls.push({ type: 'trading', callName });
  if (callName === 'GeteBayDetails') return shippingResponse();
  if (callName === 'GetUser') return { status: 200, text: async () => '<?xml version="1.0"?><GetUserResponse><Ack>Success</Ack><User><UserID>b1-seller</UserID><Site>US</Site></User></GetUserResponse>' };
  if (callName === 'AddFixedPriceItem') {
    lastAddBody = String(opts.body || '');
    if (orderProbe) await orderProbe();
    if (addDelayMs) await new Promise((r) => setTimeout(r, addDelayMs));
    if (addBehavior === 'network') throw new Error('socket hang up (test-forced)');
    if (addBehavior === 'http500') return { status: 500, text: async () => '<html>upstream error</html>' };
    if (addBehavior === 'noack') return { status: 200, text: async () => '<garbage/>' };
    if (addBehavior === 'system-error') return { status: 200, text: async () => '<AddFixedPriceItemResponse><Ack>Failure</Ack><Errors><SeverityCode>Error</SeverityCode><ErrorCode>10007</ErrorCode><ShortMessage>System error</ShortMessage></Errors></AddFixedPriceItemResponse>' };
    if (addBehavior === 'definitive') return { status: 200, text: async () => '<AddFixedPriceItemResponse><Ack>Failure</Ack><Errors><SeverityCode>Error</SeverityCode><ErrorCode>21919136</ErrorCode><ShortMessage>eBay requires at least one photo</ShortMessage></Errors></AddFixedPriceItemResponse>' };
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
const { enrollAsset, reserveAsset } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'inventory', 'index.js')).href);
const { createCollectionItem, updateCollectionItem } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'collection', 'index.js')).href);
const { issueAuthorityReceipt, computeEvidenceVersion, EXECUTION_AUTHORITY_KEYS } = await import(pathToFileURL(path.join(repoRoot, 'src', 'lib', 'authorityReceipt.js')).href);
const { decisionGovernance } = await import(pathToFileURL(path.join(repoRoot, 'src', 'lib', 'decisionTrust.js')).href);
const { attemptCorrelation, verifyAuthoritySnapshot } = await import(pathToFileURL(path.join(repoRoot, 'src', 'lib', 'operatorAuthority.js')).href);
const listHandler = (await import(pathToFileURL(path.join(repoRoot, 'api', 'list-ebay.js')).href)).default;

const db = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const nonce = (l) => `b1-${l}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
async function newPrincipal(label) {
  const id = (await db.query('SELECT uuidv7() AS id')).rows[0].id;
  await db.query(`INSERT INTO data1_dev.gk_principal (id, display_name, kind) VALUES ($1, $2, 'operator')`, [id, label]);
  return id;
}

// A listable throwaway asset with a durable PRICING BUNDLE. Execution-deciding keys reach the row only through a real server-issued receipt (the production path);
// `receiptPoolCount` lets a test sign a DIFFERENT pool size than the durable pool holds (the recorded mixed generation).
async function mint(principalId, label, o = {}) {
  const n = nonce(label);
  const { assetId: gkAssetId } = await A.createPhysicalAsset({ principalId, captureBasis: { test: true, label, n }, assetClass: 'comic', source: 'test-fixture', idempotencyKey: `${n}-mint` });
  await enrollAsset({ principalId, gkAssetId, idempotencyKey: `${n}-enroll` });
  const canonicalId = `cv_${n}`;
  const b = o.bundle || coherentBundle(OML_FIVE);
  const plainAttrs = { title: 'Old Man Logan', issue: '25', year: '2017', publisher: 'Marvel', variant: b.variant, price: b.price, rawComps: b.rawComps, comps: b.comps, priceBands: b.priceBands, priceDerivationTrace: b.priceDerivationTrace, ...(o.plain || {}) };
  if (o.noBundle) for (const k of ['price', 'rawComps', 'comps', 'priceBands', 'priceDerivationTrace', 'variant']) delete plainAttrs[k];
  await createCollectionItem({ principalId, id: canonicalId, assetCategory: 'comic', attributes: plainAttrs });
  await A.linkCollectionItem({ principalId, collectionItemId: canonicalId, gkAssetId, idempotencyKey: `${n}-link` });
  let decisionEventId;
  if (o.serverDerived) {
    ({ decisionEventId } = await A.recordEconomicDecision({ principalId, gkAssetId, valueAmount: o.serverDerived, method: 'engine-computed', buildSha: 'gate-b-test', recommendation: o.recommendation || 'LIST_NOW', reasonCodes: [], semanticFingerprint: `econ-v1:${n}` }));
  } else {
    ({ decisionEventId } = await A.recordDecision({ principalId, gkAssetId, recommendation: o.recommendation || 'RESEARCH', idempotencyKey: `${n}-decision` }));
  }
  await A.attachMedia({ principalId, gkAssetId, bytes: Buffer.from(TINY_PNG_DATA_URL.split(',')[1], 'base64'), contentType: 'image/png', captureRole: 'capture-photo', idempotencyKey: `${n}-photo` });
  const { operatorActionEventId } = await A.recordOperatorAction({ principalId, gkAssetId, decisionEventId, actionCode: 'LIST', actionValueAmount: o.listAmount ?? 25, source: 'test-fixture', idempotencyKey: `${n}-action` });
  if (!o.noReceipt) {
    const hashes = await A.getAssetMediaContentHashes({ principalId, gkAssetId });
    const exec = { ...(b.exec || {}), ...(o.exec || {}) };
    const authorityReceipt = issueAuthorityReceipt({ principalId, binding: { collectionItemId: canonicalId, gkAssetId, evidenceVersion: computeEvidenceVersion(hashes) },
      response: { title: plainAttrs.title, issue: plainAttrs.issue, year: plainAttrs.year, rawComps: { count: o.receiptPoolCount ?? (b.rawComps ? b.rawComps.count : 0) }, ...exec } });
    await updateCollectionItem({ principalId, id: canonicalId, assetCategory: 'comic', attributes: { ...plainAttrs, authorityReceipt } });
  }
  return { gkAssetId, decisionEventId, operatorActionEventId, principalId, canonicalId, plainAttrs, bundle: b };
}
function req(principalId, asset, o = {}) {
  const { token } = issueToken({ principalId });
  const amount = o.amount ?? 25;
  const body = {
    title: 'CLIENT TITLE (ignored)', publisher: 'x', year: '1990', price: `$${Number(amount).toFixed(2)}`, grade: 'VF',
    gkAssetId: asset.gkAssetId, decisionEventId: asset.decisionEventId, operatorActionEventId: asset.operatorActionEventId, images: [TINY_PNG_DATA_URL],
    ...(o.noAck ? {} : { q41Override: o.ack || { priceOverridden: true, manualPrice: amount, lockClassAcknowledged: 'insufficiency', locks: ['no-sold-evidence'], state: 'REVIEW', decision: 'RESEARCH' } }),
    ...(o.body || {}),
  };
  return { method: 'POST', headers: o.noToken ? {} : { authorization: `Bearer ${token}` }, body };
}
// V1.1a: a publish needs the seller's server-signed listing-package approval; obtain it from the REAL approve endpoint.
const { makeApprover } = await import(pathToFileURL(path.join(repoRoot, 'tests', 'helpers', 'listingApprovalFixture.mjs')).href);
const attachApproval = makeApprover({ repoRoot, mockRes, tag: 'gateb-approver' });
async function call(principalId, asset, o) { fetchCalls.length = 0; const res = mockRes(); await listHandler(await attachApproval(req(principalId, asset, o)), res); return res; }
async function ledger(assetId) { return (await db.query(`SELECT * FROM data1_dev.operator_authority_event WHERE gk_asset_id = $1 ORDER BY recorded_at, id`, [assetId])).rows; }
const phasesOf = (rows) => rows.map((r) => r.phase);
async function snap(table, col, assetId) { return JSON.stringify((await db.query(`SELECT * FROM data1_dev.${table} WHERE ${col} = $1 ORDER BY id`, [assetId])).rows); }

console.log('\n=== GATE B live: pricing-bundle coherence + immutable pricingBasis (real handler, real Development DB, mocked eBay) ===\n');

const PA = await newPrincipal('gateb-principal-a');
await upsertMarketplaceConnection({ principalId: PA, provider: 'EBAY', providerUserId: `gateb-ebay-${nonce('i')}`, refreshCredential: `fake-refresh-${nonce('a')}`, grantedScopes: [...CONNECT_SCOPES] });
const createdListings = [];
const NOCHECK_PATH = path.join(repoRoot, 'api', 'zz-list-ebay-nocheck.js');
const authRow = async (assetId) => (await db.query(`SELECT * FROM data1_dev.operator_authority_event WHERE gk_asset_id = $1 AND phase = 'AUTHORIZED'`, [assetId])).rows[0];
const AMT = 15.29;
const amountOf = (b) => Number(b.priceBands.market.replace('$', ''));

try {
  // T1: the recorded mixed generation (6-pool aggregate + 16-regular-cover pool/bands/trace + $15.10)
  console.log('-- T1: mixed-generation pricing is refused before any eBay call --');
  const hist = historicalMixedRow();
  const mixed = await mint(PA, 'mixed', { bundle: hist, receiptPoolCount: hist.receiptPoolCount, listAmount: AMT });
  let res = await call(PA, mixed, { amount: AMT });
  ok(res.statusCode === 409 && res.body?.error === 'PRICING_BUNDLE_INCOHERENT', `T1 mixed generation -> 409 PRICING_BUNDLE_INCOHERENT (${res.statusCode} ${res.body?.error})`);
  ok(!anyTrading() && addCalls() === 0, 'T1 ZERO eBay network calls (no image upload, no GetUser, no AddFixedPriceItem)');
  ok((await ledger(mixed.gkAssetId)).length === 0, 'T1 no operator authority row was written');
  const vids = (res.body?.violations || []).map((v) => v.id);
  ok(['RECEIPT_COUNT', 'POOL_GENERATION', 'PRICE_TRACE', 'VARIANT_EVIDENCE', 'WRONG_VARIANT_ROWS', 'VARIANT_APPLICABILITY'].every((id) => vids.includes(id)), `T1 the response names the demonstrated inconsistencies (${vids.join(',')})`);
  ok(res.body?.protection === 'PARTIAL', 'T1 the refusal itself states the control is PARTIAL');

  // T2 / T6 / T7 / T9: a coherent bundle
  console.log('\n-- T2/T6/T7/T9: coherent authorized pricing, snapshot timing, immutability, price/prediction separation --');
  const good = await mint(PA, 'good', { listAmount: AMT });
  let probed = null;
  orderProbe = async () => { const r = await authRow(good.gkAssetId); probed = r && r.evidence && r.evidence.pricingBasis ? r.evidence.pricingBasis : null; };
  addBehavior = 'success';
  res = await call(PA, good, { amount: AMT });
  orderProbe = null;
  createdListings.push(res.body?.listingId);
  ok(res.statusCode === 200 && res.body?.ok === true && addCalls() === 1, `T2 a coherent authorized bundle lists (${res.statusCode}) with exactly one provider write`);
  ok(probed && probed.schemaVersion === 'pricing-basis-v1', 'T6 at the moment of AddFixedPriceItem the AUTHORIZED row ALREADY holds evidence.pricingBasis (snapshot precedes the provider write)');
  const a1 = await authRow(good.gkAssetId);
  const pb = a1.evidence.pricingBasis;
  ok(!!pb && a1.evidence.primary === 'DURABLE_CATALOGUE', 'T2 database readback: the AUTHORIZED evidence JSONB carries pricingBasis beside the existing evidence fields');
  ok(pb.coherence.coherent === true && pb.coherence.protection === 'PARTIAL' && /NOT detectable/.test(pb.coherence.limitation), 'T2 stored coherence verdict is coherent, labelled PARTIAL, with the limitation text');
  ok(pb.provenance.source === 'SERVER_HELD_CATALOGUE' && pb.provenance.pricingFieldsSigned === false, 'T2 stored provenance discloses the pricing fields are client-writable and not receipt-signed');
  ok(pb.reconstructability.verdict === 'FULL' && pb.pool.recordCount === 5 && pb.pool.poolCount === 5, `T2 reconstructability FULL (5 of 5 records) -- ${pb.reconstructability.verdict}`);
  ok(pb.identity.title === 'Old Man Logan' && pb.identity.issue === '25' && pb.identity.year === '2017' && pb.identity.publisher === 'Marvel' && pb.identity.variant === '1:25', 'T2 stored identity facts at approval');
  ok(pb.bands && pb.bands.market === '$15.29' && pb.bands.variantEvidence.applicable === 5 && pb.derivation.finalPrice === 15.29, 'T2 stored bands and derivation');
  ok(pb.receipt.verified === true && pb.receipt.signedPoolCount === 5 && pb.receipt.bindingState === 'BOUND' && /^[0-9a-f]{64}$/.test(pb.receipt.bodySha256) && !!pb.photoEvidence.currentEvidenceVersion, 'T2 stored receipt reference (signed count, bound, body hash) and photo-evidence version');
  ok(pb.market.verifiedSoldCount === 0 && pb.market.pricingSource === 'active_ask_derived', 'T2 stored pricing source and verified-sold count (0)');
  ok(pb.approved.amount === '15.29' && /NOT an engine prediction/.test(pb.approved.meaning), 'T9 the approved LIST price is stored and labelled an operator decision');
  ok(pb.enginePrediction.qualified === false && pb.enginePrediction.valueAmount === null && pb.predictionErrorScoring === 'NOT_MEASURABLE', 'T9 no qualified prediction exists -> none is claimed and prediction-error scoring is NOT_MEASURABLE');
  // T7
  const before = JSON.stringify(a1.evidence);
  await updateCollectionItem({ principalId: PA, id: good.canonicalId, assetCategory: 'comic', attributes: { ...good.plainAttrs, price: '$1.00', priceBands: { tier: 3, count: 1, market: '$1.00', source: 'x' }, rawComps: { count: 1, prices: [] }, comps: { count: 1 } } });
  ok(JSON.stringify((await authRow(good.gkAssetId)).evidence) === before, 'T7 the snapshot is byte-identical after a full-replace Collection write that wipes the bundle');
  ok((await db.query(`SELECT attributes->>'price' AS p FROM data1_dev.collection_item WHERE id = $1`, [good.canonicalId])).rows[0].p === '$1.00', 'T7 (control) the Collection write really did replace the live bundle');
  let rej = false; try { await db.query(`UPDATE data1_dev.operator_authority_event SET evidence = '{}'::jsonb WHERE id = $1`, [a1.id]); } catch (e) { rej = /append-only/i.test(e.message); }
  ok(rej, 'T7 an in-place UPDATE of the snapshot is rejected by the database (append-only trigger)');

  // T9: a SERVER_DERIVED valuation anchors the decision -> a qualified prediction
  const qual = await mint(PA, 'qualified', { listAmount: 25, serverDerived: 15.29, recommendation: 'RESEARCH' });
  addBehavior = 'success'; res = await call(PA, qual, { amount: 25 }); createdListings.push(res.body?.listingId);
  const qb = (await authRow(qual.gkAssetId))?.evidence?.pricingBasis;
  ok(res.statusCode === 200 && qb && qb.enginePrediction.qualified === true && qb.enginePrediction.valueAmount === '15.29' && qb.approved.amount === '25.00', `T9 qualified: engine prediction $15.29 and operator-approved $25.00 are separate fields (${res.statusCode})`);
  ok(qb && qb.predictionErrorScoring === 'MEASURABLE' && qb.enginePrediction.provenance === 'SERVER_DERIVED', 'T9 qualified prediction -> scoring MEASURABLE, provenance SERVER_DERIVED');

  // T3: refused / null-price states
  console.log('\n-- T3: REFUSED and null-price states cannot pass --');
  {
    const refused = await mint(PA, 'refused', { listAmount: AMT, exec: { refusedToPrice: true, pricingSource: 'refused-variant-evidence-insufficient', contract: { state: 'REFUSED', listable: false, locks: [] } } });
    res = await call(PA, refused, { amount: AMT });
    ok(res.statusCode === 409 && res.body?.error === 'PRICING_BUNDLE_INCOHERENT' && (res.body.violations || []).some((v) => v.id === 'REFUSED_OR_NO_PRICE') && !anyTrading() && (await ledger(refused.gkAssetId)).length === 0, `T3 a REFUSED receipt state is refused with zero eBay calls and no authority row (${res.statusCode} ${res.body?.error})`);
    const nullPrice = await mint(PA, 'nullprice', { listAmount: AMT, plain: { price: null } });
    res = await call(PA, nullPrice, { amount: AMT });
    ok(res.statusCode === 409 && (res.body?.violations || []).some((v) => v.id === 'REFUSED_OR_NO_PRICE') && !anyTrading(), `T3 bands with a null stored price are refused (${res.statusCode})`);
  }

  // T4: wrong-variant evidence
  console.log('\n-- T4: wrong-variant evidence cannot pass --');
  {
    const wrong = await mint(PA, 'wrongvariant', { bundle: coherentBundle(REGULAR_SIXTEEN, { withVariantEvidence: false }), listAmount: AMT });
    res = await call(PA, wrong, { amount: AMT });
    ok(res.statusCode === 409 && res.body?.error === 'PRICING_BUNDLE_INCOHERENT' && (res.body.violations || []).some((v) => v.id === 'WRONG_VARIANT_ROWS') && !anyTrading() && (await ledger(wrong.gkAssetId)).length === 0, `T4 sixteen regular covers priced as the confirmed 1:25 are refused, zero eBay calls (${res.statusCode})`);
  }

  // T5: same-count / same-source substitution
  console.log('\n-- T5: same-count / same-source substitution is NOT detected and the limitation is stored --');
  {
    const substituted = coherentBundle([[60, 'Old Man Logan #25 1:25 Deodato Variant substituted A'], [61, 'Old Man Logan #25 1:25 Deodato Variant substituted B'], [62, 'Old Man Logan #25 1:25 Deodato Variant substituted C'], [63, 'Old Man Logan #25 1:25 Deodato Variant substituted D'], [64, 'Old Man Logan #25 1:25 Deodato Variant substituted E']]);
    const sub = await mint(PA, 'substituted', { bundle: substituted, listAmount: amountOf(substituted) });
    addBehavior = 'success'; res = await call(PA, sub, { amount: amountOf(substituted) }); createdListings.push(res.body?.listingId);
    ok(res.statusCode === 200, `T5 the substituted-but-self-consistent bundle is NOT refused (${res.statusCode}) -- the documented PARTIAL limitation`);
    const sb = (await authRow(sub.gkAssetId))?.evidence?.pricingBasis;
    ok(sb && sb.coherence.protection === 'PARTIAL' && /NOT detectable/.test(sb.coherence.limitation) && sb.provenance.pricingFieldsSigned === false, 'T5 the immutable snapshot of that authorization states PARTIAL protection, the limitation, and that the pricing fields are unsigned');
  }

  // T8: oversized and incomplete evidence
  console.log('\n-- T8: oversized and incomplete evidence are handled safely --');
  {
    const big = coherentBundle(Array.from({ length: 300 }, (_, i) => [10 + (i % 5), `Old Man Logan #25 1:25 Deodato Variant ${'y'.repeat(150)} ${i}`]));
    const bigAsset = await mint(PA, 'oversized', { bundle: big, listAmount: amountOf(big) });
    addBehavior = 'success'; res = await call(PA, bigAsset, { amount: amountOf(big) }); createdListings.push(res.body?.listingId);
    const bb = (await authRow(bigAsset.gkAssetId))?.evidence?.pricingBasis;
    const bytes = bb ? Buffer.byteLength(JSON.stringify(bb), 'utf8') : -1;
    ok(res.statusCode === 200 && bb && bytes > 0 && bytes <= 16384, `T8 a 300-record pool authorizes and the stored snapshot is bounded (${bytes} bytes <= 16384)`);
    ok(bb && bb.pool.truncated === true && bb.reconstructability.verdict !== 'FULL', 'T8 the bounded snapshot is flagged truncated and is not FULL');
    const bare = await mint(PA, 'incomplete', { noBundle: true, listAmount: 25 });
    addBehavior = 'success'; res = await call(PA, bare, { amount: 25 }); createdListings.push(res.body?.listingId);
    const ib = (await authRow(bare.gkAssetId))?.evidence?.pricingBasis;
    ok(res.statusCode === 200 && ib && ib.reconstructability.verdict === 'NOT_RECONSTRUCTABLE' && ib.reconstructability.missing.includes('comparable records'), `T8 a row with no pricing bundle still authorizes (no demonstrated inconsistency) but is recorded NOT_RECONSTRUCTABLE (${res.statusCode})`);
  }

  // T4b: the SERVICE refuses an incoherent basis on its own (defense in depth), independent of the handler
  console.log('\n-- T4b: the service independently refuses an incoherent pricingBasis --');
  {
    const svc = await mint(PA, 'service-guard', { listAmount: AMT });
    let code = null;
    try { await A.authorizeOperatorManualListing({ principalId: PA, gkAssetId: svc.gkAssetId, decisionEventId: svc.decisionEventId, operatorActionEventId: svc.operatorActionEventId, outgoingAmount: AMT, ackPayload: { priceOverridden: true, manualPrice: AMT }, ackWarnings: {}, durableAttrs: svc.plainAttrs, presentedAttrs: {}, pricingBasis: { coherence: { coherent: false, violations: [{ id: 'X' }] } } }); }
    catch (e) { code = String(e.message).slice(0, 40); }
    ok(/^PRICING_BUNDLE_INCOHERENT/.test(code || '') && (await ledger(svc.gkAssetId)).length === 0, `T4b the service refuses an incoherent basis and writes no authority row (${code})`);
  }

  // T10: negative control -- remove the preflight AND the service guard
  console.log('\n-- T10: negative control -- with the validation disabled the mixed row reaches eBay --');
  {
    let src = readFileSync(path.join(repoRoot, 'api', 'list-ebay.js'), 'utf8').replace(/\r\n/g, '\n');
    const guardStart = src.indexOf('    if (pricingBasisRefuses(pricingBasisForAuthority)) {');
    const guardEnd = src.indexOf('    // GATE-B-COHERENCE-END');
    if (guardStart < 0 || guardEnd < guardStart) throw new Error('negative-control anchors not found');
    src = src.slice(0, guardStart) + src.slice(guardEnd);
    src = src.replace('          pricingBasis: pricingBasisForAuthority,\n', '');
    writeFileSync(NOCHECK_PATH, src);
    const noCheck = (await import(pathToFileURL(NOCHECK_PATH).href + `?v=${Date.now()}`)).default;
    const mixed2 = await mint(PA, 'mixed-nocheck', { bundle: hist, receiptPoolCount: hist.receiptPoolCount, listAmount: AMT });
    fetchCalls.length = 0; const r2 = mockRes(); addBehavior = 'success'; await noCheck(await attachApproval(req(PA, mixed2, { amount: AMT })), r2);
    createdListings.push(r2.body?.listingId);
    ok(r2.statusCode === 200 && addCalls() === 1, `T10 NEGATIVE CONTROL: with the guard removed the SAME mixed-generation row is listed (${r2.statusCode}, ${addCalls()} AddFixedPriceItem) -- the T1 test can fail`);
    ok(!(await authRow(mixed2.gkAssetId))?.evidence?.pricingBasis, 'T10 and no pricingBasis snapshot is stored without the guard path (the snapshot rides the same wiring)');
  }
} finally {
  try { unlinkSync(NOCHECK_PATH); } catch { /* absent */ }
  await db.query(`DELETE FROM data1_dev.marketplace_connection WHERE principal_id = $1`, [PA]);
  const ids = createdListings.filter(Boolean);
  if (ids.length) await db.query(`DELETE FROM data1_dev.outcome_event WHERE external_listing_id = ANY($1)`, [ids]);
  console.log('\n  (cleanup) marketplace_connection and transient LISTED outcome_event rows deleted; the temporary no-guard handler copy removed. Append-only authority rows, gk_principal and gk_asset rows are permanent Development fixtures (repo convention).');
  await db.end();
}
console.log(`\n${'='.repeat(60)}\nGATE B LIVE: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('\nFAILURES:'); failures.forEach((f) => console.log('  ✗ ' + f)); }
process.exit(failed > 0 ? 1 : 0);
