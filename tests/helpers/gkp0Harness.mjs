// tests/helpers/gkp0Harness.mjs -- GK-P0 PROVIDER IDEMPOTENCY test harness.
//
// bootstrap() installs a stand-in for eBay BEFORE the real api/list-ebay.js is imported, then returns the real
// handlers, the real Development database and fixture builders. NO live eBay call is possible: global.fetch refuses
// every URL it does not recognise.
//
// The stand-in enforces eBay's documented Item.UUID rule (KB 1462): the first AddFixedPriceItem carrying a UUID creates a
// listing; any later request with the same UUID is refused with error 488 "Duplicate UUID used." whose structured
// ErrorParameters ParamID="1" carries the existing item id. The registry lives in a FILE so a crashed child process and
// its parent observe the same "provider" state. Registration happens synchronously at call start (eBay's dedupe is atomic).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { metaFetch, shippingResponse, mockState } from './ebayPacketMocks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.join(__dirname, '..', '..');
export const TINY_PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
export const SELLER = 'gkp0-seller';

function loadEnv() {
  for (const line of readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
  process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';
  if (!process.env.GRAILKEY_SESSION_SECRET) process.env.GRAILKEY_SESSION_SECRET = randomBytes(32).toString('base64url');
  if (!process.env.GRAILKEY_MARKETPLACE_CREDENTIAL_KEY) process.env.GRAILKEY_MARKETPLACE_CREDENTIAL_KEY = randomBytes(32).toString('base64url');
  delete process.env.EBAY_AUTH_TOKEN; delete process.env.EBAY_USER_REFRESH_TOKEN;
}

export function readRegistry(file) {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { listings: {}, byUuid: {}, calls: [], bodies: [] };
}

export async function bootstrap({ registryFile, crashAfterCreate = false } = {}) {
  loadEnv();
  const controls = {
    addDelayMs: 0,
    loseResponse: false,          // provider creates the listing, then the response never reaches us (transport error)
    simulateEarlierCreation: false, // first AddFixedPriceItem: an earlier (lost) call already created it -> 488
    duplicateMode: 'honest',      // honest | foreign-seller | no-structured-id | sku-mismatch | not-active | message-mismatch
    definitiveFailure: false,
  };
  let seq = 0;
  const reg = () => readRegistry(registryFile);
  const save = (r) => writeFileSync(registryFile, JSON.stringify(r));
  const newItemId = () => String(300000000000 + Math.floor(Math.random() * 99999999) * 10 + (++seq % 10));
  mockState.mediaImageUrl = 'https://i.ebayimg.com/hosted/gkp0-picture.jpg';

  global.fetch = async (url, opts = {}) => {
    const urlStr = String(url);
    const __m = metaFetch(urlStr, opts); if (__m) return __m;
    if (urlStr.includes('identity/v1/oauth2/token')) return { ok: true, status: 200, json: async () => ({ access_token: `access-${Date.now()}`, expires_in: 7200 }) };
    const callName = opts?.headers?.['X-EBAY-API-CALL-NAME'];
    if (!callName) throw new Error(`gkp0 mock: unexpected non-Trading call to "${urlStr}" -- a live call is impossible`);
    const body = String(opts.body || '');
    const r = reg(); r.calls.push(callName); save(r);
    if (callName === 'GeteBayDetails') return shippingResponse();
    if (callName === 'GetUser') return { status: 200, text: async () => `<?xml version="1.0"?><GetUserResponse><Ack>Success</Ack><User><UserID>${SELLER}</UserID><Site>US</Site></User></GetUserResponse>` };
    if (callName === 'GetItem') {
      const id = (body.match(/<ItemID>(\d+)<\/ItemID>/) || [])[1];
      const l = reg().listings[id];
      if (!l) return { status: 200, text: async () => '<GetItemResponse><Ack>Failure</Ack><Errors><ErrorCode>17</ErrorCode></Errors></GetItemResponse>' };
      return { status: 200, text: async () => `<GetItemResponse><Ack>Success</Ack><Item><ItemID>${l.itemId}</ItemID><ListingStatus>${l.status}</ListingStatus><SKU>${l.sku}</SKU><Seller><UserID>${l.seller}</UserID></Seller></Item></GetItemResponse>` };
    }
    if (callName === 'AddFixedPriceItem') {
      const uuid = (body.match(/<UUID>([0-9A-Fa-f]{32})<\/UUID>/) || [])[1] || null;
      const sku = (body.match(/<SKU>([^<]+)<\/SKU>/) || [])[1] || null;
      const st = reg(); st.bodies.push({ uuid, sku, hasUuid: !!uuid }); save(st);
      if (controls.definitiveFailure) return { status: 200, text: async () => '<AddFixedPriceItemResponse><Ack>Failure</Ack><Errors><SeverityCode>Error</SeverityCode><ErrorCode>21919136</ErrorCode><ShortMessage>definitive test refusal</ShortMessage></Errors></AddFixedPriceItemResponse>' };
      const dup488 = (itemId, mode) => {
        { const s = reg(); const l = s.listings[itemId];
          if (mode === 'foreign-seller') l.seller = 'someone-else';
          if (mode === 'sku-mismatch') l.sku = 'GK-SOMETHINGELSE';
          if (mode === 'not-active') l.status = 'Completed';
          save(s); }
        const idParam = mode === 'no-structured-id' ? '' : `<ErrorParameters ParamID="1"><Value>${itemId}</Value></ErrorParameters>`;
        const msgId = mode === 'message-mismatch' ? '999999999999' : itemId;
        return { status: 200, text: async () => `<AddFixedPriceItemResponse><Ack>Failure</Ack><Errors><ShortMessage>Duplicate UUID used.</ShortMessage><LongMessage>The specified UUID has already been used; ListedByRequestAppId=1, item ID=${msgId}.</LongMessage><ErrorCode>488</ErrorCode><SeverityCode>Error</SeverityCode><ErrorParameters ParamID="0"><Value>1</Value></ErrorParameters>${idParam}<ErrorClassification>RequestError</ErrorClassification></Errors></AddFixedPriceItemResponse>` };
      };
      const create = () => {
        const s = reg(); const itemId = newItemId();
        s.listings[itemId] = { itemId, sku, seller: SELLER, status: 'Active', uuid };
        if (uuid) s.byUuid[uuid] = itemId;
        save(s); return itemId;
      };
      // eBay's UUID dedupe: atomic at call start.
      if (uuid && reg().byUuid[uuid]) {
        const existing = reg().byUuid[uuid];
        return dup488(existing, controls.duplicateMode);
      }
      if (uuid && controls.simulateEarlierCreation) { controls.simulateEarlierCreation = false; const existing = create(); return dup488(existing, controls.duplicateMode); }
      const itemId = create();
      if (crashAfterCreate) process.exit(137); // real crash: provider has created the listing, no response processed, nothing persisted
      if (controls.addDelayMs) await new Promise((res) => setTimeout(res, controls.addDelayMs));
      if (controls.loseResponse) throw new Error('socket hang up (response lost after the provider created the listing)');
      return { status: 200, text: async () => `<AddFixedPriceItemResponse><Ack>Success</Ack><ItemID>${itemId}</ItemID></AddFixedPriceItemResponse>` };
    }
    throw new Error(`gkp0 mock: unexpected eBay call "${callName}"`);
  };

  const imp = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);
  const { Client } = pg;
  const [{ issueToken }, { upsertMarketplaceConnection }, { CONNECT_SCOPES }, A, inv, coll, rcpt, listMod, assetsMod] = await Promise.all([
    imp('src/modules/auth/token.js'), imp('src/modules/marketplace/index.js'), imp('src/lib/ebayUserOAuth.js'), imp('src/modules/assets/index.js'),
    imp('src/modules/inventory/index.js'), imp('src/modules/collection/index.js'), imp('src/lib/authorityReceipt.js'), imp('api/list-ebay.js'), imp('api/assets.js'),
  ]);
  const idMod = await imp('src/lib/ebayPublicationIdentity.js');
  const previewMod = await imp('api/listing-preview.js');
  const db = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();

  const nonce = (l) => `gkp0-${l}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const NOT_READY_AUTHORITY = { decision: { action: 'RESEARCH', confidence: 'low' }, pricingSource: 'active_ask_derived', matchConfidence: { tier: 'HIGH', score: 93 }, identityConfident: true };
  const READY_AUTHORITY = { decision: { action: 'LIST_NOW', confidence: 'high' }, pricingSource: 'verified_sold', matchConfidence: { tier: 'HIGH', score: 95 },
    soldCompDiagnostics: { rawCount: 6, verifiedCount: 5, newestDaysAgo: 10 }, identityConfident: true, rawComps: { count: 8 }, soldComps: 5 };

  async function newPrincipal(label) {
    const id = (await db.query('SELECT uuidv7() AS id')).rows[0].id;
    await db.query(`INSERT INTO data1_dev.gk_principal (id, display_name, kind) VALUES ($1, $2, 'operator')`, [id, label]);
    await upsertMarketplaceConnection({ principalId: id, provider: 'EBAY', providerUserId: `gkp0-ebay-${nonce('u')}`, refreshCredential: `fake-refresh-${nonce('r')}`, grantedScopes: [...CONNECT_SCOPES] });
    return id;
  }
  async function mint(principalId, label, authority) {
    const n = nonce(label);
    const { assetId: gkAssetId } = await A.createPhysicalAsset({ principalId, captureBasis: { test: true, label, n }, assetClass: 'comic', source: 'test-fixture', idempotencyKey: `${n}-mint` });
    await inv.enrollAsset({ principalId, gkAssetId, idempotencyKey: `${n}-enroll` });
    const canonicalId = `cv_${n}`;
    const plainAttrs = { title: 'GKP0 Test Comic', issue: '1', year: '1990', publisher: 'Test Publisher' };
    await coll.createCollectionItem({ principalId, id: canonicalId, assetCategory: 'comic', attributes: plainAttrs });
    await A.linkCollectionItem({ principalId, collectionItemId: canonicalId, gkAssetId, idempotencyKey: `${n}-link` });
    const { decisionEventId } = await A.recordDecision({ principalId, gkAssetId, recommendation: authority.decision.action, idempotencyKey: `${n}-decision` });
    await A.attachMedia({ principalId, gkAssetId, bytes: Buffer.from(TINY_PNG_DATA_URL.split(',')[1], 'base64'), contentType: 'image/png', captureRole: 'capture-photo', idempotencyKey: `${n}-photo` });
    const { operatorActionEventId } = await A.recordOperatorAction({ principalId, gkAssetId, decisionEventId, actionCode: 'LIST', actionValueAmount: 25, source: 'test-fixture', idempotencyKey: `${n}-action` });
    const hashes = await A.getAssetMediaContentHashes({ principalId, gkAssetId });
    const authorityReceipt = rcpt.issueAuthorityReceipt({ principalId, binding: { collectionItemId: canonicalId, gkAssetId, evidenceVersion: rcpt.computeEvidenceVersion(hashes) }, response: { title: plainAttrs.title, issue: plainAttrs.issue, year: plainAttrs.year, ...authority } });
    await coll.updateCollectionItem({ principalId, id: canonicalId, assetCategory: 'comic', attributes: { ...plainAttrs, authorityReceipt } });
    return { gkAssetId, decisionEventId, operatorActionEventId, principalId, canonicalId };
  }
  function listRequest(principalId, asset, o = {}) {
    const { token } = issueToken({ principalId });
    const q41 = { priceOverridden: true, manualPrice: 25, lockClassAcknowledged: 'insufficiency', locks: ['no-sold-evidence'], state: 'REVIEW', decision: 'RESEARCH' };
    const readyBody = { rawComps: { count: 8 }, soldComps: 5, soldCompDiagnostics: { rawCount: 6, verifiedCount: 5, newestDaysAgo: 10 }, pricingSource: 'verified_sold', matchConfidence: { tier: 'HIGH', score: 95 }, identityConfident: true, decision: { action: 'LIST_NOW' } };
    return { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: {
      title: 'CLIENT TITLE (ignored)', publisher: 'x', year: '1990', price: '$25.00', grade: 'VF',
      gkAssetId: asset.gkAssetId, decisionEventId: asset.decisionEventId, operatorActionEventId: asset.operatorActionEventId, images: [TINY_PNG_DATA_URL],
      ...(o.ready ? readyBody : { q41Override: q41 }),
      ...(o.ready && o.q41 ? { q41Override: q41, priorLockCodes: ['market-standing-no-sold-evidence'] } : {}),
    } };
  }
  function mockRes() {
    const res = { statusCode: null, body: null, headers: {} };
    res.setHeader = (k, v) => { res.headers[k] = v; };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
  }
  // V1.1a -- a publish now requires the seller's server-signed APPROVAL of the exact listing package. The harness obtains it from the
  // REAL api/listing-preview.js "approve" action (same auth, same durable row + media, same eBay-metadata mock) -- never forged.
  // Pass `req.__noApproval = true` for the negative case.
  let previewSeq = 0; // each approval call looks like a distinct client so the preview endpoint's per-principal+IP limiter (30/10min) is not tripped by a long suite
  const parsePrice = (p) => { const m = String(p ?? '').replace(/,/g, '').match(/[\d.]+/); return m ? parseFloat(m[0]) : null; };
  async function approvalFor(req) {
    const b = req.body || {};
    if (!b.gkAssetId || b.listingApproval || req.__noApproval) return;
    const res = mockRes();
    await previewMod.default({ method: 'POST', headers: { ...req.headers, 'x-forwarded-for': `gkp0-preview-${++previewSeq}` }, body: { action: 'approve', gkAssetId: b.gkAssetId, price: parsePrice(b.price ?? b.priceHigh ?? b.priceLow) } }, res);
    if (res.statusCode === 200 && res.body?.approval) b.listingApproval = res.body.approval;
  }
  const listHandler = async (req, res) => { await approvalFor(req); return listMod.default(req, res); };
  async function publish(principalId, asset, o) { const res = mockRes(); await listHandler(listRequest(principalId, asset, o), res); return res; }
  const ledger = async (assetId) => (await db.query(`SELECT phase FROM data1_dev.operator_authority_event WHERE gk_asset_id = $1 ORDER BY recorded_at, id`, [assetId])).rows.map((x) => x.phase);
  const outcomes = async (assetId) => (await db.query(`SELECT outcome_type, external_listing_id FROM data1_dev.outcome_event WHERE gk_asset_id = $1 ORDER BY occurred_at, id`, [assetId])).rows;
  const closeListing = (principalId, gkAssetId, listingId) => A.recordOutcomeEvent({ principalId, gkAssetId, outcomeType: 'DELISTED', channel: 'ebay', externalListingId: listingId, idempotencyKey: `gkp0-close-${listingId}` });

  return { controls, reg, db, A, idMod, issueToken, newPrincipal, mint, publish, listRequest, mockRes, ledger, outcomes, closeListing,
    listHandler, rawListHandler: listMod.default, previewHandler: previewMod.default, assetsHandler: assetsMod.default, NOT_READY_AUTHORITY, READY_AUTHORITY, nonce, registryFile };
}
