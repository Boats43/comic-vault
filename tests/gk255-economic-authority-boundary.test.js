// tests/gk255-economic-authority-boundary.test.js
//
// GK-255 — economic authority must cover EVERY price-producing path, not
// just the main pipeline GK-250 already gates. Live certification of the
// GK-254 Universal deploy (dpl_AXsB2pEjZHh71F36df26jJNkf1DR, 4c505af) found
// a real, reproducible gap: a Book scan of "The Rationalists" (2026-09-25)
// rendered "Recommended list price: $45.00" / "AI range: $39.00–$69.00" /
// "Price estimated from AI market knowledge" while assetType stayed 'book'
// the entire request — because the `identityRefused` early-return branch
// (api/enrich.js, commit a080ad3, 2026-07-18 — predates GK-249→254 by two
// months) returns BEFORE GK-250's own `out.assetType !== 'comic'` allowlist
// check ever runs.
//
// Per the standing Handler-Wiring Verification protocol (GK-138) and
// GK-250's own precedent (tests/gk250-book-enrich-handler-smoke.test.js),
// this file imports the real api/enrich.js default export and drives real
// requests through it with a mocked eBay visual-pool that deterministically
// reproduces `familyCandidate.decision === 'refused-identity-conflict'` —
// refusedToPrice/contract.state/price are never set directly in the
// fixture; only the real handler proves them.
//
// Invoke: node tests/gk255-economic-authority-boundary.test.js

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

let passed = 0;
let failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}`; failures.push(msg); console.log(msg); }
};
const assertFalse = (cond, label) => assertTrue(!cond, label);
const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};

const buildEbayItem = (title, price, idx, prefix, categoryId = '259104', categoryName = 'Comics & Graphic Novels') => ({
  itemId: `v1|${prefix}${idx}|0`,
  title,
  leafCategoryIds: [categoryId],
  categories: [{ categoryId, categoryName }],
  image: { imageUrl: 'https://i.ebayimg.com/images/g/fake/s-l225.jpg' },
  price: { value: String(price), currency: 'USD' },
  itemHref: `https://api.ebay.com/buy/browse/v1/item/v1%7C${prefix}${idx}%7C0`,
  seller: { username: 'testseller', feedbackPercentage: '99.9', feedbackScore: 1000 },
  thumbnailImages: [{ imageUrl: 'https://i.ebayimg.com/images/g/fake/s-l1600.jpg' }],
  buyingOptions: ['FIXED_PRICE'],
  itemWebUrl: `https://www.ebay.com/itm/${prefix}${idx}`,
  itemLocation: { postalCode: '000**', country: 'US' },
  legacyItemId: `${prefix}${idx}`,
  adultOnly: false,
  itemOriginDate: '2026-04-06T14:26:54.000Z',
  itemCreationDate: '2026-04-06T14:26:54.000Z',
  listingMarketplaceId: 'EBAY_US',
});

// Real-shaped, zero-title-overlap pool — mirrors the actual production
// eBay visual-pool evidence from The Rationalists' live scan (2026-09-25,
// 18 unrelated India-rare-books/philosophy items, "0/2 tokens" overlap
// with Vision's title). Nine fully DISTINCT titles (each its own 1-member
// family, well below the >=3 promotion floor) guarantees
// `familyCandidate.decision === 'refused-identity-conflict'` and the
// NON-promoted branch (the one this dispatch patches) fires deterministically.
// Prices chosen for a clean median/P25/P75: sorted [10..90] step 10 ->
// median=$50 (idx 4), P25=$30 (idx 2), P75=$70 (idx 6).
const NO_OVERLAP_POOL = [
  ['INDIA RARE - PERSONALITY LECTURES DELIVERED IN AMERICA BY TAGORE', 10],
  ['DOCTOR ZHIVAGO BY BORIS PASTERNAK 1967 PAGES 542', 20],
  ['THE ETHICAL PHILOSOPHY OF THE GITA SRINIVASACHARI PAGES 163', 30],
  ['REGIONAL ORGANISATIONS A THIRD WORLD PERSPECTIVE MELKOTE', 40],
  ['HISTORY AND CULTURE OF THE GIRASIAS MEHARDA 1985 ILLUSTRATED', 50],
  ['HYPNOSIS FOR BEGINNERS WILLIAM HEWITT PAGES 259', 60],
  ['HOMOEOPATHY IN THE TREATMENT OF GONORRHOEA BANERJEE 1983', 70],
  ['RITUSAMHARA AUR THE PAGEANT OF THE SEASONS PANDIT 1947', 80],
  ['WHY MEDITATE BY ACHARYA MAHAPRAGYA PAGES 126', 90],
];

async function runOnce({ label, requestBody, expectAuthorized }) {
  console.log(`\n=== ${label} ===\n`);

  const POOL_ITEMS = NO_OVERLAP_POOL.map(([t, p], i) => buildEbayItem(t, p, i, '8800000000'));
  const fetchLog = [];
  global.fetch = async (url) => {
    const u = String(url);
    fetchLog.push(u.slice(0, 200));
    if (u.includes('oauth2/token') || u.includes('/oauth/')) {
      return jsonResponse({ access_token: 'fake-token', expires_in: 7200, token_type: 'Application Access Token' });
    }
    if (u.includes('search_by_image')) {
      return jsonResponse({ itemSummaries: POOL_ITEMS, total: POOL_ITEMS.length });
    }
    if (u.includes('item_summary/search')) {
      return jsonResponse({ itemSummaries: POOL_ITEMS, total: POOL_ITEMS.length });
    }
    if (u.includes('comicvine.gamespot.com')) {
      return jsonResponse({ results: [], status_code: 1, error: 'OK' });
    }
    if (u.includes('pricecharting.com')) {
      return jsonResponse({ products: [] });
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

  const handlerModule = await import('../api/enrich.js?t=' + label.replace(/\s+/g, '_'));
  const handler = handlerModule.default;
  const req = { method: 'POST', headers: {}, body: requestBody };
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
  assertTrue(!capturedLogs.some((l) => l.includes('ReferenceError')), 'no ReferenceError logged');
  assertTrue(capturedStatus === 200, `HTTP 200 (actual: ${capturedStatus})`);

  // Prove the SPECIFIC new code path actually executed (Handler-Wiring
  // Verification, GK-138) — not merely that the response happens to look
  // right.
  const refusedIdentityLine = capturedLogs.find((l) => l.startsWith('[title-family] refusing identity'));
  assertTrue(!!refusedIdentityLine, `[title-family] refusing identity fires — the identityRefused branch genuinely ran (${refusedIdentityLine || 'NOT FOUND'})`);

  if (!expectAuthorized) {
    const gk255Line = capturedLogs.find((l) => l.startsWith('[economic-allowlist] (identity-refused path)'));
    assertTrue(!!gk255Line, `[economic-allowlist] (identity-refused path) fires — the new GK-255 gate genuinely ran inside identityRefused (${gk255Line || 'NOT FOUND'})`);
  }

  // Identity-conflict truth must survive regardless of category authority.
  assertTrue(typeof capturedBody?.refusalReason === 'string' && capturedBody.refusalReason.length > 0, 'refusalReason present (identity-conflict fact preserved)');
  assertTrue(!!capturedBody?.familyCandidateDiagnostic, 'familyCandidateDiagnostic present (identity-conflict fact preserved)');
  assertEq(capturedBody?.listingHardLockReason, 'identity-unresolved', 'listingHardLockReason stays identity-unresolved regardless of category authority');

  if (expectAuthorized) {
    // ─── COMIC control: byte-identical pre-existing behavior ───────────
    assertEq(capturedBody?.pricingSource, 'visual_pool_fallback', 'Comic: pricingSource = visual_pool_fallback (unchanged)');
    assertEq(capturedBody?.price, '$50.00', 'Comic: price = median $50.00 (unchanged formula)');
    assertEq(capturedBody?.priceLow, '$30.00', 'Comic: priceLow = P25 $30.00 (unchanged formula)');
    assertEq(capturedBody?.priceHigh, '$70.00', 'Comic: priceHigh = P75 $70.00 (unchanged formula)');
    assertTrue(!!capturedBody?.priceBands, 'Comic: priceBands present (unchanged)');
    assertEq(capturedBody?.refusedToPrice, undefined, 'Comic: refusedToPrice NOT set (unchanged — this path never set it before)');
    assertEq(capturedBody?.contract?.state, 'LOCKED', 'Comic: contract.state = LOCKED (XMEN1 ruling — price visible, listing gated)');
    assertTrue(capturedBody?.contract?.price != null, 'Comic: contract.price is visible under LOCKED (unchanged)');
  } else {
    // ─── Non-authorized category: new GK-255 refusal ────────────────────
    assertEq(capturedBody?.refusedToPrice, true, 'Non-comic: refusedToPrice === true');
    assertEq(capturedBody?.pricingSource, 'refused-category-pricing-not-authorized', 'Non-comic: pricingSource is the category-neutral refusal reason (same string GK-250 uses)');
    assertEq(capturedBody?.price, null, 'Non-comic: price is null (no automated recommended price)');
    assertEq(capturedBody?.priceLow, null, 'Non-comic: priceLow is null (no AI range)');
    assertEq(capturedBody?.priceHigh, null, 'Non-comic: priceHigh is null (no AI range)');
    assertEq(capturedBody?.priceBands, null, 'Non-comic: priceBands is null');
    assertEq(capturedBody?.contract?.state, 'REFUSED', 'Non-comic: contract.state = REFUSED (refusedToPrice wins the state ladder)');
    assertEq(capturedBody?.contract?.price, null, 'Non-comic: contract.price is null everywhere');
    assertEq(capturedBody?.contract?.bands, null, 'Non-comic: contract.bands is null');
    assertEq(capturedBody?.contract?.listable, false, 'Non-comic: contract.listable === false');
    assertFalse(String(capturedBody?.decision?.action || '').startsWith('LIST'), 'Non-comic: decision.action does not start with LIST');
    // Both independent locks present — identity conflict is NOT collapsed
    // into the category refusal, both facts survive in locks[].
    const lockCodes = (capturedBody?.contract?.locks || []).map((l) => l.code);
    assertTrue(lockCodes.includes('refused'), `locks[] includes the category-refusal lock (codes: ${JSON.stringify(lockCodes)})`);
    assertTrue(lockCodes.includes('identity-unresolved'), `locks[] ALSO independently includes the identity-conflict lock (codes: ${JSON.stringify(lockCodes)})`);
  }

  // No comps/pricing pipeline reached either way — this branch always
  // returns before phase2's compsPromise/fetchComps/PriceCharting.
  const compsSearchCalls = fetchLog.filter((u) => u.includes('item_summary/search') && !u.includes('search_by_image'));
  const pcCalls = fetchLog.filter((u) => u.includes('pricecharting.com'));
  assertTrue(compsSearchCalls.length === 0, 'fetchComps (item_summary/search) did NOT execute — identityRefused returns before phase2, category-independent');
  assertTrue(pcCalls.length === 0, 'PriceCharting did NOT execute');

  return capturedBody;
}

async function main() {
  console.log('\n=== GK-255 — economic authority boundary, real end-to-end /api/enrich proof ===');

  const baseBody = (assetType) => ({
    title: 'The Rationalists', year: '2020', assetType,
    grade: 'Good', confidence: 'high', isGraded: false, numericGrade: null,
    publisher: null, variant: null, keyIssue: null,
    reason: 'A worn paperback, moderate shelf wear.',
    images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='],
  });

  // ─── F1: BOOK — Rationalists-shaped live reproduction ──────────────────
  await runOnce({ label: 'BOOK identity-conflicted', requestBody: baseBody('book'), expectAuthorized: false });

  // ─── F2: MERCHANDISE — same fallback conditions ─────────────────────────
  await runOnce({ label: 'MERCHANDISE identity-conflicted', requestBody: baseBody('merchandise'), expectAuthorized: false });

  // ─── F3: GENERIC / unsupported category ─────────────────────────────────
  await runOnce({ label: 'GENERIC identity-conflicted', requestBody: baseBody('trading-card'), expectAuthorized: false });

  // ─── D: COMIC control — existing behavior must be unchanged ─────────────
  await runOnce({ label: 'COMIC control (unchanged behavior)', requestBody: baseBody('comic'), expectAuthorized: true });

  console.log(`\n=== RESULTS ===`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  if (failed > 0) {
    console.log('\n=== FAILURES ===');
    failures.forEach((f) => console.log(f));
    process.exit(1);
  }
  console.log('All tests passed.\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
