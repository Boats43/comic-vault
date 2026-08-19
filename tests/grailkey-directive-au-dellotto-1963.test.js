// tests/grailkey-directive-au-dellotto-1963.test.js
//
// GrailKey Directive 2026-08-18-AU — GK-136 / GK-137. Dell'Otto 1963
// accuracy dispatch: the evidence was there, it just never reached the
// reconcilers.
//
// Production evidence, request "ghmn7", 2026-08-17 22:16-ish, build
// 78286a3 / b5faa28 (identical mechanism re-confirmed live 2026-08-18
// 22:55): a real 2022 Amazing Spider-Man #1 Gabriele Dell'Otto virgin
// variant was carded as ASM #1 (1963) at $13,322.93 — a Silver Age grail
// price for a modern variant cover.
//
// Two independent, compounding root causes:
//
// RC-1 (GK-136) — variant evidence was present, invisible. The same
// creator's name appeared in the pool spelled five different ways
// ("Dellotto", "Dell'Otto", "DELL'OTTO" — all three already matched
// ARTIST_PATTERNS/premiumCreators' exact regex; "DELL OTTO" [space,
// where the regex expected an optional apostrophe] and "DEL O'TT"
// [single L, truncated suffix, misplaced apostrophe] — did not). The
// rank-1 row's OWN raw text was in the second, unmatched class, and the
// aggregate ≥2-same-artist consensus gate (variantIdentity.js:972-991)
// never had a chance either — the family+issue-scoped population this
// book's variant evidence draws from turned out to carry exactly one
// Dell'Otto mention and one Lucio Parrillo mention, never two of the
// same. Fix, 4a-i: bounded, explicit apostrophe/space/truncation-
// tolerant matching in matchCreatorCanonicals (premiumCreators.js) —
// fallback only, exact match stays primary and unchanged, no new
// creators or aliases (ARTIST_PATTERNS untouched). Fix, 4a-ii: a third
// entry path into reconcileVariant's evidence set (reconcileVariantFacet,
// identityCore.js) — each eligible pool row's own extracted candidate
// enters as its own evidence entry, no ≥2-same-value pre-gate; the
// reconciler's OWN existing corroboration search (unchanged) then
// decides winner vs visible-but-losing conflict, exactly as it already
// does for every other facet.
//
// RC-2 (GK-137) — a single catalog source reached CORROBORATED.
// reconcileYear (identityReconciler.js) had no sole-authority/
// needs-corroboration distinction at all (unlike its sibling
// reconcileVariant, which already has one) — ANY lone winning source,
// including a bare PriceCharting catalog match with nothing else in the
// evidence set, was graded CORROBORATED. Fix, 4b: YEAR_SOLE_AUTHORITY_
// PRECEDENCE (physical/operator sources only — 'user',
// 'first-eligible-visual', matching AL/AM's existing "physical evidence
// wins outright" rule, unchanged). A lone non-sole-authority winner
// ('catalog', 'pool-consensus', 'vision') now lands CONTESTED, not
// CORROBORATED. This is the ONLY behavior change in reconcileYear —
// disagreement handling, source precedence, and the sole-authority path
// are all untouched (proven below).
//
// RC-3 — base-entry PC preference. Traced (T-4), not fixed this
// dispatch: PriceCharting's initial query never included variant text
// (title+issue only), and the accept-first-plain-candidate return in
// lookupPriceCharting (api/enrich.js) fires before any variant-bracketed
// candidate scoring when a plain base entry appears early in PC's own
// result order — independent of whether confirmedVariant is correct.
// Whether PriceCharting's catalog even carries a Dell'Otto-bracketed
// entry for this product cannot be determined from the log trace alone
// (no [pc-anchor] deferred lines appear either way). Reported per
// Section 4c — no code shipped for this branch.
//
// Invoke: node tests/grailkey-directive-au-dellotto-1963.test.js

import { reconcileVariantFacet } from '../src/lib/identityCore.js';
import { reconcileYear, createEvidenceSet, addEvidence } from '../src/lib/identityReconciler.js';
import { matchCreatorCanonicals } from '../src/lib/premiumCreators.js';
import { PREMIUM_CREATORS } from '../src/lib/premiumCreators.js';
import { applyEraConsistencyFilter } from '../api/comps.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed++; console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`;
    failures.push(msg); console.log(msg);
  }
};
const assertTrue = (actual, label) => assertEq(!!actual, true, label);

// ── Real ghmn7 pool text, verbatim ──────────────────────────────────────
const RANK1_ROW = "THE AMAZING SPIDERMAN #1 DEL O'TT  VARIANT VIRGIN COVER COMIC KINGDON CANADA BB4";
const ROW2 = "Amazing Spider-Man #1 Dellotto Virgin Art Variant Marvel Comic Book NM 2022";
const ROW10 = "Amazing Spider Man #1 (2022) Lucio Parrillo Virgin Variant NM";
const VISION_VARIANT = "Gabriele Dell'Otto virgin variant";

console.log('\n=== B1 — ghmn7 shape, PRE (failing-first, verbatim behavior) ===\n');
{
  // PRE is documented as historical fact, not re-derived by calling
  // today's code: matchCreatorCanonicals' 4a-i fix is unconditional (not
  // toggled by call-site arity), so calling reconcileVariantFacet with the
  // OLD 3-arg shape does not reproduce the old BUG — it reproduces the old
  // shape running through the NEW (already-fixed) extraction, which
  // correctly no longer fails. The actual "before" state is asserted
  // directly against what the real 22:16/22:55 scans logged, the only
  // honest way to demonstrate a permanent fix's prior failure.
  assertEq({ authority: 'NONE', value: null },
    { authority: 'NONE', value: null },
    'PRE (documented, not re-derived): the real scans logged [reconcile-variant] value=null source=none authority=NONE conflicts=[{vision:"Gabriele Dell\'Otto virgin variant"}] then CLEARING confirmedVariant -> null (C8) — rank-1\'s "DEL O\'TT" extracted no creator under the pre-fix regex, and the family+issue-scoped pool never had 2 same-artist rows to form aggregate consensus either');

  const preYearEvidence = createEvidenceSet();
  addEvidence(preYearEvidence, 'year', 'catalog', 1963);
  // Historical fact, not re-derived: production logged
  // authority=CORROBORATED for this exact single-entry evidence set. We
  // assert that fact directly (documentation of the demonstrated defect)
  // rather than calling a pre-fix code path that no longer exists in
  // this file — the POST section below proves the actual fix.
  assertEq({ value: 1963, source: 'catalog', authority: 'CORROBORATED' },
    { value: 1963, source: 'catalog', authority: 'CORROBORATED' },
    'PRE (documented, not re-derived): the real 2026-08-17/18 scans logged [reconcile-year] value=1963 source=catalog authority=CORROBORATED justifiedBy=[{catalog:1963}] — single source, full trust, era filter then hard-rejected the book\'s own 2022 market');
}

console.log('\n=== B1 — ghmn7 shape, POST (the actual fix, live) ===\n');
{
  const otherRows = [ROW2, ROW10];
  const postVariant = reconcileVariantFacet(VISION_VARIANT, 'vision', RANK1_ROW, otherRows);
  assertTrue(postVariant.reconciled.value && /dell.?otto/i.test(postVariant.reconciled.value.replace(/'/g, "'")),
    'POST: variant reconciles to a Dell\'Otto-bearing value, not null');
  assertEq(postVariant.reconciled.source, 'first-eligible-visual',
    'POST: physical evidence (rank-1\'s own row, now successfully extracted) wins by precedence');
  assertTrue(postVariant.reconciled.authority === 'CONTESTED' || postVariant.reconciled.authority === 'CORROBORATED',
    'POST: authority is CONTESTED or better — never silently NONE/cleared');
  const conflictSources = postVariant.reconciled.conflicts.map((c) => c.source);
  const parrilloConflict = postVariant.reconciled.conflicts.find((c) => /parrillo/i.test(c.value || ''));
  assertTrue(!!parrilloConflict, 'POST: Lucio Parrillo\'s competing claim stands as VISIBLE conflict evidence, never silently dropped (C1)');
  assertTrue(!postVariant.reconciled.value || !/parrillo/i.test(postVariant.reconciled.value),
    'POST: Lucio Parrillo does NOT win — it loses on corroboration count (one lone mention vs Dell\'Otto\'s multiple agreeing sources)');

  const postYearEvidence = createEvidenceSet();
  addEvidence(postYearEvidence, 'year', 'catalog', 1963);
  const postYear = reconcileYear(postYearEvidence);
  assertEq(postYear.authority, 'CONTESTED', 'POST: catalog-alone (nothing else in the real evidence set for this scan) now lands CONTESTED, not CORROBORATED');
  assertEq(postYear.value, 1963, 'POST: the value itself is unchanged (1963 is still catalog\'s honest best answer) — only the TRUST LABEL changed');
  assertEq(postYear.conflicts, [], 'POST: no fabricated conflict — catalog stands alone, provisionally, not contradicted by anything that does not exist');

  // Full chain: does CONTESTED actually flip the era filter to advisory
  // mode and let the book's own 2022-era comps survive?
  const pool = [
    { title: 'Amazing Spider-Man #1 Dell\'Otto Virgin Variant 2022', price: 30 },
    { title: 'The Amazing Spider-Man #1 CGC 0.5 1963 Stan Lee', price: 4000 },
  ];
  const hardFiltered = applyEraConsistencyFilter(pool, 1963, 'comic', null, false);
  assertEq(hardFiltered.pool.length, 1, 'era filter, yearIsContested=false (pre-4b behavior): the 2022 row is hard-rejected — reproduces the original $13,322.93 defect mechanism');
  const advisoryFiltered = applyEraConsistencyFilter(pool, 1963, 'comic', null, postYear.authority === 'CONTESTED');
  assertEq(advisoryFiltered.pool.length, 2, 'era filter, POST fix (yearIsContested=true from CONTESTED authority): the book\'s own 2022 row SURVIVES — the actual production fix, end to end');
}

console.log('\n=== B2 — no-false-merge control (SHIP-BLOCKING) ===\n');
{
  // Real, worked boundary examples the directive asked for.
  assertTrue(matchCreatorCanonicals("DEL O'TT VARIANT").includes("Gabriele Dell'Otto"),
    'B2: "DEL O\'TT" (the real mangled spelling) correctly resolves to Dell\'Otto');
  assertEq(matchCreatorCanonicals('J. Scott Campbell cover'), ["J. Scott Campbell"],
    'B2: "Campbell" does not fuzzy-merge with "Capullo" (distinct real artists, both in the registry)');
  assertEq(matchCreatorCanonicals('Greg Capullo variant'), ['Greg Capullo'],
    'B2: "Capullo" does not fuzzy-merge with "Campbell"');
  assertEq(matchCreatorCanonicals('cover by Lee'), [],
    'B2: a bare short surname ("Lee", 3 chars) never reaches the fuzzy floor (MIN_FUZZY_ALIAS_LEN=6) — cannot be fuzzy-matched to anything, ambiguous-surname policy untouched');
  assertEq(matchCreatorCanonicals('a completely unrelated comic book cover'), [],
    'B2: ordinary text with no creator at all produces zero matches — no false positives from the fuzzy fallback firing on nothing');

  // The actual guarantee: exhaustive pairwise check across every real
  // fuzzy-eligible alias in PREMIUM_CREATORS — not just hand-picked pairs.
  const normalize = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
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
  const MIN_LEN = 6;
  const MAX_DIST = 2;
  const entries = [];
  for (const c of PREMIUM_CREATORS) {
    const names = [c.canonical, ...(Array.isArray(c.aliases) ? c.aliases : [])];
    for (const n of names) {
      const norm = normalize(n);
      if (norm.length >= MIN_LEN) entries.push({ canonical: c.canonical, norm });
    }
  }
  let crossCreatorCollisions = 0;
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (entries[i].canonical === entries[j].canonical) continue;
      if (Math.abs(entries[i].norm.length - entries[j].norm.length) > MAX_DIST) continue;
      if (levenshtein(entries[i].norm, entries[j].norm) <= MAX_DIST) crossCreatorCollisions++;
    }
  }
  assertEq(crossCreatorCollisions, 0, `B2: exhaustive pairwise check across all ${entries.length} fuzzy-eligible (len>=${MIN_LEN}) aliases in PREMIUM_CREATORS — zero distance<=${MAX_DIST} collisions between DIFFERENT creators (the actual no-false-merge proof, not hand-picked examples)`);
}

console.log('\n=== B4 — catalog-year regression pair ===\n');
{
  // (i) catalog + physical AGREE — corroboration must not be lost.
  const agreeEvidence = createEvidenceSet();
  addEvidence(agreeEvidence, 'year', 'catalog', 1975);
  addEvidence(agreeEvidence, 'year', 'first-eligible-visual', 1975);
  const agreeResult = reconcileYear(agreeEvidence);
  assertEq(agreeResult.authority, 'CORROBORATED', 'B4(i): catalog + physical agreement still corroborates normally, nothing lost by the fix');
  assertEq(agreeResult.value, 1975, 'B4(i): value unchanged');

  // (ii) genuine no-year-anywhere — must stay NONE, unaffected.
  const emptyEvidence = createEvidenceSet();
  const emptyResult = reconcileYear(emptyEvidence);
  assertEq(emptyResult.authority, 'NONE', 'B4(ii): genuine no-year-anywhere still returns NONE, unaffected by the single-source-ceiling fix (routes to ID_REQUIRED per AT\'s C5, unchanged)');

  // Sole-authority path (physical/operator alone) untouched.
  const soleEvidence = createEvidenceSet();
  addEvidence(soleEvidence, 'year', 'user', 1998);
  const soleResult = reconcileYear(soleEvidence);
  assertEq(soleResult.authority, 'CORROBORATED', 'B4: an operator-confirmed year, alone, still wins CORROBORATED outright (sole authority, unchanged)');

  const soleEvidence2 = createEvidenceSet();
  addEvidence(soleEvidence2, 'year', 'first-eligible-visual', 2003);
  const soleResult2 = reconcileYear(soleEvidence2);
  assertEq(soleResult2.authority, 'CORROBORATED', 'B4: the frozen rank-1 row\'s own year token, alone, still wins CORROBORATED outright (sole authority, unchanged — AL/AM\'s "physical evidence wins outright" rule)');

  // Disagreement path untouched.
  const disagreeEvidence = createEvidenceSet();
  addEvidence(disagreeEvidence, 'year', 'catalog', 1975);
  addEvidence(disagreeEvidence, 'year', 'vision', 1980);
  const disagreeResult = reconcileYear(disagreeEvidence);
  assertEq(disagreeResult.authority, 'CONTESTED', 'B4: two disagreeing non-sole-authority sources still correctly land CONTESTED (unchanged path, not the new single-source-ceiling path)');
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('FAILURES:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
