// tests/grailkey-directive-av-handler-smoke.test.js
//
// GrailKey Directive 2026-08-20-AV — GK-133/GK-139, GK-138 handler-wiring
// verification. Unit-level coverage (grailkey-directive-av-title-megakey-
// authority.test.js) proves the reconciler/gate functions are individually
// correct; per the standing Handler-Wiring Verification protocol (GK-138,
// CLAUDE.md), any dispatch touching api/enrich.js wiring must ALSO prove
// the real handler — not just the library — via a stubbed-fetch invocation.
// This file is that proof for both production shapes named in the
// dispatch: Venom (title-facet adoption, B1) and Dell'Otto (mega-key
// floor stand-down, B2), plus a genuine-mega-key negative control (B3)
// proving the floor still fires full force when identity IS corroborated.
//
// Harness pattern reused verbatim from tests/grailkey-directive-au-
// handler-smoke.test.js (global fetch stub keyed on URL substring,
// ACCESS_CODE/KV_REST_API_* deliberately left unset to exercise the
// existing gate-disabled/graceful-degradation paths).
//
// Invoke: node tests/grailkey-directive-av-handler-smoke.test.js

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

const buildEbayItem = (title, price, idx) => ({
  itemId: `v1|40000000000${idx}|0`,
  title,
  leafCategoryIds: ['259104'],
  categories: [{ categoryId: '259104', categoryName: 'Comics & Graphic Novels' }],
  image: { imageUrl: 'https://i.ebayimg.com/images/g/fake/s-l225.jpg' },
  price: { value: String(price), currency: 'USD' },
  itemHref: `https://api.ebay.com/buy/browse/v1/item/v1%7C40000000000${idx}%7C0`,
  seller: { username: 'testseller', feedbackPercentage: '99.9', feedbackScore: 1000 },
  condition: 'Brand New',
  conditionId: '1000',
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

let passed = 0;
let failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}`; failures.push(msg); console.log(msg); }
};

async function runScan({ label, pool, reqBody, pcProducts, expectYearHint }) {
  const EBAY_ITEMS = pool.map(([t, p], i) => buildEbayItem(t, p, i));
  const fetchLog = [];
  const originalFetch = global.fetch;
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
      return jsonResponse({ results: [], status_code: 1, error: 'OK' });
    }
    if (u.includes('pricecharting.com/api/products')) {
      return jsonResponse({ products: pcProducts });
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
  const req = { method: 'POST', headers: {}, body: reqBody };
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
  global.fetch = originalFetch;

  console.log(`\n=== ${label} ===`);
  assertTrue(threw === null, `${label}: no exception escaped the handler (${threw ? threw.message : ''})`);
  assertTrue(!capturedLogs.some((l) => l.includes('ReferenceError')), `${label}: no ReferenceError logged`);
  assertTrue(capturedStatus === 200, `${label}: HTTP 200 (actual: ${capturedStatus})`);
  if (capturedBody) {
    console.log(`  price=${capturedBody.price} decision=${capturedBody.decision?.action} titleAuthority=${capturedBody.titleAuthority} yearAuthority=${capturedBody.yearAuthority} title=${capturedBody.title || capturedBody.confirmedTitle}`);
  }
  return { capturedLogs, capturedBody, capturedStatus, fetchLog };
}

async function main() {
  // ══════════════════════════════════════════════════════════════════════
  // B1 — Venom Separation Anxiety, real handler, real pool (GK-133)
  // ══════════════════════════════════════════════════════════════════════
  const VENOM_POOL = [
    ["Venom - Separation Anxiety 1 Virgin Signed/Remarked by Mike Mayhew w/Poker Chip", 48.86],
    ["Venom Ariel Diaz Artbook Print", 40.00],
    ["Venom Clayton Crain Cover Select", 55.00],
    ["Venom Various Covers Available Pick Your Own", 45.00],
    ["Venom Separation Anxiety Cover Select Presale", 65.00],
    ["Venom Poster Print Wall Art", 35.00],
  ];
  const venom = await runScan({
    label: 'B1 VENOM — title adoption reaches PC/CV, prices at REVIEW, never ID_REQUIRED',
    pool: VENOM_POOL,
    reqBody: {
      title: 'Venom', issue: '150', grade: 'NM 9.4', confidence: 'medium',
      isGraded: false, numericGrade: null, year: null, publisher: 'Marvel Comics',
      variant: 'Mike Mayhew signed virgin', keyIssue: null, reason: 'Venom Separation Anxiety',
      images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='],
    },
    pcProducts: [{ id: '9001', 'product-name': 'Venom: Separation Anxiety #1 (2024)', 'loose-price': 4886 }],
  });

  const reconcileTitleLine = venom.capturedLogs.find((l) => l.startsWith('[reconcile-title]'));
  assertTrue(!!reconcileTitleLine, 'B1: [reconcile-title] line was emitted in the real handler run');
  if (reconcileTitleLine) {
    console.log('  ' + reconcileTitleLine);
    assertTrue(reconcileTitleLine.includes('source=first-eligible-visual'), 'B1: title source is first-eligible-visual (the candidate entered)');
    assertTrue(reconcileTitleLine.includes('authority=CONTESTED'), 'B1: authority is CONTESTED, not silently confirmed');
  }
  assertTrue(venom.capturedLogs.some((l) => l.startsWith('[22e] SKIPPED') && l.includes('identityTitleAdoptedContested=true')), 'B1: 22e Phase 1 was told to skip because of the title adoption — did not revert it');
  assertTrue(!venom.capturedLogs.some((l) => l.includes('[22e-LOSS] Phase 2 FORCED')), 'B1: 22e-LOSS Phase 2 did NOT force the title back to Vision');
  assertTrue(!!venom.capturedBody, 'B1: response body exists');
  if (venom.capturedBody) {
    const title = venom.capturedBody.title || venom.capturedBody.confirmedTitle || '';
    assertTrue(/separation anxiety/i.test(title), 'B1: response title carries "Separation Anxiety", not bare "Venom"');
    assertTrue(venom.capturedBody.decision?.action !== 'ID_REQUIRED', 'B1 SHIP-BLOCKING: never ID_REQUIRED — a candidate existed, PC/CV were asked the right question');
    assertTrue(venom.capturedBody.titleAuthority === 'CONTESTED', 'B1: out.titleAuthority is CONTESTED');
    assertTrue(venom.capturedBody.decision?.action !== 'LIST_NOW', 'B1: never a clean READY-shaped action — always REVIEW/RESEARCH/DO_NOT_LIST class');
  }

  // ══════════════════════════════════════════════════════════════════════
  // B2 — Dell'Otto Amazing Spider-Man #1, real handler, real ghmn7 pool
  // (reused from grailkey-directive-au-handler-smoke.test.js) — mega-key
  // floor must STAND DOWN (GK-139), never enforce $300,000.
  // ══════════════════════════════════════════════════════════════════════
  // Verbatim real ghmn7 pool from tests/grailkey-directive-au-handler-
  // smoke.test.js — proven (by that file's own passing suite) to reach a
  // real computed price through the full pipeline, not truncated to a
  // smaller pool that hits an earlier, unrelated refusal gate instead.
  const DELLOTTO_POOL = [
    ["THE AMAZING SPIDERMAN #1 DEL O'TT  VARIANT VIRGIN COVER COMIC KINGDON CANADA BB4", 14.00],
    ["Amazing Spider-Man #1 Dellotto Virgin Art Variant Marvel Comic Book NM 2022", 29.99],
    ["AMAZING SPIDERMAN 1 GABRIELLE DELL OTTO VIRGIN VARIANT NM EXCLUSIVE vol 6 2022", 35.00],
    ["SPIDER-MAN #1 THE AMAZING MARVEL 616 & BTC COMICS EXCLUSIVE VIRGIN COVER NM+", 20.00],
    ["AMAZING SPIDERMAN 1 GABRIELLE DELL OTTO VIRGIN VARIANT NM EXCLUSIVE vol 6 2022", 35.00],
    ["The Amazing Spider-Man #8  1:100 ratio Virgin Gabriele Dell'Otto cover NM", 250.00],
    ["Spider-Man #5 Vol 3 Unknown Comics Gabriele Del'Otto Virgin Variant 2023 UNREAD", 40.00],
    ["AMAZING SPIDERMAN 798 GABRIELLE DELL OTTO COMICXPOSURE VIRGIN VARIANT NM", 45.00],
    ["AMAZING SPIDER-MAN #8 9.4 NM 2025 1:100 GABRIELE DELL'OTTO VIRGIN VARIANT MARVEL", 71.96],
    ["BLOOD HUNT #5 (Marvel 2024) 1:100 Gabriele Dell'Otto virgin, Gemini mailer, NM", 60.00],
    ["Amazing Spider Man #1 (2022) Lucio Parrillo Virgin Variant NM", 25.00],
    ["Amazing Spider-Man #45 Dell'Otto Virgin Variant Exclusive ASM 2020", 30.00],
    ["Amazing Spider-Man #8B Virgin Marvel 2025 1:100 Incentive Gabriele Dell'Otto", 65.00],
    ["Spider-Man #5 Unknown Comics Dell'Otto Exclusive Var (02/15/2023)", 38.00],
    ["BLOOD HUNT #5 | GABRIELLE DELL’OTTO 1:100 VIRGIN VARIANT: SPIDER-MAN", 55.00],
    ["Spider-Man #5 Vol 3 Unknown Comics Gabriele Del'Otto Virgin Variant 2023 UNREAD", 40.00],
    ["Amazing Spiderman #7 Lucio Parrillo Virgin Cover Debute of Oscorp Spiderman Suit", 12.00],
    ["AMAZING SPIDER-MAN #7 LUCIO PARRILLO EXCLUSIVE VIRGIN 2022 MARVEL CHECK PHOTOS", 9.99],
    ["Marvel Comics Amazing Spider-Man #46 Dell'Otto Unknown Comics Virgin Edition", 29.99],
    ["Amazing Spider-Man #48 Dell'Otto VIRGIN Variant Cover ASM 2020", 27.00],
  ];
  const dellotto = await runScan({
    label: "B2 DELL'OTTO — mega-key floor STANDS DOWN on contested year/variant (GK-139)",
    pool: DELLOTTO_POOL,
    reqBody: {
      title: 'Amazing Spider-Man', issue: null, grade: 'NM 9.4', confidence: 'medium',
      isGraded: false, numericGrade: null, year: null, publisher: 'Marvel Comics',
      variant: 'Gabriele Dell’Otto virgin variant', keyIssue: null, reason: 'Amazing Spider-Man virgin variant cover',
      images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='],
    },
    pcProducts: [{ id: '2314818', 'product-name': 'Amazing Spider-Man #1 (1963)', 'loose-price': 403725 }],
  });

  assertTrue(!!dellotto.capturedBody, 'B2: response body exists');
  if (dellotto.capturedBody) {
    const priceNum = parseFloat(String(dellotto.capturedBody.price || '0').replace(/[$,]/g, ''));
    assertTrue(priceNum !== 300000, `B2 SHIP-BLOCKING: price is NOT the fabricated $300,000 mega-key floor (actual: ${dellotto.capturedBody.price})`);
    assertTrue(priceNum < 10000, `B2: price is in the honest pre-floor range, not grail-tier (actual: ${dellotto.capturedBody.price})`);
  }
  assertTrue(dellotto.capturedLogs.some((l) => l.startsWith('[mega-key-floor] STOOD DOWN')), 'B2 SHIP-BLOCKING: [mega-key-floor] STOOD DOWN line was emitted — the gate fired, not silently');
  assertTrue(dellotto.capturedBody?.megaKeyIdentityUnresolved === true, "B2: out.megaKeyIdentityUnresolved advisory is set — the match is retained, not silently dropped");
  assertTrue(!!dellotto.capturedBody?.megaKeyIdentityUnresolvedName, 'B2: out.megaKeyIdentityUnresolvedName names the possible match');
  assertTrue(dellotto.capturedBody?.decision?.action !== 'LIST_NOW', "B2: safety holds — never a clean listable action");

  // ══════════════════════════════════════════════════════════════════════
  // B3 — genuine corroborated mega-key negative control, real handler.
  // A manual-identity ASM #1 (bypasses resolveIdentity/family-clustering
  // entirely — identitySource='manual', independently authoritative) with
  // an operator-supplied 1963 year and no variant claim at all must still
  // floor at $300,000, full force. If this fails, C5 is violated.
  // ══════════════════════════════════════════════════════════════════════
  const genuine = await runScan({
    label: 'B3 GENUINE MEGA-KEY — corroborated identity still floors, full force',
    pool: [
      ["Amazing Spider-Man #1 CGC 9.4 1963 Marvel Silver Age", 250000],
      ["Amazing Spider-Man #1 1963 Marvel Origin Spider-Man", 275000],
      ["Amazing Spider-Man #1 (1963) Marvel Comics Key Silver Age", 260000],
    ],
    reqBody: {
      manualIdentity: true, title: 'Amazing Spider-Man', issue: '1', grade: 'NM 9.4', confidence: 'high',
      isGraded: true, numericGrade: 9.4, year: 1963, publisher: 'Marvel Comics',
      variant: null, keyIssue: 'first appearance Spider-Man', reason: 'manual entry',
      images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='],
    },
    pcProducts: [{ id: '2314818', 'product-name': 'Amazing Spider-Man #1 (1963)', 'loose-price': 403725 }],
  });
  if (genuine.capturedBody) {
    const priceNum = parseFloat(String(genuine.capturedBody.price || '0').replace(/[$,]/g, ''));
    assertTrue(priceNum >= 250000, `B3 SHIP-BLOCKING (C5 negative control): a genuinely corroborated 1963 ASM #1 STILL floors near/at $300,000 (actual: ${genuine.capturedBody.price})`);
  }
  assertTrue(!genuine.capturedLogs.some((l) => l.startsWith('[mega-key-floor] STOOD DOWN')), 'B3: floor did NOT stand down for the genuine case');

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
