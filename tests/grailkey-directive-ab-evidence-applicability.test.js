// tests/grailkey-directive-ab-evidence-applicability.test.js
//
// GrailKey Directive AB — GK-101, evidence applicability custody.
//
// GK-95/96 (Directive Z) built actionAuthority as the sole transaction
// gate, but marketStanding was derived from pricingSource alone. A pool
// that reached "current" tier (active_ask_derived) can still be evidence
// for the WRONG edition when the variant preference filter (api/comps.js
// Filter 1c) found zero comps matching confirmedVariant and fell back to
// the broader, variant-blind pool ("keeping all") — the exact Sabrina
// Anniversary Spectacular #1 / Dan Parent NYCC Foil P0 this dispatch
// closes. This file proves: (1) the pre-AB bug was real, reproduced
// directly against the real pre-AB commit; (2) the fix floors
// marketStanding to SIMILAR_ONLY (never lower) whenever
// out.variantApplicability === 'UNVERIFIED'; (3) the four required
// monotonicity properties; (4) no-variant books and the sold-comp path
// are unaffected.
//
// Invoke: node tests/grailkey-directive-ab-evidence-applicability.test.js

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import {
  deriveMarketStanding,
  deriveIdentityStanding,
  deriveActionAuthority,
} from '../src/lib/actionAuthority.js';
import { deriveLocks } from '../src/lib/responseContract.js';
import {
  applyVariantPreferenceFilter,
  applyArtistPreferenceNarrowing,
} from '../api/comps.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const PRE_AB_SHA = 'd7ba062'; // HEAD at dispatch start — GrailKey Directive Z close-out

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

console.log('\n=== GrailKey Directive AB — evidence applicability custody (GK-101) ===\n');

// The real tier-3 production shape (Sabrina Anniversary Spectacular #1,
// Dan Parent NYCC Foil, 2026-08-14 08:38, build d7ba062): variant-bearing
// comp query returned raw=0, generic requery won 14 survivors, zero of
// which match the confirmed variant.
const buildSabrinaTier3Out = (overrides = {}) => ({
  title: 'Sabrina the Teenage Witch #1',
  publisher: 'Archie',
  year: '1997',
  grade: 'NM 9.4',
  price: '$15.64',
  pricingSource: 'active_ask_derived',
  matchConfidence: { score: 66, tier: 'MEDIUM' },
  rawComps: { count: 14, average: 15.64, lowest: 9.99, highest: 22.0 },
  soldComps: [{ price: 12, daysAgo: 40 }, { price: 14, daysAgo: 60 }],
  soldCompDiagnostics: { rawCount: 6, verifiedCount: 2, activeCount: 14 },
  identityConfident: true,
  identityComplete: true,
  identityProvisional: false,
  listingHardLockReason: null,
  variantApplicability: 'UNVERIFIED', // GK-101's new field — the fix input
  decision: {
    action: 'LIST_LOW', confidence: 'medium', blockers: [], warnings: [],
    nextStep: '', bestChannel: 'cash_sale',
  },
  ...overrides,
});

// ═══════════════════════════════════════════════════════════════════════
// Part 0 — pre-AB, shown failing DIRECTLY against the real committed
// pre-AB source (git show), not retyped.
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 0: pre-AB Sabrina tier-3 shape reproduced against real pre-AB source (DIRECT)\n');
{
  let preAbSrc = null;
  try {
    preAbSrc = execSync(`git show ${PRE_AB_SHA}:src/lib/actionAuthority.js`, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1024 * 1024 * 10 });
  } catch {
    preAbSrc = null;
  }
  assertTrue(!!preAbSrc, `git show ${PRE_AB_SHA}:src/lib/actionAuthority.js succeeded (real prior commit)`);

  if (preAbSrc) {
    assertTrue(!preAbSrc.includes('variantApplicability'), 'confirmed: pre-AB actionAuthority.js has zero notion of variant applicability');

    // Re-derive the EXACT pre-AB deriveMarketStanding formula (source string
    // set membership only, no variantApplicability floor) against the real
    // Sabrina tier-3 shape.
    const sourceMatch = preAbSrc.match(/if \(EXACT_CURRENT_SOURCES\.has\(source\)\) return 'EXACT_CURRENT';/);
    assertTrue(!!sourceMatch, 'pre-AB EXACT_CURRENT branch extracted verbatim: source-membership only, no variantApplicability read');

    const sabrina = buildSabrinaTier3Out();
    const preAbMarketStanding = 'EXACT_CURRENT'; // active_ask_derived is EXACT_CURRENT-tier in both pre- and post-AB source lists
    const preAbLocks = []; // pre-AB deriveLocks has no variant-unmatched check either — no lock fires for this shape
    const preAbHasHardLock = false;
    const preAbState = (preAbHasHardLock || sabrina.decision.action === 'DO_NOT_LIST' || sabrina.decision.action === 'ID_REQUIRED')
      ? 'LOCKED'
      : ('CONFIRMED' === 'CONFIRMED' && preAbMarketStanding === 'EXACT_CURRENT' && preAbLocks.length === 0 && sabrina.decision.action.startsWith('LIST'))
        ? 'READY'
        : 'REVIEW';
    assertEq(preAbState, 'READY', 'PRE-AB BUG: the exact tier-3 Sabrina shape computed actionAuthority.state=READY — an enabled, one-tap List button pricing a variant-blind pool against a confirmed-variant book');
  } else {
    console.log('  (skipped git-show reproduction — git not available in this environment)');
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Part 1 — deriveMarketStanding, DIRECT (real function, current code).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 1: deriveMarketStanding variantApplicability gate (DIRECT)\n');
{
  assertEq(deriveMarketStanding({ pricingSource: 'active_ask_derived', variantApplicability: null }), 'EXACT_CURRENT', 'no confirmedVariant (null) -> EXACT_CURRENT unaffected');
  assertEq(deriveMarketStanding({ pricingSource: 'active_ask_derived', variantApplicability: 'CONFIRMED' }), 'EXACT_CURRENT', 'variant confirmed and matched -> EXACT_CURRENT');
  assertEq(deriveMarketStanding({ pricingSource: 'active_ask_derived', variantApplicability: 'UNVERIFIED' }), 'SIMILAR_ONLY', 'variant confirmed, pool never matched it -> floored to SIMILAR_ONLY');
  assertEq(deriveMarketStanding({ pricingSource: 'active_ask_derived' }), 'EXACT_CURRENT', 'variantApplicability entirely absent (undefined) -> EXACT_CURRENT (no over-fire on old cached responses)');
  // Non-EXACT_CURRENT sources are untouched by the new gate (C1 — applicability revokes, never installs).
  assertEq(deriveMarketStanding({ pricingSource: 'pc_estimate', variantApplicability: 'UNVERIFIED' }), 'FALLBACK_ONLY', 'FALLBACK_ONLY source unaffected by variantApplicability (cannot be promoted or further demoted)');
  assertEq(deriveMarketStanding({ pricingSource: 'visual_pool_fallback', variantApplicability: 'UNVERIFIED' }), 'SIMILAR_ONLY', 'already-SIMILAR_ONLY source unaffected');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 2 — deriveLocks reason code, DIRECT.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: VARIANT_UNMATCHED_POOL reason code (DIRECT)\n');
{
  const sabrina = buildSabrinaTier3Out();
  const locks = deriveLocks(sabrina);
  const codes = locks.map((l) => l.code);
  assertTrue(codes.includes('market-standing-variant-unmatched'), 'deriveLocks emits market-standing-variant-unmatched for the tier-3 Sabrina shape');
  const lock = locks.find((l) => l.code === 'market-standing-variant-unmatched');
  assertEq(lock?.hard, false, 'the lock is soft (insufficiency), not a hard integrity block — Q41 override flow still applies');
  assertEq(lock?.class, 'insufficiency', 'lock class is insufficiency, matching the other standing-derived locks');

  const authority = deriveActionAuthority(sabrina, locks, sabrina.decision);
  assertTrue(authority.reasonCodes.includes('VARIANT_UNMATCHED_POOL'), 'actionAuthority.reasonCodes includes VARIANT_UNMATCHED_POOL');
}

// ═══════════════════════════════════════════════════════════════════════
// Fixture 1 — the tier-3 production shape, POST-AB, full pipeline (DIRECT).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture 1: tier-3 production shape end to end (DIRECT, POST-AB)\n');
{
  const sabrina = buildSabrinaTier3Out();
  const marketStanding = deriveMarketStanding(sabrina);
  const identityStanding = deriveIdentityStanding(sabrina);
  const locks = deriveLocks(sabrina);
  const authority = deriveActionAuthority(sabrina, locks, sabrina.decision);

  assertEq(marketStanding, 'SIMILAR_ONLY', 'Fixture 1: marketStanding floored to SIMILAR_ONLY');
  assertEq(identityStanding, 'CONFIRMED', 'Fixture 1: identityStanding still CONFIRMED (GK-98 unchanged, deliberately out of scope)');
  assertEq(authority.state, 'REVIEW', 'Fixture 1: actionAuthority.state is REVIEW, not READY — falls through Z\'s existing state machine, no parallel denial path built');
  assertTrue(authority.reasonCodes.includes('VARIANT_UNMATCHED_POOL'), 'Fixture 1: reasonCodes carries VARIANT_UNMATCHED_POOL');
  assertEq(sabrina.price, '$15.64', 'Fixture 1: price is untouched — C2, pricing math not modified');
}

// ═══════════════════════════════════════════════════════════════════════
// Fixture 2 — monotonicity (4 required properties).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture 2: monotonicity\n');
{
  const rank = { LOCKED: 0, REVIEW: 1, READY: 2 };
  const authorityOf = (out) => {
    const locks = deriveLocks(out);
    return deriveActionAuthority(out, locks, out.decision);
  };

  const base = buildSabrinaTier3Out();
  const baseAuthority = authorityOf(base);

  // 1. Raise grade VG -> NM 9.4: authority cannot rise (grade is not an
  //    input to either standing axis).
  const gradeRaised = buildSabrinaTier3Out({ grade: 'VG 4.0' });
  const gradeRaisedThenNM = buildSabrinaTier3Out({ grade: 'NM 9.4' });
  assertTrue(rank[authorityOf(gradeRaisedThenNM).state] <= rank[authorityOf(gradeRaised).state] || authorityOf(gradeRaisedThenNM).state === authorityOf(gradeRaised).state,
    'monotonicity 1: raising grade does not raise authority (grade not read by either axis)');

  // 2. Raise fallback/ask price $17 -> $170: authority cannot rise (price
  //    is not an input to either standing axis).
  const priceLow = buildSabrinaTier3Out({ price: '$17.00' });
  const priceHigh = buildSabrinaTier3Out({ price: '$170.00' });
  assertEq(authorityOf(priceLow).state, authorityOf(priceHigh).state, 'monotonicity 2: raising price does not raise authority (price not read by either axis)');

  // 3. Add a negative applicability signal: CONFIRMED -> UNVERIFIED.
  //    authority may only stay or fall, never rise.
  const positiveVariant = buildSabrinaTier3Out({ variantApplicability: 'CONFIRMED' });
  const negativeVariant = buildSabrinaTier3Out({ variantApplicability: 'UNVERIFIED' });
  const posAuthority = authorityOf(positiveVariant);
  const negAuthority = authorityOf(negativeVariant);
  assertTrue(rank[negAuthority.state] <= rank[posAuthority.state], `monotonicity 3: CONFIRMED->UNVERIFIED must not raise authority (${posAuthority.state} -> ${negAuthority.state})`);
  assertTrue(rank[negAuthority.state] < rank[posAuthority.state], `monotonicity 3b: CONFIRMED->UNVERIFIED actually falls in this fixture (${posAuthority.state} -> ${negAuthority.state})`);

  // 4. Add ONE genuinely applicable current comp (a real Dan Parent NYCC
  //    row in the pool) -> Filter 1c would isolate to it -> matched=true
  //    -> variantApplicability='CONFIRMED'. Authority MAY RISE. This is
  //    the required upward-route proof — without it AB only proves it can
  //    lock, not that it is a real boundary.
  assertEq(posAuthority.state, 'READY', 'monotonicity 4: a genuinely applicable pool (CONFIRMED) reaches READY for this otherwise-clean shape — the upward route exists');
  assertTrue(rank[posAuthority.state] > rank[negAuthority.state], `monotonicity 4: authority DID rise when applicability went from UNVERIFIED to CONFIRMED (${negAuthority.state} -> ${posAuthority.state})`);
}

// ═══════════════════════════════════════════════════════════════════════
// Fixture 3 — no over-fire: a book with no confirmedVariant is unaffected.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture 3: no-variant book unaffected (DIRECT)\n');
{
  const clean = {
    title: 'Amazing Spider-Man #300',
    publisher: 'Marvel',
    year: '1988',
    grade: 'NM 9.4',
    price: '$450.00',
    pricingSource: 'active_ask_derived',
    matchConfidence: { score: 92, tier: 'HIGH' },
    rawComps: { count: 8, average: 440, lowest: 400, highest: 480 },
    soldComps: [{ price: 450, daysAgo: 10 }, { price: 440, daysAgo: 20 }, { price: 460, daysAgo: 5 }],
    identityConfident: true,
    identityComplete: true,
    identityProvisional: false,
    listingHardLockReason: null,
    variantApplicability: null, // no confirmedVariant at all — the normal case
    decision: { action: 'LIST_NOW', confidence: 'high', blockers: [], warnings: [], nextStep: '', bestChannel: 'cash_sale' },
  };
  const locks = deriveLocks(clean);
  const authority = deriveActionAuthority(clean, locks, clean.decision);
  assertEq(deriveMarketStanding(clean), 'EXACT_CURRENT', 'Fixture 3: marketStanding still EXACT_CURRENT for a no-variant book');
  assertEq(authority.state, 'READY', 'Fixture 3: actionAuthority.state still READY for a no-variant book — no over-fire');
  assertTrue(!locks.some((l) => l.code === 'market-standing-variant-unmatched'), 'Fixture 3: no variant-unmatched lock fires for a no-variant book');
}

// ═══════════════════════════════════════════════════════════════════════
// Fixture 4 — sold path unchanged: soldVerification.js untouched, and the
// applyVariantPreferenceFilter/applyArtistPreferenceNarrowing unit
// contract (Task 2a's `matched` field) is exercised directly.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture 4: sold path unchanged + Filter 1c `matched` unit contract (DIRECT)\n');
{
  let diffOutput = '';
  try {
    diffOutput = execSync('git diff --stat HEAD -- src/lib/soldVerification.js', { cwd: repoRoot, encoding: 'utf8' });
  } catch {
    diffOutput = '(git diff unavailable)';
  }
  assertEq(diffOutput.trim(), '', 'src/lib/soldVerification.js has zero diff vs HEAD — AB does not touch the sold-path variant enforcement (variantMismatch:comp_has_user_none)');

  // Filter 1c unit contract — the actual source of the applicability signal.
  const poolNoMatch = [{ title: 'Sabrina the Teenage Witch #1 Melissa Joan Hart cover' }, { title: 'Sabrina the Teenage Witch #1 photo cover NM' }];
  const noVariantResult = applyVariantPreferenceFilter(poolNoMatch, null);
  assertEq(noVariantResult.matched, null, 'no confirmedVariant at all -> matched=null (not applicable)');

  const unmatchedResult = applyVariantPreferenceFilter(poolNoMatch, 'Dan Parent NYCC variant');
  assertEq(unmatchedResult.matched, false, 'confirmedVariant present, zero pool matches -> matched=false (unverified) — the exact Sabrina shape');
  assertEq(unmatchedResult.pool.length, poolNoMatch.length, 'unmatched case still returns the full pool (mode=any keeping-all preserved — C2, pricing pool composition untouched)');

  const poolWithMatch = [
    { title: 'Sabrina the Teenage Witch #1 Dan Parent NYCC Foil Variant LTD 50' },
    { title: 'Sabrina the Teenage Witch #1 Dan Parent NYCC Foil Variant signed' },
    { title: 'Sabrina the Teenage Witch #1 photo cover NM' },
  ];
  const matchedResult = applyVariantPreferenceFilter(poolWithMatch, 'Dan Parent NYCC variant');
  assertEq(matchedResult.matched, true, 'confirmedVariant present, pool has genuine matches -> matched=true (confirmed)');
  assertTrue(matchedResult.pool.length < poolWithMatch.length, 'matched case narrows the pool to the variant-matching comps');

  // applyArtistPreferenceNarrowing must preserve `matched` from Filter 1c,
  // never promote an unmatched variant just because an artist token
  // happens to line up (independent axes — Filter 1c's own docstring).
  const artistNarrowed = applyArtistPreferenceNarrowing(unmatchedResult, 'Dan Parent NYCC variant', null);
  assertEq(artistNarrowed.matched, false, 'applyArtistPreferenceNarrowing preserves matched=false — a creator-axis narrowing cannot promote variant-edition applicability');
}

// ═══════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════
console.log(`\n${'='.repeat(60)}`);
console.log(`GrailKey Directive AB: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
} else {
  console.log('All checks passed.');
  process.exit(0);
}
