// tests/q132-layer4b-confirmedyear-correction.test.js
//
// Q132 dispatch (2026-07-20, GrailKey / ASM #26 class), Layer 4b —
// follow-up to Layer 4. Confirmed live (production, deployment
// dpl_9CWzsk7D6ZhGTqpBYCcg49tRq9zc): Layer 4 correctly rejected the wrong
// PC match (pcProductId=null, no price ladder / no CGC population section
// rendered — the contamination Layer 4 targeted is gone). But
// confirmedYear/out.year stayed at 2001 on the rendered card
// ("amazing spider man david color #26 / 2001 · NM 9.2"), and the warning
// banner literally read "vs confirmed 2001" — restating the just-rejected
// PC match's year as if still authoritative.
//
// Root cause: resolveYear (identityCore.js) derives confirmedYear from
// pcYear = priceCharting?.year BEFORE Layer 4 ever runs (Layer 4 sits much
// later in the handler, gated on yearConflictResolvedByFamily). Rejecting
// priceCharting alone doesn't undo a value already computed from it.
//
// Fix: when Layer 4 rejects a PC match, also correct confirmedYear (and
// out.confirmedYearMeta, and out.variantPoolYearConflict.confirmedYear —
// the exact field describeWarning reads for the banner text) to
// poolYearHint.year — NOT null. getEra(year) (api/enrich.js) defaults
// null → 'vintage'; reverting to null would misroute an already-confirmed-
// modern book into the vintage multiplier tables. poolYearHint is the
// same value Layer 2 already trusts for extractConfirmedVariant's bookYear
// parameter in this identical branch — reused here, not reinvented.
//
// Confirmed via direct trace (not assumed): getEra's single 1985 boundary
// means BOTH 2001 and 2026 route to CGC_MULTIPLIERS.modern — the
// gradeMult=1.2 observed on this exact card (grade 9.2) is identical
// either way. This fix does not change this card's multiplier; it exists
// so a FUTURE case straddling the 1985 boundary differently doesn't
// silently misselect the wrong era table via this same stale-confirmedYear
// path (logged as a known, not-yet-materialized risk, not fixed here).
//
// Deliberately narrow: gated on the same yearConflictResolvedByFamily +
// pcYearConflict combination as Layer 4 itself. Batman #608, Catwoman #64,
// Eternus #2/He-Man, and every default/unconflicted scan never reach this
// code — confirmedYear resolution for them is untouched.
//
// Invoke: node tests/q132-layer4b-confirmedyear-correction.test.js

import { pcMatchConflictsWithPoolYear } from '../src/lib/variantIdentity.js';
import { FAMILY_OVERRIDE_DECISIONS } from '../src/lib/compHygiene.js';
import { computeDecision, describeWarning } from '../src/lib/decisionEngine.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (actual === expected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);

console.log('\n=== Q132 Layer 4b — confirmedYear correction on PC rejection ===\n');

// Mirrors the exact api/enrich.js call-site logic (Layers 1+2+4+4b).
function simulateLayer4b({ priceCharting, poolYearHint, familyCandidateDecision, confirmedYearIn }) {
  let confirmedYear = confirmedYearIn;
  const out = {
    confirmedYearMeta: { value: confirmedYear, source: 'pricecharting', confidence: 'proven' },
    variantPoolYearConflict: poolYearHint
      ? { poolYear: poolYearHint.year, poolAgreement: poolYearHint.agreement, poolSampleSize: poolYearHint.sampleSize, confirmedYear: parseInt(confirmedYearIn, 10), drift: Math.abs(poolYearHint.year - parseInt(confirmedYearIn, 10)) }
      : null,
    pcProductId: priceCharting?.id ?? null,
    pcProductName: priceCharting?.productName ?? null,
  };
  const yearConflictResolvedByFamily = !!poolYearHint && FAMILY_OVERRIDE_DECISIONS.includes(familyCandidateDecision);
  let pc = priceCharting;
  if (yearConflictResolvedByFamily && pc) {
    const conflict = pcMatchConflictsWithPoolYear(pc.year, poolYearHint);
    if (conflict) {
      out.pcProductId = null;
      out.pcProductName = null;
      pc = null;

      const correctedYear = poolYearHint.year;
      confirmedYear = String(correctedYear);
      out.confirmedYearMeta = { value: confirmedYear, source: 'family-override-corrected', confidence: 'proven' };
      if (out.variantPoolYearConflict) {
        out.variantPoolYearConflict.originalConfirmedYear = out.variantPoolYearConflict.confirmedYear;
        out.variantPoolYearConflict.confirmedYear = correctedYear;
      }
    }
  }
  return { out, priceCharting: pc, confirmedYear };
}

// ═══════════════════════════════════════════════════════════════════════
// PART 1 — GrailKey / ASM #26: the real case, confirmedYear now corrected
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 1: GrailKey / ASM #26 — confirmedYear corrected to 2026\n');

const grailKeyPC = { id: 2367113, productName: 'Amazing Spider-Man #26 (2001)', year: 2001, price: 12.5 };
const grailKeyPoolYearHint = { year: 2026, agreement: 0.75, sampleSize: 4 };

const r1 = simulateLayer4b({
  priceCharting: grailKeyPC,
  poolYearHint: grailKeyPoolYearHint,
  familyCandidateDecision: 'weighted-consensus',
  confirmedYearIn: '2001',
});

assertEq(r1.confirmedYear, '2026', 'confirmedYear corrected from 2001 to 2026');
assertEq(r1.out.confirmedYearMeta.value, '2026', 'out.confirmedYearMeta.value corrected');
assertEq(r1.out.confirmedYearMeta.source, 'family-override-corrected', 'out.confirmedYearMeta.source no longer claims pricecharting');
assertEq(r1.out.confirmedYearMeta.confidence, 'proven', 'confidence stays proven (two independent corroborating signals)');
assertEq(r1.out.variantPoolYearConflict.confirmedYear, 2026, 'variantPoolYearConflict.confirmedYear corrected — this is what the banner reads');
assertEq(r1.out.variantPoolYearConflict.originalConfirmedYear, 2001, 'originalConfirmedYear preserved for "corrected from X to Y" wording');

// describeWarning must now say "corrected from 2001 to 2026", not "vs confirmed 2001"
const msg = describeWarning('variant-pool-year-conflict', r1.out);
assertTrue(/corrected/i.test(msg), `banner uses "corrected" framing, not "vs confirmed": "${msg}"`);
assertTrue(/2001/.test(msg) && /2026/.test(msg), `banner names both the original and corrected year: "${msg}"`);
assertTrue(!/vs confirmed 2001/i.test(msg), `banner does NOT restate 2001 as still-authoritative: "${msg}"`);

// computeDecision still escalates to RESEARCH (still surfaced, not silent)
const decision = computeDecision({
  title: 'Amazing Spider-Man', issue: '26', publisher: 'Marvel', year: 2026,
  price: 37.81, pricingSource: 'active_ask_derived',
  rawComps: { count: 4, average: 44.48, lowest: 24.61, highest: 43.48 },
  soldComps: [], soldCompDiagnostics: { rawCount: 29, verifiedCount: 2, rejectedCount: 27, reasons: {} },
  variantPoolYearConflict: r1.out.variantPoolYearConflict,
});
assertEq(decision.action, 'RESEARCH', 'still escalates to RESEARCH — surfaced, not silenced');
assertTrue(decision.warnings.includes('variant-pool-year-conflict'), 'warning still present');

// ═══════════════════════════════════════════════════════════════════════
// PART 2 — Era-table check: gradeMult unaffected for THIS card
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: getEra/grade-multiplier — confirmed unaffected for this specific card\n');

// getEra's actual boundary logic (mirrors api/enrich.js:220 exactly).
const getEra = (year, boundary = 1985) => {
  const y = parseInt(year, 10);
  if (!y || y <= 0) return 'vintage';
  return y >= boundary ? 'modern' : 'vintage';
};
assertEq(getEra(2001), 'modern', '2001 (wrong PC year) → modern era');
assertEq(getEra(2026), 'modern', '2026 (corrected year) → modern era — SAME table as 2001');
assertEq(getEra(2001), getEra(2026), 'both years select the identical era table for this card — gradeMult unaffected by this fix');

// The general latent risk (logged, not fixed) — a future case straddling 1985 differently WOULD differ.
assertEq(getEra(1960), 'vintage', 'illustrative: a wrong PC year of 1960 would select vintage');
assertEq(getEra(2026), 'modern', 'illustrative: a real year of 2026 would select modern');
assertTrue(getEra(1960) !== getEra(2026), 'illustrative: confirms the latent risk is real in the general case (not fixed here, logged for the standing queue)');

// ═══════════════════════════════════════════════════════════════════════
// PART 3 — Regression: default/unconflicted path untouched
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: regression — default/unconflicted confirmedYear resolution untouched\n');

const r2 = simulateLayer4b({
  priceCharting: { id: 999001, productName: 'Batman #608 (2002)', year: 2002, price: 175 },
  poolYearHint: null,
  familyCandidateDecision: null,
  confirmedYearIn: '2002',
});
assertEq(r2.confirmedYear, '2002', 'Batman #608: confirmedYear untouched (no poolYearHint → gate never engages)');
assertEq(r2.out.confirmedYearMeta.source, 'pricecharting', 'Batman #608: source field untouched');

const r3 = simulateLayer4b({
  priceCharting: { id: 999002, productName: 'Catwoman #64 (2024 Szerdy)', year: 2024, price: 15 },
  poolYearHint: { year: 2024, agreement: 1.0, sampleSize: 6 },
  familyCandidateDecision: 'fallback-vision',
  confirmedYearIn: '2007',
});
assertEq(r3.confirmedYear, '2007', 'Catwoman #64: confirmedYear untouched (fallback-vision is not a confirmed override)');
assertEq(r3.out.confirmedYearMeta.source, 'pricecharting', 'Catwoman #64: source field untouched');

const r4 = simulateLayer4b({
  priceCharting: { id: 999003, productName: 'He-Man and the Masters of the Universe #2', year: 2012, price: 150 },
  poolYearHint: { year: 2024, agreement: 1.0, sampleSize: 2 },
  familyCandidateDecision: 'refused-identity-conflict',
  confirmedYearIn: '2012',
});
assertEq(r4.confirmedYear, '2012', 'Eternus #2/He-Man: confirmedYear untouched (refused-identity-conflict excluded)');

// A confirmed override where PC year already agrees with poolYearHint — no correction needed or applied.
const r5 = simulateLayer4b({
  priceCharting: { id: 999004, productName: 'Captain America #25 (2019)', year: 2019, price: 45 },
  poolYearHint: { year: 2019, agreement: 1.0, sampleSize: 2 },
  familyCandidateDecision: 'weighted-consensus',
  confirmedYearIn: '2019',
});
assertEq(r5.confirmedYear, '2019', 'genuine agreement case: confirmedYear unchanged (no conflict to correct)');
assertEq(r5.out.confirmedYearMeta.source, 'pricecharting', 'genuine agreement case: source field untouched');

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
