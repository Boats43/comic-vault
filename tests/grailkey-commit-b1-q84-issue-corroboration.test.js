// tests/grailkey-commit-b1-q84-issue-corroboration.test.js
//
// GrailKey dispatch, Commit B1 — scoped fix at the weighted-consensus
// call site (selectTitleFamilyCandidate, imageSearchIdentity.js).
//
// Root cause, confirmed via a real production trace (2026-08-02 22:53:21
// UTC, deployment dpl_CugaaDi3KmEa48SqXaji5qpAxoZF, build af32d21):
// applyDualAxisGate's bare "creator-tokens" fallthrough (added tokens are
// ALL recognized creator/artist names) returns allowed:true
// unconditionally. That verdict correctly serves TITLE-TEXT AUGMENTATION
// onto an already-agreed identity (Wonder Woman #75 / Jenny Frison,
// tests/q84-dual-axis.test.js — real pool support for Vision's own issue
// "75" throughout). The SAME verdict, at THIS call site, also authorizes
// selecting an entire DIFFERENT winning title family for FAMILY/IDENTITY
// SELECTION — observed live: family "spawn brett booth" (3 members, all
// genuinely #351 listings) won weighted-consensus over Vision's own
// "Spawn" #1, even though not one of those 3 members supports issue "1"
// at all (`[visual] consensus: issue=none (8/20) visionIssueCount=0`).
//
// CORRECTION RECORDED (review round): an earlier version of this fix
// gated on `!visionIssue` (Vision's issue absent). The real trace's
// visionIssue was NOT absent — it was "1", present and truthy
// (`[visual] no coherent consensus — keeping Claude issue as-is: 1`).
// That earlier gate would NOT have fired for this exact request. The
// real, corrected discriminator is family-MEMBER issue support: does any
// one of the winning family's own members' own extracted issue agree
// with Vision's issue at all. WW#75's real fixture has full family-member
// agreement (issue "75" throughout the pool); the Spawn fixture below has
// zero.
//
// Pool titles are the real, verbatim eBay listing titles from the
// production trace's own [family-evidence] log line (idx 0/1/4, the
// winning "spawn brett booth" family) plus enough of the real
// non-matching #300/#307 rows also present in that trace to reproduce
// the actual pool shape, not a minimized synthetic stand-in.

import { selectTitleFamilyCandidate } from '../src/lib/imageSearchIdentity.js';

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

// Real production pool (22:53:21 UTC trace), verbatim.
const spawnPool = [
  { rawTitle: 'Spawn #351 Cover C Brett Booth Virgin Variant High Grade NM' },
  { rawTitle: 'Spawn #351 Cover C Brett Booth Virgin Variant 🔥🔥🔥' },
  { rawTitle: 'SPAWN #351 CVR C BRETT BOOTH VIRGIN CAMEO OF LYRA HTF SCARCE (2024)' },
  { rawTitle: 'Spawn #326-#352 YOU PICK We Combine Shipping!!' },
  { rawTitle: 'Spawn #351 Cover C-Brett Booth Virgin (Image Comics Malibu Comics March 2024)' },
  { rawTitle: 'SPAWN #351 CVR C NM BRETT BOOTH VIRGIN 🔑 CAMEO OF LYRA HTF SCARCE (2024)' },
  { rawTitle: 'Spawn 351 NM (9.6) 2024 - Booth Cover C Virgin Variant Cover' },
  { rawTitle: 'SPAWN 307 COVER D TAN & MCFARLANE VIRGIN VARIANT 2020 IMAGE COMICS' },
  { rawTitle: 'Spawn #307 (2020 Image Comics) Todd McFarlane ~ Philip Tan Virgin Variant D' },
  { rawTitle: 'Spawn #300 - Incentive Todd McFarlane Virgin Variant Cover - 2019 - Image' },
  { rawTitle: 'Spawn Comic Book Capullo Cover Artwork Superheroes Color Edition' },
  { rawTitle: 'Spawn # 300 Cover L Incentive Virgin Variant Todd Mcfarlane NM & HTF' },
  { rawTitle: 'SPAWN 300 COVER L 1:50 INCENTIVE TODD McFARLANE VIRGIN VARIANT NM' },
  { rawTitle: 'Spawn #300 - 1:50 Virgin Variant - McFarlane - Image Comics' },
  { rawTitle: 'Spawn #300 Cover K Incentive Virgin Variant Capullo & Mcfarlane NM & HTF' },
  { rawTitle: 'Spawn #300 (2019) NM-/NM (9.2-9.4) 1:50 Ratio Virgin Variant Cover!' },
  { rawTitle: 'Spawn #293 Image Comics 2019 Todd McFarlane Virgin Variant' },
  { rawTitle: 'Spawn #300 1:50 McFarlane Virgin Variant Comic Book First Print' },
  { rawTitle: 'Spawn #300 1:50 Incentive Variant Todd McFarlane High Grade WP Virgin 1st Print' },
  { rawTitle: 'SPAWN 307 COVER D TAN & MCFARLANE VIRGIN VARIANT COVER 2020 NM/NM- 9.2-9.4' },
];

test('Spawn #351 fixture: creator-tokens-only verdict no longer authorizes adoption of a family with zero issue support', () => {
  const r = selectTitleFamilyCandidate(spawnPool, 'Spawn', '1', 1992, {
    ebayConsensusTitle: 'spawn',
  });
  assertTrue(
    r.decision === 'fallback-vision',
    `expected fallback-vision (creator-tokens-only family has zero support for Vision's issue "1"), got decision=${r.decision} selectedTitle=${r.selectedTitle}`
  );
  assertTrue(
    /creator-tokens-without-issue-corroboration/.test(r.reason || ''),
    `reason should name the specific corroboration gap, got: ${r.reason}`
  );
});

test('non-regression: WW#75/Frison end-to-end still adopts (real family-member issue support exists)', () => {
  const wwPool = [
    { rawTitle: 'Wonder Woman #75 Jenny Frison Variant DC 2019 NM' },
    { rawTitle: 'Wonder Woman #75 Jenny Frison Variant Cover DC' },
    { rawTitle: 'WONDER WOMAN #75 JENNY FRISON VARIANT 2019 DC' },
    { rawTitle: 'Wonder Woman #75 Jenny Frison Cover B DC 2019' },
    { rawTitle: 'Wonder Woman #75 Frison Variant DC Comics' },
    { rawTitle: 'Wonder Woman #75 Jenny Frison Variant NM DC' },
  ];
  const r = selectTitleFamilyCandidate(wwPool, 'Wonder Woman', '75', 2019, {
    ebayConsensusTitle: 'Wonder Woman',
  });
  assertTrue(
    r.decision === 'top-rank-protection' || r.decision === 'weighted-consensus',
    `WW#75 creator-family override must still fire, got decision=${r.decision}`
  );
  assertTrue(/wonder woman/i.test(r.selectedTitle || ''), `selected title must be the WW family, got "${r.selectedTitle}"`);
  assertTrue(!/creator-tokens-without-issue-corroboration/.test(r.reason || ''), 'WW#75 must not trip the new issue-corroboration gate');
});

test('non-regression: visionIssue absent entirely — gate does not fire (nothing to corroborate against)', () => {
  const r = selectTitleFamilyCandidate(spawnPool, 'Spawn', null, null, {
    ebayConsensusTitle: 'spawn',
  });
  // With no visionIssue at all, creatorTokensLackIssueCorroboration cannot
  // be computed (visionIssue is falsy) — this specific gate must stay
  // inert; whatever else the function decides is out of this test's scope.
  assertTrue(
    !/creator-tokens-without-issue-corroboration/.test(r.reason || ''),
    `gate must not fire when visionIssue is absent, got reason: ${r.reason}`
  );
});

for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`✗ ${name}`);
    console.log(`  ${e.message}\n`);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed (${tests.length} total)`);
if (failed > 0) {
  process.exit(1);
}
