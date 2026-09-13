// tests/list-ebay-photo-handoff.test.js
//
// GK-208 PHOTO HANDOFF FAILURE — real handler proof (GK-138 convention:
// mock fetch by X-EBAY-API-CALL-NAME, real handler, no real network).
//
// Root cause proven here: api/list-ebay.js's own image-selection logic
// (T2-1) reads item.images (plural) for the common, non-LOW-confidence
// case — the real App.jsx client previously sent ONLY a singular
// `image` field, so imagesToUpload was silently [] for every real
// listing, pictureUrls stayed empty, <PictureDetails> was omitted
// entirely, and eBay rejected AddFixedPriceItem with ErrorCode 21919136
// ("eBay requires at least one photo"). Fixed on both ends: the client
// now sends the real `images` array (getComicPhotos(item)); the server
// now fails closed BEFORE any eBay call at all if zero usable photo
// URLs remain after upload, instead of letting eBay itself reject a
// doomed listing.
//
// NO REAL EBAY NETWORK CALL IS EVER MADE HERE. No image binary/base64
// is ever printed — only counts/booleans are asserted.
//
// Invoke: node tests/list-ebay-photo-handoff.test.js

import { readFileSync } from 'node:fs';
import { createHmac, randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

const envRaw = readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8');
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}
process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';
if (!process.env.GRAILKEY_SESSION_SECRET) {
  process.env.GRAILKEY_SESSION_SECRET = randomBytes(32).toString('base64url');
}

// A real, standard, non-sensitive 1x1 transparent PNG data URL — the
// smallest valid input decodeDataUrl() accepts. Never a real photo,
// never printed anywhere in this file's own assertions.
const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

const fetchCalls = [];
let uploadBehavior = 'success'; // 'success' | 'failure'
let addFixedPriceItemBehavior = 'success';
let lastAddFixedPriceItemXml = null;
const FAKE_ITEM_ID = `test-photo-item-${Date.now()}`;
const FAKE_HOSTED_URL = 'https://i.ebayimg.example/hosted/fake-picture-1.jpg';

global.fetch = async (url, opts) => {
  const callName = opts?.headers?.['X-EBAY-API-CALL-NAME'] || '(unknown)';
  fetchCalls.push(callName);
  if (callName === 'GetUser') {
    return {
      status: 200,
      text: async () => `<?xml version="1.0"?><GetUserResponse><Ack>Success</Ack><User><UserID>test-seller</UserID><Site>US</Site></User></GetUserResponse>`,
    };
  }
  if (callName === 'UploadSiteHostedPictures') {
    if (uploadBehavior === 'failure') {
      return {
        status: 200,
        text: async () => `<?xml version="1.0"?><UploadSiteHostedPicturesResponse><Ack>Failure</Ack><Errors><SeverityCode>Error</SeverityCode><ShortMessage>Test-forced upload failure</ShortMessage></Errors></UploadSiteHostedPicturesResponse>`,
      };
    }
    return {
      status: 200,
      text: async () => `<?xml version="1.0"?><UploadSiteHostedPicturesResponse><Ack>Success</Ack><SiteHostedPictureDetails><FullURL>${FAKE_HOSTED_URL}</FullURL></SiteHostedPictureDetails></UploadSiteHostedPicturesResponse>`,
    };
  }
  if (callName === 'AddFixedPriceItem') {
    lastAddFixedPriceItemXml = opts.body;
    if (addFixedPriceItemBehavior === 'failure') {
      return {
        status: 200,
        text: async () => `<?xml version="1.0"?><AddFixedPriceItemResponse><Ack>Failure</Ack><Errors><SeverityCode>Error</SeverityCode><ErrorCode>21919136</ErrorCode><ShortMessage>eBay requires at least one photo</ShortMessage></Errors></AddFixedPriceItemResponse>`,
      };
    }
    return {
      status: 200,
      text: async () => `<?xml version="1.0"?><AddFixedPriceItemResponse><Ack>Success</Ack><ItemID>${FAKE_ITEM_ID}</ItemID></AddFixedPriceItemResponse>`,
    };
  }
  throw new Error(`test fetch mock: unexpected call name "${callName}"`);
};

const handler = (await import(pathToFileURL(path.join(repoRoot, 'api', 'list-ebay.js')).href)).default;

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

function mockRes() {
  const res = { statusCode: null, body: null, headers: {} };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

const JIMMY = '01a0283a-b1b6-7f90-9b41-9c06bee6ecba';
const CREEPY_ASSET_ID = '01a02d23-1acb-72e8-aae3-8f851308e9cf';
const CHAIN2_DECISION_EVENT_ID = '01a0895e-f93b-708d-9530-3a58555bf75c';
const CREEPY_LIST_OPERATOR_ACTION_EVENT_ID = '01a097a1-6e78-71c9-9309-1ed9344c40db';

function mintTestToken(principalId) {
  const secret = process.env.GRAILKEY_SESSION_SECRET;
  const now = Date.now();
  const payload = { principalId, iat: now, exp: now + 12 * 60 * 60 * 1000, epoch: process.env.GRAILKEY_SESSION_EPOCH || '1' };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}
const token = mintTestToken(JIMMY);

// GK-207 made durable linkage unconditional — every scenario below must
// carry valid linkage to reach the photo logic at all.
function baseItem(overrides = {}) {
  return {
    title: 'Creepy #1',
    publisher: 'Warren Publishing',
    year: '1964',
    price: '$61.41',
    grade: 'VG',
    // Clears the GK-95/96 authority gate via the existing, already-
    // shipped Q41 acknowledged-override path (same pattern proven in
    // tests/list-ebay-outcome1-handler-smoke.test.js) rather than
    // reconstructing every field deriveActionAuthority needs for a
    // fresh READY state -- unrelated to the photo logic under test.
    q41Override: { priceOverridden: true, manualPrice: 61.41 },
    gkAssetId: CREEPY_ASSET_ID,
    decisionEventId: CHAIN2_DECISION_EVENT_ID,
    operatorActionEventId: CREEPY_LIST_OPERATOR_ACTION_EVENT_ID,
    ...overrides,
  };
}
const authHeaders = { authorization: `Bearer ${token}` };

async function queryOutcomeEventByIdempotencyKey(client, idempotencyKey) {
  const idem = await client.query(
    `SELECT result_snapshot FROM data1_dev.idempotency_key WHERE operation = 'recordOutcomeEvent' AND idempotency_key = $1`,
    [idempotencyKey]
  );
  if (!idem.rows[0]) return null;
  const snapshot = idem.rows[0].result_snapshot;
  const outcomeEventId = (typeof snapshot === 'string' ? JSON.parse(snapshot) : snapshot)?.outcomeEventId;
  if (!outcomeEventId) return null;
  const row = await client.query(`SELECT * FROM data1_dev.outcome_event WHERE id = $1`, [outcomeEventId]);
  return row.rows[0] || null;
}
async function cleanupOutcome(client, idempotencyKey) {
  const row = await queryOutcomeEventByIdempotencyKey(client, idempotencyKey);
  if (row) await client.query(`DELETE FROM data1_dev.outcome_event WHERE id = $1`, [row.id]);
  await client.query(`DELETE FROM data1_dev.idempotency_key WHERE operation = 'recordOutcomeEvent' AND idempotency_key = $1`, [idempotencyKey]);
}

const dbClient = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await dbClient.connect();

console.log('\n=== api/list-ebay.js -- GK-208 photo handoff, real handler proof ===\n');

console.log('-- REGRESSION PROOF (the exact real bug): images array present, matchConfidence NOT LOW (the common case) -> uploads, AddFixedPriceItem receives a real PictureURL --\n');
{
  fetchCalls.length = 0;
  lastAddFixedPriceItemXml = null;
  uploadBehavior = 'success';
  addFixedPriceItemBehavior = 'success';
  const idempotencyKey = `list-ebay-photo-handoff-${Date.now()}-a`;
  const req = {
    method: 'POST',
    headers: authHeaders,
    body: baseItem({
      images: [TINY_PNG_DATA_URL],
      matchConfidence: { tier: 'HIGH' },
      outcomeIdempotencyKey: idempotencyKey,
    }),
  };
  const res = mockRes();
  await handler(req, res);

  assertTrue(fetchCalls.includes('UploadSiteHostedPictures'), 'UploadSiteHostedPictures WAS called (the real frontend photo representation reached the handler and was uploaded)');
  assertTrue(res.statusCode === 200, `real listing succeeds -> 200 (got ${res.statusCode})`);
  assertTrue(res.body?.pictureCount === 1, `exactly 1 valid eBay-hosted URL produced (got ${res.body?.pictureCount})`);
  assertTrue(typeof lastAddFixedPriceItemXml === 'string' && lastAddFixedPriceItemXml.includes(`<PictureURL>${FAKE_HOSTED_URL}</PictureURL>`), 'AddFixedPriceItem\'s own request XML contains the real hosted PictureURL');
  assertTrue((lastAddFixedPriceItemXml.match(/<PictureURL>/g) || []).length === 1, 'exactly one <PictureURL> element sent to AddFixedPriceItem');

  await cleanupOutcome(dbClient, idempotencyKey);
  console.log('  (test-artifact outcome_event row deleted -- this proves the CODE PATH works, it is not a genuine marketplace outcome)');
}

console.log('\n-- THE ORIGINAL BUG, reproduced exactly: only a singular `image` field sent (no `images` array), matchConfidence NOT LOW -> zero images uploaded, BLOCKED before AddFixedPriceItem --\n');
{
  fetchCalls.length = 0;
  lastAddFixedPriceItemXml = null;
  const req = {
    method: 'POST',
    headers: authHeaders,
    body: baseItem({
      image: TINY_PNG_DATA_URL, // the OLD, buggy client shape -- no `images` array
      matchConfidence: { tier: 'HIGH' },
    }),
  };
  const res = mockRes();
  await handler(req, res);

  assertTrue(!fetchCalls.includes('UploadSiteHostedPictures'), 'UploadSiteHostedPictures was NEVER called (item.images was empty -- the exact real root cause)');
  assertTrue(res.statusCode === 400, `blocked before any eBay call -> 400 PUBLISH_BLOCKED_NO_PHOTO (got ${res.statusCode})`);
  assertTrue(res.body?.error === 'PUBLISH_BLOCKED_NO_PHOTO', 'error code = PUBLISH_BLOCKED_NO_PHOTO');
  assertTrue(/PUBLISH BLOCKED — NO VALID EBAY PHOTO/.test(res.body?.message || ''), 'operator-facing message states PUBLISH BLOCKED — NO VALID EBAY PHOTO');
  assertTrue(!fetchCalls.includes('GetUser') && !fetchCalls.includes('AddFixedPriceItem'), 'ZERO further eBay calls made (no seller verification, no AddFixedPriceItem attempt)');
}

console.log('\n-- ZERO-PHOTO PRECALL GATE: no image field at all -> blocked before any eBay call --\n');
{
  fetchCalls.length = 0;
  const req = {
    method: 'POST',
    headers: authHeaders,
    body: baseItem({ matchConfidence: { tier: 'HIGH' } }), // no image, no images
  };
  const res = mockRes();
  await handler(req, res);

  assertTrue(res.statusCode === 400 && res.body?.error === 'PUBLISH_BLOCKED_NO_PHOTO', `no photo field at all -> 400 PUBLISH_BLOCKED_NO_PHOTO (got ${res.statusCode}, ${res.body?.error})`);
  assertTrue(fetchCalls.length === 0, 'ZERO eBay calls of any kind were made');
}

console.log('\n-- ZERO-PHOTO PRECALL GATE: an images array is present but every upload fails -> blocked before AddFixedPriceItem, never a doomed eBay call --\n');
{
  fetchCalls.length = 0;
  uploadBehavior = 'failure';
  const req = {
    method: 'POST',
    headers: authHeaders,
    body: baseItem({ images: [TINY_PNG_DATA_URL], matchConfidence: { tier: 'HIGH' } }),
  };
  const res = mockRes();
  await handler(req, res);

  assertTrue(fetchCalls.includes('UploadSiteHostedPictures'), 'the upload WAS attempted');
  assertTrue(res.statusCode === 400 && res.body?.error === 'PUBLISH_BLOCKED_NO_PHOTO', `every upload failing -> still 400 PUBLISH_BLOCKED_NO_PHOTO, never a doomed AddFixedPriceItem call (got ${res.statusCode})`);
  assertTrue(!fetchCalls.includes('AddFixedPriceItem'), 'AddFixedPriceItem was NEVER called');
  uploadBehavior = 'success';
}

await dbClient.end();

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  console.log('Failures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
