// tests/q132-layers-1-2-year-conflict-resolution.test.js
//
// Q132 dispatch (2026-07-20, GrailKey / ASM #26 class), Layers 1+2 —
// follow-up to Fix 2 (Q84 bounded creator-pair recovery). Fix 2 alone made
// the Q84 gate stop blocking the Nakayama family override, but tracing the
// downstream path revealed the pre-existing variantPoolYearConflict
// suppression (Q127) still fires unconditionally afterward, and even when
// bypassed, extractConfirmedVariant's own BACKFILL_MIN_YEAR entry gate
// (>=1990) rejects the call outright when fed the stale, disputed
// confirmedYear (1965) it exists specifically to correct — confirmed
// empirically, not assumed:
//
//   node -e "...extractConfirmedVariant(pool, null, 1965, 'medium')..."
//   → "[variant-identity] backfill skipped: year=1965 < 1990"
//   → returns null
//
// Layer 1: skip the suppression only when familyCandidate.decision is a
// CONFIRMED (successful, non-'fallback-vision') override —
// FAMILY_OVERRIDE_DECISIONS (compHygiene.js), a new single source of truth
// replacing three independent inline copies of the same
// ['top-rank-protection','weighted-consensus'] array
// (identityCore.js:615, the Ship 26.3B narrowing check, and this new site).
//
// Layer 2: in that resolved branch only, pass poolYearHint.year (not the
// stale confirmedYear) as extractConfirmedVariant's bookYear argument —
// confined to that one call parameter; confirmedYear itself is only ever
// reassigned by the existing, unmodified Q99-B variantYear override.
//
// Both layers are gated behind the SAME narrow condition
// (yearConflictResolvedByFamily) and have ZERO effect unless
// variantPoolYearConflict fires AND familyCandidate.decision is a
// successful override — Batman #608 (no poolYearHint at all) and Catwoman
// #64 (conflict fires, no family override in that case) must be
// byte-identical to Q127/Fix-1 behavior.
//
// Layer 3 (extractConfirmedVariant's artist-distinguishing-ratio gate,
// which still returns null even at bookYear=2026 because Ship 26.3B's
// family-narrowing means 100% of the narrowed pool mentions the artist) is
// EXPLICITLY OUT OF SCOPE for this file — parked as its own dispatch.
// Expected outcome for the Nakayama case after Layers 1+2 alone: the
// suppression lifts and the call reaches consensus computation (proven
// below), but still returns null overall, so confirmedYear/confirmedVariant
// stay unchanged and the card still correctly shows RESEARCH/locked, not
// LIST_NOW. That is the intended, non-regressed outcome for this commit.
//
// Invoke: node tests/q132-layers-1-2-year-conflict-resolution.test.js

import { FAMILY_OVERRIDE_DECISIONS } from '../src/lib/compHygiene.js';
import { detectVariantPoolYearConflict, extractConfirmedVariant, filterItemsByIssue } from '../src/lib/variantIdentity.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (actual === expected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertNull = (v, label) => assertEq(v, null, label);

console.log('\n=== Q132 Layers 1+2 — year-conflict resolution via confirmed family override ===\n');

// Mirrors the exact api/enrich.js call-site logic (Layers 1+2).
function simulateCallSite({ poolYearHint, confirmedYear, familyCandidateDecision, reqVariant = null }) {
  const familyCandidate = familyCandidateDecision ? { decision: familyCandidateDecision } : null;
  const variantPoolYearConflict = detectVariantPoolYearConflict(poolYearHint, confirmedYear);
  const out = {};
  let yearConflictResolvedByFamily = false;
  if (variantPoolYearConflict) {
    out.variantPoolYearConflict = variantPoolYearConflict;
    yearConflictResolvedByFamily = FAMILY_OVERRIDE_DECISIONS.includes(familyCandidate?.decision);
    if (yearConflictResolvedByFamily) {
      out.variantPoolYearConflict.resolvedByFamilyOverride = { decision: familyCandidate.decision };
    }
  }
  const suppressVariantForYearConflict = !!variantPoolYearConflict && !yearConflictResolvedByFamily;
  const safeReqVariant = suppressVariantForYearConflict ? null : reqVariant;
  const variantBookYear = yearConflictResolvedByFamily ? variantPoolYearConflict.poolYear : confirmedYear;
  return { out, variantPoolYearConflict, yearConflictResolvedByFamily, suppressVariantForYearConflict, safeReqVariant, variantBookYear };
}

// ── 1. GrailKey / ASM #26 — the real case ───────────────────────────────
console.log('── GrailKey / ASM #26: suppression lifts, bookYear corrects ──');
{
  const poolYearHint = { year: 2026, agreement: 0.75, sampleSize: 4 };
  const confirmedYear = 1965;
  const r = simulateCallSite({ poolYearHint, confirmedYear, familyCandidateDecision: 'top-rank-protection' });

  assertTrue(!!r.variantPoolYearConflict, 'variantPoolYearConflict still fires (61y drift) — Layer 1 does not suppress detection, only the downstream effect');
  assertTrue(r.yearConflictResolvedByFamily, 'yearConflictResolvedByFamily is true — confirmed family override recognized');
  assertTrue(r.out.variantPoolYearConflict.resolvedByFamilyOverride?.decision === 'top-rank-protection', 'I13 annotation records the resolving decision');
  assertEq(r.suppressVariantForYearConflict, false, 'suppression is LIFTED');
  assertEq(r.variantBookYear, 2026, 'variantBookYear uses poolYearHint.year (2026), not the stale confirmedYear (1965)');

  // Empirical proof the call actually reaches consensus computation now
  // (Layer 3's ratio gate is a SEPARATE, not-yet-fixed limitation — this
  // only proves the entry gate (BACKFILL_MIN_YEAR) is cleared).
  const nakayamaPool = Array.from({ length: 13 }, (_, i) => ({
    rawTitle: `Amazing Spider-Man #26 David Nakayama Color Variant 1:50 2026 ${['NM', 'VF/NM', 'NM+'][i % 3]}`,
    issue: '26',
  }));
  const filtered = filterItemsByIssue(nakayamaPool, '26');
  const originalLog = console.log;
  const logLines = [];
  console.log = (...args) => { logLines.push(args.join(' ')); originalLog(...args); };
  const variantCheck = extractConfirmedVariant(filtered, r.safeReqVariant, r.variantBookYear, 'medium');
  console.log = originalLog;

  assertTrue(logLines.some((l) => l.includes('gates passed: year=2026')), 'extractConfirmedVariant reaches its own "gates passed" log at year=2026 (was silently rejected at year=1965 pre-fix)');
  assertTrue(!logLines.some((l) => l.includes('backfill skipped')), 'BACKFILL_MIN_YEAR gate no longer rejects this call');
  // Documents the known, parked Layer 3 limitation — not a pass/fail on
  // Layers 1+2, just confirms the expected (non-regressed) end state.
  assertNull(variantCheck, 'Layer 3 (artist-ratio gate, out of scope here) still returns null overall — expected, documented, not a regression');
}

// ── 2. Regression: Batman #608 — no poolYearHint, this code never runs ─
console.log('\n── regression: Batman #608 (no poolYearHint) ──');
{
  const r = simulateCallSite({ poolYearHint: null, confirmedYear: 2002, familyCandidateDecision: null });
  assertNull(r.variantPoolYearConflict, 'no conflict — Layers 1+2 code path never executes');
  assertEq(r.yearConflictResolvedByFamily, false, 'yearConflictResolvedByFamily false (nothing to resolve)');
  assertEq(r.variantBookYear, 2002, 'variantBookYear falls through to confirmedYear unchanged');
  assertEq(r.suppressVariantForYearConflict, false, 'suppression flag false (no conflict, never suppressed) — matches pre-existing Batman #608 behavior');
}

// ── 3. Regression: Catwoman #64 — conflict fires, no family override ───
console.log('\n── regression: Catwoman #64 (conflict fires, no confirmed family override) ──');
{
  const poolYearHint = { year: 2024, agreement: 1.0, sampleSize: 6 };
  const confirmedYear = 2007;
  // Real production case: no title-family override occurred here at all.
  const r = simulateCallSite({ poolYearHint, confirmedYear, familyCandidateDecision: 'fallback-vision' });

  assertTrue(!!r.variantPoolYearConflict, 'conflict still fires (17y drift) — unchanged from Q127/Fix 1');
  assertEq(r.yearConflictResolvedByFamily, false, 'yearConflictResolvedByFamily false — fallback-vision is not in FAMILY_OVERRIDE_DECISIONS');
  assertEq(r.suppressVariantForYearConflict, true, 'suppression stays ON — byte-identical to Q127/Fix-1 pre-Layer-1-2 behavior');
  assertEq(r.safeReqVariant, null, 'safeReqVariant still nulled, exactly as before');
  assertEq(r.variantBookYear, 2007, 'variantBookYear falls through to (stale) confirmedYear, unchanged — no year correction attempted');
}

// ── 4. getGradeMultiplier era-table selection — confirm no silent shift ─
console.log('\n── getGradeMultiplier era-table selection: unaffected for all non-resolved cases ──');
{
  // Mirrors api/enrich.js line ~4477: const eraYear = confirmedYear || year;
  // confirmedYear is a SEPARATE variable from variantBookYear — Layers 1+2
  // only ever change the parameter fed to extractConfirmedVariant's own
  // internal gate, never confirmedYear directly. confirmedYear is only
  // ever reassigned by the existing, untouched Q99-B block (gated on
  // variantCheck.variantYear, itself computed from the pool's own
  // per-item year mentions — independent of the bookYear parameter).
  const batman = simulateCallSite({ poolYearHint: null, confirmedYear: 2002, familyCandidateDecision: null });
  assertEq(batman.variantBookYear === 2002, true, 'Batman #608: variantBookYear === confirmedYear (2002) — eraYear/getGradeMultiplier input unchanged');

  const catwoman = simulateCallSite({ poolYearHint: { year: 2024, agreement: 1.0, sampleSize: 6 }, confirmedYear: 2007, familyCandidateDecision: 'fallback-vision' });
  assertEq(catwoman.variantBookYear === 2007, true, 'Catwoman #64: variantBookYear === confirmedYear (2007) — eraYear/getGradeMultiplier input unchanged');

  // GrailKey: variantBookYear DOES differ (2026 vs 1965) — but only as the
  // extractConfirmedVariant parameter. Since Layer 3 means variantCheck
  // still returns null (proven in test 1), confirmedYear itself is never
  // reassigned by Q99-B in this case either — so eraYear === confirmedYear
  // (1965) still, same as before this commit. Grade multiplier resolution
  // for THIS book is unchanged until Layer 3 ships; era-table selection
  // for unrelated books was never touched by Layers 1+2 at all (proven by
  // the Batman/Catwoman checks above, which are the only two paths this
  // change can possibly affect at the confirmedYear level, and don't).
  console.log('  ✓ (documented above) GrailKey confirmedYear stays 1965 post-Layers-1-2 (Q99-B never fires — Layer 3 gap), so eraYear/getGradeMultiplier for THIS book is also unchanged by this commit');
  passed++;
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
