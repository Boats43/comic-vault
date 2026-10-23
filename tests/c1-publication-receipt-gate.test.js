// tests/c1-publication-receipt-gate.test.js -- C1 (2026-10-23): a VERIFIED authority receipt is mandatory for every
// single-item marketplace publication, independent of the Q41 acknowledgement.
//
// REAL api/list-ebay.js handler, REAL receipt signer/verifier (src/lib/authorityReceipt.js), REAL listing-authority
// evidence resolver, REAL price binding / photo guard / metadata / XML builders. Only the modules that touch a
// database, a session or the seller's eBay connection are replaced (tests/helpers/c1ListEbayStubs.mjs, installed by a
// resolution hook) and global.fetch is a local mock. No database, no credentials, no network. Every refusal is proven to
// make ZERO provider-side calls and ZERO ledger / outcome / token writes.
//
// Invoke: node tests/c1-publication-receipt-gate.test.js
import { register } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');

process.env.GRAILKEY_SESSION_SECRET = randomBytes(32).toString('base64url');
process.env.EBAY_APP_ID = 'c1-app';
process.env.EBAY_CERT_ID = 'c1-cert';
process.env.EBAY_DEV_ID = 'c1-dev';
delete process.env.VERCEL;
delete process.env.VERCEL_ENV;
process.env.NODE_ENV = 'test';

globalThis.__C1 = { calls: [], cfg: {} };
register(pathToFileURL(path.join(here, 'helpers', 'c1ListEbayHooks.mjs')).href, {
  parentURL: import.meta.url,
  data: { stubUrl: pathToFileURL(path.join(here, 'helpers', 'c1ListEbayStubs.mjs')).href },
});

const { metaFetch, shippingResponse, mockState, TINY_PNG_B64, TINY_PNG_DATA_URL } = await import('./helpers/ebayPacketMocks.js');
const { issueAuthorityReceipt, computeEvidenceVersion } = await import(pathToFileURL(path.join(repoRoot, 'src/lib/authorityReceipt.js')).href);

const fetchLog = [];
mockState.mediaImageUrl = 'https://i.ebayimg.com/hosted/c1.jpg';
global.fetch = async (url, opts) => {
  const u = String(url);
  fetchLog.push(u.includes('oauth2/token') ? 'oauth-exchange' : (opts?.headers?.['X-EBAY-API-CALL-NAME'] || u));
  const m = metaFetch(u, opts);
  if (m) return m;
  if (u.includes('identity/v1/oauth2/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'app-c1', expires_in: 7200 }) };
  const call = opts?.headers?.['X-EBAY-API-CALL-NAME'];
  if (call === 'GeteBayDetails') return shippingResponse();
  if (call === 'GetUser') return { status: 200, text: async () => '<GetUserResponse><Ack>Success</Ack><User><UserID>c1</UserID></User></GetUserResponse>' };
  if (call === 'AddFixedPriceItem') return { status: 200, text: async () => '<AddFixedPriceItemResponse><Ack>Success</Ack><ItemID>c1-item-1</ItemID></AddFixedPriceItemResponse>' };
  throw new Error(`unexpected fetch ${u} ${call}`);
};

const handler = (await import(pathToFileURL(path.join(repoRoot, 'api/list-ebay.js')).href)).default;

let passed = 0;
let failed = 0;
const ok = (c, l) => {
  if (c) { passed++; console.log(`  ok   ${l}`); } else { failed++; console.log(`  FAIL ${l}`); }
};
const mockRes = () => {
  const r = { statusCode: null, body: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};

const OWNER = 'p-c1-owner';
const OTHER = 'p-c1-other';
const ASSET = '01a0bb24-c806-7a63-aa86-ce26fe8eed83';
const OTHER_ASSET = '01a0c104-00ee-7055-bb95-359233761f53';
const ROW = 'cv_1790809927798_txjz5n';
const OTHER_ROW = 'cv_1789945847230_9chq1h';
const PNG_HASH = createHash('sha256').update(Buffer.from(TINY_PNG_B64, 'base64')).digest('hex');
const EV = computeEvidenceVersion([PNG_HASH]);

// Mirrors a real Old Man Logan #25 receipt: RESEARCH decision, asks only, 1 sold rejected / 0 verified.
const OML_RESPONSE = {
  title: 'Old Man Logan Mike Deodato', issue: '25', year: '2017',
  decision: { action: 'RESEARCH' }, pricingSource: 'active_ask_derived',
  matchConfidence: { tier: 'HIGH', score: 90 }, identityConfident: true,
  soldCompDiagnostics: { rawCount: 1, verifiedCount: 0, newestDaysAgo: null },
  rawComps: { count: 6 }, soldComps: [],
};
const mint = ({ principalId = OWNER, binding = { collectionItemId: ROW, gkAssetId: ASSET, evidenceVersion: EV }, response = OML_RESPONSE } = {}) =>
  issueAuthorityReceipt({ principalId, response, binding });

const baseRow = (authorityReceipt) => ({
  title: 'Old Man Logan Mike Deodato', issue: '25', year: '2017', publisher: 'Marvel', variant: null,
  price: '$15.42', grade: 'VF 8.0', operatorGrade: 'NM- 9.2', operatorGradeNumeric: 9.2, operatorIsGraded: false, gradeAuthority: 'OPERATOR_CONFIRMED',
  ...(authorityReceipt === undefined ? {} : { authorityReceipt }),
});

const request = (over = {}) => ({
  headers: { authorization: `Bearer tok:${OWNER}` },
  method: 'POST',
  body: {
    title: 'Old Man Logan Mike Deodato', issue: '25', gkAssetId: ASSET, decisionEventId: 'd-1', operatorActionEventId: 'oa-1', outcomeIdempotencyKey: 'k-1',
    price: '$15.42', images: [TINY_PNG_DATA_URL], matchConfidence: { tier: 'HIGH' },
    q41Override: { priceOverridden: true, manualPrice: 15.42 },
    ...over,
  },
});

async function run({ receipt, mediaHashes = [PNG_HASH], req = request(), listActionAmount = '15.42' } = {}) {
  globalThis.__C1.calls.length = 0;
  fetchLog.length = 0;
  mockState.mediaCalls.length = 0;
  Object.assign(globalThis.__C1.cfg, { rowAttributes: baseRow(receipt), canonicalRowId: ROW, mediaHashes, listActionAmount });
  const res = mockRes();
  const realErr = console.error;
  const realLog = console.log;
  console.error = () => {};
  console.log = () => {};
  req.method = 'POST';
  try { await handler(req, res); } finally { console.error = realErr; console.log = realLog; }
  const calls = globalThis.__C1.calls.slice();
  return { res, calls, writes: calls.filter((c) => c.startsWith('WRITE:')), fetches: fetchLog.slice(), mediaCalls: mockState.mediaCalls.slice() };
}

const expectReceiptRefusal = async (label, opts, reason) => {
  console.log(label);
  const r = await run(opts);
  ok(r.res.statusCode === 403, `403 (got ${r.res.statusCode})`);
  ok(r.res.body?.error === 'ACTION_AUTHORITY_NOT_READY', 'existing refusal code reused (ACTION_AUTHORITY_NOT_READY)');
  ok(r.res.body?.refusalReason === reason, `stable reason ${reason} (got ${r.res.body?.refusalReason})`);
  ok(String(r.res.body?.refusalReason).startsWith('AUTHORITY_RECEIPT_'), 'reason is an AUTHORITY_RECEIPT_* value');
  ok(r.fetches.length === 0, `ZERO provider/network calls incl. OAuth exchange, metadata, image upload (got ${JSON.stringify(r.fetches)})`);
  ok(r.mediaCalls.length === 0, 'ZERO Media API calls');
  ok(r.writes.length === 0, `ZERO ledger / outcome / token writes (got ${JSON.stringify(r.writes)})`);
  ok(!r.calls.includes('getOperatorActionForListing'), 'refused before price binding');
};

console.log('1. valid receipt + valid Q41 -> passes the receipt gate and publishes');
{
  const r = await run({ receipt: mint() });
  ok(r.res.statusCode === 200, `200 (got ${r.res.statusCode} ${JSON.stringify(r.res.body)?.slice(0, 200)})`);
  ok(r.fetches.includes('AddFixedPriceItem'), 'AddFixedPriceItem reached');
  ok(r.calls.includes('WRITE:authorizeOperatorManualListing'), 'OPERATOR_MANUAL authority recorded (Q41 path unchanged)');
  ok(r.calls.includes('WRITE:resolveEbayUserAccessToken'), 'seller token resolved only AFTER the gate');
}

console.log('2. valid receipt + missing Q41 -> existing not-READY refusal');
{
  const r = await run({ receipt: mint(), req: request({ q41Override: undefined }) });
  ok(r.res.statusCode === 403 && r.res.body?.error === 'ACTION_AUTHORITY_NOT_READY', 'existing ACTION_AUTHORITY_NOT_READY refusal');
  ok(r.res.body?.refusalReason === 'AUTHORITY_INSUFFICIENT' && r.res.body?.authorityReceipt === 'VERIFIED', 'reason AUTHORITY_INSUFFICIENT with a VERIFIED receipt (not a receipt failure)');
  ok(r.fetches.length === 0 && r.writes.length === 0, 'no provider calls, no writes');
}

console.log('2b. valid receipt + Q41 price that does not equal the listed price -> existing MANUAL_PRICE_ACK_MISMATCH');
{
  const r = await run({ receipt: mint(), req: request({ q41Override: { priceOverridden: true, manualPrice: 99.99 } }) });
  ok(r.res.statusCode === 409 && r.res.body?.error === 'MANUAL_PRICE_ACK_MISMATCH', `409 MANUAL_PRICE_ACK_MISMATCH (got ${r.res.statusCode} ${r.res.body?.error})`);
  ok(r.fetches.length === 0 && r.writes.length === 0, 'no provider calls, no writes');
}

console.log('2c. valid receipt + valid Q41, durable LIST action records another price -> existing LIST_ACTION_PRICE_MISMATCH');
{
  const r = await run({ receipt: mint(), listActionAmount: '20.00' });
  ok(r.res.statusCode === 409 && r.res.body?.error === 'LIST_ACTION_PRICE_MISMATCH', `409 LIST_ACTION_PRICE_MISMATCH (got ${r.res.statusCode} ${r.res.body?.error})`);
  ok(r.fetches.length === 0 && r.writes.length === 0, 'no provider calls, no writes');
}

await expectReceiptRefusal('3. missing receipt + valid Q41', { receipt: undefined }, 'AUTHORITY_RECEIPT_UNVERIFIED_ABSENT');

{
  const good = mint();
  await expectReceiptRefusal('4a. forged signature + valid Q41', { receipt: { ...good, sig: randomBytes(32).toString('base64url') } }, 'AUTHORITY_RECEIPT_UNVERIFIED_BAD_SIGNATURE');
  const t = JSON.parse(good.body);
  t.values.decision = { action: 'LIST_NOW' };
  t.values.pricingSource = 'verified_sold_recency';
  t.values.soldCompDiagnostics = { rawCount: 30, verifiedCount: 30, newestDaysAgo: 1 };
  await expectReceiptRefusal('4b. tampered body (forged READY evidence) under a real signature + valid Q41', { receipt: { ...good, body: JSON.stringify(t) } }, 'AUTHORITY_RECEIPT_UNVERIFIED_BAD_SIGNATURE');
}

await expectReceiptRefusal('5. wrong principal (receipt minted for another principal) + valid Q41', { receipt: mint({ principalId: OTHER }) }, 'AUTHORITY_RECEIPT_UNVERIFIED_PRINCIPAL_MISMATCH');
await expectReceiptRefusal('6a. wrong asset (bound to another gkAssetId) + valid Q41', { receipt: mint({ binding: { collectionItemId: ROW, gkAssetId: OTHER_ASSET, evidenceVersion: EV } }) }, 'AUTHORITY_RECEIPT_ASSET_MISMATCH');
await expectReceiptRefusal('6b. wrong catalogue row (bound to another collection item) + valid Q41', { receipt: mint({ binding: { collectionItemId: OTHER_ROW, gkAssetId: ASSET, evidenceVersion: EV } }) }, 'AUTHORITY_RECEIPT_ASSET_MISMATCH');
await expectReceiptRefusal('6c. unbound receipt (no asset) + valid Q41', { receipt: mint({ binding: { collectionItemId: ROW, gkAssetId: null, evidenceVersion: EV } }) }, 'AUTHORITY_RECEIPT_UNBOUND');
await expectReceiptRefusal('7. changed media evidenceVersion (a photo added after the receipt) + valid Q41', { receipt: mint(), mediaHashes: [PNG_HASH, 'f'.repeat(64)] }, 'AUTHORITY_RECEIPT_EVIDENCE_VERSION_STALE');
await expectReceiptRefusal('8. identity mismatch (receipt signed for a different book) + valid Q41', { receipt: mint({ response: { ...OML_RESPONSE, title: 'Batman Year One', issue: '404' } }) }, 'AUTHORITY_RECEIPT_IDENTITY_MISMATCH');
await expectReceiptRefusal('9a. malformed receipt (no body/sig) + valid Q41', { receipt: { v: 1, principalId: OWNER } }, 'AUTHORITY_RECEIPT_UNVERIFIED_MALFORMED');
await expectReceiptRefusal('9b. wrong-version receipt + valid Q41', { receipt: { ...mint(), v: 2 } }, 'AUTHORITY_RECEIPT_UNVERIFIED_VERSION');
await expectReceiptRefusal('9c. non-object receipt + valid Q41', { receipt: 'not-a-receipt' }, 'AUTHORITY_RECEIPT_UNVERIFIED_ABSENT');

console.log('11. invalid receipt + NO Q41 -> the receipt reason is reported regardless of Q41');
{
  const r = await run({ receipt: undefined, req: request({ q41Override: undefined }) });
  ok(r.res.statusCode === 403 && r.res.body?.refusalReason === 'AUTHORITY_RECEIPT_UNVERIFIED_ABSENT', 'AUTHORITY_RECEIPT_UNVERIFIED_ABSENT');
  ok(r.fetches.length === 0 && r.writes.length === 0, 'no provider calls, no writes');
}

console.log('12. OML #25-shaped receipt (issuer output today) remains compatible with the verifier');
{
  const rc = mint();
  const p = JSON.parse(rc.body);
  ok(Object.keys(rc).sort().join() === 'body,principalId,sig,v' && rc.v === 1, 'envelope keys: v, principalId, body, sig');
  ok(['binding', 'identity', 'issuedAt', 'rawCompsCount', 'soldCompCount', 'values'].every((k) => k in p), 'payload keys: issuedAt, binding, identity, values, rawCompsCount, soldCompCount');
  ok(p.binding.gkAssetId === ASSET && p.binding.collectionItemId === ROW && p.binding.evidenceVersion === EV, 'binding names the asset, the row and the evidence version');
  const r = await run({ receipt: rc });
  ok(r.res.statusCode === 200, 'handler accepts it (VERIFIED) and the Q41 path publishes');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
