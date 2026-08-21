// tests/grailkey-dispatch-2026-08-21-gk145-gk146-measurement.test.js
//
// GrailKey Dispatch 2026-08-21 — GK-145 (collectionItemId correlation
// wiring) + GK-146 (scanLog outcome/valuation measurement fields).
//
// Both changes are additive/observational only — no identity, pricing,
// or decision logic touched. Per the standing Handler-Wiring Verification
// protocol (GK-138), a change to api/enrich.js's request/wiring behavior
// needs a real-handler smoke proof, not just unit coverage of the pure
// helper it calls.
//
// Part 1 — unit coverage of buildScanLogRecord's two new fields
// (src/lib/scanLog.js), pure/no I/O.
// Part 2 — real handler smoke: import api/enrich.js directly, stub fetch,
// pass collectionItemId in the request body, and confirm the new
// [scanlog] diagnostic log line (api/enrich.js, right before the kvSet
// call) shows the exact values that reached buildScanLogRecord — proving
// the wiring reaches the real handler's own scanLog write site without
// throwing, without needing a real KV connection to inspect the
// persisted record.
//
// Invoke: node tests/grailkey-dispatch-2026-08-21-gk145-gk146-measurement.test.js

import { buildScanLogRecord } from '../src/lib/scanLog.js';

delete process.env.ACCESS_CODE;
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
process.env.EBAY_APP_ID = process.env.EBAY_APP_ID || 'test-app-id';
process.env.EBAY_CERT_ID = process.env.EBAY_CERT_ID || 'test-cert-id';
process.env.PRICECHARTING_TOKEN = process.env.PRICECHARTING_TOKEN || 'test-pc-token';

let passed = 0;
let failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}`; failures.push(msg); console.log(msg); }
};
const assertEq = (actual, expected, label) => assertTrue(actual === expected, `${label} (actual: ${JSON.stringify(actual)}, expected: ${JSON.stringify(expected)})`);

console.log('\n=== Part 1: buildScanLogRecord — collectionItemId / outcome fields (pure, no I/O) ===\n');

{
  // Default/absent case — the "free-standing scan, not yet saved" shape.
  const rec = buildScanLogRecord({ ts: 1700000000000, id: 'req-1' });
  assertEq(rec.collectionItemId, null, 'collectionItemId defaults to null when not supplied');
  assertEq(rec.outcome, null, 'outcome defaults to null when not supplied (matches every other optional nested field in this file)');
}

{
  // Collection-originated scan — full shape.
  const rec = buildScanLogRecord({
    ts: 1700000000000,
    id: 'req-2',
    collectionItemId: 'cv_1699999999999_ab12cd',
    outcome: { decisionAction: 'LIST_NOW', pricingSource: 'pc_estimate', price: '$41.49', gradeMultiplier: 1.35 },
  });
  assertEq(rec.collectionItemId, 'cv_1699999999999_ab12cd', 'collectionItemId passes through verbatim');
  assertEq(rec.v, 1, 'SCAN_LOG_VERSION unchanged at 1 — additive fields do not require a version bump (Fix 32-C / Dispatch 33 precedent)');
  assertTrue(rec.outcome !== null, 'outcome object present when supplied');
  assertEq(rec.outcome.decisionAction, 'LIST_NOW', 'outcome.decisionAction passes through');
  assertEq(rec.outcome.pricingSource, 'pc_estimate', 'outcome.pricingSource passes through');
  assertEq(rec.outcome.price, '$41.49', 'outcome.price passes through as the raw fmtUsd() string, unparsed (matches GK-74\'s documented app-wide price-string convention)');
  assertEq(rec.outcome.gradeMultiplier, 1.35, 'outcome.gradeMultiplier passes through');
}

{
  // Partial outcome — every sub-field individually defaults to null, not omitted.
  const rec = buildScanLogRecord({ ts: 1, id: 'req-3', outcome: { decisionAction: 'ID_REQUIRED' } });
  assertEq(rec.outcome.decisionAction, 'ID_REQUIRED', 'outcome.decisionAction present');
  assertEq(rec.outcome.pricingSource, null, 'outcome.pricingSource defaults to null, not omitted (stable key set for consumers, matches this file\'s own documented convention)');
  assertEq(rec.outcome.price, null, 'outcome.price defaults to null');
  assertEq(rec.outcome.gradeMultiplier, null, 'outcome.gradeMultiplier defaults to null');
}

console.log('\n=== Part 2: real /api/enrich handler — collectionItemId reaches the scanlog write site ===\n');

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

const buildEbayItem = (title, price, idx, prefix) => ({
  itemId: `v1|${prefix}${idx}|0`,
  title,
  leafCategoryIds: ['259104'],
  categories: [{ categoryId: '259104', categoryName: 'Comics & Graphic Novels' }],
  image: { imageUrl: 'https://i.ebayimg.com/images/g/fake/s-l225.jpg' },
  price: { value: String(price), currency: 'USD' },
  itemHref: `https://api.ebay.com/buy/browse/v1/item/v1%7C${prefix}${idx}%7C0`,
  seller: { username: 'testseller', feedbackPercentage: '99.9', feedbackScore: 1000 },
  condition: 'Brand New',
  conditionId: '1000',
  thumbnailImages: [{ imageUrl: 'https://i.ebayimg.com/images/g/fake/s-l1600.jpg' }],
  buyingOptions: ['FIXED_PRICE'],
  itemWebUrl: `https://www.ebay.com/itm/${prefix}${idx}`,
  itemLocation: { postalCode: '000**', country: 'US' },
  legacyItemId: `${prefix}${idx}`,
  adultOnly: false,
  itemOriginDate: '2024-08-16T18:07:04.000Z',
  itemCreationDate: '2024-08-16T18:07:04.000Z',
  listingMarketplaceId: 'EBAY_US',
});

async function main() {
  // Same reference-shaped fixture as the AW/AV handler-smoke tests (a
  // real, known-working shape — reusing it here is deliberate, not
  // laziness: this dispatch's own claim is narrower than "identity
  // resolves correctly," so borrowing an already-proven-correct fixture
  // isolates the ONE new thing under test — collectionItemId/outcome
  // reaching the scanlog write — from any identity-resolution behavior.
  const COMPS_POOL = [
    ["Venom Separation Anxiety #1 NM Marvel 2024", 16.99],
    ["Venom Separation Anxiety 1 Marvel Comics 2024", 15.50],
    ["Venom Separation Anxiety #1 Cover A NM", 17.25],
    ["Venom Separation Anxiety 1 VF/NM Comic", 14.99],
    ["Venom Separation Anxiety #1 Marvel Comic Book", 18.00],
    ["Venom Separation Anxiety 1 2024 Marvel", 16.50],
    ["Venom Separation Anxiety #1 NM+ Marvel", 17.99],
    ["Venom Separation Anxiety 1 Comic Marvel 2024", 15.99],
  ];
  const IMAGE_POOL = [
    ["Venom Separation Anxiety #1 NM Marvel 2024", 16.99],
    ["Venom Separation Anxiety 1 Marvel Comics 2024", 15.50],
  ];
  const IMAGE_ITEMS = IMAGE_POOL.map(([t, p], i) => buildEbayItem(t, p, i, '5000000000'));
  const COMPS_ITEMS = COMPS_POOL.map(([t, p], i) => buildEbayItem(t, p, i, '6000000000'));

  const fetchLog = [];
  global.fetch = async (url) => {
    const u = String(url);
    fetchLog.push(u.slice(0, 140));
    if (u.includes('oauth2/token') || u.includes('/oauth/')) {
      return jsonResponse({ access_token: 'fake-token', expires_in: 7200, token_type: 'Application Access Token' });
    }
    if (u.includes('search_by_image')) {
      return jsonResponse({ itemSummaries: IMAGE_ITEMS, total: IMAGE_ITEMS.length });
    }
    if (u.includes('item_summary/search')) {
      return jsonResponse({ itemSummaries: COMPS_ITEMS, total: COMPS_ITEMS.length });
    }
    if (u.includes('comicvine.gamespot.com')) {
      return jsonResponse({ results: [], status_code: 1, error: 'OK' });
    }
    if (u.includes('pricecharting.com')) {
      return jsonResponse({ error: 'not found' }, 404);
    }
    if (u.includes('api.anthropic.com')) {
      return jsonResponse({ content: [{ type: 'text', text: '{}' }] });
    }
    return jsonResponse({});
  };

  const capturedLogs = [];
  const originalConsoleLog = console.log;
  console.log = (...args) => {
    capturedLogs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  };

  const handlerModule = await import('../api/enrich.js');
  const handler = handlerModule.default;

  const COLLECTION_ITEM_ID = 'cv_1699999999999_gk145tst';

  const req = {
    method: 'POST', headers: {},
    body: {
      title: 'Venom Separation Anxiety', issue: '1', grade: 'NM 9.4', confidence: 'high',
      isGraded: false, numericGrade: null, year: '2024', publisher: 'Marvel Comics',
      variant: null, keyIssue: null, reason: 'Venom Separation Anxiety, clean cover',
      images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='],
      // GK-145 — the field under test. Simulates refreshMarketData/
      // reIdentifyBook/etc. sending the collection's existing item.id.
      collectionItemId: COLLECTION_ITEM_ID,
    },
  };
  let capturedStatus = null;
  let capturedBody = null;
  const res = {
    status: (code) => ({ json: (data) => { capturedStatus = code; capturedBody = data; return { statusCode: code, body: data }; } }),
    setHeader: () => {},
  };

  let threw = null;
  try {
    await handler(req, res);
  } catch (err) {
    threw = err;
  }
  console.log = originalConsoleLog;

  assertTrue(threw === null, `no exception escaped the handler (${threw ? threw.stack : ''})`);
  assertTrue(!capturedLogs.some((l) => l.includes('ReferenceError')), 'no ReferenceError logged — the exact GK-138 failure class (a variable referenced out of its declared scope)');
  assertTrue(capturedStatus === 200, `HTTP 200 (actual: ${capturedStatus})`);

  const scanlogLine = capturedLogs.find((l) => l.startsWith('[scanlog] collectionItemId='));
  assertTrue(!!scanlogLine, '[scanlog] diagnostic line emitted (proves buildScanLogRecord was called and reached the log statement just before the kvSet write)');
  if (scanlogLine) {
    console.log('  ' + scanlogLine);
    assertTrue(scanlogLine.includes(`collectionItemId=${COLLECTION_ITEM_ID}`), 'GK-145: collectionItemId from req.body reached the built scanlog record unchanged — the request-body-to-scanlog wire is intact');
    assertTrue(!scanlogLine.includes('collectionItemId=null'), 'GK-145: collectionItemId is NOT null on this collection-originated request (sanity check on the positive case)');
    assertTrue(/outcome\.decisionAction=\S+/.test(scanlogLine) && !scanlogLine.includes('outcome.decisionAction=undefined'), 'GK-146: outcome.decisionAction is a real value, not undefined (out.decision existed at the read point)');
    assertTrue(/outcome\.pricingSource=\S+/.test(scanlogLine), 'GK-146: outcome.pricingSource captured');
    assertTrue(/outcome\.price=\S+/.test(scanlogLine), 'GK-146: outcome.price captured');
    if (capturedBody) {
      assertTrue(
        scanlogLine.includes(`outcome.decisionAction=${capturedBody.decision?.action}`),
        `GK-146: outcome.decisionAction in the scanlog record MATCHES the same request's own out.decision.action (${capturedBody.decision?.action}) — the snapshot is not stale or independently derived`
      );
      assertTrue(
        scanlogLine.includes(`outcome.price=${capturedBody.price}`),
        `GK-146: outcome.price in the scanlog record MATCHES the same request's own out.price (${capturedBody.price})`
      );
    }
  }

  // GK-145's own explicit non-claim: a free-standing scan (no
  // collectionItemId in the body at all) must still work, with
  // collectionItemId legitimately null in the scanlog record — this is
  // NOT a gap, per scanLog.js's own JSDoc and docs/DATA-1-READINESS.md B2.
  console.log('\n=== Part 3: free-standing scan (no collectionItemId) — legitimate null, not a regression ===\n');
  const capturedLogs2 = [];
  console.log = (...args) => {
    capturedLogs2.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  };
  const req2 = { ...req, body: { ...req.body, collectionItemId: undefined } };
  let threw2 = null;
  try {
    await handler(req2, res);
  } catch (err) {
    threw2 = err;
  }
  console.log = originalConsoleLog;
  assertTrue(threw2 === null, `no exception escaped the handler on a free-standing (no collectionItemId) request (${threw2 ? threw2.stack : ''})`);
  const scanlogLine2 = capturedLogs2.find((l) => l.startsWith('[scanlog] collectionItemId='));
  assertTrue(!!scanlogLine2, '[scanlog] diagnostic line still emitted on a free-standing scan');
  if (scanlogLine2) {
    console.log('  ' + scanlogLine2);
    assertTrue(scanlogLine2.includes('collectionItemId=null'), 'collectionItemId correctly nulls out (not "undefined", not thrown) when absent from the request body');
  }

  console.log(`  fetch calls made: ${fetchLog.length}`);
  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) {
    console.log('FAILURES:');
    failures.forEach((f) => console.log(f));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
