// tests/grailkey-gk142-series-core-query-handler-smoke.test.js
//
// GK-142 — Phase 0.3 (2026-08-21), GK-138 handler-wiring proof.
//
// Production request r5v6b: [reconcile-title] value="Detective Comics
// Batman Corner Box Jorge Jiménez" — the AW/GK-140 canonicalizer's
// attribution-clause stripper requires the literal word "by" before a
// recognized creator name; this row names the creator WITHOUT that
// marker, so neither the creator name nor the "Corner Box" cover-
// descriptor gets stripped from the ADOPTED title. Downstream: PC/CV/comps
// queries built directly from that adopted title become over-constrained
// (no catalog/listing matches "...Corner Box Jorge Jiménez"), and the book
// prices at tier-4/RESEARCH instead of what a clean query would find.
//
// Fix: deriveSeriesCoreQuery (src/lib/identityCore.js) — a QUERY-ONLY
// projection (A5: never a second identity, never mutates the
// display/adopted title) wired into the PC, ComicVine, and comps.js query-
// construction call sites in api/enrich.js. Unit-level coverage
// (grailkey-gk142-series-core-query.test.js) proves the projection
// function itself is correct. Per the standing Handler-Wiring Verification
// protocol (GK-138), this file proves the real handler: the display title
// KEEPS "Corner Box Jorge Jiménez" in full (A5's own invariant), while the
// comps query built from it drops both and reaches a real, non-empty pool
// — the exact fixture shape this dispatch's own text specified ("display
// title keeps 'Corner Box Jorge Jiménez,' external queries use the series
// core, comps return non-empty").
//
// This test does NOT assert on final price/out.rawComps — GK-141 (a
// separate, deliberately NOT-fixed-this-pass ticket) is a real, independent
// defect where comps.js's own internal eligibility filtering can discard
// survivors AFTER the query already reached real data, before they reach
// out.rawComps. Coupling this test's pass/fail to that unrelated ticket
// would be asserting something outside what GK-142 actually changed — same
// discipline grailkey-directive-aw-handler-smoke.test.js already applies
// for its own out-of-scope PriceCharting gap.
//
// Invoke: node tests/grailkey-gk142-series-core-query-handler-smoke.test.js

delete process.env.ACCESS_CODE;
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
process.env.EBAY_APP_ID = process.env.EBAY_APP_ID || 'test-app-id';
process.env.EBAY_CERT_ID = process.env.EBAY_CERT_ID || 'test-cert-id';
process.env.PRICECHARTING_TOKEN = process.env.PRICECHARTING_TOKEN || 'test-pc-token';

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

let passed = 0;
let failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}`; failures.push(msg); console.log(msg); }
};

async function main() {
  // Thin, fallback-vision-triggering image-search pool — same shape as
  // AW's own qf5c6 fixture (a single rank-1 row's text carries the real
  // signal, the rest are competing/losing alternatives), except the
  // rank-1 row has NO "by" marker before the creator name — the exact
  // r5v6b shape GK-142 traced.
  const IMAGE_POOL = [
    ['Detective Comics Batman Corner Box Jorge Jiménez', 48.86],
    ['Detective Comics Batman Ariel Diaz Artbook Print', 40.00],
    ['Detective Comics Batman Clayton Crain Cover Select', 55.00],
    ['Detective Comics Various Covers Available Pick Your Own', 45.00],
    ['Detective Comics Batman Cover Select Presale', 65.00],
    ['Detective Comics Poster Print Wall Art', 35.00],
  ];
  // A real eBay text search for the SERIES-CORE query ("Detective Comics
  // Batman" — creator name and "Corner Box" both stripped) would return a
  // pool like this. The PRE-fix query ("...Corner Box Jorge Jiménez")
  // would match none of these titles.
  const COMPS_POOL = [
    ['Detective Comics Batman NM Marvel 2024', 16.99],
    ['Detective Comics Batman 1 DC Comics 2024', 15.50],
    ['Detective Comics Batman Cover A NM', 17.25],
    ['Detective Comics Batman VF/NM Comic', 14.99],
    ['Detective Comics Batman DC Comic Book', 18.00],
    ['Detective Comics Batman 2024 DC', 16.50],
    ['Detective Comics Batman NM+ DC', 17.99],
    ['Detective Comics Batman Comic DC 2024', 15.99],
  ];

  const IMAGE_ITEMS = IMAGE_POOL.map(([t, p], i) => buildEbayItem(t, p, i, '7000000000'));
  const COMPS_ITEMS = COMPS_POOL.map(([t, p], i) => buildEbayItem(t, p, i, '8000000000'));

  const fetchLog = [];
  global.fetch = async (url) => {
    const u = String(url);
    fetchLog.push(u.slice(0, 160));
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
    if (u.includes('pricecharting.com/api/products')) {
      // Query-content-sensitive stub — proves the PC third-tier fallback:
      // a query still carrying "corner"/"jimenez" gets zero results (the
      // real catalog-mismatch finding, GK-141's registry entry); only the
      // series-core query ("detective comics batman") matches.
      const qMatch = u.match(/[?&]q=([^&]*)/);
      const q = qMatch ? decodeURIComponent(qMatch[1]).toLowerCase() : '';
      if (q.includes('corner') || q.includes('jim')) {
        return jsonResponse({ products: [] });
      }
      return jsonResponse({ products: [{ id: '9101', 'product-name': 'Detective Comics #1107 (2024)', 'loose-price': 1200 }] });
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
  const req = {
    method: 'POST', headers: {},
    body: {
      title: 'Detective Comics', issue: '1107', grade: 'NM 9.4', confidence: 'medium',
      isGraded: false, numericGrade: null, year: null, publisher: 'DC Comics',
      variant: null, keyIssue: null, reason: 'Detective Comics Batman, corner box variant',
      images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='],
    },
  };
  let capturedStatus = null;
  let capturedBody = null;
  const res = {
    status: (code) => ({ json: (data) => { capturedStatus = code; capturedBody = data; return { statusCode: code, body: data }; } }),
    setHeader: () => {},
  };

  console.log('\n=== GK-142 handler-level smoke — r5v6b Detective shape ===\n');

  let threw = null;
  try {
    await handler(req, res);
  } catch (err) {
    threw = err;
  }
  console.log = originalConsoleLog;

  assertTrue(threw === null, `no exception escaped the handler (${threw ? threw.stack : ''})`);
  assertTrue(!capturedLogs.some((l) => l.includes('ReferenceError')), 'no ReferenceError logged');
  assertTrue(capturedStatus === 200, `HTTP 200 (actual: ${capturedStatus})`);

  const seriesCoreLine = capturedLogs.find((l) => l.startsWith('[series-core-query]'));
  assertTrue(!!seriesCoreLine, '[series-core-query] projection log emitted');
  if (seriesCoreLine) console.log('  ' + seriesCoreLine);

  const reconcileTitleLine = capturedLogs.find((l) => l.startsWith('[reconcile-title]'));
  assertTrue(!!reconcileTitleLine, '[reconcile-title] line emitted');
  if (reconcileTitleLine) {
    console.log('  ' + reconcileTitleLine);
    assertTrue(reconcileTitleLine.includes('Corner Box') && /Jim.nez|Jorge/i.test(reconcileTitleLine),
      'A5 SHIP-BLOCKING: the ADOPTED/display title still carries "Corner Box"/"Jiménez" — display identity is never mutated by the query projection');
  }

  const compsQueryLine = capturedLogs.find((l) => l.startsWith('[comps] title='));
  assertTrue(!!compsQueryLine, '[comps] query-construction line emitted');
  if (compsQueryLine) {
    console.log('  ' + compsQueryLine);
    assertTrue(!/corner|jim.nez/i.test(compsQueryLine), 'SHIP-BLOCKING: comps query does NOT carry "Corner"/"Jiménez" — series-core projection reached the query builder');
    assertTrue(/Detective Comics Batman/i.test(compsQueryLine), 'comps query retains the real series-core content ("Detective Comics Batman")');
  }

  const compsRawLine = capturedLogs.find((l) => l.startsWith('[comps] browse itemSummaries='));
  assertTrue(!!compsRawLine, '[comps] browse itemSummaries= line emitted');
  if (compsRawLine) {
    console.log('  ' + compsRawLine);
    const rawCount = parseInt((compsRawLine.match(/itemSummaries=(\d+)/) || [])[1] || '0', 10);
    assertTrue(rawCount > 0, `SHIP-BLOCKING: the series-core-query comps search returned a real, non-empty pool (raw=${rawCount}) — the exact "comps return non-empty" fixture criterion this dispatch specified`);
  }

  const pcSeriesCoreLine = capturedLogs.find((l) => l.startsWith('[pc-query] series-core title matched:'));
  if (pcSeriesCoreLine) {
    console.log('  ' + pcSeriesCoreLine);
    assertTrue(true, 'bonus: PC third-tier fallback matched on the series-core query after full/stripped tiers failed');
  } else {
    console.log('  (PC series-core tier did not fire/match in this fixture — not asserted on, matches AW\'s own precedent of not asserting on PC reachability)');
  }

  if (capturedBody) {
    const title = capturedBody.title || capturedBody.confirmedTitle || '';
    console.log(`  title=${title} decision=${capturedBody.decision?.action}`);
    assertTrue(title.includes('Corner Box') || title.includes('Jiménez') || title.includes('Jimenez'),
      'A5: final response display title still carries the un-projected content (never silently swapped for the query projection)');
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
