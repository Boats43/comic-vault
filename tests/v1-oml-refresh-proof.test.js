// V1 -- OLD MAN LOGAN #25-SHAPED REFRESH PROOF (isolated Development, nothing in Production touched, no Vision call, eBay fully mocked).
//
// Question answered: after an authorised market refresh of an OWNED, physically-linked comic whose title, 1:25 variant and grade were confirmed by the operator,
// are all operator-confirmed facets, the physical-asset linkage and a correct server-issued, asset-bound authority receipt still in place -- and does the
// SERVER-GENERATED eBay listing title still carry the operator-confirmed 1:25 variant?
//
// Three independent observations, in order: (1) the REAL api/enrich.js response, (2) the persisted Collection row read back from Postgres after a REAL
// api/collection PUT, (3) the title in the REAL api/list-ebay.js AddFixedPriceItem packet (built server-side from the persisted row; the request's own title is a decoy).
// The desired title is never an input. DISCLOSED MIRROR: App.jsx's refreshMarketData merge cannot be imported, so the persisted row is produced by applying that
// merge's rules for exactly these facets (governingTitleForMerge is the REAL function; the variant/operator-grade copy rules are mirrored from App.jsx ~14466 / ~14395).
// DISCLOSED FIXTURE: the pre-existing operator authority (identityAuthority.title/.variant, gradeAuthority/operatorGrade 9.2) is placed by a direct UPDATE on the
// throwaway Development row, standing in for the earlier operator actions that created it in Production.
// Invoke: node tests/v1-oml-refresh-proof.test.js

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
delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN; delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN;
process.env.EBAY_APP_ID = process.env.EBAY_APP_ID || 'test-app-id';
process.env.EBAY_CERT_ID = process.env.EBAY_CERT_ID || 'test-cert-id';
process.env.PRICECHARTING_TOKEN = process.env.PRICECHARTING_TOKEN || 'test-pc-token';
await import('./helpers/spendGuardTestSetup.js');

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
const mockRes = () => { const res = { statusCode: null, body: null, headers: {} }; res.setHeader = (k, v) => { res.headers[k] = v; }; res.status = (c) => { res.statusCode = c; return res; }; res.json = (b) => { res.body = b; return res; }; return res; };

const TINY_A = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const TINY_B = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const PNG_DATA_URL = `data:image/png;base64,${TINY_A}`;
mockState.mediaImageUrl = 'https://i.ebayimg.com/hosted/oml-proof.jpg';

// ── ONE fetch mock: eBay Browse + CV/PC for enrich, Trading API for list-ebay. Anything else throws (no live call possible). ──
const POOL = [
  ['Old Man Logan #25 Deodato 1:25 Variant Marvel 2017 NM', 24.5], ['Old Man Logan 25 Mike Deodato 1:25 Incentive Variant 2017', 29.0], ['Old Man Logan #25 Deodato Variant 1:25 VF/NM', 22.0],
  ['Old Man Logan #25 (2017) Deodato 1 in 25 Variant Cover', 27.5], ['Old Man Logan #25 Marvel 2017 Variant 1:25 Deodato', 26.0],
];
const ebayItem = ([t, p], i) => ({
  itemId: `v1|50000000000${i}|0`, title: t, leafCategoryIds: ['259104'], categories: [{ categoryId: '259104', categoryName: 'Comics & Graphic Novels' }],
  image: { imageUrl: 'https://i.ebayimg.com/images/g/fake/s-l225.jpg' }, price: { value: String(p), currency: 'USD' },
  itemHref: `https://api.ebay.com/buy/browse/v1/item/v1%7C50000000000${i}%7C0`, seller: { username: 'testseller', feedbackPercentage: '99.9', feedbackScore: 1000 },
  condition: 'Used', conditionId: '3000', thumbnailImages: [{ imageUrl: 'https://i.ebayimg.com/images/g/fake/s-l1600.jpg' }], buyingOptions: ['FIXED_PRICE'],
  itemWebUrl: `https://www.ebay.com/itm/50000000000${i}`, itemLocation: { postalCode: '000**', country: 'US' }, legacyItemId: `50000000000${i}`, adultOnly: false,
  itemOriginDate: '2026-10-01T18:07:04.000Z', itemCreationDate: '2026-10-01T18:07:04.000Z', listingMarketplaceId: 'EBAY_US',
});
const ITEMS = POOL.map(ebayItem);
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
const calls = { anthropic: 0, trading: [] };
let lastAddBody = '';
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const mf = metaFetch(u, opts); if (mf) return mf;
  if (u.includes('identity/v1/oauth2/token')) { const rc = new URLSearchParams(String(opts.body || '')).get('refresh_token'); return json({ access_token: `access-for-${rc || 'app'}`, expires_in: 7200, token_type: 'Application Access Token' }); }
  if (u.includes('search_by_image') || u.includes('item_summary/search')) return json({ itemSummaries: ITEMS, total: ITEMS.length });
  if (u.includes('comicvine.gamespot.com')) return json({ results: [], status_code: 1, error: 'OK' });
  if (u.includes('pricecharting.com')) return json({ error: 'not found' }, 404);
  if (u.includes('api.anthropic.com')) { calls.anthropic++; return json({ content: [{ type: 'text', text: '{}' }] }); }
  const callName = opts?.headers?.['X-EBAY-API-CALL-NAME'];
  if (!callName) throw new Error(`NO NETWORK ALLOWED: ${u.slice(0, 80)}`);
  calls.trading.push(callName);
  if (callName === 'GeteBayDetails') return shippingResponse();
  if (callName === 'GetUser') return { status: 200, text: async () => '<GetUserResponse><Ack>Success</Ack><User><UserID>oml-seller</UserID><Site>US</Site></User></GetUserResponse>' };
  if (callName === 'AddFixedPriceItem') { lastAddBody = String(opts.body || ''); return { status: 200, text: async () => `<AddFixedPriceItemResponse><Ack>Success</Ack><ItemID>oml-proof-${Date.now()}</ItemID></AddFixedPriceItemResponse>` }; }
  throw new Error(`unexpected eBay call ${callName}`);
};

const imp = (...p) => import(pathToFileURL(path.join(repoRoot, ...p)).href);
const { issueToken } = await imp('src', 'modules', 'auth', 'token.js');
const { upsertMarketplaceConnection } = await imp('src', 'modules', 'marketplace', 'index.js');
const { CONNECT_SCOPES } = await imp('src', 'lib', 'ebayUserOAuth.js');
const A = await imp('src', 'modules', 'assets', 'index.js');
const { enrollAsset } = await imp('src', 'modules', 'inventory', 'index.js');
const { createCollectionItem, getMyCollectionItem } = await imp('src', 'modules', 'collection', 'index.js');
const { verifyAuthorityReceipt, computeEvidenceVersion } = await imp('src', 'lib', 'authorityReceipt.js');
const { governingTitleForMerge } = await imp('src', 'lib', 'operatorIdentityAuthority.js');
const enrichHandler = (await imp('api', 'enrich.js')).default;
const collectionHandler = (await imp('api', 'collection.js')).default;
const listHandler = (await imp('api', 'list-ebay.js')).default;

const db = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const nonce = (l) => `omlp-${l}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const principalId = (await db.query('SELECT uuidv7() AS id')).rows[0].id;
await db.query(`INSERT INTO data1_dev.gk_principal (id, display_name, kind) VALUES ($1, 'oml-refresh-proof', 'operator')`, [principalId]);
await upsertMarketplaceConnection({ principalId, provider: 'EBAY', providerUserId: nonce('ebay'), refreshCredential: `fake-${nonce('r')}`, grantedScopes: [...CONNECT_SCOPES] });
const token = issueToken({ principalId }).token;

// ── fixture: an OML-shaped owned row (operator-confirmed title + 1:25 variant + operator grade 9.2), linked to a real minted asset with two distinct photos ──
const n = nonce('oml');
const ROW = `cv_${n}`;
const { assetId: gkAssetId } = await A.createPhysicalAsset({ principalId, captureBasis: { test: true, n }, assetClass: 'comic', source: 'test-fixture', idempotencyKey: `${n}-m` });
await enrollAsset({ principalId, gkAssetId, idempotencyKey: `${n}-e` });
const BEFORE = { title: 'old man logan deodato', issue: '25', year: '2017', publisher: 'Marvel', variant: '1:25', grade: 'VF 8.0', price: '$15.10', assetType: 'comic', assetCategory: 'comic', remoteImages: [] };
await createCollectionItem({ principalId, id: ROW, assetCategory: 'comic', attributes: BEFORE });
await A.linkCollectionItem({ principalId, collectionItemId: ROW, gkAssetId, idempotencyKey: `${n}-l` });
const { decisionEventId } = await A.recordDecision({ principalId, gkAssetId, recommendation: 'RESEARCH', idempotencyKey: `${n}-d` });
for (const [i, b64] of [TINY_A, TINY_B].entries()) await A.attachMedia({ principalId, gkAssetId, bytes: Buffer.from(b64, 'base64'), contentType: 'image/png', captureRole: 'capture-photo', idempotencyKey: `${n}-p${i}` });
const { operatorActionEventId } = await A.recordOperatorAction({ principalId, gkAssetId, decisionEventId, actionCode: 'LIST', actionValueAmount: 25, source: 'test-fixture', idempotencyKey: `${n}-a` });
await db.query(`UPDATE data1_dev.collection_item SET attributes = attributes || $1::jsonb WHERE id = $2 AND principal_id = $3`, [JSON.stringify({
  identityAuthority: { title: 'OPERATOR_CONFIRMED', variant: 'OPERATOR_CONFIRMED' },
  gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: '9.2', operatorGradeNumeric: 9.2, operatorIsGraded: false,
}), ROW, principalId]);
const rowBefore = (await getMyCollectionItem({ principalId, id: ROW })).attributes;
const hashesBefore = await A.getAssetMediaContentHashes({ principalId, gkAssetId });

console.log('\n=== OML-shaped refresh proof (real enrich + collection + list-ebay handlers, real Development DB, mocked network) ===\n');
ok(rowBefore.identityAuthority?.title === 'OPERATOR_CONFIRMED' && rowBefore.identityAuthority?.variant === 'OPERATOR_CONFIRMED' && rowBefore.operatorGrade === '9.2' && rowBefore.gradeAuthority === 'OPERATOR_CONFIRMED', 'fixture: the OML operator authority is in place before the refresh');
ok(rowBefore.authorityReceipt === undefined, 'fixture: no authority receipt before the refresh (the pre-receipt state of the real OML row)');

try {
  // ── (1) the REAL enrich handler, refresh-shaped request (App.jsx refreshMarketData) ──
  const er = mockRes();
  await enrichHandler({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body: {
    assetType: 'comic', title: rowBefore.title, issue: rowBefore.issue, grade: rowBefore.grade, isGraded: false, numericGrade: null, year: rowBefore.year, publisher: rowBefore.publisher,
    variant: rowBefore.variant, images: [], skipClaudeCheck: true, skipImageSearch: true, collectionItemId: ROW, ownedRefresh: true,
  } }, er);
  const resp = er.body || {};
  console.log(`  (enrich: HTTP ${er.statusCode} title=${JSON.stringify(resp.title)} variantNote=${JSON.stringify(resp.variantNote)} price=${resp.price} pricingSource=${resp.pricingSource} operatorGrade=${JSON.stringify(resp.operatorGrade)} gradeAuthority=${JSON.stringify(resp.gradeAuthority)})`);
  ok(er.statusCode === 200, `enrich refresh returned HTTP 200 (got ${er.statusCode})`);
  ok(calls.anthropic === 0, 'no model / Vision call was made');
  ok(String(resp.title || '').toLowerCase() === 'old man logan deodato', `[response] operator-confirmed title survives (got ${JSON.stringify(resp.title)})`);
  ok(resp.variantNote === '1:25', `[response] operator-confirmed 1:25 variant survives in variantNote (got ${JSON.stringify(resp.variantNote)})`);
  ok(String(resp.issue ?? rowBefore.issue) === '25', `[response] issue #25 unchanged (got ${JSON.stringify(resp.issue)})`);
  ok(!Object.prototype.hasOwnProperty.call(resp, 'operatorGrade') || String(resp.operatorGrade) === '9.2', `[response] operator grade 9.2 is not contradicted (operatorGrade=${JSON.stringify(resp.operatorGrade)}, gradeAuthority=${JSON.stringify(resp.gradeAuthority)})`);
  const v = verifyAuthorityReceipt(resp.authorityReceipt, principalId);
  ok(v.ok === true, '[response] the receipt verifies for this principal');
  const evNow = computeEvidenceVersion(await A.getAssetMediaContentHashes({ principalId, gkAssetId }));
  ok(v.ok && v.payload.binding.collectionItemId === ROW && v.payload.binding.gkAssetId === gkAssetId && v.payload.binding.evidenceVersion === evNow && evNow === computeEvidenceVersion(hashesBefore),
    '[response] the receipt is bound to THIS row, THIS physical asset and its current evidence version (computed independently)');

  // ── (2) persist through the REAL /api/collection PUT, applying App.jsx's merge rules for the refreshed facets ──
  const has = (k) => Object.prototype.hasOwnProperty.call(resp, k);
  const synced = {
    ...rowBefore,
    title: governingTitleForMerge(rowBefore, resp.title),
    variant: has('variantNote') ? resp.variantNote : rowBefore.variant,
    gradeAuthority: has('gradeAuthority') ? resp.gradeAuthority : rowBefore.gradeAuthority,
    operatorGrade: has('operatorGrade') ? resp.operatorGrade : rowBefore.operatorGrade,
    operatorGradeNumeric: has('operatorGradeNumeric') ? resp.operatorGradeNumeric : rowBefore.operatorGradeNumeric,
    price: resp.price ?? rowBefore.price, decision: resp.decision, pricingSource: resp.pricingSource, contract: resp.contract, soldCompDiagnostics: resp.soldCompDiagnostics,
    authorityReceipt: resp.authorityReceipt,
  };
  const pr = mockRes();
  await collectionHandler({ method: 'PUT', headers: { authorization: `Bearer ${token}` }, query: { id: ROW }, body: { assetCategory: 'comic', attributes: synced } }, pr);
  ok(pr.statusCode === 200, `[sync] /api/collection PUT accepted the refreshed row (HTTP ${pr.statusCode})`);
  const after = (await getMyCollectionItem({ principalId, id: ROW })).attributes;
  const raw = (await db.query(`SELECT attributes FROM data1_dev.collection_item WHERE id = $1 AND principal_id = $2`, [ROW, principalId])).rows[0].attributes;
  ok(after.title === 'old man logan deodato' && raw.title === after.title, `[persisted] operator-confirmed title (${JSON.stringify(raw.title)})`);
  ok(raw.variant === '1:25' && raw.identityAuthority?.variant === 'OPERATOR_CONFIRMED' && raw.identityAuthority?.title === 'OPERATOR_CONFIRMED', `[persisted] 1:25 variant and both identity locks (variant=${JSON.stringify(raw.variant)})`);
  ok(String(raw.operatorGrade) === '9.2' && raw.gradeAuthority === 'OPERATOR_CONFIRMED' && Number(raw.operatorGradeNumeric) === 9.2, `[persisted] operator grade 9.2 / OPERATOR_CONFIRMED (${JSON.stringify(raw.operatorGrade)}, ${JSON.stringify(raw.gradeAuthority)})`);
  ok(raw.issue === '25' && raw.grade === 'VF 8.0', '[persisted] issue 25 and the stored grade string are unchanged');
  const link = await A.resolveCollectionItemLink({ principalId, collectionItemId: ROW });
  ok(link?.gkAssetId === gkAssetId, '[persisted] physical-asset linkage is intact (same gkAssetId)');
  ok(raw.authorityProvenance?.status === 'SERVER_RECEIPT' && verifyAuthorityReceipt(raw.authorityReceipt, principalId).ok === true && verifyAuthorityReceipt(raw.authorityReceipt, principalId).payload.binding.gkAssetId === gkAssetId,
    '[persisted] provenance SERVER_RECEIPT and the stored receipt verifies and names the same asset');

  // ── (3) tenth assertion: the SERVER-GENERATED listing title retains the operator-confirmed 1:25 variant ──
  const lr = mockRes();
  await listHandler({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body: {
    title: 'CLIENT TITLE (decoy, must be ignored)', publisher: 'x', year: '1990', price: '$25.00', grade: 'VF', images: [PNG_DATA_URL],
    gkAssetId, decisionEventId, operatorActionEventId,
    q41Override: { priceOverridden: true, manualPrice: 25, lockClassAcknowledged: 'insufficiency', locks: ['no-sold-evidence'], state: 'REVIEW', decision: 'RESEARCH' },
  } }, lr);
  const title = (lastAddBody.match(/<Title>([^<]*)<\/Title>/) || [])[1] || null;
  console.log(`  (list-ebay: HTTP ${lr.statusCode} ${lr.body?.error || ''} | server-generated <Title>: ${JSON.stringify(title)})`);
  ok(lr.statusCode === 200 && calls.trading.includes('AddFixedPriceItem') && !!title, `[listing] the real handler built an AddFixedPriceItem packet (HTTP ${lr.statusCode})`);
  ok(!!title && /1:25/.test(title) && /#25/.test(title) && /old man logan/i.test(title) && !/decoy/i.test(title), `[listing] TENTH: the server-generated title retains the operator-confirmed 1:25 variant and is not the client's decoy (${JSON.stringify(title)})`);
} finally {
  // cleanup: remove only this run's disposable rows that carry no history; append-only ledger rows remain as permanent Development fixtures (repo convention)
  await db.query(`DELETE FROM data1_dev.marketplace_connection WHERE principal_id = $1`, [principalId]).catch(() => {});
  await db.end();
}
console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed ? 1 : 0);
