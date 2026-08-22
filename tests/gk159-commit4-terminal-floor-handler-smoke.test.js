// tests/gk159-commit4-terminal-floor-handler-smoke.test.js
//
// GK-159 (2026-08-22) — GK-138 real-handler proof, the AWW shape: a real
// /api/enrich request where title/year/publisher all resolve cleanly
// (Absolute Wonder Woman, 2026, DC Comics) but Vision's own issue guess
// ("99") disagrees with the comps pool's unanimous "#16" reading —
// isolating the conflict to the issue facet alone, exactly the shape
// GK-159 targets (a book whose IDENTITY is fine, only the issue number is
// contested) — and a genuine tier-3 price (verifiedActive.length>=3,
// pricingSource='active_ask_derived') is computed from that same comps
// pool. Before this fix, commit4-terminal (computeIssueAuthorityContractPatch,
// src/lib/issueAuthority.js) would have unconditionally nulled that price
// and forced ID_REQUIRED the instant issueAuthority.status went
// 'conflicted' — after this fix, the card commits the real price, floored
// to marketStanding=SIMILAR_ONLY / actionAuthority.state=REVIEW, never
// EXACT_CURRENT/READY, listing still not listable.
//
// Invoke: node tests/gk159-commit4-terminal-floor-handler-smoke.test.js

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
  condition: 'Ungraded',
  conditionId: '4000',
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

let passed = 0;
let failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}`; failures.push(msg); console.log(msg); }
};
const assertEq = (actual, expected, label) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assertTrue(a === e, `${label} (expected ${e}, actual ${a})`);
};

async function main() {
  // Family-ambiguous visual pool — same real-shape mix as GK-152's own
  // fixture, deliberately spanning #16/#17/#18/#20 so no single-issue
  // family can cleanly win, isolating issue resolution to the later,
  // stronger comps-pool signal below rather than the raw visual pool.
  const IMAGE_POOL = [
    ['ABSOLUTE WONDER WOMAN #16 Talavera Ltd 1000 DC 2026', 39.99],
    ['ABSOLUTE WONDER WOMAN #16 IVAN TALAVERA 616 Cover C', 42.00],
    ['Absolute Wonder Woman #16 Cover Art By Ivan Talavera Limited To 1000 NM', 45.00],
    ['Absolute Wonder Woman #17 Kyuyong Eom C2E2 Zatanna NM+', 38.00],
    ['ABSOLUTE WONDER WOMAN #16 Ivan Talavera Ltd 1000 DC 2026 Zatana', 43.00],
    ['Absolute Wonder Woman #17 EOM Zatanna unmasked C2E2', 39.00],
    ['Absolute Wonder Woman #20 Taurin Clarke', 44.00],
    ['ABSOLUTE WONDER WOMAN #18 KYUYONG EOM 616 Cover', 40.00],
  ];
  // Active comps pool: bare title, no variant-axis tokens (no "virgin"/
  // "foil"/cover-letter) so evidenceEligibility's variant-axis check never
  // fires — isolates this fixture to the issue-authority axis alone,
  // which is what GK-159 targets. 5 unanimous "#16" rows clear
  // priceBands.js's own tier-3 verifiedActive.length>=3 threshold,
  // producing a genuine computed price the fixture then contests.
  const COMPS_POOL = [
    ['Absolute Wonder Woman #16 Talavera', 28],
    ['Absolute Wonder Woman #16 Talavera', 30],
    ['Absolute Wonder Woman #16 Talavera', 32],
    ['Absolute Wonder Woman #16 Talavera', 34],
    ['Absolute Wonder Woman #16 Talavera', 36],
  ];

  const IMAGE_ITEMS = IMAGE_POOL.map(([t, p], i) => buildEbayItem(t, p, i, '4600000000'));
  const COMPS_ITEMS = COMPS_POOL.map(([t, p], i) => buildEbayItem(t, p, i, '4700000000'));

  const fetchLog = [];
  global.fetch = async (url) => {
    const u = String(url);
    fetchLog.push(u.slice(0, 160));
    if (u.includes('oauth2/token') || u.includes('/oauth/')) {
      return jsonResponse({ access_token: 'fake-token', expires_in: 7200, token_type: 'Application Access Token' });
    }
    if (u.includes('search_by_image')) return jsonResponse({ itemSummaries: IMAGE_ITEMS, total: IMAGE_ITEMS.length });
    if (u.includes('item_summary/search')) return jsonResponse({ itemSummaries: COMPS_ITEMS, total: COMPS_ITEMS.length });
    if (u.includes('comicvine.gamespot.com')) return jsonResponse({ results: [], status_code: 1, error: 'OK' });
    if (u.includes('pricecharting.com')) return jsonResponse({ products: [] });
    if (u.includes('api.anthropic.com')) return jsonResponse({ content: [{ type: 'text', text: '{}' }] });
    return jsonResponse({});
  };

  const capturedLogs = [];
  const originalConsoleLog = console.log;
  const originalConsoleWarn = console.warn;
  console.log = (...args) => { capturedLogs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); };
  console.warn = (...args) => { capturedLogs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); };

  const handlerModule = await import('../api/enrich.js');
  const handler = handlerModule.default;
  const req = {
    method: 'POST', headers: {},
    body: {
      title: 'Absolute Wonder Woman', issue: '99', grade: 'unknown', confidence: 'medium',
      isGraded: false, numericGrade: null, year: '2026', publisher: 'DC Comics',
      variant: null, keyIssue: null, reason: 'Absolute Wonder Woman virgin variant',
      images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='],
    },
  };
  let capturedStatus = null;
  let capturedBody = null;
  const res = {
    status: (code) => ({ json: (data) => { capturedStatus = code; capturedBody = data; } }),
    setHeader: () => {},
  };

  console.log('\n=== GK-159 handler-level smoke — AWW shape, commit4-terminal floors instead of clears ===\n');

  let threw = null;
  try { await handler(req, res); } catch (err) { threw = err; }
  console.log = originalConsoleLog;
  console.warn = originalConsoleWarn;

  assertTrue(threw === null, `no exception escaped the handler (${threw ? threw.stack : ''})`);
  assertTrue(!capturedLogs.some((l) => l.includes('ReferenceError')), 'no ReferenceError logged');
  assertTrue(capturedStatus === 200, `HTTP 200 (actual: ${capturedStatus})`);

  // NOTE: this fixture's issueAuthority.status='conflicted' arrives via
  // Vision's own issue guess ("99") being directly marked conflicted
  // against the comps pool's unanimous "#16" reading — a different real
  // upstream mechanism than GK-152's own rescue-from-null path (which
  // fires only when Vision supplies NO issue at all). GK-159 is
  // deliberately agnostic to WHICH upstream mechanism produced
  // issueAuthority.status='conflicted' — commit4-terminal only reads the
  // status value itself, so this is an equally valid, real proof of the
  // fix. Confirmed directly rather than assumed:
  assertTrue(
    Array.isArray(capturedBody?.issueAuthority?.reasons) && capturedBody.issueAuthority.reasons.includes('issue-evidence-contested'),
    `out.issueAuthority carries a real, evidence-based conflict reason (actual: ${JSON.stringify(capturedBody?.issueAuthority?.reasons)})`
  );
  console.log(`  (out.price=${JSON.stringify(capturedBody?.price)} out.pricingSource=${JSON.stringify(capturedBody?.pricingSource)} out.issueAuthority=${JSON.stringify(capturedBody?.issueAuthority)})`);

  const floorLine = capturedLogs.find((l) => l.startsWith('[commit4-terminal] issueAuthority.status="conflicted" but a real price'));
  assertTrue(!!floorLine, 'SHIP-BLOCKING (GK-159): the new [commit4-terminal] floor branch fires — a real price existed when issueAuthority went conflicted');
  if (floorLine) console.log('  ' + floorLine);

  const oldClearLine = capturedLogs.find((l) => l.startsWith('[commit4-terminal] issueAuthority.status="conflicted" —'));
  assertTrue(!oldClearLine, 'the OLD hard-clear commit4-terminal branch does NOT fire for this fixture (mutually exclusive with the floor branch)');

  assertEq(capturedBody?.issueAuthority?.status, 'conflicted', 'out.issueAuthority.status stays conflicted (untouched by this fix)');
  assertTrue(typeof capturedBody?.price === 'string' && capturedBody.price.startsWith('$') && capturedBody.price !== '$0.00', `SHIP-BLOCKING: out.price is a real, non-zero price (actual: ${JSON.stringify(capturedBody?.price)})`);
  assertTrue(capturedBody?.pricingSource !== 'refused-issue-authority-conflicted', `SHIP-BLOCKING: out.pricingSource is the honest floored source, not the synthetic refused string (actual: ${JSON.stringify(capturedBody?.pricingSource)})`);
  assertTrue(capturedBody?.refusedToPrice !== true, 'out.refusedToPrice is not true — this is a floored price, not a refusal');

  const contract = capturedBody?.contract;
  assertTrue(!!contract, 'response carries an assembled contract block');
  if (contract) {
    assertEq(contract.actionAuthority?.marketStanding, 'SIMILAR_ONLY', 'contract.actionAuthority.marketStanding === SIMILAR_ONLY');
    assertEq(contract.actionAuthority?.state, 'REVIEW', 'contract.actionAuthority.state === REVIEW (never LOCKED/ID_REQUIRED/READY)');
    assertTrue(Array.isArray(contract.actionAuthority?.reasonCodes) && contract.actionAuthority.reasonCodes.includes('ISSUE_CONTESTED'), `contract.actionAuthority.reasonCodes includes ISSUE_CONTESTED (actual: ${JSON.stringify(contract.actionAuthority?.reasonCodes)})`);
    assertEq(contract.listable, false, 'contract.listable === false (listing stays gated, never READY)');
    assertTrue(contract.price != null && contract.price > 0, `contract.price is a real, positive number (actual: ${JSON.stringify(contract.price)})`);
    assertTrue(contract.state !== 'ID_REQUIRED' && contract.state !== 'REFUSED', `contract.state is neither ID_REQUIRED nor REFUSED (actual: ${JSON.stringify(contract.state)})`);
    assertTrue(contract.state !== 'PRICED', `contract.state is not the strict PRICED tier — never rendered as if fully confirmed (actual: ${JSON.stringify(contract.state)})`);
  }

  console.log(`  out.price=${JSON.stringify(capturedBody?.price)} out.pricingSource=${JSON.stringify(capturedBody?.pricingSource)} contract.state=${JSON.stringify(contract?.state)} contract.actionAuthority=${JSON.stringify(contract?.actionAuthority)}`);
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
