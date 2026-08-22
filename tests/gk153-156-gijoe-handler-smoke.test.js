// tests/gk153-156-gijoe-handler-smoke.test.js
//
// G.I. Joe #5 Tyler Kirkham 616 virgin, real production shape
// (2026-08-22 07:07:15 / 07:08:06, build 3f2bdad, two back-to-back scans
// of the same photo — this fixture reproduces the 07:08:06 request
// byte-for-byte from the real Vercel runtime log). Three independent
// mechanisms, traced then fixed in one commit train:
//
// GK-153 — sanitizeSeriesTitle's LEGACY_CREATOR_NOISE_WORDS list includes
// bare 'joe' (added for creator credits like "Joe Jusko"/"Joe Casey") and
// strips it as a standalone word wherever it appears — including inside
// "G.I. Joe" itself (same bug class as GK-143's "jim" inside "Jiménez").
// The family-election path reconstructs a candidate title from
// agreed+admitted tokens (buildGatedTitleSource, imageSearchIdentity.js)
// whenever applyDualAxisGate allows via a 'creator-lane' provenance; that
// reconstruction ("g i joe 616 gi cobra commander" here) then loses "joe"
// to the noise-word strip, producing "616 gi cobra commander" —
// DIFFERENT from familyCandidate.topFamily.title ("616 gi joe cobra
// commander"), which is never itself corrupted. 22e correctly caught the
// corruption and forced Vision's raw title back — 22e is NOT the defect;
// it's the safety net that worked. FIX: 'g i joe' / 'g.i. joe' / 'gi joe'
// added to COMPOUND_WHITELIST (compHygiene.js) so sanitizeSeriesTitle's
// protectedHit check returns before the noise-word regex ever runs — same
// mechanism already protecting "X-Men," "Captain Marvel," etc. Does NOT
// remove 'joe' from LEGACY_CREATOR_NOISE_WORDS (Joe Jusko/Joe Casey
// stripping must keep working on unrelated titles — see the dedicated
// unit test for those negative controls).
//
// GK-154 — PriceCharting matched "G.I. Joe Special Missions #5 (1987)," an
// unrelated 1987 Marvel mini-series sharing only the base "G.I. Joe" name
// (reason=base-entry, no plausibility check). resolveYear had no user
// year at all (this modern virgin-variant cover carries no printed year)
// so it adopted PC's year unconditionally — confirmedYear became 1987.
// ~500 lines later, q141-a independently concluded this SAME anchor's own
// projected title ("G.I. Joe Special Missions") doesn't match the
// corroborated confirmedTitle and skipped the TITLE write — but nothing
// retroactively invalidated the YEAR the same anchor had already
// supplied. FIX (narrow, per the report's design): a new check, reusing
// the identical predicate q141-a runs (projectCanonicalTitleFromAnchor +
// isCorroboratedIdentitySource), gates pcYear's entry into resolveYear —
// when the anchor already fails title corroboration, pcYear is withheld
// (passed as null) so resolveYear falls through to its own unmodified
// precedence instead of adopting the rejected anchor's year. q141-a
// itself is untouched. The catalog year remains visible as CONFLICT
// evidence (catalogYearForEvidence still reads the real, un-gated pcYear)
// — never silently discarded.
//
// GK-156 (found while tracing GK-154, registered as its own systemic
// ticket) — eraLock (Ship #22a) and poolYearHint (Q121) both read
// `r.title` off parsedVisualRows, but that field is
// extractSeriesTitle(rawTitle) — a SANITIZED series-name projection, not
// the raw listing text a year token actually lives in. Verified by direct
// execution: 5/20 real raw titles carry "(2025)"; only 2/20 survive in
// the sanitized `.title` field — silently starving poolYearHint below its
// own >=3 floor on every affected scan, with no log line at all. FIX:
// `r.rawTitle` (already used correctly elsewhere in this file, e.g. the
// pc-anchor-gate discriminator check) plus a log line for the null-return
// case so a thin/empty extraction is visible from here on.
//
// Combined effect (this file's own proof, not asserted in isolation
// anywhere else): GK-156 makes poolYearHint report a real 2025 signal;
// GK-154's gate withholds the wrong 1987 catalog year from resolveYear;
// resolveYear then finds nothing (no user year, no trusted PC/CV year) and
// returns null; reconcileYear's pre-existing RESCUE branch (GK-135/AT,
// untouched) adopts poolYearHint's 2025 (source='pool-consensus', which
// is sole-authority-capable per GK-137) with the rejected 1987 catalog
// value surfaced as CONTESTED conflict evidence, never silently dropped.
//
// GK-155 (dedup) is NOT re-proven end-to-end here — the confirmedVariant
// text this fixture's pool produces has no Vision/pool-consensus token
// overlap, so it would not exercise the duplicate-token path. GK-155 has
// its own dedicated unit test (tests/gk155-variant-dedup.test.js) with a
// direct reproduction of the overlapping-token shape.
//
// Per the standing Handler-Wiring Verification protocol (GK-138), this
// file proves the REAL handler end to end, not just each fix's own
// library-level unit test.
//
// Invoke: node tests/gk153-156-gijoe-handler-smoke.test.js

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
  seller: { username: `seller${idx}`, feedbackPercentage: '99.9', feedbackScore: 1000 },
  condition: 'Brand New',
  conditionId: '1000',
  thumbnailImages: [{ imageUrl: 'https://i.ebayimg.com/images/g/fake/s-l1600.jpg' }],
  buyingOptions: ['FIXED_PRICE'],
  itemWebUrl: `https://www.ebay.com/itm/${prefix}${idx}`,
  itemLocation: { postalCode: '000**', country: 'US' },
  legacyItemId: `${prefix}${idx}`,
  adultOnly: false,
  itemOriginDate: '2025-05-19T20:04:03.000Z',
  itemCreationDate: '2025-05-19T20:04:03.000Z',
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
  // Real, byte-faithful production pool (20 items, verbatim from the
  // 2026-08-22 07:08:06 Vercel runtime log).
  const IMAGE_POOL = [
    ['GI JOE #5 TYLER KIRKHAM 616 Cobra Commander Virgin FOIL Variant B LTD to 750', 29.99],
    ['G.I. Joe #5 (2025) Tyler Kirkham Virgin Variant *Limited To 750 Copies', 24.99],
    ['GI JOE #5 • TYLER KIRKHAM • VIRGIN VARIANT • COBRA COMMANDER • LTD 750', 14.99],
    ['GI Joe #5 Tyler Kirkham Virgin Variant 616 Comics Exclusive Image 2025 Limited 7', 22.5],
    ['G.I. Joe #5 (2025) Tyler Kirkham Cobra Commander Exclusive 616 Virgin Ltd 750 NM', 20],
    ['G.I. Joe #5 (2025) Tyler Kirkham 616 Exclusive Virgin Variant Ltd 750', 17.95],
    ['G.I. Joe #5 Tyler Kirkham', 19.99],
    ['GI JOE #5 SIGNED TYLER KIRKHAM 616 COBRA COMMANDER VIRGIN VARIANT A LTD 750', 29.99],
    ['GI JOE 5 SIGNED TYLER KIRKHAM 616 COBRA COMMANDER VIRGIN FOIL LTD 750 COVER B', 39.99],
    ['G.I. Joe #5 Tyler Kirkham FOIL', 18.5],
    ['GI JOE #5 SIGNED TYLER KIRKHAM 616 COBRA COMMANDER VIRGIN VARIANT A LTD 750', 34.99],
    ['G.I. Joe #5 SIGNED Tyler Kirkham Cobra Commander Virgin Variant w/ COA Image NM', 45],
    ['GI JOE 5 TYLER KIRKHAM Cobra Commander Virgin & FOIL Variant Set LTD 750 NM ', 42],
    ['GI JOE 5 TYLER KIRKHAM 616 Cobra Commander Virgin & FOIL Variant Set LTD 750', 17.99],
    ['GI JOE #5 TYLER KIRKHAM 616 Cobra Commander Virgin Variant A LTD 750', 20],
    ['Andrew K Curry Shredder #2 Foil 2025 NYCC Blind Bag LTD 300', 25],
    ['GI JOE 5 Tyler Kirkham Variant A Virgin LTD 750 CB', 21],
    ['GI JOE 5 TYLER KIRKHAM 616 Cobra Commander Virgin & FOIL Variant Set LTD 750', 23],
    ['#5GIJOETYLERKIRKHAMCOBRACOMMANDERVIRGINVARLIMITEDTO750)BNNMM+B&B+NEXTDAYSHPPNG', 16],
    ['Shredder #2 | Andrew K Currey FOIL Variant NYCC LTD 300 | Ivan Tao Blind Bag NM', 27],
  ];
  const IMAGE_ITEMS = IMAGE_POOL.map(([t, p], i) => buildEbayItem(t, p, i, '1771074'));

  const fetchLog = [];
  global.fetch = async (url, opts) => {
    const u = String(url);
    fetchLog.push(u.slice(0, 200));
    if (u.includes('oauth2/token') || u.includes('/oauth/')) {
      return jsonResponse({ access_token: 'fake-token', expires_in: 7200, token_type: 'Application Access Token' });
    }
    if (u.includes('search_by_image')) {
      return jsonResponse({ itemSummaries: IMAGE_ITEMS, total: IMAGE_ITEMS.length });
    }
    if (u.includes('item_summary/search')) {
      // Text-search comps — real production had only 2 post-filter
      // survivors on this exact era-mismatched query; a thin pool is the
      // faithful shape, not the point under test here (title/year are).
      const survivors = [
        buildEbayItem('G.I. Joe #5 Tyler Kirkham 616 Virgin Variant Exclusive Limited Signed 2025', 22, 0, '1771075'),
        buildEbayItem('GI JOE #5 Tyler Kirkham Virgin Exclusive Signed Limited 2025', 19, 1, '1771075'),
      ];
      return jsonResponse({ itemSummaries: survivors, total: survivors.length });
    }
    if (u.includes('comicvine.gamespot.com')) {
      return jsonResponse({ results: [], status_code: 1, error: 'OK' });
    }
    if (u.includes('pricecharting.com/api/products')) {
      // The real, wrong catalog match — an unrelated 1987 Marvel
      // mini-series sharing only the base "G.I. Joe" name.
      return jsonResponse({
        products: [
          { id: '2520796', 'product-name': 'G.I. Joe Special Missions #5', console_name: '1987', 'loose-price': 585 },
        ],
      });
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

  const handlerModule = await import('../api/enrich.js');
  const handler = handlerModule.default;
  const req = {
    method: 'POST', headers: {},
    body: {
      // Vision's real read for this scan — lowercase/period-stripped
      // title, exactly as the real [phase1] log line showed.
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
    status: (code) => ({ json: (data) => { capturedStatus = code; capturedBody = data; return { statusCode: code, body: data }; } }),
    setHeader: () => {},
  };

  console.log('\n=== GK-153/154/156 handler-level smoke — real G.I. Joe #5 Kirkham virgin shape ===\n');

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

  // ── GK-153: elected/confirmed title survives with "joe" intact ────────
  const lossLine = capturedLogs.find((l) => l.startsWith('[22e-LOSS]'));
  console.log(`  (22e-LOSS fired: ${!!lossLine}${lossLine ? ' — ' + lossLine : ' — title-family election was clean, no force-back needed'})`);
  assertTrue(
    typeof capturedBody?.title === 'string' && /\bjoe\b/i.test(capturedBody.title),
    `SHIP-BLOCKING (GK-153): out.title retains "joe" (actual: ${JSON.stringify(capturedBody?.title)})`
  );
  assertTrue(
    !/^616\s+gi\s+cobra\s+commander$/i.test(String(capturedBody?.title || '')),
    `out.title is not the corrupted "616 gi cobra commander" family key (actual: ${JSON.stringify(capturedBody?.title)})`
  );

  // ── GK-154 + GK-156: year does not confidently land on the wrong 1987
  // catalog anchor. Either resolved to the real 2025 (via the pool-
  // consensus rescue this combination of fixes enables) or, at minimum,
  // never CORROBORATED at 1987 — both are acceptable per the report's own
  // "2025-or-CONTESTED-with-2025, never confident 1987" bar.
  const anchorGateLine = capturedLogs.find((l) => l.startsWith('[year-anchor-gate]'));
  assertTrue(!!anchorGateLine, 'GK-154 Fix 4: [year-anchor-gate] fires — the wrong PC anchor is recognized and withheld from resolveYear');
  if (anchorGateLine) console.log('  ' + anchorGateLine);

  const poolYearHintLine = capturedLogs.find((l) => l.startsWith('[cv-pool-year-hint] year='));
  assertTrue(!!poolYearHintLine, 'GK-156: [cv-pool-year-hint] now fires with a real year (was always silently null pre-fix)');
  if (poolYearHintLine) console.log('  ' + poolYearHintLine);

  assertTrue(
    String(capturedBody?.confirmedYear || capturedBody?.year) !== '1987',
    `SHIP-BLOCKING (GK-154): confirmedYear is not confidently 1987 (actual: ${JSON.stringify(capturedBody?.confirmedYear ?? capturedBody?.year)})`
  );
  console.log(`  (year outcome: confirmedYear=${JSON.stringify(capturedBody?.confirmedYear ?? capturedBody?.year)} yearAuthority=${JSON.stringify(capturedBody?.yearAuthority)})`);

  // ── Genuine-anchor control belongs in the dedicated Fix 4 unit test
  // (tests/gk154-year-anchor-gate.test.js) — a correctly-matched PC
  // anchor never triggers pcAnchorTitleRejectedForYear at all, so this
  // handler fixture (a deliberately-wrong anchor) cannot exercise that
  // side by itself.

  console.log(`  out.title=${JSON.stringify(capturedBody?.title)} out.issue=${capturedBody?.issue} out.confirmedYear=${JSON.stringify(capturedBody?.confirmedYear)} out.variant=${JSON.stringify(capturedBody?.variant)}`);
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
