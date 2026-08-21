// tests/grailkey-gk148-publisher-stoplist.test.js
//
// GK-148 — Creepy #1 scan, 2026-08-21 01:23. `[reconcile-variant]`
// produced "Frank Frazetta Erik Larsen" with justifiedBy=[{ebay-pool-
// row-0: "Erik Larsen"}] against a row titled "Creepy #1 CGC 7.0 (Warren
// 1964)..." — Erik Larsen appears nowhere in the pool. Confirmed root
// cause (trace-only pass, docs/TICKET-REGISTRY.md GK-148): the AU 4a-i
// fuzzy fallback (src/lib/premiumCreators.js) tests every word/phrase
// window of an ENTIRE pool-row title against every creator alias with
// zero awareness of what kind of word it's looking at. "warren" (the
// book's real publisher, Warren Publishing) landed at Levenshtein
// distance 2 from Erik Larsen's registered alias "larsen" — both
// exactly 6 characters, clearing MIN_FUZZY_ALIAS_LEN with zero margin
// and landing exactly at FUZZY_MAX_DISTANCE, not a near-miss.
//
// Fix: PUBLISHER_STOP_LIST (premiumCreators.js) — a bounded, explicit
// set of comic publisher/imprint names, normalized the same way as
// everything else in the file, checked inside fuzzyAliasMatches's
// window loop BEFORE the Levenshtein distance is computed. A window
// that IS a stop-listed token can never win a fuzzy match, regardless
// of distance. Does not touch the exact SEARCH_INDEX regex pass, and
// does not touch fuzzy matching for any window that isn't itself a
// stop-listed token (the Dell'Otto class — a genuine creator alias
// mangled by a seller — is unaffected; neither "del" nor "ott" is a
// publisher name). tests/grailkey-directive-au-dellotto-1963.test.js
// re-run byte-identical after this fix (24/24) — cited, not duplicated,
// here.
//
// Part 1 — direct repro of the Creepy #1 false merge (pre-fix would
// fail; post-fix must pass).
// Part 2 — B2-extended: every PUBLISHER_STOP_LIST entry x every
// fuzzy-eligible (len>=6) PREMIUM_CREATORS alias, embedded in a
// realistic listing-title shape, zero merges. This is the actual
// no-false-merge proof the dispatch asked for, not hand-picked examples.
// Part 3 — real /api/enrich handler smoke (GK-138): the exact Creepy
// pool shape reaches the handler with zero Larsen anywhere in the final
// response and no exception escapes.
//
// Invoke: node tests/grailkey-gk148-publisher-stoplist.test.js

import {
  matchCreatorCanonicals,
  extractCreatorsFromComps,
  PREMIUM_CREATORS,
} from '../src/lib/premiumCreators.js';
import { extractFirstEligibleVariantCandidate, reconcileVariantFacet } from '../src/lib/identityCore.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}`; failures.push(msg); console.log(msg); }
};

console.log('\n=== Part 1: direct repro — Creepy #1 real production row text ===\n');

{
  const ROW_0 = 'Creepy #1 CGC 7.0 (Warren 1964) Frank Frazetta Cover Silver Age';
  const matched = matchCreatorCanonicals(ROW_0);
  console.log(`  matchCreatorCanonicals -> [${matched.join(', ')}]`);
  assertTrue(!matched.includes('Erik Larsen'), 'SHIP-BLOCKING: "Erik Larsen" no longer fuzzy-matches from "Warren" in the real production row text');
  assertTrue(matched.includes('Frank Frazetta'), 'genuine exact-match creator (Frazetta) still fires — the fix does not over-suppress');

  const candidate = extractFirstEligibleVariantCandidate(ROW_0);
  console.log(`  extractFirstEligibleVariantCandidate -> "${candidate}"`);
  assertTrue(!String(candidate || '').includes('Larsen'), 'SHIP-BLOCKING: the variant candidate string built from this row no longer contains "Larsen"');
}

{
  // reconcileVariantFacet — the actual function that produced the
  // reported justifiedBy=[{ebay-pool-row-0: "Erik Larsen"}] entry.
  const rows = [
    'Creepy #1 CGC 7.0 (Warren 1964) Frank Frazetta Cover Silver Age',
    'Creepy #1 Warren Publishing 1964 Horror Comic Magazine',
  ];
  const result = reconcileVariantFacet(null, null, rows[0], rows.slice(1));
  const reconciled = result.reconciled;
  console.log(`  reconcileVariantFacet -> value="${reconciled.value}" authority=${reconciled.authority}`);
  console.log(`  justifiedBy: ${JSON.stringify(reconciled.justifiedBy)}`);
  const anyLarsen = JSON.stringify(reconciled.justifiedBy || []).includes('Larsen') || String(reconciled.value || '').includes('Larsen');
  assertTrue(!anyLarsen, 'SHIP-BLOCKING: no "Larsen" anywhere in reconcileVariantFacet\'s value or justifiedBy evidence for the real Creepy #1 pool shape');
  assertTrue(String(reconciled.value || '').includes('Frazetta'), 'the genuine Frazetta credit still comes through reconcileVariantFacet (fix does not over-suppress the real evidence path)');
}

console.log('\n=== Part 2: B2-extended — every stop-listed publisher x every fuzzy-eligible alias, zero merges ===\n');

{
  // Rebuild the SAME fuzzy-eligible-alias enumeration AU's own B2 uses
  // (tests/grailkey-directive-au-dellotto-1963.test.js) so this is a
  // real extension of that proof, not a parallel invention.
  const MIN_FUZZY_ALIAS_LEN = 6;
  const normalize = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const fuzzyEligibleAliases = [];
  for (const c of PREMIUM_CREATORS) {
    const names = [c.canonical, ...(Array.isArray(c.aliases) ? c.aliases : [])];
    for (const n of names) {
      if (normalize(n).length >= MIN_FUZZY_ALIAS_LEN) fuzzyEligibleAliases.push({ canonical: c.canonical, name: n });
    }
  }
  console.log(`  ${fuzzyEligibleAliases.length} fuzzy-eligible (len>=6) aliases across ${PREMIUM_CREATORS.length} creators`);

  // The stop-list itself isn't exported (module-private by design — no
  // reason for anything outside this file to read it), so this test
  // reconstructs the same publisher-name corpus the fix targets and
  // proves the OBSERVABLE behavior (matchCreatorCanonicals on a realistic
  // listing title built around each publisher name) rather than reaching
  // into the module's internals.
  const PUBLISHERS = [
    'Warren', 'Marvel', 'Marvel Comics', 'Image', 'Image Comics', 'Dark Horse',
    'DC', 'DC Comics', 'Archie', 'Archie Comics', 'Fawcett', 'Charlton',
    'Gold Key', 'Harvey', 'Harvey Comics', 'Atlas', 'EC', 'EC Comics',
    'Quality', 'IDW', 'Boom', 'Boom Studios', 'Dynamite', 'Valiant', 'Dell',
    'King Comics', 'Skybound', 'Avatar', 'AWA', 'Aftershock', 'Vertigo',
    'Wildstorm', 'Homage', 'Top Cow', 'Timely', 'National Comics',
    'National Periodical', 'ACG', 'Prize Comics', 'Standard', 'Centaur',
    'Novelty', 'Hillman', 'Ace', 'Lev Gleason', 'Tower', 'Milestone',
    'Malibu', 'Defiant', 'Continuity', 'Eternity', 'Now', 'Eclipse',
    'First', 'Comico', 'Pacific', 'Americomics', 'Renegade', 'Caliber',
    'Antarctic', 'Aircel', 'Innovation', 'Gladstone', 'Whitman', 'Western',
    'King Features', 'Disney', 'Seaboard', 'Atlas Seaboard', 'Zenith',
  ];

  let totalChecks = 0;
  let falseMerges = [];
  for (const pub of PUBLISHERS) {
    // Bare token, and embedded in a realistic parenthetical shape — the
    // exact shape that triggered the real defect ("(Warren 1964)").
    const shapes = [pub, `Some Comic #1 (${pub} 1964) Cover A`, `${pub} Publishing 1964`];
    for (const text of shapes) {
      totalChecks++;
      const matched = matchCreatorCanonicals(text);
      if (matched.length > 0) {
        falseMerges.push({ pub, text, matched });
      }
    }
  }
  console.log(`  ${totalChecks} publisher-shape checks run across ${PUBLISHERS.length} publishers`);
  if (falseMerges.length > 0) {
    falseMerges.forEach((f) => console.log(`  ✗ FALSE MERGE: "${f.text}" -> [${f.matched.join(', ')}]`));
  }
  assertTrue(falseMerges.length === 0, `SHIP-BLOCKING: zero false merges across ${totalChecks} publisher-name checks (B2-extended)`);

  // Sanity: prove the stop-list corpus above actually overlaps the real
  // fuzzy-eligible alias space in DISTANCE (not just that it happens to
  // produce zero hits) — i.e. this is a real test of the mechanism, not
  // a vacuous pass because none of these words were ever close to
  // anything. Recompute distance by hand for the one PROVEN case
  // (warren/larsen) plus a scan for any OTHER stop-listed publisher
  // within distance<=2 of any fuzzy-eligible alias, reported for
  // visibility (not asserted pass/fail — the assertion above already
  // covers correctness; this just documents how much real risk existed).
  const levenshtein = (a, b) => {
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j - 1], prev[j], cur[j - 1]);
      }
      prev = cur;
    }
    return prev[n];
  };
  const nearMisses = [];
  for (const pubRaw of PUBLISHERS) {
    const pub = normalize(pubRaw);
    if (pub.length < MIN_FUZZY_ALIAS_LEN) continue;
    for (const { canonical, name } of fuzzyEligibleAliases) {
      const alias = normalize(name);
      if (Math.abs(pub.length - alias.length) > 2) continue;
      const d = levenshtein(pub, alias);
      if (d <= 2) nearMisses.push({ publisher: pubRaw, canonical, alias: name, distance: d });
    }
  }
  console.log(`  ${nearMisses.length} real publisher/alias pair(s) within distance<=2 (would have false-merged without the stop-list):`);
  nearMisses.forEach((n) => console.log(`    "${n.publisher}" <-> "${n.canonical}" (alias "${n.alias}") distance=${n.distance}`));
  assertTrue(nearMisses.some((n) => n.publisher === 'Warren' && n.canonical === 'Erik Larsen'), 'the known warren/larsen distance-2 pair is present in this corpus — confirms this test exercises the real mechanism, not a vacuous check');
}

console.log('\n=== Part 3: real /api/enrich handler smoke (GK-138) — Creepy #1 pool shape ===\n');

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
  condition: 'Used', conditionId: '3000',
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
  const POOL = [
    ['Creepy #1 CGC 7.0 (Warren 1964) Frank Frazetta Cover Silver Age', 1200],
    ['Creepy #1 Warren Publishing 1964 Horror Magazine Frazetta', 950],
    ['Creepy #1 1964 Warren Frazetta Cover GD/VG', 800],
  ];
  const IMAGE_ITEMS = POOL.map(([t, p], i) => buildEbayItem(t, p, i, '7000000000'));
  const COMPS_ITEMS = POOL.map(([t, p], i) => buildEbayItem(t, p, i, '8000000000'));

  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('oauth2/token') || u.includes('/oauth/')) {
      return jsonResponse({ access_token: 'fake-token', expires_in: 7200, token_type: 'Application Access Token' });
    }
    if (u.includes('search_by_image')) return jsonResponse({ itemSummaries: IMAGE_ITEMS, total: IMAGE_ITEMS.length });
    if (u.includes('item_summary/search')) return jsonResponse({ itemSummaries: COMPS_ITEMS, total: COMPS_ITEMS.length });
    if (u.includes('comicvine.gamespot.com')) return jsonResponse({ results: [], status_code: 1, error: 'OK' });
    if (u.includes('pricecharting.com')) return jsonResponse({ error: 'not found' }, 404);
    if (u.includes('api.anthropic.com')) return jsonResponse({ content: [{ type: 'text', text: '{}' }] });
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
      title: 'Creepy', issue: '1', grade: 'VG 4.0', confidence: 'medium',
      isGraded: false, numericGrade: null, year: '1964', publisher: 'Warren',
      variant: null, keyIssue: null, reason: 'Creepy magazine, Frazetta cover',
      images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='],
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
  assertTrue(capturedStatus === 200, `HTTP 200 (actual: ${capturedStatus})`);

  const responseText = JSON.stringify(capturedBody || {});
  console.log(`  variant=${capturedBody?.variant} title=${capturedBody?.title || capturedBody?.confirmedTitle} decision=${capturedBody?.decision?.action}`);
  assertTrue(!responseText.includes('Larsen'), 'SHIP-BLOCKING: no "Larsen" anywhere in the real handler\'s final JSON response for the Creepy #1 pool');
  assertTrue(!capturedLogs.some((l) => l.includes('Erik Larsen')), 'SHIP-BLOCKING: no "Erik Larsen" logged anywhere during the real handler run');
  assertTrue(!capturedLogs.some((l) => l.includes('ReferenceError')), 'no ReferenceError logged');

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
