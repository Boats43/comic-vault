// tests/q-trackB-commit2-era-classification.test.js
//
// Track B Phase 0, Commit 2 — wires classifyYearEvidence into api/comps.js
// Filter 0c, extracted as the exported, pure applyEraConsistencyFilter
// (same file, module scope). This test calls that REAL export directly,
// and the real exported fetchComps() with global.fetch mocked for the
// founding negative test — not a test-local mirror of the era-filter
// composition — per invariant 10 (Section 4, LAUNCH-AUDIT.md) and the
// global testing rule this campaign established in Commit 1: production
// and test must invoke the identical function.
//
// CONSUMER-AUDIT CORRECTION (before this commit shipped): the pre-existing
// "wipe-out bypass" (restore the FULL unfiltered pool when era filtering
// rejects every row) was audited and found to leak — every consumer of
// eraFilterBypassed (decisionEngine.js's filter-bypass-detected warning,
// matchConfidence's LOW-cap) is a SOFT cap that never nulls price/bands/
// floor/average/collection-value. Worse, the restored pool satisfied the
// attempts-loop's `filtered.parsed.length > 0` break condition immediately,
// silently preventing both broader-query fallthrough AND Ship v0-I's own,
// much better-guarded era fallback from ever running. Fixed structurally:
// applyEraConsistencyFilter's `pool` is now the ACTUAL surviving rows
// (empty when every row genuinely fails), never a restoration. Rejected
// rows are preserved in `rejectedReferenceRows` for research/display
// (I13) instead of being smuggled back into the priced pool. `bypassed`
// remains a pure informational flag driving the existing warning/
// confidence-cap copy.
//
// Six precisely-labeled fixtures (correcting the prior round's own
// mislabel, where a "genuine 1951 control" example was actually a 1966
// book):
//   1. Strange Tales #3 (1951) — genuine vintage issue/year control
//   2. Strange Tales #142 (1966) — genuine later-run control
//   3. "Strange Tales #142 (1951-76 1st Series)" — series-range row, KEPT
//      as no-year-evidence, never treated as a 1951 claim
//   4. modern relaunch title+issue collision row (MODERN_RELAUNCH_RE branch)
//   5. modern "Pick Your Cover" row (ordinary year-tolerance branch — no
//      relaunch marker, but an explicit, far-out-of-tolerance year)
//   6. missing-year control row
// Plus the founding negative test (Part 2, below) proving the structural
// fix through the real production consumer, fetchComps.
//
// Invoke: node tests/q-trackB-commit2-era-classification.test.js

import { applyEraConsistencyFilter, fetchComps } from '../api/comps.js';
import { classifyYearEvidence } from '../src/lib/evidenceEligibility.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertFalse = (cond, label) => assertEq(!!cond, false, label);

const titleOf = (pool) => pool.map((r) => r.title);

console.log('\n=== Track B Phase 0, Commit 2 — era-classification wiring (real applyEraConsistencyFilter / fetchComps) ===\n');

// ══════════════════════════════════════════════════════════════════════════════
// PART 1 — six fixtures + combined pool + controls, via applyEraConsistencyFilter
// ══════════════════════════════════════════════════════════════════════════════

console.log('Fixture 1: Strange Tales #3 (1951) — genuine vintage issue/year control\n');
{
  const title = 'Strange Tales #3 (1951) Marvel';
  const evidence = classifyYearEvidence(title);
  assertEq(evidence.class, 'ISSUE_PUBLICATION_YEAR', 'classifyYearEvidence: genuine "(1951)" cover date -> ISSUE_PUBLICATION_YEAR');
  assertEq(evidence.year, '1951', 'classifyYearEvidence: year extracted correctly');

  const pool = [{ title }];
  const result = applyEraConsistencyFilter(pool, 1951, 'comic', null);
  assertEq(result.pool.length, 1, 'real applyEraConsistencyFilter: exact-year match KEPT');
  assertFalse(result.bypassed, 'not a bypass — a genuine keep');
  assertEq(result.rejectedReferenceRows, [], 'nothing rejected -> rejectedReferenceRows empty');
}

console.log('\nFixture 2: Strange Tales #142 (1966) — genuine later-run control\n');
{
  const title = 'Strange Tales #142 (1966) Marvel';
  const evidence = classifyYearEvidence(title);
  assertEq(evidence.class, 'ISSUE_PUBLICATION_YEAR', 'classifyYearEvidence: genuine "(1966)" cover date -> ISSUE_PUBLICATION_YEAR');
  assertEq(evidence.year, '1966', 'classifyYearEvidence: year extracted correctly');

  const pool = [{ title }];
  const result = applyEraConsistencyFilter(pool, 1966, 'comic', null);
  assertEq(result.pool.length, 1, 'real applyEraConsistencyFilter: exact-year match KEPT (later-run issue, same mechanism as fixture 1)');
}

console.log('\nFixture 3: series-range row — KEPT as no-year-evidence, not rejected as WRONG_YEAR\n');
{
  const title = 'Strange Tales #142 (1951-76 1st Series) Marvel';
  const evidence = classifyYearEvidence(title);
  assertEq(evidence.class, 'SERIES_RANGE', 'classifyYearEvidence: "(1951-76 1st Series)" -> SERIES_RANGE, NOT an issue year');

  // Our confirmed year is 1966 (this book's real publication year, per
  // fixture 2) — a bare-regex extraction would read "1951" from this exact
  // title and reject it as far outside tolerance. The real, wired
  // consumer must instead treat it as no-evidence-keep.
  const pool = [{ title }];
  const result = applyEraConsistencyFilter(pool, 1966, 'comic', null);
  assertEq(result.pool.length, 1, 'real applyEraConsistencyFilter: series-range row KEPT despite confirmedYear=1966 vs the embedded "1951"');
  assertFalse(result.bypassed, 'kept as a genuine no-evidence pass-through, not a wipe-out bypass');
  assertEq(result.rejectedReferenceRows, [], 'a pool of only contextual (no-year-evidence) rows is NOT an all-wrong pool — nothing rejected, no restoration/refusal triggered at all');
}

console.log('\nFixture 4: modern relaunch title+issue collision row\n');
{
  // Renumbered-franchise-title/issue-collision class (CLAUDE.md Pattern
  // Library, ASM #17 2026-07-16) — a modern relaunch reusing the exact
  // same title+issue# as a scarce vintage original.
  //
  // Paired with a genuine matching row rather than tested alone: a
  // single-row pool that fails entirely exercises the bypassed=true /
  // empty-pool path (tested on its own, in the "wipe-out — post-fix"
  // control below). Pairing isolates the specific per-row rejection this
  // fixture targets.
  const goodTitle = 'Amazing Spider-Man #17 (1964) Marvel';
  const badTitle = 'Amazing Spider-Man #17 (2015) Marvel Legacy';
  const pool = [{ title: goodTitle }, { title: badTitle }];
  const result = applyEraConsistencyFilter(pool, 1964, 'comic', null);
  assertEq(result.pool.length, 1, 'real applyEraConsistencyFilter: exactly 1 of 2 survives');
  assertEq(titleOf(result.pool), [goodTitle], 'pre-2000 target + explicit relaunch marker ("Legacy") -> the relaunch row is rejected via MODERN_RELAUNCH_RE, not just year drift; the genuine row survives');
  assertFalse(result.bypassed, 'not a bypass — a genuine partial rejection');
  assertEq(result.rejectedReferenceRows.length, 1, 'the rejected relaunch row is preserved as a rejectedReferenceRow (I13), not silently dropped');
  assertEq(result.rejectedReferenceRows[0].title, badTitle, 'rejectedReferenceRows carries the correct title');
  assertEq(result.rejectedReferenceRows[0].reason, 'modern-relaunch-marker', 'rejectedReferenceRows tags the correct reason');
}

console.log('\nFixture 5: modern "Pick Your Cover" row — no relaunch marker, rejected on year drift alone\n');
{
  const badTitle = 'Amazing Spider-Man #17 (2015) Pick Your Cover Marvel';
  const MODERN_RELAUNCH_RE = /\b(n52|new\s*52|rebirth|infinite\s*frontier|legacy|prime\s*earth|vol\.?\s*[2-9]|volume\s*[2-9]|v[2-9]\b|all[\s-]?new|now!)\b/i;
  assertFalse(MODERN_RELAUNCH_RE.test(badTitle), 'sanity: "Pick Your Cover" does NOT trip the relaunch-marker regex — this fixture exercises a different branch than fixture 4');

  const evidence = classifyYearEvidence(badTitle);
  assertEq(evidence.class, 'ISSUE_PUBLICATION_YEAR', 'classifyYearEvidence: explicit "(2015)" -> ISSUE_PUBLICATION_YEAR (a real, stated year claim)');

  const goodTitle = 'Amazing Spider-Man #17 (1964) Marvel VG';
  const pool = [{ title: goodTitle }, { title: badTitle }];
  const result = applyEraConsistencyFilter(pool, 1964, 'comic', null);
  assertEq(result.pool.length, 1, 'real applyEraConsistencyFilter: exactly 1 of 2 survives');
  assertEq(titleOf(result.pool), [goodTitle], '2015 vs confirmedYear=1964 (51y drift, tolerance=5) -> rejected on ordinary year-tolerance, no relaunch marker needed; the genuine row survives');
  assertFalse(result.bypassed, 'not a bypass — a genuine partial rejection');
  assertEq(result.rejectedReferenceRows.length, 1, 'the rejected Pick-Your-Cover row is preserved as a rejectedReferenceRow');
  assertTrue(result.rejectedReferenceRows[0].reason.startsWith('era-year-mismatch:'), 'rejectedReferenceRows tags a year-mismatch reason (distinct from fixture 4\'s relaunch-marker reason)');
}

console.log('\nFixture 6: missing-year control row — KEPT (no evidence to reject)\n');
{
  const title = 'Amazing Spider-Man #17 Marvel VF';
  const evidence = classifyYearEvidence(title);
  assertEq(evidence.class, 'SELLER_CONTEXT_UNKNOWN', 'classifyYearEvidence: no year token at all -> SELLER_CONTEXT_UNKNOWN');

  const pool = [{ title }];
  const result = applyEraConsistencyFilter(pool, 1964, 'comic', null);
  assertEq(result.pool.length, 1, 'real applyEraConsistencyFilter: missing-year row KEPT (insufficient evidence to reject, unchanged FIX B philosophy)');
}

console.log('\nCombined: all 6 fixture rows through a single applyEraConsistencyFilter call (target year 1966, matching fixtures 2/3)\n');
{
  const pool = [
    { title: 'Strange Tales #142 (1966) Marvel' },              // keep — exact match
    { title: 'Strange Tales #142 (1951-76 1st Series) Marvel' }, // keep — series-range, no evidence
    { title: 'Strange Tales #142 Marvel VF' },                   // keep — missing year
    { title: 'Strange Tales #142 (2015) Marvel Legacy' },        // reject — relaunch marker (yearNum 1966 < 2000)
    { title: 'Strange Tales #142 (2015) Pick Your Cover Marvel' }, // reject — year drift (2015 vs 1966)
  ];
  const result = applyEraConsistencyFilter(pool, 1966, 'comic', null);
  assertEq(result.pool.length, 3, 'combined pool: exactly 3 of 5 survive');
  assertEq(
    titleOf(result.pool).sort(),
    [
      'Strange Tales #142 (1951-76 1st Series) Marvel',
      'Strange Tales #142 (1966) Marvel',
      'Strange Tales #142 Marvel VF',
    ].sort(),
    'combined pool: the correct 3 rows survive (exact match, series-range, missing-year) and the correct 2 are excluded (relaunch marker, year drift)'
  );
  assertEq(result.rejectedReferenceRows.length, 2, 'combined pool: the 2 excluded rows are both preserved as rejectedReferenceRows, not vaporized');
  assertFalse(result.bypassed, 'combined pool: 3 of 5 survive -> not a bypass');
}

console.log('\nControl: assetType=book skips era filtering entirely (unchanged Session 4B behavior)\n');
{
  const pool = [{ title: 'Some Book Collection (2015) Legacy Edition' }];
  const result = applyEraConsistencyFilter(pool, 1964, 'book', null);
  assertEq(result.pool.length, 1, 'assetType=book: row kept untouched, era filter does not run at all');
}

console.log('\nControl: single-row pool failing era filtering 100% — POST-FIX structural behavior (pool is empty, bypassed=true is informational only, rejected row preserved separately)\n');
{
  const badTitle = 'Amazing Spider-Man #17 (2015) Marvel Legacy';
  const pool = [{ title: badTitle }];
  const result = applyEraConsistencyFilter(pool, 1964, 'comic', null);
  assertEq(result.pool.length, 0, 'structural fix: the single failing row is NOT kept — pool is genuinely empty, never restored');
  assertTrue(result.bypassed, 'bypassed=true still fires — the caller can still flag eraFilterBypassed for warning/confidence-cap copy');
  assertEq(result.rejectedReferenceRows.length, 1, 'the rejected row is preserved as a rejectedReferenceRow instead of being smuggled back into pool');
  assertEq(result.rejectedReferenceRows[0].title, badTitle, 'rejectedReferenceRows carries the correct title');
}

// Shared fixture data — the exact founding-negative pool, defined once at
// module scope so both the unit-level check below and the integration-level
// check in Part 2 exercise the IDENTICAL three rows.
const ALL_CONTAMINATED = [
  { title: 'Amazing Spider-Man #17 (2015) Marvel Legacy', price: 25 },
  { title: 'Amazing Spider-Man #17 (2015) Pick Your Cover Marvel', price: 30 },
  { title: 'Amazing Spider-Man #17 (2018) Marvel', price: 28 },
];
const CONTAMINATED_TITLES = ALL_CONTAMINATED.map((r) => r.title);

// ══════════════════════════════════════════════════════════════════════════════
// FOUNDING NEGATIVE, UNIT LEVEL — applyEraConsistencyFilter directly, on the
// exact 3-row all-contaminated fixture Part 2 also feeds through the real
// fetchComps(). Split from the integration test below for a real, discovered
// architectural reason (not a workaround): this exact fixture, at a vintage
// year, triggers Ship v0-I's OWN fallback (confirmed live in Part 2's log
// output), which returns via `emptyComps()` — and `emptyComps()` never
// carries an `evidence` field, for ANY rejection bucket, on ANY early-return
// path in fetchComps (missing-credentials, missing-title, v0-I's own
// guardrail/slab/title/issue/year-conflict rejects, and the post-attempts-
// loop "no sales after filters" check all share this — pre-existing
// architecture, not something Commit 2 introduces or regresses). The ONLY
// fetchComps return that carries `evidence.eraRejectedReferenceRows` is the
// normal success path (parsed.length > 0) — proven separately below via the
// mixed-pool control, which does reach it. This block proves the detailed
// rejectedReferenceRows/reasons/prices shape the founding fixture produces
// at the level where it's actually observable: the exported filter function
// itself, still the real production composition, not a mirror.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nFounding negative, unit level: applyEraConsistencyFilter on the exact 3-row fixture\n');
{
  const result = applyEraConsistencyFilter(ALL_CONTAMINATED.map((r) => ({ ...r })), 1964, 'comic', null);
  assertEq(result.pool.length, 0, 'founding fixture: pool is empty — all 3 rows genuinely fail era consistency');
  assertTrue(result.bypassed, 'founding fixture: bypassed=true (informational flag, no longer restores the pool)');
  assertEq(result.rejectedReferenceRows.length, 3, 'founding fixture: all 3 contaminated rows preserved in rejectedReferenceRows');
  assertEq(
    result.rejectedReferenceRows.map((r) => r.price).slice().sort((a, b) => a - b),
    [25, 28, 30],
    'founding fixture: rejectedReferenceRows prices are exactly [25,28,30] (order-normalized)'
  );
  const byTitle = Object.fromEntries(result.rejectedReferenceRows.map((r) => [r.title, r]));
  assertEq(Object.keys(byTitle).sort(), CONTAMINATED_TITLES.slice().sort(), 'founding fixture: rejectedReferenceRows carries exactly the 3 contaminated titles');
  assertEq(byTitle['Amazing Spider-Man #17 (2015) Marvel Legacy']?.reason, 'modern-relaunch-marker', 'founding fixture: relaunch row tagged with the correct rejection reason');
  assertEq(byTitle['Amazing Spider-Man #17 (2015) Pick Your Cover Marvel']?.reason, 'era-year-mismatch:2015-vs-1964', 'founding fixture: Pick-Your-Cover row tagged with the correct year-mismatch reason');
  assertEq(byTitle['Amazing Spider-Man #17 (2018) Marvel']?.reason, 'era-year-mismatch:2018-vs-1964', 'founding fixture: third contaminated row tagged with the correct year-mismatch reason');
}

// ══════════════════════════════════════════════════════════════════════════════
// PART 2 — FOUNDING NEGATIVE TEST, through the real production consumer:
// the exported fetchComps(), with global.fetch mocked (same convention as
// tests/q141-v0i-slab-exclusion.test.js). Proves the structural fix holds
// end-to-end, not just at the applyEraConsistencyFilter unit level.
//
// Scope note on the acceptance criteria ("no recommendation, no bands, no
// floor/average, Price ready=false"): those fields are computed in
// api/enrich.js (tier engine / decisionEngine / responseContract), one
// layer above api/comps.js. This test proves what THIS commit's real
// consumer (fetchComps) does: count/average/lowest/highest/prices all
// correctly reflect ZERO pricing-eligible survivors for the founding
// fixture, with no contamination leaking into any field. api/enrich.js's
// own "rawComps.count === 0 -> refused-no-data-sources -> price=null,
// priceBands=null, contract REFUSED" transformation is pre-existing,
// already shipped, and already proven elsewhere in this campaign
// (tests/q-strangeTales-containment.test.js, Commit B section — the same
// `count:0` -> `computeDecision` -> `finalizeResponse` -> `contract.state
// === 'REFUSED'`, `price === null` chain). Re-deriving that proof here
// would duplicate an existing test rather than verify anything new about
// THIS commit's actual code change. What matters for Commit 2 specifically
// is that fetchComps honestly reports zero — which this section proves
// through the real exported function, not a mock of it.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nPart 2: fetchComps founding negative test (mocked eBay Browse API)\n');

const OAUTH_RESPONSE = JSON.stringify({ access_token: 'test-token', expires_in: 7200, token_type: 'Application Access Token' });

const makeMockFetch = (browseItems) => async (url) => {
  const u = String(url);
  if (u.includes('oauth2/token')) {
    return { ok: true, status: 200, text: async () => OAUTH_RESPONSE, json: async () => JSON.parse(OAUTH_RESPONSE) };
  }
  if (u.includes('item_summary/search')) {
    const itemSummaries = browseItems.map((it, i) => ({
      itemId: `v1|test-${i}|0`,
      title: it.title,
      price: { value: String(it.price), currency: 'USD' },
      itemWebUrl: `https://www.ebay.com/itm/test-${i}`,
      condition: 'Ungraded',
    }));
    return { ok: true, status: 200, json: async () => ({ itemSummaries }) };
  }
  return { ok: false, status: 404, text: async () => 'not found' };
};

const baseParams = {
  title: 'Amazing Spider-Man',
  issue: '17',
  grade: 'FN 6.0',
  isGraded: false,
  numericGrade: 6,
  year: '1964',
  imageSearchTitle: null,
  appId: 'test-app-id',
  certId: 'test-cert-id',
  categoryId: '259104',
  assetType: 'comic',
};

const originalFetch = globalThis.fetch;

// Structured custody assertions — checks the ACTUAL pricing-eligible
// population fields (prices/recentSales) for contaminated titles, rather
// than string-searching the JSON serialization. The prior draft used
// `JSON.stringify(result).includes('"25"')`, which is VACUOUSLY TRUE
// (always passes) regardless of whether contamination is present: a
// numeric `price: 25` field serializes as `25`, never `"25"` — the quoted
// form this check searched for cannot occur for a number field under any
// circumstance. Demonstrated by direct execution before this fix (see
// Section 16's recorded lesson). An assertion that cannot fail certifies
// nothing.
const pricingPopulationTitles = (result) => [
  ...(result.prices || []).map((r) => r.title),
  ...(result.recentSales || []).map((r) => r.title),
];
const assertPricingPopulationClean = (result, contaminatedTitles, label) => {
  const present = pricingPopulationTitles(result).filter((t) => contaminatedTitles.includes(t));
  assertEq(present, [], `${label}: none of the contaminated titles appear in prices/recentSales (found: ${JSON.stringify(present)})`);
};

const run = async () => {
  // --- Founding negative fixture: vintage target (1964), pool is 100%
  // contaminated — a modern relaunch row, a modern "Pick Your Cover" row
  // with an explicit far-off year but no relaunch marker, and a third
  // wrong-exact-year row (ALL_CONTAMINATED, module scope — same 3 rows the
  // unit-level block above already verified for rejectedReferenceRows/
  // reasons/prices). No genuine 1964 row present at all. All three share
  // the same title+issue tokens as the real book (the exact
  // Renumbered-franchise-title/issue-collision class), so nothing else in
  // the filter chain (title-overlap, reprint, variant, slab, signed) would
  // catch them — era consistency is the ONLY axis that can.
  globalThis.fetch = makeMockFetch(ALL_CONTAMINATED);
  const resultA = await fetchComps(baseParams);
  assertEq(resultA.count, 0, 'FOUNDING NEGATIVE: all-contaminated vintage pool -> comps count is 0 (pre-fix, the inline wipe-out bypass would have restored all 3 rows and likely priced off them)');
  assertEq(resultA.average, null, 'FOUNDING NEGATIVE: average is null, not computed from contaminated rows');
  assertEq(resultA.lowest, null, 'FOUNDING NEGATIVE: lowest/floor is null');
  assertEq(resultA.highest, null, 'FOUNDING NEGATIVE: highest is null');
  assertEq(resultA.prices.length, 0, 'FOUNDING NEGATIVE: prices array (the pricing-eligible population) is empty');
  assertEq(resultA.recentSales.length, 0, 'FOUNDING NEGATIVE: recentSales array is empty');
  assertPricingPopulationClean(resultA, CONTAMINATED_TITLES, 'FOUNDING NEGATIVE');
  // NOTE: this exact fixture returns via Ship v0-I's own emptyComps()-based
  // early return (confirmed live in the log output below), which carries no
  // `evidence` field at all — a pre-existing fact of every early-return path
  // in fetchComps, not specific to this commit. rejectedReferenceRows/
  // reasons/prices for this identical fixture are proven above, at the
  // applyEraConsistencyFilter unit level, where the data is actually
  // observable. See this file's header comment and Section 16 for the full
  // explanation.

  // --- Mixed-pool control: one genuine 1964 row alongside the same three
  // contaminated rows. Confirms the fix isolates correctly rather than
  // over-rejecting — the genuine row must survive and become the comp.
  const GENUINE_ROW = { title: 'Amazing Spider-Man #17 (1964) Marvel', price: 450 };
  globalThis.fetch = makeMockFetch([GENUINE_ROW, ...ALL_CONTAMINATED]);
  const resultB = await fetchComps(baseParams);
  assertTrue(resultB.count > 0, 'Mixed-pool control: a genuine row present -> comps search does NOT collapse to zero');
  assertEq(resultB.count, 1, 'Mixed-pool control: exactly 1 comp survives — the genuine row, not any of the 3 contaminated ones');
  assertEq(resultB.prices.length, 1, 'Mixed-pool control: prices array (pricing-eligible population) has exactly 1 entry');
  assertEq(resultB.prices[0].price, 450, 'Mixed-pool control: the sole pricing-eligible entry is the genuine $450 row');
  assertEq(resultB.prices[0].title, GENUINE_ROW.title, 'Mixed-pool control: the sole pricing-eligible entry\'s title is the genuine row, not a contaminated one');
  assertPricingPopulationClean(resultB, CONTAMINATED_TITLES, 'Mixed-pool control');

  const rowsB = resultB.evidence.eraRejectedReferenceRows;
  assertEq(rowsB.length, 3, 'Mixed-pool control: all 3 contaminated rows preserved solely in evidence.eraRejectedReferenceRows');
  assertEq(rowsB.map((r) => r.title).sort(), CONTAMINATED_TITLES.slice().sort(), 'Mixed-pool control: eraRejectedReferenceRows carries exactly the 3 contaminated titles, none missing or extra');
  assertFalse(resultB.eraFilterBypassed, 'Mixed-pool control: a genuine partial rejection is NOT a bypass (one real survivor, not a wipe-out)');

  // --- Series-range-only control: a pool of ONLY a contextual (no-year-
  // evidence) row. Confirms an all-CONTEXTUAL pool is not treated the same
  // as an all-WRONG pool — it stays admissible, no restoration-or-refusal
  // mechanism should engage at all (this is the "no evidence" case, not
  // the "all rejected" case).
  const SERIES_RANGE_ROW = { title: 'Amazing Spider-Man #17 (1962-98 1st Series) Marvel', price: 500 };
  globalThis.fetch = makeMockFetch([SERIES_RANGE_ROW]);
  const resultC = await fetchComps(baseParams);
  assertEq(resultC.count, 1, 'Series-range-only control: the contextual row stays admissible — count=1, not 0');
  assertTrue(JSON.stringify(resultC).includes('500'), 'Series-range-only control: the row\'s $500 price is present');
  assertFalse(resultC.eraFilterBypassed, 'Series-range-only control: not a bypass — nothing was rejected, this is a genuine no-evidence keep');

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    failures.forEach((f) => console.log(f));
  }

  globalThis.fetch = originalFetch;
  // fetchComps' kv-cache layer initializes an Upstash Redis client with a
  // keep-alive HTTP agent even when unconfigured (fails closed per-call,
  // but the client object itself lingers) — explicit exit so this script
  // terminates instead of hanging on a dangling handle (same note as
  // q141-v0i-slab-exclusion.test.js, which established this pattern).
  process.exit(failed === 0 ? 0 : 1);
};

await run();
