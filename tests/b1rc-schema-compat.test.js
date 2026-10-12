// tests/b1rc-schema-compat.test.js
//
// B1-RC A6 / RC6 -- APPLICATION <-> SCHEMA COMPATIBILITY, measured. REAL api/list-ebay.js handler, REAL Development Postgres,
// mocked eBay `fetch` only (no live call is possible). Four pairings:
//   NEW app + MIGRATED schema   (this suite's baseline; also every other b1 suite)
//   NEW app + UNMIGRATED schema (operator_authority_event temporarily renamed away; ALWAYS restored in `finally` and at start)
//   OLD app + MIGRATED schema   (run separately against the unmodified b403f33 worktree: see the registry entry)
// and the engine-READY path's behavior, INCLUDING its known lack of an attempt ledger (asserted as a known gap so a future fix
// must flip it deliberately; this suite does NOT certify the READY path).
// Run ALONE: while the table is renamed away, any concurrent suite touching the ledger would fail.
//   node tests/b1rc-schema-compat.test.js

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
function mockRes() { const res = { statusCode: null, body: null, headers: {} }; res.setHeader = (k, v) => { res.headers[k] = v; }; res.status = (c) => { res.statusCode = c; return res; }; res.json = (b) => { res.body = b; return res; }; return res; }

const fetchCalls = [];
let addBehavior = 'success';
let lastAddBody = '';
let ctr = 0;
const FAKE_URL = 'https://i.ebayimg.com/hosted/b1rc-compat.jpg';
mockState.mediaImageUrl = FAKE_URL;
const PNG_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const mf = metaFetch(u, opts); if (mf) return mf;
  if (u.includes('identity/v1/oauth2/token')) { const rc = new URLSearchParams(String(opts.body || '')).get('refresh_token'); return { ok: true, status: 200, json: async () => ({ access_token: `access-for-${rc}`, expires_in: 7200 }) }; }
  const call = opts?.headers?.['X-EBAY-API-CALL-NAME'];
  if (!call) throw new Error(`NO NETWORK ALLOWED: ${u.slice(0, 60)}`);
  fetchCalls.push(call);
  if (call === 'GeteBayDetails') return shippingResponse();
  if (call === 'GetUser') return { status: 200, text: async () => '<GetUserResponse><Ack>Success</Ack><User><UserID>s</UserID></User></GetUserResponse>' };
  if (call === 'AddFixedPriceItem') {
    lastAddBody = String(opts.body || '');
    if (addBehavior === 'system-error') return { status: 200, text: async () => '<R><Ack>Failure</Ack><Errors><SeverityCode>Error</SeverityCode><ErrorCode>10007</ErrorCode></Errors></R>' };
    return { status: 200, text: async () => `<R><Ack>Success</Ack><ItemID>b1rc-compat-${Date.now()}-${++ctr}</ItemID></R>` };
  }
  throw new Error(`unexpected eBay call ${call}`);
};
const adds = () => fetchCalls.filter((c) => c === 'AddFixedPriceItem').length;

const { issueToken } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'auth', 'token.js')).href);
const { upsertMarketplaceConnection } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'marketplace', 'index.js')).href);
const { CONNECT_SCOPES } = await import(pathToFileURL(path.join(repoRoot, 'src', 'lib', 'ebayUserOAuth.js')).href);
const A = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'assets', 'index.js')).href);
const { enrollAsset } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'inventory', 'index.js')).href);
const { createCollectionItem } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'collection', 'index.js')).href);
const handler = (await import(pathToFileURL(path.join(repoRoot, 'api', 'list-ebay.js')).href)).default;

const db = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const HIDDEN = 'operator_authority_event_compat_hidden';
const tableExists = async (n) => (await db.query(`SELECT to_regclass($1) AS t`, [`data1_dev.${n}`])).rows[0].t !== null;
// crash safety: if an earlier run died while the table was renamed away, put it back first
if (!(await tableExists('operator_authority_event')) && (await tableExists(HIDDEN))) await db.query(`ALTER TABLE data1_dev.${HIDDEN} RENAME TO operator_authority_event`);
if (!(await tableExists('operator_authority_event'))) throw new Error('operator_authority_event is not present in Development: apply 0040 first');

const nonce = (l) => `b1rc-${l}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const pid = (await db.query('SELECT uuidv7() AS id')).rows[0].id;
await db.query(`INSERT INTO data1_dev.gk_principal (id, display_name, kind) VALUES ($1, 'b1rc-compat', 'operator')`, [pid]);
await upsertMarketplaceConnection({ principalId: pid, provider: 'EBAY', providerUserId: `b1rc-compat-${nonce('i')}`, refreshCredential: `fake-${nonce('r')}`, grantedScopes: [...CONNECT_SCOPES] });
async function mint(label) {
  const n = nonce(label);
  const { assetId: gkAssetId } = await A.createPhysicalAsset({ principalId: pid, captureBasis: { test: true, n }, assetClass: 'comic', source: 'test-fixture', idempotencyKey: `${n}-m` });
  await enrollAsset({ principalId: pid, gkAssetId, idempotencyKey: `${n}-e` });
  await createCollectionItem({ principalId: pid, id: `cv_${n}`, assetCategory: 'comic', attributes: { title: 'B1RC Compat Comic', publisher: 'T', year: '1990' } });
  await A.linkCollectionItem({ principalId: pid, collectionItemId: `cv_${n}`, gkAssetId, idempotencyKey: `${n}-l` });
  const { decisionEventId } = await A.recordDecision({ principalId: pid, gkAssetId, recommendation: 'LIST_NOW', idempotencyKey: `${n}-d` });
  await A.attachMedia({ principalId: pid, gkAssetId, bytes: Buffer.from(PNG_URL.split(',')[1], 'base64'), contentType: 'image/png', captureRole: 'capture-photo', idempotencyKey: `${n}-p` });
  const { operatorActionEventId } = await A.recordOperatorAction({ principalId: pid, gkAssetId, decisionEventId, actionCode: 'LIST', actionValueAmount: 25, source: 'test-fixture', idempotencyKey: `${n}-a` });
  return { gkAssetId, decisionEventId, operatorActionEventId };
}
// A request the server's REAL authority re-derivation rates READY (verified, fresh sold evidence) -- no Q41 acknowledgment.
const readyReq = (a) => ({ method: 'POST', headers: { authorization: `Bearer ${issueToken({ principalId: pid }).token}` }, body: {
  title: 'x', price: '$25.00', grade: 'VF', gkAssetId: a.gkAssetId, decisionEventId: a.decisionEventId, operatorActionEventId: a.operatorActionEventId, images: [PNG_URL],
  decision: { action: 'LIST_NOW', confidence: 'high' }, pricingSource: 'verified_sold', matchConfidence: { tier: 'HIGH', score: 95 }, rawComps: { count: 8 }, soldComps: 5,
  soldCompDiagnostics: { rawCount: 6, verifiedCount: 5, newestDaysAgo: 10 }, identityConfident: true } });
const q41Req = (a) => { const r = readyReq(a); r.body = { ...r.body, pricingSource: 'browse_api', soldComps: 0, soldCompDiagnostics: null, q41Override: { priceOverridden: true, manualPrice: 25 } }; return r; };
const notReadyNoAck = (a) => { const r = readyReq(a); r.body = { ...r.body, pricingSource: 'browse_api', soldComps: 0, soldCompDiagnostics: null }; return r; };
const run = async (req) => { fetchCalls.length = 0; const res = mockRes(); await handler(req, res); return res; };
const ledgerRows = async (aid) => (await db.query(`SELECT phase FROM data1_dev.operator_authority_event WHERE gk_asset_id = $1`, [aid])).rows.length;
const createdListings = [];

console.log('\n=== B1-RC: application <-> schema compatibility (real handler, real Development DB, mocked eBay) ===\n');
try {
  console.log('-- NEW app + MIGRATED schema: the READY path --');
  const r1 = await mint('ready');
  addBehavior = 'success'; lastAddBody = '';
  let res = await run(readyReq(r1));
  createdListings.push(res.body?.listingId);
  ok(res.statusCode === 200 && res.body.ok === true && adds() === 1, `an engine-READY listing still succeeds (${res.statusCode})`);
  ok(res.body.authority === undefined && (await ledgerRows(r1.gkAssetId)) === 0, 'it writes NO authority / attempt rows (the READY path is unchanged and has no ledger)');
  ok(!lastAddBody.includes('<UUID>') && !lastAddBody.includes('<SKU>'), 'its AddFixedPriceItem carries no UUID/SKU correlation');

  console.log('\n-- KNOWN GAP (asserted, not certified): the READY path has no attempt ledger --');
  const r2 = await mint('ready-amb');
  addBehavior = 'system-error';
  res = await run(readyReq(r2));
  ok(res.statusCode === 502 && res.body.error !== 'LISTING_OUTCOME_UNKNOWN' && adds() === 1, `an AMBIGUOUS provider response on the READY path surfaces as the legacy 502 "${String(res.body?.error).slice(0, 30)}", not as an unknown outcome`);
  ok((await ledgerRows(r2.gkAssetId)) === 0, 'no attempt is recorded, so nothing marks the outcome as unknown');
  addBehavior = 'success';
  res = await run(readyReq(r2));
  createdListings.push(res.body?.listingId);
  ok(res.statusCode === 200 && adds() === 1, 'KNOWN GAP: an immediate identical READY retry is NOT blocked and calls AddFixedPriceItem again -> a duplicate listing is possible if the first call had in fact succeeded');
  console.log('     (This is the gap that keeps the READY path UNCERTIFIED. The OPERATOR_MANUAL path, by contrast, blocks the retry: see b1-operator-authority-live.)');

  console.log('\n-- NEW app + UNMIGRATED schema (operator_authority_event renamed away; restored in finally) --');
  const r3 = await mint('unmigrated');
  await db.query(`ALTER TABLE data1_dev.operator_authority_event RENAME TO ${HIDDEN}`);
  try {
    addBehavior = 'success';
    res = await run(readyReq(r3));
    ok(res.statusCode === 500 && adds() === 0 && !fetchCalls.includes('GetUser'), `an engine-READY listing now FAILS CLOSED (${res.statusCode} ${res.body?.error}) with zero eBay calls -- the new app's preflight reads the new table`);
    res = await run(q41Req(r3));
    ok(res.statusCode === 500 && adds() === 0, `an OPERATOR_MANUAL listing fails closed too (${res.statusCode}), zero eBay calls`);
    res = await run(notReadyNoAck(r3));
    ok(res.statusCode === 500 && adds() === 0, `even a request that would otherwise be refused 403 (not READY, no acknowledgment) returns ${res.statusCode}: the table check runs BEFORE the authority decision, so EVERY single-item publish is affected`);
    ok(fetchCalls.length === 0, 'no eBay call of any kind (read or write) was made');
  } finally {
    await db.query(`ALTER TABLE data1_dev.${HIDDEN} RENAME TO operator_authority_event`);
  }
  ok(await tableExists('operator_authority_event') && !(await tableExists(HIDDEN)), 'the table was restored');
  res = await run(readyReq(r3));
  createdListings.push(res.body?.listingId);
  ok(res.statusCode === 200 && adds() === 1, 'after the schema is present again the same READY listing succeeds: the failure was purely the missing table, nothing was left half-done');

  console.log('\n-- OLD app + MIGRATED schema --');
  console.log('     measured separately against the UNMODIFIED b403f33 worktree (the old app never references operator_authority_event): see the registry entry / return packet.');
} finally {
  if (!(await tableExists('operator_authority_event')) && (await tableExists(HIDDEN))) await db.query(`ALTER TABLE data1_dev.${HIDDEN} RENAME TO operator_authority_event`);
  await db.query(`DELETE FROM data1_dev.marketplace_connection WHERE principal_id = $1`, [pid]);
  const ids = createdListings.filter(Boolean);
  if (ids.length) await db.query(`DELETE FROM data1_dev.outcome_event WHERE external_listing_id = ANY($1)`, [ids]);
  await db.end();
}
console.log(`\n${'='.repeat(60)}\nB1-RC SCHEMA COMPAT: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('\nFAILURES:'); failures.forEach((f) => console.log('  ✗ ' + f)); }
process.exit(failed > 0 ? 1 : 0);
