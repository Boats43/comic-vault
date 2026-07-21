// tests/q133-two-axis-pc-anchor-gate.test.js
//
// Q133 dispatch (2026-07-21, Invincible/Pop Kill class) — generalizes Q132
// Layer 4 from a year-only check gated behind a confirmed family override
// (yearConflictResolvedByFamily) into a two-axis check (year OR product-
// name-vs-pool) that runs whenever a PC match exists, regardless of family
// decision. Sandbox-validated first (harness.mjs, prior dispatch) against 5
// real production pools pulled live from Vercel (03:00 UTC 2026-07-21,
// build ffc1999) plus the Q132 precedent set.
//
// Real production values used below are taken directly from that pull, not
// invented:
//   Invincible #1 MegaCon: PC matched "Invincible Universe: Battle Beast #1
//     (2025)" (id=8678815) against a pool whose own poolYearHint was
//     {year:2026, agreement:1.0, sampleSize:7} — only 1y drift (year axis
//     alone would NOT reject this), but 0/20 pool rawTitles mention "battle
//     beast"/"universe" (name axis rejects it, ratio=0.25).
//   Pop Kill Lozano: PC matched "Alexander Hamilton #1" (id=7470774,
//     year=null) — no poolYearHint was computed for this pool at all, so the
//     year axis can't fire; the naive name-axis ratio (1/2 tokens matched,
//     both products happen to start with "Alexander") would have PASSED at
//     ratio=0.5 — the >=2-token floor is what actually rejects it.
//   ASM #26/GrailKey (Q132 precedent, already covered by q132-layer4-pc-
//     year-gate.test.js): PC year 2001 vs poolYearHint 2026 — year axis
//     rejects; PC name "Amazing Spider-Man #26" textually overlaps its own
//     pool fully, so the name axis alone would NOT have caught this one —
//     confirming neither axis is sufficient alone, both are needed.
//
// Invoke: node tests/q133-two-axis-pc-anchor-gate.test.js

import { pcMatchConflictsWithPoolName, pcMatchConflictsWithPoolYear } from '../src/lib/variantIdentity.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (actual === expected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertFalse = (cond, label) => assertEq(!!cond, false, label);

console.log('\n=== Q133 — two-axis PC anchor gate ===\n');

// ═══════════════════════════════════════════════════════════════════════
// PART 1 — pcMatchConflictsWithPoolName: pure unit tests
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 1: pcMatchConflictsWithPoolName unit behavior\n');

assertFalse(pcMatchConflictsWithPoolName(null, ['Poison Ivy #31 Variant']), 'no PC name → no conflict (nothing to check)');
assertFalse(pcMatchConflictsWithPoolName('Poison Ivy #31 (2025)', []), 'no pool titles → no conflict (nothing to check against)');

// The real Invincible/Battle Beast case: 0/20 pool titles mention battle beast/universe.
const invinciblePool = [
  'INVINCIBLE RETURNS #1 EOM MEGACON EXCLUSIVE ATOM EVE VIRGIN VARIANT LTD 1500',
  'INVINCIBLE #1  KYUYONG EOM SIGNED W/COA!',
  'Invincible #1 Kyuyong EOM MegaCon Exclusive (LTD 1500 with COA) Signed/Remarked',
];
assertTrue(
  pcMatchConflictsWithPoolName('Invincible Universe: Battle Beast #1 (2025)', invinciblePool),
  'real GrailKey-class case: "Invincible Universe: Battle Beast" conflicts with an all-"invincible" pool (ratio=0.25)'
);

// The real Pop Kill Lozano / "Alexander Hamilton" false-negative the sandbox caught.
const lozanoPool = [
  'Alexander Lozano Signed Pop Kill #1 Metal Megacon Exclusive (Naughty) LTD 100',
  'Pop Kill (Mad Cave Studios) #1 Lozano Exclusive Megacon Variant Regular Version',
  'SIGNED ALEXANDER LOZANO POP KILL #1 MEGACON EXCLUSIVE SET LMTD 200 NM+ W COA',
];
assertTrue(
  pcMatchConflictsWithPoolName('Alexander Hamilton #1', lozanoPool),
  'real Lozano case: "Alexander Hamilton" conflicts despite 1/2-token ratio=0.5 (>=2-token floor catches the shared-first-name false-negative)'
);

// Genuine agreement — Poison Ivy #31's own real PC match against its own real pool.
const poisonIvy31Pool = [
  'Poison Ivy #31 Variant Signed by Jenny Frison 2025 w/COA..',
  'Poison Ivy #31 Variant Cover B SIGNED by Jenny Frison WITH COA 2025 NM',
  'Poison Ivy #31 Signed By Jennie Frison With Coa',
];
assertFalse(
  pcMatchConflictsWithPoolName('Poison Ivy #31 (2025)', poisonIvy31Pool),
  'genuine agreement: "Poison Ivy #31" fully overlaps its own pool (both tokens present)'
);

// GrailKey/ASM #26 — name axis alone must NOT catch this (proves the year axis stays necessary).
const asm26Pool = [
  'Amazing Spider-Man #26 David Nakayama Color Variant 1:50 2026 NM',
  'Amazing Spider-Man #26 David Nakayama Color Variant 1:50 2026 VF/NM',
];
assertFalse(
  pcMatchConflictsWithPoolName('Amazing Spider-Man #26 (2001)', asm26Pool),
  'GrailKey/ASM #26: name axis alone does NOT reject (same title/issue, only the year is wrong) — proves the year axis is still required'
);

// A single-token PC name should not be over-penalized by the >=2-token floor.
assertFalse(
  pcMatchConflictsWithPoolName('Invincible', ['invincible #1 megacon exclusive']),
  'single-token PC name (ratio=1.0) is unaffected by the >=2-token floor'
);

// ═══════════════════════════════════════════════════════════════════════
// PART 2 — End-to-end call-site simulation (mirrors the generalized
// api/enrich.js gate, run regardless of family decision)
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: generalized gate — end-to-end call-site simulation\n');

function simulateGate({ priceCharting, poolYearHint, poolRawTitles, confirmedYearMeta, confirmedYear }) {
  const out = {
    pcProductId: priceCharting?.id ?? null,
    pcProductName: priceCharting?.productName ?? null,
    confirmedYearMeta,
  };
  let pc = priceCharting;
  let cy = confirmedYear;
  if (pc) {
    const yearConflict = pcMatchConflictsWithPoolYear(pc.year, poolYearHint);
    const nameConflict = pcMatchConflictsWithPoolName(pc.productName, poolRawTitles);
    if (yearConflict || nameConflict) {
      out.pcMatchRejectedForYearConflict = {
        rejectedProductName: pc.productName,
        conflictAxes: [yearConflict && 'year', nameConflict && 'name'].filter(Boolean).join('+'),
      };
      out.pcProductId = null;
      out.pcProductName = null;
      pc = null;
      if (poolYearHint?.year != null && confirmedYearMeta?.source === 'pricecharting') {
        cy = String(poolYearHint.year);
        out.confirmedYearMeta = { value: cy, source: 'pc-anchor-rejected-corrected', confidence: 'proven' };
      }
    }
  }
  return { out, priceCharting: pc, confirmedYear: cy };
}

// Real Invincible case: fallback-vision decision (not a FAMILY_OVERRIDE_DECISIONS
// entry) — the OLD gate (yearConflictResolvedByFamily-gated) would NEVER have
// reached this book at all. The generalized gate must reject it anyway.
{
  const r = simulateGate({
    priceCharting: { id: 8678815, productName: 'Invincible Universe: Battle Beast #1 (2025)', year: 2025 },
    poolYearHint: { year: 2026, agreement: 1.0, sampleSize: 7 },
    poolRawTitles: invinciblePool,
    confirmedYearMeta: { source: 'pricecharting' },
    confirmedYear: 2025,
  });
  assertEq(r.priceCharting, null, 'Invincible: PC match rejected (name axis) even though family decision was fallback-vision, not a confirmed override');
  assertEq(r.out.pcMatchRejectedForYearConflict.conflictAxes, 'name', 'Invincible: rejected specifically on the name axis (year axis alone would not have fired — 1y drift)');
  assertEq(r.confirmedYear, '2026', 'Invincible: confirmedYear corrected 2025 → 2026 (poolYearHint present, source was pricecharting)');
}

// Real Lozano case: no poolYearHint at all. Must reject on name axis via the
// >=2-token floor, and must NOT crash or misassign confirmedYear (no
// poolYearHint to correct to, and the real confirmedYear source was
// comicvine, not pricecharting).
{
  const r = simulateGate({
    priceCharting: { id: 7470774, productName: 'Alexander Hamilton #1', year: null },
    poolYearHint: null,
    poolRawTitles: lozanoPool,
    confirmedYearMeta: { source: 'comicvine' },
    confirmedYear: 2014,
  });
  assertEq(r.priceCharting, null, 'Lozano: PC match rejected (name axis, >=2-token floor) despite no poolYearHint to check year against');
  assertEq(r.out.pcMatchRejectedForYearConflict.conflictAxes, 'name', 'Lozano: rejected on name axis only (year axis never had evidence to fire)');
  assertEq(r.confirmedYear, 2014, 'Lozano: confirmedYear left untouched — poolYearHint absent AND source was comicvine, not pricecharting');
}

// GrailKey/ASM #26 — regression: must still reject (year axis), now via the
// generalized (family-decision-agnostic) gate instead of the old narrow one.
{
  const r = simulateGate({
    priceCharting: { id: 2367113, productName: 'Amazing Spider-Man #26 (2001)', year: 2001 },
    poolYearHint: { year: 2026, agreement: 0.75, sampleSize: 4 },
    poolRawTitles: asm26Pool,
    confirmedYearMeta: { source: 'pricecharting' },
    confirmedYear: 1965,
  });
  assertEq(r.priceCharting, null, 'GrailKey/ASM #26: PC match still rejected under the generalized gate (year axis)');
  assertEq(r.out.pcMatchRejectedForYearConflict.conflictAxes, 'year', 'GrailKey/ASM #26: rejected on year axis only (name axis agrees — same title/issue)');
  assertEq(r.confirmedYear, '2026', 'GrailKey/ASM #26: confirmedYear corrected 1965 → 2026');
}

// ═══════════════════════════════════════════════════════════════════════
// PART 3 — Regression: agreeing/absent-evidence cases stay byte-identical
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: regression — agreeing cases untouched\n');

// Real Poison Ivy #31: PC year 2025 vs poolYearHint 2024 (1y, agrees); PC
// name fully overlaps its own pool.
{
  const r = simulateGate({
    priceCharting: { id: 8756158, productName: 'Poison Ivy #31 (2025)', year: 2025 },
    poolYearHint: { year: 2024, agreement: 0.55, sampleSize: 11 },
    poolRawTitles: poisonIvy31Pool,
    confirmedYearMeta: { source: 'pc-cv-agreement' },
    confirmedYear: 2024,
  });
  assertTrue(!!r.priceCharting, 'Poison Ivy #31: PC match kept (both axes agree) — byte-identical to today');
  assertEq(r.out.pcMatchRejectedForYearConflict, undefined, 'Poison Ivy #31: no rejection annotation');
}

// Catwoman #64 (Q132 precedent): PC/pool agree on year and name.
{
  const catwomanPool = ['Catwoman #64 (2024 Szerdy Homage Variant)', 'Catwoman #64 2024 Nathan Szerdy Trade Dress'];
  const r = simulateGate({
    priceCharting: { id: 999002, productName: 'Catwoman #64 (2024 Szerdy)', year: 2024 },
    poolYearHint: { year: 2024, agreement: 1.0, sampleSize: 6 },
    poolRawTitles: catwomanPool,
    confirmedYearMeta: { source: 'pricecharting' },
    confirmedYear: 2007,
  });
  assertTrue(!!r.priceCharting, 'Catwoman #64: PC match kept (both axes agree) — byte-identical to today');
}

// Batman #608 (Q112/Q115 precedent): no poolYearHint at all; PC name fully
// overlaps its pool. Neither axis has grounds to fire.
{
  const batmanPool = ['Batman #608 (2002) Jim Lee Hush Cover A', 'Batman #608 Hush Part 1 2002'];
  const r = simulateGate({
    priceCharting: { id: 999001, productName: 'Batman #608 (2002)', year: 2002 },
    poolYearHint: null,
    poolRawTitles: batmanPool,
    confirmedYearMeta: { source: 'pricecharting' },
    confirmedYear: 2002,
  });
  assertTrue(!!r.priceCharting, 'Batman #608: PC match kept — no poolYearHint (year axis inert) and name fully overlaps (name axis inert)');
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
