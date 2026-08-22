// tests/gk159-commit4-terminal-floor.test.js
//
// GK-159 (2026-08-22) — "commit4-terminal floors instead of clears."
//
// computeIssueAuthorityContractPatch (src/lib/issueAuthority.js) — the
// function this codebase calls "commit4-terminal" — cleared price to null
// and forced ID_REQUIRED-class contract state the instant
// issueAuthority.status was 'conflicted', regardless of whether a real
// price had already been computed. Every SIBLING contested facet
// (variant AR/GK-129, year AT/GK-135, title AV/GK-133, and issue itself
// via GK-152's own deriveMarketStanding floor, src/lib/actionAuthority.js)
// already lands a contested-but-priced book at marketStanding=
// SIMILAR_ONLY / actionAuthority.state=REVIEW — price stays visible,
// only READY is withheld. commit4-terminal was the one facet still
// CLEARING instead of flooring.
//
// FIX: when priorOut already carries a real, computed price,
// computeIssueAuthorityContractPatch's issueConflicted branch now returns
// `{ marketStandingFloored: true }` — a patch that touches NOTHING
// price-related (price/priceLow/priceHigh/priceBands/matchConfidence/
// pricingSource/confidenceLevel all stay exactly as the pipeline computed
// them) and does NOT set identityConfident/refusedToPrice/
// listingHardLocked. Genuine no-price scans (priorOut has no computed
// price) fall through to the ORIGINAL, byte-identical hard-clear branch.
// issueProvisional and yearOnlyProvisional are UNCHANGED — this fix is
// scoped to issueConflicted only.
//
// Invoke: node tests/gk159-commit4-terminal-floor.test.js

import { computeIssueAuthorityContractPatch } from '../src/lib/issueAuthority.js';
import { assembleContract, deriveLocks } from '../src/lib/responseContract.js';
import { deriveMarketStanding, deriveActionAuthority } from '../src/lib/actionAuthority.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}\n    expected: ${e}\n    actual:   ${a}`; failures.push(m); console.log(m); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);

console.log('\n=== GK-159 — commit4-terminal floors instead of clears ===\n');

// ═══════════════════════════════════════════════════════════════════════
// PART 1 — computeIssueAuthorityContractPatch, direct unit coverage.
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 1: computeIssueAuthorityContractPatch — the floor patch itself\n');

const priced = { price: '$32.00', pricingSource: 'active_ask_derived' };
const floorPatch = computeIssueAuthorityContractPatch({ status: 'conflicted' }, priced, null);
assertEq(floorPatch, { marketStandingFloored: true }, 'conflicted + real price -> the floor patch, and ONLY the floor marker (no price/source fields)');

// Blocking fixture: the AWW shape — a real, non-trivial price already
// computed, issueAuthority conflicted.
const awwOut = { price: '$32.00', pricingSource: 'active_ask_derived' };
const awwPatch = computeIssueAuthorityContractPatch({ status: 'conflicted', reasons: ['issue-evidence-contested'] }, awwOut, null);
assertEq(awwPatch, { marketStandingFloored: true }, 'AWW shape: floor patch fires, price/pricingSource untouched by the patch itself');

// Genuine no-price scan — completely unchanged, byte-identical hard clear.
const noPriceOut = { price: null, pricingSource: null };
const clearPatch = computeIssueAuthorityContractPatch({ status: 'conflicted' }, noPriceOut, null);
assertEq(clearPatch.pricingSource, 'refused-issue-authority-conflicted', 'genuine no-price scan: pricingSource still becomes the synthetic refused string (unchanged)');
assertEq(clearPatch.price, null, 'genuine no-price scan: price still nulled (unchanged)');
assertEq(clearPatch.refusedToPrice, true, 'genuine no-price scan: refusedToPrice still true (unchanged)');
assertEq(clearPatch.identityConfident, false, 'genuine no-price scan: identityConfident still false (unchanged)');
assertEq(clearPatch.listingHardLocked, true, 'genuine no-price scan: listingHardLocked still true (unchanged)');
assertEq(clearPatch.listingHardLockReason, 'issue-authority-conflicted', 'genuine no-price scan: listingHardLockReason unchanged');

// A price string that parses to exactly 0 is NOT "no price" in the sense
// this fix cares about at the boundary others use (parsePriceNumber),
// but 0 is not a realistic priced-book value either — verifying the
// boundary is governed by parsePriceNumber's own null-check, not a
// truthiness check that would treat "$0.00" as absent.
const zeroPriceOut = { price: '$0.00', pricingSource: 'active_ask_derived' };
const zeroPatch = computeIssueAuthorityContractPatch({ status: 'conflicted' }, zeroPriceOut, null);
assertEq(zeroPatch, { marketStandingFloored: true }, 'a parseable (even if zero) price still counts as "computed" -> floor patch, not the hard clear');

// ═══════════════════════════════════════════════════════════════════════
// PART 2 — negative controls: sibling branches are byte-identical,
// completely unaffected by this fix.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: negative controls — sibling branches untouched\n');

const provisionalWithPrice = computeIssueAuthorityContractPatch({ status: 'provisional' }, { price: '$10.00' }, null);
assertEq(provisionalWithPrice.pricingSource, 'refused-issue-authority-provisional', 'issueProvisional (unrelated facet) still hard-clears even with a real price — scope is issueConflicted ONLY');
assertEq(provisionalWithPrice.price, null, 'issueProvisional still nulls price — unchanged');

const provisionalHighConfidence = computeIssueAuthorityContractPatch(
  { status: 'provisional', highConfidenceMarketplaceConsensus: true },
  { price: '$10.00' },
  null
);
assertEq(
  provisionalHighConfidence,
  {
    listingHardLocked: true,
    listingHardLockReason: 'issue-authority-provisional-high-confidence',
    listingHardLockBanner:
      "This book's issue number was inferred from marketplace listings alone, but a strong, internally-consistent " +
      'consensus (no competing family, no contamination, full title-token overlap) backs it — price shown, ' +
      'listing still requires confirmation.',
  },
  'the P1 commit-p high-confidence carve-out (a DIFFERENT existing soft patch) is byte-identical, untouched by this fix'
);

const yearOnlyPatch = computeIssueAuthorityContractPatch(null, { price: '$10.00' }, ['year']);
assertEq(yearOnlyPatch.pricingSource, 'refused-year-authority-provisional', 'yearOnlyProvisional (no issueAuthority at all, year-only) still hard-clears — unchanged, out of this fix\'s scope');
assertEq(yearOnlyPatch.price, null, 'yearOnlyProvisional still nulls price — unchanged');

const alreadyRefused = computeIssueAuthorityContractPatch({ status: 'conflicted' }, { price: '$32.00', refusedToPrice: true }, null);
assertEq(alreadyRefused, null, 'priorOut.refusedToPrice already true upstream -> still short-circuits to null, even with a price present and issueConflicted (unchanged precedence)');

const notProvisionalAtAll = computeIssueAuthorityContractPatch({ status: 'confirmed' }, { price: '$32.00' }, null);
assertEq(notProvisionalAtAll, null, 'issueAuthority.status="confirmed" -> no patch at all (unchanged)');

// ═══════════════════════════════════════════════════════════════════════
// PART 3 — end-to-end integration: the AWW shape through the REAL
// downstream contract/actionAuthority machinery (untouched by this fix,
// GK-152's own floor + GK-152's own soft lock do the rest).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: end-to-end — AWW shape through deriveMarketStanding/deriveActionAuthority/assembleContract\n');

const awwFinalOut = {
  price: '$32.00',
  pricingSource: 'active_ask_derived',
  issueAuthority: { status: 'conflicted', source: 'marketplace', reasons: ['issue-evidence-contested'] },
  variantApplicability: null,
  decision: { action: 'LIST_LOW', confidence: 'medium', blockers: [], warnings: [], nextStep: 'x' },
};

assertEq(deriveMarketStanding(awwFinalOut), 'SIMILAR_ONLY', 'marketStanding floors to SIMILAR_ONLY (GK-152\'s own floor, untouched)');

const awwLocks = deriveLocks(awwFinalOut);
assertTrue(awwLocks.some((l) => l.code === 'market-standing-issue-contested' && l.hard === false && l.class === 'insufficiency'), 'the market-standing-issue-contested soft lock fires (GK-152\'s own lock, untouched) — hard:false so it never forces LOCKED');

const awwActionAuthority = deriveActionAuthority(awwFinalOut, awwLocks, awwFinalOut.decision);
assertEq(awwActionAuthority.state, 'REVIEW', 'SHIP-BLOCKING: actionAuthority.state === REVIEW, never LOCKED/ID_REQUIRED/READY');
assertEq(awwActionAuthority.marketStanding, 'SIMILAR_ONLY', 'actionAuthority.marketStanding === SIMILAR_ONLY');
assertTrue(awwActionAuthority.reasonCodes.includes('ISSUE_CONTESTED'), `actionAuthority.reasonCodes includes ISSUE_CONTESTED (actual: ${JSON.stringify(awwActionAuthority.reasonCodes)})`);

const awwContract = assembleContract(awwFinalOut);
assertEq(awwContract.price, 32, 'SHIP-BLOCKING: contract.price === 32 (the AWW blocking fixture\'s own ~$32) — preserved, never nulled');
assertTrue(awwContract.state !== 'ID_REQUIRED' && awwContract.state !== 'REFUSED', `contract.state is neither ID_REQUIRED nor REFUSED (actual: ${awwContract.state})`);
assertTrue(awwContract.state !== 'PRICED', `contract.state never claims the strict PRICED tier from an ask-derived source (actual: ${awwContract.state})`);
assertEq(awwContract.listable, false, 'contract.listable === false — never READY/EXACT from this path');

// ═══════════════════════════════════════════════════════════════════════
// PART 4 — control: genuine no-price scan through the SAME downstream
// machinery still renders ID_REQUIRED/REFUSED with price null everywhere
// (I1 invariant) — this fix changes nothing about that case.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 4: control — genuine no-consensus/no-price scan still refuses fully\n');

const genuineRefuseOut = {
  ...computeIssueAuthorityContractPatch({ status: 'conflicted' }, { price: null, pricingSource: null }, null),
  issueAuthority: { status: 'conflicted' },
  decision: { action: 'ID_REQUIRED', confidence: 'LOW', blockers: [], warnings: [], nextStep: '' },
};
const genuineContract = assembleContract(genuineRefuseOut);
assertEq(genuineContract.state, 'ID_REQUIRED', 'CONTROL: a genuine no-price conflicted scan still renders ID_REQUIRED');
assertEq(genuineContract.price, null, 'CONTROL: price still null everywhere (I1 invariant) — this fix never applies without a real prior price');
assertEq(genuineContract.listable, false, 'CONTROL: not listable');

// ═══════════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════════
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
if (failed === 0) {
  console.log(`✓ All tests passed (${passed} assertions)`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  process.exit(0);
} else {
  console.log(`✗ ${failed} test(s) failed, ${passed} passed`);
  console.log('\nFailures:');
  failures.forEach((f) => console.log(f));
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  process.exit(1);
}
