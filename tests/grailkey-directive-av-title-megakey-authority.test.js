// tests/grailkey-directive-av-title-megakey-authority.test.js
//
// GrailKey Directive 2026-08-20-AV — GK-133 + GK-139.
//
// Part A (GK-133): the title facet was the last identity facet without
// candidate custody — issue (AS/GK-132), variant (AM/AU), and year
// (AT/GK-135) all adopt the frozen rank-1/topFamily candidate when normal
// election refuses to promote it; title silently kept Vision's bare
// default in that exact void. reconcileTitleFacet (src/lib/identityCore.js)
// closes it, reusing the SAME family-clustering candidate the Q38 floor
// (imageSearchIdentity.js, "need >=3 for consensus override") already
// scored — adopted CONTESTED, never silently confirmed. out.titleAuthority
// floors marketStanding to SIMILAR_ONLY (src/lib/actionAuthority.js), same
// per-facet law AR/AT already established for variant/year.
//
// Part B (GK-139): the Tier-0 mega-key floor (api/mega-keys.js) matches
// title+issue+publisher+year on pure VALUE equality — zero awareness of
// whether that value was ever corroborated. A real production shape
// (Dell'Otto Amazing Spider-Man #1, a modern virgin variant) matched the
// "amazing spider man|1" 1963 grail entry ($300,000 at grade 9.4) even
// though its own year facet was CONTESTED (a lone PriceCharting catalog
// match, AU/GK-137's own single-source ceiling) and its own variant facet
// was CONTESTED (a modern virgin variant, not the 1963 original) — an
// entire comp pool of 2020s Dell'Otto listings averaging ~$30.
// isMegaKeyIdentityCorroborated (api/mega-keys.js) gates the two existing
// firing sites (api/enrich.js ~8930/~9415) on identity corroboration
// before the floor may speak; MEGA_KEYS_FLOOR/getMegaKeyEntry themselves
// are UNTOUCHED (C5 — a genuinely corroborated key still floors, full
// force; see B3).
//
// Invoke: node tests/grailkey-directive-av-title-megakey-authority.test.js

import { resolveIdentity, isCorroboratedIdentitySource } from '../src/lib/identityCore.js';
import { reconcileTitle, createEvidenceSet, addEvidence } from '../src/lib/identityReconciler.js';
import { deriveMarketStanding, deriveActionAuthority } from '../src/lib/actionAuthority.js';
import { deriveLocks } from '../src/lib/responseContract.js';
import { isMegaKeyIdentityCorroborated, getMegaKeyEntry } from '../api/mega-keys.js';

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

// ════════════════════════════════════════════════════════════════════════
// UNIT — reconcileTitle (identityReconciler.js), pure function
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== UNIT: reconcileTitle ===');
{
  const ev = createEvidenceSet();
  addEvidence(ev, 'title', 'vision', 'Venom');
  addEvidence(ev, 'title', 'first-eligible-visual', 'Venom Separation Anxiety');
  const r = reconcileTitle(ev);
  assertEq(r.value, 'Venom Separation Anxiety', 'first-eligible-visual is sole-authority — wins outright over disagreeing vision');
  assertEq(r.authority, 'CONTESTED', 'disagreement with vision demotes to CONTESTED, never a silent CONFIRMED');
  assertTrue(r.conflicts.some((c) => c.source === 'vision' && c.value === 'Venom'), "vision's rejected claim is recorded, not erased (I13)");
}
{
  // Agreement case — same value from both sources → CORROBORATED.
  const ev = createEvidenceSet();
  addEvidence(ev, 'title', 'vision', 'Venom');
  addEvidence(ev, 'title', 'first-eligible-visual', 'Venom');
  const r = reconcileTitle(ev);
  assertEq(r.authority, 'CORROBORATED', 'agreeing candidate + vision → CORROBORATED, not CONTESTED');
}
{
  // No evidence at all → NONE, not a crash.
  const r = reconcileTitle(createEvidenceSet());
  assertEq(r.authority, 'NONE', 'empty evidence set → authority NONE');
  assertEq(r.value, null, 'empty evidence set → value null');
}

// ════════════════════════════════════════════════════════════════════════
// B1a — resolveIdentity title adoption, Venom production shape (real
// selectTitleFamilyCandidate output, not hand-built — see dispatch trace)
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== B1a: resolveIdentity adopts the topFamily title candidate in the fallback-vision void ===');
{
  const vision = { title: 'Venom', issue: '150', year: null, publisher: 'Marvel' };
  const ebay = { title: 'Venom', issue: null, publisher: 'Marvel', agreement: { visionIssueCount: 0, total: 6 }, noIssueConsensus: true };
  const visualItems = [
    { rawTitle: 'Venom - Separation Anxiety 1 Virgin Signed/Remarked by Mike Mayhew w/Poker Chip' },
    { rawTitle: 'Venom Ariel Diaz Artbook Print' },
    { rawTitle: 'Venom Clayton Crain Cover Select' },
  ];
  // Real topFamily shape, verified against the actual selectTitleFamilyCandidate
  // function this dispatch traced (see handoff) — not fabricated.
  const family = {
    decision: 'fallback-vision',
    selectedTitle: null,
    reason: 'Top family has only 1 members (need ≥3 for consensus override) — preserve Vision',
    topFamily: {
      title: 'venom separation anxiety by mike mayhew poker chip',
      rawTitle: visualItems[0].rawTitle,
      indices: [0], count: 1, weightSum: 5,
    },
    runnerUp: null,
  };

  // PRE — the void this dispatch closes: without the new block, confirmedTitle
  // would stay exactly vision.title (demonstrated by the pre-existing AS
  // suite's own B5 fixture, which omits topFamily.title and therefore never
  // enters the new branch — see grailkey-directive-as-candidate-always-
  // enters.test.js, byte-identical after this dispatch).

  const identity = resolveIdentity(vision, ebay, family, { ebayResultCount: visualItems.length, visualItems });
  console.log(`  POST: confirmedTitle="${identity.confirmedTitle}" identitySource=${identity.identitySource} titleAdoptedContested=${identity.titleAdoptedContested}`);

  assertTrue(identity.confirmedTitle !== 'Venom', 'POST: confirmedTitle no longer stuck at bare "Venom"');
  assertTrue(/separation anxiety/i.test(identity.confirmedTitle), 'POST: confirmedTitle carries the real series name "Separation Anxiety"');
  assertEq(identity.titleAdoptedContested, true, 'POST: adoption is flagged CONTESTED, never silently confirmed');
  assertEq(identity.reconciledTitle?.source, 'first-eligible-visual', 'POST: reconciledTitle.source is first-eligible-visual');
  assertTrue(identity.identitySource.includes('title_first_eligible_visual_contested'), 'POST: identitySource carries the new suffix (drives the 22e skip + isCorroboratedIdentitySource=false downstream)');
  // Issue facet (AS/GK-132) is untouched by this dispatch — proves the two
  // facets are genuinely decoupled, same discipline AS's own B5 established.
  assertEq(identity.confirmedIssue, '1', 'POST: issue facet (AS mechanism) independently still resolves to "1", unaffected by this dispatch');
}

// ════════════════════════════════════════════════════════════════════════
// B1b — C3: a CONTESTED title cannot support EXACT_CURRENT
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== B1b: out.titleAuthority=CONTESTED floors marketStanding to SIMILAR_ONLY, never READY ===');
{
  const outContested = {
    pricingSource: 'active_ask_derived',
    titleAuthority: 'CONTESTED',
    identityConfident: true,
    decision: { action: 'RESEARCH', blockers: [] },
    matchConfidence: { tier: 'MEDIUM', score: 60 },
    rawComps: { count: 4, average: 48.86, lowest: 35, highest: 65, prices: [65, 55, 45, 35] },
  };
  const standing = deriveMarketStanding(outContested);
  assertEq(standing, 'SIMILAR_ONLY', 'CONTESTED title floors EXACT_CURRENT-eligible source to SIMILAR_ONLY');
  const locks = deriveLocks(outContested);
  assertTrue(locks.some((l) => l.code === 'market-standing-title-contested'), 'market-standing-title-contested lock is present with an explicable reason');
  const authority = deriveActionAuthority(outContested, locks, outContested.decision);
  assertTrue(authority.state !== 'READY', 'actionAuthority.state is never READY for a CONTESTED title');

  // Control: titleAuthority absent (normal book, untouched by this
  // dispatch) — EXACT_CURRENT stays fully reachable.
  const outNormal = { pricingSource: 'active_ask_derived' };
  assertEq(deriveMarketStanding(outNormal), 'EXACT_CURRENT', 'CONTROL: no titleAuthority at all → EXACT_CURRENT unaffected');
}

// ════════════════════════════════════════════════════════════════════════
// B4 — no-candidate control: the void does NOT fire without a real candidate
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== B4: no topFamily at all → confirmedTitle stays Vision\'s own value, byte-identical ===');
{
  const vision = { title: 'Poison Ivy', issue: '1', year: 2022, publisher: 'DC' };
  const ebay = { title: null, issue: null, publisher: null };
  const family = { decision: 'fallback-vision', selectedTitle: null, reason: 'insufficient pool', topFamily: null, runnerUp: null };
  const identity = resolveIdentity(vision, ebay, family, { ebayResultCount: 2, visualItems: [] });
  assertEq(identity.confirmedTitle, 'Poison Ivy', 'CONTROL: no candidate at all → confirmedTitle untouched');
  assertEq(identity.titleAdoptedContested, false, 'CONTROL: titleAdoptedContested stays false — the mechanism genuinely did not fire');
  assertEq(identity.reconciledTitle, null, 'CONTROL: reconciledTitle stays null — the void never applied');
}

// ════════════════════════════════════════════════════════════════════════
// B2/B3 — isMegaKeyIdentityCorroborated (api/mega-keys.js), pure gate
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== B2: mega-key floor STANDS DOWN on uncorroborated identity (Dell\'Otto shape) ===');
{
  // Confirms the real "amazing spider man|1" 1963 entry exists and is what
  // fires when identity gates pass — this is the exact entry the real
  // production Dell'Otto scan matched.
  const entry = getMegaKeyEntry('Amazing Spider-Man', '1', 'Marvel Comics', 1963);
  assertTrue(!!entry && entry.grades?.['9.4'] === 300000, 'PRE: the raw value-match entry exists and would floor grade 9.4 at $300,000 with no corroboration check at all');

  const contestedShape = {
    identitySource: 'title-family-weighted-consensus', // title itself IS corroborated
    yearAuthority: 'CONTESTED',                          // AU/GK-137: lone catalog source
    variantApplicability: 'CONTESTED',                    // AU/GK-136: modern variant contests the 1963 claim
    isCorroboratedIdentitySourceFn: isCorroboratedIdentitySource,
  };
  assertEq(isMegaKeyIdentityCorroborated(contestedShape), false, 'POST: identity NOT corroborated enough — floor must stand down');

  // Each condition independently sufficient to block:
  assertEq(isMegaKeyIdentityCorroborated({ ...contestedShape, yearAuthority: 'CORROBORATED' }), false, 'variant CONTESTED alone still blocks the floor');
  assertEq(isMegaKeyIdentityCorroborated({ ...contestedShape, variantApplicability: null }), false, 'year CONTESTED alone still blocks the floor');
  assertEq(isMegaKeyIdentityCorroborated({ ...contestedShape, identitySource: 'vision', yearAuthority: 'CORROBORATED', variantApplicability: null }), false, 'uncorroborated title alone still blocks the floor');
}

console.log('\n=== B3: genuine corroborated mega-key negative control — floor STILL fires, full force ===');
{
  const corroboratedShape = {
    identitySource: 'title-family-weighted-consensus',
    yearAuthority: 'CORROBORATED',
    variantApplicability: null, // no confirmed variant at all — a plain base copy
    isCorroboratedIdentitySourceFn: isCorroboratedIdentitySource,
  };
  assertEq(isMegaKeyIdentityCorroborated(corroboratedShape), true, 'C5: a genuinely corroborated identity is NOT blocked — the floor still fires');

  // Manual/barcode/cgc_cert identity paths never produce a title-family
  // identitySource string — must not be mistaken for "uncorroborated."
  for (const src of ['manual', 'barcode', 'cgc_cert']) {
    assertEq(
      isMegaKeyIdentityCorroborated({ identitySource: src, yearAuthority: 'CORROBORATED', variantApplicability: null, isCorroboratedIdentitySourceFn: isCorroboratedIdentitySource }),
      true,
      `${src} identity path is independently authoritative — floor still fires`
    );
  }
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('FAILURES:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
