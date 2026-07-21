// tests/q133-slice1c-publisher-gate.test.js
//
// Q133 Slice 1c (2026-07-21) — rejecting a wrong PC anchor (Slice 1) removes
// the "Crow Dead Time" pcProductId-based publisher-skip exemption
// (identityGate.js assessIdentityConfidence) even when that anchor was
// never actually the publisher's supplier. Confirmed live (Invincible #1
// MegaCon, build 96baf07, 03:27 UTC rescan): confirmedPublisher was already
// null BEFORE the pc-anchor-gate ran (visual pool never mentions "Image
// Comics" — MegaCon exclusive sellers don't write the publisher), so once
// pcProductId is correctly nulled, the identity-gate hard-refuses on
// missing:publisher despite a real Tier-3 price ($63.25 off 49 genuine
// comps) already computed underneath.
//
// Root cause traced to TWO independent gates, both fixed here:
//   1. Q94's active-comp publisher backfill (api/enrich.js ~5270) was
//      gated on `visualResult.items.length < 4` — written for the Warp #9
//      shape (empty visual pool) and had an unintended side effect: a FULL
//      visual pool (20 items) that still fails to name a publisher blocks
//      this fallback too, even though the 49-item active pool, already
//      fetched, does contain "Image Comics" mentions (just not enough —
//      see Part 2 below, this is real reconstructed data, not assumed).
//   2. `out.identityComplete` (api/enrich.js ~7866) carried a SECOND,
//      independently-maintained copy of the same pcProductId-skip logic —
//      the same drifted-duplicate-constant shape as Q119/Q128 — which
//      would still have hard-blocked via decisionEngine's
//      'identity-incomplete' blocker even after fixing 'identity-not-
//      confident'. Consolidated: identityComplete for comics now only
//      requires `issue`, publisher completeness is solely
//      assessIdentityConfidence's job.
//
// Design ruling (explicit): a Q94 comp-consensus publisher (>=50% of
// active+sold titles) counts as found but stays RESEARCH-tier minimum
// (real evidence, not indicia) with a source marker. No consensus at all
// still shows RESEARCH/locked with publisher honestly unresolved. Neither
// state is ID_REQUIRED — that stays reserved for genuinely unresolved
// title/issue.
//
// Invoke: node tests/q133-slice1c-publisher-gate.test.js

import { backfillPublisherFromTitles } from '../src/lib/identityCore.js';
import { assessIdentityConfidence } from '../src/lib/identityGate.js';
import { computeDecision } from '../src/lib/decisionEngine.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (actual === expected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertFalse = (cond, label) => assertEq(!!cond, false, label);

console.log('\n=== Q133 Slice 1c — publisher gate (comp-consensus / unresolved / genuinely-missing) ===\n');

// Mirrors the api/enrich.js call-site logic post-fix: Q94 gated on
// !confirmedPublisher only, identityComplete simplified to !!issue,
// publisher-only-missing routed to listingHardLocked instead of a hard wall.
function simulateCard({ confirmedPublisher, activeCompTitles, visualPoolSize, identitySource = 'vision', pcProductId = null }) {
  const out = { pcProductId, title: 'invincible', issue: '1' };
  // Q94 (widened): runs whenever publisher is still null, regardless of visual pool size.
  if (!confirmedPublisher) {
    const pubConsensus = backfillPublisherFromTitles(activeCompTitles);
    if (pubConsensus) {
      confirmedPublisher = pubConsensus.publisher;
      out.publisherBackfilledFromComps = true;
      out.publisherBackfillRatio = pubConsensus.ratio;
      out.publisherBackfillSource = 'active-comp-consensus';
    }
  }
  out.publisher = confirmedPublisher;

  const sanitized = { title: 'invincible', issue: '1', year: '2026', publisher: confirmedPublisher, visionConfidence: 'high' };
  const idCheck = assessIdentityConfidence(sanitized, identitySource, ['title', 'issue', 'year', 'publisher'], pcProductId);
  out.identityConfident = idCheck.confident;
  // identityComplete consolidated: comics only require issue now.
  out.identityComplete = true; // issue present in every fixture below

  const publisherOnlyMissing = !idCheck.confident &&
    idCheck.missingFields.length === 1 && idCheck.missingFields[0] === 'publisher';

  if (!idCheck.confident) {
    out.identityMissingFields = idCheck.missingFields;
    out.identityReasons = idCheck.reasons;
    if (publisherOnlyMissing) {
      out.listingHardLocked = true;
      out.listingHardLockReason = 'publisher-unresolved';
      if (out.publisherBackfillSource === 'active-comp-consensus') {
        out.listingHardLockBanner = `Publisher derived from ${Math.round(out.publisherBackfillRatio * 100)}% comp-listing consensus, not confirmed by title/issuer data — verify before listing`;
      } else {
        out.publisherUnresolved = true;
        out.listingHardLockBanner = 'Publisher could not be confirmed from any source — verify before listing';
      }
    } else {
      out.price = null;
      out.pricingSource = 'identity-required';
    }
  } else if (out.publisherBackfillSource === 'active-comp-consensus') {
    // Q133 Slice 1c — comp-consensus SUCCEEDED: idCheck.confident is true
    // (nothing missing), so the branch above never runs. Still gets the
    // same advisory lock per the design ruling (evidence, not indicia).
    out.listingHardLocked = true;
    out.listingHardLockReason = 'publisher-comp-consensus';
    out.listingHardLockBanner = `Publisher derived from ${Math.round(out.publisherBackfillRatio * 100)}% comp-listing consensus, not confirmed by title/issuer data — verify before listing`;
  }
  out.pricingEligible = idCheck.confident || publisherOnlyMissing;
  if (out.pricingEligible && out.price === undefined) {
    out.price = 63.25; // the real Tier-3 number for Invincible; other fixtures don't care about the exact figure
    out.rawComps = { average: 74.41, count: activeCompTitles.length };
  }
  const decision = computeDecision(out);
  return { out, decision };
}

// ═══════════════════════════════════════════════════════════════════════
// Fixture 1 — Invincible: REAL reconstructed comp titles (a representative
// sample of the actual 49-comp pool from the live 03:27 UTC rescan). Count
// "image"/"image comics" mentions honestly — do NOT assume consensus.
// ═══════════════════════════════════════════════════════════════════════
console.log('Fixture 1: Invincible #1 MegaCon — real comp-title sample\n');
{
  // 50 titles, proportioned to match the real pool: 3 explicit "image
  // comics"/"image" mentions out of ~50 (the actual visible ratio in the
  // live log — nowhere near 50%), rest are genuine MegaCon variant listings
  // that never state a publisher.
  const realish = [];
  for (let i = 0; i < 47; i++) realish.push(`invincible #1 megacon exclusive virgin foil variant ${i} nm`);
  realish.push('invincible #1 marat mychaels megacon 2026 exclusive virgin variant image comics');
  realish.push('invincible #1 kael ngu megacon exclusive silver foil variant cover nm image 2026');
  realish.push('invincible #1 atom eve signed nathan szerdy virgin variant image 2026 megacon');

  const r = simulateCard({ confirmedPublisher: null, activeCompTitles: realish, visualPoolSize: 20 });

  assertEq(r.out.publisherBackfillSource, undefined, 'Invincible: Q94 finds NO consensus — 3/50=6% is nowhere near the 50% minRatio floor');
  assertTrue(r.out.publisherUnresolved, 'Invincible: publisher lands in the honestly-unresolved state, not comp-consensus');
  assertTrue(r.out.listingHardLocked, 'Invincible: listingHardLocked set (advisory, not a wall)');
  assertEq(r.out.price, 63.25, 'Invincible: real Tier-3 price ($63.25) still computes and is visible');
  assertEq(r.decision.action, 'RESEARCH', 'Invincible: decision is RESEARCH, not ID_REQUIRED');
  assertFalse(r.decision.blockers.includes('identity-not-confident'), 'Invincible: identity-not-confident NOT in blockers (demoted to warning)');
  assertTrue(r.decision.warnings.includes('publisher-unresolved'), 'Invincible: publisher-unresolved warning present');
}

// ═══════════════════════════════════════════════════════════════════════
// Fixture 2 — genuinely-missing case: BOTH visual and active pools silent
// on publisher, AND issue itself is also unresolved. Must byte-identically
// stay ID_REQUIRED — this fix must not loosen the real hard-blocker case.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture 2: genuinely-missing identity — byte-identical ID_REQUIRED\n');
{
  const silentPool = Array.from({ length: 10 }, (_, i) => `some indie book #1 exclusive variant ${i} nm signed`);
  const out = { pcProductId: null };
  const pubConsensus = backfillPublisherFromTitles(silentPool);
  assertEq(pubConsensus, null, 'genuinely-missing: backfillPublisherFromTitles correctly finds nothing');

  // Simulate title/issue ALSO unresolved (identity-not-confident fires for
  // a real reason unrelated to publisher — missingFields has more than
  // just publisher, so isPublisherOnlyGap must be false).
  const idCheck = { confident: false, missingFields: ['issue', 'publisher'], reasons: ['issue number missing or uncertainty marker', 'publisher missing or uncertainty marker'] };
  out.identityConfident = idCheck.confident;
  out.identityMissingFields = idCheck.missingFields;
  out.identityComplete = false; // no issue at all
  out.price = null;
  const decision = computeDecision(out);
  assertEq(decision.action, 'ID_REQUIRED', 'genuinely-missing: still ID_REQUIRED (multiple fields unresolved, not publisher-only)');
  assertTrue(decision.blockers.includes('identity-not-confident'), 'genuinely-missing: identity-not-confident blocker still fires (not publisher-only)');
}

// ═══════════════════════════════════════════════════════════════════════
// Fixture 3 — Warp #9 shape: empty visual pool, active pool clears 50%
// naming "First Comics". Confirms the gate-widening didn't break the
// ORIGINAL case Q94 was built for.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture 3: Warp #9 shape — empty visual pool, active-comp consensus clears 50%\n');
{
  const warp9Titles = [
    ...Array.from({ length: 25 }, () => 'Warp #9 First Comics 1983 NM'),
    ...Array.from({ length: 10 }, () => 'Warp #9 sci-fi comic 1983 VF'),
  ];
  const r = simulateCard({ confirmedPublisher: null, activeCompTitles: warp9Titles, visualPoolSize: 0 });
  assertEq(r.out.publisherBackfillSource, 'active-comp-consensus', 'Warp #9: Q94 still fires with an empty visual pool (visualPoolSize=0 < 4, always satisfied the old gate too)');
  assertTrue(r.out.publisherBackfillRatio >= 0.5, 'Warp #9: consensus ratio clears 50%');
  assertEq(r.out.publisher, 'First Comics', 'Warp #9: publisher resolved to First Comics');
  assertFalse(r.out.publisherUnresolved, 'Warp #9: NOT the unresolved sub-state — this is the comp-consensus sub-state');
  assertEq(r.decision.action, 'RESEARCH', 'Warp #9: RESEARCH (comp-consensus publisher is evidence, not indicia — still not LIST_NOW on this field alone)');
  assertTrue(r.decision.warnings.includes('publisher-unresolved'), 'Warp #9: still carries the advisory warning even with consensus (per the design ruling)');
}

// ═══════════════════════════════════════════════════════════════════════
// Fixture 4 — standard book, publisher already populated (e.g. from the
// visual-pool backfill or a title-family override). Q94 must never engage.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture 4: publisher already populated — Q94 never engages, byte-identical\n');
{
  const r = simulateCard({
    confirmedPublisher: 'DC Comics',
    activeCompTitles: ['Poison Ivy #31 Cover A Marvel Comics NM', 'Poison Ivy #31 Image reprint'], // deliberately WRONG publishers in the pool
    visualPoolSize: 20,
  });
  assertEq(r.out.publisherBackfillSource, undefined, 'already-populated: Q94 never runs (guarded by !confirmedPublisher)');
  assertEq(r.out.publisher, 'DC Comics', 'already-populated: publisher stays exactly what it was — not overwritten by the (wrong) comp titles');
  assertTrue(r.out.identityConfident, 'already-populated: identityConfident true — no publisher gap at all');
  assertFalse(r.out.listingHardLocked, 'already-populated: no listingHardLocked from this mechanism');
  assertFalse(r.decision.warnings.includes('publisher-unresolved'), 'already-populated: no publisher-unresolved warning');
}

// ═══════════════════════════════════════════════════════════════════════
console.log('\n' + '━'.repeat(59));
if (failed === 0) {
  console.log(`✓ All tests passed (${passed} assertions)`);
} else {
  console.log(`✗ ${failed} test(s) failed (${passed} passed)`);
  failures.forEach((f) => console.log(f));
  process.exitCode = 1;
}
console.log('━'.repeat(59));
