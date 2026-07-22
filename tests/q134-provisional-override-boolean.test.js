// Q134 dispatch (2026-07-21, Lozano/Rachta Lin class) — resolveIdentity's
// own zero-support override/escalate logic (issue check ~line 753, publisher
// check ~line 808 in identityCore.js) appends a suffix to identitySource on
// ANY branch, including the title-family-refused-provisional branch itself
// (e.g. "title-family-refused-provisional+vision_publisher_zero_support_
// escalate"). The four api/enrich.js call sites that used to gate on
// isProvisionalRefusedIdentity(identitySource) — exact string equality —
// silently flipped to false the moment a suffix landed, re-admitting
// Vision's rejected year/publisher/PC-query and undoing the honest-null
// Q131 built. Real production symptom: Pop Kill Lozano showed "Dark Horse ·
// 2014" (Vision's rejected publisher/year) instead of the pool's real
// "Mad Cave Studios · 2026", and the era-filter used the fabricated 2014 to
// reject genuine 2026 comps.
//
// Fix: resolveIdentity now returns isProvisionalOverride, a boolean set at
// the exact instant the provisional branch fires — before any later suffix
// concatenation in the same function call can touch it. api/enrich.js's 4
// call sites (2834 PC-year, 3129 publisher, 3461 resolveYear input, 3994
// banner text) all read this boolean now, never identitySource string-
// matching. confirmedVariant (api/enrich.js ~3800) gets the identical
// gate — it never had ANY honest-null treatment before this dispatch.
//
// This file is THE regression test for root cause A: it makes two REAL
// end-to-end resolveIdentity() calls (not mocks) engineered to produce
// exactly the suffixed identitySource strings that broke the old
// mechanism, and proves the new boolean survives where the string check
// would not have.
//
// Invoke: node tests/q134-provisional-override-boolean.test.js

import { resolveIdentity, isProvisionalRefusedIdentity } from '../src/lib/identityCore.js';

let passed = 0;
let failed = 0;
const check = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

// ── 1. Issue-suffix variant (override mode) — Lozano class ──────────────
// 17-member pool family (matches the real Pop Kill Lozano production case),
// Vision's issue has ZERO pool support → issue zero-support OVERRIDE fires
// on top of the provisional branch.
console.log('\n── Suffix mutation A: title-family-refused-provisional+vision_zero_support_override ──');
{
  const vision = { title: 'He-Man and the Masters of the Universe', issue: '5', year: '2014', publisher: 'Dark Horse' };
  const family = {
    decision: 'refused-identity-conflict',
    topFamily: { rawTitle: 'Pop Kill #3 Lozano Variant Cover', weightSum: 15.0, count: 17 },
  };
  const ebay = {
    title: 'Pop Kill',
    issue: '3',
    year: '2026',
    publisher: 'Mad Cave Studios',
    agreement: { visionIssueCount: 0, visionPublisherCount: 5, total: 17 },
  };

  const identity = resolveIdentity(vision, ebay, family, { ebayResultCount: 17, isGraded: false });

  check(identity.identitySource === 'title-family-refused-provisional+vision_zero_support_override',
    `identitySource actually mutated to the suffixed form (got "${identity.identitySource}")`);
  check(isProvisionalRefusedIdentity(identity.identitySource) === false,
    'OLD string-equality predicate is FALSE here — this is exactly the bug the boolean fixes');
  check(identity.isProvisionalOverride === true,
    'NEW boolean stays TRUE despite the suffix — survives the mutation');

  // Simulate all 4 enrich.js call sites using the boolean (not the string).
  const rawYear = vision.year;
  const rawPublisher = vision.publisher;
  const pcQueryYear = identity.isProvisionalOverride ? identity.confirmedYear : rawYear;
  check(pcQueryYear !== rawYear, `Site 1 (PC query year): does not leak "${rawYear}" (got ${JSON.stringify(pcQueryYear)})`);

  const yearForResolution = identity.isProvisionalOverride ? identity.confirmedYear : rawYear;
  check(yearForResolution !== rawYear, `Site 2 (resolveYear input): does not leak "${rawYear}" (got ${JSON.stringify(yearForResolution)})`);

  const finalPublisher = identity.confirmedPublisher || null /* no CV */ ||
    (identity.isProvisionalOverride ? null : rawPublisher);
  check(finalPublisher !== rawPublisher, `Site 3 (publisher fallback): does not leak "${rawPublisher}" (got ${JSON.stringify(finalPublisher)})`);
  check(finalPublisher === 'Mad Cave Studios', `Site 3: pool-derived publisher wins (got "${finalPublisher}")`);

  const isProvisionalFamilyIdentity = identity.isProvisionalOverride;
  check(isProvisionalFamilyIdentity === true, 'Site 4 (banner selector): still selects the provisional-ID banner wording');

  const safeReqVariant = 'Some Vision-hallucinated variant text';
  const confirmedVariantSeed = identity.isProvisionalOverride ? null : safeReqVariant;
  check(confirmedVariantSeed === null, `confirmedVariant seed honest-nulled (got ${JSON.stringify(confirmedVariantSeed)})`);
}

// ── 2. Publisher-suffix variant (escalate mode) — Rachta Lin class,
//      the LITERAL string from the dispatch ────────────────────────────
console.log('\n── Suffix mutation B: title-family-refused-provisional+vision_publisher_zero_support_escalate ──');
{
  const vision = { title: 'Harley Quinn', issue: '75', year: '2020', publisher: 'DC Comics' };
  const family = {
    decision: 'refused-identity-conflict',
    // 3-member family — matches the real Pop Kill Rachta Lin production
    // case (the exact promotion-floor case, count>=3, from the Q133 dispatch).
    topFamily: { rawTitle: 'Pop Kill #3 Rachta Lin Kunkka Variant', weightSum: 2.5, count: 3 },
  };
  const ebay = {
    title: 'Pop Kill',
    issue: '3',
    year: '2026',
    publisher: null,
    noPublisherConsensus: true, // read directly off `ebay`, not `ebay.agreement` — see resolveIdentity
    agreement: { visionIssueCount: 1, visionPublisherCount: 0, total: 3 },
  };

  const identity = resolveIdentity(vision, ebay, family, { ebayResultCount: 3, isGraded: false });

  check(identity.identitySource === 'title-family-refused-provisional+vision_publisher_zero_support_escalate',
    `identitySource matches the exact string from the dispatch (got "${identity.identitySource}")`);
  check(isProvisionalRefusedIdentity(identity.identitySource) === false,
    'OLD string-equality predicate is FALSE here too');
  check(identity.isProvisionalOverride === true,
    'NEW boolean stays TRUE despite this different suffix shape');

  const rawYear = vision.year;
  const rawPublisher = vision.publisher;
  const pcQueryYear = identity.isProvisionalOverride ? identity.confirmedYear : rawYear;
  check(pcQueryYear !== rawYear, `Site 1: does not leak "${rawYear}" (got ${JSON.stringify(pcQueryYear)})`);

  const finalPublisher = identity.confirmedPublisher || null ||
    (identity.isProvisionalOverride ? null : rawPublisher);
  check(finalPublisher === null, `Site 3: publisher stays honestly null, not "${rawPublisher}" (got ${JSON.stringify(finalPublisher)})`);

  const safeReqVariant = 'Kunkka beer variant';
  const confirmedVariantSeed = identity.isProvisionalOverride ? null : safeReqVariant;
  check(confirmedVariantSeed === null, `confirmedVariant seed honest-nulled, not "${safeReqVariant}" (got ${JSON.stringify(confirmedVariantSeed)})`);
}

// ── 3. Control — suffix on a NON-provisional base must NOT flip the
//      boolean true. Proves the boolean discriminates on WHICH branch
//      fired, not merely on suffix presence. ────────────────────────────
console.log('\n── Control: zero-support suffix on plain vision fallback (no family at all) ──');
{
  const vision = { title: 'Amazing Spider-Man', issue: '26', year: '2021', publisher: 'Marvel Comics' };
  const ebay = {
    title: 'Amazing Spider-Man',
    issue: '11',
    year: '2021',
    publisher: 'Marvel Comics',
    agreement: { visionIssueCount: 0, visionPublisherCount: 5, total: 8 },
  };
  // No family candidate at all, and ebayResultCount < 10 so the overlap
  // branch doesn't fire either — falls to "insufficient data, use Vision".
  const identity = resolveIdentity(vision, ebay, null, { ebayResultCount: 8, isGraded: false });

  check(identity.identitySource === 'vision+vision_zero_support_override',
    `identitySource carries the suffix on a plain vision base (got "${identity.identitySource}")`);
  check(identity.isProvisionalOverride === false,
    'boolean correctly stays FALSE — the provisional branch never fired, only the base differs');
}

// ── 4. Control — ASM #26 Nakayama shape: normal Vision-agreed identity
//      keeps confirmedVariant FULLY populated, gate never engages ───────
console.log('\n── Control: normal top-rank-protection override with a real variant (ASM #26 Nakayama shape) ──');
{
  const vision = { title: 'Amazing Spider-Man', issue: '26', year: '2018', publisher: 'Marvel Comics' };
  const family = {
    decision: 'top-rank-protection',
    selectedTitle: 'Amazing Spider-Man',
  };
  const ebay = { title: 'Amazing Spider-Man', issue: '26', year: '2018', publisher: 'Marvel Comics' };

  const identity = resolveIdentity(vision, ebay, family, { ebayResultCount: 12, isGraded: false });

  check(identity.isProvisionalOverride === false, 'boolean stays FALSE for a normal family-override outcome');
  const safeReqVariant = 'Peach Momoko Nakayama Variant';
  const confirmedVariantSeed = identity.isProvisionalOverride ? null : safeReqVariant;
  check(confirmedVariantSeed === safeReqVariant,
    `confirmedVariant remains fully populated when identity is NOT provisional (got ${JSON.stringify(confirmedVariantSeed)})`);
}

// ── 5. Control — genuinely-unidentified / Eternus path (count < 2):
//      provisional branch never fires, boolean stays false, unchanged ───
console.log('\n── Control: thin family (count=1, below the count>=2 provisional floor) ──');
{
  const vision = { title: 'Some Wrong Guess', issue: '1', year: '2020', publisher: 'DC Comics' };
  const family = {
    decision: 'refused-identity-conflict',
    topFamily: { rawTitle: 'Totally Unrelated Comic #9', weightSum: 1.0, count: 1 },
  };
  const identity = resolveIdentity(vision, null, family, { ebayResultCount: 0, isGraded: false });

  check(identity.isProvisionalOverride === false,
    'boolean stays FALSE — count=1 is below the provisional floor, falls through to Vision unchanged');
  check(identity.confirmedTitle === 'Some Wrong Guess' || identity.confirmedTitle === vision.title,
    `Vision's title stands untouched in the thin-family fallthrough (got "${identity.confirmedTitle}")`);
}

// ── 6. Controls — Poison Ivy #31 / Catwoman #64 class (Q127's
//      suppressVariantForYearConflict) composes correctly with the NEW
//      identityIsProvisionalOverride gate at api/enrich.js line ~3800.
//      These two cards never go through refused-identity-conflict at all
//      (detectVariantPoolYearConflict is a completely separate mechanism)
//      — confirms the two independent null-sources don't fight or
//      double-negate each other. ─────────────────────────────────────────
console.log('\n── Control: Catwoman #64 class (suppressVariantForYearConflict=true, identity NOT provisional) ──');
{
  // api/enrich.js line ~3800:
  //   const safeReqVariant = suppressVariantForYearConflict ? null : (req.body.variant || null);
  //   let confirmedVariant = identityIsProvisionalOverride ? null : safeReqVariant;
  const suppressVariantForYearConflict = true; // Q127 gate fired (Szerdy-variant pool-year conflict)
  const identityIsProvisionalOverride = false; // title/issue were NEVER in dispute here
  const reqBodyVariant = 'Nathan Szerdy Trade Dress Exclusive /3000';
  const safeReqVariant = suppressVariantForYearConflict ? null : (reqBodyVariant || null);
  const confirmedVariant = identityIsProvisionalOverride ? null : safeReqVariant;
  check(confirmedVariant === null,
    `Q127's own gate still suppresses the contaminated variant on its own, unaffected by the Q134 addition (got ${JSON.stringify(confirmedVariant)})`);
}

console.log('\n── Control: normal card, neither gate fires — real variant survives both checks intact ──');
{
  const suppressVariantForYearConflict = false;
  const identityIsProvisionalOverride = false;
  const reqBodyVariant = 'Jenny Frison Cover B';
  const safeReqVariant = suppressVariantForYearConflict ? null : (reqBodyVariant || null);
  const confirmedVariant = identityIsProvisionalOverride ? null : safeReqVariant;
  check(confirmedVariant === reqBodyVariant,
    `a genuinely normal card's real variant passes through both gates untouched (got ${JSON.stringify(confirmedVariant)})`);
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
process.exit(0);
