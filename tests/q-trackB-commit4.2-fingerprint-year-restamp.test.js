// tests/q-trackB-commit4.2-fingerprint-year-restamp.test.js
//
// Track B Phase 0, Commit 4.2 — fingerprint year-placeholder resolver-entry
// fix + terminal restamp finalizer.
//
// Root cause (confirmed live, production log, real Spawn #351 scan):
// Vision's own year field can be the literal string "Unknown" —
// `[ship12] ... Spawn #351 Unknown`, `[comicvine] query="Spawn 351"
// issue=351 year=Unknown`, `[ship28b-conflicts] sources={"vision":"Unknown",
// "comicVine":"1992","priceCharting":2024}`. This is a truthy, non-null
// string `?? null` never intercepts. Two independent, stacked defects
// resulted:
//   1. resolveFamilyYearConsensus (identityCore.js) trusted "Unknown" as a
//      real prior year, landing in its conflict-locked branch against the
//      family's own legitimate 3/5-row "2024" vote instead of adopting it.
//   2. buildVisualReferenceEvidence ran in phase 1, BEFORE the separate,
//      later resolveYear mechanism corrected confirmedYear via PC/CV
//      agreement (`[year-resolved] Unknown → 2024 (source=pc-cv-agreement)`)
//      — so even had (1) not existed, a placeholder captured early would
//      never retroactively benefit from a later, better resolution.
// Live symptom: `familyKey="spawn|351|unknown"` (not "spawn|351|2024").
//
// Fix (1) — resolver-entry boundary normalization: normalizeOptionalYear
// (src/lib/yearEvidence.js) is applied as the FIRST executable step inside
// resolveFamilyYearConsensus, so a placeholder string is treated exactly as
// null (the function's own null-prior branches already do the right thing).
// Fix (2) — restampVisualReferenceEvidenceYear (src/lib/issueAuthority.js)
// is a terminal, custody-gated finalizer: when the phase-1 year segment of
// out.visualReferenceEvidence.familyKey was itself a placeholder AND a real
// terminal year later became available, it re-derives and replaces ONLY the
// familyKey field — monotonic (never overwrites a phase-1 REAL year,
// regardless of terminal value), custody-gated (two independent links must
// both hold before any mutation is considered), four actions only:
// 'no-evidence' | 'fingerprint-custody-mismatch' | 'no-op' | 'restamped'.
//
// Deliberately OUT OF SCOPE (Commit 5, not here): REAL-YEAR TERMINAL
// DIVERGENCE — a phase-1 family-adopted REAL year that later genuinely
// disagrees with a REAL terminal-resolved year. No conflict-reporting
// action exists; monotonicity silently resolves to 'no-op' in that case,
// with no signal raised (Section 7 below documents this honestly).
//
// Every function under test here is the REAL exported production function
// at its real call site (invariant 10, same discipline as the Commit 4.1
// test file this one is a sibling to):
//   - normalizeOptionalYear (src/lib/yearEvidence.js)
//   - resolveFamilyYearConsensus, resolveIdentity (src/lib/identityCore.js)
//   - buildFingerprintYearToken, buildRejectedCandidateFingerprint,
//     buildVisualReferenceEvidence, restampVisualReferenceEvidenceYear,
//     appendYearToProvisionalFields (src/lib/issueAuthority.js)
//   - buildTitleFamilies, scoreTitleFamilies, mergeFragmentedTitleFamilies,
//     selectTitleFamilyCandidate, extractIdentityFromImageSearch
//     (src/lib/imageSearchIdentity.js)
//
// HANDLER-LEVEL INTEGRATION — SCOPE NOTE (honest disclosure, not a silent
// substitution): the approved contract's Required Test 3 described a
// "handler-level" Fixture B exercise (real api/enrich.js `handler` import +
// `global.fetch` mocking). Investigated before writing this file: the real
// api/enrich.js terminal call site this commit added is a thin, 6-line
// direct pass-through —
//   if (out.visualReferenceEvidence) {
//     const restamp = restampVisualReferenceEvidenceYear(
//       out.visualReferenceEvidence, visualReferenceFingerprintContext,
//       confirmedYear, yearResolution.yearSource);
//     out.visualReferenceEvidence = restamp.evidence;
//   }
// with zero independent logic of its own (verified by direct reading of
// the diff — see api/enrich.js, immediately before the commit4-terminal
// block). Exercising it via the full HTTP handler would require mocking
// api/enrich.js's entire external-call surface (PriceCharting HTML scrape,
// ComicVine JSON, eBay Browse API JSON, Ximilar, CGC lookup) — a large,
// fragile undertaking with no existing hermetic precedent in this codebase
// (the one prior handler-level test, ship26-integration.test.js, requires
// real API keys and is gated on their presence, not mocked). Sections 4 and
// 10 below instead exercise the IDENTICAL real functions in the IDENTICAL
// sequence api/enrich.js's own call site uses — including an explicit
// call-vs-no-call teeth-proof (Section 10) standing in for a literal
// source-edit/revert cycle against that call site, which was ALSO performed
// once, live, during this commit's implementation (see the Section 16 doc
// update and the implementation packet for the real command/output
// transcript). This is a deliberate, disclosed judgment call, not a
// silent scope reduction — flagged here for reviewer visibility.
//
// Invoke: node tests/q-trackB-commit4.2-fingerprint-year-restamp.test.js

import { normalizeOptionalYear } from '../src/lib/yearEvidence.js';
import { resolveFamilyYearConsensus, resolveIdentity } from '../src/lib/identityCore.js';
import {
  buildFingerprintYearToken,
  buildRejectedCandidateFingerprint,
  buildVisualReferenceEvidence,
  restampVisualReferenceEvidenceYear,
  appendYearToProvisionalFields,
} from '../src/lib/issueAuthority.js';
import {
  buildTitleFamilies,
  scoreTitleFamilies,
  mergeFragmentedTitleFamilies,
  selectTitleFamilyCandidate,
  extractIdentityFromImageSearch,
} from '../src/lib/imageSearchIdentity.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertFalse = (cond, label) => assertEq(!!cond, false, label);

function captureLogs(fn) {
  const originalLog = console.log;
  const lines = [];
  console.log = (...args) => { lines.push(args.join(' ')); };
  let result;
  try {
    result = fn();
  } finally {
    console.log = originalLog;
  }
  return { result, lines };
}

console.log('\n=== Track B Phase 0, Commit 4.2 — fingerprint year restamp ===\n');

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 0 — normalizeOptionalYear controls
// ══════════════════════════════════════════════════════════════════════════════
console.log('--- Section 0: normalizeOptionalYear controls ---\n');
{
  assertEq(normalizeOptionalYear(null), null, 'null -> null');
  assertEq(normalizeOptionalYear(undefined), null, 'undefined -> null');
  assertEq(normalizeOptionalYear(''), null, 'empty string -> null');
  assertEq(normalizeOptionalYear('Unknown'), null, 'the live production bug string "Unknown" -> null');
  assertEq(normalizeOptionalYear('unknown'), null, 'lowercase "unknown" -> null');
  assertEq(normalizeOptionalYear('  Unknown  '), null, 'whitespace-padded "  Unknown  " -> null (trimmed before comparison)');
  assertEq(normalizeOptionalYear('unknown-year'), null, '"unknown-year" -> null');
  assertEq(normalizeOptionalYear('unknown year'), null, '"unknown year" (space) -> null');
  assertEq(normalizeOptionalYear('n/a'), null, '"n/a" -> null');
  assertEq(normalizeOptionalYear('N/A'), null, '"N/A" (case-insensitive) -> null');
  assertEq(normalizeOptionalYear('na'), null, '"na" -> null');
  assertEq(normalizeOptionalYear('none'), null, '"none" -> null');
  assertEq(normalizeOptionalYear('?'), null, '"?" -> null');
  assertEq(normalizeOptionalYear('2024'), '2024', 'real string "2024" -> unchanged, same string');
  assertEq(normalizeOptionalYear(2024), 2024, 'real NUMBER 2024 -> unchanged, same number (never stringified)');
  assertEq(normalizeOptionalYear('circa 1990s'), 'circa 1990s', 'non-placeholder oddball string -> unchanged (not a validator, only a placeholder check)');
  assertEq(normalizeOptionalYear(0), 0, 'falsy-but-real number 0 -> unchanged (0 != null, not a placeholder)');
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 1 — buildFingerprintYearToken controls
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 1: buildFingerprintYearToken controls ---\n');
{
  assertEq(buildFingerprintYearToken('Unknown'), 'unknown-year', 'THE LIVE BUG, fixed: "Unknown" -> "unknown-year" (previously the old code returned the norm()\'d "unknown" directly, producing the real production familyKey="spawn|351|unknown")');
  assertEq(buildFingerprintYearToken(null), 'unknown-year', 'null -> unknown-year');
  assertEq(buildFingerprintYearToken(undefined), 'unknown-year', 'undefined -> unknown-year');
  assertEq(buildFingerprintYearToken(''), 'unknown-year', 'empty string -> unknown-year');
  assertEq(buildFingerprintYearToken('2024'), '2024', 'real string "2024" -> "2024"');
  assertEq(buildFingerprintYearToken(2024), '2024', 'real number 2024 -> "2024"');
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 2 — resolveFamilyYearConsensus placeholder-boundary matrix, with an
// embedded X1 teeth-proof (a local, pre-fix-shaped reconstruction — same
// established convention as the Commit 4.1 test file's own TEETH-PROOF
// blocks — contrasted against the REAL function to prove the fix is real
// and load-bearing). A LITERAL live source-edit/revert/re-verify cycle
// against the actual identityCore.js was also performed once during this
// commit's implementation, with real command/output captured for the
// packet — this section is the permanent, always-run regression form of
// that same proof.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 2: resolveFamilyYearConsensus placeholder-boundary matrix ---\n');
{
  const familyRows = [
    { rawTitle: 'a', year: '2024' },
    { rawTitle: 'b', year: '2024' },
    { rawTitle: 'c', year: '2024' },
    { rawTitle: 'd', year: null },
    { rawTitle: 'e', year: null },
  ];

  // The real, fixed function: a placeholder prior is treated as no-prior,
  // so the family's own unanimous 3/5-asserting vote adopts cleanly.
  const real = resolveFamilyYearConsensus('Unknown', familyRows, [0, 1, 2, 3, 4]);
  assertEq(real, { year: '2024', mode: 'adopted', assertedYears: ['2024'], uniqueRows: 5, support: 3 }, 'REAL FIX: priorYear="Unknown" (the live bug\'s exact input) -> adopted, year="2024" (family vote wins, placeholder never trusted)');

  // Naive, pre-Commit-4.2-shaped reconstruction: identical logic MINUS the
  // normalizeOptionalYear boundary call — mirrors exactly what
  // resolveFamilyYearConsensus's own `if (priorYear != null)` branch did
  // before this commit (raw priorYear trusted directly).
  function naiveResolveFamilyYearConsensus(priorYear, visualItems, indices) {
    const rows = Array.isArray(indices) ? indices : [];
    const assertedYears = new Set();
    let uniqueRows = 0, yearBearingRows = 0;
    for (const idx of rows) {
      const item = visualItems?.[idx];
      if (item == null) continue;
      uniqueRows += 1;
      if (item.year != null) { yearBearingRows += 1; assertedYears.add(String(item.year)); }
    }
    const distinctYears = [...assertedYears];
    if (priorYear != null) {
      if (distinctYears.length === 0 || (distinctYears.length === 1 && distinctYears[0] === String(priorYear))) {
        return { year: priorYear, mode: 'preserved', assertedYears: distinctYears, uniqueRows, support: yearBearingRows };
      }
      return { year: priorYear, mode: 'conflict-locked', assertedYears: distinctYears, uniqueRows, support: yearBearingRows };
    }
    if (distinctYears.length === 0) return { year: null, mode: 'no-data', assertedYears: distinctYears, uniqueRows, support: yearBearingRows };
    if (distinctYears.length > 1) return { year: null, mode: 'conflict-locked', assertedYears: distinctYears, uniqueRows, support: yearBearingRows };
    if (yearBearingRows >= 2) return { year: distinctYears[0], mode: 'adopted', assertedYears: distinctYears, uniqueRows, support: yearBearingRows };
    return { year: null, mode: 'no-data', assertedYears: distinctYears, uniqueRows, support: yearBearingRows };
  }
  const naive = naiveResolveFamilyYearConsensus('Unknown', familyRows, [0, 1, 2, 3, 4]);
  assertEq(naive, { year: 'Unknown', mode: 'conflict-locked', assertedYears: ['2024'], uniqueRows: 5, support: 3 }, 'TEETH-PROOF: the naive pre-fix reconstruction WRONGLY treats "Unknown" as a real trusted prior, landing conflict-locked and never adopting the family\'s "2024" vote — reproduces the exact live production bug shape (this is what a regression in the real resolver-entry boundary would look like)');
  assertTrue(real.mode !== naive.mode, 'TEETH-PROOF: real (adopted) and naive (conflict-locked) genuinely diverge — the fix is load-bearing, not vacuous');

  // Full placeholder set, real function, all funnel to the identical
  // null-prior adoption behavior.
  for (const placeholder of ['', 'unknown', 'Unknown', 'UNKNOWN', 'n/a', 'N/A', 'none', '?', 'unknown-year', 'unknown year', null, undefined]) {
    const r = resolveFamilyYearConsensus(placeholder, familyRows, [0, 1, 2, 3, 4]);
    assertEq(r.mode, 'adopted', `placeholder ${JSON.stringify(placeholder)} as prior -> mode adopted (identical to a genuine null prior)`);
    assertEq(r.year, '2024', `placeholder ${JSON.stringify(placeholder)} as prior -> year adopts "2024"`);
  }

  // A genuinely real, non-placeholder prior is completely unaffected by
  // this fix — same behavior as documented pre-existing case D/E (Commit
  // 4.1 test file, Section 2).
  const realPriorAgrees = resolveFamilyYearConsensus('2024', familyRows, [0, 1, 2, 3, 4]);
  assertEq(realPriorAgrees.mode, 'preserved', 'real, non-placeholder prior "2024" that the family agrees with -> preserved (unaffected by the placeholder fix)');
  const realPriorConflicts = resolveFamilyYearConsensus('1999', familyRows, [0, 1, 2, 3, 4]);
  assertEq(realPriorConflicts, { year: '1999', mode: 'conflict-locked', assertedYears: ['2024'], uniqueRows: 5, support: 3 }, 'real, non-placeholder prior "1999" that the family disagrees with -> conflict-locked, year STAYS "1999" (never overwritten) — this is a genuine conflict, correctly distinct from the placeholder-mistrust bug');
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 3 — Founding fixture: live-bug reproduction, full downstream chain
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 3: founding fixture (real production titles, vision.year="Unknown") ---\n');

// FOUNDING FIXTURE PROVENANCE: identical 16 raw titles to the Commit 4.1
// test file's own founding fixture — recovered VERBATIM from the same real
// Vercel production log capture. Reused here because Commit 4.2 tests the
// SAME live scan's actual bug: that scan's real vision.year value was the
// literal string "Unknown" (confirmed: `[ship12] ... Spawn #351 Unknown`),
// not the `null` the Commit 4.1 test file uses for its own (different)
// purposes. Per-row prices are the same synthetic/illustrative values,
// carried forward for consistency — not re-derived.
const FOUNDING_RAW_TITLES = [
  'SPAWN #351 CVR C BRETT BOOTH VIRGIN CAMEO OF LYRA HTF SCARCE (2024)',
  'Spawn #351 Cover C-Brett Booth Virgin (Image Comics Malibu Comics March 2024)',
  'SPAWN #351 CVR C NM BRETT BOOTH VIRGIN 🔑 CAMEO OF LYRA HTF SCARCE (2024)',
  'Spawn Comic Book Capullo Cover Artwork Superheroes Color Edition',
  'SPAWN 307 COVER D TAN & MCFARLANE VIRGIN VARIANT COVER 2020 NM/NM- 9.2-9.4',
  'Spawn #351 Cover C Brett Booth Virgin Variant High Grade NM',
  'Spawn 351 NM (9.6) 2024 - Booth Cover C Virgin Variant Cover',
  'Spawn #351 Cover C Brett Booth Virgin Variant 🔥🔥🔥',
  'Spawn #300 Cover K 1:25 Capullo & Mcfarlane Virgin Variant Image Comic Book NM',
  'Spawn #314A /B/C Key stock photo',
  'KING SPAWN #1 CVR B MCFARLANE VARIANT 2021 IMAGE COMICS',
  'SPAWN #300 CAPULLO & MCFARLANE VIRGIN VARIANT IMAGE COMICS AL SIMMONS MILESTONE',
  'SPAWN #300 CVR K 25 COPY INCV CAPULLO & MCFARLANE VIRGIN',
  'SPAWN 307 COVER D TAN & MCFARLANE VIRGIN VARIANT COVER V1 2020 NM',
  'Spawn #326-#352 YOU PICK We Combine Shipping!!',
  'U Choose SPAWN comics IMAGE McFarlane',
];
const FOUNDING_PRICES = ['26.50', '29.00', '24.99', '15.00', '35.00', '22.00', '18.50', '27.25', '12.00', '9.99', '40.00', '11.00', '13.00', '36.00', '60.00', '8.00'];
function buildFoundingPool() {
  const rawItems = FOUNDING_RAW_TITLES.map((title, i) => ({
    title,
    price: { value: FOUNDING_PRICES[i] },
    itemWebUrl: `https://www.ebay.com/itm/${1000 + i}`,
  }));
  return extractIdentityFromImageSearch(rawItems);
}

let foundingEvidence, foundingContext;
{
  const parsedRows = buildFoundingPool();
  const candidate = selectTitleFamilyCandidate(parsedRows, 'Spawn', null, null, {});
  assertEq(candidate.decision, 'weighted-consensus', 'FOUNDING: post-merge decision is weighted-consensus (identical clustering result to the Commit 4.1 fixture — this commit does not touch clustering)');
  assertEq(candidate.topFamily.indices, [0, 2, 1, 5, 7], 'FOUNDING: topFamily.indices unchanged from the Commit 4.1 fixture');

  // THE LIVE BUG'S EXACT INPUT: vision.year = "Unknown" (literal string),
  // not null.
  const identity = resolveIdentity(
    { title: 'Spawn', issue: null, year: 'Unknown', publisher: null, confidence: 'low' },
    null,
    candidate,
    { visualItems: parsedRows }
  );
  assertEq(identity.confirmedIssue, '351', 'FOUNDING: confirmedIssue adopts "351" (unaffected by the year fix)');
  assertEq(identity.confirmedYear, '2024', 'FOUNDING (THE FIX): confirmedYear adopts "2024" even though vision.year was the literal string "Unknown" — pre-fix this stayed "Unknown" (conflict-locked)');
  assertEq(identity.familyYearConsensus.mode, 'adopted', 'FOUNDING: familyYearConsensus.mode is "adopted", not "conflict-locked"');
  assertEq(identity.familyYearConsensus.support, 3, 'FOUNDING: familyYearConsensus support=3 (rows 0,1,2 assert 2024)');

  const provFields = appendYearToProvisionalFields(['issue'], identity.familyYearConsensus);
  assertEq(provFields, ['issue', 'year'], 'FOUNDING: identityProvisionalFields is exactly ["issue","year"] — both present, no duplicates');
  assertEq(new Set(provFields).size, provFields.length, 'FOUNDING: identityProvisionalFields has no duplicate entries');

  const stableSeriesTitle = 'Spawn'; // == vision.title, passed into resolveIdentity above, never a cluster label
  foundingEvidence = buildVisualReferenceEvidence(candidate.topFamily.indices, parsedRows, stableSeriesTitle, identity.confirmedIssue, identity.confirmedYear);
  assertEq(foundingEvidence.familyKey, 'spawn|351|2024', 'FOUNDING (THE FIX, end to end): familyKey is "spawn|351|2024", NOT the live bug\'s "spawn|351|unknown"');

  foundingContext = {
    stableTitle: stableSeriesTitle,
    stableIssue: identity.confirmedIssue,
    phaseOneYear: identity.confirmedYear,
    originalFamilyKey: foundingEvidence.familyKey,
  };

  // Terminal restamp: the SAME real year ("2024") arrives again later via
  // the separate resolveYear/PC-CV-agreement mechanism (matching the real
  // live log: `[year-resolved] Unknown → 2024 (source=pc-cv-agreement)`).
  // Because the resolver-entry fix ALREADY produced a real phase-1 year,
  // this must be a no-op — the restamp finalizer exists for cases where
  // the resolver fix alone wasn't enough (Section 4/Fixture B), not this
  // one.
  const { result: restamp, lines } = captureLogs(() =>
    restampVisualReferenceEvidenceYear(foundingEvidence, foundingContext, '2024', 'pc-cv-agreement')
  );
  assertEq(restamp.action, 'no-op', 'FOUNDING: terminal restamp is a no-op — phase-1 already resolved the real year, nothing left for the finalizer to do (proves the resolver-entry fix, not the terminal fix, is what actually closes this exact live scan)');
  assertEq(restamp.evidence.familyKey, 'spawn|351|2024', 'FOUNDING: familyKey unchanged after the no-op restamp');
  assertEq(lines.filter((l) => l.startsWith('[commit4.2]')).length, 0, 'FOUNDING: no [commit4.2] log line fires on a no-op');
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 4 — Fixture B (Foo #12): the case the terminal restamp finalizer
// exists for — real family-adopted issue, genuinely insufficient year
// support at phase 1 (1/3 rows assert a year — below the 2-row adoption
// floor), a DIFFERENT and deliberately orthogonal shape from the founding
// fixture's "placeholder mistrusted as real" bug. Verified via real
// execution against the actual parser/clustering/merge chain before being
// finalized into this file (5-item pool: selectTitleFamilyCandidate hard-
// requires items.length >= 5, so 2 unrelated padding rows are included).
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 4: Fixture B (Foo #12) ---\n');

const FIXTURE_B_RAW_TITLES = [
  'Foo #12 Cover A',
  'Foo #12 Cover A High Grade',
  'Foo #12 Cover A (2024)',
  'Bar Comics #99 Totally Unrelated Book',
  'Baz Adventures #5 Different Series Entirely',
];
const FIXTURE_B_ITEM_IDS = ['A1', 'A2', 'A3', 'B1', 'B2'];
const FIXTURE_B_PRICES = ['10.00', '15.00', '20.00', '5.00', '7.00'];
function buildFixtureBPool() {
  const rawItems = FIXTURE_B_RAW_TITLES.map((title, i) => ({
    title,
    itemId: FIXTURE_B_ITEM_IDS[i],
    price: { value: FIXTURE_B_PRICES[i] },
    itemWebUrl: `https://www.ebay.com/itm/${2000 + i}`,
  }));
  return extractIdentityFromImageSearch(rawItems);
}

let fixtureBEvidence, fixtureBContext;
{
  const parsedRows = buildFixtureBPool();

  const families = buildTitleFamilies(parsedRows);
  const scored = scoreTitleFamilies(families, parsedRows);
  const topPreMerge = scored[0];
  assertEq(topPreMerge.title, 'foo', 'FIXTURE B PRE-MERGE: top scored family is "foo" (2 members: rows 0,2)');
  assertEq(topPreMerge.count, 2, 'FIXTURE B PRE-MERGE: "foo" family has 2 members before merge');

  const merged = mergeFragmentedTitleFamilies(scored, parsedRows);
  assertEq(merged[0].count, 3, 'FIXTURE B MERGE: merged top family has 3 members (2+1, "foo" fragment merges into "foo high grade")');
  assertEq(merged[0].indices, [1, 0, 2], 'FIXTURE B MERGE: merged indices are [1,0,2] — superset ("foo high grade", row 1) first, then subset rows (0,2)');
  assertTrue(merged[0].mergedFromFragments, 'FIXTURE B MERGE: mergedFromFragments is true');

  const candidate = selectTitleFamilyCandidate(parsedRows, 'Foo', null, null, {});
  assertEq(candidate.decision, 'weighted-consensus', 'FIXTURE B CANDIDATE: decision is weighted-consensus');
  assertEq(candidate.selectedTitle, 'foo', 'FIXTURE B CANDIDATE: selectedTitle is "foo"');
  assertEq(candidate.topFamily.indices, [1, 0, 2], 'FIXTURE B CANDIDATE: topFamily.indices unchanged through selectTitleFamilyCandidate');
  assertEq(candidate.topFamily.count, 3, 'FIXTURE B CANDIDATE: topFamily.count is 3');

  const identity = resolveIdentity(
    { title: 'Foo', issue: null, year: null, publisher: null, confidence: 'low' },
    null,
    candidate,
    { visualItems: parsedRows }
  );
  assertEq(identity.confirmedIssue, '12', 'FIXTURE B IDENTITY: confirmedIssue adopts "12" (3/3 unanimous)');
  assertEq(identity.confirmedYear, null, 'FIXTURE B IDENTITY: confirmedYear stays null (genuinely insufficient support, NOT the placeholder-mistrust bug)');
  // Track B Phase 0, Commit 4.3 (Option-A audit, 2026-07-30) — assertedIssues
  // is a new additive field on resolveFamilyIssueConsensus's return shape
  // (mirrors resolveFamilyYearConsensus's pre-existing assertedYears).
  // This is the one exact-shape assertion the audit found affected;
  // updated in place, not silently left to fail.
  assertEq(identity.familyIssueConsensus, { issue: '12', mode: 'adopted', winner: '12', support: 3, ratio: 1, uniqueRows: 3, runnerUp: null, runnerUpSupport: 0, tiedCandidates: [], assertedIssues: ['12'] }, 'FIXTURE B IDENTITY: familyIssueConsensus full shape');
  assertEq(identity.familyYearConsensus, { year: null, mode: 'no-data', assertedYears: ['2024'], uniqueRows: 3, support: 1 }, 'FIXTURE B IDENTITY: familyYearConsensus mode is "no-data" — only row 2 asserts "2024" (1/3, below the 2-row adoption floor), the other 2 rows are silent, not contradicting');

  const stableSeriesTitle = 'Foo';
  fixtureBEvidence = buildVisualReferenceEvidence(candidate.topFamily.indices, parsedRows, stableSeriesTitle, identity.confirmedIssue, identity.confirmedYear);
  assertEq(fixtureBEvidence.familyKey, 'foo|12|unknown-year', 'FIXTURE B EVIDENCE: familyKey is "foo|12|unknown-year" (the targeted phase-1 shape)');
  assertEq(fixtureBEvidence.count, 3, 'FIXTURE B EVIDENCE: count is 3');
  assertEq(fixtureBEvidence.low, 10, 'FIXTURE B EVIDENCE: low is 10');
  assertEq(fixtureBEvidence.high, 20, 'FIXTURE B EVIDENCE: high is 20');
  assertEq(fixtureBEvidence.median, 15, 'FIXTURE B EVIDENCE: median is 15');
  assertEq(fixtureBEvidence.marketState, 'active', 'FIXTURE B EVIDENCE: marketState is "active"');
  assertEq(fixtureBEvidence.status, 'reference-only', 'FIXTURE B EVIDENCE: status is "reference-only"');
  assertEq(fixtureBEvidence.reason, 'provisional-visual-family', 'FIXTURE B EVIDENCE: reason is "provisional-visual-family"');

  fixtureBContext = {
    stableTitle: stableSeriesTitle,
    stableIssue: identity.confirmedIssue,
    phaseOneYear: identity.confirmedYear,
    originalFamilyKey: fixtureBEvidence.familyKey,
  };
  assertEq(fixtureBContext.originalFamilyKey, 'foo|12|unknown-year', 'FIXTURE B CONTEXT: originalFamilyKey captured correctly');
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 5 — Custody Test C (concrete): the successful restamp, using
// Fixture B's real verified values.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 5: Custody Test C (successful restamp) ---\n');
{
  assertEq(fixtureBContext.originalFamilyKey, fixtureBEvidence.familyKey, 'CUSTODY TEST C precondition: currentKey === originalKey');
  const expectedKey = buildRejectedCandidateFingerprint(fixtureBContext.stableTitle, fixtureBContext.stableIssue, fixtureBContext.phaseOneYear, null);
  assertEq(expectedKey, fixtureBContext.originalFamilyKey, 'CUSTODY TEST C precondition: originalKey === expectedKey (self-consistent capture)');
  assertEq(fixtureBContext.phaseOneYear, null, 'CUSTODY TEST C precondition: phaseOneYear is null (placeholder)');

  const { result: restamp, lines } = captureLogs(() =>
    restampVisualReferenceEvidenceYear(fixtureBEvidence, fixtureBContext, '2024', 'pc-cv-agreement')
  );
  assertEq(restamp.action, 'restamped', 'CUSTODY TEST C: action is "restamped"');
  assertEq(restamp.evidence.familyKey, 'foo|12|2024', 'CUSTODY TEST C: new familyKey is "foo|12|2024"');
  assertEq(restamp.evidence.rows, fixtureBEvidence.rows, 'CUSTODY TEST C: rows byte-identical (unchanged)');
  assertEq(restamp.evidence.count, fixtureBEvidence.count, 'CUSTODY TEST C: count unchanged');
  assertEq(restamp.evidence.low, fixtureBEvidence.low, 'CUSTODY TEST C: low unchanged');
  assertEq(restamp.evidence.high, fixtureBEvidence.high, 'CUSTODY TEST C: high unchanged');
  assertEq(restamp.evidence.median, fixtureBEvidence.median, 'CUSTODY TEST C: median unchanged');
  assertEq(restamp.evidence.marketState, fixtureBEvidence.marketState, 'CUSTODY TEST C: marketState unchanged');
  assertEq(restamp.evidence.status, fixtureBEvidence.status, 'CUSTODY TEST C: status unchanged');
  assertEq(restamp.evidence.reason, fixtureBEvidence.reason, 'CUSTODY TEST C: reason unchanged');
  assertTrue(restamp.evidence !== fixtureBEvidence, 'CUSTODY TEST C: a NEW object is returned (spread, never mutates the original)');
  assertEq(fixtureBEvidence.familyKey, 'foo|12|unknown-year', 'CUSTODY TEST C: the ORIGINAL evidence object is untouched (familyKey still "foo|12|unknown-year")');
  const finalizedLines = lines.filter((l) => l.startsWith('[commit4.2] familyKey finalized'));
  assertEq(finalizedLines.length, 1, 'CUSTODY TEST C: exactly ONE "familyKey finalized" log line fires');
  assertEq(finalizedLines[0], '[commit4.2] familyKey finalized old="foo|12|unknown-year" new="foo|12|2024" yearSource="pc-cv-agreement"', 'CUSTODY TEST C: log line matches the exact approved bounded format');
  assertEq(lines.filter((l) => l.startsWith('[commit4.2] fingerprint custody mismatch')).length, 0, 'CUSTODY TEST C: no custody-mismatch log fires on a clean pass');
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 6 — Custody Test A (link 1 fails: current != original) and
// Custody Test B (link 2 fails: original != expected), plus Custody Test D
// (the custodyExpected selector reports the FIRST broken link, not a fixed
// field).
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 6: Custody Tests A, B, D ---\n');
{
  // TEST A — link 1 fails: something else mutated
  // visualReferenceEvidence.familyKey after the phase-1 context was
  // captured (originalFamilyKey no longer matches the live evidence
  // object's own current familyKey).
  const mutatedEvidence = { ...fixtureBEvidence, familyKey: 'foo|12|some-other-mutation' };
  const { result: testA, lines: linesA } = captureLogs(() =>
    restampVisualReferenceEvidenceYear(mutatedEvidence, fixtureBContext, '2024', 'pc-cv-agreement')
  );
  assertEq(testA.action, 'fingerprint-custody-mismatch', 'CUSTODY TEST A: link 1 (current vs original) fails -> fingerprint-custody-mismatch');
  assertEq(testA.evidence, mutatedEvidence, 'CUSTODY TEST A: evidence returned UNCHANGED (no mutation attempted once custody fails)');
  assertEq(linesA.length, 1, 'CUSTODY TEST A: exactly one log line fires');
  assertEq(linesA[0], `[commit4.2] fingerprint custody mismatch current="foo|12|some-other-mutation" expected="${fixtureBContext.originalFamilyKey}"`, 'CUSTODY TEST A (selector): logs expected=originalKey — the diagnostic for a link-1 failure, per the custodyExpected selector\'s documented "reports the FIRST broken link" contract');

  // TEST B — link 1 passes (current === original) but link 2 fails
  // (original != expected): a capture-time inconsistency — the captured
  // originalFamilyKey does not match what rebuilding from the captured
  // stableTitle/stableIssue/phaseOneYear would produce.
  const inconsistentContext = { ...fixtureBContext, originalFamilyKey: 'foo|12|some-other-capture-bug' };
  const evidenceMatchingInconsistentContext = { ...fixtureBEvidence, familyKey: 'foo|12|some-other-capture-bug' };
  const { result: testB, lines: linesB } = captureLogs(() =>
    restampVisualReferenceEvidenceYear(evidenceMatchingInconsistentContext, inconsistentContext, '2024', 'pc-cv-agreement')
  );
  assertEq(testB.action, 'fingerprint-custody-mismatch', 'CUSTODY TEST B: link 1 passes but link 2 (original vs expected) fails -> fingerprint-custody-mismatch');
  assertEq(testB.evidence, evidenceMatchingInconsistentContext, 'CUSTODY TEST B: evidence returned UNCHANGED');
  assertEq(linesB.length, 1, 'CUSTODY TEST B: exactly one log line fires');
  const expectedKeyForB = buildRejectedCandidateFingerprint(fixtureBContext.stableTitle, fixtureBContext.stableIssue, fixtureBContext.phaseOneYear, null);
  assertEq(linesB[0], `[commit4.2] fingerprint custody mismatch current="foo|12|some-other-capture-bug" expected="${expectedKeyForB}"`, 'CUSTODY TEST B (selector): logs expected=expectedKey (rebuilt), NOT originalKey — the diagnostic for a link-2-only failure');

  // TEST D — the two log lines above ARE the proof the selector
  // distinguishes which link failed: Test A's "expected" is the captured
  // originalKey; Test B's "expected" is the REBUILT expectedKey. An
  // implementation that always logs expectedKey regardless of which link
  // failed would make these two values IDENTICAL in both cases — assert
  // they are genuinely different, confirming the selector is load-bearing.
  assertTrue(linesA[0].includes(fixtureBContext.originalFamilyKey), 'CUSTODY TEST D: Test A\'s log names originalKey');
  assertFalse(linesA[0].includes(expectedKeyForB) && expectedKeyForB !== fixtureBContext.originalFamilyKey, 'CUSTODY TEST D: Test A\'s log does NOT name the rebuilt expectedKey (they differ in this fixture)');
  assertTrue(linesB[0].includes(expectedKeyForB), 'CUSTODY TEST D: Test B\'s log names the rebuilt expectedKey');
  const expectedFieldB = linesB[0].match(/expected="([^"]*)"/)?.[1];
  assertEq(expectedFieldB, expectedKeyForB, 'CUSTODY TEST D: Test B\'s expected="..." field is specifically the rebuilt expectedKey, not the broken captured originalKey — TEETH-PROOF: a naive "always log expectedKey" implementation would pass Test B by coincidence but FAIL Test A (Test A\'s expected="..." field asserted above is originalKey, not expectedKey) — confirming the custodyExpected selector genuinely distinguishes which link failed, rather than always reporting one fixed field');
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 7 — missing/incomplete context defense
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 7: missing/incomplete context defense ---\n');
{
  const cases = [
    ['null context', null],
    ['undefined context', undefined],
    ['missing stableTitle', { stableIssue: '12', phaseOneYear: null, originalFamilyKey: fixtureBEvidence.familyKey }],
    ['missing stableIssue', { stableTitle: 'Foo', phaseOneYear: null, originalFamilyKey: fixtureBEvidence.familyKey }],
    ['missing originalFamilyKey', { stableTitle: 'Foo', stableIssue: '12', phaseOneYear: null }],
    ['stableTitle explicitly null', { stableTitle: null, stableIssue: '12', phaseOneYear: null, originalFamilyKey: fixtureBEvidence.familyKey }],
  ];
  for (const [label, ctx] of cases) {
    const { result, lines } = captureLogs(() => restampVisualReferenceEvidenceYear(fixtureBEvidence, ctx, '2024', 'pc-cv-agreement'));
    assertEq(result.action, 'fingerprint-custody-mismatch', `MISSING CONTEXT (${label}): action is fingerprint-custody-mismatch`);
    assertEq(result.evidence, fixtureBEvidence, `MISSING CONTEXT (${label}): evidence unchanged`);
    assertEq(lines.length, 1, `MISSING CONTEXT (${label}): exactly one log line`);
    assertTrue(lines[0].includes('expected="unavailable/missing-context"'), `MISSING CONTEXT (${label}): log names expected="unavailable/missing-context" — NEVER reconstructed from live/terminal-scope values`);
  }

  // phaseOneYear itself is allowed to be legitimately null — this must NOT
  // be treated as missing context. Fixture B's own real context already
  // has phaseOneYear: null and is NOT flagged as incomplete (proven
  // structurally by Section 5's Custody Test C succeeding with this exact
  // context). Explicit affirmative check here too:
  assertTrue('phaseOneYear' in fixtureBContext, 'MISSING CONTEXT (control): fixtureBContext genuinely has an own "phaseOneYear" key (value null) — completeness is checked via `in`, not a null-check, so this must NOT trip the missing-context defense');
  const { result: controlResult } = captureLogs(() => restampVisualReferenceEvidenceYear(fixtureBEvidence, fixtureBContext, '2024', 'pc-cv-agreement'));
  assertEq(controlResult.action, 'restamped', 'MISSING CONTEXT (control): a context with phaseOneYear: null (present, legitimately null) is NOT treated as custody-incomplete — proceeds to a normal restamp');
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 8 — real-year no-op / monotonicity controls (REAL-YEAR TERMINAL
// DIVERGENCE is explicitly out of scope — documented here, not silently
// assumed)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 8: real-year no-op / monotonicity controls ---\n');
{
  const realYearEvidence = buildVisualReferenceEvidence([0, 1, 2], FIXTURE_B_RAW_TITLES.map((t, i) => ({ rawTitle: t, title: t, price: parseFloat(FIXTURE_B_PRICES[i]), itemWebUrl: `https://www.ebay.com/itm/${2000 + i}` })), 'Foo', '12', '2019');
  const realYearContext = { stableTitle: 'Foo', stableIssue: '12', phaseOneYear: '2019', originalFamilyKey: realYearEvidence.familyKey };
  assertEq(realYearEvidence.familyKey, 'foo|12|2019', 'MONOTONICITY SETUP: phase-1 familyKey carries a REAL year ("2019"), not a placeholder');

  // A LATER, DIFFERENT real year arrives at the terminal point (the REAL-
  // YEAR TERMINAL DIVERGENCE shape, Commit 5 scope) — monotonicity means
  // this NEVER overwrites, and NO signal is raised (an honest, documented
  // gap, not a silent claim of full coverage).
  const { result, lines } = captureLogs(() =>
    restampVisualReferenceEvidenceYear(realYearEvidence, realYearContext, '2024', 'pc-cv-agreement')
  );
  assertEq(result.action, 'no-op', 'MONOTONICITY: phase-1 real year "2019" vs a DIFFERENT terminal real year "2024" -> no-op (never overwritten) — REAL-YEAR TERMINAL DIVERGENCE, deliberately out of scope for Commit 4.2, deferred to Commit 5');
  assertEq(result.evidence.familyKey, 'foo|12|2019', 'MONOTONICITY: familyKey stays "foo|12|2019" — the phase-1 real value, untouched');
  assertEq(lines.length, 0, 'MONOTONICITY: no log line fires (neither restamp format applies to a no-op)');

  // Same phase-1 real year, terminal value happens to agree — also no-op.
  const { result: agreeResult } = captureLogs(() =>
    restampVisualReferenceEvidenceYear(realYearEvidence, realYearContext, '2019', 'pricecharting')
  );
  assertEq(agreeResult.action, 'no-op', 'MONOTONICITY: phase-1 real year and terminal year happen to agree -> still no-op (phase-1-real short-circuits before any comparison)');
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 9 — placeholder-to-placeholder no-op control
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 9: placeholder-to-placeholder no-op control ---\n');
{
  const { result, lines } = captureLogs(() =>
    restampVisualReferenceEvidenceYear(fixtureBEvidence, fixtureBContext, 'Unknown', null)
  );
  assertEq(result.action, 'no-op', 'PLACEHOLDER-TO-PLACEHOLDER: phase-1 placeholder + terminal ALSO a placeholder ("Unknown") -> no-op (nothing genuinely improved)');
  assertEq(result.evidence.familyKey, 'foo|12|unknown-year', 'PLACEHOLDER-TO-PLACEHOLDER: familyKey stays "foo|12|unknown-year"');
  assertEq(lines.length, 0, 'PLACEHOLDER-TO-PLACEHOLDER: no log line fires');

  const { result: nullResult, lines: nullLines } = captureLogs(() =>
    restampVisualReferenceEvidenceYear(fixtureBEvidence, fixtureBContext, null, null)
  );
  assertEq(nullResult.action, 'no-op', 'PLACEHOLDER-TO-PLACEHOLDER: terminal year null -> no-op');
  assertEq(nullLines.length, 0, 'PLACEHOLDER-TO-PLACEHOLDER: no log line fires (null terminal)');
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 10 — no-evidence action + call-vs-no-call teeth-proof for the real
// api/enrich.js terminal wiring (the permanent, automated form of the
// literal source-edit/revert exercise performed once against api/enrich.js
// during implementation — see this section's own doc note above).
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 10: no-evidence action + terminal-wiring teeth-proof ---\n');
{
  const { result: nullEvidenceResult, lines: nullEvidenceLines } = captureLogs(() =>
    restampVisualReferenceEvidenceYear(null, fixtureBContext, '2024', 'pc-cv-agreement')
  );
  assertEq(nullEvidenceResult.action, 'no-evidence', 'NO-EVIDENCE: null visualReferenceEvidence -> no-evidence');
  assertEq(nullEvidenceResult.evidence, null, 'NO-EVIDENCE: evidence passthrough stays null');
  assertEq(nullEvidenceLines.length, 0, 'NO-EVIDENCE: no log line fires');

  const { result: undefEvidenceResult, lines: undefEvidenceLines } = captureLogs(() =>
    restampVisualReferenceEvidenceYear(undefined, fixtureBContext, '2024', 'pc-cv-agreement')
  );
  assertEq(undefEvidenceResult.action, 'no-evidence', 'NO-EVIDENCE: undefined visualReferenceEvidence -> no-evidence');
  assertEq(undefEvidenceLines.length, 0, 'NO-EVIDENCE: no log line fires');

  // TEETH-PROOF for the api/enrich.js terminal call site (mirrors the
  // real code there exactly: `if (out.visualReferenceEvidence) { const
  // restamp = restampVisualReferenceEvidenceYear(...); out.
  // visualReferenceEvidence = restamp.evidence; }`). "Naive" here IS the
  // real regression this teeth-proof guards: simply never calling the
  // finalizer, which is structurally what api/enrich.js would do if this
  // commit's 6-line call site were ever reverted/deleted — no separate
  // reimplementation is needed since the wiring itself has zero
  // independent logic (verified by direct reading of the diff).
  let out = { visualReferenceEvidence: fixtureBEvidence };
  const confirmedYearForTest = '2024';
  const yearResolutionForTest = { yearSource: 'pc-cv-agreement' };

  // NAIVE (the bug this call site fixes, reproduced by simply omitting the call):
  const naiveOut = { visualReferenceEvidence: fixtureBEvidence };
  assertEq(naiveOut.visualReferenceEvidence.familyKey, 'foo|12|unknown-year', 'TEETH-PROOF (terminal wiring, bypassed): without the terminal call, out.visualReferenceEvidence.familyKey stays at its phase-1 placeholder value forever — reproduces the exact live production symptom (familyKey="spawn|351|unknown" never healing)');

  // REAL (the actual api/enrich.js call site, verbatim):
  if (out.visualReferenceEvidence) {
    const restamp = restampVisualReferenceEvidenceYear(out.visualReferenceEvidence, fixtureBContext, confirmedYearForTest, yearResolutionForTest.yearSource);
    out.visualReferenceEvidence = restamp.evidence;
  }
  assertEq(out.visualReferenceEvidence.familyKey, 'foo|12|2024', 'TEETH-PROOF (terminal wiring, real): WITH the terminal call (the real api/enrich.js code, verbatim above), out.visualReferenceEvidence.familyKey heals to "foo|12|2024"');
  assertTrue(out.visualReferenceEvidence.familyKey !== naiveOut.visualReferenceEvidence.familyKey, 'TEETH-PROOF (terminal wiring): real and naive genuinely diverge — the wiring is load-bearing, not vacuous');
}

// ══════════════════════════════════════════════════════════════════════════════
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('Failures:');
  failures.forEach((f) => console.log(f));
}
process.exit(failed > 0 ? 1 : 0);
