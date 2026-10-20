// PHYSICAL_ASSET_NOT_LINKED + DISTINCT LINKAGE REFUSALS -- the REAL api/list-ebay.js handler against REAL Development Postgres, mocked eBay `fetch` only.
// Every refusal here must happen BEFORE any eBay call; nothing may mint, link, attest ownership, write authority or publish.
// Invoke: node tests/physical-asset-not-linked-handler.test.js

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
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
const mockRes = () => { const res = { statusCode: null, body: null, headers: {} }; res.setHeader = (k, v) => { res.headers[k] = v; }; res.status = (c) => { res.statusCode = c; return res; }; res.json = (b) => { res.body = b; return res; }; return res; };

const fetchCalls = [];
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const PNG2 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
mockState.mediaImageUrl = 'https://i.ebayimg.com/hosted/not-linked.jpg';
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const mf = metaFetch(u, opts); if (mf) return mf;
  if (u.includes('identity/v1/oauth2/token')) { const rc = new URLSearchParams(String(opts.body || '')).get('refresh_token'); return { ok: true, status: 200, json: async () => ({ access_token: `access-for-${rc}`, expires_in: 7200 }) }; }
  const call = opts?.headers?.['X-EBAY-API-CALL-NAME'];
  if (!call) throw new Error(`NO NETWORK ALLOWED: ${u.slice(0, 60)}`);
  fetchCalls.push(call);
  if (call === 'GeteBayDetails') return shippingResponse();
  if (call === 'GetUser') return { status: 200, text: async () => '<GetUserResponse><Ack>Success</Ack><User><UserID>s</UserID></User></GetUserResponse>' };
  if (call === 'AddFixedPriceItem') return { status: 200, text: async () => `<R><Ack>Success</Ack><ItemID>nl-${Date.now()}</ItemID></R>` };
  throw new Error(`unexpected eBay call ${call}`);
};
const noEbay = () => fetchCalls.length === 0;

const imp = (...p) => import(pathToFileURL(path.join(repoRoot, ...p)).href);
const { issueToken } = await imp('src', 'modules', 'auth', 'token.js');
const { upsertMarketplaceConnection } = await imp('src', 'modules', 'marketplace', 'index.js');
const { CONNECT_SCOPES } = await imp('src', 'lib', 'ebayUserOAuth.js');
const A = await imp('src', 'modules', 'assets', 'index.js');
const { enrollAsset } = await imp('src', 'modules', 'inventory', 'index.js');
const { createCollectionItem, updateCollectionItem } = await imp('src', 'modules', 'collection', 'index.js');
const { issueAuthorityReceipt, computeEvidenceVersion } = await imp('src', 'lib', 'authorityReceipt.js');
const handler = (await imp('api', 'list-ebay.js')).default;

const db = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const nonce = (l) => `nl-${l}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
async function principal(label) {
  const id = (await db.query('SELECT uuidv7() AS id')).rows[0].id;
  await db.query(`INSERT INTO data1_dev.gk_principal (id, display_name, kind) VALUES ($1, $2, 'operator')`, [id, label]);
  await upsertMarketplaceConnection({ principalId: id, provider: 'EBAY', providerUserId: nonce('i'), refreshCredential: `fake-${nonce('r')}`, grantedScopes: [...CONNECT_SCOPES] });
  return id;
}
const PA = await principal('nl-a'), PB = await principal('nl-b');
const TITLE = `NL${randomBytes(4).toString('hex')} Comic`;   // unique per run: GK-279 stays untouched

async function mint(pid, label, { receipt = 'none', appendAfter = false } = {}) {
  const n = nonce(label);
  const { assetId: gkAssetId } = await A.createPhysicalAsset({ principalId: pid, captureBasis: { test: true, n }, assetClass: 'comic', source: 'test-fixture', idempotencyKey: `${n}-m` });
  await enrollAsset({ principalId: pid, gkAssetId, idempotencyKey: `${n}-e` });
  const rowId = `cv_${n}`;
  await createCollectionItem({ principalId: pid, id: rowId, assetCategory: 'comic', attributes: { title: `${TITLE} ${label}`, publisher: 'T', year: '1990' } });
  await A.linkCollectionItem({ principalId: pid, collectionItemId: rowId, gkAssetId, idempotencyKey: `${n}-l` });
  const { decisionEventId } = await A.recordDecision({ principalId: pid, gkAssetId, recommendation: 'RESEARCH', idempotencyKey: `${n}-d` });
  await A.attachMedia({ principalId: pid, gkAssetId, bytes: Buffer.from(PNG.split(',')[1], 'base64'), contentType: 'image/png', captureRole: 'capture-photo', idempotencyKey: `${n}-p` });
  const { operatorActionEventId } = await A.recordOperatorAction({ principalId: pid, gkAssetId, decisionEventId, actionCode: 'LIST', actionValueAmount: 25, source: 'test-fixture', idempotencyKey: `${n}-a` });
  if (receipt === 'bound') {
    const hashes = await A.getAssetMediaContentHashes({ principalId: pid, gkAssetId });
    const authorityReceipt = issueAuthorityReceipt({ principalId: pid, binding: { collectionItemId: rowId, gkAssetId, evidenceVersion: computeEvidenceVersion(hashes) },
      response: { title: `${TITLE} ${label}`, issue: null, year: '1990', decision: { action: 'LIST_NOW' }, pricingSource: 'verified_sold', matchConfidence: { tier: 'HIGH', score: 95 }, rawComps: { count: 8 }, soldComps: [{}, {}, {}, {}, {}], soldCompDiagnostics: { rawCount: 6, verifiedCount: 5, newestDaysAgo: 10 }, identityConfident: true } });
    await updateCollectionItem({ principalId: pid, id: rowId, assetCategory: 'comic', attributes: { title: `${TITLE} ${label}`, publisher: 'T', year: '1990', authorityReceipt } });
    if (appendAfter) await A.attachMedia({ principalId: pid, gkAssetId, bytes: Buffer.from(PNG2, 'base64'), contentType: 'image/png', captureRole: 'capture-photo', idempotencyKey: `${n}-p2` });
  }
  return { gkAssetId, decisionEventId, operatorActionEventId, rowId };
}
const req = (pid, body) => ({ method: 'POST', headers: pid ? { authorization: `Bearer ${issueToken({ principalId: pid }).token}` } : {}, body: { title: 'x', price: '$25.00', grade: 'VF', images: [PNG], ...body } });
const run = async (r) => { fetchCalls.length = 0; const res = mockRes(); await handler(r, res); return res; };
const countRows = async (t) => Number((await db.query(`SELECT count(*)::int n FROM data1_dev.${t}`)).rows[0].n);
const FORGED = { decision: { action: 'LIST_NOW', confidence: 'high' }, pricingSource: 'verified_sold', soldCompDiagnostics: { rawCount: 6, verifiedCount: 5, newestDaysAgo: 10 }, identityConfident: true, contract: { listable: true, state: 'PRICED' }, actionAuthority: { state: 'READY' } };

console.log('\n=== PHYSICAL_ASSET_NOT_LINKED + distinct linkage refusals (real handler, real Development DB) ===\n');
try {
  const unlinkedRow = `cv_${nonce('unlinked')}`;
  await createCollectionItem({ principalId: PA, id: unlinkedRow, assetCategory: 'comic', attributes: { title: `${TITLE} unlinked`, publisher: 'T', year: '1990' } });
  const assetsBefore = await countRows('gk_asset'), linksBefore = await countRows('collection_item_link'), outcomesBefore = await countRows('outcome_event'), authBefore = await countRows('operator_authority_event');

  console.log('-- unlinked Collection row, authenticated owner --');
  let res = await run(req(PA, { collectionItemId: unlinkedRow }));
  ok(res.statusCode === 409 && res.body?.error === 'PHYSICAL_ASSET_NOT_LINKED' && noEbay(), `owner of an unlinked row -> 409 PHYSICAL_ASSET_NOT_LINKED, zero eBay calls (${res.statusCode} ${res.body?.error})`);
  ok(/not linked to a physical asset/i.test(res.body?.message || '') && /Nothing was listed/.test(res.body?.message || '') && /Capture as Owned Physical Asset/.test(res.body?.message || ''), 'the message names the condition, says nothing was listed, and points at the existing explicit action');
  res = await run(req(PA, { collectionItemId: unlinkedRow, ...FORGED }));
  ok(res.statusCode === 409 && res.body?.error === 'PHYSICAL_ASSET_NOT_LINKED' && noEbay(), 'forged LIST_NOW / contract.listable / actionAuthority READY in the request do not change the refusal');
  res = await run(req(PA, { collectionItemId: unlinkedRow, q41Override: { priceOverridden: true, manualPrice: 25, lockClassAcknowledged: 'insufficiency', locks: ['no-sold-evidence'], state: 'REVIEW', decision: 'RESEARCH' } }));
  ok(res.statusCode === 409 && res.body?.error === 'PHYSICAL_ASSET_NOT_LINKED' && noEbay(), 'a Q41 acknowledgement cannot substitute for the missing physical-asset link');

  console.log('\n-- no information leak across principals --');
  const foreign = await run(req(PB, { collectionItemId: unlinkedRow }));
  const missing = await run(req(PB, { collectionItemId: `cv_${nonce('does-not-exist')}` }));
  ok(foreign.statusCode === 400 && foreign.body?.error === 'GRAILKEY_LINKAGE_INCOMPLETE' && noEbay(), `another principal naming A's unlinked row gets the GENERIC refusal (${foreign.statusCode} ${foreign.body?.error})`);
  ok(JSON.stringify(foreign.body) === JSON.stringify(missing.body) && foreign.statusCode === missing.statusCode, "B's response for A's row is byte-identical to the response for a row that does not exist (no existence/linkage oracle)");
  const linked = await mint(PA, 'linked-lookup');
  const foreignLinked = await run(req(PB, { collectionItemId: linked.rowId }));
  ok(JSON.stringify(foreignLinked.body) === JSON.stringify(missing.body), "B's response for A's LINKED row is also identical (linked vs unlinked is indistinguishable to a non-owner)");
  const anon = await run(req(null, { collectionItemId: unlinkedRow }));
  ok(anon.statusCode === 401 && anon.body?.error === 'GRAILKEY_AUTH_REQUIRED' && noEbay(), 'no session -> 401, no linkage information at all');

  console.log('\n-- forged gkAssetId cannot bypass linkage validation --');
  const bAsset = await mint(PB, 'b-asset');
  res = await run(req(PA, { gkAssetId: bAsset.gkAssetId, decisionEventId: bAsset.decisionEventId, operatorActionEventId: bAsset.operatorActionEventId, collectionItemId: unlinkedRow }));
  ok([403, 404].includes(res.statusCode) && noEbay(), `A presenting B's gkAssetId + B's event ids is refused (${res.statusCode} ${res.body?.error}), zero eBay calls`);
  res = await run(req(PA, { gkAssetId: '01a0aaaa-0000-7000-8000-000000000000', decisionEventId: linked.decisionEventId, operatorActionEventId: linked.operatorActionEventId }));
  ok(res.statusCode >= 400 && res.statusCode < 500 && noEbay(), `a fabricated gkAssetId is refused (${res.statusCode} ${res.body?.error}), zero eBay calls`);
  res = await run(req(PA, { gkAssetId: linked.gkAssetId, decisionEventId: bAsset.decisionEventId, operatorActionEventId: bAsset.operatorActionEventId }));
  ok(res.statusCode >= 400 && res.statusCode < 500 && noEbay(), `A's real asset with B's decision/action ids is refused (${res.statusCode} ${res.body?.error})`);

  console.log('\n-- linked rows keep DISTINCT downstream refusals --');
  res = await run(req(PA, { collectionItemId: linked.rowId }));
  ok(res.statusCode === 400 && res.body?.error === 'GRAILKEY_LINKAGE_INCOMPLETE' && res.body?.reason === 'GK_ASSET_ID_MISSING' && noEbay(), `a LINKED row is never told it is unlinked, and the server does not auto-fill the link (${res.body?.error} / ${res.body?.reason})`);
  res = await run(req(PA, { gkAssetId: linked.gkAssetId, operatorActionEventId: linked.operatorActionEventId }));
  ok(res.statusCode === 400 && res.body?.reason === 'DECISION_EVENT_MISSING' && noEbay(), `missing decision event -> reason DECISION_EVENT_MISSING (${res.body?.reason})`);
  res = await run(req(PA, { gkAssetId: linked.gkAssetId, decisionEventId: linked.decisionEventId }));
  ok(res.statusCode === 400 && res.body?.reason === 'OPERATOR_ACTION_MISSING' && noEbay(), `missing operator action -> reason OPERATOR_ACTION_MISSING (${res.body?.reason})`);
  const full = (a, extra) => req(PA, { gkAssetId: a.gkAssetId, decisionEventId: a.decisionEventId, operatorActionEventId: a.operatorActionEventId, collectionItemId: a.rowId, ...extra });
  res = await run(full(linked));
  ok(res.statusCode === 403 && res.body?.error === 'ACTION_AUTHORITY_NOT_READY' && res.body?.refusalReason === 'AUTHORITY_RECEIPT_UNVERIFIED_ABSENT' && noEbay(), `linked, complete ids, NO receipt -> ACTION_AUTHORITY_NOT_READY / ${res.body?.refusalReason}`);
  const forgedLinked = await run(full(linked, FORGED));
  ok(forgedLinked.statusCode === 403 && forgedLinked.body?.refusalReason === 'AUTHORITY_RECEIPT_UNVERIFIED_ABSENT' && noEbay(), 'request-borne READY evidence cannot replace the receipt (still receipt-absent refusal)');
  const stale = await mint(PA, 'stale', { receipt: 'bound', appendAfter: true });
  res = await run(full(stale));
  ok(res.statusCode === 403 && res.body?.refusalReason === 'AUTHORITY_RECEIPT_EVIDENCE_VERSION_STALE' && noEbay(), `receipt issued before a later photo -> ${res.body?.refusalReason}`);
  const good = await mint(PA, 'good', { receipt: 'bound' });
  res = await run(full(good));
  ok(res.statusCode === 200 && fetchCalls.includes('AddFixedPriceItem'), `control: a linked, receipted, current-evidence asset still publishes (${res.statusCode}) -- the new checks are not an off-switch`);

  console.log('\n-- the refusals themselves wrote nothing --');
  const assetsAfter = await countRows('gk_asset'), linksAfter = await countRows('collection_item_link');
  ok(assetsAfter - assetsBefore === 4 && linksAfter - linksBefore === 4, `the only new assets/links are this test's own 4 minted fixtures (assets +${assetsAfter - assetsBefore}, links +${linksAfter - linksBefore}); NO refusal minted or linked anything`);
  ok((await countRows('operator_authority_event')) === authBefore, 'zero operator_authority_event rows written by any refusal');
  const unl = (await db.query(`SELECT count(*)::int n FROM data1_dev.collection_item_link WHERE collection_item_id = $1`, [unlinkedRow])).rows[0].n;
  ok(unl === 0, 'the unlinked row is still unlinked after every attempt');
  void outcomesBefore;
} finally {
  await db.query(`DELETE FROM data1_dev.marketplace_connection WHERE principal_id = ANY($1)`, [[PA, PB]]).catch(() => {});
  await db.end();
}
console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed ? 1 : 0);
