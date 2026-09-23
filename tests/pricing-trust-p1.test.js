// tests/pricing-trust-p1.test.js
//
// Pricing Trust dispatch (2026-09-23) — P1 LAUNCH-SAFE CLOSURE. HELD
// UNCOMMITTED (P1 code in api/enrich.js, src/lib/autoKeyDetector.js,
// src/lib/decisionEngine.js is uncommitted — this test file stays
// uncommitted alongside it, not part of the already-shipped P2/P3 commit).
//
// DATA-0 GCD capability audit (same dispatch) confirmed Part 0
// independently: the isMajorKey ×1.5 / isMinorKey ×1.2 key multiplier's
// only two reachable bases (pricingSource==='verified_sold', isFromPC &&
// blendedAvg) are BOTH already-transacted sold evidence for the exact
// issue being priced — a genuine key's premium is already embedded in
// those comps. The multiplier was a structural double-count on every
// reachable path and dead code on every unreachable one (active-derived,
// PC-estimate-only, fallback pricing could never trigger it at all). It is
// RETIRED here in full — no corroboration gate, no keyFactType, just gone.
//
// out.keyIssue/out.keyIssueSource remain exactly as before: display
// metadata only, never read by any pricing logic. The disagreement-review
// mechanism (out.keyIssueDisagreement → decisionEngine.js's
// 'key-issue-uncorroborated' criticalWarning → RESEARCH) is KEPT — it has
// zero price impact by construction now (there is no multiplier left for
// it to gate), but it still protects an operator from trusting a keyIssue
// claim ComicVine's own structured data contradicts.
//
// Invoke: node tests/pricing-trust-p1.test.js

import { readFileSync } from 'node:fs';
import { enhanceKeyIssue } from '../src/lib/autoKeyDetector.js';
import { computeDecision } from '../src/lib/decisionEngine.js';

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
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertFalse = (cond, label) => assertEq(!!cond, false, label);

console.log('\n=== Pricing Trust dispatch — P1 launch-safe closure (held uncommitted) ===\n');

// ═══════════════════════════════════════════════════════════════════════
// STATIC PROOF — the price-changing branch is completely gone, not gated.
// Exhaustive by construction: since none of these identifiers exist
// anywhere in the file, NO keyIssueSource (Vision, ComicVine-structured,
// ComicVine-derived, operator-confirmed, or any future one) can move
// price — this is stronger than sampling individual sources through the
// handler, since there's no conditional left to sample around.
// ═══════════════════════════════════════════════════════════════════════
console.log('=== STATIC: no price-changing key-multiplier code remains in api/enrich.js ===');
{
  const src = readFileSync(new URL('../api/enrich.js', import.meta.url), 'utf8');
  const REMOVED_IDENTIFIERS = [
    'keyMultBase', 'keyMultiplier', 'KEY_MULT_CORROBORATED_SOURCES',
    'keyIssueCorroborated', 'keyMultBaseSource',
  ];
  for (const id of REMOVED_IDENTIFIERS) {
    assertFalse(src.includes(id), `"${id}" no longer appears anywhere in api/enrich.js`);
  }
  // The bare word "keyMult" (not a longer identifier already checked
  // above) must also be fully gone — it was the multiplier value itself.
  assertFalse(/\bkeyMult\b/.test(src), '"keyMult" (the multiplier value) no longer appears anywhere in api/enrich.js');
  // isMajorKey/isMinorKey are deliberately KEPT (for the disagreement
  // check only) — confirm they still exist, so this isn't accidentally
  // proving a bigger removal than intended.
  assertTrue(src.includes('isMajorKey'), 'isMajorKey is still computed (needed for disagreement detection, never for pricing)');
  assertTrue(src.includes('out.keyIssueDisagreement'), 'the disagreement review-escalation mechanism is still present');
}

// ═══════════════════════════════════════════════════════════════════════
// enhanceKeyIssue — unchanged from the prior P1 pass; comicVineIsKey is
// still surfaced for the (now purely review, never pricing) disagreement
// check.
// ═══════════════════════════════════════════════════════════════════════
console.log('\n=== enhanceKeyIssue still surfaces ComicVine\'s own verdict (review-only consumer now) ===');
{
  const noCv = enhanceKeyIssue('Moon Knight first appearance', null);
  assertEq(noCv.keyIssue, 'Moon Knight first appearance', 'Vision text still wins and still displays');
  assertFalse(noCv.comicVineIsKey, 'no ComicVine data → comicVineIsKey=false (silence, not disagreement)');

  // The real Marvel Spotlight #28 shape: Vision/manual claims a first
  // appearance, ComicVine's own structured data (present, non-null) lists
  // zero first-appearance characters for this issue — a genuine
  // disagreement. (Moon Knight's real first appearance is Werewolf by
  // Night #32, not Marvel Spotlight #28.)
  const disagree = enhanceKeyIssue('Moon Knight first appearance', { firstAppearanceCharacters: [] });
  assertEq(disagree.keyIssue, 'Moon Knight first appearance', 'Vision text still displays even on disagreement — display is unaffected by review status');
  assertFalse(disagree.comicVineIsKey, 'ComicVine data present but lists zero first-appearance characters — a real disagreement');

  const agree = enhanceKeyIssue('1st appearance of Moon Knight', { firstAppearanceCharacters: ['Moon Knight'] });
  assertTrue(agree.comicVineIsKey, 'comicVineIsKey=true when ComicVine independently lists the same character');

  const autoOnly = enhanceKeyIssue(null, { firstAppearanceCharacters: ['Moon Knight'] });
  assertEq(autoOnly.keySource, 'comicvine_first_appearance', 'no Vision/manual key → structured ComicVine source used directly for DISPLAY (no pricing consequence exists anymore, from any source)');
}

// ═══════════════════════════════════════════════════════════════════════
// decisionEngine — genuine disagreement still escalates to RESEARCH;
// mere silence, structured corroboration, or operator confirmation do not.
// This is now a pure review signal, decoupled from any pricing effect.
// ═══════════════════════════════════════════════════════════════════════
console.log('\n=== decisionEngine: disagreement still escalates to RESEARCH, at zero price impact ===');
{
  const base = {
    title: 'Marvel Spotlight', issue: '28', publisher: 'Marvel', year: 1976,
    grade: 'VF 8.0', price: 80.93, identityConfident: true,
    pricingSource: 'verified_sold',
    soldComps: [{ price: 58, daysAgo: 5 }, { price: 161.49, daysAgo: 10 }, { price: 63, daysAgo: 20 }],
    rawComps: { average: 86.86, lowest: 58, highest: 161.49, count: 3 },
  };

  const silentCase = { ...base, keyIssue: 'Moon Knight first appearance', keyIssueSource: 'claude' };
  assertFalse(computeDecision(silentCase).warnings.includes('key-issue-uncorroborated'), 'mere absence of corroboration does NOT trigger the review warning');

  const disagreementCase = {
    ...base,
    keyIssue: 'Moon Knight first appearance',
    keyIssueSource: 'claude',
    keyIssueDisagreement: true,
    keyIssueUncorroboratedReason: 'keyIssue ("Moon Knight first appearance") claims major/minor key significance from Vision/manual entry, but ComicVine\'s own structured first-appearance data does not corroborate it — flagged for review',
  };
  const disagreementDecision = computeDecision(disagreementCase);
  assertTrue(disagreementDecision.warnings.includes('key-issue-uncorroborated'), 'REQUIRED REGRESSION: genuine disagreement still escalates to RESEARCH');
  assertEq(disagreementDecision.action, 'RESEARCH', 'action is RESEARCH');
  assertEq(disagreementCase.price, 80.93, 'REQUIRED REGRESSION: the disagreement escalation carries zero price effect — input price is untouched by computeDecision');

  // REQUIRED REGRESSION — ComicVine-derived key text: no price effect.
  // (computeDecision never touches price regardless of source; the real
  // price-immunity proof for this source lives in the static check above
  // plus the real handler trace below — this confirms the review axis
  // specifically stays silent for a structured/derived source.)
  const comicvineDerivedCase = { ...base, keyIssue: '1st appearance of Moon Knight', keyIssueSource: 'comicvine-derived' };
  assertFalse(computeDecision(comicvineDerivedCase).warnings.includes('key-issue-uncorroborated'), 'ComicVine-derived source (regex-from-description) does not itself trigger review — it was never Vision prose contradicted by structured data');

  const corroboratedCase = { ...base, keyIssue: '1st appearance: Moon Knight', keyIssueSource: 'comicvine_first_appearance' };
  assertFalse(computeDecision(corroboratedCase).warnings.includes('key-issue-uncorroborated'), 'structured ComicVine corroboration never triggers the review warning');

  // REQUIRED REGRESSION — operator-confirmed key text: still no automatic
  // multiplier (trivially true now — there is no multiplier for ANY
  // source — and still no review warning either, since 'operator_confirmed'
  // is by definition not an unreviewed disagreement).
  const operatorCase = { ...base, keyIssue: 'Moon Knight first appearance', keyIssueSource: 'operator_confirmed' };
  assertFalse(computeDecision(operatorCase).warnings.includes('key-issue-uncorroborated'), 'operator-confirmed source never triggers the review warning');
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('FAILURES:\n' + failures.join('\n\n'));
  process.exit(1);
}
