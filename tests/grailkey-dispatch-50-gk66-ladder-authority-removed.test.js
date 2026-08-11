// tests/grailkey-dispatch-50-gk66-ladder-authority-removed.test.js
//
// GK-66 (Dispatch 50) — item.priceLadder removed as authority for an
// automatic HOLD_FOR_CGC action / price=null override in
// src/lib/decisionEngine.js. The ladder (api/pricecharting-pop.js:384-404)
// is an unedited PriceCharting regex scrape, proven non-monotonic on 2 of
// 3 frozen specimens (Dispatch 48), and persists to IndexedDB, so it could
// silently override a real, floor-protected price on any scan — including
// reopened books. Demotion is UNCONDITIONAL, not inversion-gated: even a
// clean, monotonic ladder no longer authorizes HOLD_FOR_CGC. No server-side
// ladder-quality heuristic, no mirrored inversion check, no replacement
// action or evidence field — per the dispatch's explicit constraints.
//
// Invoke: node tests/grailkey-dispatch-50-gk66-ladder-authority-removed.test.js

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { computeDecision } from '../src/lib/decisionEngine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const decisionSrc = readFileSync(path.join(repoRoot, 'src/lib/decisionEngine.js'), 'utf8');

let passed = 0;
let failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}`; failures.push(msg); console.log(msg); }
};
const assertEq = (actual, expected, label) => {
  if (actual === expected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};

console.log('\n=== GK-66 (Dispatch 50) — priceLadder authority removed ===\n');

// ═══════════════════════════════════════════════════════════════════════
// Part 0 — source-shape: the authority is gone, nothing dangling
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 0: source shape\n');
{
  assertTrue(!decisionSrc.includes("action = 'HOLD_FOR_CGC'"), 'HOLD_FOR_CGC is never assigned anywhere in decisionEngine.js');
  assertTrue(!decisionSrc.includes('CGC_ALL_IN_COST'), 'CGC_ALL_IN_COST removed');
  assertTrue(!decisionSrc.includes('CGC_UPSIDE_THRESHOLD'), 'CGC_UPSIDE_THRESHOLD removed');
  assertTrue(!decisionSrc.includes('hasAutoKey'), 'hasAutoKey removed (was only used inside the removed block)');
  assertTrue(!decisionSrc.includes('GRADE_TO_NUMERIC'), 'GRADE_TO_NUMERIC import removed (was only used inside the removed block)');
  assertTrue(!decisionSrc.includes('evidence.gradingUpside ='), 'gradingUpside evidence field is never assigned (was never read by any UI surface — not preserved, per the dispatch; the name still appears in this file\'s own removal-reasoning comment, which is expected)');
  // item.priceLadder itself must remain fully untouched elsewhere (api/enrich.js, App.jsx display) — this test only proves decisionEngine.js's authority is gone.
  assertTrue(decisionSrc.includes('GK-66'), 'the removal reasoning is recorded at the deletion site');
}

// ═══════════════════════════════════════════════════════════════════════
// Fixtures
// ═══════════════════════════════════════════════════════════════════════
const baseItem = (overrides) => ({
  title: 'Test Comic', issue: '1', publisher: 'Marvel', year: 1982,
  identityConfident: true, isGraded: false, grade: 'NM- 9.2',
  price: 137, priceLow: 100, priceHigh: 180,
  soldComps: [{ price: 130, daysAgo: 10 }, { price: 140, daysAgo: 25 }, { price: 150, daysAgo: 45 }],
  soldCompsAvg: 62,
  pricingSource: 'verified_sold',
  ...overrides,
});

// ═══════════════════════════════════════════════════════════════════════
// Part 1 — inverted rung: no HOLD_FOR_CGC, price not nulled
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 1: inverted rung\n');
{
  // Under the OLD code, nearestGrade would resolve to '9.4' (closest to
  // NM- 9.2's mapped numeric), cgcValue=375 vs rawMarketPrice=62 -> huge
  // upside -> HOLD_FOR_CGC, price=null. Ladder here also carries a real
  // inversion (9.0 < 8.0) elsewhere, matching the Witching Hour/Batman #213
  // shape, though the triggering rung itself doesn't need to be the
  // inverted one for the OLD authority to have fired.
  const item = baseItem({
    priceLadder: { '9.8': 500, '9.4': 375, '9.0': 66.50, '8.0': 89.95, '6.0': 155.95, '7.0': 63.08 },
  });
  const decision = computeDecision(item);
  assertTrue(decision.action !== 'HOLD_FOR_CGC', 'inverted-ladder book: action is not HOLD_FOR_CGC');
  assertTrue(decision.price !== null, 'inverted-ladder book: price is not nulled');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 2 — clean monotonic ladder with real upside: STILL no HOLD_FOR_CGC
//           (unconditional demotion, not inversion-gated)
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: clean monotonic ladder, genuine upside — demotion is unconditional\n');
{
  const item = baseItem({
    priceLadder: { '2.0': 20, '4.0': 40, '6.0': 65, '8.0': 90, '9.0': 130, '9.2': 180, '9.4': 250, '9.6': 350, '9.8': 500 },
  });
  const decision = computeDecision(item);
  assertTrue(decision.action !== 'HOLD_FOR_CGC', 'clean monotonic ladder with real upside: still no HOLD_FOR_CGC — the demotion does not distinguish clean from noisy data');
  assertTrue(decision.price !== null, 'clean monotonic ladder: price is not nulled');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 3 — missing rung: unchanged
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: missing rung\n');
{
  const noLadder = computeDecision(baseItem({ priceLadder: undefined }));
  assertTrue(noLadder.action !== 'HOLD_FOR_CGC', 'no priceLadder at all: unaffected, no HOLD_FOR_CGC (was already unreachable without it)');

  const emptyLadder = computeDecision(baseItem({ priceLadder: {} }));
  assertTrue(emptyLadder.action !== 'HOLD_FOR_CGC', 'empty priceLadder: unaffected');

  // Same fixture run twice (with vs. without a populated ladder) must
  // produce the identical action now that the ladder carries zero
  // authority either way.
  const withLadder = computeDecision(baseItem({ priceLadder: { '9.4': 375 } }));
  const withoutLadder = computeDecision(baseItem({ priceLadder: undefined }));
  assertEq(withLadder.action, withoutLadder.action, 'decision.action identical whether or not priceLadder is present (ladder no longer influences routing at all)');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 4 — frozen corpus: the three real specimens (Dispatch 48)
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 4: frozen corpus — the three Dispatch 48 specimens\n');
{
  const CORPUS = [
    {
      name: 'Witching Hour #66 (8.0 $89.95 > 9.0 $66.50 — proven inverted)',
      priceLadder: { '9.0': 66.50, '8.0': 89.95, '6.0': 40, '4.0': 25 },
    },
    {
      name: 'Batman #213 (6.0 $155.95 > 7.0 $63.08 — proven inverted)',
      priceLadder: { '7.0': 63.08, '6.0': 155.95, '4.0': 30, '2.0': 12 },
    },
    {
      name: 'Harley Quinn #62 (monotonic, sane)',
      priceLadder: { '9.8': 45, '9.4': 30, '9.0': 22, '6.0': 12, '4.0': 8 },
    },
  ];
  for (const spec of CORPUS) {
    const item = baseItem({ grade: 'FN/VF 7.0', priceLadder: spec.priceLadder });
    const decision = computeDecision(item);
    const nearestRung = Object.entries(spec.priceLadder).sort((a, b) => Math.abs(parseFloat(a[0]) - 7.0) - Math.abs(parseFloat(b[0]) - 7.0))[0];
    console.log(`  ${spec.name}`);
    console.log(`    nearest rung to grade 7.0: ${nearestRung[0]} = $${nearestRung[1]}`);
    console.log(`    decision.action = ${decision.action}, decision.price = ${decision.price}`);
    assertTrue(decision.action !== 'HOLD_FOR_CGC', `${spec.name}: no HOLD_FOR_CGC`);
    assertTrue(decision.price !== null, `${spec.name}: price not nulled`);
  }
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
  process.exitCode = 1;
}
