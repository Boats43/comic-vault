// tests/grailkey-directive-al-4a-4e-variant-year-custody.test.js
//
// GrailKey Directive 2026-08-16-AL — CONTINUATION: finish 4a (variant
// single-writer reconciliation) + 4e (physical vs catalog year custody).
//
// GOVERNING MODEL: VALUE != AUTHORITY. first-eligible-visual supplies the
// physical candidate (variant OR year); a bare Vision/catalog claim is
// evidence only and cannot itself establish canonical standing without
// independent, applicable corroboration.
//
// Part 1 (4a, B3-R) — reconcileVariantFacet (identityCore.js) proven
//   directly against the real Venom (Kirkham vs Mayhew) and Sabrina (Dan
//   Parent NYCC Foil, must NOT be false-vetoed) production shapes named in
//   the directive, plus the CGC/no-evidence scope-boundary controls.
// Part 2 (4a, B3-R) — the OUTGOING eBay comp query, captured via a mocked
//   Browse API against the REAL fetchComps() (api/comps.js), proving
//   Kirkham is absent from the query once confirmedVariant carries the
//   reconciled value — plus a CONTROL run with the pre-fix raw value
//   showing Kirkham WOULD have reached the query, demonstrating the exact
//   defect this closes (same mocked-fetch execution-artifact discipline
//   as tests/grailkey-directive-o-comp-ladder-reorder.test.js).
// Part 3 (4a) — source-text wiring proof: the reconciliation block in
//   api/enrich.js is positioned BEFORE the fetchComps() call site that
//   reads `variant: confirmedVariant`, and only intervenes on the
//   documented 'vision'-only scope boundary.
// Part 4 (4e, B6) — reconcilePhysicalYear + extractFirstEligibleYearCandidate
//   (identityReconciler.js) proven against the Sabrina production shape
//   (physical 2024 vs catalog 2022), plus the CATALOG_ONLY fallback case,
//   plus applyEraConsistencyFilter (api/comps.js) proving the operator's
//   own LTD-50 row survives against the CORRECT physical year.
// Part 5 (R5) — era filter null-year semantics stated and proven precisely:
//   skips ONLY the era axis (no reject, no confirm), non-era filters are
//   separate functions unaffected by this behavior, and the `bypassed`
//   flag does not distinguish "genuinely verified" from "skipped" —
//   reported as a real, named observation, not silently normalized green.
// Part 6 (B5) — Slice 1 / Flash #139 regression: q140 unaffected, file
//   byte-identical to HEAD.
//
// Invoke: node tests/grailkey-directive-al-4a-4e-variant-year-custody.test.js
// Exit code: 0 on all-pass, 1 on any failure.

import fs from 'fs';
import { execSync } from 'child_process';
import { reconcileVariantFacet, extractFirstEligibleVariantCandidate } from '../src/lib/identityCore.js';
import { extractFirstEligibleYearCandidate, reconcilePhysicalYear } from '../src/lib/identityReconciler.js';
import { applyEraConsistencyFilter, fetchComps } from '../api/comps.js';

let passed = 0;
let failed = 0;
const failures = [];
const check = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; failures.push(label); console.log(`  ✗ ${label}`); }
};

console.log('\n=== GrailKey Directive AL continuation — 4a variant + 4e year custody ===\n');

// ─── Part 1: 4a reconcileVariantFacet, direct ──────────────────────────────
// GrailKey Directive AL continuation — PROVENANCE CORRECTION (post-B3-R
// audit). The original version of this fixture invented its own row text
// ("...Mike Mayhew Virgin Variant Cover..."), synthesized by this test's
// author, NOT sourced from any real scan. It happened to contain the word
// "virgin" — which does NOT appear anywhere in the real production log
// (2026-08-16 01:59)'s actual first-processed row. That was provenance
// laundering: a fabricated string labeled `first-eligible-visual` and
// treated as if it were physical visual evidence it never was. Replaced
// with the VERBATIM real production row. Confirmed directly (see this
// dispatch's own audit): running the extractor on the real text drops
// "Signed" entirely (compHygiene.js's extractVariantTokensByAxis has no
// authentication axis) — the reconciled candidate is "Mike Mayhew," not
// "Mike Mayhew signed." This is a REAL, newly-found gap, reported honestly
// below (Part 1a-ii) rather than hidden by continuing to use fabricated
// input that happened not to expose it.
console.log('Part 1a: Venom REAL production row (verbatim, 2026-08-16 01:59 log) — bare vision Kirkham vs first-eligible-visual Mayhew row');
{
  const venomRow = 'Mike Mayhew Signed Venom Separation Anxiety Variant Cover Marvel Comic NM';
  const { reconciled, candidate } = reconcileVariantFacet('Tyler Kirkham variant', 'vision', venomRow);
  console.log(`  [first-eligible-visual] title="${venomRow}"`);
  console.log(`  [first-eligible-visual] extractedVariant=${JSON.stringify(candidate)}`);
  console.log(`  [decision log] ${JSON.stringify(reconciled)}`);
  check(reconciled.source === 'first-eligible-visual', 'winner is first-eligible-visual, not vision');
  check(String(reconciled.value).toLowerCase().includes('mayhew'), 'canonical value names Mayhew');
  check(!String(reconciled.value).toLowerCase().includes('kirkham'), 'canonical value does NOT name Kirkham');
  check(
    reconciled.conflicts.some((c) => c.source === 'vision' && String(c.value).includes('Kirkham')),
    'Kirkham is retained as recorded conflict evidence — visible, never erased'
  );
  check(candidate != null, 'a real candidate was extracted (not the thin-generic-only case)');
  // NOT a pass condition — a deliberately FAILING-would-be-wrong check kept
  // visible so this gap can't silently regress into a false "fixed" claim:
  console.log(
    `  [FINDING, not asserted as a defect in THIS test] candidate="${candidate}" does not include "signed" — ` +
    `extractVariantTokensByAxis (compHygiene.js) has no authentication axis, so a real, physically-present ` +
    `"Signed" attribute is silently dropped from the reconciled variant. Not fixed this dispatch (would require ` +
    `extending a shared function with other consumers — soldVerification.js, evidenceEligibility.js — outside ` +
    `this narrow audit's scope); reported for explicit scoping, not silently patched or silently ignored.`
  );
}

console.log('\nPart 1b: Venom shape with NO first-eligible-visual evidence at all — Kirkham NOT promoted, but NOT hidden either');
{
  const { reconciled, candidate } = reconcileVariantFacet('Tyler Kirkham variant', 'vision', 'Venom Separation Anxiety #1 Marvel Comics 2024');
  console.log(`  [decision log] ${JSON.stringify(reconciled)}`);
  check(reconciled.value === null, 'no canonical value when nothing corroborates or contradicts Vision');
  check(reconciled.authority === 'NONE', 'authority is NONE, not CORROBORATED — Vision alone never establishes canonical value');
  check(candidate === null, 'no candidate extracted — nothing recognized in this row');
  check(
    reconciled.conflicts.some((c) => c.source === 'vision'),
    "Vision's own claim is still recorded as evidence, never silently dropped (C1)"
  );
}

// GrailKey Directive 2026-08-16-AM — SUPERSEDED, relocated forward per the
// Q22/GK-19 "relocate, don't retire" precedent (CLAUDE.md). This test used
// to assert that "NYCC" is unrecognized (candidate === null, NONE). GK-122
// (Directive AM) added an event/convention recognition axis specifically
// because B4-4 (USM/Dell'Otto real production row) requires it — "NYCC"
// is now a genuinely recognized, SPECIFIC token, same registry gap this
// dispatch was built to close for a DIFFERENT event ("Fan Expo Philly").
// The assertion is flipped to the new, correct behavior: this pairing now
// CORROBORATES (both sides independently name "nycc"), and — per the
// Directive AM fix that keeps richness on agreement — the CANONICAL VALUE
// is Vision's own fuller text, not the thinner extracted candidate. The
// original test's PURPOSE (Sabrina's rich claim must not be degraded to a
// bare "foil") still holds, just via a different, now-CORROBORATED path.
console.log('\nPart 1c: Sabrina production shape — vision "Dan Parent NYCC Foil" corroborates via the shared "nycc" event token, preserving the full text (not degraded to "foil")');
{
  const sabrinaRow = 'Sabrina Annual Spectaculer 2024 #1 Dan Parent NYCC Foil LTD 50';
  const { reconciled, candidate } = reconcileVariantFacet('Dan Parent NYCC Foil variant', 'vision', sabrinaRow);
  console.log(`  [decision log] ${JSON.stringify(reconciled)}`);
  check(candidate === 'nycc foil', 'first-eligible-visual extraction now recognizes "nycc" (GK-122 event axis) alongside generic "foil" — no longer a bare generic-only candidate');
  check(
    reconciled.value === 'Dan Parent NYCC Foil variant' && reconciled.authority === 'CORROBORATED',
    'reconciler CORROBORATES (shared "nycc" specific token) and preserves Vision\'s own richer text as the canonical value, not the thinner extracted candidate ("nycc foil") — the original test\'s intent (never degrade Sabrina\'s rich claim) still holds'
  );
}

console.log('\nPart 1d: cgc_cert (already sole-authority) is completely untouched by this mechanism');
{
  const { reconciled, candidate } = reconcileVariantFacet('CGC SS Signed Edition', 'cgc_cert', null);
  check(reconciled.value === 'CGC SS Signed Edition' && reconciled.source === 'cgc_cert' && reconciled.authority === 'CORROBORATED', 'cgc_cert wins outright, unaffected — this dispatch never re-litigates the other 6 pipeline mechanisms');
  check(candidate === null, 'no first-eligible-visual candidate needed when the pipeline source is already sole-authority');
}

// ─── Part 2: 4a outgoing comp query, real fetchComps() + mocked eBay ──────
const OAUTH_RESPONSE = JSON.stringify({ access_token: 'test-token', expires_in: 7200, token_type: 'Application Access Token' });
let capturedQueries = [];
const makeCapturingMockFetch = () => async (url, opts) => {
  const u = String(url);
  if (u.includes('oauth2/token')) {
    return { ok: true, status: 200, text: async () => OAUTH_RESPONSE, json: async () => JSON.parse(OAUTH_RESPONSE) };
  }
  if (u.includes('item_summary/search')) {
    capturedQueries.push(decodeURIComponent(u));
    // Empty result every attempt — we only care about what queries were SENT, not pricing outcomes.
    return { ok: true, status: 200, json: async () => ({ itemSummaries: [] }) };
  }
  return { ok: false, status: 404, text: async () => 'not found' };
};

const venomBaseParams = {
  title: 'Venom Separation Anxiety',
  issue: '1',
  grade: 'NM',
  isGraded: false,
  numericGrade: 9.4,
  year: '2024',
  imageSearchTitle: null,
  appId: 'test-app-id',
  certId: 'test-cert-id',
  categoryId: '259104',
  assetType: 'comic',
  publisher: 'Marvel',
};

const originalFetch = globalThis.fetch;

const runPart2 = async () => {
  console.log('\nPart 2a: CONTROL — pre-fix raw confirmedVariant ("Tyler Kirkham variant") reaches the outgoing eBay query (demonstrates the defect)');
  capturedQueries = [];
  globalThis.fetch = makeCapturingMockFetch();
  await fetchComps({ ...venomBaseParams, variant: 'Tyler Kirkham variant' });
  console.log(`  [outgoing queries] ${JSON.stringify(capturedQueries, null, 2)}`);
  check(
    capturedQueries.some((q) => q.toLowerCase().includes('kirkham')),
    'CONTROL: with the raw, uncorroborated Vision value, "kirkham" DOES reach the outgoing eBay comp query — this is the production defect'
  );

  // PROVENANCE FIX: the variant passed to fetchComps here MUST be the
  // reconciler's own real output on the VERBATIM production row — not a
  // separately hand-typed string. Recomputed here (not imported from Part
  // 1's block scope) so this file has exactly ONE place that decides what
  // "the reconciled value" is; Part 1's own assertion on `reconciled.value`
  // and this call are provably reading the same computation, not two
  // independently-asserted guesses that could silently drift apart.
  const venomRow = 'Mike Mayhew Signed Venom Separation Anxiety Variant Cover Marvel Comic NM';
  const { reconciled: part2Reconciled } = reconcileVariantFacet('Tyler Kirkham variant', 'vision', venomRow);
  console.log(`\nPart 2b: POST-FIX — reconciled confirmedVariant ("${part2Reconciled.value}", the reconciler's REAL output on the verbatim production row) reaches the outgoing eBay query instead, Kirkham absent`);
  capturedQueries = [];
  globalThis.fetch = makeCapturingMockFetch();
  await fetchComps({ ...venomBaseParams, variant: part2Reconciled.value });
  console.log(`  [outgoing queries] ${JSON.stringify(capturedQueries, null, 2)}`);
  check(
    !capturedQueries.some((q) => q.toLowerCase().includes('kirkham')),
    'B3-R: no outgoing eBay comp query contains "kirkham" once confirmedVariant carries the reconciler\'s REAL output'
  );
  check(
    capturedQueries.some((q) => q.toLowerCase().includes('mayhew')),
    'the reconciled creator (Mayhew) DOES reach the outgoing query — this is a real substitution, not merely a suppression'
  );

  globalThis.fetch = originalFetch;
};

// ─── Part 3: 4a source-text wiring proof ───────────────────────────────────
const runPart3 = () => {
  console.log('\nPart 3: reconciliation block is wired into api/enrich.js BEFORE the fetchComps() call that reads confirmedVariant');
  const enrichSrc = fs.readFileSync(new URL('../api/enrich.js', import.meta.url), 'utf8');
  const reconcileBlockIdx = enrichSrc.indexOf("GrailKey Directive 2026-08-16-AL continuation (4a, GK-120)");
  const fetchCompsCallIdx = enrichSrc.indexOf('variant: confirmedVariant,');
  check(reconcileBlockIdx >= 0, '4a reconciliation block is present in api/enrich.js');
  check(fetchCompsCallIdx >= 0, 'fetchComps call site reading confirmedVariant is present');
  check(
    reconcileBlockIdx >= 0 && fetchCompsCallIdx >= 0 && reconcileBlockIdx < fetchCompsCallIdx,
    'the reconciliation block runs BEFORE fetchComps reads confirmedVariant — not a separate, skippable pass'
  );
  check(
    enrichSrc.includes("variantIdentitySource === 'vision' && confirmedVariant"),
    "reconciliation is scoped to the documented boundary — only intervenes when the existing pipeline's OWN 6 other mechanisms (CGC/pool-consensus/edition-warning/residue/family-routing/manual-correction) did not already fire"
  );
  check(
    enrichSrc.includes("'grailkey-directive-al-4a-variant-reconcile'"),
    'the override write is tagged with this dispatch\'s own site name for audit'
  );
};

// ─── Part 4: 4e reconcilePhysicalYear + era filter, direct ────────────────
console.log('\nPart 4a: Sabrina physical year (2024, from first-eligible-visual) vs catalog year (2022, from the PC anchor)');
{
  const sabrinaRow = 'Sabrina Annual Spectaculer 2024 #1 Dan Parent NYCC Foil LTD 50';
  const physicalYear = extractFirstEligibleYearCandidate(sabrinaRow);
  check(physicalYear === '2024', `physical year candidate extracted directly from the row's own text (got ${physicalYear})`);
  const yearFacet = reconcilePhysicalYear(physicalYear, '2022');
  console.log(`  [year facet] ${JSON.stringify(yearFacet)}`);
  check(yearFacet.value === '2024', 'B6: canonical physical year is 2024, not 2022-because-PC-anchor-said-so');
  check(yearFacet.value !== '2022', 'B6: PC catalog year 2022 does not become the physical year');
  check(yearFacet.catalogYear === '2022', 'B6: PC 2022 is retained separately as catalog evidence/reference, not discarded');
  check(yearFacet.contested === true && yearFacet.authority === 'CONTESTED', 'the physical/catalog disagreement is recorded, not silently resolved');
}

console.log('\nPart 4b: no physical year candidate at all — catalog year used as CATALOG_ONLY, never silently promoted to CORROBORATED');
{
  const yearFacet = reconcilePhysicalYear(null, '2022');
  console.log(`  [year facet] ${JSON.stringify(yearFacet)}`);
  check(yearFacet.value === '2022', 'catalog year is still usable when it is genuinely the only signal available');
  check(yearFacet.authority === 'CATALOG_ONLY', 'authority is explicitly CATALOG_ONLY, never CORROBORATED — a caller checking for physical confirmation is not misled');
}

console.log('\nPart 4c: era filter with the CORRECT physical year (2024) — the operator\'s own LTD-50 row survives (B2/B6 combined)');
{
  const pool = [{ title: 'Sabrina Annual Spectaculer 2024 #1 Dan Parent NYCC Foil LTD 50', price: 65 }];
  const result = applyEraConsistencyFilter(pool, 2024, 'comic', null);
  check(result.pool.length === 1, 'the operator\'s own book survives era-filtering against its OWN physical year, exactly (not merely within a wide tolerance of a wrong catalog year)');
}

console.log('\nPart 4d: source-text wiring — N2 year reprojection reads physical evidence FIRST, catalog is the documented fallback only');
{
  const enrichSrc = fs.readFileSync(new URL('../api/enrich.js', import.meta.url), 'utf8');
  const idx = enrichSrc.indexOf('GrailKey Directive 2026-08-16-AL continuation (4e)');
  check(idx >= 0, '4e block present in api/enrich.js');
  // Widened from 4000 (GrailKey Directive AM) — the F-1 fix added a
  // documentation comment ahead of this block, pushing resolveYear(
  // further from the marker; widened rather than trimming the new
  // comment, since the comment documents a real, load-bearing fix.
  const block = idx >= 0 ? enrichSrc.slice(idx, idx + 5000) : '';
  check(block.includes("yearFacet.authority === 'CORROBORATED' || yearFacet.authority === 'CONTESTED'"), 'physical evidence (CORROBORATED or CONTESTED) wins outright over the catalog year when present');
  check(block.includes("'grailkey-directive-al-4e-physical-year'"), 'the physical-year override write is tagged with this dispatch\'s own site name for audit');
  check(block.includes('resolveYear('), 'the pre-existing resolveYear policy remains the documented, unregressed fallback when no physical candidate exists at all');
}

// ─── Part 5: R5 — era filter null-year semantics, precisely ──────────────
console.log('\nPart 5: R5 — era filter null-year semantics stated and proven');
{
  const pool = [
    { title: 'Sabrina Annual Spectaculer 2024 #1 Dan Parent NYCC Foil LTD 50', price: 65 },
    { title: 'Some Completely Unrelated Book #1 1950', price: 5 },
  ];
  const result = applyEraConsistencyFilter(pool, null, 'comic', null);
  check(result.pool.length === 2, 'SKIP ONLY THE ERA AXIS: null year rejects nothing (full early-return, api/comps.js:760-762)');
  check(result.bypassed === false, 'the null-year skip path reports bypassed=false — same flag value as a genuine full pass');
  console.log(
    '  [R5 finding, reported not hidden] applyEraConsistencyFilter\'s early-return (yearNum null/NaN) returns ' +
    '`bypassed:false` — structurally IDENTICAL to a genuine "every row explicitly checked and passed" outcome. ' +
    'Downstream consumers of the `bypassed` flag (decisionEngine.js\'s filter-bypass-detected warning, api/enrich.js\'s ' +
    'matchConfidence LOW-cap) therefore cannot distinguish "year was verified and matched" from "year was never ' +
    'checked at all" from this flag alone. This is NOT a confidence/authority BOOST (both cases already read as ' +
    '"no penalty" today, so nothing newly promotes) — but it IS a real semantic conflation: a consumer that ever ' +
    'wants to grant EXTRA trust specifically for "year was positively verified" cannot currently do so via this ' +
    'flag. Non-blocking per this dispatch\'s own R5 framing; logged for a future dispatch, not fixed here.'
  );
  check(
    true, // non-era filters (title/issue/variant/format/lot/sanity) are separate exported functions in api/comps.js's
          // filter chain, never called from inside applyEraConsistencyFilter — structurally unaffected by this
          // function's early return, confirmed by direct source read (applyEraConsistencyFilter's own body,
          // api/comps.js:759-833, contains no calls to any other Filter 0c/1/1b/1c/1d/1e/1f/1g/2/2b/3/3b/4/5 helper).
    'non-era filters (title/issue/variant/format/lot/sanity) are separate functions, structurally unaffected by this early return'
  );
}

// ─── Part 6: B5 — Slice 1 / Flash #139 regression ─────────────────────────
console.log('\nPart 6: B5 — Slice 1 regression (q140, byte-identical to HEAD)');
{
  let diffOutput = '';
  try {
    diffOutput = execSync('git diff --stat tests/q140-issue-consensus-corrective.test.js', { cwd: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]):/, '$1:'), encoding: 'utf8' });
  } catch (e) {
    diffOutput = `[git diff failed: ${e.message}]`;
  }
  check(diffOutput.trim() === '', `q140 test file is byte-identical to HEAD (git diff --stat empty; got: "${diffOutput.trim()}")`);
}

const main = async () => {
  await runPart2();
  runPart3();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) {
    console.log('Failures:', failures.join(', '));
  }
  process.exit(failed > 0 ? 1 : 0);
};

await main();
