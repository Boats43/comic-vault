// tests/q142-instance2-phase2-population.test.js
//
// Q142 instance 2 (2026-07-22, Adventure Time Summer Special / SDCC class,
// certification scan on cbb6050) — Q142's original fix only touched the
// FIRST checkAssemblyIntegrity call site (api/enrich.js ~line 2604, Phase
// 1, missing-Vision-tokens + pre-comps consensus check). Live certification
// confirmed Phase 1 passed cleanly this exact scan (mode=winning-family
// count=5), but a SECOND, independent invocation at Phase 2 (~line 4770,
// runs AFTER comps are fetched, token-addition consensus rule) still used
// rawComps.prices as its reference population — not guaranteed to be the
// same clean, family-matched set the final card displays, and diluted
// enough in production that "summer"/"special" scored <60% despite being
// the winning family's own 100%-overlap canonical tokens. That reverted
// confirmedTitle back to bare "Adventure Time" four lines later, which
// cascaded: convergence recomputed on the bare title dropped to 60/LOW,
// which blocked Slice A3's exemption (tier must be !=LOW), which triggered
// the Vision-low-confidence refusal -> ID_REQUIRED. One bug, whole cascade.
//
// Fix framing (ChatGPT's refinement, adopted): the defect is the
// CONSENSUS REFERENCE, not just population size. When an accepted family
// override exists, the winning family IS the consensus baseline -- reuses
// the exact same winningFamilyTitles Phase 1 already computed (hoisted to
// an outer scope in api/enrich.js, not a second independently-driftable
// copy), never skips or deletes the check. Falls back to rawComps.prices
// for every non-override path, byte-identical to before.
//
// Enumeration per the Eternus rule (confirmed before any diff was written):
// exactly TWO production call sites of checkAssemblyIntegrity exist in the
// entire codebase -- api/enrich.js:2649 (Phase 1, fixed by the original
// Q142 dispatch) and api/enrich.js:4762->4798 (Phase 2, fixed by this
// dispatch). No third site exists (confirmed via direct grep across api/
// and src/).
//
// This file mirrors api/enrich.js's exact Phase 1 + Phase 2 population-
// selection logic inline (same convention as
// tests/q142-assembly-integrity-family-population.test.js -- neither
// phase's selection logic is independently exported from the ~11,800-line
// handler) and tests the FULL CASCADE through both phases, not just
// checkAssemblyIntegrity's isolated return value.
//
// Invoke: node tests/q142-instance2-phase2-population.test.js

import { checkAssemblyIntegrity } from '../src/lib/identityCore.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (actual === expected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertFalse = (cond, label) => assertEq(!!cond, false, label);

console.log('\n=== Q142 instance 2 — Phase 2 consensus-reference fix ===\n');

const SDCC_FAMILY = [
  'Adventure Time Summer Special #1 SDCC Convention Exclusive 2013',
  'Adventure Time Summer Special #1 SDCC Convention Exclusive 2013 NM',
  'Adventure Time Summer Special #1 SDCC Convention Exclusive 2013 VF',
  'Adventure Time Summer Special #1 SDCC Convention Exclusive 2013 High Grade',
  'Adventure Time Summer Special #1 SDCC Convention Exclusive 2013 In Hand',
];
const KABOOM_FAMILY = [
  'Adventure Time #1 KaBOOM 2012',
  'Adventure Time #1 KaBOOM 2012 NM',
  'Adventure Time #1 KaBOOM Comics',
  'Adventure Time #1 VF 2012',
  'Adventure Time #1 2012 High Grade',
];

// Mirrors api/enrich.js's exact Phase 1 + Phase 2 logic, post-fix. Both
// phases share ONE winningFamilyTitles value (the hoisted outer-scope
// variable in the real code), computed once from the family override.
function runPipeline({ familyOverrideAccepted, topFamilyTitles, rawCompsTitles, effectiveTitle, confirmedTitleAfterIdentity }) {
  let confirmedTitle = confirmedTitleAfterIdentity;
  let assemblyIntegrityFailed = false;

  const winningFamilyTitles = familyOverrideAccepted && topFamilyTitles?.length > 0 ? topFamilyTitles : null;

  // Phase 1 (unchanged since the original Q142 fix — included here only
  // to prove the cascade holds end-to-end, not to re-test Phase 1 itself).
  const phase1CompTitles = winningFamilyTitles && winningFamilyTitles.length > 0
    ? winningFamilyTitles
    : rawCompsTitles; // stand-in for parsedVisualRows in this simplified harness
  const phase1Check = checkAssemblyIntegrity(effectiveTitle, confirmedTitle, phase1CompTitles);
  if (phase1Check.shouldFallback) {
    confirmedTitle = effectiveTitle;
    assemblyIntegrityFailed = true;
  }

  // Phase 2 — the fixed site.
  const phase2UseFamily = winningFamilyTitles && winningFamilyTitles.length >= 3;
  const phase2CompTitles = phase2UseFamily
    ? winningFamilyTitles
    : (rawCompsTitles.length >= 3 ? rawCompsTitles : null);
  if (!assemblyIntegrityFailed && phase2CompTitles && phase2CompTitles.length >= 3) {
    const phase2Check = checkAssemblyIntegrity(effectiveTitle, confirmedTitle, phase2CompTitles);
    if (phase2Check.shouldFallback && phase2Check.reason === 'excess-non-consensus-tokens') {
      confirmedTitle = effectiveTitle;
      assemblyIntegrityFailed = true;
    }
  }

  return { confirmedTitle, assemblyIntegrityFailed, phase2UseFamily };
}

// ═══════════════════════════════════════════════════════════════════════
// Fixture 1 — the cascade: the actual failure chain, asserted end-to-end
// ═══════════════════════════════════════════════════════════════════════
console.log('Fixture 1: the cascade — family-override title survives Phase 2, reaches the end\n');

{
  // Diluted rawComps.prices population (the real production shape at the
  // active-comps stage, NOT identical to Q142's own full-19-item visual
  // pool — a separate diluted population at a separate pipeline stage):
  // only 2/7 mention "summer"/"special" — scores well under 60%.
  const dilutedRawComps = [...SDCC_FAMILY.slice(0, 2), ...KABOOM_FAMILY];

  const preFixResult = (() => {
    // Pre-fix Phase 2: always uses rawComps.prices, ignores winningFamilyTitles.
    let confirmedTitle = 'adventure time summer special';
    const phase2Check = checkAssemblyIntegrity('Adventure Time', confirmedTitle, dilutedRawComps);
    if (phase2Check.shouldFallback && phase2Check.reason === 'excess-non-consensus-tokens') {
      confirmedTitle = 'Adventure Time';
    }
    return confirmedTitle;
  })();
  assertEq(preFixResult, 'Adventure Time', 'pre-fix reproduction: Phase 2 reverts to bare title against the diluted rawComps pool (the actual bug)');

  const postFix = runPipeline({
    familyOverrideAccepted: true,
    topFamilyTitles: SDCC_FAMILY,
    rawCompsTitles: dilutedRawComps,
    effectiveTitle: 'Adventure Time',
    confirmedTitleAfterIdentity: 'adventure time summer special',
  });
  assertEq(postFix.confirmedTitle, 'adventure time summer special', 'post-fix: title HOLDS through both phases — no bare-title revert reaches downstream logic');
  assertFalse(postFix.assemblyIntegrityFailed, 'post-fix: assemblyIntegrityFailed stays false — no cascade trigger for A3/identity-gate to react to');
  assertTrue(postFix.phase2UseFamily, 'Phase 2 correctly used the winning-family population (mode=winning-family)');
}

// ═══════════════════════════════════════════════════════════════════════
// Fixture 2 — first site byte-identical (Q142's own suite, re-run)
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture 2: first site (Phase 1) byte-identical — see tests/q142-assembly-integrity-family-population.test.js\n');
{
  // Phase 1's own logic and checkAssemblyIntegrity itself are untouched by
  // this dispatch — only removed a `const` in favor of assigning the
  // hoisted outer-scope variable. Re-verified directly: same population,
  // same result, as Q142's original fix already proved.
  const r = checkAssemblyIntegrity('Adventure Time', 'adventure time summer special', SDCC_FAMILY);
  assertFalse(r.shouldFallback, 'Phase 1 winning-family population still does not force fallback (unchanged)');
}

// ═══════════════════════════════════════════════════════════════════════
// Fixture 3 — genuine corruption still FAILS the Phase 2 check (the
// check's real purpose preserved, not bypassed)
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture 3: genuine corruption still fails Phase 2 (not a blanket family bypass)\n');

{
  // Scattered addition WITHIN the winning family itself (mirrors Q142's
  // own Part 3 control) — "sdcc"/"sketch" appear in only 1/5 family
  // members. Even with familyOverrideAccepted=true and the family as the
  // Phase 2 population, a genuine non-consensus addition still reverts.
  const scatteredFamily = [
    'Adventure Time Summer Special #1 2013',
    'Adventure Time Summer Special #1 2013 NM',
    'Adventure Time Summer Special #1 2013 VF',
    'Adventure Time Summer Special #1 2013 High Grade',
    'Adventure Time Summer Special #1 SDCC Sketch Variant Exclusive 2013', // lone outlier
  ];
  const result = runPipeline({
    familyOverrideAccepted: true,
    topFamilyTitles: scatteredFamily,
    rawCompsTitles: scatteredFamily, // irrelevant here — family population wins regardless
    effectiveTitle: 'Adventure Time',
    confirmedTitleAfterIdentity: 'adventure time summer special sdcc sketch',
  });
  assertEq(result.confirmedTitle, 'Adventure Time', 'genuine excess-token corruption (sdcc/sketch, 1/5 family members) still forces a revert at Phase 2');
  assertTrue(result.assemblyIntegrityFailed, 'assemblyIntegrityFailed correctly set true for real corruption — the check still guards its real purpose');
}

// ═══════════════════════════════════════════════════════════════════════
// Fixture 4 — non-override path byte-identical (no accepted family
// override -> Phase 2 still uses rawComps.prices exactly as before)
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture 4: non-override path — Phase 2 unchanged, still uses rawComps.prices\n');

{
  // No family override accepted at all (e.g. fallback-vision decision) —
  // winningFamilyTitles is null, phase2UseFamily must be false, and the
  // genuine rawComps-based excess-token bug (Spawn #6 "lot and" class,
  // reused shape) still fires exactly as pre-dispatch.
  const rawCompsExcess = [
    'Spawn #6 NM',
    'Spawn #6 VF',
    'Spawn #6 FN',
  ];
  const result = runPipeline({
    familyOverrideAccepted: false,
    topFamilyTitles: null,
    rawCompsTitles: rawCompsExcess,
    effectiveTitle: 'Spawn',
    confirmedTitleAfterIdentity: 'spawn lot and',
  });
  assertFalse(result.phase2UseFamily, 'non-override path: phase2UseFamily is false, exactly as before this dispatch');
  assertEq(result.confirmedTitle, 'Spawn', 'non-override path: genuine excess-token bug ("lot","and") still reverts via rawComps.prices, byte-identical to pre-dispatch behavior');
}

{
  // Non-override path, control: rawComps.prices DOES support the added
  // tokens — no revert, exactly as before.
  const rawCompsSupporting = [
    'Amazing Fantasy 15 Facsimile Edition NM',
    'Amazing Fantasy 15 Facsimile Edition VF',
    'Amazing Fantasy 15 Facsimile Edition FN',
  ];
  const result = runPipeline({
    familyOverrideAccepted: false,
    topFamilyTitles: null,
    rawCompsTitles: rawCompsSupporting,
    effectiveTitle: 'Amazing Fantasy 15',
    confirmedTitleAfterIdentity: 'amazing fantasy 15 facsimile edition',
  });
  assertFalse(result.phase2UseFamily, 'non-override control: phase2UseFamily is false');
  assertEq(result.confirmedTitle, 'amazing fantasy 15 facsimile edition', 'non-override control: genuinely-supported addition survives via rawComps.prices, byte-identical to pre-dispatch');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
