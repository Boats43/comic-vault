// tests/b1-operator-authority-live.test.js
//
// Dispatch B1 -- GK-284 / GK-288, B6 failure-and-retry tests #1-#13. REAL api/list-ebay.js handler, REAL
// Development Postgres (throwaway principals/assets minted per run -- permanent append-only Development
// fixtures, the repo convention), and a mocked eBay `fetch` ONLY. NO live eBay call is possible: global.fetch is
// replaced before the handler is imported and refuses any URL it does not recognise.
//
// Predeclared tests (B6):
//  1 Q41 acknowledgment persists with the exact approved price
//  2 the authority record is bound to the correct asset and principal
//  3 RESEARCH remains the engine recommendation after operator approval
//  4 missing or forged approval cannot authorize a listing
//  5 another principal cannot authorize the asset
//  6 unavailable or reserved inventory is rejected
//  7 duplicate marketplace execution remains blocked
//  8 historical decisions are not rewritten
//  9 New Mutants #98 contradictory historical data cannot appear as current governed LIST_NOW authority
// 10 a failed AddFixedPriceItem attempt leaves an explicit recoverable outcome
// 11 retry cannot create a duplicate listing
// 12 an ambiguous provider response must be reconciled before retry
// 13 a durable authorization without a successful listing is distinguishable from an executed listing
//
//   node tests/b1-operator-authority-live.test.js

import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { metaFetch, shippingResponse, mockState } from './helpers/ebayPacketMocks.js';
import { __resetMetadataCachesForTests as resetMetadataCaches } from '../src/lib/ebayListingMetadata.js';

import { createHash as __createHash } from 'node:crypto';
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
const rawListHandler = (await import(pathToFileURL(path.join(repoRoot, 'api', 'list-ebay.js')).href)).default;
// V1.1a -- a publish needs the seller's server-signed APPROVAL of the exact package; obtained from the REAL api/listing-preview.js approve action (never forged).
const __attachApproval = (await import(pathToFileURL(path.join(repoRoot, 'tests', 'helpers', 'listingApprovalFixture.mjs')).href)).makeApprover({ repoRoot, mockRes: () => mockRes(), tag: 'b1-operato' });
const listHandler = async (req, res) => { await __attachApproval(req); return rawListHandler(req, res); };

const db = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const nonce = (l) => `b1-${l}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
async function newPrincipal(label) {
  const id = (await db.query('SELECT uuidv7() AS id')).rows[0].id;
  await db.query(`INSERT INTO data1_dev.gk_principal (id, display_name, kind) VALUES ($1, $2, 'operator')`, [id, label]);
  return id;
}

// A listable throwaway asset: minted, enrolled (AVAILABLE), governed catalogue row, linked, photo, decision, priced LIST action.
async function mint(principalId, label, o = {}) {
  const n = nonce(label);
  const { assetId: gkAssetId } = await A.createPhysicalAsset({ principalId, captureBasis: { test: true, label, n }, assetClass: 'comic', source: 'test-fixture', idempotencyKey: `${n}-mint` });
  if (o.enroll !== false) await enrollAsset({ principalId, gkAssetId, idempotencyKey: `${n}-enroll` });
  const canonicalId = `cv_${n}`;
  // AUTHORITY SPLIT: execution-deciding fields (decision / pricingSource / soldCompDiagnostics / contract ...) are never written as plain Collection attributes -- the
  // server discards client-written copies. A fixture that wants them 'durable' must obtain them the way production does: a server-issued receipt bound to this principal,
  // this row, this asset and its current evidence version (issued below, once the final media set exists, via the real issueAuthorityReceipt + updateCollectionItem).
  const fixtureAttrs = o.attributes || { title: 'B1 Test Comic', publisher: 'Test Publisher', year: '1990' };
  const authorityValues = Object.fromEntries(Object.entries(fixtureAttrs).filter(([k]) => EXECUTION_AUTHORITY_KEYS.includes(k)));
  const plainAttrs = Object.fromEntries(Object.entries(fixtureAttrs).filter(([k]) => !EXECUTION_AUTHORITY_KEYS.includes(k)));
  await createCollectionItem({ principalId, id: canonicalId, assetCategory: 'comic', attributes: plainAttrs });
  await A.linkCollectionItem({ principalId, collectionItemId: canonicalId, gkAssetId, idempotencyKey: `${n}-link` });
  let decisionEventId;
  if (o.serverDerived) {
    ({ decisionEventId } = await A.recordEconomicDecision({ principalId, gkAssetId, valueAmount: o.serverDerived, method: 'engine-computed', buildSha: 'b1-test', recommendation: o.recommendation || 'LIST_NOW', reasonCodes: [], semanticFingerprint: `econ-v1:${n}` }));
  } else {
    ({ decisionEventId } = await A.recordDecision({ principalId, gkAssetId, recommendation: o.recommendation || 'RESEARCH', idempotencyKey: `${n}-decision` }));
  }
  await A.attachMedia({ principalId, gkAssetId, bytes: Buffer.from(TINY_PNG_DATA_URL.split(',')[1], 'base64'), contentType: 'image/png', captureRole: 'capture-photo', idempotencyKey: `${n}-photo` });
  const { operatorActionEventId } = await A.recordOperatorAction({
    principalId, gkAssetId, decisionEventId, actionCode: o.actionCode || 'LIST', actionValueAmount: o.recordPrice === false ? undefined : (o.listAmount ?? 25), source: 'test-fixture', idempotencyKey: `${n}-action`,
  });
  if (o.receipt !== false) { // C1: every publishable row carries a genuine server-issued receipt (the gate is not relaxed)
    const hashes = await A.getAssetMediaContentHashes({ principalId, gkAssetId });
    const authorityReceipt = issueAuthorityReceipt({ principalId, binding: { collectionItemId: canonicalId, gkAssetId, evidenceVersion: computeEvidenceVersion(hashes) },
      response: { title: plainAttrs.title, issue: plainAttrs.issue ?? null, year: plainAttrs.year ?? null, ...authorityValues } });
    await updateCollectionItem({ principalId, id: canonicalId, assetCategory: 'comic', attributes: { ...plainAttrs, authorityReceipt } });
  }
  return { gkAssetId, decisionEventId, operatorActionEventId, principalId, canonicalId };
}
function req(principalId, asset, o = {}) {
  const { token } = issueToken({ principalId });
  const amount = o.amount ?? 25;
  const body = {
    title: 'CLIENT TITLE (ignored)', publisher: 'x', year: '1990', price: `$${Number(amount).toFixed(2)}`, grade: 'VF',
    gkAssetId: asset.gkAssetId, decisionEventId: asset.decisionEventId, operatorActionEventId: asset.operatorActionEventId, approvedPhotoHashes: [__createHash('sha256').update(Buffer.from(TINY_PNG_DATA_URL.split(',')[1], 'base64')).digest('hex')],
    ...(o.noAck ? {} : { q41Override: o.ack || { priceOverridden: true, manualPrice: amount, lockClassAcknowledged: 'insufficiency', locks: ['no-sold-evidence'], state: 'REVIEW', decision: 'RESEARCH' } }),
    ...(o.body || {}),
  };
  return { method: 'POST', headers: o.noToken ? {} : { authorization: `Bearer ${token}` }, body };
}
async function call(principalId, asset, o) { fetchCalls.length = 0; const res = mockRes(); await listHandler(req(principalId, asset, o), res); return res; }
async function ledger(assetId) { return (await db.query(`SELECT * FROM data1_dev.operator_authority_event WHERE gk_asset_id = $1 ORDER BY recorded_at, id`, [assetId])).rows; }
const phasesOf = (rows) => rows.map((r) => r.phase);
async function snap(table, col, assetId) { return JSON.stringify((await db.query(`SELECT * FROM data1_dev.${table} WHERE ${col} = $1 ORDER BY id`, [assetId])).rows); }

console.log('\n=== B1 live: GK-284 OPERATOR_MANUAL authority + attempt ledger (real handler, real Development DB, mocked eBay) ===\n');

const createdListings = [];
const PA = await newPrincipal('b1-principal-a');
const PB = await newPrincipal('b1-principal-b');
await upsertMarketplaceConnection({ principalId: PA, provider: 'EBAY', providerUserId: `b1-ebay-a-${nonce('ia')}`, refreshCredential: `fake-refresh-a-${nonce('a')}`, grantedScopes: [...CONNECT_SCOPES] });
await upsertMarketplaceConnection({ principalId: PB, provider: 'EBAY', providerUserId: `b1-ebay-b-${nonce('ib')}`, refreshCredential: `fake-refresh-b-${nonce('b')}`, grantedScopes: [...CONNECT_SCOPES] });

try {
  // ═════════════════════════ #1 #2 #3 #8 -- the success path ═════════════════════════
  console.log('-- #1-#3, #8: operator-approved RESEARCH listing (success) --');
  {
    const asset = await mint(PA, 'research', { recommendation: 'RESEARCH' });
    const decisionsBefore = await snap('decision_event', 'asset_id', asset.gkAssetId);
    const actionsBefore = await snap('operator_action_event', 'gk_asset_id', asset.gkAssetId);
    const valuationsBefore = await snap('valuation_event', 'asset_id', asset.gkAssetId);
    let probed = null;
    orderProbe = async () => { probed = phasesOf(await ledger(asset.gkAssetId)); };
    addBehavior = 'success';
    const res = await call(PA, asset);
    orderProbe = null;
    ok(res.statusCode === 200 && res.body?.ok === true, `the operator-approved listing succeeds (${res.statusCode})`);
    ok(addCalls() === 1, 'exactly one AddFixedPriceItem call');
    ok(JSON.stringify(probed) === JSON.stringify(['AUTHORIZED', 'SUBMITTED']), `at the moment of the provider call the ledger already holds AUTHORIZED then SUBMITTED, and no result (${JSON.stringify(probed)})`);
    createdListings.push(res.body?.listingId);
    const rows = await ledger(asset.gkAssetId);
    const auth = rows.find((r) => r.phase === 'AUTHORIZED');
    ok(JSON.stringify(phasesOf(rows)) === JSON.stringify(['AUTHORIZED', 'SUBMITTED', 'LISTED_CONFIRMED']), `full attempt recorded: ${JSON.stringify(phasesOf(rows))}`);
    // #1
    ok(Number(auth.approved_amount) === 25 && auth.approved_currency === 'USD', '#1 the exact approved price and currency are persisted (25.00 USD)');
    ok(auth.ack_payload.priceOverridden === true && auth.ack_payload.manualPrice === 25 && auth.ack_payload.lockClassAcknowledged === 'insufficiency', '#1 the acknowledgment payload is persisted');
    ok(auth.ack_warnings && 'authorityState' in auth.ack_warnings && Array.isArray(auth.ack_warnings.freshLockCodes), '#1 the applicable warnings (server-derived) are persisted');
    ok(auth.authority_type === 'OPERATOR_MANUAL' && !!auth.approved_at, '#1 authority type OPERATOR_MANUAL and the approval timestamp are persisted');
    ok(auth.evidence && auth.evidence.primary === 'DURABLE_CATALOGUE' && 'evidenceClass' in (auth.evidence.clientPresented || auth.evidence.durableCatalogue || {}), '#1 the evidence class / verified-sold basis is persisted');
    ok(Number(res.body?.authority?.approvedAmount) === 25, '#1 the response reports the approved amount');
    const outgoing = res.body; // StartPrice equality is proven by the price-binding gate; also assert the LISTED outcome ask
    const oe = (await db.query(`SELECT ask_amount FROM data1_dev.outcome_event WHERE gk_asset_id = $1 AND outcome_type = 'LISTED'`, [asset.gkAssetId])).rows[0];
    ok(oe && Number(oe.ask_amount) === 25, '#1 the LISTED outcome ask equals the approved price');
    // #2
    ok(auth.gk_asset_id === asset.gkAssetId && auth.principal_id === PA && auth.operator_action_event_id === asset.operatorActionEventId && auth.decision_event_id === asset.decisionEventId, '#2 bound to the correct asset, principal, LIST operator action and decision');
    ok(rows.every((r) => r.gk_asset_id === asset.gkAssetId && r.principal_id === PA && r.operator_action_event_id === asset.operatorActionEventId), '#2 every phase row carries the same asset / principal / operator action');
    ok(rows.find((r) => r.phase === 'LISTED_CONFIRMED').external_listing_id === res.body.listingId, '#2 the confirmed marketplace listing id is recorded on the attempt');
    ok(!!auth.attempt_id && rows.every((r) => r.attempt_id === auth.attempt_id), '#2 the marketplace attempt identifier ties the phases together');
    // #3
    ok(auth.engine_recommendation === 'RESEARCH', '#3 the original engine recommendation recorded with the approval is RESEARCH');
    ok(res.body?.authority?.engineRecommendation === 'RESEARCH', '#3 the response also reports RESEARCH, not LIST');
    // #8
    ok(await snap('decision_event', 'asset_id', asset.gkAssetId) === decisionsBefore, '#8 decision_event rows are byte-identical after operator approval + listing (RESEARCH not rewritten)');
    ok(await snap('operator_action_event', 'gk_asset_id', asset.gkAssetId) === actionsBefore, '#8 operator_action_event rows are byte-identical');
    ok(await snap('valuation_event', 'asset_id', asset.gkAssetId) === valuationsBefore, '#8 valuation_event rows are byte-identical (no valuation written by the approval)');
    const dRows = (await db.query(`SELECT recommendation FROM data1_dev.decision_event WHERE asset_id = $1`, [asset.gkAssetId])).rows;
    ok(dRows.length === 1 && dRows[0].recommendation === 'RESEARCH', '#8 still exactly one decision, still RESEARCH');
    {
      // DB-level append-only protection exists for decision_event / valuation_event (0034) and for the new ledger (0040).
      // operator_action_event has NO such trigger (disclosed finding) -- it is deliberately never UPDATEd here.
      let rejected = false;
      try { await db.query(`UPDATE data1_dev.decision_event SET recommendation = 'LIST_NOW' WHERE id = $1`, [asset.decisionEventId]); } catch (e) { rejected = /append-only/i.test(e.message); }
      ok(rejected, '#8 a direct UPDATE of the historical decision is rejected by the database');
      let rejectedAuth = false;
      try { await db.query(`UPDATE data1_dev.operator_authority_event SET approved_amount = 1 WHERE gk_asset_id = $1`, [asset.gkAssetId]); } catch (e) { rejectedAuth = /append-only/i.test(e.message); }
      ok(rejectedAuth, '#8 a direct UPDATE of the new authority record is rejected by the database');
    }
    // #7 -- duplicate execution, same asset
    console.log('\n-- #7, #11: duplicate execution stays blocked --');
    let r2 = await call(PA, asset);
    ok(r2.statusCode === 409 && /DUPLICATE_ACTIVE_LISTING|LISTING_ALREADY_LISTED_BY_ATTEMPT/.test(r2.body?.error || ''), `#7 a second publish for the same asset is refused (${r2.statusCode} ${r2.body?.error})`);
    ok(addCalls() === 0 && !anyTrading(), '#7 zero eBay calls on the refused duplicate');
    // lose the outcome write: the legacy duplicate check goes blind, the attempt ledger must not
    await db.query(`DELETE FROM data1_dev.outcome_event WHERE gk_asset_id = $1 AND outcome_type = 'LISTED'`, [asset.gkAssetId]);
    r2 = await call(PA, asset);
    ok(r2.statusCode === 409 && r2.body?.error === 'LISTING_ALREADY_LISTED_BY_ATTEMPT', `#11 with the outcome write LOST, the attempt ledger alone blocks a second listing (${r2.statusCode} ${r2.body?.error})`);
    ok(addCalls() === 0, '#11 zero eBay calls');
    r2 = await call(PA, asset, { body: { outcomeIdempotencyKey: nonce('replay') } });
    ok(r2.statusCode === 409 && addCalls() === 0, '#11 a fresh idempotency key does not bypass it');
    ok((await ledger(asset.gkAssetId)).length === 3, '#11 the refused retries wrote no ledger rows');
  }

  // ═════════════════════════ #4 -- missing or forged approval ═════════════════════════
  console.log('\n-- #4: missing or forged approval cannot authorize --');
  {
    const asset = await mint(PA, 'forge', { recommendation: 'RESEARCH' });
    let res = await call(PA, asset, { noAck: true });
    ok(res.statusCode === 403 && res.body?.error === 'ACTION_AUTHORITY_NOT_READY', `#4 no acknowledgment -> 403 ACTION_AUTHORITY_NOT_READY (${res.statusCode})`);
    ok(!anyTrading() && (await ledger(asset.gkAssetId)).length === 0, '#4 no eBay call, no authority row');
    res = await call(PA, asset, { ack: { priceOverridden: false, manualPrice: 25 } });
    ok(res.statusCode === 403 && !anyTrading() && (await ledger(asset.gkAssetId)).length === 0, '#4 priceOverridden:false is not an approval');
    res = await call(PA, asset, { body: { actionAuthority: { state: 'READY' }, contract: { listable: true }, serverReady: true }, noAck: true });
    ok(res.statusCode === 403 && !anyTrading() && (await ledger(asset.gkAssetId)).length === 0, '#4 a forged client actionAuthority:READY / contract.listable is ignored');
    res = await call(PA, asset, { ack: { priceOverridden: true, manualPrice: 24.99 } });
    ok(res.statusCode === 409 && res.body?.error === 'MANUAL_PRICE_ACK_MISMATCH' && !anyTrading() && (await ledger(asset.gkAssetId)).length === 0, `#4 an acknowledged price that is not the listed price is refused (${res.body?.error})`);
    res = await call(PA, asset, { amount: 30, ack: { priceOverridden: true, manualPrice: 30 } });
    ok(res.statusCode === 409 && res.body?.error === 'LIST_ACTION_PRICE_MISMATCH' && !anyTrading() && (await ledger(asset.gkAssetId)).length === 0, `#4 an approval for a price the durable LIST action never recorded is refused (${res.body?.error})`);
    const noPrice = await mint(PA, 'noprice', { recommendation: 'RESEARCH', recordPrice: false });
    res = await call(PA, noPrice);
    ok(res.statusCode === 409 && res.body?.error === 'LIST_ACTION_PRICE_NOT_RECORDED' && !anyTrading() && (await ledger(noPrice.gkAssetId)).length === 0, `#4 a LIST action with no recorded price cannot back an approval (${res.body?.error})`);
    res = await call(PA, asset, { noToken: true });
    ok(res.statusCode === 401 && !anyTrading(), '#4 no session -> 401, zero eBay calls');
    const hold = await mint(PA, 'hold', { recommendation: 'RESEARCH', actionCode: 'HOLD' });
    res = await call(PA, hold);
    ok(res.statusCode >= 400 && res.statusCode < 500 && !anyTrading() && (await ledger(hold.gkAssetId)).length === 0, `#4 a HOLD action cannot authorize a listing (${res.statusCode})`);
    // the service itself refuses forged input independently of the handler
    for (const [label, args] of [
      ['no priceOverridden', { ackPayload: { manualPrice: 25 } }],
      ['ack price != outgoing', { ackPayload: { priceOverridden: true, manualPrice: 26 } }],
    ]) {
      let code = null; try { await A.authorizeOperatorManualListing({ principalId: PA, gkAssetId: asset.gkAssetId, decisionEventId: asset.decisionEventId, operatorActionEventId: asset.operatorActionEventId, outgoingAmount: 25, ...args }); } catch (e) { code = e.code; }
      ok(code === 'VALIDATION_FAILED', `#4 service-level: ${label} -> VALIDATION_FAILED`);
    }
  }

  // ═════════════════════════ #5 -- another principal ═════════════════════════
  console.log('\n-- #5: another principal cannot authorize the asset --');
  {
    const asset = await mint(PA, 'cross', { recommendation: 'RESEARCH' });
    const res = await call(PB, asset);
    ok(res.statusCode === 403 && !anyTrading() && (await ledger(asset.gkAssetId)).length === 0, `#5 B's session on A's asset -> 403, zero eBay calls, zero authority rows (${res.statusCode})`);
    let code = null; try { await A.authorizeOperatorManualListing({ principalId: PB, gkAssetId: asset.gkAssetId, decisionEventId: asset.decisionEventId, operatorActionEventId: asset.operatorActionEventId, outgoingAmount: 25, ackPayload: { priceOverridden: true, manualPrice: 25 } }); } catch (e) { code = e.code; }
    ok(code === 'AUTHORIZATION_FAILED', `#5 service-level: B cannot record an authorization for A's asset (${code})`);
    const own = await call(PA, asset);
    createdListings.push(own.body?.listingId);
    const attemptId = (await ledger(asset.gkAssetId))[0].attempt_id;
    for (const fn of [
      () => A.recordMarketplaceAttemptPhase({ principalId: PB, attemptId, phase: 'AMBIGUOUS' }),
      () => A.operatorReconcileAttempt({ principalId: PB, attemptId, verdict: 'UNRESOLVED' }),
      () => A.getOperatorAuthorityAttempt({ principalId: PB, attemptId }),
    ]) { let c = null; try { await fn(); } catch (e) { c = e.code; } ok(c === 'AUTHORIZATION_FAILED', `#5 B cannot write or read A's attempt (${c})`); }
  }

  // ═════════════════════════ #6 -- inventory ═════════════════════════
  console.log('\n-- #6: unavailable or reserved inventory is rejected --');
  {
    const reserved = await mint(PA, 'reserved', { recommendation: 'RESEARCH' });
    await reserveAsset({ principalId: PA, gkAssetId: reserved.gkAssetId, channel: 'ebay', externalReference: 'b1-hold', idempotencyKey: nonce('reserve') });
    let res = await call(PA, reserved);
    ok(res.statusCode === 409 && res.body?.error === 'INVENTORY_NOT_AVAILABLE' && !anyTrading() && (await ledger(reserved.gkAssetId)).length === 0, `#6 a RESERVED asset is refused (${res.body?.error}), zero eBay calls, zero authority rows`);
    const unmanaged = await mint(PA, 'unmanaged', { recommendation: 'RESEARCH', enroll: false });
    res = await call(PA, unmanaged);
    ok(res.statusCode === 409 && res.body?.error === 'INVENTORY_NOT_AVAILABLE' && !anyTrading() && (await ledger(unmanaged.gkAssetId)).length === 0, `#6 an UNMANAGED asset is refused (${res.body?.error})`);
  }

  // ═════════════════════════ #9 -- New Mutants #98 shape, live ═════════════════════════
  console.log('\n-- #9: New Mutants #98 contradictory historical data, live --');
  {
    const nm98 = await mint(PA, 'nm98', {
      serverDerived: 263.8, recommendation: 'LIST_NOW', listAmount: 263.8,
      attributes: {
        title: 'the new mutants', issue: '98', year: '1991', publisher: 'Marvel', price: '$360.59', pricingSource: 'active_ask_derived',
        decision: { action: 'RESEARCH', warnings: ['zero-verified-comps'] },
        soldCompDiagnostics: { rawCount: 30, rejectedCount: 30, verifiedCount: 0 },
        contract: { actionAuthority: { state: 'REVIEW', marketStanding: 'EXACT_CURRENT', identityStanding: 'CONFIRMED' } },
      },
    });
    const d = (await db.query(`SELECT * FROM data1_dev.decision_event WHERE id = $1`, [nm98.decisionEventId])).rows[0];
    const vs = (await db.query(`SELECT id, value_amount::text AS value_amount, provenance FROM data1_dev.valuation_event WHERE asset_id = $1`, [nm98.gkAssetId])).rows;
    ok(d.recommendation === 'LIST_NOW' && d.authority_snapshot === null && vs[0].provenance === 'SERVER_DERIVED' && Number(vs[0].value_amount) === 263.8, '#9 fixture reproduces the real shape: LIST_NOW, null authority_snapshot, SERVER_DERIVED $263.80');
    const cat = (await db.query(`SELECT attributes FROM data1_dev.collection_item WHERE id = $1`, [nm98.canonicalId])).rows[0].attributes;
    const gov = decisionGovernance(d, vs, cat);
    ok(gov.governed === false && gov.standing === 'LEGACY_UNSNAPSHOTTED', `#9 the live row is not a governed authorization (${gov.standing})`);
    ok(['CATALOGUE_DECISION_DISAGREES', 'NO_VERIFIED_SOLD_EVIDENCE', 'PRICE_DISAGREES_WITH_VALUATION', 'STALE_CATALOGUE_STANDING'].every((f) => gov.flags.includes(f)), '#9 every contradiction is named');
    const res = await call(PA, nm98, { amount: 263.8 });
    createdListings.push(res.body?.listingId);
    ok(res.statusCode === 200 && res.body?.authority?.type === 'OPERATOR_MANUAL', `#9 listing it is only possible as OPERATOR_MANUAL, not as an engine authorization (${res.statusCode})`);
    const auth = (await ledger(nm98.gkAssetId)).find((r) => r.phase === 'AUTHORIZED');
    ok(auth.engine_recommendation === 'LIST_NOW', '#9 the historical engine recommendation is preserved as recorded (LIST_NOW)');
    ok(auth.evidence.decisionGovernance && auth.evidence.decisionGovernance.governed === false && auth.evidence.decisionGovernance.standing === 'LEGACY_UNSNAPSHOTTED', '#9 the durable record states the decision was NOT governed (LEGACY_UNSNAPSHOTTED)');
    ok(auth.evidence.decisionGovernance.flags.includes('NO_VERIFIED_SOLD_EVIDENCE') && auth.evidence.decisionSnapshot.provenance === 'LEGACY_NO_SNAPSHOT', '#9 zero verified sold evidence and the missing snapshot are recorded, not hidden');
    ok(auth.evidence.durableCatalogue.evidenceClass === 'SOLD_CANDIDATES_UNVERIFIED' && auth.evidence.durableCatalogue.verifiedSoldCount === 0 && auth.evidence.durableCatalogue.rawSoldCount === 30, '#9 evidence class and verified sold count (0 of 30) are recorded from the durable catalogue');
    const dAfter = (await db.query(`SELECT recommendation, authority_snapshot FROM data1_dev.decision_event WHERE id = $1`, [nm98.decisionEventId])).rows[0];
    ok(dAfter.recommendation === 'LIST_NOW' && dAfter.authority_snapshot === null, '#9 the historical decision row is unchanged (preserved, not rewritten, not promoted)');
  }

  // ═════════════════════════ #12 -- forged request authority cannot elevate READY ═════════════════════════
  console.log('\n-- #12: forged request-borne authority cannot reach READY or AddFixedPriceItem --');
  {
    const asset = await mint(PA, 'forged-ready', { recommendation: 'RESEARCH', receipt: false });
    const forged = { decision: { action: 'LIST_NOW', confidence: 'high' }, pricingSource: 'verified_sold', matchConfidence: { tier: 'HIGH', score: 95 }, rawComps: { count: 8 }, soldComps: 5,
      soldCompDiagnostics: { rawCount: 6, verifiedCount: 5, newestDaysAgo: 10 }, identityConfident: true, contract: { listable: true, state: 'PRICED', actionAuthority: { state: 'READY', marketStanding: 'EXACT_CURRENT', identityStanding: 'CONFIRMED' } }, actionAuthority: { state: 'READY' } };
    const res = await call(PA, asset, { noAck: true, body: forged });
    ok(res.statusCode === 403 && addCalls() === 0 && !anyTrading() && (await ledger(asset.gkAssetId)).length === 0, `#12 a READY verdict + sold diagnostics + contract asserted by the REQUEST (no Q41 acknowledgement) is refused (${res.statusCode}), zero AddFixedPriceItem, zero authority rows`);
    const cat = (await db.query(`SELECT attributes FROM data1_dev.collection_item WHERE id = $1`, [asset.canonicalId])).rows[0].attributes;
    ok(cat.decision === undefined && cat.contract === undefined && cat.authorityReceipt === undefined, '#12 nothing of the forged request was written into the Collection row');
  }

  // ═════════════════════════ #10 #11 -- definitive failure ═════════════════════════
  console.log('\n-- #10, #11: failed AddFixedPriceItem leaves an explicit, recoverable outcome --');
  {
    const asset = await mint(PA, 'fail', { recommendation: 'RESEARCH' });
    addBehavior = 'definitive';
    let res = await call(PA, asset);
    ok(res.statusCode === 502 && !!res.body?.attemptId, `#10 a definitive provider refusal -> 502 carrying the attempt id (${res.statusCode})`);
    let rows = await ledger(asset.gkAssetId);
    ok(JSON.stringify(phasesOf(rows)) === JSON.stringify(['AUTHORIZED', 'SUBMITTED', 'FAILED_DEFINITIVE']), `#10 the attempt is explicitly FAILED_DEFINITIVE: ${JSON.stringify(phasesOf(rows))}`);
    ok(rows[2].detail?.errorCodes?.includes('21919136'), '#10 the provider error code is recorded');
    ok((await db.query(`SELECT 1 FROM data1_dev.outcome_event WHERE gk_asset_id = $1`, [asset.gkAssetId])).rows.length === 0, '#10 no LISTED outcome exists for a failed attempt');
    ok((await A.getOperatorAuthorityAttempt({ principalId: PA, attemptId: rows[0].attempt_id })).state === 'FAILED', '#10 the attempt state reads FAILED (recoverable)');
    addBehavior = 'success';
    res = await call(PA, asset);
    createdListings.push(res.body?.listingId);
    ok(res.statusCode === 200 && addCalls() === 1, '#10 after a definitive failure a retry is allowed and lists');
    rows = await ledger(asset.gkAssetId);
    ok(rows.filter((r) => r.phase === 'AUTHORIZED').length === 2 && new Set(rows.map((r) => r.attempt_id)).size === 2, '#10 the retry is a NEW attempt with its own authorization (the first stays on record)');
    res = await call(PA, asset);
    ok(res.statusCode === 409 && addCalls() === 0, '#11 a third attempt after the success is blocked');
  }

  // ═════════════════════════ #12 / A2 -- ambiguous provider responses + explicit operator reconciliation ═════════════════════════
  console.log('\n-- #12 / A2: ambiguous provider response must be reconciled by the operator before retry --');
  const ALL_SOURCES = ['SELLER_HUB_ACTIVE', 'SELLER_HUB_SCHEDULED', 'SELLER_HUB_SOLD', 'SELLER_HUB_UNSOLD'];
  const submittedAtOf = (rows) => new Date(rows.find((r) => r.phase === 'SUBMITTED').recorded_at).getTime();
  const hoursAfter = (rows, h) => new Date(submittedAtOf(rows) + h * 3600e3);
  for (const behavior of ['system-error', 'http500', 'network', 'noack']) {
    const asset = await mint(PA, `amb-${behavior}`, { recommendation: 'RESEARCH' });
    addBehavior = behavior;
    let res = await call(PA, asset);
    ok(res.statusCode === 502 && res.body?.error === 'LISTING_OUTCOME_UNKNOWN' && !!res.body?.attemptId, `#12 [${behavior}] -> 502 LISTING_OUTCOME_UNKNOWN with the attempt id`);
    ok(/^GK-[0-9A-F]{32}$/.test(res.body?.correlation?.sku || ''), `#12 [${behavior}] the response tells the operator which Seller Hub label to look for`);
    let rows = await ledger(asset.gkAssetId);
    ok(JSON.stringify(phasesOf(rows)) === JSON.stringify(['AUTHORIZED', 'SUBMITTED', 'AMBIGUOUS']), `#12 [${behavior}] attempt recorded AMBIGUOUS, not "failed" and not "not listed": ${JSON.stringify(phasesOf(rows))}`);
    const amb = rows.find((r) => r.phase === 'AMBIGUOUS');
    ok(amb.review_due_at && Math.abs((new Date(amb.review_due_at) - new Date(amb.recorded_at)) / 3600e3 - 48) < 0.01 && amb.principal_id === PA, `A2 [${behavior}] AMBIGUOUS is owned (principal) and carries a 48 h review deadline`);
    ok((await db.query(`SELECT 1 FROM data1_dev.outcome_event WHERE gk_asset_id = $1`, [asset.gkAssetId])).rows.length === 0, `#12 [${behavior}] no LISTED outcome is invented`);
    addBehavior = 'success';
    res = await call(PA, asset);
    ok(res.statusCode === 409 && res.body?.error === 'LISTING_ATTEMPT_AMBIGUOUS' && addCalls() === 0 && !anyTrading(), `#12 [${behavior}] a retry is BLOCKED before any eBay call (${res.body?.error})`);
    ok((await ledger(asset.gkAssetId)).length === 3, `#12 [${behavior}] the blocked retry wrote nothing`);
    const attemptId = rows[0].attempt_id;
    const queue = (now) => A.listAttemptsNeedingReview({ principalId: PA, now });
    let q = (await queue()).find((x) => x.attemptId === attemptId);
    ok(q && q.status === 'WITHIN_WINDOW' && q.gkAssetId === asset.gkAssetId, `A2 [${behavior}] the attempt appears in the owner's review queue, within its window`);
    q = (await queue(new Date(Date.now() + 49 * 3600e3))).find((x) => x.attemptId === attemptId);
    ok(q && q.status === 'OVERDUE', `A2 [${behavior}] after 49 h the same attempt reads OVERDUE (it cannot silently age as an unowned pending state)`);

    if (behavior === 'system-error') {
      // An operator observation is NOT automatically proof of non-publication.
      let c = null; try { await A.operatorReconcileAttempt({ principalId: PA, attemptId, verdict: 'LISTING_FOUND' }); } catch (e) { c = e.code; }
      ok(c === 'VALIDATION_FAILED', 'A2 LISTING_FOUND requires the marketplace listing id');
      const farFuture = hoursAfter(rows, 6);
      let rec = await A.operatorReconcileAttempt({ principalId: PA, attemptId, verdict: 'NOT_FOUND', checkedSources: ['SELLER_HUB_ACTIVE'], checkedAt: hoursAfter(rows, 0.1), evidenceRef: 'looked at the active tab', requestNewPublish: true, now: farFuture });
      ok(rec.recordedVerdict === 'UNRESOLVED' && rec.claimedVerdict === 'NOT_FOUND' && rec.newPublishAuthorized === false && rec.resultingState === 'CLOSED_BLOCKED', 'A2 an incomplete, too-early NOT_FOUND is recorded but DOWNGRADED to UNRESOLVED: closed-but-blocked');
      ok(rec.downgradeReasons.some((r) => r.startsWith('ABSENCE_SOURCES_INCOMPLETE')) && rec.downgradeReasons.includes('CHECKED_TOO_SOON_AFTER_SUBMISSION'), `A2 the downgrade reasons are recorded (${rec.downgradeReasons.join(' | ')})`);
      res = await call(PA, asset);
      ok(res.statusCode === 409 && res.body?.error === 'LISTING_ATTEMPT_CLOSED_BLOCKED' && !anyTrading(), `A2 a closed-but-blocked attempt STILL blocks a new publish (${res.body?.error}), zero eBay calls`);
      ok(!(await queue()).some((x) => x.attemptId === attemptId), 'A2 once reconciled (even closed-but-blocked) the attempt leaves the review queue: it is owned and closed, not pending');
      rec = await A.operatorReconcileAttempt({ principalId: PA, attemptId, verdict: 'UNRESOLVED', observations: 'cannot tell from Seller Hub', evidenceRef: 'ticket-123', now: farFuture });
      ok(rec.recordedVerdict === 'UNRESOLVED' && rec.resultingState === 'CLOSED_BLOCKED', 'A2 an explicit UNRESOLVED is an allowed closed-but-blocked disposition');
      const goodArgs = { principalId: PA, attemptId, verdict: 'NOT_FOUND', checkedSources: ALL_SOURCES, checkedAt: hoursAfter(rows, 2), evidenceRef: 'seller-hub-screenshot-2026-10-12', now: farFuture };
      rec = await A.operatorReconcileAttempt({ ...goodArgs, requestNewPublish: true, automatedLookup: { matches: [{ itemId: '999', list: 'ActiveList' }], scannedAllListsCompletely: true } });
      ok(rec.recordedVerdict === 'UNRESOLVED' && rec.downgradeReasons.includes('CONTRADICTED_BY_SELLER_SCOPED_LOOKUP') && rec.newPublishAuthorized === false, 'A2 a seller-scoped lookup that found a match overrides the operator\'s NOT_FOUND');
      rec = await A.operatorReconcileAttempt({ ...goodArgs, requestNewPublish: false });
      ok(rec.recordedVerdict === 'NOT_FOUND' && rec.newPublishAuthorized === false && rec.resultingState === 'CLOSED_BLOCKED', 'A2 a convincing NOT_FOUND that does not request a publish still leaves the block in place');
      res = await call(PA, asset);
      ok(res.statusCode === 409 && !anyTrading(), 'A2 still blocked');
      rec = await A.operatorReconcileAttempt({ ...goodArgs, requestNewPublish: true });
      ok(rec.recordedVerdict === 'NOT_FOUND' && rec.newPublishAuthorized === true && rec.resultingState === 'RECONCILED_NOT_LISTED', 'A2 only a complete, timely, evidenced NOT_FOUND that requests it authorizes a new publish');
      const reconRows = (await ledger(asset.gkAssetId)).filter((r) => r.phase === 'OPERATOR_RECONCILED');
      ok(reconRows.length === 5 && reconRows.every((r) => r.principal_id === PA && r.attempt_id === attemptId && r.reconciliation?.policyVersion === 'recon-v1'), `A2 every reconciliation is an append-only event owned by the operator (${reconRows.length} events, nothing overwritten)`);
      ok(reconRows[0].reconciliation.claimedVerdict === 'NOT_FOUND' && reconRows[0].recon_verdict === 'UNRESOLVED' && reconRows[0].reconciliation.priorState === 'AMBIGUOUS', 'A2 the first event preserves what the operator claimed AND what the policy recorded');
      res = await call(PA, asset);
      createdListings.push(res.body?.listingId);
      ok(res.statusCode === 200 && addCalls() === 1, '#12 after a policy-passing reconciliation a retry lists exactly once');
      c = null; try { await A.operatorReconcileAttempt({ principalId: PA, attemptId, verdict: 'UNRESOLVED' }); } catch (e) { c = e.code; }
      ok(c === 'CONFLICT', 'A2 a RECONCILED_NOT_LISTED attempt that has since produced a new listing elsewhere is no longer reconcilable here');
    }
    if (behavior === 'http500') {
      const listingId = `b1-recon-${Date.now()}`;
      const rec = await A.operatorReconcileAttempt({ principalId: PA, attemptId, verdict: 'LISTING_FOUND', externalListingId: listingId, evidenceRef: 'ebay.com/itm/' + listingId, observations: 'found in Seller Hub Active', now: hoursAfter(rows, 3) });
      createdListings.push(listingId);
      ok(rec.recordedVerdict === 'LISTING_FOUND' && rec.newPublishAuthorized === false && rec.resultingState === 'LISTED', 'A2 LISTING_FOUND reconciles to the existing listing and authorizes NO new publish');
      ok(rec.outcomeRecorded && rec.outcomeRecorded.ok === true, 'A2 the confirmed listing is also recorded in the outcome ledger (no publish was made)');
      const oe = (await db.query(`SELECT ask_amount, outcome_type FROM data1_dev.outcome_event WHERE gk_asset_id = $1 AND external_listing_id = $2`, [asset.gkAssetId, listingId])).rows[0];
      ok(oe && oe.outcome_type === 'LISTED' && Number(oe.ask_amount) === 25, 'A2 that LISTED outcome carries the approved price');
      res = await call(PA, asset);
      ok(res.statusCode === 409 && /DUPLICATE_ACTIVE_LISTING|LISTING_ALREADY_LISTED_BY_ATTEMPT/.test(res.body?.error || '') && addCalls() === 0 && !anyTrading(), `A2 after FOUND a retry stays blocked, zero eBay calls (${res.body?.error})`);
      ok(fetchCalls.length === 0, 'A2 reconciling FOUND made no marketplace call of any kind');
    }
    if (behavior === 'network') {
      const rec = await A.operatorReconcileAttempt({ principalId: PA, attemptId, verdict: 'UNRESOLVED', observations: 'Seller Hub unreachable', evidenceRef: 'incident-2026-10-12', now: new Date(Date.now() + 49 * 3600e3) });
      ok(rec.resultingState === 'CLOSED_BLOCKED', 'A2 an OVERDUE attempt can be closed as UNRESOLVED (closed-but-blocked) so it does not stay pending');
      const recRow = (await ledger(asset.gkAssetId)).find((r) => r.phase === 'OPERATOR_RECONCILED');
      ok(recRow.reconciliation.reviewWasOverdue === true, 'A2 the record states that the review had been overdue');
      res = await call(PA, asset);
      ok(res.statusCode === 409 && res.body?.error === 'LISTING_ATTEMPT_CLOSED_BLOCKED' && !anyTrading(), 'A2 and the block is preserved');
    }
  }

  // ═════════════════════════ A1 -- immutable value snapshot ═════════════════════════
  console.log('\n-- A1: the immutable authority snapshot is independent of the rows it references --');
  {
    const asset = await mint(PA, 'snap', {
      recommendation: 'RESEARCH',
      attributes: { title: 'B1 Snapshot Comic', publisher: 'Test', year: '1990', grade: 'NM 9.2', pricingSource: 'active_ask_derived', soldCompDiagnostics: { rawCount: 3, verifiedCount: 0 } },
    });
    lastAddBody = '';
    const res = await call(PA, asset);
    createdListings.push(res.body?.listingId);
    ok(res.statusCode === 200, 'A1 listing succeeds');
    const auth = (await ledger(asset.gkAssetId)).find((r) => r.phase === 'AUTHORIZED');
    ok(String(auth.approved_amount_cents) === '2500' && auth.approved_currency === 'USD' && Number(auth.approved_amount) === 25, 'A1 exact approved price in integer cents (2500) and currency are stored IN the snapshot');
    ok(auth.principal_id === PA && auth.gk_asset_id === asset.gkAssetId && auth.engine_recommendation === 'RESEARCH', 'A1 operator principal, physical asset and the original engine recommendation are stored in the snapshot');
    ok(auth.evidence_class === 'SOLD_CANDIDATES_UNVERIFIED' && auth.verified_sold_count === 0, `A1 evidence classification and verified sold count are stored as columns (${auth.evidence_class}, ${auth.verified_sold_count})`);
    ok(auth.governing_grade.source === 'MODEL_PREDICTED' && auth.governing_grade.uncertainty === 'MODEL_PREDICTED_NOT_OPERATOR_CONFIRMED' && auth.governing_grade.grade === 'NM 9.2', 'A1 the governing-grade standing is stored with its explicit uncertainty (a model grade is not presented as confirmed)');
    ok(auth.ack_payload.manualPrice === 25 && auth.ack_warnings && 'authorityState' in auth.ack_warnings && !!auth.approved_at && !!auth.attempt_id, 'A1 the Q41 acknowledgment, warnings, approval timestamp and attempt id are stored');
    const corr = attemptCorrelation(auth.attempt_id);
    ok(auth.provider_correlation.uuid === corr.uuid && auth.provider_correlation.sku === corr.sku, 'A3 the provider correlation ids stored in the snapshot are derived from the attempt id');
    ok(lastAddBody.includes(`<SKU>${corr.sku}</SKU>`) && lastAddBody.includes(`<UUID>${corr.uuid}</UUID>`), 'A3 the outbound AddFixedPriceItem carries Item.SKU (label) and Item.UUID (provider duplicate defence) for this attempt');
    ok((await A.verifyOperatorAuthorityConsistency({ principalId: PA, attemptId: auth.attempt_id })).consistent === true, 'A1 verification: snapshot and referenced rows agree');

    // NEGATIVE TEST (required): change the referenced operator_action_event price inside an isolated transaction.
    const tx = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await tx.connect();
    let detail = {};
    try {
      await tx.query('BEGIN');
      await tx.query(`UPDATE data1_dev.operator_action_event SET action_value_amount = 1.00 WHERE id = $1`, [asset.operatorActionEventId]);
      const a = (await tx.query(`SELECT * FROM data1_dev.operator_authority_event WHERE id = $1`, [auth.id])).rows[0];
      const act = (await tx.query(`SELECT id, gk_asset_id, decision_event_id, principal_id, action_code, action_value_amount::text AS action_value_amount, action_value_currency, occurred_at FROM data1_dev.operator_action_event WHERE id = $1`, [asset.operatorActionEventId])).rows[0];
      const dec = (await tx.query(`SELECT recommendation, asset_id FROM data1_dev.decision_event WHERE id = $1`, [asset.decisionEventId])).rows[0];
      detail = { act, snapshot: { cents: String(a.approved_amount_cents), amount: a.approved_amount }, verdict: verifyAuthoritySnapshot(a, { operatorAction: act, decision: dec }) };
      await tx.query('SAVEPOINT s1');
      try { await tx.query(`DELETE FROM data1_dev.operator_action_event WHERE id = $1`, [asset.operatorActionEventId]); detail.deleteRejected = false; } catch (e) { detail.deleteRejected = e.code === '23503'; await tx.query('ROLLBACK TO SAVEPOINT s1'); }
    } finally {
      await tx.query('ROLLBACK');
      await tx.end();
    }
    ok(Number(detail.act.action_value_amount) === 1 && detail.snapshot.cents === '2500' && Number(detail.snapshot.amount) === 25, 'A1 inside the transaction: the referenced price now reads 1.00 while the immutable snapshot still reads 2500 cents / 25.00');
    ok(detail.verdict.consistent === false && detail.verdict.discrepancies.some((d) => d.field === 'approved_amount_cents' && d.snapshot === 2500 && d.current === 100), 'A1 the inconsistency is DETECTED, naming the snapshot value as the approved one');
    ok(detail.deleteRejected === true, 'A1 the referenced operator_action_event cannot be deleted while an authority snapshot references it (FK)');
    const restored = (await db.query(`SELECT action_value_amount::text AS a FROM data1_dev.operator_action_event WHERE id = $1`, [asset.operatorActionEventId])).rows[0].a;
    ok(Number(restored) === 25, 'A1 the test mutation was rolled back: the referenced price is 25.00 again');
    ok((await A.verifyOperatorAuthorityConsistency({ principalId: PA, attemptId: auth.attempt_id })).consistent === true, 'A1 after rollback the verification is consistent again');
  }

  // ═════════════════════════ #11 -- concurrency ═════════════════════════
  console.log('\n-- #11: simultaneous double submit creates one listing --');
  {
    const asset = await mint(PA, 'race', { recommendation: 'RESEARCH' });
    addBehavior = 'success'; addDelayMs = 150; fetchCalls.length = 0;
    const [r1, r2] = await Promise.all([(async () => { const r = mockRes(); await listHandler(req(PA, asset), r); return r; })(), (async () => { const r = mockRes(); await listHandler(req(PA, asset), r); return r; })()]);
    addDelayMs = 0;
    const codes = [r1.statusCode, r2.statusCode].sort();
    for (const r of [r1, r2]) if (r.body?.listingId) createdListings.push(r.body.listingId);
    ok(codes[0] === 200 && codes[1] === 409, `#11 exactly one of two simultaneous requests lists; the other is refused (${codes})`);
    ok(addCalls() === 1, `#11 exactly ONE AddFixedPriceItem call reached the provider (${addCalls()})`);
  }

  // ═════════════════════════ #13 -- authorized but not executed ═════════════════════════
  console.log('\n-- #13: authorization without a listing is distinguishable from an executed listing --');
  {
    const notExecuted = await mint(PA, 'notexec', { recommendation: 'RESEARCH' });
    mockState.metaDown = true; resetMetadataCaches();
    let res = await call(PA, notExecuted);
    mockState.metaDown = false; resetMetadataCaches();
    ok(res.statusCode === 503 && res.body?.error === 'LISTING_METADATA_UNAVAILABLE', `a pre-publish failure AFTER authorization (metadata down) -> 503 (${res.body?.error})`);
    ok(addCalls() === 0, 'no AddFixedPriceItem call was made');
    const nrows = await ledger(notExecuted.gkAssetId);
    const nstate = await A.getOperatorAuthorityAttempt({ principalId: PA, attemptId: nrows[0].attempt_id });
    ok(JSON.stringify(phasesOf(nrows)) === JSON.stringify(['AUTHORIZED']) && nstate.state === 'AUTHORIZED_NOT_EXECUTED', `#13 AUTHORIZED only, state AUTHORIZED_NOT_EXECUTED: ${JSON.stringify(phasesOf(nrows))} / ${nstate.state}`);
    ok(!nrows.some((r) => r.external_listing_id) && (await db.query(`SELECT 1 FROM data1_dev.outcome_event WHERE gk_asset_id = $1`, [notExecuted.gkAssetId])).rows.length === 0, '#13 no listing id and no outcome exists for the unexecuted authorization');
    res = await call(PA, notExecuted);
    createdListings.push(res.body?.listingId);
    ok(res.statusCode === 200 && addCalls() === 1, '#13 an authorized-but-unexecuted attempt does not block the real retry');
    const erows = await ledger(notExecuted.gkAssetId);
    const states = new Map();
    for (const r of erows) { if (!states.has(r.attempt_id)) states.set(r.attempt_id, (await A.getOperatorAuthorityAttempt({ principalId: PA, attemptId: r.attempt_id })).state); }
    ok([...states.values()].sort().join(',') === 'AUTHORIZED_NOT_EXECUTED,LISTED', `#13 the two attempts read differently: ${[...states.values()].sort().join(' vs ')}`);
    ok(erows.filter((r) => r.phase === 'LISTED_CONFIRMED' && r.external_listing_id).length === 1, '#13 only the executed attempt carries a confirmed marketplace listing id');
  }
} finally {
  await db.query(`DELETE FROM data1_dev.marketplace_connection WHERE principal_id = ANY($1)`, [[PA, PB]]);
  const ids = createdListings.filter(Boolean);
  if (ids.length) await db.query(`DELETE FROM data1_dev.outcome_event WHERE external_listing_id = ANY($1)`, [ids]);
  console.log('\n  (cleanup) marketplace_connection and transient LISTED outcome_event rows deleted. The append-only authority rows, gk_principal and gk_asset rows are permanent Development fixtures (repo convention).');
  await db.end();
}

console.log(`\n${'='.repeat(60)}\nB1 LIVE: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('\nFAILURES:'); failures.forEach((f) => console.log('  ✗ ' + f)); }
process.exit(failed > 0 ? 1 : 0);
