// tests/q-trackB-commit4.1-spawn-visual-family-merge.test.js
//
// Track B Phase 0, Commit 4.1 — controlled family-fragment merge +
// family-scoped year resolver + issue-scoped variant checkpoint +
// population-lineage-honest visualReferenceEvidence.
//
// Root case: scanning "Spawn #351, Cover C, Brett Booth Virgin, 2024"
// produced a correct 2-row visual-family cluster that was rejected because
// promotion requires >=3 rows, while the system retained a price aggregate
// but discarded the identity candidate and underlying reference rows
// entirely. Real execution (Condition 2 trace) proved the runner-up
// family's tokens are a strict subset of the top family's (Jaccard 0.375,
// just under the 0.4 clustering threshold) — fragmentation of ONE
// identity (Answer A), not two competing products (Answer B).
//
// Every function under test here is the REAL exported production function
// at its real call site (invariant 10):
//   - mergeFragmentedTitleFamilies, selectTitleFamilyCandidate,
//     buildTitleFamilies, scoreTitleFamilies, extractIdentityFromImageSearch
//     (src/lib/imageSearchIdentity.js)
//   - resolveFamilyYearConsensus, resolveIdentity (src/lib/identityCore.js)
//   - appendYearToProvisionalFields, buildVisualReferenceEvidence,
//     buildRejectedCandidateFingerprint (src/lib/issueAuthority.js —
//     api/enrich.js's own real call sites, verified by reading the diff)
//   - filterItemsByIssue, extractConfirmedVariant (src/lib/variantIdentity.js)
// No test-local mirror of any production logic exists anywhere in this
// file — every "naive"/"broken" implementation below is confined to its
// own teeth-proof block and exists ONLY to prove the real assertion above
// it is not vacuous.
//
// FOUNDING FIXTURE PROVENANCE: the 16 raw titles in buildFoundingPool()
// below are recovered VERBATIM from a real Vercel production log capture
// (tool-results/mcp-plugin_vercel_vercel-get_runtime_logs-1785377179310.txt,
// lines 405-422 — the `[visual] titles:` dump for this exact scan, itself
// following a `[phase1] identity determination: Vision="Spawn" #null` line
// at 344 and `[extractIdentity] processing 16 items` at 346 in the same
// request). Per-row PRICES are NOT recovered from that capture (only
// items[0]'s full price was logged pre-instrumentation, $26.50). The other
// 15 prices below are therefore synthetic/illustrative, clearly distinct
// from the verbatim-recovered title text, chosen only to exercise
// low/high/median math with a non-degenerate distribution.
//
// INSTRUMENTATION (review round, item 3): the permanent instrumentation
// this commit ships is a per-request, family-SCOPED log
// (`[family-evidence] decision=... merged=... rows=[...]`, emitted by
// selectTitleFamilyCandidate itself, imageSearchIdentity.js, only at the
// two decisions where a family is genuinely selected) — not a whole-pool
// dump on every request. It logs itemId/legacyItemId/title/price for only
// the accepted family's own member rows, which is what makes the
// idx2-style itemId proof possible on the first live scan post-deploy.
// This is a side-effecting console.log with no exported entry point of
// its own, so it is not separately unit-tested here — its correctness is
// exercised structurally (it fires exactly when a decision that reaches
// this test's own assertions fires) and verified by direct execution
// during implementation (visible in this file's own stdout when run).
//
// Invoke: node tests/q-trackB-commit4.1-spawn-visual-family-merge.test.js

import {
  mergeFragmentedTitleFamilies,
  selectTitleFamilyCandidate,
  buildTitleFamilies,
  scoreTitleFamilies,
  extractIdentityFromImageSearch,
  tokenizeTitleFamily,
  extractIssueFromTitle,
} from '../src/lib/imageSearchIdentity.js';
import { resolveFamilyYearConsensus, resolveFamilyIssueConsensus, resolveIdentity } from '../src/lib/identityCore.js';
import {
  appendYearToProvisionalFields,
  buildVisualReferenceEvidence,
  buildRejectedCandidateFingerprint,
  buildFingerprintYearToken,
  canUseExactIssuePricingCache,
  computeIssueAuthorityContractPatch,
  deriveIssueAuthorityFromAdoption,
} from '../src/lib/issueAuthority.js';
import { filterItemsByIssue, extractConfirmedVariant } from '../src/lib/variantIdentity.js';
import { extractArtist } from '../src/lib/compHygiene.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertFalse = (cond, label) => assertEq(!!cond, false, label);

console.log('\n=== Track B Phase 0, Commit 4.1 — controlled family-fragment merge ===\n');

// ══════════════════════════════════════════════════════════════════════════════
// Founding fixture — real, production-recovered Spawn #351 pool
// ══════════════════════════════════════════════════════════════════════════════
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
// Synthetic, illustrative prices (see provenance note above) — non-degenerate
// so low/high/median math in buildVisualReferenceEvidence is meaningfully
// exercised. Index 0's $26.50 is the one real recovered price.
const FOUNDING_PRICES = ['26.50', '29.00', '24.99', '15.00', '35.00', '22.00', '18.50', '27.25', '12.00', '9.99', '40.00', '11.00', '13.00', '36.00', '60.00', '8.00'];

function buildFoundingPool() {
  const rawItems = FOUNDING_RAW_TITLES.map((title, i) => ({
    title,
    price: { value: FOUNDING_PRICES[i] },
    itemWebUrl: `https://www.ebay.com/itm/${1000 + i}`,
  }));
  return extractIdentityFromImageSearch(rawItems);
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 1 — founding fixture: full downstream chain, end to end
// ══════════════════════════════════════════════════════════════════════════════
console.log('--- Section 1: founding fixture (real production titles), full chain ---\n');
{
  const parsedRows = buildFoundingPool();

  const families = buildTitleFamilies(parsedRows);
  const scoredRaw = scoreTitleFamilies(families, parsedRows);
  const topFamilyPreMerge = scoredRaw[0];
  assertEq(topFamilyPreMerge.count, 2, 'PRE-MERGE: top family "...cameo of lyra htf scarce" has only 2 members (would be rejected — this is the exact production failure)');
  const runnerUpPreMerge = scoredRaw.find((f) => f.title === 'spawn brett booth');
  assertEq(runnerUpPreMerge.count, 3, 'PRE-MERGE: runner-up "spawn brett booth" has 3 members (independently clears the floor, but is NOT scored[0] — never promoted on its own)');
  assertTrue(runnerUpPreMerge.tokens.every((t) => topFamilyPreMerge.tokens.includes(t)), 'PRE-MERGE: runner-up tokens are a full subset of the top family tokens — Answer A (fragmentation), confirmed by direct execution');

  const merged = mergeFragmentedTitleFamilies(scoredRaw, parsedRows);
  assertEq(merged[0].count, 5, 'MERGE: merged top family has 5 members (2+3, no duplicates)');
  assertEq(merged[0].indices, [0, 2, 1, 5, 7], 'MERGE: merged indices are exactly [superset indices][subset indices] = [0,2,1,5,7] — merge-direction pin, superset first');
  assertEq(merged[0].weightSum, 14, 'MERGE: merged weightSum recomputed via the real scoreTitleFamilies = 14.0 (5+3+4+1+1 rank weights)');
  assertTrue(merged[0].tokens.includes('cameo') && merged[0].tokens.includes('scarce'), 'MERGE-DIRECTION PIN: merged family retains the token-SUPERSET (more specific) identity, not the count-larger subset');

  const candidate = selectTitleFamilyCandidate(parsedRows, 'Spawn', null, null, {});
  assertEq(candidate.decision, 'weighted-consensus', 'CANDIDATE: post-merge decision is weighted-consensus (was fallback-vision pre-merge, per real production log)');
  assertEq(candidate.topFamily.count, 5, 'CANDIDATE: topFamily.count is 5 (merge result reached selectTitleFamilyCandidate)');
  assertEq(candidate.topFamily.indices, [0, 2, 1, 5, 7], 'CANDIDATE: topFamily.indices unchanged through selectTitleFamilyCandidate');

  const identity = resolveIdentity(
    { title: 'Spawn', issue: null, year: null, publisher: null, confidence: 'low' },
    null,
    candidate,
    { visualItems: parsedRows }
  );
  assertEq(identity.confirmedIssue, '351', 'IDENTITY: confirmedIssue adopts "351" from the merged family (5/5 unanimous)');
  assertEq(identity.confirmedYear, '2024', 'IDENTITY: confirmedYear adopts "2024" from the family-scoped year resolver (3/5 asserting rows, 0 conflicts)');
  assertEq(identity.confirmedPublisher, null, 'IDENTITY: confirmedPublisher stays null — Commit 4.1 never adopts publisher from family/marketplace evidence');
  assertEq(identity.identitySource, 'title-family-weighted-consensus', 'IDENTITY: identitySource reflects the family override path');
  assertEq(identity.familyIssueConsensus.mode, 'adopted', 'IDENTITY: familyIssueConsensus.mode=adopted (Commit 4 mechanism, unmodified, now fed by the merged family)');
  assertEq(identity.familyYearConsensus.mode, 'adopted', 'IDENTITY: familyYearConsensus.mode=adopted (new Commit 4.1 mechanism)');
  assertEq(identity.familyYearConsensus.support, 3, 'IDENTITY: familyYearConsensus support=3 (rows 0,1,2 assert 2024; rows 5,7 are silent, not contradicting)');
  assertEq(identity.familyYearConsensus.uniqueRows, 5, 'IDENTITY: familyYearConsensus uniqueRows=5 (all 5 merged family rows, deduplicated)');

  const nextFields = appendYearToProvisionalFields(['issue'], identity.familyYearConsensus);
  assertEq(nextFields, ['issue', 'year'], 'PROVISIONAL FIELDS: appendYearToProvisionalFields adds "year" exactly once alongside the pre-existing "issue"');

  // Variant checkpoint — EXECUTED, not assumed. filterItemsByIssue uses the
  // broader ISSUE-SCOPED population (6 rows: the 5 merged-family rows plus
  // row 6, "Spawn 351 NM (9.6) 2024 - Booth Cover C...", which independently
  // asserts issue #351 by title match but was never part of either
  // title-family cluster).
  const issueScopedPool = filterItemsByIssue(parsedRows, identity.confirmedIssue, true);
  assertEq(issueScopedPool.length, 6, 'VARIANT CHECKPOINT: issue-scoped population is 6 rows (5 family rows + 1 issue-matched-only row) — genuinely distinct from the 5-row family population');
  const variantResult = extractConfirmedVariant(issueScopedPool, null, identity.confirmedYear, 'low');
  assertEq(variantResult, null, 'VARIANT CHECKPOINT (honest result, reason updated in review round): extractConfirmedVariant returns null. Brett Booth is now recognized (added to ARTIST_PATTERNS, review round item 2) but clears the existing >=70% majority-artist non-distinguishing threshold (5/6 pool rows); "Cover C" is a lettered-cover designation extractConfirmedVariant does not separately capture as a named variant token either way. The informally-hypothesized "Cover C Brett Booth Virgin" does NOT materialize with current code — reported as found, not encoded as fact.');

  // visualReferenceEvidence — built ONLY from the 5-row family population,
  // never the 6-row variant-scoped population above.
  //
  // FINGERPRINT INPUT — CORRECTED (review round, item 1). The first
  // shipped version of this test (and the real api/enrich.js call site it
  // mirrored) passed `identity.confirmedTitle` here — which, in the
  // family-override branch, is `sanitizeSeriesTitle(family.selectedTitle)`,
  // i.e. the visual-family CLUSTER LABEL, not the stable proposed
  // identity. Confirmed by direct execution: that produced
  // `familyKey: "spawn-brett-booth-cameo-of-lyra-scarce|351"` — cluster-
  // derived, exactly the historical bad shape this fingerprint exists to
  // avoid (see the cross-pool stability section below). The real call
  // site (`api/enrich.js`) now passes `effectiveTitle` — Vision's own
  // title, the value passed as `vision.title` into `resolveIdentity` a few
  // lines above, BEFORE any family override — never `identity.confirmedTitle`,
  // `identity.displayTitle`, or `family.selectedTitle`. This test now
  // mirrors that exactly: the literal `'Spawn'` string passed as
  // `vision.title` a few lines above, not `identity.confirmedTitle`.
  const stableSeriesTitle = 'Spawn'; // == the vision.title passed into resolveIdentity above
  const evidence = buildVisualReferenceEvidence(candidate.topFamily.indices, parsedRows, stableSeriesTitle, identity.confirmedIssue, identity.confirmedYear);
  assertTrue(evidence != null, 'EVIDENCE: visualReferenceEvidence is non-null (5 rows all carry usable title+price)');
  assertEq(evidence.count, 5, 'EVIDENCE: visualReferenceEvidence.count is 5, not 6 — population-lineage discipline (directive item 4)');
  assertEq(evidence.rows.length, 5, 'EVIDENCE: visualReferenceEvidence.rows.length is 5');
  assertFalse(evidence.rows.some((r) => r.title.includes('9.6)')), 'EVIDENCE: the 6th issue-matched-only row ("Spawn 351 NM (9.6) 2024...") is NOT present among the 5 evidence rows');
  assertEq(evidence.familyKey, 'spawn|351|2024', 'EVIDENCE (corrected, review round item 1): familyKey is "spawn|351|2024" — built from Vision\'s stable title + the adopted issue + the adopted year, NEVER the cluster label ("spawn-brett-booth-cameo-of-lyra-scarce|351", the historical bad shape)');
  assertEq(evidence.familyKey, buildRejectedCandidateFingerprint(stableSeriesTitle, identity.confirmedIssue, identity.confirmedYear, null), 'EVIDENCE: familyKey matches the real buildRejectedCandidateFingerprint call with the SAME stable-title/issue/year inputs the real call site now uses');
  assertTrue(evidence.familyKey !== buildRejectedCandidateFingerprint(identity.confirmedTitle, identity.confirmedIssue, identity.confirmedYear, null), 'EVIDENCE: familyKey is NOT what the (buggy) cluster-label input would have produced — confirms this is a genuinely different, corrected value, not coincidentally identical');
  assertEq(evidence.status, 'reference-only', 'EVIDENCE: status is reference-only (never treated as a priced/verified pool)');

  // Variant checkpoint's honest-null REASON evolved (review round item 2):
  // adding Brett Booth to ARTIST_PATTERNS (required for the positive
  // product-agreement gate) means "Brett Booth" is no longer absent from
  // the registry — extractConfirmedVariant's own artist detection now DOES
  // recognize it. The result is still null, but for a DIFFERENT, verified
  // reason: Brett Booth appears in 5/6 (83%) of the issue-scoped pool,
  // clearing the existing >=70% "majority artist, not distinguishing"
  // threshold — the standard cover artist for this book, not a special
  // variant subset indicator. This is a genuinely different, currently-
  // accurate finding, not the original registry-absence one.
  assertTrue(variantResult === null, 'VARIANT CHECKPOINT REASON UPDATED: still null, but now because Brett Booth clears the majority-artist non-distinguishing threshold (5/6 = 83%), not because the name is unrecognized');

  // Downstream order (directive item 8) — every value asserted above was
  // only computable because each prior step's real output fed the next:
  // merge (scored[0].count 2->5) -> selectTitleFamilyCandidate (decision
  // fallback-vision -> weighted-consensus) -> familyIssueConsensus.mode
  // adopted -> familyYearConsensus.mode adopted -> identityProvisionalFields
  // += year -> issue-scoped variant extraction (6-row pool, independently
  // sized from the 5-row family) -> visualReferenceEvidence (5-row family
  // pool, independently built from the SAME candidate.topFamily.indices
  // the issue/year votes used, not the 6-row variant pool). No step's
  // input could exist without the previous step's real output — this is
  // provable from the fixture alone, not asserted separately.
  assertTrue(candidate.topFamily.indices.length !== issueScopedPool.length, 'DOWNSTREAM ORDER: the two populations that flow from this one merge (5-row family evidence, 6-row variant-scoped pool) are provably distinct sizes, confirming they were built from different index sets, not accidentally aliased');
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 2 — resolveFamilyYearConsensus 5-case matrix (A-E)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 2: resolveFamilyYearConsensus 5-case matrix ---\n');
{
  // Case A: prior null + >=2 unanimous asserting rows -> adopt provisionally
  const caseA = resolveFamilyYearConsensus(null, [
    { rawTitle: 'Foo #1 (1985)', year: '1985' },
    { rawTitle: 'Foo #1 near mint', year: null },
    { rawTitle: 'Foo #1 raw (1985)', year: '1985' },
  ], [0, 1, 2]);
  assertEq(caseA, { year: '1985', mode: 'adopted', assertedYears: ['1985'], uniqueRows: 3, support: 2 }, 'CASE A: prior null + 2 unanimous asserting rows (1 silent) -> adopted, year=1985, support=2');

  // Case B: prior null + <2 rows assert -> leave null (no-data)
  const caseB = resolveFamilyYearConsensus(null, [
    { rawTitle: 'Foo #1 (1985)', year: '1985' },
    { rawTitle: 'Foo #1 raw', year: null },
  ], [0, 1]);
  assertEq(caseB, { year: null, mode: 'no-data', assertedYears: ['1985'], uniqueRows: 2, support: 1 }, 'CASE B: prior null + only 1 asserting row -> no-data, year stays null (single assertion is not enough to nominate)');

  // Case C: prior null + conflicting -> no adoption, not clean (conflict-locked)
  const caseC = resolveFamilyYearConsensus(null, [
    { rawTitle: 'Foo #1 (1985)', year: '1985' },
    { rawTitle: 'Foo #1 (1986)', year: '1986' },
  ], [0, 1]);
  assertEq(caseC.mode, 'conflict-locked', 'CASE C: prior null + 2 conflicting asserted years -> conflict-locked');
  assertEq(caseC.year, null, 'CASE C: year stays null on conflict (no clean candidate)');
  assertEq(new Set(caseC.assertedYears), new Set(['1985', '1986']), 'CASE C: both conflicting years surfaced in assertedYears');

  // Case D: prior trusted + family agrees -> preserve
  const caseD1 = resolveFamilyYearConsensus('1985', [
    { rawTitle: 'Foo #1', year: null },
    { rawTitle: 'Foo #1 (1985)', year: '1985' },
  ], [0, 1]);
  assertEq(caseD1, { year: '1985', mode: 'preserved', assertedYears: ['1985'], uniqueRows: 2, support: 1 }, 'CASE D (agrees): prior=1985 + family agrees -> preserved, year stays 1985');

  // Case D variant: prior trusted + family entirely silent -> preserve
  const caseD2 = resolveFamilyYearConsensus('1985', [
    { rawTitle: 'Foo #1', year: null },
    { rawTitle: 'Foo #1 raw', year: null },
  ], [0, 1]);
  assertEq(caseD2, { year: '1985', mode: 'preserved', assertedYears: [], uniqueRows: 2, support: 0 }, 'CASE D (silent): prior=1985 + family entirely silent -> preserved, year stays 1985 (absence is not agreement, but also never overwrites)');

  // Case E: prior trusted + family conflicts -> never overwrite
  const caseE = resolveFamilyYearConsensus('1985', [
    { rawTitle: 'Foo #1 (1990)', year: '1990' },
  ], [0]);
  assertEq(caseE, { year: '1985', mode: 'conflict-locked', assertedYears: ['1990'], uniqueRows: 1, support: 1 }, 'CASE E: prior=1985 + family asserts 1990 -> conflict-locked, year STAYS 1985 (never overwritten)');
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 3 — isolated mergeFragmentedTitleFamilies controls (hand-built
// scored/items fixtures — full control over contamination/contradiction/
// absence gates, independent of buildTitleFamilies' real clustering noise)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 3: isolated merge-gate controls ---\n');

function makeScored({ title, tokens, indices, count, weightSum }) {
  return { title, tokens, indices, count: count ?? indices.length, weightSum: weightSum ?? indices.length, topRank: Math.min(...indices), rawTitle: title, memberTokens: null };
}

{
  // Control: merge-direction pin, isolated — count-LARGER family is the
  // token-SUBSET, count-SMALLER family is the token-SUPERSET. Mirrors the
  // founding fixture's own shape but with clean, minimal tokens for a
  // standalone assertion independent of Spawn-specific clustering.
  const items = [
    { rawTitle: 'Alpha Flight #106 Wendigo NM copy', year: null },
    { rawTitle: 'Alpha Flight #106 Wendigo Backup Rare NM', year: null },
    { rawTitle: 'Alpha Flight #106 Wendigo VF copy', year: null },
    { rawTitle: 'Alpha Flight #106 Wendigo Backup Rare VF', year: null },
  ];
  const subset = makeScored({ title: 'alpha flight wendigo', tokens: ['alpha', 'flight', 'wendigo'], indices: [0, 2], weightSum: 8 });
  const superset = makeScored({ title: 'alpha flight wendigo backup rare', tokens: ['alpha', 'flight', 'wendigo', 'backup', 'rare'], indices: [1, 3], weightSum: 6 });
  const result = mergeFragmentedTitleFamilies([subset, superset], items);
  assertEq(result.length, 1, 'MERGE-DIRECTION (isolated): a clean 2-family pool merges into exactly 1 result');
  assertEq(result[0].tokens, ['alpha', 'flight', 'wendigo', 'backup', 'rare'], 'MERGE-DIRECTION (isolated): canonical identity is the token-SUPERSET ("backup rare"), even though it has FEWER indices/lower weightSum than the count-larger subset family — the pin is on tokens, not counts');
  assertEq(new Set(result[0].indices), new Set([1, 3, 0, 2]), 'MERGE-DIRECTION (isolated): all 4 indices present in the merged result, deduplicated');
}

{
  // Control: absence-is-not-agreement — a merge candidate pair where most
  // rows are silent (null) on year and exactly one asserts a value; merge
  // still proceeds because silence never counts as a contradiction, and a
  // single asserting row (no second, conflicting assertion) is not a
  // conflict either.
  const items = [
    { rawTitle: 'Bar Comics #9 Key Issue near mint', year: null },
    { rawTitle: 'Bar Comics #9 Key Issue raw copy', year: '1970' },
    { rawTitle: 'Bar Comics #9 unspecified condition', year: null },
  ];
  const famSuperset = makeScored({ title: 'bar comics key issue', tokens: ['bar', 'comics', 'key', 'issue'], indices: [0, 1], weightSum: 9 });
  const famSubset = makeScored({ title: 'bar comics', tokens: ['bar', 'comics'], indices: [2], weightSum: 1 });
  const result = mergeFragmentedTitleFamilies([famSubset, famSuperset], items);
  assertTrue(result.length === 1 && result[0].count === 3, 'ABSENCE-IS-NOT-AGREEMENT: merge fires across 3 rows where 2/3 are silent on year and 1/3 asserts (1970) — silence never blocks, and a single, uncontradicted assertion is not itself a conflict');
}

{
  // Control: issue contradiction blocks the merge
  const items = [
    { rawTitle: 'Baz #9 near mint', year: null },
    { rawTitle: 'Baz #10 raw', year: null },
  ];
  const famA = makeScored({ title: 'baz near mint', tokens: ['baz', 'near', 'mint'], indices: [0], weightSum: 5 });
  const famB = makeScored({ title: 'baz', tokens: ['baz'], indices: [1], weightSum: 4 });
  const result = mergeFragmentedTitleFamilies([famB, famA], items);
  assertEq(result.length, 2, 'ISSUE CONTRADICTION: #9 vs #10 in the combined pool blocks the merge — scored returned unchanged (2 families, not 1)');
}

{
  // Control: cover-letter contradiction blocks the merge
  const items = [
    { rawTitle: 'Qux #5 Cover B near mint', year: null },
    { rawTitle: 'Qux #5 Cover C raw', year: null },
  ];
  const famA = makeScored({ title: 'qux cover near mint', tokens: ['qux', 'cover', 'near', 'mint'], indices: [0], weightSum: 5 });
  const famB = makeScored({ title: 'qux cover', tokens: ['qux', 'cover'], indices: [1], weightSum: 4 });
  const result = mergeFragmentedTitleFamilies([famB, famA], items);
  assertEq(result.length, 2, 'COVER-LETTER CONTRADICTION: Cover B vs Cover C in the combined pool blocks the merge — scored returned unchanged');
}

{
  // Control: year contradiction (asserted, not silent) blocks the merge —
  // reuses the REAL resolveFamilyYearConsensus, not a duplicated check.
  const items = [
    { rawTitle: 'Corge #3 (1988) near mint', year: '1988' },
    { rawTitle: 'Corge #3 (1990) raw', year: '1990' },
  ];
  const famA = makeScored({ title: 'corge near mint', tokens: ['corge', 'near', 'mint'], indices: [0], weightSum: 5 });
  const famB = makeScored({ title: 'corge', tokens: ['corge'], indices: [1], weightSum: 4 });
  const result = mergeFragmentedTitleFamilies([famB, famA], items);
  assertEq(result.length, 2, 'YEAR CONTRADICTION: 1988 vs 1990 asserted years block the merge — scored returned unchanged');
}

{
  // Control: contamination (LOT_RE) blocks the merge
  const items = [
    { rawTitle: 'Grault #2 near mint', year: null },
    { rawTitle: 'Grault #2 lot of 3 comics', year: null },
  ];
  const famA = makeScored({ title: 'grault near mint', tokens: ['grault', 'near', 'mint'], indices: [0], weightSum: 5 });
  const famB = makeScored({ title: 'grault', tokens: ['grault'], indices: [1], weightSum: 4 });
  const result = mergeFragmentedTitleFamilies([famB, famA], items);
  assertEq(result.length, 2, 'CONTAMINATION (LOT_RE): "lot of 3 comics" in the combined pool blocks the merge — scored returned unchanged');
}

{
  // Control (Strange Tales #9 anti-overcorrection): two genuinely different,
  // non-subset-related families must NEVER merge just because both are
  // below the floor. Named for consistency with this campaign's Strange
  // Tales containment work — a distinct control, not a re-test of that
  // commit's own fix.
  const items = [
    { rawTitle: 'Strange Tales #9 near mint', year: null },
    { rawTitle: 'Uncanny X-Men #9 raw', year: null },
  ];
  const famA = makeScored({ title: 'strange tales near mint', tokens: ['strange', 'tales', 'near', 'mint'], indices: [0], weightSum: 5 });
  const famB = makeScored({ title: 'uncanny men raw', tokens: ['uncanny', 'men', 'raw'], indices: [1], weightSum: 4 });
  const result = mergeFragmentedTitleFamilies([famB, famA], items);
  assertEq(result.length, 2, 'ANTI-OVERCORRECTION: two below-floor families with NO token-subset relationship (Strange Tales vs Uncanny X-Men) never merge — scored returned unchanged, byte-identical to input');
  assertTrue(result[0] === famB && result[1] === famA, 'ANTI-OVERCORRECTION: the returned array holds the SAME object references as the input — confirms true no-op, not a reconstructed-but-equal copy');
}

{
  // Control: a family that already independently clears the floor (count>=3
  // on BOTH sides) is never a merge target — nothing to gain, no-op.
  const items = Array.from({ length: 6 }, (_, i) => ({ rawTitle: `Waldo #4 copy ${i}`, year: null }));
  const famA = makeScored({ title: 'waldo copy a', tokens: ['waldo', 'copy', 'a'], indices: [0, 1, 2], weightSum: 5 });
  const famB = makeScored({ title: 'waldo copy b', tokens: ['waldo', 'copy', 'b'], indices: [3, 4, 5], weightSum: 4 });
  const result = mergeFragmentedTitleFamilies([famA, famB], items);
  assertEq(result.length, 2, 'BOTH-ABOVE-FLOOR: two families that already independently clear count>=3 are never merge candidates, even if token-related — no-op');
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 4 — publisher: caution NARROWED to the merged-fragment path only
// (review round, item 3) — gated by the explicit mergedFromFragments
// marker mergeFragmentedTitleFamilies itself sets, never a global
// replacement of publisher behavior for every family-override decision.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 4: publisher caution narrowed to the merged-fragment path ---\n');
{
  const parsedRows = buildFoundingPool();
  const candidate = selectTitleFamilyCandidate(parsedRows, 'Spawn', null, null, {});
  assertTrue(candidate.topFamily?.mergedFromFragments === true, 'PUBLISHER PRECONDITION: the founding fixture\'s topFamily genuinely carries mergedFromFragments=true (this section\'s cautious-path assertions below are meaningful, not vacuous)');

  // No trusted publisher at all -> stays unresolved (null), never backfilled
  // from ebay/family evidence even though the family title itself could be
  // read as containing publisher-like phrasing in some listings.
  const identityNoPublisher = resolveIdentity(
    { title: 'Spawn', issue: null, year: null, publisher: null, confidence: 'low' },
    null, candidate, { visualItems: parsedRows }
  );
  assertEq(identityNoPublisher.confirmedPublisher, null, 'PUBLISHER (merged path, no prior): confirmedPublisher stays null — no trusted publisher existed, and family evidence is never used to backfill it');

  // Trusted publisher present -> preserved untouched, even though the merged
  // family's title carries "Image Comics"/"Malibu Comics" phrasing in one
  // of its member rows (row 1's raw title literally contains both) that a
  // second-publisher-adopting implementation could wrongly latch onto.
  const identityWithPublisher = resolveIdentity(
    { title: 'Spawn', issue: null, year: null, publisher: 'Image Comics', confidence: 'high' },
    null, candidate, { visualItems: parsedRows }
  );
  assertEq(identityWithPublisher.confirmedPublisher, 'Image Comics', 'PUBLISHER (merged path, trusted): confirmedPublisher is preserved exactly as-is — the merged-path branch never reads ebay?.publisher, so a second publisher-like phrase in a merged member row cannot overwrite it');

  // Explicit noisy-ebay-publisher control — a DIFFERENT ebay/pool consensus
  // object (distinct from the parsedRows title text) carrying an actual
  // publisher field is STILL never read on the merged path, trusted or not.
  const identityNoiseIgnored = resolveIdentity(
    { title: 'Spawn', issue: null, year: null, publisher: null, confidence: 'low' },
    { publisher: 'Malibu Comics (seller noise)' }, candidate, { visualItems: parsedRows }
  );
  assertEq(identityNoiseIgnored.confirmedPublisher, null, 'PUBLISHER (merged path, noisy ebay field present): confirmedPublisher stays null — ebay?.publisher is never read on the merged-fragment path, even when explicitly populated with noise');

  // ── ANTI-REGRESSION FIXTURE (required, review round item 3) ──
  // An ordinary, UNMERGED weighted-consensus family — all 5 rows cluster
  // into ONE family directly via buildTitleFamilies (Jaccard similarity
  // high from the start, no fragmentation), so mergeFragmentedTitleFamilies
  // is a structural no-op (only 1 family exists, already >=3 members,
  // never a merge candidate — confirmed below via mergedFromFragments
  // being genuinely absent, not just unchecked). Publisher output must be
  // BYTE-IDENTICAL to pre-Commit-4.1 behavior: `ebay?.publisher ||
  // vision.publisher`, unaffected by this dispatch's narrowing.
  const unrelatedTitles = [
    'Invincible 100 Ottley listing 0',
    'Invincible 100 Ottley listing 1',
    'Invincible 100 Ottley listing 2',
    'Invincible 100 Ottley listing 3',
    'Invincible 100 Ottley listing 4',
  ];
  const unrelatedRawItems = unrelatedTitles.map((title, i) => ({ title, price: { value: '20.00' }, itemWebUrl: `https://ebay.com/itm/inv-${i}` }));
  const unrelatedParsedRows = extractIdentityFromImageSearch(unrelatedRawItems);
  const unrelatedCandidate = selectTitleFamilyCandidate(unrelatedParsedRows, 'Invincible', '100', null, {});
  assertEq(unrelatedCandidate.decision, 'weighted-consensus', 'ANTI-REGRESSION PRECONDITION: unrelated fixture reaches weighted-consensus');
  assertEq(unrelatedCandidate.topFamily.count, 5, 'ANTI-REGRESSION PRECONDITION: all 5 rows clustered into ONE family directly (no fragmentation to merge)');
  assertFalse(unrelatedCandidate.topFamily.mergedFromFragments === true, 'ANTI-REGRESSION PRECONDITION: mergedFromFragments is genuinely NOT true on this family — confirms it never went through the merge path, so this control is testing the real unmerged branch');

  const unrelatedIdentity = resolveIdentity(
    { title: 'Invincible', issue: '100', year: null, publisher: null, confidence: 'high' },
    { publisher: 'Image Comics', title: 'invincible', issue: '100' },
    unrelatedCandidate, { visualItems: unrelatedParsedRows }
  );
  assertEq(unrelatedIdentity.confirmedPublisher, 'Image Comics', 'ANTI-REGRESSION: an unrelated, UNMERGED weighted-consensus family adopts ebay?.publisher exactly as it did before Commit 4.1 — the narrowing does not touch this path');

  const unrelatedIdentityVisionFallback = resolveIdentity(
    { title: 'Invincible', issue: '100', year: null, publisher: 'Skybound', confidence: 'high' },
    { publisher: null, title: 'invincible', issue: '100' },
    unrelatedCandidate, { visualItems: unrelatedParsedRows }
  );
  assertEq(unrelatedIdentityVisionFallback.confirmedPublisher, 'Skybound', 'ANTI-REGRESSION: with no ebay publisher, the unmerged path still falls back to vision.publisher exactly as before — the full pre-Commit-4.1 `ebay?.publisher || vision.publisher` OR-chain is byte-identical on this path');

  // TEETH-PROOF (publisher scoping, review round item 5): temporarily
  // simulate dropping the mergedFromFragments gate (i.e. apply the
  // cautious branch unconditionally, the pre-review-round Commit 4.1
  // behavior) and confirm the anti-regression fixture's assertion above
  // WOULD have failed.
  const naiveAlwaysCautious = (visionPublisher) => visionPublisher || null;
  const naiveResult = naiveAlwaysCautious(null); // unrelatedIdentity's vision.publisher was null
  assertEq(naiveResult, null, 'TEETH-PROOF: a naive "always apply merge-caution" implementation (dropping the mergedFromFragments gate) WOULD have produced null for the anti-regression fixture, not "Image Comics"');
  assertFalse(unrelatedIdentity.confirmedPublisher === null, 'TEETH-PROOF: the REAL, gated implementation does not — confirms the anti-regression assertion above is not vacuous, the mergedFromFragments gate is load-bearing');
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 5 — visualReferenceEvidence unit controls (buildVisualReferenceEvidence)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 5: buildVisualReferenceEvidence unit controls ---\n');
{
  const rows = [
    { rawTitle: 'Plugh #1 copy A', price: 10, itemWebUrl: 'u1' },
    { rawTitle: 'Plugh #1 copy B', price: 30, itemWebUrl: 'u2' },
    { rawTitle: 'Plugh #1 copy C', price: 20, itemWebUrl: 'u3' },
  ];
  const evidence = buildVisualReferenceEvidence([0, 1, 2], rows, 'Plugh', '1', '1985');
  assertEq(evidence.low, 10, 'BVRE: low=10');
  assertEq(evidence.high, 30, 'BVRE: high=30');
  assertEq(evidence.median, 20, 'BVRE: median=20 (odd count, middle value)');
  assertEq(evidence.count, 3, 'BVRE: count=3');
  assertEq(evidence.familyKey, 'plugh|1|1985', 'BVRE: familyKey includes the 5th (year) argument — "plugh|1|1985"');

  // Rows with no usable price are excluded from the price stats, but a
  // row missing a title entirely is excluded from `rows` altogether.
  const rowsWithGaps = [
    { rawTitle: 'Plugh #1 copy A', price: 10, itemWebUrl: 'u1' },
    { rawTitle: null, price: 999, itemWebUrl: 'u2' },
    { rawTitle: 'Plugh #1 copy C', price: null, itemWebUrl: 'u3' },
  ];
  const evidenceGaps = buildVisualReferenceEvidence([0, 1, 2], rowsWithGaps, 'Plugh', '1', '1985');
  assertEq(evidenceGaps.rows.length, 2, 'BVRE (gaps): the title-less row is dropped from rows entirely');
  assertEq(evidenceGaps.count, 2, 'BVRE (gaps): count reflects only title-bearing rows');
  assertEq(evidenceGaps.low, 10, 'BVRE (gaps): the price-less row is excluded from price stats, low is the one real price');
  assertEq(evidenceGaps.high, 10, 'BVRE (gaps): high equals low — only one usable price present');

  // Omitted year (4 args) -> the 'unknown-year' fallback token, never a
  // crash or a silently-misplaced argument (buildVisualReferenceEvidence
  // has no variant parameter, so a missing 5th arg only ever affects the
  // year segment, never shifts a different value into it).
  const evidenceNoYear = buildVisualReferenceEvidence([0, 1, 2], rows, 'Plugh', '1');
  assertEq(evidenceNoYear.familyKey, 'plugh|1|unknown-year', 'BVRE: omitting the 5th (year) argument falls back to "unknown-year", not a crash or misplaced value');

  // No usable rows at all -> null, never a fabricated zero-row object.
  const evidenceEmpty = buildVisualReferenceEvidence([0], [{ rawTitle: null, price: null }], 'Plugh', '1', '1985');
  assertEq(evidenceEmpty, null, 'BVRE (empty): returns null rather than a fabricated empty evidence object when nothing usable exists');

  // TEETH-PROOF (population-lineage): a naive caller that mixes the 6th
  // issue-scoped-only row into the family evidence WOULD silently broaden
  // it — proving the real founding-fixture assertion (Section 1, count=5)
  // is not vacuous.
  const foundingRows = buildFoundingPool();
  const naiveSixRowEvidence = buildVisualReferenceEvidence([0, 2, 1, 5, 7, 6], foundingRows, 'Spawn', '351', '2024');
  assertEq(naiveSixRowEvidence.count, 6, 'TEETH-PROOF: passing the naive 6-index population (mixing in row 6) DOES produce a 6-row evidence object — confirms the real call site (which passes only candidate.topFamily.indices, 5 rows) is what keeps Section 1 honest at 5, not a coincidence of the function\'s own behavior');
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 6 — appendYearToProvisionalFields unit controls + teeth-proof
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 6: appendYearToProvisionalFields unit controls ---\n');
{
  assertEq(appendYearToProvisionalFields(['issue'], { mode: 'adopted' }), ['issue', 'year'], 'AYTPF: adds year when mode=adopted');
  assertEq(appendYearToProvisionalFields(['issue', 'year'], { mode: 'adopted' }), ['issue', 'year'], 'AYTPF: does not duplicate year when already present');
  assertEq(appendYearToProvisionalFields(['issue'], { mode: 'preserved' }), ['issue'], 'AYTPF: does not add year when mode=preserved');
  assertEq(appendYearToProvisionalFields(['issue'], { mode: 'conflict-locked' }), ['issue'], 'AYTPF: does not add year when mode=conflict-locked');
  assertEq(appendYearToProvisionalFields(['issue'], null), ['issue'], 'AYTPF: null familyYearConsensus (no family override fired) is a safe no-op');
  assertEq(appendYearToProvisionalFields(['issue'], { mode: 'no-data' }), ['issue'], 'AYTPF: does not add year when mode=no-data');

  const original = ['issue'];
  const unchanged = appendYearToProvisionalFields(original, { mode: 'preserved' });
  assertTrue(unchanged === original, 'AYTPF: returns the SAME array reference when no change applies (referential no-op, mirrors escalateIssueAuthorityOnConflict\'s own convention)');

  // TEETH-PROOF: a naive "always append" implementation (the shape of bug
  // this function exists to prevent) would wrongly mark year provisional
  // even when the family vote never adopted anything.
  const naiveAlwaysAppend = (fields, _fyc) => [...fields, 'year'];
  const naiveResult = naiveAlwaysAppend(['issue'], { mode: 'preserved' });
  assertTrue(naiveResult.includes('year'), 'TEETH-PROOF: a naive always-append implementation WRONGLY marks year provisional even on mode=preserved');
  assertFalse(appendYearToProvisionalFields(['issue'], { mode: 'preserved' }).includes('year'), 'TEETH-PROOF: the REAL appendYearToProvisionalFields does not — confirms the mode-gated assertions above are not vacuous');
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 7 — teeth-proofs for the year-adoption matrix (Section 2)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 7: teeth-proofs for the year matrix ---\n');
{
  // TEETH-PROOF (Case B — minimum support): a naive "any single assertion
  // nominates" implementation would have adopted 1985 in Case B above.
  const naiveSingleAssertionAdopts = (priorYear, visualItems, indices) => {
    if (priorYear != null) return { year: priorYear, mode: 'preserved' };
    for (const idx of indices) {
      const y = visualItems[idx]?.year;
      if (y != null) return { year: y, mode: 'adopted' }; // BUG: nominates on 1 row
    }
    return { year: null, mode: 'no-data' };
  };
  const naiveCaseB = naiveSingleAssertionAdopts(null, [
    { rawTitle: 'Foo #1 (1985)', year: '1985' },
    { rawTitle: 'Foo #1 raw', year: null },
  ], [0, 1]);
  assertEq(naiveCaseB.mode, 'adopted', 'TEETH-PROOF: a naive single-assertion-nominates implementation WRONGLY adopts 1985 from just 1 asserting row');
  const realCaseB = resolveFamilyYearConsensus(null, [
    { rawTitle: 'Foo #1 (1985)', year: '1985' },
    { rawTitle: 'Foo #1 raw', year: null },
  ], [0, 1]);
  assertFalse(realCaseB.mode === 'adopted', 'TEETH-PROOF: the REAL resolveFamilyYearConsensus requires >=2 asserting rows — confirms Case B\'s assertion above is not vacuous');

  // TEETH-PROOF (Case E — trusted year overwritten): a naive "pool-wide
  // ebay?.year || vision.year" implementation (the PRE-Commit-4.1 behavior
  // this dispatch replaced) would have overwritten a trusted year with a
  // conflicting family-asserted one.
  const naivePoolWideYear = (priorYear, ebayYear, visionYear) => ebayYear || visionYear || priorYear;
  const naiveOverwrite = naivePoolWideYear('1985', '1990', null);
  assertEq(naiveOverwrite, '1990', 'TEETH-PROOF: the naive pre-Commit-4.1 pool-wide fallback (ebay?.year || vision.year) WRONGLY overwrites a trusted 1985 with a conflicting 1990');
  const realCaseE = resolveFamilyYearConsensus('1985', [{ rawTitle: 'Foo #1 (1990)', year: '1990' }], [0]);
  assertEq(realCaseE.year, '1985', 'TEETH-PROOF: the REAL resolveFamilyYearConsensus keeps 1985 — confirms Case E\'s never-overwrite assertion above is not vacuous, and is the actual replacement for the naive pool-wide fallback');
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 8 — full-result determinism (10x on the merged promotion)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 8: 10x determinism on the merged promotion ---\n');
{
  const results = [];
  for (let i = 0; i < 10; i++) {
    const parsedRows = buildFoundingPool();
    const candidate = selectTitleFamilyCandidate(parsedRows, 'Spawn', null, null, {});
    results.push(JSON.stringify({ decision: candidate.decision, indices: candidate.topFamily?.indices, count: candidate.topFamily?.count, weightSum: candidate.topFamily?.weightSum }));
  }
  const allIdentical = results.every((r) => r === results[0]);
  assertTrue(allIdentical, 'DETERMINISM: 10 independent runs of buildFoundingPool -> selectTitleFamilyCandidate on fresh row objects each time produce byte-identical results — no hidden shared-state mutation across calls');
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 9 — cross-pool fingerprint stability (review round, item 1,
// required test). Three REAL, separately-captured pools of the same
// physical Spawn #351 photo, recovered verbatim from Vercel production
// logs (tool-results/mcp-plugin_vercel_vercel-get_runtime_logs-1785376139775.txt):
// the 16-row founding pool (lines 17-... ), an 18-row pool (lines 280-298,
// [visual] titles: dump), and a 20-row pool (lines 607-627, [visual]
// titles: dump) — three genuinely different eBay reverse-image-search
// result sets for the same book. All three must produce the IDENTICAL
// fingerprint.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 9: cross-pool fingerprint stability (16/18/20-row real pools) ---\n');

const POOL_18_REAL = [
  'SPAWN #351 CVR C NM BRETT BOOTH VIRGIN 🔑 CAMEO OF LYRA HTF SCARCE (2024)',
  'SPAWN #351 CVR C BRETT BOOTH VIRGIN CAMEO OF LYRA HTF SCARCE (2024)',
  'Spawn #351 Cover C Brett Booth Virgin Variant 🔥🔥🔥',
  'Spawn #351 Cover C Brett Booth Virgin Variant High Grade NM',
  'Spawn 300 Cover L 1:50 Incentive Todd McFarlane Virgin Variant',
  'Spawn #300 - 1:50 Virgin Variant - McFarlane - Image Comics',
  'SPAWN #300 NM NEW UNREAD 1:50 TODD McFARLANE VIRGIN VARIANT Image SHE-SPAWN',
  'SPAWN 300 COVER L 1:50 INCENTIVE TODD McFARLANE VIRGIN VARIANT NM',
  'Spawn #326-#352 YOU PICK We Combine Shipping!!',
  'Spawn 351 NM (9.6) 2024 - Booth Cover C Virgin Variant Cover',
  'Spawn #351 Cover C-Brett Booth Virgin (Image Comics Malibu Comics March 2024)',
  'Spawn #300 (2019) NM-/NM (9.2-9.4) 1:50 Ratio Virgin Variant Cover!',
  'Spawn #300 1:50 McFarlane Virgin Variant Comic Book First Print',
  'Spawn # 300 Cover L Incentive Virgin Variant Todd Mcfarlane NM & HTF',
  'Spawn #300 - Incentive Todd McFarlane Virgin Variant Cover - 2019 - Image',
  'Spawn Comic Book Capullo Cover Artwork Superheroes Color Edition',
  'SPAWN 307 COVER D TAN & MCFARLANE VIRGIN VARIANT COVER 2020 NM/NM- 9.2-9.4',
  'Spawn #300 (2019) McFarlane Virgin Variant',
];

const POOL_20_REAL = [
  'Spawn #351 Cover C Brett Booth Virgin Variant High Grade NM',
  'SPAWN #351 CVR C NM BRETT BOOTH VIRGIN 🔑 CAMEO OF LYRA HTF SCARCE (2024)',
  'SPAWN #351 CVR C BRETT BOOTH VIRGIN CAMEO OF LYRA HTF SCARCE (2024)',
  'Spawn #300 - 1:50 Virgin Variant - McFarlane - Image Comics',
  'Spawn #351 Cover C Brett Booth Virgin Variant 🔥🔥🔥',
  'Spawn 351 NM (9.6) 2024 - Booth Cover C Virgin Variant Cover',
  'Spawn #326-#352 YOU PICK We Combine Shipping!!',
  'SPAWN #300 NM NEW UNREAD 1:50 TODD McFARLANE VIRGIN VARIANT Image SHE-SPAWN',
  'Spawn # 300 Cover L Incentive Virgin Variant Todd Mcfarlane NM & HTF',
  'Spawn #300 Virgin Variant ',
  'Spawn #300 1:50 McFarlane Virgin Variant Comic Book First Print',
  'SPAWN 300 COVER L 1:50 INCENTIVE TODD McFARLANE VIRGIN VARIANT NM',
  'Spawn #351 Cover C-Brett Booth Virgin (Image Comics Malibu Comics March 2024)',
  'SPAWN 300 SIGNED JEROME OPENA COA 1:50 VIRGIN VARIANT COVER TODD MCFARLANE 2019.',
  'Spawn 300 Cover L 1:50 Incentive Todd McFarlane Virgin Variant',
  'Spawn #301 9.4 Virgin Variant MCFARLANE Cover Image Comics ',
  'SPAWN #300 NM 9.4 VIRGIN VARIANT COVER SIGNED BY TODD MCFARLANE',
  'Spawn #300 - Incentive Todd McFarlane Virgin Variant Cover - 2019 - Image',
  'Spawn #307 (2020 Image Comics) Todd McFarlane ~ Philip Tan Virgin Variant D',
  'SPAWN 300 VARIANT VIRGIN CAPULLO KEY 1st app SHE SPAWN JESSICA PRIEST Image NM',
];

function runPoolForFingerprint(titles, label) {
  const rawItems = titles.map((title, i) => ({ title, price: { value: String(10 + i) }, itemWebUrl: `https://ebay.com/itm/${label}-${i}` }));
  const parsedRows = extractIdentityFromImageSearch(rawItems);
  const candidate = selectTitleFamilyCandidate(parsedRows, 'Spawn', null, null, {});
  const identity = resolveIdentity(
    { title: 'Spawn', issue: null, year: null, publisher: null, confidence: 'low' },
    null, candidate, { visualItems: parsedRows }
  );
  const evidence = candidate.topFamily ? buildVisualReferenceEvidence(candidate.topFamily.indices, parsedRows, 'Spawn', identity.confirmedIssue, identity.confirmedYear) : null;
  return {
    label,
    decision: candidate.decision,
    memberTitles: (candidate.topFamily?.indices || []).map((idx) => titles[idx]),
    confirmedIssue: identity.confirmedIssue,
    confirmedYear: identity.confirmedYear,
    clusterLabel: identity.confirmedTitle,
    oldBrokenFingerprint: buildRejectedCandidateFingerprint(identity.confirmedTitle, identity.confirmedIssue, identity.confirmedYear, null),
    newFixedFamilyKey: evidence?.familyKey,
  };
}

{
  const r16 = runPoolForFingerprint(FOUNDING_RAW_TITLES, '16-row');
  const r18 = runPoolForFingerprint(POOL_18_REAL, '18-row');
  const r20 = runPoolForFingerprint(POOL_20_REAL, '20-row');

  assertEq(r16.decision, 'weighted-consensus', 'CROSS-POOL: 16-row real pool reaches weighted-consensus');
  assertEq(r18.decision, 'weighted-consensus', 'CROSS-POOL: 18-row real pool reaches weighted-consensus');
  assertEq(r20.decision, 'weighted-consensus', 'CROSS-POOL: 20-row real pool reaches weighted-consensus');
  assertEq(r16.confirmedIssue, '351', 'CROSS-POOL: 16-row pool adopts issue 351');
  assertEq(r18.confirmedIssue, '351', 'CROSS-POOL: 18-row pool adopts issue 351');
  assertEq(r20.confirmedIssue, '351', 'CROSS-POOL: 20-row pool adopts issue 351');
  assertEq(r16.confirmedYear, '2024', 'CROSS-POOL: 16-row pool adopts year 2024');
  assertEq(r18.confirmedYear, '2024', 'CROSS-POOL: 18-row pool adopts year 2024');
  assertEq(r20.confirmedYear, '2024', 'CROSS-POOL: 20-row pool adopts year 2024');

  // No wrong-issue (#300/#307) row joins any of the three accepted families.
  [r16, r18, r20].forEach((r) => {
    assertFalse(r.memberTitles.some((t) => /#?\s*300\b/i.test(t) || /#?\s*307\b/i.test(t)), `CROSS-POOL (${r.label}): no #300/#307 row joined the accepted family (members: ${JSON.stringify(r.memberTitles)})`);
  });

  assertEq(r16.newFixedFamilyKey, 'spawn|351|2024', 'CROSS-POOL (16-row): NEW familyKey is "spawn|351|2024"');
  assertEq(r18.newFixedFamilyKey, 'spawn|351|2024', 'CROSS-POOL (18-row): NEW familyKey is "spawn|351|2024" — IDENTICAL to the 16-row pool despite a genuinely different eBay result set');
  assertEq(r20.newFixedFamilyKey, 'spawn|351|2024', 'CROSS-POOL (20-row): NEW familyKey is "spawn|351|2024" — IDENTICAL to the 16-row and 18-row pools despite a third, genuinely different eBay result set');
  assertTrue(r16.newFixedFamilyKey === r18.newFixedFamilyKey && r18.newFixedFamilyKey === r20.newFixedFamilyKey, 'CROSS-POOL: all three real pools produce the IDENTICAL fingerprint, INCLUDING year (required test, review round item 1)');

  // TEETH-PROOF (fingerprint, review round item 5) — feed the cluster
  // label as the title input (the historical bad shape) and show the
  // cross-pool identity assertion FAILS. A synthetic 4th pool (explicitly
  // NOT production-recovered — engineered, disclosed as such) shifts the
  // Q45 60%-of-members token-consensus outcome (imageSearchIdentity.js
  // ~line 1002, `threshold = memberCount * 0.6`) so the merged family's
  // OWN cluster-label text genuinely differs from pools 16/18/20, while
  // confirmedIssue still resolves to 351 via the same unanimous
  // family-scoped vote — isolating the fingerprint-input choice as the
  // only variable.
  const POOL_D_SYNTHETIC = FOUNDING_RAW_TITLES.slice();
  POOL_D_SYNTHETIC[0] = 'SPAWN #351 CVR C BRETT BOOTH VIRGIN NM (2024)'; // both members of the
  POOL_D_SYNTHETIC[2] = 'SPAWN #351 CVR C BRETT BOOTH VIRGIN NM COPY (2024)'; // 2-row superset family changed, dropping "cameo of lyra htf scarce" entirely
  const rD = runPoolForFingerprint(POOL_D_SYNTHETIC, 'D-synthetic');

  assertEq(rD.confirmedIssue, '351', 'TEETH-PROOF PRECONDITION: synthetic pool D still adopts issue 351 via the same unanimous vote (isolating title-input as the only variable)');
  assertTrue(rD.oldBrokenFingerprint !== r16.oldBrokenFingerprint, 'TEETH-PROOF: the OLD (cluster-label-derived) fingerprint approach genuinely DIFFERS between pool 16 and synthetic pool D — confirms the historical bad shape is real, not hypothetical, once pool composition shifts the Q45 consensus');
  assertEq(rD.newFixedFamilyKey, r16.newFixedFamilyKey, 'TEETH-PROOF: the REAL, FIXED fingerprint (Vision-title-derived) stays "spawn|351|2024" for synthetic pool D too — confirms the fix genuinely closes the gap the teeth-proof exposes, not just avoiding it by coincidence on the 3 real pools');
}

// Required determinism control (review round, item 1): a fixture where
// year adoption FAILS (fewer than 2 asserting rows) must deterministically
// produce the SAME literal "unknown-year" token every time, proving the
// fallback is a stable, deliberate value — not an accident of whatever
// happened to be falsy that run.
{
  const noYearFixture = [
    { rawTitle: 'Foo #12 near mint', year: null },
    { rawTitle: 'Foo #12 raw copy', year: null },
    { rawTitle: 'Foo #12 (1985) key issue', year: '1985' }, // exactly 1 asserting row — insufficient (Case B)
  ];
  const runs = [];
  for (let i = 0; i < 5; i++) {
    const yearCheck = resolveFamilyYearConsensus(null, noYearFixture, [0, 1, 2]);
    assertEq(yearCheck.mode, 'no-data', `DETERMINISM (unknown-year, run ${i}): only 1/3 rows assert a year -> mode=no-data`);
    const key = buildRejectedCandidateFingerprint('Foo', '12', yearCheck.year, null);
    runs.push(key);
  }
  assertTrue(runs.every((k) => k === 'foo|12|unknown-year'), 'DETERMINISM: 5 independent runs of the year-adoption-fails fixture all produce the IDENTICAL literal "foo|12|unknown-year" — the fallback token is itself stable, not an accident');
  assertEq(buildFingerprintYearToken(null), 'unknown-year', 'buildFingerprintYearToken(null) -> "unknown-year"');
  assertEq(buildFingerprintYearToken(undefined), 'unknown-year', 'buildFingerprintYearToken(undefined) -> "unknown-year"');
  assertEq(buildFingerprintYearToken(''), 'unknown-year', 'buildFingerprintYearToken("") -> "unknown-year"');
  assertEq(buildFingerprintYearToken('2024'), '2024', 'buildFingerprintYearToken("2024") -> "2024" (real year passes through normalized)');
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 10 — year-only containment (review round, item 2, required
// production-composition control): Vision issue trusted (no adoption —
// family issue vote reaches 'corroborated', not 'adopted'), Vision year
// null, family year adopted 2024. Issue must remain trusted (no
// issueAuthority object created), 'year' must land in
// identityProvisionalFields, and authoritative pricing/listing/cache must
// still be blocked — via identityProvisionalFields participating in the
// contract/readiness gate INDEPENDENTLY of issueAuthority.status.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 10: year-only containment (issue trusted, year provisional) ---\n');
{
  // A 5-row family that UNANIMOUSLY agrees with a prior Vision issue
  // (351) but only 3/5 rows assert a year (2024, 0 conflicts) — mirrors
  // the founding fixture's own year-support shape, but with priorIssue
  // NON-null this time so resolveFamilyIssueConsensus reaches
  // 'corroborated', not 'adopted'.
  const visualItems = [
    { rawTitle: 'Foo #351 (2024) near mint', year: '2024' },
    { rawTitle: 'Foo #351 raw copy', year: null },
    { rawTitle: 'Foo #351 (2024) high grade', year: '2024' },
    { rawTitle: 'Foo #351 VF', year: null },
    { rawTitle: 'Foo #351 (2024) key issue', year: '2024' },
  ];
  const indices = [0, 1, 2, 3, 4];

  const familyIssueConsensus = resolveFamilyIssueConsensus('351', visualItems, indices);
  assertEq(familyIssueConsensus.mode, 'corroborated', 'PRECONDITION: with a trusted prior issue (351) and unanimous family agreement, resolveFamilyIssueConsensus reaches "corroborated", NOT "adopted"');

  const familyYearConsensus = resolveFamilyYearConsensus(null, visualItems, indices);
  assertEq(familyYearConsensus.mode, 'adopted', 'PRECONDITION: with no prior year and 3/5 unanimous asserting rows, resolveFamilyYearConsensus reaches "adopted"');

  // Issue authority: deriveIssueAuthorityFromAdoption has nothing to say
  // about 'corroborated' — issueAuthority stays null, issue is trusted.
  const derived = deriveIssueAuthorityFromAdoption(familyIssueConsensus);
  assertEq(derived.issueAuthority, null, 'ISSUE REMAINS TRUSTED: deriveIssueAuthorityFromAdoption returns issueAuthority=null for mode "corroborated" — no marketplace-only-adoption authority object is created for the issue');

  // identityProvisionalFields: starts empty (issue was never provisional),
  // 'year' is added via the real appendYearToProvisionalFields.
  const identityProvisionalFields = appendYearToProvisionalFields([], familyYearConsensus);
  assertEq(identityProvisionalFields, ['year'], '"YEAR" LANDS IN identityProvisionalFields: exactly [\'year\'] — issue was never added (it was corroborated, not adopted)');

  // Exact-issue pricing cache: confirmedIssue non-null, issueAuthority
  // null (issue trusted) — WITHOUT identityProvisionalFields threaded in,
  // this would wrongly return true (cacheable). With it threaded, it
  // correctly returns false.
  const cacheEligibleWithoutFix = canUseExactIssuePricingCache('351', null);
  const cacheEligibleWithFix = canUseExactIssuePricingCache('351', null, identityProvisionalFields);
  assertEq(cacheEligibleWithoutFix, true, 'PRE-FIX BEHAVIOR (documented, not the bug itself — the 2-arg call site is a legitimate, still-supported signature for callers with no provisional-fields context): omitting identityProvisionalFields naturally returns true here, which is exactly why the real api/enrich.js call site now always threads it');
  assertEq(cacheEligibleWithFix, false, 'EXACT-ISSUE PRICING CACHE NOT AUTHORIZED: with identityProvisionalFields threaded, canUseExactIssuePricingCache correctly returns false even though issueAuthority is null (issue trusted) — the provisional YEAR alone is sufficient to block caching');

  // Contract/readiness gate: computeIssueAuthorityContractPatch must fire
  // (authoritative pricing/listing blocked) even with issueAuthority=null,
  // via the new third parameter.
  const priorOut = { price: 45.00 };
  const patchWithoutFix = computeIssueAuthorityContractPatch(null, priorOut);
  const patchWithFix = computeIssueAuthorityContractPatch(null, priorOut, identityProvisionalFields);
  assertEq(patchWithoutFix, null, 'PRE-FIX BEHAVIOR (documented): with no third argument, computeIssueAuthorityContractPatch has nothing to say about a null issueAuthority — exactly the gap this fix closes');
  assertTrue(patchWithFix != null, 'AUTHORITATIVE PRICING/LISTING BLOCKED: computeIssueAuthorityContractPatch(null, priorOut, identityProvisionalFields) returns a real patch — containment fires purely from the provisional year, independent of issueAuthority.status');
  assertEq(patchWithFix.refusedToPrice, true, 'CONTRACT PATCH: refusedToPrice=true');
  assertEq(patchWithFix.price, null, 'CONTRACT PATCH: price nulled');
  assertEq(patchWithFix.listingHardLocked, true, 'CONTRACT PATCH: listingHardLocked=true');
  assertEq(patchWithFix.pricingSource, 'refused-year-authority-provisional', 'CONTRACT PATCH: pricingSource is the NEW year-specific reason, distinct from the issue-provisional/issue-conflicted wording');
  assertEq(patchWithFix.listingHardLockReason, 'year-authority-provisional', 'CONTRACT PATCH: listingHardLockReason is the NEW year-specific reason');
  assertEq(patchWithFix.hypotheticalReferenceEstimate, 45.00, 'CONTRACT PATCH: hypotheticalReferenceEstimate preserves the pipeline-computed price, relabeled, never deleted (I13 custody)');

  // No parallel yearAuthority schema — confirm nothing of that shape exists.
  assertTrue(!('yearAuthority' in patchWithFix), 'NO PARALLEL SCHEMA: the patch carries no yearAuthority field — this reuses the existing issueAuthority-adjacent contract machinery exactly as instructed');

  // Commit 3's correction path can still confirm the year — getCorrectableFields
  // (manualCorrection.js) already unions identityMissingFields with
  // identityProvisionalFields; 'year' being in the latter is sufficient for
  // the existing union-based correction UI to offer a year correction
  // field, with zero new code required (verified by reading
  // getCorrectableFields's own union logic, manualCorrection.js — the
  // union is on identityProvisionalFields generically, not an
  // issue-specific check).

  // TEETH-PROOF (year-only containment, review round item 5): temporarily
  // route containment through issueAuthority.status alone (the pre-fix
  // 2-arg signature) and show this exact trusted-issue/adopted-year
  // control fails to block.
  assertEq(computeIssueAuthorityContractPatch(null, priorOut), null, 'TEETH-PROOF: routing containment through issueAuthority.status alone (omitting identityProvisionalFields) produces NO patch for this exact composition — confirms the control above genuinely depends on the fix, not a coincidence');
  assertEq(canUseExactIssuePricingCache('351', null), true, 'TEETH-PROOF: the same status-only routing WRONGLY authorizes the exact-issue pricing cache for this composition — confirms the cache-guard assertion above is not vacuous');

  // Combined-composition regression guard: when issue IS ALSO provisional
  // (Commit 4's original case), the patch must be byte-identical to
  // Commit 4's own shipped wording — the new third branch must never
  // change the first two.
  const bothProvisional = { status: 'provisional', reasons: ['marketplace-only-adoption'], confidence: 'high', supportRatio: 1 };
  const combinedFields = ['issue', 'year'];
  const combinedPatch = computeIssueAuthorityContractPatch(bothProvisional, priorOut, combinedFields);
  assertEq(combinedPatch.pricingSource, 'refused-issue-authority-provisional', 'REGRESSION GUARD: when issue is ALSO provisional, the ISSUE-provisional wording wins unchanged (byte-identical to Commit 4), even though "year" is also in identityProvisionalFields');
  assertEq(combinedPatch.listingHardLockReason, 'issue-authority-provisional', 'REGRESSION GUARD: listingHardLockReason likewise stays the Commit 4 issue-provisional value in the combined case');
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 11 — positive product-agreement gate (review round, item 2).
// Token containment + no-contradiction is necessary but not sufficient;
// the merge must prove the fragments describe the SAME visual product on
// cover designation, artist, and presentation/finish marker (conditional
// form: asserted-by-both-and-agrees passes; asserted-by-one-absent-from-
// other blocks; asserted-by-neither is not applicable and never blocks).
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 11: positive product-agreement gate ---\n');

// Founding fixture must pass AT THE ROW LEVEL: Spawn/351/Cover C/Brett
// Booth/Virgin asserted across BOTH fragments' rows (the merge already
// fired in Section 1 — this directly verifies the underlying per-row
// data using the real, exported extractArtist and a fixture-validation
// regex mirroring extractCoverLetter's own documented pattern, confirming
// the merge's success in Section 1 is not coincidental).
{
  const rows = buildFoundingPool();
  const supersetIndices = [0, 2]; // "...cameo of lyra htf scarce" fragment
  const subsetIndices = [1, 5, 7]; // "spawn brett booth" fragment
  const coverLetterRe = /\b(?:cover|cvr)\s*([a-z])\b/i;
  [...supersetIndices, ...subsetIndices].forEach((idx) => {
    const raw = rows[idx].rawTitle;
    assertEq(extractArtist(raw), 'brett booth', `FOUNDING ROW-LEVEL (idx ${idx}): artist asserted "brett booth"`);
    const coverMatch = raw.match(coverLetterRe);
    assertEq(coverMatch && coverMatch[1].toUpperCase(), 'C', `FOUNDING ROW-LEVEL (idx ${idx}): cover designation asserted "C"`);
    assertTrue(/\bvirgin\b/i.test(raw), `FOUNDING ROW-LEVEL (idx ${idx}): presentation "virgin" asserted`);
  });
}

function makeGateScored({ title, tokens, indices }) {
  return { title, tokens, indices, count: indices.length, weightSum: indices.length, topRank: Math.min(...indices), rawTitle: title, memberTokens: null };
}

{
  // NEGATIVE CONTROL 1: same title/issue/cover, different artist -> no merge.
  const items = [
    { rawTitle: 'Zorp #9 Cover B Artist One Exclusive', year: null },
    { rawTitle: 'Zorp #9 Cover B Artist Two Exclusive', year: null },
  ];
  const famA = makeGateScored({ title: 'zorp cover artist one exclusive', tokens: ['zorp', 'cover', 'artist', 'one', 'exclusive'], indices: [0] });
  const famB = makeGateScored({ title: 'zorp cover', tokens: ['zorp', 'cover'], indices: [1] });
  // Use extractArtist-detectable real names instead of placeholders so the
  // gate's real extractArtist call actually distinguishes them:
  items[0].rawTitle = 'Zorp #9 Cover B Momoko Exclusive';
  items[1].rawTitle = 'Zorp #9 Cover B Ross Exclusive';
  const result = mergeFragmentedTitleFamilies([famB, famA], items);
  assertEq(result.length, 2, 'NEGATIVE CONTROL 1: same title/issue/cover, DIFFERENT artist (Momoko vs Ross) -> no merge');
}

{
  // NEGATIVE CONTROL 2: same title/issue/artist, Virgin vs standard
  // presentation -> no merge.
  const items = [
    { rawTitle: 'Quix #4 Momoko Virgin Variant', year: null },
    { rawTitle: 'Quix #4 Momoko Standard Cover', year: null },
  ];
  const famA = makeGateScored({ title: 'quix momoko virgin variant', tokens: ['quix', 'momoko', 'virgin', 'variant'], indices: [0] });
  const famB = makeGateScored({ title: 'quix momoko', tokens: ['quix', 'momoko'], indices: [1] });
  const result = mergeFragmentedTitleFamilies([famB, famA], items);
  assertEq(result.length, 2, 'NEGATIVE CONTROL 2: same title/issue/artist, Virgin vs standard (no finish token) presentation -> no merge');
}

{
  // NEGATIVE CONTROL 3: artist asserted by ONE fragment, absent from the
  // ENTIRE other fragment -> no merge (absence is not positive support).
  const items = [
    { rawTitle: 'Blort #7 Momoko Cover', year: null },
    { rawTitle: 'Blort #7 Cover', year: null }, // no artist mentioned at all
  ];
  const famA = makeGateScored({ title: 'blort momoko cover', tokens: ['blort', 'momoko', 'cover'], indices: [0] });
  const famB = makeGateScored({ title: 'blort cover', tokens: ['blort', 'cover'], indices: [1] });
  const result = mergeFragmentedTitleFamilies([famB, famA], items);
  assertEq(result.length, 2, 'NEGATIVE CONTROL 3: artist asserted by one fragment (Momoko), absent from the entire other -> no merge');
}

{
  // NEGATIVE CONTROL 4: presentation asserted by ONE fragment, absent from
  // the other -> no merge.
  const items = [
    { rawTitle: 'Wrenk #2 Virgin Cover', year: null },
    { rawTitle: 'Wrenk #2 Standard Print', year: null }, // no finish token at all
  ];
  const famA = makeGateScored({ title: 'wrenk virgin cover', tokens: ['wrenk', 'virgin', 'cover'], indices: [0] });
  const famB = makeGateScored({ title: 'wrenk standard print', tokens: ['wrenk', 'standard', 'print'], indices: [1] });
  // Not token-related enough to be a subset pair normally — force the
  // subset relation directly so the ONLY thing under test is the
  // presentation gate, not token containment:
  famB.tokens = ['wrenk'];
  const result = mergeFragmentedTitleFamilies([famB, famA], items);
  assertEq(result.length, 2, 'NEGATIVE CONTROL 4: presentation ("virgin") asserted by one fragment, absent from the other -> no merge');
}

{
  // POSITIVE CONTROL: neither fragment asserts artist or presentation (a
  // plain, non-variant book) -> merge STILL proceeds on the remaining
  // gates. Without this control, the gate could silently neuter the whole
  // feature for the ordinary case.
  const items = [
    { rawTitle: 'Ordinary Comic #22 near mint copy', year: null },
    { rawTitle: 'Ordinary Comic #22 raw', year: null },
    { rawTitle: 'Ordinary Comic #22 key issue', year: null },
  ];
  const famA = makeGateScored({ title: 'ordinary comic near mint copy', tokens: ['ordinary', 'comic', 'near', 'mint', 'copy'], indices: [0] });
  const famB = makeGateScored({ title: 'ordinary comic', tokens: ['ordinary', 'comic'], indices: [1, 2] });
  const result = mergeFragmentedTitleFamilies([famA, famB], items);
  assertTrue(result.length === 1 && result[0].count === 3, 'POSITIVE CONTROL: neither fragment asserts artist or presentation (plain, non-variant book) -> merge proceeds normally on the remaining gates (issue/year/contamination), NOT APPLICABLE never blocks');
}

{
  // TEETH-PROOF (positive-agreement gate, review round item 5): weaken the
  // gate to contradiction-only (the pre-this-commit behavior — only
  // reject when BOTH fragments assert and disagree, never when one is
  // silent) and show NEGATIVE CONTROL 3's exact fixture WOULD wrongly
  // merge.
  const naiveContradictionOnlyGate = (fragAIndices, fragBIndices, extractFn, rawTitleOf) => {
    const valuesA = new Set(fragAIndices.map((i) => extractFn(rawTitleOf(i))).filter((v) => v != null));
    const valuesB = new Set(fragBIndices.map((i) => extractFn(rawTitleOf(i))).filter((v) => v != null));
    const allValues = new Set([...valuesA, ...valuesB]);
    return allValues.size <= 1; // only blocks on an actual two-different-values contradiction
  };
  const blortItems = ['Blort #7 Momoko Cover', 'Blort #7 Cover'];
  const naiveResult = naiveContradictionOnlyGate([0], [1], extractArtist, (i) => blortItems[i]);
  assertTrue(naiveResult, 'TEETH-PROOF: a naive contradiction-only gate (the pre-positive-agreement-gate shape) WRONGLY allows the merge for Negative Control 3\'s exact fixture — one fragment silent on artist is not treated as a block');
  assertEq(mergeFragmentedTitleFamilies(
    [makeGateScored({ title: 'blort cover', tokens: ['blort', 'cover'], indices: [1] }), makeGateScored({ title: 'blort momoko cover', tokens: ['blort', 'momoko', 'cover'], indices: [0] })],
    [{ rawTitle: 'Blort #7 Momoko Cover', year: null }, { rawTitle: 'Blort #7 Cover', year: null }]
  ).length, 2, 'TEETH-PROOF: the REAL positive-agreement gate correctly blocks this exact fixture — confirms Negative Control 3\'s assertion above is not vacuous, the conditional (not contradiction-only) rule is load-bearing');
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 12 — ARTIST_PATTERNS dual-responsibility decoupling regression
// controls (review round investigation: recognition vs family-clustering
// stripping). ARTIST_FAMILY_STRIP_EXCEPTIONS (compHygiene.js) is the single
// opt-out; every pre-existing pattern still strips exactly as before.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 12: ARTIST_PATTERNS strip/recognize decoupling ---\n');
{
  // Control: a strip=true (pre-existing, not excepted) artist is REMOVED
  // from family-clustering tokens — byte-identical to before this commit.
  const skottieTokens = tokenizeTitleFamily('Black Cat #1 Skottie Young Variant');
  assertFalse(skottieTokens.includes('skottie'), 'STRIP=TRUE CONTROL: "skottie" absent from family tokens (Q-BC/Black Cat behavior unchanged)');
  assertFalse(skottieTokens.includes('young'), 'STRIP=TRUE CONTROL: "young" absent from family tokens');

  // Control: the strip=false exception (Brett Booth) is DETECTED (via the
  // real extractArtist, unaffected by the exception) but PRESERVED in
  // family-clustering tokens (the actual fix).
  const boothRaw = 'Spawn #351 Cover C Brett Booth Virgin';
  assertEq(extractArtist(boothRaw), 'brett booth', 'STRIP=FALSE CONTROL: extractArtist still recognizes "brett booth" — recognition is untouched by the exception');
  const boothTokens = tokenizeTitleFamily(boothRaw);
  assertTrue(boothTokens.includes('brett') && boothTokens.includes('booth'), 'STRIP=FALSE CONTROL: "brett"/"booth" PRESERVED in family-clustering tokens — the exception only changes tokenizeTitleFamily, not recognition');
}

{
  // PIN B regression proof: the founding fixture returns to its ORIGINAL
  // 5-member merged family (not the 4-member shape briefly observed with
  // Brett Booth naively added to the strip path) — tokens revert exactly
  // once Brett Booth is excepted from stripping.
  const rows = buildFoundingPool();
  const families = buildTitleFamilies(rows);
  const scoredRaw = scoreTitleFamilies(families, rows);
  const merged = mergeFragmentedTitleFamilies(scoredRaw, rows);
  assertEq(merged[0].count, 5, 'PIN B: founding fixture merges back to its ORIGINAL 5 members (not 4) — Brett Booth recognized but no longer stripped');
  assertEq(merged[0].indices, [0, 2, 1, 5, 7], 'PIN B: founding fixture\'s merged indices are the ORIGINAL [0,2,1,5,7]');
  assertTrue(merged[0].tokens.includes('brett') && merged[0].tokens.includes('booth'), 'PIN B: merged family tokens include "brett"/"booth" again (reverted)');
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 13 — issue upgraded to MANDATORY positive per-fragment agreement
// (review round 3, item 1). Unlike cover/artist/presentation (Section 11's
// conditional gate), issue has no "not applicable" case — silence on
// either side blocks, not just a genuine conflict.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n--- Section 13: issue as mandatory per-fragment agreement ---\n');

{
  // CASE 1: both fragments assert the SAME issue -> pass (this is exactly
  // what every other passing fixture in this file already relies on —
  // isolated here as its own explicit, minimal case).
  const items = [
    { rawTitle: 'Vex #14 near mint', year: null },
    { rawTitle: 'Vex #14 raw copy', year: null },
    { rawTitle: 'Vex #14 key issue', year: null },
  ];
  const famA = makeGateScored({ title: 'vex near mint', tokens: ['vex', 'near', 'mint'], indices: [0] });
  const famB = makeGateScored({ title: 'vex', tokens: ['vex'], indices: [1, 2] });
  const result = mergeFragmentedTitleFamilies([famA, famB], items);
  assertTrue(result.length === 1 && result[0].count === 3, 'ISSUE CASE 1: both fragments assert the SAME issue (#14) -> merge proceeds');
}

{
  // CASE 2: one fragment asserts, the other is entirely silent -> block.
  const items = [
    { rawTitle: 'Yark #5 near mint', year: null }, // asserts #5
    { rawTitle: 'Yark near mint copy', year: null }, // no issue number anywhere
  ];
  const famA = makeGateScored({ title: 'yark near mint', tokens: ['yark', 'near', 'mint'], indices: [0] });
  const famB = makeGateScored({ title: 'yark near mint copy', tokens: ['yark', 'near', 'mint', 'copy'], indices: [1] });
  const result = mergeFragmentedTitleFamilies([famB, famA], items);
  assertEq(result.length, 2, 'ISSUE CASE 2: one fragment asserts #5, the other is entirely silent on issue -> no merge');
}

{
  // CASE 3: both fragments silent on issue -> block.
  const items = [
    { rawTitle: 'Plarn near mint copy', year: null },
    { rawTitle: 'Plarn raw', year: null },
  ];
  const famA = makeGateScored({ title: 'plarn near mint copy', tokens: ['plarn', 'near', 'mint', 'copy'], indices: [0] });
  const famB = makeGateScored({ title: 'plarn', tokens: ['plarn'], indices: [1] });
  const result = mergeFragmentedTitleFamilies([famB, famA], items);
  assertEq(result.length, 2, 'ISSUE CASE 3: BOTH fragments entirely silent on issue -> no merge (silence is never treated as agreement)');
}

{
  // CASE 4: both fragments assert, but DIFFERENT issues -> block (this was
  // already covered by the pre-existing "ISSUE CONTRADICTION" control in
  // Section 3 — re-asserted here explicitly as part of this section's
  // complete 5-case set).
  const items = [
    { rawTitle: 'Florb #9 near mint', year: null },
    { rawTitle: 'Florb #10 raw', year: null },
  ];
  const famA = makeGateScored({ title: 'florb near mint', tokens: ['florb', 'near', 'mint'], indices: [0] });
  const famB = makeGateScored({ title: 'florb', tokens: ['florb'], indices: [1] });
  const result = mergeFragmentedTitleFamilies([famB, famA], items);
  assertEq(result.length, 2, 'ISSUE CASE 4: both fragments assert DIFFERENT issues (#9 vs #10) -> no merge');
}

{
  // CASE 5: internal disagreement within ONE fragment (two of its own
  // member rows assert different issues) -> block.
  const items = [
    { rawTitle: 'Trundle #6 near mint', year: null },
    { rawTitle: 'Trundle #7 raw copy', year: null }, // same fragment as idx0, but disagrees internally
    { rawTitle: 'Trundle #6 key issue', year: null },
  ];
  const famA = makeGateScored({ title: 'trundle near mint', tokens: ['trundle', 'near', 'mint'], indices: [0, 1] }); // internally conflicted: #6 vs #7
  const famB = makeGateScored({ title: 'trundle', tokens: ['trundle'], indices: [2] });
  const result = mergeFragmentedTitleFamilies([famB, famA], items);
  assertEq(result.length, 2, 'ISSUE CASE 5: internal disagreement within ONE fragment (idx0=#6 vs idx1=#7, same fragment) -> no merge');
}

{
  // TEETH-PROOF: a naive combined-set reconstruction (the pre-this-item
  // shape — Set of extractIssueFromTitle over the COMBINED pool, reject
  // only when size>1) wrongly PERMITS Case 2's asserted-by-one/silent-
  // other fixture; the real mandatory gate blocks it.
  const naiveCombinedSetCheck = (indices, rawTitleOf, extractFn) => {
    const values = new Set(indices.map((i) => extractFn(rawTitleOf(i))).filter(Boolean)); // filters out nulls BEFORE checking size
    return values.size <= 1; // permits: 0 values, 1 value, but never catches "1 asserted + 1 silent"
  };
  const yarkTitles = ['Yark #5 near mint', 'Yark near mint copy'];
  const naiveResult = naiveCombinedSetCheck([0, 1], (i) => yarkTitles[i], extractIssueFromTitle);
  assertTrue(naiveResult, 'TEETH-PROOF: a naive combined-set reconstruction (pre-item-1 shape) WRONGLY permits Case 2\'s exact fixture — filtering out nulls before checking size hides the asserted-by-one/silent-other case entirely');
  const realResult = mergeFragmentedTitleFamilies(
    [makeGateScored({ title: 'yark near mint copy', tokens: ['yark', 'near', 'mint', 'copy'], indices: [1] }), makeGateScored({ title: 'yark near mint', tokens: ['yark', 'near', 'mint'], indices: [0] })],
    [{ rawTitle: 'Yark #5 near mint', year: null }, { rawTitle: 'Yark near mint copy', year: null }]
  );
  assertEq(realResult.length, 2, 'TEETH-PROOF: the REAL mandatory per-fragment gate correctly blocks this exact fixture — confirms Case 2\'s assertion above is not vacuous, the upgrade from combined-set to per-fragment checking is load-bearing');
}

{
  // Required fixtures re-verified: founding, Alpha Flight, Bar Comics, and
  // Ordinary Comic all still pass — every fragment in each of these
  // positively asserts its issue number, so the mandatory upgrade changes
  // nothing about their outcome (expected, confirmed by direct execution,
  // not assumed).
  const foundingRows = buildFoundingPool();
  const foundingFamilies = buildTitleFamilies(foundingRows);
  const foundingScored = scoreTitleFamilies(foundingFamilies, foundingRows);
  const foundingMerged = mergeFragmentedTitleFamilies(foundingScored, foundingRows);
  assertEq(foundingMerged[0].count, 5, 'RE-VERIFY (founding): still merges to 5 members — every member row positively asserts issue #351');

  const alphaItems = [
    { rawTitle: 'Alpha Flight #106 Wendigo NM copy', year: null },
    { rawTitle: 'Alpha Flight #106 Wendigo Backup Rare NM', year: null },
    { rawTitle: 'Alpha Flight #106 Wendigo VF copy', year: null },
    { rawTitle: 'Alpha Flight #106 Wendigo Backup Rare VF', year: null },
  ];
  const alphaSubset = makeGateScored({ title: 'alpha flight wendigo', tokens: ['alpha', 'flight', 'wendigo'], indices: [0, 2] });
  const alphaSuperset = makeGateScored({ title: 'alpha flight wendigo backup rare', tokens: ['alpha', 'flight', 'wendigo', 'backup', 'rare'], indices: [1, 3] });
  const alphaResult = mergeFragmentedTitleFamilies([alphaSubset, alphaSuperset], alphaItems);
  assertEq(alphaResult.length, 1, 'RE-VERIFY (Alpha Flight): still merges — every member row positively asserts issue #106');

  const barItems = [
    { rawTitle: 'Bar Comics #9 Key Issue near mint', year: null },
    { rawTitle: 'Bar Comics #9 Key Issue raw copy', year: '1970' },
    { rawTitle: 'Bar Comics #9 unspecified condition', year: null },
  ];
  const barSuperset = makeGateScored({ title: 'bar comics key issue', tokens: ['bar', 'comics', 'key', 'issue'], indices: [0, 1] });
  const barSubset = makeGateScored({ title: 'bar comics', tokens: ['bar', 'comics'], indices: [2] });
  const barResult = mergeFragmentedTitleFamilies([barSubset, barSuperset], barItems);
  assertTrue(barResult.length === 1 && barResult[0].count === 3, 'RE-VERIFY (Bar Comics): still merges — every member row positively asserts issue #9');

  const ordinaryItems = [
    { rawTitle: 'Ordinary Comic #22 near mint copy', year: null },
    { rawTitle: 'Ordinary Comic #22 raw', year: null },
    { rawTitle: 'Ordinary Comic #22 key issue', year: null },
  ];
  const ordinaryFamA = makeGateScored({ title: 'ordinary comic near mint copy', tokens: ['ordinary', 'comic', 'near', 'mint', 'copy'], indices: [0] });
  const ordinaryFamB = makeGateScored({ title: 'ordinary comic', tokens: ['ordinary', 'comic'], indices: [1, 2] });
  const ordinaryResult = mergeFragmentedTitleFamilies([ordinaryFamA, ordinaryFamB], ordinaryItems);
  assertTrue(ordinaryResult.length === 1 && ordinaryResult[0].count === 3, 'RE-VERIFY (Ordinary Comic, positive control): still merges — every member row positively asserts issue #22');
}

// ══════════════════════════════════════════════════════════════════════════════
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('Failures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
