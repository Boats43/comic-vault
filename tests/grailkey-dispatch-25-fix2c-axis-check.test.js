// tests/grailkey-dispatch-25-fix2c-axis-check.test.js
//
// GrailKey Dispatch 25, Fix 2c (2026-08-07) — Batman #213 class.
//
// THE DEFECT: identityCore.js's near-miss margin-decline branch
// (isNearMissMarginDecline, Commit 4.3.1) measures its 3x dominance
// requirement purely on TITLE-FAMILY WEIGHT (topFamily.weightSum vs
// runnerUp.weightSum, familyDominatesRunnerUp in compHygiene.js). It has
// no awareness of what issue number either family's own rows assert. A
// real production scan (Batman #213, scan 23:13:49 UTC, build b2c7358)
// hit this: two competing TITLE clusters ("batman giant 30th anniversary
// issue origin robin" vs "batman dc"), margin 1.3 < required 3 — but
// EVERY row in BOTH clusters, and the raw pool overall (19/19), asserted
// issue #213. The pre-fix code unconditionally wrote outcome:'conflicted'
// anyway, which api/enrich.js (identity.familyIssueConsensus?.mode===
// 'conflict-locked' gate, ~line 2935) surfaces verbatim to the card as
// "Marketplace listings disagree on this book's issue number" — false
// when every row agrees. Wrong axis: a TITLE-wording ambiguity was
// reported as an ISSUE-authority conflict.
//
// CORRECTED MID-DISPATCH (review before push): the first-shipped version
// of this fix compared `.winner` (PLURALITY) on both families — a 3-row
// runner-up with two rows asserting #213 and one asserting #300 has
// `.winner==='213'`, which would have suppressed a GENUINE conflict on
// live dissent. The brief requires UNANIMITY, not plurality: a family
// "agrees" only when its own `.assertedIssues` (the distinct SET of
// values its rows assert — from resolveFamilyIssueConsensus's own
// Object.keys(counts), entirely unfloored) has size exactly 1, and both
// families' single values match. Sections 5/6 below are the two new
// cases that expose exactly this hole (Section 5 fails under the old
// `.winner`-based check, confirmed by direct inspection of the pre-fix
// diff's own log line semantics — both `.winner` values would read
// '213' there despite real internal dissent).
//
// THE FIX: before recording a near-miss conflict, measure the distinct
// asserted-issue set for the top family AND the runner-up (the only
// competing family the margin predicate itself concerns — it is
// scored[1], the sole family ever compared against scored[0]). If BOTH
// sets have size exactly 1 AND are equal, there is no issue conflict —
// the ambiguity is confined to the title axis. familyIssueConsensusResult
// is left null (not populated with an "agreed" pseudo-state), so every
// downstream consumer — the vision-zero-support raw-pool check in this
// same function, and api/enrich.js's out.issueConsensusConflict
// construction — evaluates the field exactly as if no near-miss had
// occurred. A genuine disagreement (either family internally split, or
// the two families unanimous on different issues) is unaffected — same
// 'conflicted' outcome as before, verified unchanged against the
// pre-existing q-trackB-commit4.3.1-retention-decline-fail-closed.test.js
// suite (73/73, its own fixture's runner-up is a lot listing with no
// coherent issue at all).
//
// Fixture philosophy matches the existing Commit 4.3.1 suite this file
// sits beside: row POSITIONS (not hand-set weightSum fields) feed the
// real buildTitleFamilies/scoreTitleFamilies/mergeFragmentedTitleFamilies
// chain, using the disclosed real rank-weight formula (idx0=5, idx1=4,
// idx2=3, idx3-9=1, idx10-19=0.5) — genuinely emergent numbers, not
// injected. Every fixture's titleAxisOnlyBlock===true and near-miss
// margin shape are verified against the REAL scorer before being fed
// into resolveIdentity, not assumed.
//
// Invoke: node tests/grailkey-dispatch-25-fix2c-axis-check.test.js

import { resolveIdentity } from '../src/lib/identityCore.js';
import { extractIdentityFromImageSearch, buildTitleFamilies, scoreTitleFamilies, mergeFragmentedTitleFamilies, selectTitleFamilyCandidate } from '../src/lib/imageSearchIdentity.js';
import { familyDominatesRunnerUp } from '../src/lib/compHygiene.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`  ✓ ${label}`); return true; }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); return false; }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertFalse = (cond, label) => assertEq(!!cond, false, label);

function captureLogs(fn) {
  const originalLog = console.log;
  const lines = [];
  console.log = (...args) => { lines.push(args.join(' ')); };
  let result;
  try { result = fn(); } finally { console.log = originalLog; }
  return { result, lines };
}

function buildParsedPool(rows) {
  const rawItems = rows.map((title, i) => ({
    title,
    itemId: `v1|${100000 + i}|0`,
    price: { value: String(20 + i) },
    itemWebUrl: `https://www.ebay.com/itm/${100000 + i}`,
  }));
  return extractIdentityFromImageSearch(rawItems);
}

console.log('\n=== GrailKey Dispatch 25 — Fix 2c: axis check (Batman #213 class) ===\n');

const FAMILY_A_213 = [
  'Batman #213 Giant 30th Anniversary Issue Origin of Robin DC Comics 1969',
  'Batman 213 Giant Anniversary Issue Origin Robin Story',
  'Batman #213 Giant Size Anniversary Robin Origin Tale',
];
const FAMILY_A_MIXED_213_300 = [
  'Batman #213 Giant 30th Anniversary Issue Origin of Robin DC Comics 1969',
  'Batman 213 Giant Anniversary Issue Origin Robin Story',
  'Batman #300 Giant Size Anniversary Robin Origin Tale', // dissents from the other two
];
const FAMILY_B_213 = [
  'Batman DC Comics #213 Classic Cover Edition Bronze',
  'Batman #213 DC Comics Classic Bronze Cover',
];
const FAMILY_B_DIFFERENT_ISSUE = [
  'Batman DC Comics #300 Classic Cover Edition Bronze',
  'Batman #300 DC Comics Classic Bronze Cover',
];
const FAMILY_B_MIXED_213_300 = [
  'Batman DC Comics #213 Classic Cover Edition Bronze',
  'Batman #213 DC Comics Classic Bronze Cover',
  'Batman #300 DC Comics Classic Bronze Cover', // dissents from the other two
];
const FILLER = [
  'Superman Action Comics 900 Anniversary',
  'Wonder Woman 750 Foil Variant',
  'Flash 300 Barry Allen Speedster',
  'Green Lantern 76 Hard Traveling Heroes',
  'Aquaman 5 Atlantis King',
];

// Row POSITIONS (not weightSum) feed the real rank-weight formula.
// idx0=5, idx1=4, idx2=3, idx3-9=1, idx10-19=0.5.
function buildRows(topRows, topPositions, runnerRows, runnerPositions) {
  const rows = new Array(18).fill(null);
  topPositions.forEach((pos, i) => { rows[pos] = topRows[i]; });
  runnerPositions.forEach((pos, i) => { rows[pos] = runnerRows[i]; });
  const used = new Set([...topPositions, ...runnerPositions]);
  const remainingIdx = Array.from({ length: 18 }, (_, i) => i).filter((i) => !used.has(i));
  remainingIdx.forEach((idx, i) => { rows[idx] = `${FILLER[i % FILLER.length]} copy${i}`; });
  return rows;
}

function buildCandidate(topRows, topPositions, runnerRows, runnerPositions) {
  const rows = buildRows(topRows, topPositions, runnerRows, runnerPositions);
  const parsedRows = buildParsedPool(rows);
  const families = buildTitleFamilies(parsedRows);
  const scored = scoreTitleFamilies(families, parsedRows);
  const merged = mergeFragmentedTitleFamilies(scored, parsedRows);
  const candidate = selectTitleFamilyCandidate(parsedRows, 'Batman', '213', '1969', { ebayConsensusTitle: 'batman' });
  return { rows, parsedRows, merged, candidate };
}

const VISION = { title: 'Batman', issue: '213', year: '1969', publisher: 'DC Comics', confidence: 'medium' };
const EBAY = { title: 'batman', issue: '213', year: '1969', publisher: 'DC', agreement: { visionIssueCount: 19, total: 19 } };

// ─── SECTION 1 — real scorer produces the intended near-miss shape ───
console.log('-- Section 1: real scorer produces a genuine near-miss (margin < 3), both clusters unanimous on #213 --');
let candidate1, parsedRows1;
{
  const { merged, candidate, parsedRows } = buildCandidate(FAMILY_A_213, [0, 3, 4], FAMILY_B_213, [1, 2]);
  candidate1 = candidate;
  parsedRows1 = parsedRows;
  assertEq(merged[0].count, 3, 'real scorer top family count = 3');
  assertEq(merged[0].weightSum, 7, 'real scorer top family weight = 7 (genuinely emergent)');
  assertEq(merged[1].count, 2, 'real scorer runner-up count = 2');
  assertEq(merged[1].weightSum, 7, 'real scorer runner-up weight = 7 (genuinely emergent)');
  assertFalse(familyDominatesRunnerUp(merged[0].weightSum, merged[1].weightSum), 'dominance FAILS (7 < 7*3=21) — genuine near-miss shape, computed by the real formula');
  assertTrue(candidate.titleAxisOnlyBlock === true, 'titleAxisOnlyBlock computed by the real Q84 gate (not hand-set)');
}

// ─── SECTION 2 — resolveIdentity: axis agreement suppresses the false conflict ───
console.log('\n-- Section 2: resolveIdentity — both families unanimous on #213 (some rows silent in the wider pool) — agreement fires --');
let identity2;
{
  const { result, lines } = captureLogs(() =>
    resolveIdentity(VISION, EBAY, candidate1, { ebayResultCount: 18, overlapThreshold: 0.2, isGraded: false, visualItems: parsedRows1 })
  );
  identity2 = result;

  assertEq(identity2.familyIssueConsensus, null, 'CORE FIX: familyIssueConsensus stays null — no false conflict recorded');
  assertFalse(identity2.familyIssueConsensus?.mode === 'conflict-locked', 'CORE FIX: mode is never conflict-locked for this shape — api/enrich.js\'s out.issueConsensusConflict gate cannot fire');
  assertTrue(identity2.identitySource.includes('title_axis_ambiguous_issue_agreed'), 'identitySource carries the axis-agreement advisory');
  assertFalse(identity2.identitySource.includes('family_margin_decline_conflict'), 'identitySource does NOT carry the conflict marker for this shape');

  const axisCheckLines = lines.filter((l) => l.startsWith('[commit4.3.1-axis-check]'));
  assertEq(axisCheckLines.length, 1, 'exactly one [commit4.3.1-axis-check] line fires');
  assertTrue(axisCheckLines[0].includes('topFamilyAssertedIssues=["213"]'), 'log carries topFamilyAssertedIssues=["213"]');
  assertTrue(axisCheckLines[0].includes('runnerUpAssertedIssues=["213"]'), 'log carries runnerUpAssertedIssues=["213"]');
  assertTrue(axisCheckLines[0].includes('topUnanimous=true'), 'log carries topUnanimous=true');
  assertTrue(axisCheckLines[0].includes('runnerUpUnanimous=true'), 'log carries runnerUpUnanimous=true');
  assertTrue(axisCheckLines[0].includes('agreement=true'), 'log carries agreement=true');
  assertTrue(axisCheckLines[0].includes('decision=title-axis-only-no-issue-conflict'), 'log carries the correct decision label');

  const oldConflictLines = lines.filter((l) => l.startsWith('[commit4.3.1] near-miss family conflict:'));
  assertEq(oldConflictLines.length, 0, 'the OLD unconditional conflict log line does NOT fire for this shape');
}

// ─── SECTION 3 — regression: both families unanimous, but on DIFFERENT issues ───
console.log('\n-- Section 3: regression — both families unanimous, but on DIFFERENT issues — still hard-conflicts --');
{
  const { merged, candidate, parsedRows } = buildCandidate(FAMILY_A_213, [0, 3, 4], FAMILY_B_DIFFERENT_ISSUE, [1, 2]);
  assertFalse(familyDominatesRunnerUp(merged[0].weightSum, merged[1].weightSum), 'sanity: still a near-miss margin shape (7 vs 7)');
  assertTrue(candidate.titleAxisOnlyBlock === true, 'sanity: titleAxisOnlyBlock still true');

  const { result, lines } = captureLogs(() =>
    resolveIdentity(VISION, EBAY, candidate, { ebayResultCount: 18, overlapThreshold: 0.2, isGraded: false, visualItems: parsedRows })
  );

  assertTrue(result.familyIssueConsensus != null, 'REGRESSION GUARD: familyIssueConsensus IS populated when families genuinely disagree');
  assertEq(result.familyIssueConsensus.outcome, 'conflicted', 'REGRESSION GUARD: outcome is "conflicted"');
  assertEq(result.familyIssueConsensus.reason, 'retention-margin-decline-conflict', 'REGRESSION GUARD: reason recorded');
  assertTrue(result.identitySource.includes('family_margin_decline_conflict'), 'REGRESSION GUARD: identitySource carries the conflict marker');

  const axisCheckLines = lines.filter((l) => l.startsWith('[commit4.3.1-axis-check]'));
  assertEq(axisCheckLines.length, 1, 'axis-check log still fires on the disagreement path (never silent)');
  assertTrue(axisCheckLines[0].includes('topFamilyAssertedIssues=["213"]'), 'log carries topFamilyAssertedIssues=["213"]');
  assertTrue(axisCheckLines[0].includes('runnerUpAssertedIssues=["300"]'), 'log carries runnerUpAssertedIssues=["300"] — the genuinely different issue');
  assertTrue(axisCheckLines[0].includes('topUnanimous=true'), 'log carries topUnanimous=true');
  assertTrue(axisCheckLines[0].includes('runnerUpUnanimous=true'), 'log carries runnerUpUnanimous=true (unanimous on its own value, just a DIFFERENT one)');
  assertTrue(axisCheckLines[0].includes('agreement=false'), 'log carries agreement=false');
  assertTrue(axisCheckLines[0].includes('decision=genuine-issue-conflict'), 'log carries the correct decision label');

  const oldConflictLines = lines.filter((l) => l.startsWith('[commit4.3.1] near-miss family conflict:'));
  assertEq(oldConflictLines.length, 1, 'the original N1 containment line still fires exactly once for a genuine conflict — unchanged behavior');
}

// ─── SECTION 4 — no runner-up at all: axis check does not spuriously fire ───
console.log('\n-- Section 4: no runner-up present — familyDominatesRunnerUp short-circuits true, near-miss branch never entered --');
{
  assertTrue(familyDominatesRunnerUp(10, null), 'sanity: no runner-up => dominates=true => not a near-miss => axis-check branch not entered');
}

// ─── SECTION 5 — THE HOLE: runner-up internally split (plurality #213, real dissent #300) ───
console.log('\n-- Section 5 (P0 hole closed): runner-up has 2x#213 + 1x#300 (internal dissent) — plurality would wrongly agree, unanimity correctly conflicts --');
{
  const { merged, candidate, parsedRows } = buildCandidate(FAMILY_A_213, [0, 1, 4], FAMILY_B_MIXED_213_300, [2, 3, 5]);
  assertEq(merged[0].weightSum, 10, 'sanity: top family weight = 10 (positions 0,1,4 => 5+4+1)');
  assertEq(merged[1].weightSum, 5, 'sanity: runner-up weight = 5 (positions 2,3,5 => 3+1+1)');
  assertFalse(familyDominatesRunnerUp(merged[0].weightSum, merged[1].weightSum), 'sanity: near-miss shape (10 < 5*3=15)');
  assertTrue(candidate.titleAxisOnlyBlock === true, 'sanity: titleAxisOnlyBlock true — this fixture genuinely reaches the near-miss branch');

  const { result, lines } = captureLogs(() =>
    resolveIdentity(VISION, EBAY, candidate, { ebayResultCount: 18, overlapThreshold: 0.2, isGraded: false, visualItems: parsedRows })
  );

  assertTrue(result.familyIssueConsensus != null, 'P0 FIX: familyIssueConsensus IS populated — conflict correctly STANDS despite runner-up plurality agreeing with top family');
  assertEq(result.familyIssueConsensus.outcome, 'conflicted', 'P0 FIX: outcome is "conflicted" — a live dissenting row (#300) is never silently absorbed by the #213 plurality');
  assertTrue(result.identitySource.includes('family_margin_decline_conflict'), 'P0 FIX: identitySource carries the conflict marker, NOT the axis-agreement advisory');
  assertFalse(result.identitySource.includes('title_axis_ambiguous_issue_agreed'), 'P0 FIX: identitySource does NOT carry the false "agreed" advisory');

  const axisCheckLines = lines.filter((l) => l.startsWith('[commit4.3.1-axis-check]'));
  assertEq(axisCheckLines.length, 1, 'axis-check log fires');
  assertTrue(axisCheckLines[0].includes('topFamilyAssertedIssues=["213"]'), 'log: top family unanimous on #213');
  assertTrue(axisCheckLines[0].includes('runnerUpAssertedIssues=["213","300"]'), 'log: runner-up asserted set has BOTH #213 and #300 — the dissent is visible in the log');
  assertTrue(axisCheckLines[0].includes('runnerUpIssueCounts={"213":2,"300":1}'), 'log: runner-up per-value counts show 2 rows for #213, 1 dissenting row for #300 — the exact P0 scenario');
  assertTrue(axisCheckLines[0].includes('topUnanimous=true'), 'log: topUnanimous=true');
  assertTrue(axisCheckLines[0].includes('runnerUpUnanimous=false'), 'log: runnerUpUnanimous=false — this is the field that closes the hole (plurality alone would have read "agree")');
  assertTrue(axisCheckLines[0].includes('agreement=false'), 'log: agreement=false — the conflict correctly stands');
}

// ─── SECTION 6 — top family internally split (independent of runner-up state) ───
console.log('\n-- Section 6: top family has 2x#213 + 1x#300 (internal dissent) — conflict stands regardless of a unanimous runner-up --');
{
  const { merged, candidate, parsedRows } = buildCandidate(FAMILY_A_MIXED_213_300, [0, 3, 4], FAMILY_B_213, [1, 2]);
  assertEq(merged[0].weightSum, 7, 'sanity: top family weight = 7');
  assertEq(merged[1].weightSum, 7, 'sanity: runner-up weight = 7');
  assertFalse(familyDominatesRunnerUp(merged[0].weightSum, merged[1].weightSum), 'sanity: near-miss shape (7 < 7*3=21)');
  assertTrue(candidate.titleAxisOnlyBlock === true, 'sanity: titleAxisOnlyBlock true (verbose wording preserved in the top slot)');

  const { result, lines } = captureLogs(() =>
    resolveIdentity(VISION, EBAY, candidate, { ebayResultCount: 18, overlapThreshold: 0.2, isGraded: false, visualItems: parsedRows })
  );

  assertTrue(result.familyIssueConsensus != null, 'familyIssueConsensus IS populated — top-family dissent alone is sufficient to block agreement');
  assertEq(result.familyIssueConsensus.outcome, 'conflicted', 'outcome is "conflicted"');

  const axisCheckLines = lines.filter((l) => l.startsWith('[commit4.3.1-axis-check]'));
  assertEq(axisCheckLines.length, 1, 'axis-check log fires');
  assertTrue(axisCheckLines[0].includes('topFamilyAssertedIssues=["213","300"]'), 'log: top family asserted set has both values — the split is visible');
  assertTrue(axisCheckLines[0].includes('runnerUpAssertedIssues=["213"]'), 'log: runner-up is unanimous on its own — irrelevant to the outcome');
  assertTrue(axisCheckLines[0].includes('topUnanimous=false'), 'log: topUnanimous=false — this alone forces agreement=false');
  assertTrue(axisCheckLines[0].includes('runnerUpUnanimous=true'), 'log: runnerUpUnanimous=true (a unanimous runner-up cannot rescue a split top family)');
  assertTrue(axisCheckLines[0].includes('agreement=false'), 'log: agreement=false');
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('Failures:');
  failures.forEach((f) => console.log(f));
}
process.exit(failed > 0 ? 1 : 0);
