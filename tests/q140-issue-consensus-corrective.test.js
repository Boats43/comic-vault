// tests/q140-issue-consensus-corrective.test.js
//
// Q140 corrective dispatch (2026-07-23) — issue consensus + terminal
// fingerprint invariant. Consolidated investigation, approved with scope
// corrections. This is Commit A, production-certified independently of
// Commit B (anchor trust) and Commit C (fail-open active pool).
//
// The original Q140 dispatch (2026-07-22) fixed the pool-WIDE ebay.issue
// vote leaking into a family override by reading "#N" off the winning
// family's own topFamily.rawTitle instead — a real improvement, but still
// a SINGLE representative row's text, not an aggregate. This corrective
// pass replaces that single-row read with resolveFamilyIssueConsensus, an
// aggregate vote across every member row of the winning family, and
// enforces the full contract:
//   - missing issue + >=3 unique family rows + >=60% explicit agreement +
//     a clear lead over the runner-up -> ADOPT
//   - present issue + agreement -> CORROBORATE only (never replace)
//   - present issue + disagreement -> NEVER overwrite; LOCK the conflict
//   - a single representative rawTitle can never, by itself, establish an
//     issue
//
// It also closes the terminal fingerprint invariant: confirmedIssue (the
// pre-pricing value, drives comp search/pricing math) and out.issue (the
// pre-response value, what the card renders) were two independent writer
// chains in api/enrich.js — a downstream visual-pool read could silently
// overwrite out.issue with a value that disagreed with confirmedIssue,
// making the card display a different issue than the one its price was
// actually computed against. detectVisualIssueDivergence is the pure
// helper backing that fix; the full writer-chain rewiring in
// api/enrich.js (removing the two direct out.issue writes at the Q83
// rescue site and the visual-pool site, leaving exactly one terminal
// write) was verified by direct code reading, not simulated here — the
// monolithic request handler has no seam to unit-test around it, which is
// exactly why detectVisualIssueDivergence was extracted as a pure
// function in the first place.
//
// 2026-07-23 review addendum (ChatGPT-style adversarial review, conditional
// approval) — added after the initial pass exposed real gaps, not just
// documentation gaps:
//   1. Denominator was totalWithIssue (only issue-bearing rows), not
//      uniqueRows (ALL unique family rows) — fixed, matches the
//      established extractConsensus precedent (Q-ADV397).
//   2. Dedup was rawTitle-text-only — fixed to prefer eBay itemWebUrl (a
//      stable per-listing identifier) when available.
//   3. "Disagreement" locked a conflict even when the disagreeing
//      candidate was pure scattered noise that never itself cleared the
//      adoption bar — fixed: conflict-locked now requires the disagreeing
//      winner to independently pass the same >=3/>=60%/clear-lead bar
//      adoption would require.
//   4. The REAL family-vs-prior conflict (resolveIdentity's own
//      conflict-locked result) was computed correctly but only
//      console-logged — never returned to the caller, so
//      out.issueConsensusConflict / decisionEngine never saw it. Fixed:
//      resolveIdentity now returns familyIssueConsensus.
//   5. issueConsensusConflict was a bare {confirmedIssue, visualIssue}
//      pair — fixed to structured metadata (currentIssue, consensusIssue,
//      currentSource, support, population, ratio, decision).
// See api/enrich.js and src/lib/identityCore.js inline comments dated
// "review fix" for the exact diffs.
//
// 2026-07-23 review round 2 (Commit A held, two real logic defects, both
// required before approval) — again real bugs, not just documentation:
//   BLOCKER 1: the priorIssue-present branch checked `winner ===
//     priorIssue` BEFORE meetsAdoptionBar — a single matching row out of
//     five (1/5, 20%) was labeled 'corroborated', same as a real
//     3/5-clear-lead consensus, silently bypassing the adoption bar this
//     whole rewrite exists to enforce. Fixed: corroborated now requires
//     meetsAdoptionBar too. A weak match reports 'no-consensus' — the
//     prior issue is still preserved (this only ever affected the
//     CONFIDENCE LABEL, never the value).
//   BLOCKER 2: `out.issue = confirmedIssue || (identityIsProvisionalOverride
//     ? null : issueNum) || null` was one assignment STATEMENT but two
//     authority SOURCES — could rehydrate a stale raw issueNum after
//     confirmedIssue was deliberately nulled by resolveIdentity (the
//     Immortal Hulk class: server issue=null, card rendered #1). Fixed:
//     `out.issue = confirmedIssue ?? null` — confirmedIssue is the ONLY
//     authority. If issueNum is ever a legitimate fallback for some case,
//     that belongs inside canonical resolution, not reintroduced at the
//     response boundary.
//   Also required: the [q140-terminal] VIOLATION path now has real teeth
//     (out.listingHardLocked + a new issue-fingerprint-violation critical
//     warning), not just a log line — see Part 12.
//   Also required (Q145 action/bestChannel desync precedent): every
//     routing-lock test now asserts action, bestChannel, AND
//     contract.listable together, not action alone — see Parts 4 and 12.
//   Minor (implemented): dedup key preference itemId -> legacyItemId ->
//     normalized itemWebUrl -> normalized rawTitle; tied/no-consensus
//     results report tiedCandidates instead of an arbitrary ranked[0].
//
// 2026-07-23 review round 3 (one more required before approval) — both
// prior blockers confirmed resolved, but the report never showed what
// happens to PRICE authority when a fingerprint violation fires — only
// routing/listing (action/bestChannel/listable) was proven locked. A
// locked card that still displayed "Recommended: $10.77" (computed
// against issue #170) while showing "The Flash #139" would still be
// misleading even though it couldn't be listed. Fixed: the VIOLATION
// branch (api/enrich.js) now also clears out.price/priceLow/priceHigh/
// priceBands to null, relabels pricingSource, sets refusedToPrice=true
// (routing responseContract.js's deriveState to 'REFUSED', which nulls
// contract.price/bands too — reusing the EXISTING refused-price pattern
// byte-for-byte, see the polybag-pc-divergence branches ~enrich.js:5385),
// and demotes matchConfidence to LOW/0. Ordering (asked, answered
// honestly): the violation can only be detected once out.issue is FINAL,
// so it is necessarily detected AFTER pricing already ran — this block
// retroactively CLEARS the already-computed price, before
// out.decision = computeDecision(...) and finalizeResponse (both later)
// ever run, so nothing downstream ever sees the stale number. Verified
// via the FULL finalizeResponse pipeline (Part 13), not
// computeDecision/deriveLocks tested in isolation.
//
// Invoke: node tests/q140-issue-consensus-corrective.test.js

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { resolveFamilyIssueConsensus, detectVisualIssueDivergence, resolveIdentity } from '../src/lib/identityCore.js';
import { computeDecision } from '../src/lib/decisionEngine.js';
import { assembleContract, finalizeResponse } from '../src/lib/responseContract.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (actual === expected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};

console.log('\n=== Q140 corrective dispatch — issue consensus + terminal fingerprint invariant ===\n');

// ═══════════════════════════════════════════════════════════════════════
// Part 1 — resolveFamilyIssueConsensus unit behavior
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 1: resolveFamilyIssueConsensus — adopt/corroborate/lock-conflict contract\n');

const rows = (titles) => titles.map((t) => ({ rawTitle: t }));

{
  // Missing issue, >=3 unique rows, >=60% agreement, clear lead -> adopt.
  const items = rows([
    'Adventure Time Summer Special #1 SDCC Convention Exclusive 2013 NEW',
    'Adventure Time Summer Special #1 SDCC 2013 NM',
    'Adventure Time Summer Special #1 SDCC 2013 CGC 7.0',
    'Adventure Time Summer Special #1 SDCC 2013 In Hand',
  ]);
  const r = resolveFamilyIssueConsensus(null, items, [0, 1, 2, 3]);
  assertEq(r.mode, 'adopted', 'missing issue + 4/4 rows agree #1 -> adopted');
  assertEq(r.issue, '1', 'adopted issue is "1"');
  assertEq(r.uniqueRows, 4, 'counted 4 unique rows');
}

{
  // Missing issue, only 2 unique rows -> below the >=3-row floor, no adopt.
  const items = rows(['Foo #1 A', 'Foo #1 B']);
  const r = resolveFamilyIssueConsensus(null, items, [0, 1]);
  assertEq(r.mode, 'no-consensus', '2 rows < 3-row floor -> no-consensus, not adopted');
  assertEq(r.issue, null, 'issue stays null — nothing to adopt from');
}

{
  // Missing issue, >=3 rows but top candidate only reaches 50% (< 60% bar) -> no adopt.
  const items = rows(['Foo #1 A', 'Foo #2 B', 'Foo #2 C', 'Foo #3 D']);
  const r = resolveFamilyIssueConsensus(null, items, [0, 1, 2, 3]);
  assertEq(r.mode, 'no-consensus', '4 rows, top candidate "2" only 2/4=50% (< 60% bar) -> no-consensus');
  assertEq(r.issue, null, 'issue stays null — 50% agreement does not clear the adoption bar');
}

{
  // Present issue + family aggregate agrees -> corroborate only, never "replace".
  const items = rows(['Immortal Hulk #44 A', 'Immortal Hulk #44 B', 'Immortal Hulk #44 C']);
  const r = resolveFamilyIssueConsensus('44', items, [0, 1, 2]);
  assertEq(r.mode, 'corroborated', 'present "44" + family agrees "44" -> corroborated');
  assertEq(r.issue, '44', 'issue remains "44" (the prior value, not a fresh assignment)');
}

{
  // Present issue + family aggregate disagrees -> never overwrite, lock conflict.
  const items = rows([
    'Flash #170 Anniversary A', 'Flash #170 Anniversary B', 'Flash #170 Anniversary C',
    'Flash #139 D', 'Flash #139 E',
  ]);
  const r = resolveFamilyIssueConsensus('139', items, [0, 1, 2, 3, 4]);
  assertEq(r.mode, 'conflict-locked', 'present "139" + family leans "170" (3/5, clear lead) -> conflict-locked');
  assertEq(r.issue, '139', 'issue stays "139" — never overwritten by the disagreeing family consensus');
  assertEq(r.winner, '170', 'winner is recorded as "170" for diagnostic/annotation purposes');
}

{
  // Present issue + family has no issue-token consensus at all -> no-consensus, keep prior.
  const items = rows(['Flash Anniversary Special A', 'Flash Anniversary Special B']);
  const r = resolveFamilyIssueConsensus('128', items, [0, 1]);
  assertEq(r.mode, 'no-consensus', 'present "128" + family has zero issue tokens -> no-consensus');
  assertEq(r.issue, '128', 'issue stays "128" (the prior)');
}

{
  // Single representative row can never establish an issue, even with a
  // "clear lead" of 1/1 = 100% — the >=3-unique-row floor blocks it.
  const items = rows(['Wonder Woman #1 Jim Lee Foil A']);
  const r = resolveFamilyIssueConsensus(null, items, [0]);
  assertEq(r.mode, 'no-consensus', 'a single row, even at 100% self-agreement, cannot establish an issue');
  assertEq(r.issue, null, 'issue stays null from a lone row');
}

{
  // Duplicate identical listing text does not count as multiple rows.
  const items = rows(['Wonder Woman #1 Jim Lee Foil', 'Wonder Woman #1 Jim Lee Foil', 'Wonder Woman #1 Jim Lee Foil']);
  const r = resolveFamilyIssueConsensus(null, items, [0, 1, 2]);
  assertEq(r.uniqueRows, 1, 'three identical rawTitle strings collapse to 1 unique row (dedupe)');
  assertEq(r.mode, 'no-consensus', '1 unique row (even repeated 3x) cannot establish an issue');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 2 — required fixtures, via resolveIdentity end-to-end
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: required fixtures (Flash #139/#128, Adventure Time, Immortal Hulk #44, Wonder Woman #1)\n');

const familyOf = (indices, selectedTitle, rawTitle, decision = 'weighted-consensus') => ({
  selectedTitle,
  decision,
  topFamily: { indices, rawTitle, count: indices.length, weightSum: indices.length, title: selectedTitle },
});

{
  // Flash #139 — mixed family. Vision correctly read #139; the visual pool
  // is contaminated by a #170 anniversary-issue cluster that outnumbers
  // the genuine #139 rows. Must remain #139 — and because it does, nothing
  // downstream ever queries comps for "#170".
  const visualItems = rows([
    'The Flash #170 Anniversary Giant-Size A',
    'The Flash #170 Anniversary Giant-Size B',
    'The Flash #170 Anniversary Giant-Size C',
    'The Flash #139 D',
    'The Flash #139 E',
  ]);
  const vision = { title: 'The Flash', issue: '139', year: null, publisher: 'DC Comics' };
  const ebay = { title: 'The Flash', issue: '170', year: null, publisher: 'DC Comics', agreement: { visionIssueCount: 2, total: 5 } };
  const family = familyOf([0, 1, 2, 3, 4], 'The Flash', visualItems[0].rawTitle);
  const identity = resolveIdentity(vision, ebay, family, { ebayResultCount: 5, visualItems });
  assertEq(identity.confirmedIssue, '139', 'Flash #139 mixed family: confirmedIssue remains "139" (never overwritten by #170)');
}

{
  // Flash #128 — coherent control. Family agrees with Vision; prices normally.
  const visualItems = rows(['The Flash #128 A', 'The Flash #128 B', 'The Flash #128 C', 'The Flash #128 D']);
  const vision = { title: 'The Flash', issue: '128', year: null, publisher: 'DC Comics' };
  const ebay = { title: 'The Flash', issue: '128', year: null, publisher: 'DC Comics', agreement: { visionIssueCount: 4, total: 4 } };
  const family = familyOf([0, 1, 2, 3], 'The Flash', visualItems[0].rawTitle);
  const identity = resolveIdentity(vision, ebay, family, { ebayResultCount: 4, visualItems });
  assertEq(identity.confirmedIssue, '128', 'Flash #128 coherent control: confirmedIssue remains "128"');
}

{
  // Adventure Time — Vision-null, adopts #1 through real family consensus.
  const visualItems = rows([
    'Adventure Time Summer Special #1 SDCC Convention Exclusive Variant 2013 NEW',
    'Adventure Time Summer Special #1 SDCC Convention Exclusive 2013 NM',
    'Adventure Time Summer Special #1 SDCC 2013 CGC 7.0',
    'Adventure Time Summer Special #1 SDCC 2013 In Hand Ships Fast',
  ]);
  const vision = { title: 'Adventure Time', issue: null, year: 2013, publisher: 'BOOM! Studios' };
  const ebay = { title: 'Adventure Time', issue: null, year: 2013, publisher: 'BOOM! Studios', agreement: { visionIssueCount: 0, total: 4 }, noIssueConsensus: false };
  const family = familyOf([0, 1, 2, 3], 'Adventure Time Summer Special', visualItems[0].rawTitle);
  const identity = resolveIdentity(vision, ebay, family, { ebayResultCount: 4, visualItems });
  assertEq(identity.confirmedIssue, '1', 'Adventure Time Vision-null: adopts "1" from real family consensus');
}

{
  // Immortal Hulk #44 — Vision correct, remains #44.
  const visualItems = rows(['Immortal Hulk #44 A', 'Immortal Hulk #44 B', 'Immortal Hulk #44 C']);
  const vision = { title: 'Immortal Hulk', issue: '44', year: 2020, publisher: 'Marvel' };
  const ebay = { title: 'Immortal Hulk', issue: '44', year: 2020, publisher: 'Marvel', agreement: { visionIssueCount: 3, total: 3 } };
  const family = familyOf([0, 1, 2], 'Immortal Hulk', visualItems[0].rawTitle);
  const identity = resolveIdentity(vision, ebay, family, { ebayResultCount: 3, visualItems });
  assertEq(identity.confirmedIssue, '44', 'Immortal Hulk #44: remains "44"');
}

{
  // Wonder Woman #1 — reaches #1 through real family consensus (>=3 rows),
  // not a single representative row. Proves the corrective fix directly:
  // the single representative topFamily.rawTitle is a WRONG/outlier value,
  // but the aggregate across all member rows correctly recovers "1".
  const visualItems = rows([
    'Wonder Woman #7 Misprinted Listing (outlier)',   // topFamily.rawTitle — WRONG on its own
    'Wonder Woman #1 Jim Lee Foil Second Print',
    'Wonder Woman #1 Jim Lee Foil Second Print',
    'Wonder Woman #1 Jim Lee Foil 2023',
  ]);
  const vision = { title: 'Wonder Woman', issue: null, year: 2023, publisher: 'DC Comics' };
  const ebay = { title: 'Wonder Woman', issue: null, year: 2023, publisher: 'DC Comics', agreement: { visionIssueCount: 0, total: 4 }, noIssueConsensus: false };
  const family = familyOf([0, 1, 2, 3], 'Wonder Woman', visualItems[0].rawTitle);
  const identity = resolveIdentity(vision, ebay, family, { ebayResultCount: 4, visualItems });
  assertEq(identity.confirmedIssue, '1', 'Wonder Woman #1: aggregate family consensus recovers "1", not the outlier "7" from the single representative row');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 3 — terminal fingerprint invariant (detectVisualIssueDivergence)
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: detectVisualIssueDivergence — pre-pricing vs pre-response reconciliation\n');

{
  const d = detectVisualIssueDivergence('139', '170');
  assertEq(d.confirmedIssue, '139', 'divergence records confirmedIssue as the winner field');
  assertEq(d.visualIssue, '170', 'divergence records the disagreeing visualIssue for annotation');
}
assertEq(detectVisualIssueDivergence('128', '128'), null, 'agreement -> no divergence (null)');
assertEq(detectVisualIssueDivergence(null, '170'), null, 'confirmedIssue null -> no divergence to detect (nothing to protect yet)');
assertEq(detectVisualIssueDivergence('139', null), null, 'visualIssue null -> no divergence (no second signal at all)');
assertEq(detectVisualIssueDivergence(139, '139'), null, 'loose numeric/string equality — 139 (number) vs "139" (string) treated as agreement');

// ═══════════════════════════════════════════════════════════════════════
// Part 4 — BLOCKING QUESTION: routing-lock proof. issueConsensusConflict
// must structurally PREVENT LIST_NOW/LIST_LOW, not just attach a warning
// to an otherwise-unconstrained action.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 4: routing-lock proof — issueConsensusConflict forces RESEARCH, never LIST_NOW/LIST_LOW\n');

{
  // Baseline: an otherwise-clean, real-shaped fixture (same shape as the
  // "Amazing Adventures #3 clean vintage" LIST_NOW/LIST_LOW control in
  // tests/decision-engine.test.js) that WOULD be LIST_NOW/LIST_LOW on its
  // own — 0 blockers, verified sold pricing, confident identity.
  const cleanItem = {
    title: 'The Flash',
    issue: '139',
    publisher: 'DC Comics',
    year: 1963,
    grade: 'VF 8.0',
    price: 250,
    identityConfident: true,
    pricingSource: 'verified_sold',
    soldComps: [
      { price: 260, daysAgo: 5 },
      { price: 245, daysAgo: 40 },
      { price: 248, daysAgo: 60 },
    ],
    rawComps: { average: 251, lowest: 240, highest: 260, count: 3 },
  };
  const baselineDecision = computeDecision(cleanItem);
  assertTrue(
    baselineDecision.action === 'LIST_NOW' || baselineDecision.action === 'LIST_LOW',
    `sanity check: baseline (no conflict) fixture IS listable on its own (got "${baselineDecision.action}") — proves the lock below is caused by the conflict, not some other property of the fixture`
  );
  const NON_LISTING_CHANNELS = new Set(['research', 'blocked']);
  assertTrue(!NON_LISTING_CHANNELS.has(baselineDecision.bestChannel), `sanity check: baseline bestChannel IS a listing channel (got "${baselineDecision.bestChannel}")`);
  const baselineContract = assembleContract(cleanOut({ decision: baselineDecision }));
  assertTrue(baselineContract.listable === true, 'sanity check: baseline contract.listable is true');

  // Vision #139, family consensus computes #170, otherwise-clean price/evidence.
  const conflictedItem = {
    ...cleanItem,
    issueConsensusConflict: {
      currentIssue: '139',
      consensusIssue: '170',
      currentSource: 'vision',
      support: 3,
      population: 5,
      ratio: 0.6,
      decision: 'locked',
    },
  };
  const decision = computeDecision(conflictedItem);
  assertEq(decision.action, 'RESEARCH', `Vision #139 vs family consensus #170, otherwise clean -> action forced to RESEARCH (got "${decision.action}")`);
  assertFalse(decision.action === 'LIST_NOW', 'action is NOT LIST_NOW');
  assertFalse(decision.action === 'LIST_LOW', 'action is NOT LIST_LOW');
  assertTrue(decision.warnings.includes('issue-consensus-conflict'), 'decision.warnings carries issue-consensus-conflict');
  // Q145 action/bestChannel desync precedent — test both together, not
  // action alone.
  assertTrue(NON_LISTING_CHANNELS.has(decision.bestChannel), `bestChannel is NOT a listing channel (got "${decision.bestChannel}")`);
  const conflictContract = assembleContract(cleanOut({ decision }));
  assertFalse(conflictContract.listable === true, 'contract.listable is false — action, bestChannel, and listable all lock together');
}

function assertTrue(cond, label) { return assertEq(!!cond, true, label); }
function assertFalse(cond, label) { return assertEq(!!cond, false, label); }

// Shared response-contract fixture builder (mirrors
// tests/response-contract.test.js's cleanOut()) — a real "would-be-
// listable" out shape, so contract.listable assertions exercise the
// actual assembleContract pipeline, not a hand-typed stand-in.
function cleanOut(overrides = {}) {
  return {
    price: '$250.00',
    priceLow: '$240.00',
    priceHigh: '$260.00',
    pricingSource: 'verified_sold_recency',
    priceBands: { quick: 240, market: 250, stretch: 260, tier: 1, source: 'tier1_recency_weighted' },
    soldComps: [{ price: 260 }, { price: 245 }, { price: 248 }],
    rawComps: { count: 3, average: 251, lowest: 240, highest: 260 },
    soldCompDiagnostics: { rawCount: 3, verifiedCount: 3, rejectedCount: 0, reasons: {} },
    matchConfidence: { score: 90, tier: 'HIGH' },
    identityConfident: true,
    refusedToPrice: false,
    ...overrides,
  };
}

// Cite the exact structural branch that makes this a hard ceiling, not a
// label on an unconstrained action: decisionEngine.js's criticalWarnings
// gate unconditionally sets decision.action = 'RESEARCH' and RETURNS
// before any LIST_NOW/LIST_LOW logic later in the function ever runs.
{
  const decisionEngineSrc = fs.readFileSync(path.join(__dirname, '../src/lib/decisionEngine.js'), 'utf8').replace(/\r\n/g, '\n');
  assertTrue(
    /if \(hasCriticalWarning\) \{\s*\n\s*decision\.action = 'RESEARCH';/.test(decisionEngineSrc),
    'decisionEngine.js: hasCriticalWarning branch unconditionally sets decision.action = \'RESEARCH\' (structural ceiling, cited)'
  );
  assertTrue(
    /if \(hasCriticalWarning\) \{[\s\S]{0,1200}?return decision;/.test(decisionEngineSrc),
    'decisionEngine.js: the hasCriticalWarning branch returns immediately — no later LIST_NOW/LIST_LOW logic can run for a locked conflict'
  );
  assertTrue(
    decisionEngineSrc.includes("'issue-consensus-conflict',        // Q140 corrective dispatch"),
    'issue-consensus-conflict is registered in the criticalWarnings array that feeds hasCriticalWarning'
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Part 5 — support/population/ratio matrix: 3/5 passes, 3/6 fails, 3-3 ties fail
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 5: support ratio matrix — 3/5 adopts, 3/6 does not, 3-3 tie does not\n');

{
  // 3/5 = 60% exactly, clear lead (3 > 2) -> meets the bar, adopts.
  const items = rows(['Foo #1 A', 'Foo #1 B', 'Foo #1 C', 'Foo #2 D', 'Foo #2 E']);
  const r = resolveFamilyIssueConsensus(null, items, [0, 1, 2, 3, 4]);
  assertEq(r.mode, 'adopted', '3/5 = 60% exactly, clear lead -> adopted');
  assertEq(r.issue, '1', 'adopted issue is "1"');
  assertEq(r.support, 3, 'support (winner count) is 3');
  assertEq(r.uniqueRows, 5, 'population (uniqueRows) is 5');
  assertEq(r.ratio, 0.6, 'ratio is exactly 0.6 (3/5)');
}

{
  // 3/6 = 50%, below the 60% bar -> does not adopt.
  const items = rows(['Foo #1 A', 'Foo #1 B', 'Foo #1 C', 'Foo #2 D', 'Foo #2 E', 'Foo #3 F']);
  const r = resolveFamilyIssueConsensus(null, items, [0, 1, 2, 3, 4, 5]);
  assertEq(r.mode, 'no-consensus', '3/6 = 50% < 60% bar -> no-consensus, does not adopt');
  assertEq(r.issue, null, 'issue stays null');
  assertEq(r.support, 3, 'support is still reported as 3 for diagnostics');
  assertEq(r.uniqueRows, 6, 'population is 6');
}

{
  // 3-3 tie: winnerCount === runnerUpCount -> clearLead is false -> does not adopt.
  const items = rows(['Foo #1 A', 'Foo #1 B', 'Foo #1 C', 'Foo #2 D', 'Foo #2 E', 'Foo #2 F']);
  const r = resolveFamilyIssueConsensus(null, items, [0, 1, 2, 3, 4, 5]);
  assertEq(r.mode, 'no-consensus', '3-3 tie (50%/50%) -> no-consensus, clearLead fails');
  assertEq(r.issue, null, 'issue stays null on a tie');
}

{
  // 3-3 tie with a PRIOR present: the tie is not a "genuine competing
  // consensus" either (it never clears the adoption bar) -> no-consensus,
  // prior preserved, NOT conflict-locked. Directly proves Part 6 below.
  const items = rows(['Foo #1 A', 'Foo #1 B', 'Foo #1 C', 'Foo #2 D', 'Foo #2 E', 'Foo #2 F']);
  const r = resolveFamilyIssueConsensus('1', items, [0, 1, 2, 3, 4, 5]);
  assertEq(r.mode, 'no-consensus', 'present issue "1" + 3-3 tie -> no-consensus, not conflict-locked (a tie is not a genuine competing consensus)');
  assertEq(r.issue, '1', 'issue stays "1"');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 6 — no valid competing consensus -> preserve current issue, NO
// conflict flag (scattered noise must not manufacture a conflict)
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 6: scattered/non-consensus family does NOT manufacture a conflict flag\n');

{
  // Present issue "128"; family is scattered — one stray mention of "#999"
  // among rows that otherwise carry no issue token at all. The disagreeing
  // "winner" (999, count=1) never clears the adoption bar (1/5 = 20%).
  const items = rows(['Flash Anniversary A', 'Flash Anniversary B', 'Flash #999 stray C', 'Flash Anniversary D', 'Flash Anniversary E']);
  const r = resolveFamilyIssueConsensus('128', items, [0, 1, 2, 3, 4]);
  assertEq(r.mode, 'no-consensus', 'scattered family (1 stray "#999" mention, no real consensus) -> no-consensus, NOT conflict-locked');
  assertEq(r.issue, '128', 'issue stays "128" — noise never overwrites nor flags a conflict');
  assertTrue(r.mode !== 'conflict-locked', 'a genuine conflict flag requires a competing CONSENSUS, not a single stray mention');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 7 — duplicate rows (same eBay listing) do not inflate consensus count
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 7: duplicate eBay item IDs deduplicated before voting\n');

{
  // Same itemWebUrl appearing 3x (e.g. re-scraped/re-paginated) must count
  // as ONE row, not three — even though the title text differs slightly
  // each time (simulating a re-scrape at a different moment).
  const items = [
    { rawTitle: 'Adventure Time Summer Special #1 SDCC 2013 NM', itemWebUrl: 'https://www.ebay.com/itm/111111111111' },
    { rawTitle: 'Adventure Time Summer Special #1 SDCC 2013 NM (relisted)', itemWebUrl: 'https://www.ebay.com/itm/111111111111' },
    { rawTitle: 'Adventure Time Summer Special #1 SDCC 2013 NM!', itemWebUrl: 'https://www.ebay.com/itm/111111111111' },
    { rawTitle: 'Adventure Time Summer Special #1 SDCC 2013 VF', itemWebUrl: 'https://www.ebay.com/itm/222222222222' },
    { rawTitle: 'Adventure Time Summer Special #1 SDCC 2013 High Grade', itemWebUrl: 'https://www.ebay.com/itm/333333333333' },
  ];
  const r = resolveFamilyIssueConsensus(null, items, [0, 1, 2, 3, 4]);
  assertEq(r.uniqueRows, 3, 'same itemWebUrl x3 (different title text each time) collapses to 3 unique rows, not 5');
  assertEq(r.support, 3, 'support reflects 3 unique listings, not 5 raw rows');
  assertEq(r.mode, 'adopted', '3 unique rows, 100% agreement, clear lead -> adopted');
  assertEq(r.issue, '1', 'adopted issue is "1"');
}

{
  // Distinct itemWebUrls with IDENTICAL title text are genuinely different
  // listings and must both count — text-only dedup would have wrongly
  // collapsed these.
  const items = [
    { rawTitle: 'Adventure Time Summer Special #1 NM', itemWebUrl: 'https://www.ebay.com/itm/444444444444' },
    { rawTitle: 'Adventure Time Summer Special #1 NM', itemWebUrl: 'https://www.ebay.com/itm/555555555555' },
    { rawTitle: 'Adventure Time Summer Special #1 NM', itemWebUrl: 'https://www.ebay.com/itm/666666666666' },
  ];
  const r = resolveFamilyIssueConsensus(null, items, [0, 1, 2]);
  assertEq(r.uniqueRows, 3, 'distinct itemWebUrls with identical title text are NOT collapsed — 3 genuinely different listings');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 8 — 2-row unanimous family (Eternus #2) does not adopt: explicit,
// deliberate behavior-change fixture (also covered end-to-end via
// resolveIdentity in tests/q131-refused-identity-conflict-provisional.test.js)
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 8: Eternus #2 class — 2-row unanimous family does NOT adopt (deliberate change)\n');

{
  // Pre-corrective-dispatch behavior (2026-07-22 Q140): a 2-member family
  // whose single representative rawTitle read "#2" would adopt "2"
  // outright (topFamily.count >= 2 was the ONLY gate). Post-corrective-
  // dispatch (2026-07-23): resolveFamilyIssueConsensus's >=3-unique-row
  // floor means even 2/2 = 100% internal agreement does not adopt. This
  // is a DELIBERATE, reviewed behavior change, not a regression — a
  // provisional identity with an honestly-null issue (flagged for manual
  // verification) is safer than confidently asserting "#2" from 2 rows.
  const items = rows(['Eternus #2 - NYCC Metal Virgin Variant Cover A', 'Eternus #2 - NYCC Metal Virgin Variant Cover B']);
  const r = resolveFamilyIssueConsensus(null, items, [0, 1]);
  assertEq(r.uniqueRows, 2, '2 unique rows');
  assertEq(r.ratio, 1.0, '100% internal agreement (2/2)');
  assertEq(r.mode, 'no-consensus', 'DELIBERATE CHANGE: 2 rows is below the >=3-row floor even at 100% agreement -> does not adopt');
  assertEq(r.issue, null, 'issue stays null, not "2" — flagged for manual verification instead of confidently asserted');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 9 — manual / barcode / CGC identity is never reachable by family
// consensus at all (structural guard, cited from api/enrich.js's identity
// resolution if/else-if/else chain)
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 9: manual/barcode/CGC identity structurally bypasses family consensus entirely\n');

{
  // resolveFamilyIssueConsensus (and the conflict-lock logic wrapping it)
  // live ENTIRELY inside resolveIdentity(). api/enrich.js's identity
  // resolution is a single if/else-if/else chain — barcodeIdentity,
  // manualIdentity, and cgcIdentityConfirmed each short-circuit into their
  // own branch and set confirmedIssue directly; resolveIdentity() is only
  // ever called in the FINAL else, which is structurally unreachable when
  // any of the three earlier conditions is true. This proves the guarantee
  // by construction (JS if/else-if/else semantics), not by simulating the
  // 8000-line handler.
  const enrichSrc = fs.readFileSync(path.join(__dirname, '../api/enrich.js'), 'utf8').replace(/\r\n/g, '\n');
  const chainMatch = enrichSrc.match(
    /if \(barcodeIdentity\) \{[\s\S]*?\} else if \(manualIdentity\) \{[\s\S]*?\} else if \(cgcIdentityConfirmed\) \{[\s\S]*?\} else \{[\s\S]{0,400}?identity = resolveIdentity\(/
  );
  assertTrue(!!chainMatch, 'api/enrich.js: resolveIdentity() is called ONLY inside the final else of the barcode/manual/cgc if-else-if chain');

  // Each earlier branch sets confirmedIssue directly and captures
  // pricingIssue immediately — no family-consensus code runs in between.
  assertTrue(
    /if \(barcodeIdentity\) \{[\s\S]{0,300}?confirmedIssue = barcodeIdentity\.issue;[\s\S]{0,300}?pricingIssue = confirmedIssue;/.test(enrichSrc),
    'barcode branch: confirmedIssue set from barcodeIdentity.issue, pricingIssue captured, before any family-consensus code could run'
  );
  assertTrue(
    /confirmedIssue = effectiveIssue;[\s\S]{0,300}?pricingIssue = confirmedIssue;/.test(enrichSrc),
    'manual branch: confirmedIssue set from effectiveIssue (user-typed), pricingIssue captured immediately'
  );
  assertTrue(
    /confirmedIssue = cgcResult\.issue;[\s\S]{0,700}?pricingIssue = confirmedIssue;/.test(enrichSrc),
    'cgc branch: confirmedIssue set from cgcResult.issue (cert-verified), pricingIssue captured immediately'
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Part 10 — out.issue is written from EXACTLY one site (structural,
// single-writer proof) — no divergence possible after Q83 rescue and
// visual-pool processing both run
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 10: out.issue has exactly one writer in api/enrich.js (structural proof)\n');

{
  const enrichSrc = fs.readFileSync(path.join(__dirname, '../api/enrich.js'), 'utf8').replace(/\r\n/g, '\n');
  // Matches real assignment statements ("out.issue = confirmedIssue...")
  // while excluding template-literal log interpolations and comments that
  // render as `out.issue="..."` (no space, immediately quoted) — those are
  // diagnostic text, not a second writer.
  const writers = enrichSrc.match(/out\.issue = [^"]/g) || [];
  assertEq(writers.length, 1, `out.issue is assigned exactly once in api/enrich.js (found ${writers.length}) — the Q83 rescue site and the visual-pool site were rewired to stop writing it directly`);

  // BLOCKER 2 fix (2026-07-23 review round 2) — the terminal write reads
  // EXACTLY ONE variable (confirmedIssue), never issueNum/
  // identityIsProvisionalOverride. The old form was one assignment
  // STATEMENT but two authority SOURCES — this asserts there is now only one.
  const terminalWrite = enrichSrc.includes('out.issue = confirmedIssue ?? null;');
  assertTrue(terminalWrite, 'the single out.issue writer derives it from confirmedIssue alone (?? null), never issueNum or identityIsProvisionalOverride');
  assertFalse(
    enrichSrc.includes('out.issue = confirmedIssue || (identityIsProvisionalOverride ? null : issueNum) || null;'),
    'the old two-authority-source form (issueNum rehydration) is gone'
  );

  // Confirm the two former writer sites were genuinely removed, not just
  // renamed — they must route through issueConsensusConflict instead.
  assertFalse(enrichSrc.includes('out.issue = rescuedIdentity.issue'), 'Q83 rescue site no longer writes out.issue directly');
  assertFalse(enrichSrc.includes('out.issue = visualResult.issue'), 'visual-pool site no longer writes out.issue directly');
  assertTrue(enrichSrc.includes('out.issueConsensusConflict = {'), 'visual-pool disagreement now routes through structured out.issueConsensusConflict annotation instead');

  // issueConsensusConflict carries structured metadata at BOTH surfacing
  // sites (family-consensus site and visual-pool site), not a bare pair.
  const structuredFieldsCount = (enrichSrc.match(/currentIssue:/g) || []).length;
  assertEq(structuredFieldsCount, 2, 'out.issueConsensusConflict is built with structured currentIssue/consensusIssue/currentSource/support/population/ratio/decision at both surfacing sites (family-consensus + visual-pool), never a bare boolean');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 11 — BLOCKER 1 required matrix: weak matches must NOT be labeled
// 'corroborated'. Only a match that itself clears the adoption bar
// (>=3 rows, >=60%, clear lead) is real corroboration.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 11: BLOCKER 1 matrix — prior #139 at 1/5, 2/5, 3/5, 3/6\n');

{
  // prior #139 + 1/5 agreement (1 matching row among 5 unique rows, the
  // other 4 carry no issue token) -> no-consensus, NOT corroborated.
  const items = rows(['Flash #139 A', 'Flash Anniversary B', 'Flash Anniversary C', 'Flash Anniversary D', 'Flash Anniversary E']);
  const r = resolveFamilyIssueConsensus('139', items, [0, 1, 2, 3, 4]);
  assertEq(r.mode, 'no-consensus', 'prior #139 + 1/5 (20%) agreement -> no-consensus, NOT corroborated');
  assertEq(r.issue, '139', 'issue value still preserved as "139" regardless of the label');
}

{
  // prior #139 + 2/5 agreement -> still below the 60% bar -> no-consensus.
  const items = rows(['Flash #139 A', 'Flash #139 B', 'Flash Anniversary C', 'Flash Anniversary D', 'Flash Anniversary E']);
  const r = resolveFamilyIssueConsensus('139', items, [0, 1, 2, 3, 4]);
  assertEq(r.mode, 'no-consensus', 'prior #139 + 2/5 (40%) agreement -> no-consensus, NOT corroborated');
  assertEq(r.issue, '139', 'issue value still preserved as "139"');
}

{
  // prior #139 + 3/5 = 60% exactly, clear lead -> real corroboration.
  const items = rows(['Flash #139 A', 'Flash #139 B', 'Flash #139 C', 'Flash Anniversary D', 'Flash Anniversary E']);
  const r = resolveFamilyIssueConsensus('139', items, [0, 1, 2, 3, 4]);
  assertEq(r.mode, 'corroborated', 'prior #139 + 3/5 (60%, clear lead) -> genuinely corroborated');
  assertEq(r.issue, '139', 'issue value is "139"');
  assertEq(r.support, 3, 'support is 3');
  assertEq(r.ratio, 0.6, 'ratio is exactly 0.6');
}

{
  // prior #139 + 3/6 = 50% -> below the 60% bar -> no-consensus.
  const items = rows(['Flash #139 A', 'Flash #139 B', 'Flash #139 C', 'Flash Anniversary D', 'Flash Anniversary E', 'Flash Anniversary F']);
  const r = resolveFamilyIssueConsensus('139', items, [0, 1, 2, 3, 4, 5]);
  assertEq(r.mode, 'no-consensus', 'prior #139 + 3/6 (50%) -> no-consensus, NOT corroborated');
  assertEq(r.issue, '139', 'issue value still preserved as "139"');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 12 — BLOCKER 2: out.issue single-authority proof + VIOLATION path
// real teeth (locks the listing, forces RESEARCH, prevents LIST routing)
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 12: BLOCKER 2 — out.issue single authority + violation-teeth routing\n');

{
  // Direct expression-level proof: confirmedIssue=null, issueNum="1" ->
  // out.issue must be null, never "1". `confirmedIssue ?? null` cannot
  // reference issueNum at all — this is the literal expression api/
  // enrich.js's terminal write now uses (confirmed via source-text above).
  const confirmedIssue = null;
  const issueNum = '1'; // stale raw Vision value — must NEVER leak back in
  const outIssue = confirmedIssue ?? null;
  assertEq(outIssue, null, 'confirmedIssue=null + issueNum="1" -> out.issue=null (Immortal Hulk class: never rehydrate a stale raw value)');
}

{
  // pricingIssue != confirmedIssue (no Q83 rescue to explain it) -> a
  // genuine violation -> issueFingerprintViolation set -> forces RESEARCH,
  // non-listing bestChannel, contract.listable=false via listingHardLocked.
  const cleanItem2 = {
    title: 'Immortal Hulk', issue: '44', publisher: 'Marvel', year: 2020,
    grade: 'NM 9.4', price: 15, identityConfident: true, pricingSource: 'verified_sold',
    soldComps: [{ price: 16, daysAgo: 5 }, { price: 14, daysAgo: 20 }, { price: 15, daysAgo: 30 }],
    rawComps: { average: 15, lowest: 13, highest: 16, count: 3 },
  };
  const violation = {
    pricingIssue: '44', confirmedIssue: '1', outIssue: '1',
    pricingBoundaryOk: false, responseBoundaryOk: true,
  };
  const violatedItem = { ...cleanItem2, issueFingerprintViolation: violation };
  const decision = computeDecision(violatedItem);
  assertEq(decision.action, 'RESEARCH', `pricingIssue ("44") != confirmedIssue ("1") -> RESEARCH (got "${decision.action}")`);
  assertFalse(decision.action === 'LIST_NOW', 'pricingIssue != confirmedIssue -> NOT LIST_NOW');
  assertFalse(decision.action === 'LIST_LOW', 'pricingIssue != confirmedIssue -> NOT LIST_LOW');
  const NON_LISTING = new Set(['research', 'blocked']);
  assertTrue(NON_LISTING.has(decision.bestChannel), `bestChannel is non-listing (got "${decision.bestChannel}")`);
  assertTrue(decision.warnings.includes('issue-fingerprint-violation'), 'decision.warnings carries issue-fingerprint-violation');

  // Defense-in-depth: even independent of decisionEngine, out.listingHardLocked
  // (set alongside issueFingerprintViolation in api/enrich.js) locks the
  // contract directly via responseContract.js's deriveLocks.
  const contract = assembleContract(cleanOut({ decision, listingHardLocked: true, listingHardLockReason: 'issue-fingerprint-violation', listingHardLockBanner: 'Internal consistency check failed on issue identification — listing blocked pending review.' }));
  assertTrue(contract.locks.length > 0, 'contract carries a hard lock');
  assertTrue(contract.locks.some((l) => l.code === 'issue-fingerprint-violation'), 'lock code is issue-fingerprint-violation');
  assertFalse(contract.listable === true, 'contract.listable is false — pricing/response mismatch fully locks the listing');
}

{
  // confirmedIssue != out.issue (a hypothetical pre-response-boundary
  // failure) -> same lock, tested independently of the pre-pricing case.
  const cleanItem3 = {
    title: 'Wonder Woman', issue: '1', publisher: 'DC Comics', year: 2023,
    grade: 'NM 9.6', price: 12, identityConfident: true, pricingSource: 'verified_sold',
    soldComps: [{ price: 13, daysAgo: 5 }, { price: 11, daysAgo: 10 }, { price: 12, daysAgo: 15 }],
    rawComps: { average: 12, lowest: 10, highest: 13, count: 3 },
  };
  const violation = {
    pricingIssue: '1', confirmedIssue: '1', outIssue: '2',
    pricingBoundaryOk: true, responseBoundaryOk: false,
  };
  const violatedItem = { ...cleanItem3, issueFingerprintViolation: violation };
  const decision = computeDecision(violatedItem);
  assertEq(decision.action, 'RESEARCH', `confirmedIssue ("1") != out.issue ("2") -> RESEARCH (got "${decision.action}")`);
  const NON_LISTING2 = new Set(['research', 'blocked']);
  assertTrue(NON_LISTING2.has(decision.bestChannel), `bestChannel is non-listing (got "${decision.bestChannel}")`);
  const contract = assembleContract(cleanOut({ decision, listingHardLocked: true, listingHardLockReason: 'issue-fingerprint-violation' }));
  assertFalse(contract.listable === true, 'contract.listable is false for a pre-response-boundary violation too');
}

// Cite the exact enrich.js wiring that gives the VIOLATION path its teeth
// (not just a log line): out.listingHardLocked is set alongside
// out.issueFingerprintViolation, in the same guarded block.
{
  const enrichSrc = fs.readFileSync(path.join(__dirname, '../api/enrich.js'), 'utf8').replace(/\r\n/g, '\n');
  const teethMatch = enrichSrc.match(
    /if \(!pricingBoundaryOk \|\| !responseBoundaryOk\) \{[\s\S]{0,900}?out\.issueFingerprintViolation = \{[\s\S]{0,1000}?out\.listingHardLocked = true;/
  );
  assertTrue(!!teethMatch, 'api/enrich.js: the VIOLATION branch sets out.issueFingerprintViolation AND out.listingHardLocked together — real teeth, not just a console.log');

  const decisionEngineSrc = fs.readFileSync(path.join(__dirname, '../src/lib/decisionEngine.js'), 'utf8').replace(/\r\n/g, '\n');
  assertTrue(
    decisionEngineSrc.includes("'issue-fingerprint-violation',     // Q140 corrective dispatch: pre-pricing/pre-response mismatch"),
    'issue-fingerprint-violation is registered in decisionEngine.js criticalWarnings (forces RESEARCH via the same structural ceiling)'
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Part 13 — REVIEW ROUND 3: price authority must clear too, not just
// routing/listing. Full response-level fixture (finalizeResponse, the
// actual finalization path), not computeDecision/deriveLocks in
// isolation. Exact reviewer fixture: confirmed/display issue=139,
// pricing issue=170, calculated price=$10.77.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 13: price authority cleared through the FULL finalizeResponse pipeline\n');

{
  const buildOut = (withViolation) => {
    const out = {
      title: 'The Flash',
      issue: '139', // confirmed/display issue
      publisher: 'DC Comics',
      year: 1963,
      grade: 'VF 8.0',
      price: 10.77, // calculated against the WRONG issue (170) before detection
      priceLow: 9.5,
      priceHigh: 12.0,
      priceBands: { quick: 9.5, market: 10.77, stretch: 12.0, tier: 1, source: 'tier1_recency_weighted' },
      pricingSource: 'verified_sold_recency',
      matchConfidence: { score: 90, tier: 'HIGH' },
      identityConfident: true,
      refusedToPrice: false,
      soldComps: [{ price: 11, daysAgo: 5 }, { price: 10.5, daysAgo: 20 }, { price: 10.8, daysAgo: 30 }],
      rawComps: { count: 3, average: 10.77, lowest: 9.5, highest: 12.0 },
      soldCompDiagnostics: { rawCount: 3, verifiedCount: 3, rejectedCount: 0, reasons: {} },
    };
    if (withViolation) {
      // Mirrors EXACTLY what api/enrich.js's VIOLATION branch sets —
      // pricingIssue=170 (what comps were actually fetched/priced
      // against), confirmedIssue=139 (the real, displayed identity).
      out.issueFingerprintViolation = {
        pricingIssue: '170', confirmedIssue: '139', outIssue: '139',
        pricingBoundaryOk: false, responseBoundaryOk: true,
      };
      out.price = null;
      out.priceLow = null;
      out.priceHigh = null;
      out.priceBands = null;
      out.pricingSource = 'refused-issue-fingerprint-violation';
      out.refusedToPrice = true;
      out.confidenceLevel = 'LOW';
      out.priceNote = 'Pricing was computed against a different issue than the confirmed identity — price withheld pending review.';
      out.matchConfidence = { score: 0, tier: 'LOW' };
      out.listingHardLocked = true;
      out.listingHardLockReason = 'issue-fingerprint-violation';
      out.listingHardLockBanner = 'Internal consistency check failed on issue identification — listing blocked pending review.';
    }
    return out;
  };

  // Baseline: without the violation, this fixture WOULD show $10.77 as a
  // real, listable price — proves the clearing below is caused by the
  // violation, not some other property of the fixture.
  const baselineOut = buildOut(false);
  baselineOut.decision = computeDecision(baselineOut);
  const baselineFinal = finalizeResponse(baselineOut);
  assertEq(baselineFinal.price, 10.77, 'sanity check: baseline (no violation) genuinely shows $10.77');
  assertTrue(baselineFinal.contract.price === 10.77, 'sanity check: baseline contract.price is $10.77 too');

  // With the violation: full response-level fixture, run through the
  // ACTUAL finalization path (computeDecision -> finalizeResponse ->
  // assembleContract), exactly as api/enrich.js does at the end of the
  // request. Confirmed/display issue stays 139; pricing issue was 170.
  const violatedOut = buildOut(true);
  violatedOut.decision = computeDecision(violatedOut);
  const finalized = finalizeResponse(violatedOut);

  // Routing/listing (already proven in Parts 4/12, reconfirmed here at
  // the full response level for completeness).
  assertEq(finalized.decision.action, 'RESEARCH', `decision.action is RESEARCH (got "${finalized.decision.action}")`);
  const NON_LISTING = new Set(['research', 'blocked']);
  assertTrue(NON_LISTING.has(finalized.decision.bestChannel), `decision.bestChannel is non-listing (got "${finalized.decision.bestChannel}")`);
  assertFalse(finalized.contract.listable === true, 'contract.listable is false');
  assertTrue(finalized.listingHardLocked === true, 'out.listingHardLocked is true');

  // PRICE AUTHORITY — the actual review-round-3 requirement.
  assertEq(finalized.price, null, `out.price is null, NOT $10.77 (got ${JSON.stringify(finalized.price)}) — the misleading "Recommended: $10.77" never ships`);
  assertEq(finalized.priceLow, null, 'out.priceLow is null');
  assertEq(finalized.priceHigh, null, 'out.priceHigh is null');
  assertEq(finalized.priceBands, null, 'out.priceBands is null');
  assertEq(finalized.decision.price, null, `out.decision.price is null (got ${JSON.stringify(finalized.decision.price)}) — finalizeResponse overwrites ANY interim RESEARCH-tier price computeDecision itself may have derived from rawComps.average`);
  assertEq(finalized.contract.price, null, 'contract.price is null');
  assertEq(finalized.contract.bands, null, 'contract.bands is null');
  assertEq(finalized.contract.state, 'REFUSED', `contract.state is REFUSED (got "${finalized.contract.state}") — the Customer-Grade Standard P0 rule ("Refused states: render $0/nothing everywhere") applies`);
  assertTrue(finalized.contract.locks.some((l) => l.code === 'refused'), 'contract.locks includes the "refused" lock (from refusedToPrice)');
  assertTrue(finalized.contract.locks.some((l) => l.code === 'issue-fingerprint-violation'), 'contract.locks ALSO includes "issue-fingerprint-violation" (belt-and-suspenders, both lock mechanisms fire independently)');

  // priceVerified / verified-FMV status = false — this codebase's live
  // "is this price trustworthy" signal is matchConfidence (GoCollect CGC
  // FMV is dormant per CLAUDE.md, not a real field to clear).
  assertEq(finalized.matchConfidence.tier, 'LOW', `matchConfidence.tier is LOW (got "${finalized.matchConfidence.tier}") — no longer presentable as a verified/HIGH-confidence price`);
  assertEq(finalized.matchConfidence.score, 0, 'matchConfidence.score is 0');
  assertEq(finalized.pricingSource, 'refused-issue-fingerprint-violation', `pricingSource is relabeled (got "${finalized.pricingSource}") — never presented as verified_sold_recency/Recommended/Market/Verified FMV`);

  // Display issue stays 139 throughout — the violation clears PRICE
  // authority, never identity itself (that was already correctly locked
  // to confirmedIssue by the terminal fingerprint invariant, proven in
  // Parts 1-3/10).
  assertEq(finalized.issue, '139', 'displayed issue remains "139" (the confirmed identity) throughout — only price authority was cleared');
}

// Cite the exact ordering: pricing runs BEFORE the violation can be
// detected (out.issue must be FINAL first) — this block retroactively
// clears an already-computed price, it does not prevent computation.
{
  const enrichSrc = fs.readFileSync(path.join(__dirname, '../api/enrich.js'), 'utf8').replace(/\r\n/g, '\n');
  const pricingCallIdx = enrichSrc.indexOf('issue: confirmedIssue,\n              grade,\n              isGraded,');
  const violationBlockIdx = enrichSrc.indexOf('out.price = null;\n      out.priceLow = null;\n      out.priceHigh = null;\n      out.priceBands = null;\n      out.pricingSource = \'refused-issue-fingerprint-violation\';');
  // The actual call (not this test's own citation comment a few lines
  // above the violation block, which also contains the literal text
  // "out.decision = computeDecision(...)") — searched for specifically
  // AFTER violationBlockIdx so an earlier comment mention can't win.
  const computeDecisionIdx = enrichSrc.indexOf('out.decision = computeDecision(out, {\n', violationBlockIdx);
  assertTrue(pricingCallIdx !== -1 && violationBlockIdx !== -1 && computeDecisionIdx !== -1, 'all three anchor points found in api/enrich.js source');
  assertTrue(pricingCallIdx < violationBlockIdx, 'ORDERING: the fetchComps({issue: confirmedIssue, ...}) pricing call runs BEFORE the violation-detection/price-clearing block — pricing is necessarily computed first, then retroactively cleared, never prevented from running');
  assertTrue(violationBlockIdx < computeDecisionIdx, 'ORDERING: the price-clearing block runs BEFORE out.decision = computeDecision(...) — decision/contract finalization always see the CLEARED state, never the stale price');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
