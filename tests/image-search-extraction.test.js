// Unit tests for src/lib/imageSearchIdentity.js — Ship #20a.6.7a.
//
// Covers:
//   - extractVariantTokens: each category (convention / ratio / retailer /
//     auth / finish), dedup, multi-word > single, stable order
//   - extractIssueFromTitle: edge cases (#0, no hash, range, year)
//   - extractYearFromTitle: paren preferred, range bounds
//   - extractSeriesTitle: strips slab + variant + #issue + year + noise
//   - extractIdentityFromImageSearch: array shape, empty/null inputs,
//     full Crow Megacon + Recount Silverbax fixtures round-trip
//
// Invoke: node tests/image-search-extraction.test.js
// Exit code: 0 on all-pass, 1 on any failure.

import {
  extractVariantTokens,
  extractIssueFromTitle,
  extractYearFromTitle,
  extractSeriesTitle,
  extractIdentityFromImageSearch,
  extractConsensus,
} from '../src/lib/imageSearchIdentity.js';

let passed = 0;
let failed = 0;
const failures = [];

const assertEq = (actual, expected, label) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    failures.push(`✗ ${label}\n    expected: ${e}\n    actual:   ${a}`);
  }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertContains = (arr, item, label) => assertEq(Array.isArray(arr) && arr.includes(item), true, label);
const assertNotContains = (arr, item, label) => assertEq(Array.isArray(arr) && !arr.includes(item), true, label);

console.log('\n=== IMAGE SEARCH IDENTITY (Ship #20a.6.7a) ===\n');

// ─── extractVariantTokens: empty / null / non-string ─────────────────
console.log('extractVariantTokens — input shapes:');
assertEq(extractVariantTokens(''), [], 'empty string → []');
assertEq(extractVariantTokens(null), [], 'null → []');
assertEq(extractVariantTokens(undefined), [], 'undefined → []');
assertEq(extractVariantTokens(123), [], 'non-string → []');
assertEq(extractVariantTokens('Amazing Spider-Man #300'), [], 'plain title → []');

// ─── Convention tokens ───────────────────────────────────────────────
console.log('\nConvention tokens:');
assertContains(extractVariantTokens('Crow #1 MEGACON Exclusive'), 'megacon', 'MEGACON detected');
assertContains(extractVariantTokens('Spider-Man NYCC Variant'), 'nycc', 'NYCC detected');
assertContains(extractVariantTokens('Batman C2E2 Exclusive 2024'), 'c2e2', 'C2E2 detected');
assertContains(extractVariantTokens('Wolverine SDCC Foil'), 'sdcc', 'SDCC detected');
assertContains(extractVariantTokens('X-Men Fan Expo Variant'), 'fanexpo', 'Fan Expo detected');
assertContains(extractVariantTokens('Hulk fan-expo exclusive'), 'fanexpo', 'fan-expo (hyphen) detected');
assertContains(extractVariantTokens('Daredevil Emerald City 2025'), 'emerald city', 'Emerald City detected');
assertContains(extractVariantTokens('Thor ECCC Variant'), 'eccc', 'ECCC detected');
assertContains(extractVariantTokens('Iron Man WonderCon 2026'), 'wondercon', 'WonderCon detected');
// No false positives
assertNotContains(extractVariantTokens('Possession #1'), 'sdcc', 'Possession does not match SDCC');

// ─── Ratio tokens ────────────────────────────────────────────────────
console.log('\nRatio tokens:');
assertContains(extractVariantTokens('Crow #1 1:10 Variant'), '1:10', '1:10 detected');
assertContains(extractVariantTokens('Recount #2 1:25 Silverbax'), '1:25', '1:25 detected');
assertContains(extractVariantTokens('Marvel #1 1:50 ratio'), '1:50', '1:50 detected');
assertContains(extractVariantTokens('Image #1 1:100 Var'), '1:100', '1:100 detected');
assertContains(extractVariantTokens('DC #500 1:500 Foil'), '1:500', '1:500 detected');
assertContains(extractVariantTokens('Thor 1:1000 Megacon'), '1:1000', '1:1000 detected');
// Word boundary protection
assertEq(extractVariantTokens('Issue 11:00 special').filter(t => t.startsWith('1:')), [], '11:00 does not match 1:0');

// ─── Retailer tokens ─────────────────────────────────────────────────
console.log('\nRetailer tokens:');
assertContains(extractVariantTokens('Recount #2 1:10 Silverbax COA'), 'silverbax', 'Silverbax detected');
assertContains(extractVariantTokens('Crow #1 ComicTom Exclusive'), 'comictom', 'ComicTom detected');
assertContains(extractVariantTokens('Crow #1 Comic Tom Exclusive'), 'comictom', 'Comic Tom (space) detected');
assertContains(extractVariantTokens('ASM #300 Scorpion Comics Variant'), 'scorpion', 'Scorpion Comics detected');
assertContains(extractVariantTokens('Batman Frankies Variant'), 'frankies', 'Frankies detected');
assertContains(extractVariantTokens("Batman Frankie's Variant"), 'frankies', "Frankie's (apostrophe) detected");
assertContains(extractVariantTokens('Hulk Unknown Comics Exclusive'), 'unknown comics', 'Unknown Comics detected');
assertContains(extractVariantTokens('Walking Dead #1 Walmart Variant'), 'walmart', 'Walmart detected');
assertContains(extractVariantTokens('Spawn #1 Hot Topic Variant'), 'hot topic', 'Hot Topic detected');
// No false positive on plain "target" without "exclusive" qualifier
assertNotContains(extractVariantTokens('Comic about a target'), 'target', 'plain "target" word — no match');
assertContains(extractVariantTokens('Spider-Man #1 Target Exclusive'), 'target', 'Target Exclusive detected');

// ─── Authentication tokens ───────────────────────────────────────────
console.log('\nAuthentication tokens:');
assertContains(extractVariantTokens('CGC SS 9.8 Signed Stan Lee'), 'signed', 'signed detected');
assertContains(extractVariantTokens('Spider-Man #1 with COA'), 'coa', 'COA detected');
assertContains(extractVariantTokens('Hulk Signature Series 9.8'), 'signature series', 'signature series detected');
assertContains(extractVariantTokens('Batman Autographed Cover'), 'autographed', 'autographed detected');
assertContains(extractVariantTokens('X-Men Certified Authentic'), 'certified', 'certified detected');
assertContains(extractVariantTokens('Daredevil Remarked by Artist'), 'remark', 'remark detected');
// Documented false-positive (acceptable per design)
assertContains(extractVariantTokens('CGC SS 9.4 Foil'), 'ss', 'bare SS detected (documented FP)');

// ─── Finish tokens ───────────────────────────────────────────────────
console.log('\nFinish tokens:');
assertContains(extractVariantTokens('Crow #1 Embossed Foil'), 'foil', 'foil detected');
assertContains(extractVariantTokens('Spider-Man Holofoil Variant'), 'holofoil', 'holofoil detected');
assertContains(extractVariantTokens('Hulk Embossed Cover'), 'embossed', 'embossed detected');
assertContains(extractVariantTokens('Thor Holographic Variant'), 'holographic', 'holographic detected');
assertContains(extractVariantTokens('Iron Man Hologram Cover'), 'holographic', 'hologram detected');
assertContains(extractVariantTokens('Batman Virgin Variant'), 'virgin', 'virgin detected');
assertContains(extractVariantTokens('Wolverine Sketch Variant'), 'sketch', 'sketch detected');
assertContains(extractVariantTokens('Hellboy Glow-in-Dark Cover'), 'glow-in-dark', 'glow-in-dark (hyphen) detected');
assertContains(extractVariantTokens('Hellboy Glow in the Dark'), 'glow-in-dark', 'glow in the dark (spaces) detected');
assertContains(extractVariantTokens('Spawn Gold Foil Cover'), 'gold foil', 'gold foil detected');
assertContains(extractVariantTokens('Spawn Silver Foil'), 'silver foil', 'silver foil detected');
assertContains(extractVariantTokens('TMNT Metallic Variant'), 'metallic', 'metallic detected');
// Multi-word > single dedup: gold foil suppresses bare foil
{
  const tokens = extractVariantTokens('Spawn Gold Foil Variant');
  assertContains(tokens, 'gold foil', 'gold foil present');
  assertNotContains(tokens, 'foil', 'bare foil suppressed when gold foil fired');
}
{
  const tokens = extractVariantTokens('Spawn Silver Foil Variant');
  assertNotContains(tokens, 'foil', 'bare foil suppressed when silver foil fired');
}
{
  const tokens = extractVariantTokens('Spawn Holofoil Variant');
  assertNotContains(tokens, 'foil', 'bare foil suppressed when holofoil fired');
}

// ─── Dedup ───────────────────────────────────────────────────────────
console.log('\nDedup:');
{
  const tokens = extractVariantTokens('FOIL foil Foil variant');
  assertEq(tokens.filter(t => t === 'foil').length, 1, 'foil deduped to 1');
}
{
  const tokens = extractVariantTokens('Crow #1 MEGACON megacon Megacon');
  assertEq(tokens.filter(t => t === 'megacon').length, 1, 'megacon deduped');
}

// ─── Stable category order ───────────────────────────────────────────
console.log('\nStable category order:');
{
  // Mix all five categories — order should be: convention → ratio → retailer → auth → finish
  const tokens = extractVariantTokens('Crow #1 MEGACON 1:10 Silverbax Signed Foil');
  const idxConv = tokens.indexOf('megacon');
  const idxRatio = tokens.indexOf('1:10');
  const idxRetailer = tokens.indexOf('silverbax');
  const idxAuth = tokens.indexOf('signed');
  const idxFinish = tokens.indexOf('foil');
  assertTrue(idxConv >= 0, 'megacon present');
  assertTrue(idxRatio > idxConv, 'ratio after convention');
  assertTrue(idxRetailer > idxRatio, 'retailer after ratio');
  assertTrue(idxAuth > idxRetailer, 'auth after retailer');
  assertTrue(idxFinish > idxAuth, 'finish after auth');
}

// ─── extractIssueFromTitle ───────────────────────────────────────────
console.log('\nextractIssueFromTitle:');
assertEq(extractIssueFromTitle('Amazing Spider-Man #300'), '300', 'ASM #300');
assertEq(extractIssueFromTitle('Crow #1 (1989)'), '1', 'Crow #1');
assertEq(extractIssueFromTitle('# 42 Variant'), '42', '#42 with space');
assertEq(extractIssueFromTitle('Spider-Man #0'), '0', '#0 detected');
assertEq(extractIssueFromTitle('Spawn 200'), null, 'no hash → null');
assertEq(extractIssueFromTitle('#1234567'), null, 'too many digits → null');
assertEq(extractIssueFromTitle('(1985) Foo'), null, 'year only → null');
assertEq(extractIssueFromTitle(''), null, 'empty → null');
assertEq(extractIssueFromTitle(null), null, 'null → null');
assertEq(extractIssueFromTitle('#999'), '999', '#999 max');
assertEq(extractIssueFromTitle('#1000'), null, '#1000 over cap');

// ─── extractYearFromTitle ────────────────────────────────────────────
console.log('\nextractYearFromTitle:');
assertEq(extractYearFromTitle('Crow #1 (1989)'), '1989', 'paren year');
assertEq(extractYearFromTitle('Spider-Man 2026 Variant'), '2026', 'bare year');
assertEq(extractYearFromTitle('Batman (1985) — 2020 reprint'), '1985', 'prefer paren over bare');
assertEq(extractYearFromTitle('Hulk 1899 something'), null, 'pre-1900 rejected');
assertEq(extractYearFromTitle('Comic 2150'), null, 'post-2099 rejected');
assertEq(extractYearFromTitle(''), null, 'empty → null');
assertEq(extractYearFromTitle(null), null, 'null → null');
assertEq(extractYearFromTitle('Issue 1234'), null, '1234 (year) rejected');
assertEq(extractYearFromTitle('Year 2099 final'), '2099', '2099 boundary accepted');

// ─── extractSeriesTitle ──────────────────────────────────────────────
console.log('\nextractSeriesTitle:');
assertEq(extractSeriesTitle(''), null, 'empty → null');
assertEq(extractSeriesTitle(null), null, 'null → null');
{
  const t = extractSeriesTitle('Amazing Spider-Man #300 (1988)');
  assertTrue(t && t.toLowerCase().includes('spider-man'), `ASM #300 keeps 'Spider-Man' (got "${t}")`);
}
{
  const t = extractSeriesTitle('Crow #1 MEGACON Exclusive Embossed Foil LTD 100');
  assertTrue(t && t.toLowerCase().includes('crow'), `Crow Megacon keeps 'Crow' (got "${t}")`);
}
{
  const t = extractSeriesTitle('Recount #2 (2024) 1:10 Silverbax Variant CGC 9.8');
  assertTrue(t && t.toLowerCase().includes('recount'), `Recount keeps 'Recount' (got "${t}")`);
}
{
  // Pure noise / variant-only string should reduce to null
  const t = extractSeriesTitle('CGC 9.8 Variant Foil Exclusive');
  assertTrue(t === null || t.length < 5, 'all-noise reduces to null or short');
}

// ─── extractIdentityFromImageSearch ──────────────────────────────────
console.log('\nextractIdentityFromImageSearch — shapes:');
assertEq(extractIdentityFromImageSearch([]), [], 'empty array → []');
assertEq(extractIdentityFromImageSearch(null), [], 'null → []');
assertEq(extractIdentityFromImageSearch(undefined), [], 'undefined → []');
assertEq(extractIdentityFromImageSearch('not an array'), [], 'non-array → []');
{
  const rows = extractIdentityFromImageSearch([{ title: 'Plain' }, {}, null]);
  assertEq(rows.length, 3, 'preserves array length');
  assertEq(rows[0].rawTitle, 'Plain', 'item[0] rawTitle');
  assertEq(rows[1].rawTitle, null, 'missing title → rawTitle:null');
  assertEq(rows[2].rawTitle, null, 'null item → rawTitle:null');
  assertEq(rows[1].variantTokens, [], 'missing title → variantTokens []');
  assertEq(rows[2].issue, null, 'null item → issue:null');
}

// ─── Full fixture: Crow Megacon ──────────────────────────────────────
console.log('\nFull fixture — Crow Megacon:');
{
  const items = [
    { title: 'The Crow #1 MEGACON Exclusive Embossed Foil LTD 100 (2024)' },
    { title: 'Crow #1 Megacon Embossed Foil Variant CGC 9.8' },
    { title: 'Crow Issue 1 Megacon Convention Exclusive 2024' },
  ];
  const rows = extractIdentityFromImageSearch(items);
  assertEq(rows.length, 3, '3 rows');
  assertEq(rows[0].issue, '1', 'row 0 issue');
  assertEq(rows[0].year, '2024', 'row 0 year (paren)');
  assertContains(rows[0].variantTokens, 'megacon', 'row 0 megacon');
  assertContains(rows[0].variantTokens, 'embossed', 'row 0 embossed');
  assertContains(rows[0].variantTokens, 'foil', 'row 0 foil');
  assertEq(rows[2].issue, null, 'row 2 has no #N (Issue 1 not parsed)');
  assertContains(rows[2].variantTokens, 'megacon', 'row 2 megacon');
}

// ─── Full fixture: Recount Silverbax 1:10 ────────────────────────────
console.log('\nFull fixture — Recount Silverbax:');
{
  const items = [
    { title: 'Recount #2 (2024) 1:10 Silverbax Exclusive Signed COA' },
    { title: 'Recount Issue 2 1:10 Variant Silverbax COA Authenticated' },
    { title: 'Recount 2 Silverbax 1:10 Ratio Variant CGC 9.6 Signature Series' },
  ];
  const rows = extractIdentityFromImageSearch(items);
  assertEq(rows.length, 3, '3 rows');
  assertContains(rows[0].variantTokens, '1:10', 'row 0 ratio');
  assertContains(rows[0].variantTokens, 'silverbax', 'row 0 retailer');
  assertContains(rows[0].variantTokens, 'signed', 'row 0 signed');
  assertContains(rows[0].variantTokens, 'coa', 'row 0 COA');
  assertEq(rows[0].issue, '2', 'row 0 issue');
  assertEq(rows[0].year, '2024', 'row 0 year');
  // Row 2: signature series + slab grade — series series should fire
  assertContains(rows[2].variantTokens, 'signature series', 'row 2 signature series');
}

// ─── Wrong-book false-positive sentinel ──────────────────────────────
console.log('\nWrong-book sentinel:');
{
  // Image search returns 5 listings of a different book entirely; parser
  // surfaces them faithfully, but their issue numbers will be inconsistent
  // (no consensus). Phase 2 cross-reference uses this signal — Phase 1
  // just ensures we don't silently swallow them.
  const items = [
    { title: 'Different Book #45' },
    { title: 'Another Book #100' },
    { title: 'Yet Another #7' },
  ];
  const rows = extractIdentityFromImageSearch(items);
  assertEq(rows.length, 3, '3 rows preserved');
  assertEq(rows[0].issue, '45', 'distinct issue 45');
  assertEq(rows[1].issue, '100', 'distinct issue 100');
  assertEq(rows[2].issue, '7', 'distinct issue 7');
  // Each row has empty variant tokens — no phantom matches
  assertEq(rows[0].variantTokens, [], 'no false-positive variant tokens');
}

// ─── Empty results case ──────────────────────────────────────────────
console.log('\nEmpty input (eBay returned 0 items):');
{
  // The HTTP wrapper in api/enrich.js short-circuits when items.length===0
  // and never calls the extractor; this just confirms the extractor is
  // safe under empty input regardless.
  assertEq(extractIdentityFromImageSearch([]), [], 'empty array safe');
}

// ─── Ship #20a.6.7c — Consensus threshold + Alan Quah ────────────────
console.log('\nShip #20a.6.7c — Consensus threshold + artist extraction:');
{
  // ≥2 consensus fires (was ≥3 before Ship #20a.6.7c).
  const items = [
    { title: 'Crow Dead Time #1 (2024)' },
    { title: 'Crow Dead Time #1 (2024)' },
  ];
  const rows = extractIdentityFromImageSearch(items);
  assertEq(rows.length, 2, '2 rows');
  assertEq(rows[0].issue, '1', 'row 0 issue');
  assertEq(rows[1].issue, '1', 'row 1 issue');
  // Note: consensus logic is in api/enrich.js, not here. This test confirms
  // extractor surfaces the titles correctly so consensus can fire at ≥2.
}
{
  // Alan Quah in listing title — should be extractable by ARTIST_PATTERNS.
  const items = [
    { title: 'Crow Dead Time #1 Alan Quah Fanexpo Variant (2024)' },
    { title: 'Absolute Batman #1 Alan Quah Virgin Cover' },
  ];
  const rows = extractIdentityFromImageSearch(items);
  assertContains(rows[0].variantTokens, 'fanexpo', 'row 0 fanexpo detected');
  assertContains(rows[1].variantTokens, 'virgin', 'row 1 virgin detected');
  // Alan Quah is artist name, not a variant token — ARTIST_PATTERNS handles it.
  // The extractor doesn't parse artist names (that's comps.js territory).
}
{
  // Mixed titles below threshold — no dominant winner at ≥2.
  const items = [
    { title: 'Book A #1' },
    { title: 'Book B #1' },
    { title: 'Book C #1' },
  ];
  const rows = extractIdentityFromImageSearch(items);
  assertEq(rows.length, 3, '3 distinct books');
  assertEq(rows[0].issue, '1', 'all are #1');
  assertEq(rows[1].issue, '1', 'all are #1');
  assertEq(rows[2].issue, '1', 'all are #1');
  // Title extraction differs — cross-reference in api/enrich.js will see
  // no consensus (each title appears once, top frequency = 1, < 2).
}
{
  // Single title appearing ≥2 times fires consensus.
  const items = [
    { title: 'The Crow Lazarus #1 (2024)' },
    { title: 'The Crow Lazarus #1 (2024)' },
    { title: 'Different Book #1' },
  ];
  const rows = extractIdentityFromImageSearch(items);
  assertEq(rows.length, 3, '3 rows');
  // Consensus would fire on "The Crow Lazarus" (appears 2× >= threshold).
}
{
  // Edge case: exactly 1 result — consensus cannot fire (need ≥2 total).
  const items = [
    { title: 'Lone Book #1' },
  ];
  const rows = extractIdentityFromImageSearch(items);
  assertEq(rows.length, 1, '1 row');
  // api/enrich.js consensus checks titles.length < 2 → null.
}
{
  // Fanexpo variants in both forms (space + hyphen).
  assertContains(extractVariantTokens('Crow #1 Fanexpo Variant'), 'fanexpo', 'fanexpo (no space)');
  assertContains(extractVariantTokens('Crow #1 Fan Expo Variant'), 'fanexpo', 'fan expo (space)');
  assertContains(extractVariantTokens('Crow #1 Fan-Expo Variant'), 'fanexpo', 'fan-expo (hyphen)');
}

// ─── Ship #EBAY-FIRST: extractConsensus ──────────────────────────────
console.log('\nShip #EBAY-FIRST — extractConsensus:');
{
  // High consensus — 17/20 listings agree on ASM #300
  const items = [
    { title: 'Amazing Spider-Man #300 (1988) Marvel CGC 9.8' },
    { title: 'Amazing Spider-Man 300 Marvel 1988 VF/NM' },
    { title: 'Amazing Spider-Man #300 (1988)' },
    { title: 'Amazing Spider-Man #300 1988' },
    { title: 'Amazing Spider-Man #300 Marvel' },
    { title: 'ASM #300 1988' },
    { title: 'ASM #300 1988' },
    { title: 'Amazing Spider-Man #300 (1988)' },
    { title: 'Amazing Spider-Man #300 Marvel 1988' },
    { title: 'Amazing Spider-Man #300' },
    { title: 'Amazing Spider-Man #300 (1988)' },
    { title: 'Amazing Spider-Man #300 Marvel' },
    { title: 'Amazing Spider-Man #300 1988' },
    { title: 'Amazing Spider-Man #300' },
    { title: 'Amazing Spider-Man #300 (1988) Marvel' },
    { title: 'Amazing Spider-Man #300 Marvel 1988' },
    { title: 'Amazing Spider-Man #300 (1988)' },
    { title: 'Spider-Man #301 (1988)' }, // outlier
    { title: 'ASM #302' }, // outlier
    { title: 'Amazing Spider-Man #300 (1988) Marvel' },
  ];
  const rows = extractIdentityFromImageSearch(items);
  const consensus = extractConsensus(rows);

  assertTrue(consensus !== null, 'consensus returned');
  assertEq(consensus.issue, '300', 'consensus issue #300');
  assertTrue(consensus.title && consensus.title.toLowerCase().includes('spider'), 'consensus title contains spider');
  assertEq(consensus.year, '1988', 'consensus year 1988');
  assertEq(consensus.publisher, 'Marvel', 'consensus publisher Marvel');
  assertTrue(consensus.confidence >= 0.75, `confidence ≥0.75 (got ${consensus.confidence})`);
  assertEq(consensus.source, 'ebay_image_search', 'source field');
  assertTrue(consensus.agreement.total === 20, 'total listings = 20');
}

{
  // Low consensus — no majority
  const items = [
    { title: 'Book A #1' },
    { title: 'Book B #2' },
    { title: 'Book C #3' },
    { title: 'Book D #4' },
    { title: 'Book E #5' },
  ];
  const rows = extractIdentityFromImageSearch(items);
  const consensus = extractConsensus(rows);

  assertEq(consensus, null, 'no consensus when no majority');
}

{
  // Minimum threshold — need at least 5 listings
  const items = [
    { title: 'Crow #1 (2024)' },
    { title: 'Crow #1 (2024)' },
    { title: 'Crow #1' },
    { title: 'Crow #1' },
  ];
  const rows = extractIdentityFromImageSearch(items);
  const consensus = extractConsensus(rows);

  assertEq(consensus, null, 'minimum 5 listings required');
}

{
  // Exactly 50% agreement — should pass
  const items = [
    { title: 'Crow #1 (2024) Image' },
    { title: 'Crow #1 (2024) Image' },
    { title: 'Crow #1 (2024) Image' },
    { title: 'Crow #1 (2024) Image' },
    { title: 'Crow #1 (2024) Image' },
    { title: 'Different #2' },
    { title: 'Different #2' },
    { title: 'Different #2' },
    { title: 'Different #2' },
    { title: 'Different #2' },
  ];
  const rows = extractIdentityFromImageSearch(items);
  const consensus = extractConsensus(rows);

  assertTrue(consensus !== null, '50% agreement passes');
  assertTrue(consensus.title && consensus.title.toLowerCase().includes('crow'), 'consensus title Crow');
  assertEq(consensus.issue, '1', 'consensus issue #1');
  assertEq(consensus.confidence, 0.5, 'confidence exactly 0.5');
}

{
  // Variant consensus — virgin appears in 3+ listings
  const items = [
    { title: 'Absolute Batman #1 Virgin Variant (2024) DC' },
    { title: 'Absolute Batman #1 Virgin Cover DC' },
    { title: 'Absolute Batman 1 Virgin Edition' },
    { title: 'Absolute Batman #1 (2024)' },
    { title: 'Absolute Batman #1 DC' },
    { title: 'Absolute Batman #1' },
  ];
  const rows = extractIdentityFromImageSearch(items);
  const consensus = extractConsensus(rows);

  assertTrue(consensus !== null, 'consensus with variant');
  assertEq(consensus.variant, 'virgin', 'variant consensus virgin');
}

// ─── Done ────────────────────────────────────────────────────────────
console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(f);
  process.exit(1);
}
