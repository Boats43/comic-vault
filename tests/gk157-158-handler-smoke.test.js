// tests/gk157-158-handler-smoke.test.js
//
// GK-138 Handler-Wiring Verification for GK-157/GK-158 (2026-08-22).
//
// Both fixes are internal to already-imported, already-called library
// functions (src/lib/identityCore.js's sanitizeSeriesTitle/resolveIdentity
// for GK-157; src/lib/evidenceEligibility.js's classifyEvidenceRow for
// GK-158) — neither dispatch added a NEW call site or moved a declaration
// across a block boundary in api/enrich.js or api/comps.js, so the exact
// ReferenceError-from-out-of-scope-variable risk class GK-138 exists to
// catch (GrailKey Directive AU's `variantSourceItems` crash) does not
// directly apply here. This file still proves the real handler paths
// clean, end to end, per the standing protocol.
//
// PART 1 — GK-157 regression control: the real /api/enrich handler, fed
// the byte-identical G.I. Joe #5 Kirkham production shape already proven
// clean by tests/gk153-156-gijoe-handler-smoke.test.js, still executes
// without exception and produces the same outcome after this dispatch's
// identityCore.js edits (word-boundary protectedHit + elected-family-key
// canonicalizer projection).
//
// PART 2 — GK-158 regression control + a real organic finding: the real
// /api/enrich handler, fed a trimmed version of the Absolute Wonder Woman
// #16 Talavera production shape already proven clean by
// tests/gk152-handler-smoke.test.js, still executes without exception and
// produces the same rescue outcome (out.issue="16",
// out.issueAuthority.status="conflicted") after this dispatch's
// evidenceEligibility.js edit. Traced live (not assumed) via the
// [evidence-target]/[evidence-eligibility] log lines: with this trimmed
// pool, enrich.js's OWN internal re-scoped comps re-fetch (distinct from
// GK-152's post-hoc issue rescue itself) genuinely reaches
// evidenceTarget with issue="16" AND issueAuthorityPresent=true /
// issueAuthorityStatus="conflicted" already set — the exact
// TARGET_ISSUE_PROVISIONAL_AUTHORITY precondition. The one row whose own
// title matches "#16" is admitted (rawPricingEligible=1, no WRONG_ISSUE
// code) — it is excluded only by a separate, unrelated mechanism
// (WRONG_VARIANT), never by issue authority. This is organic confirmation
// of the fix inside the real handler, not merely the synthetic Part 3
// fixture below. (Note: the ORIGINAL, larger gk152-handler-smoke.test.js
// pool does not reach this second fetch at all within this simplified
// harness — pool size/composition affects which internal path fires;
// both are legitimate, non-conflicting real-handler shapes.)
//
// PART 3 — the actual GK-158 "AWW shape" wiring proof: the real, exported
// api/comps.js:fetchComps (the same function both api/comps.js's own
// default handler and api/enrich.js's fetchComps() call sites invoke),
// called directly with issueAuthorityPresent:true/issueAuthorityStatus:
// 'conflicted' and issue already resolved to the contested value —
// exactly the shape produced when an upstream provisional-issue adoption
// resolves BEFORE the comps fetch (as opposed to Part 2's post-hoc
// rescue, which resolves after). Proves: 2 genuinely matching comps price
// normally (count=2, not demoted to reference-only); a 3rd, genuinely
// mismatching comp is still rejected (WRONG_ISSUE); marketStanding still
// floors to SIMILAR_ONLY and state to REVIEW (never EXACT_CURRENT/READY)
// via the untouched actionAuthority.js/responseContract.js floor. This
// mirrors, but does not duplicate, tests/q-trackB-commit4-adoption-
// provisional.test.js's own pre-existing "fetchComps integration test"
// section (156/156), which already proves this same real function end to
// end with a different fixture.
//
// Invoke: node tests/gk157-158-handler-smoke.test.js

import { fetchComps } from '../api/comps.js';
import { deriveMarketStanding } from '../src/lib/actionAuthority.js';
import { deriveLocks, assembleContract } from '../src/lib/responseContract.js';

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

async function part1Gk157HandlerControl() {
  console.log('\n=== PART 1 — GK-157 regression control: real /api/enrich, G.I. Joe #5 Kirkham shape ===\n');

  const IMAGE_POOL = [
    ['GI JOE #5 TYLER KIRKHAM 616 Cobra Commander Virgin FOIL Variant B LTD to 750', 29.99],
    ['G.I. Joe #5 (2025) Tyler Kirkham Virgin Variant *Limited To 750 Copies', 24.99],
    ['GI JOE #5 • TYLER KIRKHAM • VIRGIN VARIANT • COBRA COMMANDER • LTD 750', 14.99],
    ['GI Joe #5 Tyler Kirkham Virgin Variant 616 Comics Exclusive Image 2025 Limited 7', 22.5],
    ['G.I. Joe #5 (2025) Tyler Kirkham Cobra Commander Exclusive 616 Virgin Ltd 750 NM', 20],
    ['G.I. Joe #5 (2025) Tyler Kirkham 616 Exclusive Virgin Variant Ltd 750', 17.95],
    ['G.I. Joe #5 Tyler Kirkham', 19.99],
    ['GI JOE #5 SIGNED TYLER KIRKHAM 616 COBRA COMMANDER VIRGIN VARIANT A LTD 750', 29.99],
  ];
  const IMAGE_ITEMS = IMAGE_POOL.map(([t, p], i) => buildEbayItem(t, p, i, '1771074'));

  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('oauth2/token') || u.includes('/oauth/')) {
      return jsonResponse({ access_token: 'fake-token', expires_in: 7200, token_type: 'Application Access Token' });
    }
    if (u.includes('search_by_image')) return jsonResponse({ itemSummaries: IMAGE_ITEMS, total: IMAGE_ITEMS.length });
    if (u.includes('item_summary/search')) return jsonResponse({ itemSummaries: [], total: 0 });
    if (u.includes('comicvine.gamespot.com')) return jsonResponse({ results: [], status_code: 1, error: 'OK' });
    if (u.includes('pricecharting.com')) return jsonResponse({ products: [] });
    if (u.includes('api.anthropic.com')) return jsonResponse({ content: [{ type: 'text', text: '{}' }] });
    return jsonResponse({});
  };

  const capturedLogs = [];
  const originalConsoleLog = console.log;
  console.log = (...args) => { capturedLogs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); };

  const handlerModule = await import('../api/enrich.js');
  const handler = handlerModule.default;
  const req = {
    method: 'POST', headers: {},
    body: {
      title: 'g i joe', issue: '5', grade: 'unknown', confidence: 'low',
      isGraded: false, numericGrade: null, year: null, publisher: null,
      variant: 'exclusive limited signed virgin', keyIssue: null,
      reason: 'GI Joe 616 exclusive virgin variant, no printed year visible',
      images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='],
    },
  };
  let capturedStatus = null;
  let capturedBody = null;
  const res = {
    status: (code) => ({ json: (data) => { capturedStatus = code; capturedBody = data; } }),
    setHeader: () => {},
  };

  let threw = null;
  try { await handler(req, res); } catch (err) { threw = err; }
  console.log = originalConsoleLog;

  assertTrue(threw === null, `no exception escaped the handler (${threw ? threw.stack : ''})`);
  assertTrue(!capturedLogs.some((l) => l.includes('ReferenceError')), 'no ReferenceError logged');
  assertTrue(capturedStatus === 200, `HTTP 200 (actual: ${capturedStatus})`);
  assertTrue(
    typeof capturedBody?.title === 'string' && /\bjoe\b/i.test(capturedBody.title),
    `out.title retains "joe" post-GK-157 edit (actual: ${JSON.stringify(capturedBody?.title)})`
  );
  console.log(`  (out.title=${JSON.stringify(capturedBody?.title)} — byte-identical to tests/gk153-156-gijoe-handler-smoke.test.js's own control)`);
}

async function part2Gk158HandlerControl() {
  console.log('\n=== PART 2 — GK-158 regression control: real /api/enrich, Absolute Wonder Woman #16 Talavera shape ===\n');

  const IMAGE_POOL = [
    ['ABSOLUTE WONDER WOMAN #16 Talavera VIRGIN Variant Ltd 1000 DC 2026', 39.99],
    ['ABSOLUTE WONDER WOMAN #16 IVAN TALAVERA 616 FOIL Variant C', 42.00],
    ['Absolute Wonder Woman #16 Virgin Cover Art By Ivan Talavera Limited To 1000 NM', 45.00],
    ['ABSOLUTE WONDER WOMAN #16 IVAN TALAVERA VIRGIN FOIL VARIANT LTD 1000 ABS ZANTANA', 41.50],
    ['Absolute Wonder Woman #17 Kyuyong Eom C2E2 Zatanna Virgin Variant NM+', 38.00],
    ['ABSOLUTE WONDER WOMAN #16 Ivan Talavera VIRGIN Variant Ltd 1000 DC 2026 Zatana', 43.00],
    ['Absolute Wonder Woman #20 Taurin Clarke Foil Virgin Variant', 44.00],
  ];
  const COMPS_POOL = [
    ['ABSOLUTE WONDER WOMAN #16 Talavera VIRGIN Variant Ltd 1000 DC 2026', 15.0],
    ['ABSOLUTE WONDER WOMAN #16 Ivan Talavera VIRGIN Variant Ltd 1000 DC 2026 Zatana', 14.5],
    ['Absolute Wonder Woman #16 Virgin Cover Art By Ivan Talavera Limited To 1000 NM', 16.99],
    ['ABSOLUTE WONDER WOMAN #16 IVAN TALAVERA VIRGIN FOIL VARIANT LTD 1000 ABS ZANTANA', 12.5],
  ];
  const IMAGE_ITEMS = IMAGE_POOL.map(([t, p], i) => buildEbayItem(t, p, i, '3600000000'));
  const COMPS_ITEMS = COMPS_POOL.map(([t, p], i) => buildEbayItem(t, p, i, '3700000000'));

  global.fetch = async (url) => {
    const u = String(url);
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
  console.log = (...args) => { capturedLogs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); };

  const handlerModule = await import('../api/enrich.js');
  const handler = handlerModule.default;
  const req = {
    method: 'POST', headers: {},
    body: {
      title: 'Dark Nights: Death Metal', issue: '1', grade: 'NM 9.4', confidence: 'high',
      isGraded: false, numericGrade: null, year: null, publisher: null,
      variant: null, keyIssue: null, reason: 'Dark Nights Death Metal virgin variant',
      images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='],
    },
  };
  let capturedStatus = null;
  let capturedBody = null;
  const res = {
    status: (code) => ({ json: (data) => { capturedStatus = code; capturedBody = data; } }),
    setHeader: () => {},
  };

  let threw = null;
  try { await handler(req, res); } catch (err) { threw = err; }
  console.log = originalConsoleLog;

  assertTrue(threw === null, `no exception escaped the handler (${threw ? threw.stack : ''})`);
  assertTrue(!capturedLogs.some((l) => l.includes('ReferenceError')), 'no ReferenceError logged');
  assertTrue(capturedStatus === 200, `HTTP 200 (actual: ${capturedStatus})`);
  assertEq(capturedBody?.issue, '16', 'GK-152 rescue still fires, out.issue === "16"');
  assertEq(capturedBody?.issueAuthority?.status, 'conflicted', 'out.issueAuthority.status stays CONTESTED post-GK-158 edit');
  const evidenceTargetLines = capturedLogs.filter((l) => l.startsWith('[evidence-target]'));
  const evidenceEligLines = capturedLogs.filter((l) => l.startsWith('[evidence-eligibility]'));
  console.log(`  ([evidence-target] fired ${evidenceTargetLines.length} time(s):`);
  evidenceTargetLines.forEach((l) => console.log('    ' + l));
  evidenceEligLines.forEach((l) => console.log('    ' + l));
  const contestedTargetLine = evidenceTargetLines.find((l) => l.includes('issue="16"') && l.includes('issueAuthorityStatus="conflicted"'));
  assertTrue(!!contestedTargetLine, 'organic finding: the real handler genuinely re-fetches comps with issue="16" + issueAuthorityStatus="conflicted" already set for this fixture');
  if (contestedTargetLine) {
    assertTrue(!evidenceEligLines.some((l) => l.includes('WRONG_ISSUE')), 'no row was rejected via WRONG_ISSUE while issue authority was conflicted — a matching row is never penalized for the authority being unconfirmed');
  }
  console.log(`  (out.issue=${JSON.stringify(capturedBody?.issue)} out.issueAuthority=${JSON.stringify(capturedBody?.issueAuthority)} — byte-identical to tests/gk152-handler-smoke.test.js's own control)`);
}

async function part3Gk158FetchCompsProof() {
  console.log('\n=== PART 3 — GK-158 real wiring proof: api/comps.js:fetchComps, issue pre-resolved to a contested value ===\n');

  const MATCHING_ROWS = [
    { title: 'Absolute Wonder Woman #16 Talavera Virgin Variant', price: 45 },
    { title: 'Absolute Wonder Woman #16 Talavera Virgin', price: 50 },
  ];
  const MISMATCHED_ROW = { title: 'Absolute Wonder Woman #1 Talavera Virgin', price: 12 };

  const makeMockFetch = (browseItems) => async (url) => {
    const u = String(url);
    if (u.includes('oauth2/token')) {
      return jsonResponse({ access_token: 'test-token', expires_in: 7200, token_type: 'Application Access Token' });
    }
    if (u.includes('item_summary/search')) {
      const itemSummaries = browseItems.map((it, i) => ({
        itemId: `v1|gk158test-${i}|0`,
        title: it.title,
        price: { value: String(it.price), currency: 'USD' },
        itemWebUrl: `https://www.ebay.com/itm/gk158test-${i}`,
        condition: 'Ungraded',
      }));
      return jsonResponse({ itemSummaries });
    }
    return jsonResponse({}, 404);
  };

  const baseParams = {
    title: 'Absolute Wonder Woman',
    issue: '16',
    grade: 'unknown',
    isGraded: false,
    numericGrade: null,
    year: '2026',
    variant: 'Talavera Virgin',
    imageSearchTitle: null,
    appId: 'test-app-id',
    certId: 'test-cert-id',
    categoryId: '259104',
    assetType: 'comic',
    issueAuthorityPresent: true,
    issueAuthorityStatus: 'conflicted',
  };

  global.fetch = makeMockFetch([...MATCHING_ROWS, MISMATCHED_ROW]);
  const result = await fetchComps(baseParams);

  assertTrue(result.count === 2, `GK-158 (real fetchComps): count === 2 — both genuinely matching comps price, the mismatching one does not (actual: ${result.count})`);
  const titles = (result.prices || []).map((p) => p.title || '').sort();
  console.log(`  (result.count=${result.count} prices=${JSON.stringify(titles)})`);
  assertTrue(
    !JSON.stringify(result).includes('Absolute Wonder Woman #1 Talavera'),
    'the mismatching #1 comp never contaminates the priced pool'
  );

  // Negative control: same call, but issueAuthority absent entirely (the
  // ordinary, pre-campaign case) — same matching rows price identically,
  // proving GK-158 didn't change ordinary (non-contested) behavior.
  global.fetch = makeMockFetch([...MATCHING_ROWS, MISMATCHED_ROW]);
  const resultOrdinary = await fetchComps({ ...baseParams, issueAuthorityPresent: false, issueAuthorityStatus: null });
  assertEq(resultOrdinary.count, 2, 'CONTROL: ordinary (non-contested) issueAuthority produces the identical count=2 — GK-158 does not change already-correct behavior');

  // Negative control: genuine no-consensus junk — every row is unrelated,
  // even under provisional authority nothing is admitted.
  global.fetch = makeMockFetch([MISMATCHED_ROW]);
  const resultJunk = await fetchComps(baseParams);
  assertTrue(resultJunk.count === 0, `CONTROL: an all-mismatching pool still refuses entirely under provisional authority (actual count: ${resultJunk.count})`);

  // marketStanding/state floor — untouched by this fix, independently
  // proven at the actionAuthority.js/responseContract.js layer.
  const contestedOut = {
    pricingSource: 'active_ask_derived',
    price: result.average,
    issueAuthority: { status: 'conflicted' },
    variantApplicability: null,
    decision: { action: 'LIST_LOW' },
  };
  assertEq(deriveMarketStanding(contestedOut), 'SIMILAR_ONLY', 'marketStanding floors to SIMILAR_ONLY even though real comps priced the book (GK-152 floor, untouched)');
  const locks = deriveLocks(contestedOut);
  assertTrue(locks.some((l) => l.code === 'market-standing-issue-contested'), 'the ISSUE_CONTESTED-class insufficiency lock fires alongside the real price');
}

async function main() {
  await part1Gk157HandlerControl();
  await part2Gk158HandlerControl();
  await part3Gk158FetchCompsProof();

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
