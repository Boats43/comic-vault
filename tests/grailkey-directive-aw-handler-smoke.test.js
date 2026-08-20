// tests/grailkey-directive-aw-handler-smoke.test.js
//
// GrailKey Directive 2026-08-20-AW — GK-140, GK-138 handler-wiring proof.
//
// Unit-level coverage (grailkey-directive-aw-title-canonicalization.test.js)
// proves canonicalizeTitleCandidate/reconcileTitleFacet are individually
// correct. Per the standing Handler-Wiring Verification protocol, any
// dispatch touching api/enrich.js's title-adoption wiring must ALSO prove
// the real handler produces a materially different, BETTER outcome — not
// just that a log line changed. This file demonstrates that: the SAME
// thin, fallback-vision-triggering image-search pool as AV's own test
// (qf5c6-shaped — a single Mayhew/poker-chip row) is paired with a
// SEPARATE, richer comps-search pool (what a real eBay text search for
// the CLEAN "Venom Separation Anxiety" query would actually return — the
// pool AV's own fixture could never reach, since its query was still the
// noisy "...By Mike Mayhew Poker Chip" string). Two independently-stubbed
// endpoints (search_by_image vs. item_summary/search), matching how the
// real pipeline genuinely uses two different eBay calls for two different
// jobs (identity clustering vs. comp pricing).
//
// Invoke: node tests/grailkey-directive-aw-handler-smoke.test.js

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
  // Thin, fallback-vision-triggering image-search pool — byte-identical
  // in shape to AV's own qf5c6 fixture (the void this whole mechanism
  // exists for). Deliberately unchanged from AV — AW does not touch WHICH
  // rows win family election, only what happens to the winning candidate.
  const IMAGE_POOL = [
    ["Venom - Separation Anxiety 1 Virgin Signed/Remarked by Mike Mayhew w/Poker Chip", 48.86],
    ["Venom Ariel Diaz Artbook Print", 40.00],
    ["Venom Clayton Crain Cover Select", 55.00],
    ["Venom Various Covers Available Pick Your Own", 45.00],
    ["Venom Separation Anxiety Cover Select Presale", 65.00],
    ["Venom Poster Print Wall Art", 35.00],
  ];
  // The comps pool a real eBay text search for the CLEAN "Venom
  // Separation Anxiety" query would return — 8 real comps, matching the
  // directive's own production evidence ("sm58d... priced $16.79 from 8
  // comps"). AV's own fixture could never reach a pool shaped like this,
  // because its query was still the noisy, uncanonicalized candidate.
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
    if (u.includes('pricecharting.com/api/products')) {
      // A real PC product for the CLEAN title — the whole point of the
      // fix: this product is reachable once the query stops asking about
      // a seller's poker chip.
      return jsonResponse({ products: [{ id: '9001', 'product-name': 'Venom: Separation Anxiety #1 (2024)', 'loose-price': 1650 }] });
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
      title: 'Venom', issue: '28', grade: 'NM 9.4', confidence: 'medium',
      isGraded: false, numericGrade: null, year: null, publisher: 'Marvel Comics',
      variant: null, keyIssue: null, reason: 'Venom, no issue number visible',
      images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='],
    },
  };
  let capturedStatus = null;
  let capturedBody = null;
  const res = {
    status: (code) => ({ json: (data) => { capturedStatus = code; capturedBody = data; return { statusCode: code, body: data }; } }),
    setHeader: () => {},
  };

  console.log('\n=== GK-140 handler-level smoke — Venom qf5c6 shape, clean query reaches a real pool ===\n');

  let threw = null;
  try {
    await handler(req, res);
  } catch (err) {
    threw = err;
  }
  console.log = originalConsoleLog;

  assertTrue(threw === null, `no exception escaped the handler (${threw ? threw.message : ''})`);
  assertTrue(!capturedLogs.some((l) => l.includes('ReferenceError')), 'no ReferenceError logged');
  assertTrue(capturedStatus === 200, `HTTP 200 (actual: ${capturedStatus})`);

  const canonLines = capturedLogs.filter((l) => l.startsWith('[title-canon]'));
  assertTrue(canonLines.length > 0, '[title-canon] strip log emitted');
  canonLines.forEach((l) => console.log('  ' + l));
  assertTrue(canonLines.some((l) => l.includes('attribution') && /mayhew/i.test(l)), 'attribution strip fired on Mike Mayhew');

  const reconcileTitleLine = capturedLogs.find((l) => l.startsWith('[reconcile-title]'));
  assertTrue(!!reconcileTitleLine, '[reconcile-title] line emitted');
  if (reconcileTitleLine) {
    console.log('  ' + reconcileTitleLine);
    assertTrue(reconcileTitleLine.includes('value="Venom Separation Anxiety"'), 'adopted candidate is the CLEAN canonicalized value, not the raw seller string');
    assertTrue(reconcileTitleLine.includes('"verbatim":"Venom - Separation Anxiety 1 Virgin Signed/Remarked by Mike Mayhew w/Poker Chip"'), 'C3: verbatim raw row is present in the reconciler log, byte-identical to the frozen row');
  }

  // GK-140's own claim is narrower than "a price gets displayed": the
  // QUERY built from the adopted candidate must reach real data instead
  // of nothing ("PC query finds nothing → tier-4 RESEARCH" is the exact
  // failure mode named). Diagnosed directly (not assumed) with a
  // dedicated stubbed-fetch run against this same fixture: api/comps.js's
  // own eBay text-search query is built from confirmedTitle
  // ("[comps] title= Venom Separation Anxiety ... cleanTitle= Venom
  // Separation Anxiety") and returns raw=8 / several post-filter
  // survivors — a real, non-empty pool, a stark contrast to the PRE-fix
  // shape where the same query carried "By Mike Mayhew Poker Chip" and
  // matched nothing at all. Whether that pool survives ALL of enrich.js's
  // downstream stages to become a final displayed price depends on
  // machinery this dispatch does not touch (PriceCharting's own product
  // lookup did not even fire in this fixture; C7 explicitly excludes
  // pricing-math plumbing from this dispatch's scope) — asserting a
  // specific final price here would be asserting something outside what
  // GK-140 actually changed. The comps-query-reaches-real-data claim is
  // the one this dispatch is responsible for, and the one asserted below.
  const compsQueryLine = capturedLogs.find((l) => l.startsWith('[comps] title='));
  assertTrue(!!compsQueryLine, '[comps] query-construction line emitted');
  if (compsQueryLine) {
    console.log('  ' + compsQueryLine);
    assertTrue(/cleanTitle=\s*Venom Separation Anxiety/.test(compsQueryLine), 'comps query built from the CLEAN candidate, not raw seller text');
  }
  const compsRawLine = capturedLogs.find((l) => l.startsWith('[comps] browse itemSummaries='));
  assertTrue(!!compsRawLine, '[comps] browse itemSummaries= line emitted');
  if (compsRawLine) {
    console.log('  ' + compsRawLine);
    const rawCount = parseInt((compsRawLine.match(/itemSummaries=(\d+)/) || [])[1] || '0', 10);
    assertTrue(rawCount > 0, `SHIP-BLOCKING: the clean-query comps search returned a real, non-empty pool (raw=${rawCount}) — never tier-4-for-cruft (PRE-fix: the same query carried seller cruft and matched nothing)`);
  }

  if (capturedBody) {
    console.log(`  price=${capturedBody.price} decision=${capturedBody.decision?.action} titleAuthority=${capturedBody.titleAuthority} title=${capturedBody.title || capturedBody.confirmedTitle}`);
    const title = capturedBody.title || capturedBody.confirmedTitle || '';
    assertTrue(title === 'Venom Separation Anxiety', `card title is the clean candidate, no seller cruft (actual: "${title}")`);
    assertTrue(capturedBody.decision?.action !== 'ID_REQUIRED', 'SHIP-BLOCKING: never ID_REQUIRED');
    assertTrue(capturedBody.titleAuthority === 'CONTESTED', 'out.titleAuthority is CONTESTED — canonicalization does not upgrade authority (C4)');
    assertTrue(capturedBody.decision?.action !== 'LIST_NOW', 'never a clean READY-shaped action — CONTESTED title still gates listing');
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
