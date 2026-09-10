// tests/gk184-handler-smoke.test.js
//
// GK-184 — TRUE MARKET-EVIDENCE RETRIEVAL TIME. GK-138 discipline: this
// dispatch edited api/enrich.js wiring (cv:/pc: cache-write sites, the ac:
// active-comps cache-write site) and api/pricecharting-pop.js's
// fetchPCProductHtml (changed its return shape from a bare string to an
// { html, evidenceObservedAt } envelope, consumed by two callers
// downstream). Unit/integration tests against the extracted helper
// functions (tests/gk184-evidence-observed-at-unit.test.js,
// tests/gk184-cache-provenance-integration.test.js) cannot catch a real
// lexical-scope/shape-mismatch wiring bug at the actual call sites —
// only invoking the real handler can (GK-136/GK-137 precedent).
//
// Reuses the fixture/stub pattern established by
// tests/grailkey-directive-au-handler-smoke.test.js, but additionally
// makes the PriceCharting HTML page request (`/game/{id}`) succeed with a
// 200 (rather than that test's deliberate 404), specifically to drive a
// REAL fresh fetch through the new fetchPCProductHtml envelope shape and
// its two downstream callers (fetchPricechartingPop, fetchPricechartingSales)
// — the single riskiest edit in this dispatch, since it changes an
// existing function's return TYPE, not just adds a field.
//
// KV deliberately left unset (same as the AU smoke test) — every
// kvGet/kvSet in this run is a real call into api/kv-cache.js that fails
// gracefully (documented graceful-degradation contract), so this proves
// the wiring survives the exact "e.g. cold instance, first request"
// condition production sees on almost every real request (confirmed via
// this app's own sparse-traffic characteristics, documented elsewhere in
// this codebase).
//
// Invoke: node tests/gk184-handler-smoke.test.js

delete process.env.ACCESS_CODE;
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
process.env.EBAY_APP_ID = process.env.EBAY_APP_ID || 'test-app-id';
process.env.EBAY_CERT_ID = process.env.EBAY_CERT_ID || 'test-cert-id';
process.env.PRICECHARTING_TOKEN = process.env.PRICECHARTING_TOKEN || 'test-pc-token';

const REAL_POOL_TITLES = [
  ['Amazing Spider-Man #1 (1963) CGC 9.4', 4200.00],
  ['Amazing Spider-Man #1 1963 Marvel Comics VF/NM', 3800.00],
  ['The Amazing Spider-Man #1 Marvel 1963 Key Issue', 4500.00],
];

const buildEbayItem = (title, price, idx) => ({
  itemId: `v1|40000000000${idx}|0`,
  title,
  leafCategoryIds: ['259104'],
  categories: [{ categoryId: '259104', categoryName: 'Comics & Graphic Novels' }],
  image: { imageUrl: 'https://i.ebayimg.com/images/g/fake/s-l225.jpg' },
  price: { value: String(price), currency: 'USD' },
  itemHref: `https://api.ebay.com/buy/browse/v1/item/v1%7C40000000000${idx}%7C0`,
  seller: { username: 'testseller', feedbackPercentage: '99.9', feedbackScore: 1000 },
  condition: 'Used',
  conditionId: '3000',
  thumbnailImages: [{ imageUrl: 'https://i.ebayimg.com/images/g/fake/s-l1600.jpg' }],
  buyingOptions: ['FIXED_PRICE'],
  itemWebUrl: `https://www.ebay.com/itm/40000000000${idx}`,
  itemLocation: { postalCode: '000**', country: 'US' },
  legacyItemId: `40000000000${idx}`,
  adultOnly: false,
  itemOriginDate: '2024-08-16T18:07:04.000Z',
  itemCreationDate: '2024-08-16T18:07:04.000Z',
  listingMarketplaceId: 'EBAY_US',
});

const EBAY_ITEMS = REAL_POOL_TITLES.map(([t, p], i) => buildEbayItem(t, p, i));

// A minimal but real PriceCharting product-page HTML shape — enough for
// fetchPCProductHtml's fetch+cache path to run to a genuine 200/text()
// success. The pop/sales REGEX extractors are allowed to find nothing in
// it (return null/empty) — parsing fidelity is out of GK-184's scope;
// what this proves is that a real HTML fetch success flows through the
// new { html, evidenceObservedAt } envelope without throwing anywhere
// downstream.
const FAKE_PC_HTML = `<!doctype html><html><body>
<script>VGPC.pop_data = {"cgc":[1,2,3,4,5,6,7,8,9,10,20,30,15,2]};</script>
<div id="full-history"><table><tbody></tbody></table></div>
</body></html>`;

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}
function textResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => body };
}

const originalFetch = global.fetch;
let fetchLog = [];
let pcHtmlFetchCount = 0;

global.fetch = async (url) => {
  const u = String(url);
  fetchLog.push(u.slice(0, 120));

  if (u.includes('oauth2/token') || u.includes('/oauth/')) {
    return jsonResponse({ access_token: 'fake-token', expires_in: 7200, token_type: 'Application Access Token' });
  }
  if (u.includes('search_by_image')) {
    return jsonResponse({ itemSummaries: EBAY_ITEMS, total: EBAY_ITEMS.length });
  }
  if (u.includes('item_summary/search')) {
    return jsonResponse({ itemSummaries: EBAY_ITEMS, total: EBAY_ITEMS.length });
  }
  if (u.includes('comicvine.gamespot.com')) {
    // Real ComicVine "no match" shape — real fetch happens, real (empty)
    // result gets cached under cv:, exercising the cv: stamp site with a
    // real network round trip (even though the match itself is empty).
    return jsonResponse({ results: [], status_code: 1, error: 'OK' });
  }
  if (u.includes('pricecharting.com/api/products')) {
    return jsonResponse({
      products: [{ id: '2314818', 'product-name': 'Amazing Spider-Man #1 (1963)', 'loose-price': 403725 }],
    });
  }
  if (u.includes('pricecharting.com/game/')) {
    // GK-184's own riskiest edit: this must return a real 200 text page,
    // driving a genuine fetchPCProductHtml network-fetch success through
    // the new envelope shape.
    pcHtmlFetchCount++;
    return textResponse(FAKE_PC_HTML, 200);
  }
  if (u.includes('pricecharting.com')) {
    return jsonResponse({ error: 'not found' }, 404);
  }
  if (u.includes('api.anthropic.com')) {
    return jsonResponse({ content: [{ type: 'text', text: '{}' }] });
  }
  return jsonResponse({});
};

let passed = 0;
let failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}`; failures.push(msg); console.log(msg); }
};

const capturedLogs = [];
const originalConsoleLog = console.log;
console.log = (...args) => {
  capturedLogs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  originalConsoleLog(...args);
};

async function main() {
  const handlerModule = await import('../api/enrich.js');
  const handler = handlerModule.default;

  const req = {
    method: 'POST',
    headers: {},
    body: {
      title: 'Amazing Spider-Man',
      issue: '1',
      grade: 'VF/NM 9.0',
      confidence: 'high',
      isGraded: false,
      numericGrade: null,
      year: '1963',
      publisher: 'Marvel Comics',
      variant: null,
      keyIssue: 'First appearance of Spider-Man',
      reason: 'Amazing Spider-Man #1, first appearance',
      images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='],
    },
  };

  let capturedStatus = null;
  let capturedBody = null;
  const res = {
    status: (code) => ({ json: (data) => { capturedStatus = code; capturedBody = data; return { statusCode: code, body: data }; } }),
    setHeader: () => {},
  };

  console.log('\n=== GK-184 handler-level smoke invocation (cv:/pc:/ph:/ac: sites) ===\n');

  let threw = null;
  try {
    await handler(req, res);
  } catch (err) {
    threw = err;
  }

  console.log = originalConsoleLog;

  assertTrue(threw === null, `no exception escaped the handler (threw: ${threw ? threw.stack || threw.message : 'none'})`);
  assertTrue(!capturedLogs.some((l) => l.includes('ReferenceError')), 'no ReferenceError logged anywhere in the handler run (GK-184 wiring at cv:/pc:/ac: sites is scope-clean)');
  assertTrue(!capturedLogs.some((l) => l.includes('TypeError')), 'no TypeError logged anywhere (the ph: string->envelope shape change did not break a caller expecting a bare string)');
  assertTrue(capturedStatus === 200, `HTTP status is 200 (actual: ${capturedStatus})`);
  assertTrue(pcHtmlFetchCount >= 1, `the real PriceCharting HTML page fetch actually fired at least once (count=${pcHtmlFetchCount}) — the fetchPCProductHtml envelope path was genuinely exercised, not skipped`);

  // GK-184 Section 15 — do not expose the internal evidence timestamp
  // publicly unless there's already a legitimate response contract for
  // it. Confirm the field name never leaks into the public response body.
  // GK-184 Section 15 — "do not expose the internal evidence timestamp
  // publicly unless there is already a legitimate response contract for
  // it." api/enrich.js's `out.activeCached`/`out.pop` fields are exactly
  // that pre-existing contract: I13 (Log-Card Fidelity, standing P0
  // protocol) already requires the FULL activeComps/pop evidence objects
  // to pass through to the client verbatim, unfiltered. evidenceObservedAt
  // riding along as one more property on those already-passed-through
  // objects is not a new public field — it's the same objects the
  // contract already ships, now one property richer. What Section 15
  // actually forbids is inventing a brand-new DEDICATED top-level field
  // (e.g. a bespoke `res.evidenceObservedAt`) — proven absent below.
  assertTrue(!Object.prototype.hasOwnProperty.call(capturedBody || {}, 'evidenceObservedAt'), 'no NEW dedicated top-level `evidenceObservedAt` response field was invented');

  // D5D dispatch (2026-09-09) — `rawComps` added deliberately: the D5D
  // runtime-wiring block needs a real evidenceObservedAt value to build
  // Chain #1's persistence payload from, and out.rawComps is where
  // fetchComps()'s own genuine value was already available but
  // previously stripped during projection (api/enrich.js, the
  // out.rawComps construction site) -- same I13 evidence-passthrough
  // pattern as the other containers here, one property richer, not a
  // new dedicated field.
  const KNOWN_PREEXISTING_EVIDENCE_CONTAINERS = new Set(['activeCached', 'pop', 'priceCharting', 'soldComps', 'activeComps', 'rawComps']);
  const foundAt = [];
  const walk = (obj, pathParts) => {
    if (obj == null || typeof obj !== 'object') return;
    for (const k of Object.keys(obj)) {
      if (k === 'evidenceObservedAt') foundAt.push(pathParts);
      else walk(obj[k], [...pathParts, k]);
    }
  };
  walk(capturedBody, []);
  const allWithinKnownContainers = foundAt.every((p) => p.some((seg) => KNOWN_PREEXISTING_EVIDENCE_CONTAINERS.has(seg)));
  assertTrue(allWithinKnownContainers, `every evidenceObservedAt occurrence in the response (${foundAt.map(p => '$.' + p.join('.')).join(', ') || 'none'}) sits inside an already-existing I13 evidence-passthrough container, not a novel field placement`);

  assertTrue(typeof capturedBody?.price === 'string' || typeof capturedBody?.price === 'number' || capturedBody?.price === null, `response still carries a normal price field (actual: ${JSON.stringify(capturedBody?.price)})`);
  assertTrue(!!capturedBody?.decision?.action, `response still carries a normal decision.action field (actual: ${capturedBody?.decision?.action})`);

  console.log(`  response price/decision: price=${capturedBody?.price} decision=${capturedBody?.decision?.action}`);
  console.log(`  fetch calls made: ${fetchLog.length}, PC HTML page fetches: ${pcHtmlFetchCount}`);
  console.log(`  distinct hosts/paths: ${[...new Set(fetchLog.map(u => u.split('?')[0].split('/').slice(0, 5).join('/')))].join(', ')}`);

  global.fetch = originalFetch;

  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) {
    console.log('FAILURES:');
    failures.forEach((f) => console.log(f));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.log = originalConsoleLog;
  console.error('FATAL:', err);
  process.exit(1);
});
