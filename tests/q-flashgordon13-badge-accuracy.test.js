// Q-FLASHGORDON13-BADGE — active-pool-exhausted cap on matchConfidence
// (api/enrich.js, right after the existing "Fix D" zero-verified-sold cap).
// The cap itself is inline in enrich.js's handler, same constraint as
// every other cap in that chain (visionCapped / zeroVerifiedCapped /
// eraFilterBypassed / thin-data cap) -- none of them are separately
// exported. This test grounds the STARTING matchConfidence in the real,
// exported computeMatchConfidence (api/comps.js) using real Flash Gordon
// #13 sold-comp titles, then applies the new cap's exact logic (mirrored
// here, same shape as the fix) to verify the transformation.
//
// Regression anchor — Flash Gordon #13 (2026-07-15 production log, pulled
// via `vercel logs`): ai_verify (Haiku) kept 0/5 active listings
// (compsExhausted=true, driving the existing 'ai-verify-rejected-all'
// decision warning). Separately, verifySoldComps kept 16/30 sold comps --
// genuinely healthy, independent data. Real log:
//   [match-conf] score=100 tier=HIGH comps=16 vision=medium
//   [decision] action=RESEARCH confidence=low blockers=0 warnings=2
// Badge showed "✓ Verified 100" next to a RESEARCH/low-confidence
// decision on the same card. After this fix, the same inputs should cap
// to tier=MEDIUM (client renders "~ Similar NN", App.jsx ~5572, zero new
// UI needed).
//
// Invoke: node tests/q-flashgordon13-badge-accuracy.test.js

import { computeMatchConfidence } from '../api/comps.js';

let passed = 0;
let failed = 0;
const failures = [];

const assertEq = (actual, expected, label) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}\n    expected: ${e}\n    actual:   ${a}`;
    failures.push(msg);
    console.log(msg);
  }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);

// Mirrors enrich.js's new cap exactly (same condition, same clamp, same
// flag names) -- see api/enrich.js right after the "Fix D" zero-verified
// -sold cap for the real code this reproduces.
function applyActiveVerifyExhaustedCap(finalMc, { compsExhausted, hasSoldCompsButNoneVerified }) {
  const mc = { ...finalMc };
  if (compsExhausted && mc.tier === 'HIGH') {
    const originalScore = mc.score;
    mc.tier = 'MEDIUM';
    mc.score = Math.min(mc.score, 75);
    if (!hasSoldCompsButNoneVerified) {
      mc.displayMessage = 'Active listings all rejected by verification — priced from sold comps only';
    }
    mc.activeVerifyExhaustedCapped = true;
    mc.originalScore = originalScore;
  }
  return mc;
}

console.log('\n=== Q-FLASHGORDON13-BADGE — active-verify-exhausted matchConfidence cap ===\n');

// 16 real-ish sold-comp titles matching Flash Gordon #13 1969 closely
// (title+issue+year all present, matching computeMatchConfidence's own
// scoring -- title/issue/year hits at or near 100% for every comp).
const FLASHGORDON13_SOLD_TITLES = [
  'Flash Gordon #13 (1969) Charlton FN',
  'Flash Gordon #13 1969 Charlton VG+',
  'Flash Gordon #13 (1969) Charlton VF',
  'Flash Gordon #13 1969 Charlton Comics FN-',
  'Flash Gordon #13 (1969) Pat Boyette VG',
  'Flash Gordon #13 1969 Charlton Silver Age FN',
  'Flash Gordon #13 (1969) Jeff Jones art VF-',
  'Flash Gordon #13 1969 Charlton Comics VG',
  'Flash Gordon #13 (1969) Charlton FN+',
  'Flash Gordon #13 1969 Mud Men VG+',
  'Flash Gordon #13 (1969) Charlton Comics FN',
  'Flash Gordon #13 1969 Silver Age Charlton VF',
  'Flash Gordon #13 (1969) Charlton VG',
  'Flash Gordon #13 1969 Charlton Comics FN-',
  'Flash Gordon #13 (1969) Pat Boyette cover FN',
  'Flash Gordon #13 1969 Charlton VG+',
].map((title) => ({ title }));

assertEq(FLASHGORDON13_SOLD_TITLES.length, 16, 'fixture has 16 sold comps, matching the real "kept 16/30" log line');

const realMc = computeMatchConfidence(FLASHGORDON13_SOLD_TITLES, {
  title: 'flash gordon',
  issue: '13',
  year: '1969',
});

console.log(`  (real computeMatchConfidence output: score=${realMc.score} tier=${realMc.tier})`);
assertEq(realMc.tier, 'HIGH', 'real computeMatchConfidence scores this comp set HIGH -- the actual starting point, not synthesized');

// ─── The contradiction case: compsExhausted=true (real Flash Gordon #13) ──
console.log('\nWith compsExhausted=true (ai_verify kept 0/5 active listings):');

const cappedMc = applyActiveVerifyExhaustedCap(realMc, {
  compsExhausted: true,
  hasSoldCompsButNoneVerified: false,
});

assertEq(cappedMc.tier, 'MEDIUM', 'tier capped HIGH -> MEDIUM -- client renders "~ Similar NN", not "✓ Verified NN"');
assertTrue(cappedMc.score <= 75, 'score capped at 75');
assertEq(cappedMc.activeVerifyExhaustedCapped, true, 'cap flag set for downstream/debug visibility');
assertEq(cappedMc.originalScore, realMc.score, 'original (uncapped) score preserved for the trace, same pattern as the sibling caps');
assertTrue(
  cappedMc.displayMessage.includes('Active listings all rejected'),
  'displayMessage explains WHY, not just that something changed'
);

// ─── The sibling-cap-wins case: both conditions true ──────────────────
console.log('\nWhen the sold-comp cap already set a message (should not be overwritten):');
const bothCappedMc = applyActiveVerifyExhaustedCap(
  { tier: 'HIGH', score: 100, displayMessage: 'Sold comps exist but none verified — review data quality', zeroVerifiedCapped: true },
  { compsExhausted: true, hasSoldCompsButNoneVerified: true }
);
assertEq(bothCappedMc.tier, 'MEDIUM', 'still caps to MEDIUM');
assertEq(
  bothCappedMc.displayMessage,
  'Sold comps exist but none verified — review data quality',
  'more specific sibling-cap message wins, not overwritten'
);

// ─── Regression: a NORMAL card (ai_verify passes) must be unaffected ──
console.log('\nNormal card (ai_verify passes, compsExhausted=false) -- must be unaffected:');

const normalMc = computeMatchConfidence(FLASHGORDON13_SOLD_TITLES, {
  title: 'flash gordon',
  issue: '13',
  year: '1969',
});
const normalCapped = applyActiveVerifyExhaustedCap(normalMc, {
  compsExhausted: false,
  hasSoldCompsButNoneVerified: false,
});

assertEq(normalCapped.tier, 'HIGH', 'tier stays HIGH -- badge still shows "✓ Verified NN" when verification actually passed');
assertEq(normalCapped.score, normalMc.score, 'score unchanged');
assertEq(normalCapped.activeVerifyExhaustedCapped, undefined, 'cap flag not set -- this card was never touched by the new logic');

console.log(`\n=== RESULTS ===`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) {
  console.log('\n=== FAILURES ===');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
console.log('All tests passed.\n');
process.exit(0);
