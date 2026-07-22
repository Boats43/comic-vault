// tests/q141-rachta-lin-pricing-eligibility-gate.test.js
//
// LAUNCH-AUDIT.md Section 3 dispatch (2026-07-22) — Rachta Lin row-7 gap.
//
// Investigation finding: decisionEngine.js's identity-incomplete blocker
// already has a correct out.identityProvisional exemption (Q136 Slice A2,
// tests/q136-slice-a2-identity-incomplete-provisional.test.js — a promoted
// pool-provisional card with real Phase 2 comps underneath correctly reads
// decision.action='RESEARCH', not ID_REQUIRED). That part works and is
// covered.
//
// The gap is a DIFFERENT, upstream gate: api/enrich.js's tier-engine
// pricing-eligibility condition (~line 5895,
// `if ((idCheckFinal.confident || publisherOnlyMissing ||
// visionLowButCorroborated || out.identityProvisional) && !isPolybagPricing)`)
// decides whether the ENTIRE price-bands synthesis block (and its
// `[price-bands-pricing]` log line) runs at all. Before this fix, that
// OR-chain had no out.identityProvisional arm — a promoted provisional
// identity whose missing field is issue/year (Rachta Lin's genuine shape:
// the pool can't supply them) satisfies none of
// idCheckFinal.confident/publisherOnlyMissing/visionLowButCorroborated, so
// the whole tier-engine block was skipped even though Phase 2 (fetchComps/
// fetchPricechartingSales) had already run normally and produced real
// data. The card's DECISION correctly read RESEARCH (decisionEngine's own
// exemption), but out.price/out.pricingSource stayed null and
// [price-bands-pricing] never logged — a real, already-fetched comp pool
// with a blank price, the exact "10 real listings, blank card" shape Q110
// was built to close, recurring a third time for a third independently-
// missing OR-arm (Q133 Slice 1c's publisherOnlyMissing, Q137 Slice A3's
// visionLowButCorroborated, now Q133 Slice 2's out.identityProvisional).
//
// api/enrich.js's ~11,800-line handler is not directly unit-testable (no
// pure extracted function for this specific gate — matches how Slice A3's
// identically-shaped "price-bands-pricing gate follow-up" bug was ALSO
// only verified via a live rescan, per docs/LAUNCH-AUDIT.md Section 1,
// never a unit test). This file is a source-level regression guard: the
// bug shape here is specifically an OR-arm silently going missing during a
// future edit, not a computation this fix can express as pure-function
// input/output. Asserts the literal condition string is present and every
// documented arm appears in it, so a future refactor that drops one fails
// CI loudly instead of silently reopening this exact class of gap for a
// fourth time.
//
// Invoke: node tests/q141-rachta-lin-pricing-eligibility-gate.test.js

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const enrichSrc = readFileSync(join(__dirname, '../api/enrich.js'), 'utf8');

let passed = 0;
let failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}`; failures.push(msg); console.log(msg); }
};

console.log('\n=== Q141 — Rachta Lin pricing-eligibility gate (source-level regression guard) ===\n');

// The exact OR-chain gating the tier-engine pricing-synthesis block.
const GATE_RE = /if\s*\(\s*\(idCheckFinal\.confident\s*\|\|\s*publisherOnlyMissing\s*\|\|\s*visionLowButCorroborated\s*\|\|\s*out\.identityProvisional\s*\)\s*&&\s*!isPolybagPricing\s*\)\s*\{/;

assertTrue(GATE_RE.test(enrichSrc), 'tier-engine pricing-eligibility gate contains all four documented OR-arms, in order');
assertTrue(enrichSrc.includes('let visionLowButCorroborated = false;'), 'visionLowButCorroborated is still declared upstream (Slice A3 arm intact)');
assertTrue(enrichSrc.includes("const publisherOnlyMissing ="), 'publisherOnlyMissing is still declared upstream (Slice 1c arm intact)');
assertTrue(enrichSrc.includes('out.identityProvisional = true;'), 'out.identityProvisional is still set by the Q133 Slice 2 promotion branch feeding this gate');

// Every arm this gate ORs together must correspond to a real, narrowly-
// scoped flag — never widen this to something unconditional (e.g. `true`,
// or dropping the isPolybagPricing guard) without deliberately revisiting
// this test.
const NAIVE_OVERWIDE_RE = /if\s*\(\s*true\s*&&\s*!isPolybagPricing\s*\)/;
assertTrue(!NAIVE_OVERWIDE_RE.test(enrichSrc), 'gate has not been accidentally widened to unconditional');

console.log('\n' + '━'.repeat(59));
if (failed === 0) {
  console.log(`✓ All tests passed (${passed} assertions)`);
} else {
  console.log(`✗ ${failed} test(s) failed (${passed} passed)`);
  failures.forEach((f) => console.log(f));
  process.exitCode = 1;
}
console.log('━'.repeat(59));
