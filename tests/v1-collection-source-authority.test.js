// V1 P0 — /api/collection SOURCE-AUTHORITY: authenticated end-to-end exploit reproduction + regression certification.
//
//   authenticated Collection write (REAL api/collection.js handler, REAL Development Postgres)
//     -> persisted row -> readback (REAL collection service)
//     -> REAL api/list-ebay.js handler: server-side listing preflight (authority gate) -> eBay call (fetch MOCKED, every call counted)
//
// No real eBay network call is ever made: global.fetch is replaced and every eBay call is recorded. A "listing"
// that reaches AddFixedPriceItem here is an UNAUTHORIZED ONE if the data behind it was forged.
//
// Transient Development fixtures only (the Creepy #1 Development asset, as tests/list-ebay-outcome1-handler-smoke.test.js).
// Nothing touches Production. Invoke: node tests/v1-collection-source-authority.test.js

import { readFileSync } from 'node:fs';
import { createHmac, randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { metaFetch, shippingResponse, mockState } from './helpers/ebayPacketMocks.js';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const line of readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}
process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';
if (!process.env.GRAILKEY_SESSION_SECRET) process.env.GRAILKEY_SESSION_SECRET = randomBytes(32).toString('base64url');
if (!process.env.GRAILKEY_MARKETPLACE_CREDENTIAL_KEY) process.env.GRAILKEY_MARKETPLACE_CREDENTIAL_KEY = randomBytes(32).toString('base64url');

// ── eBay mock: records EVERY call by name ───────────────────────────────────────────────────────────────
const ebayCalls = [];
const FAKE_ITEM_ID = `src-auth-item-${Date.now()}`;
const FAKE_HOSTED_PICTURE_URL = 'https://i.ebayimg.com/hosted/src-auth.jpg';
mockState.mediaImageUrl = FAKE_HOSTED_PICTURE_URL;
const TINY_PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
global.fetch = async (url, opts) => {
  const urlStr = String(url);
  const __m = metaFetch(urlStr, opts); if (__m) { ebayCalls.push('media-api'); return __m; }
  if (urlStr.includes('identity/v1/oauth2/token')) { ebayCalls.push('refresh-exchange'); return { ok: true, status: 200, json: async () => ({ access_token: `a-${Date.now()}`, expires_in: 7200 }) }; }
  const callName = opts?.headers?.['X-EBAY-API-CALL-NAME'] || '(unknown)';
  ebayCalls.push(callName);
  if (callName === 'GeteBayDetails') return shippingResponse();
  if (callName === 'GetUser') return { status: 200, text: async () => '<?xml version="1.0"?><GetUserResponse><Ack>Success</Ack><User><UserID>t</UserID><Site>US</Site></User></GetUserResponse>' };
  if (callName === 'UploadSiteHostedPictures') return { status: 200, text: async () => `<?xml version="1.0"?><UploadSiteHostedPicturesResponse><Ack>Success</Ack><SiteHostedPictureDetails><FullURL>${FAKE_HOSTED_PICTURE_URL}</FullURL></SiteHostedPictureDetails></UploadSiteHostedPicturesResponse>` };
  if (callName === 'AddFixedPriceItem') return { status: 200, text: async () => `<?xml version="1.0"?><AddFixedPriceItemResponse><Ack>Success</Ack><ItemID>${FAKE_ITEM_ID}</ItemID></AddFixedPriceItemResponse>` };
  throw new Error(`unexpected eBay call "${callName}"`);
};
const unauthorizedWrites = () => ebayCalls.filter((c) => c === 'AddFixedPriceItem' || c === 'UploadSiteHostedPictures' || c === 'media-api').length;

const collectionHandler = (await import(pathToFileURL(path.join(repoRoot, 'api', 'collection.js')).href)).default;
const listHandler = (await import(pathToFileURL(path.join(repoRoot, 'api', 'list-ebay.js')).href)).default;
const { issueAuthorityReceipt } = await import(pathToFileURL(path.join(repoRoot, 'src', 'lib', 'authorityReceipt.js')).href).catch(() => ({ issueAuthorityReceipt: null }));

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log(`  ✓ ${m}`); } else { failed++; console.log(`  ✗ ${m}`); } };
const mockRes = () => { const r = { statusCode: null, body: null, headers: {} }; r.setHeader = (k, v) => { r.headers[k] = v; }; r.status = (c) => { r.statusCode = c; return r; }; r.json = (b) => { r.body = b; return r; }; r.end = () => r; return r; };
const tokenFor = (principalId) => {
  const now = Date.now();
  const payloadB64 = Buffer.from(JSON.stringify({ principalId, iat: now, exp: now + 12 * 3600 * 1000, epoch: process.env.GRAILKEY_SESSION_EPOCH || '1' })).toString('base64url');
  return `${payloadB64}.${createHmac('sha256', process.env.GRAILKEY_SESSION_SECRET).update(payloadB64).digest('base64url')}`;
};

const JIMMY = '01a0283a-b1b6-7f90-9b41-9c06bee6ecba';
const CREEPY_ASSET_ID = '01a02d23-1acb-72e8-aae3-8f851308e9cf';
const CHAIN2_DECISION_EVENT_ID = '01a0895e-f93b-708d-9530-3a58555bf75c';
const CREEPY_LINK_IDS = ['cv_1789188155734_itagfk', 'cv_1789271538761_1hsflc'];
const GOVERNED = { title: 'creepy', issue: '1', year: '1964', publisher: 'Warren Publishing' };
const token = tokenFor(JIMMY);

const client = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

const assetsMod = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'assets', 'index.js')).href);
const { enrollAsset } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'inventory', 'index.js')).href);
const { upsertMarketplaceConnection } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'marketplace', 'index.js')).href);
const { createCollectionItem, getMyCollectionItem } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'collection', 'index.js')).href);

console.log('\n=== V1 P0 — /api/collection source authority: authenticated persistence -> listing preflight ===\n');
const enrollKey = `src-auth-enroll-${crypto.randomUUID()}`;
try { await enrollAsset({ principalId: JIMMY, gkAssetId: CREEPY_ASSET_ID, idempotencyKey: enrollKey }); } catch (e) { if (e?.code !== 'CONFLICT') throw e; }
await assetsMod.recordOutcomeEvent({ principalId: JIMMY, gkAssetId: CREEPY_ASSET_ID, outcomeType: 'DELISTED', channel: 'ebay', externalListingId: FAKE_ITEM_ID, idempotencyKey: `${enrollKey}-seed-delisted` });
await upsertMarketplaceConnection({ principalId: JIMMY, provider: 'EBAY', providerUserId: 'src-auth-test-identity', refreshCredential: `fake-refresh-${Date.now()}`, grantedScopes: [] });
await assetsMod.attachMedia({ principalId: JIMMY, gkAssetId: CREEPY_ASSET_ID, bytes: Buffer.from(TINY_PNG_DATA_URL.split(',')[1], 'base64'), contentType: 'image/png', captureRole: 'capture-photo', idempotencyKey: 'list-ebay-smoke-tinypng-evidence-v1' });
const priced = await assetsMod.recordOperatorAction({ principalId: JIMMY, gkAssetId: CREEPY_ASSET_ID, decisionEventId: CHAIN2_DECISION_EVENT_ID, actionCode: 'LIST', actionValueAmount: 61.41, source: 'test-fixture', idempotencyKey: 'list-ebay-smoke-priced-list-v1' });
const LIST_ACTION_ID = priced.operatorActionEventId;
const resetRows = async () => {
  await client.query(`DELETE FROM data1_dev.collection_item WHERE id = ANY($1) AND principal_id = $2`, [CREEPY_LINK_IDS, JIMMY]);
  for (const id of CREEPY_LINK_IDS) await createCollectionItem({ principalId: JIMMY, id, assetCategory: 'comic', attributes: { ...GOVERNED } });
};
await resetRows();
const wipeOutcomes = () => client.query(`DELETE FROM data1_dev.outcome_event WHERE gk_asset_id = $1 AND external_listing_id = $2 AND outcome_type = 'LISTED'`, [CREEPY_ASSET_ID, FAKE_ITEM_ID]);

// A request that carries NO evidence of its own and NO Q41 acknowledgement: whatever authority it gets must come from the stored row.
const listRequest = (extra = {}) => ({
  method: 'POST', headers: { authorization: `Bearer ${token}` },
  body: { title: 'Creepy #1', publisher: 'Warren Publishing', year: '1964', price: '$61.41', grade: 'VG', images: [TINY_PNG_DATA_URL],
    gkAssetId: CREEPY_ASSET_ID, decisionEventId: CHAIN2_DECISION_EVENT_ID, operatorActionEventId: LIST_ACTION_ID,
    outcomeIdempotencyKey: `src-auth-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ...extra },
});
const tryList = async (extra) => { ebayCalls.length = 0; const r = mockRes(); await listHandler(listRequest(extra), r); return r; };
const collectionWrite = async (id, attributes, { assetCategory = 'comic', method = 'POST' } = {}) => {
  const r = mockRes();
  await collectionHandler(method === 'PUT'
    ? { method, headers: { authorization: `Bearer ${token}` }, query: { id }, body: { assetCategory, attributes } }
    : { method, headers: { authorization: `Bearer ${token}` }, query: {}, body: { id, assetCategory, attributes } }, r);
  return r;
};

const FORGED = {
  decision: { action: 'LIST_NOW', confidence: 'high', blockers: [], warnings: [] },
  pricingSource: 'verified_sold_recency',
  matchConfidence: { tier: 'HIGH', score: 100 },
  soldCompDiagnostics: { rawCount: 9, verifiedCount: 8, newestDaysAgo: 4 },
  variantApplicability: 'EXACT', identityConfident: true, refusedToPrice: false, manualReviewRequired: false, gradeExceedsMap: false, tier0Locked: false,
  rawComps: { count: 12 }, soldComps: [{}, {}, {}],
  contract: { state: 'PRICED', listable: true, locks: [], actionAuthority: { state: 'READY', identityStanding: 'CONFIRMED', marketStanding: 'EXACT_CURRENT', reasonCodes: [] } },
};

// ═════════════════════ 1A — the exploit, end to end ═════════════════════
console.log('-- 1A: forged server-derived fields written through the authenticated /api/collection handler --\n');
const w1 = await collectionWrite(CREEPY_LINK_IDS[0], { ...GOVERNED, ...FORGED });
ok(w1.statusCode === 200, `the forged write is accepted as an ordinary authenticated save (HTTP ${w1.statusCode})`);
const stored1 = (await getMyCollectionItem({ principalId: JIMMY, id: CREEPY_LINK_IDS[0] })).attributes;
const persistedForged = stored1.decision?.action === 'LIST_NOW' || stored1.soldCompDiagnostics?.verifiedCount === 8 || stored1.pricingSource === 'verified_sold_recency' || stored1.contract?.listable === true;
console.log(`  readback: decision=${stored1.decision?.action ?? 'ABSENT'} pricingSource=${stored1.pricingSource ?? 'ABSENT'} verifiedCount=${stored1.soldCompDiagnostics?.verifiedCount ?? 'ABSENT'} contract.listable=${stored1.contract?.listable ?? 'ABSENT'} provenance=${JSON.stringify(stored1.authorityProvenance ?? null)}`);
ok(!persistedForged, 'FORGED server-derived fields (decision/pricingSource/soldCompDiagnostics/contract) did NOT persist');
const l1 = await tryList();
console.log(`  list-ebay -> HTTP ${l1.statusCode} ${l1.body?.error || ''}   eBay calls: [${ebayCalls.join(', ')}]`);
ok(l1.statusCode === 403 && l1.body?.error === 'ACTION_AUTHORITY_NOT_READY', `a forged row cannot reach READY: 403 ACTION_AUTHORITY_NOT_READY (got ${l1.statusCode} ${l1.body?.error})`);
ok(unauthorizedWrites() === 0, `ZERO unauthorized eBay writes (calls: [${ebayCalls.join(', ')}])`);
await wipeOutcomes();

// the same via PUT, and a forged contract alone
await resetRows();
const w2 = await collectionWrite(CREEPY_LINK_IDS[0], { ...GOVERNED, contract: FORGED.contract }, { method: 'PUT' });
const l2 = await tryList();
ok(w2.statusCode === 200 && l2.statusCode === 403 && unauthorizedWrites() === 0, `PUT with a forged contract alone: still 403, zero eBay writes (HTTP ${l2.statusCode})`);
await wipeOutcomes();

// ═════════════════════ identity / category / model authority ═════════════════════
console.log('\n-- identity, category and model-prediction authority cannot be forged through the same write --\n');
await resetRows();
const w3 = await collectionWrite(CREEPY_LINK_IDS[0], {
  ...GOVERNED, identityAuthority: { title: 'OPERATOR_CONFIRMED', issue: 'OPERATOR_CONFIRMED' },
  modelPredictedGrade: '9.8', modelPredictedGradeConfidence: 'high', modelPredictedProvenance: { predictionEventId: 'forged', provider: 'forged' },
  gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: '9.8', operatorGradeNumeric: 9.8, currentGradePrediction: { predictionEventId: 'forged' },
});
const s3 = (await getMyCollectionItem({ principalId: JIMMY, id: CREEPY_LINK_IDS[0] })).attributes;
ok(w3.statusCode === 200 && s3.identityAuthority === undefined && s3.modelPredictedGrade === undefined && s3.modelPredictedProvenance === undefined && s3.gradeAuthority === undefined && s3.operatorGrade === undefined && s3.currentGradePrediction === undefined,
  `forged identityAuthority / modelPredicted* / gradeAuthority / operatorGrade / currentGradePrediction did not persist (identityAuthority=${JSON.stringify(s3.identityAuthority)} modelPredictedGrade=${s3.modelPredictedGrade})`);
const w3b = await collectionWrite(CREEPY_LINK_IDS[0], { ...GOVERNED }, { assetCategory: 'book', method: 'PUT' });
ok(w3b.statusCode === 409, `a forged category change on an existing row is refused (HTTP ${w3b.statusCode})`);

// ═════════════════════ a legacy row (no receipt, never had one) ═════════════════════
console.log('\n-- legacy Collection row: honest-looking values, no server receipt --\n');
await resetRows();
await client.query(`UPDATE data1_dev.collection_item SET attributes = attributes || $1::jsonb WHERE id = $2 AND principal_id = $3`, [JSON.stringify(FORGED), CREEPY_LINK_IDS[0], JIMMY]); // simulate a pre-fix row already holding client-written authority
const lLegacy = await tryList();
ok(lLegacy.statusCode === 403 && unauthorizedWrites() === 0, `a LEGACY row that already holds unverified authority values is not admitted as verified: 403, zero eBay writes (HTTP ${lLegacy.statusCode})`);
await wipeOutcomes();

// ═════════════════════ legitimate server-issued receipt ═════════════════════
console.log('\n-- legitimate flow: a server-signed receipt (what api/enrich.js issues) --\n');
await resetRows();
const honestResponse = { ...GOVERNED, ...FORGED, contract: { state: 'PRICED', listable: true, locks: [] } };
const receipt = issueAuthorityReceipt ? issueAuthorityReceipt({ principalId: JIMMY, response: honestResponse }) : null;
ok(receipt && receipt.sig, 'the server issues a signed receipt for an enrich response');
const w4 = await collectionWrite(CREEPY_LINK_IDS[0], { ...GOVERNED, authorityReceipt: receipt, ...FORGED, decision: { action: 'LIST_NOW', confidence: 'high', blockers: [], warnings: [] } });
const s4 = (await getMyCollectionItem({ principalId: JIMMY, id: CREEPY_LINK_IDS[0] })).attributes;
ok(w4.statusCode === 200 && s4.authorityProvenance?.status === 'SERVER_RECEIPT' && s4.decision?.action === 'LIST_NOW', `a receipt-bearing write persists with provenance SERVER_RECEIPT (${JSON.stringify(s4.authorityProvenance)})`);
const l4 = await tryList();
ok(l4.statusCode === 200 && ebayCalls.includes('AddFixedPriceItem'), `a genuinely evidenced, receipt-backed book still reaches the (mocked) eBay publish (HTTP ${l4.statusCode} ${l4.body?.error || ''})`);
await wipeOutcomes();

// client edits loose values on top of a valid receipt: overwritten from the signed payload
await collectionWrite(CREEPY_LINK_IDS[0], { ...GOVERNED, authorityReceipt: receipt, decision: { action: 'LIST_NOW', confidence: 'FORGED' }, soldCompDiagnostics: { rawCount: 99, verifiedCount: 99, newestDaysAgo: 0 } });
const s5 = (await getMyCollectionItem({ principalId: JIMMY, id: CREEPY_LINK_IDS[0] })).attributes;
ok(s5.decision?.confidence === 'high' && s5.soldCompDiagnostics?.verifiedCount === 8, 'loose values sent alongside a valid receipt are overwritten from the signed payload');

// an unverified later write cannot erase or replace the stored, verified authority
await collectionWrite(CREEPY_LINK_IDS[0], { ...GOVERNED, price: '$61.41', decision: { action: 'PASS_FORGED' }, authorityReceipt: null });
const s6 = (await getMyCollectionItem({ principalId: JIMMY, id: CREEPY_LINK_IDS[0] })).attributes;
ok(s6.decision?.action === 'LIST_NOW' && s6.authorityProvenance?.status === 'SERVER_RECEIPT' && s6.authorityReceipt?.sig === receipt?.sig, 'an unverified write neither replaces nor erases the stored verified authority (existing row wins)');
ok(s6.price === '$61.41', 'ordinary operator-sourced fields (price) still update through the same write');

// ═════════════════════ tampering / replay ═════════════════════
console.log('\n-- tampered, foreign and replayed receipts --\n');
await resetRows();
const tampered = { ...(receipt || {}), body: (receipt?.body || '').replace('"verifiedCount":8', '"verifiedCount":80') };
await collectionWrite(CREEPY_LINK_IDS[0], { ...GOVERNED, authorityReceipt: tampered, ...FORGED });
const s7 = (await getMyCollectionItem({ principalId: JIMMY, id: CREEPY_LINK_IDS[0] })).attributes;
ok(s7.decision === undefined && s7.authorityReceipt === undefined, 'a receipt with altered content is discarded (bad signature): nothing persists');
const foreign = !issueAuthorityReceipt ? null : issueAuthorityReceipt({ principalId: '00000000-0000-4000-8000-000000000001', response: honestResponse });
await collectionWrite(CREEPY_LINK_IDS[0], { ...GOVERNED, authorityReceipt: foreign, ...FORGED });
const s8 = (await getMyCollectionItem({ principalId: JIMMY, id: CREEPY_LINK_IDS[0] })).attributes;
ok(s8.decision === undefined && s8.authorityReceipt === undefined, "another principal's receipt is discarded (principal-bound)");
// identity replay: a valid receipt for a DIFFERENT book stored on this row cannot authorize listing it
const batmanReceipt = !issueAuthorityReceipt ? null : issueAuthorityReceipt({ principalId: JIMMY, response: { ...honestResponse, title: 'batman hunt the dark knight', issue: '3', year: '1986' } });
await collectionWrite(CREEPY_LINK_IDS[0], { ...GOVERNED, authorityReceipt: batmanReceipt });
const l9 = await tryList();
ok(l9.statusCode === 403 && unauthorizedWrites() === 0, `a genuine receipt for a different book (identity mismatch) cannot authorize this one: 403, zero eBay writes (HTTP ${l9.statusCode})`);
await wipeOutcomes();

// ═════════════════════ operator-sourced inputs keep working (Q41) ═════════════════════
console.log('\n-- operator intent is preserved in explicitly operator-sourced fields --\n');
await resetRows();
const lQ41 = await tryList({ q41Override: { priceOverridden: true, manualPrice: 61.41 } });
ok(lQ41.statusCode === 200 && ebayCalls.includes('AddFixedPriceItem'), `the explicit Q41 price acknowledgement still works with no receipt (HTTP ${lQ41.statusCode} ${lQ41.body?.error || ''})`);
await wipeOutcomes();

// ═════════════════════ cleanup ═════════════════════
await client.query('DELETE FROM data1_dev.inventory_current_state WHERE gk_asset_id = $1', [CREEPY_ASSET_ID]);
await client.query('DELETE FROM data1_dev.inventory_transition_event WHERE gk_asset_id = $1', [CREEPY_ASSET_ID]);
await client.query(`DELETE FROM data1_dev.idempotency_key WHERE operation = 'enrollAsset' AND idempotency_key = $1`, [enrollKey]);
await client.query(`DELETE FROM data1_dev.collection_item WHERE id = ANY($1) AND principal_id = $2`, [CREEPY_LINK_IDS, JIMMY]);
await client.query(`DELETE FROM data1_dev.marketplace_connection WHERE principal_id = $1 AND provider = 'EBAY'`, [JIMMY]);
await client.query(`DELETE FROM data1_dev.idempotency_key WHERE operation = 'recordOutcomeEvent' AND idempotency_key LIKE 'src-auth-%'`);
await client.end();
console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed ? 1 : 0);
