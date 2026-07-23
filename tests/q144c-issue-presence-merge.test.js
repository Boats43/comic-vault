// tests/q144c-issue-presence-merge.test.js
//
// Q144C dispatch (2026-07-22, Adventure Time #1→#5→#22→#5 class) —
// applyProvisionalIdentity's `issue` field used bare `enrich.issue ?? null`,
// which cannot distinguish "server explicitly resolved issue to null this
// round" from "server never attempted issue resolution this round at all"
// — both collapse to the same nullish check, and neither case fell back to
// the prior stored value. On a repeatedly-rescanned provisional card (title-
// family-refused-provisional, Q131/Q134/Q135), every fresh enrich response's
// own transient issue guess overwrote the card regardless of whether it was
// genuinely new information — producing the observed #1→#5→#22→#5 drift
// purely from call-to-call pool/Vision nondeterminism leaking through an
// unconditional merge.
//
// Fix: presence-checked via `Object.prototype.hasOwnProperty`, not `??`.
//   - key present, real value  → fresh value wins (corrects stale data)
//   - key present, null        → explicit clear wins (honest "don't know")
//   - key absent entirely      → falls back to the prior stored value
//
// Invoke: node tests/q144c-issue-presence-merge.test.js

import { applyProvisionalIdentity } from '../src/lib/dataQualityGuard.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (actual === expected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};

console.log('\n=== Q144C — issue presence-semantics client merge ===\n');

// ── Fixture 1: stale→fresh corrects ──────────────────────────────────────
{
  const enrich = { identityProvisional: true, title: 'Adventure Time Summer Special', issue: '1', year: null, publisher: null, variantNote: null };
  const prior = { title: 'Adventure Time', issue: '5' };
  const merged = applyProvisionalIdentity(enrich, prior);
  assertEq(merged.issue, '1', `fresh non-null issue from enrich overwrites stale prior value (got "${merged.issue}")`);
}

// ── Fixture 2: explicit null clears ──────────────────────────────────────
{
  const enrich = { identityProvisional: true, title: 'Adventure Time Summer Special', issue: null, year: null, publisher: null, variantNote: null };
  const prior = { title: 'Adventure Time', issue: '22' };
  const merged = applyProvisionalIdentity(enrich, prior);
  assertEq(merged.issue, null, `explicit issue:null from enrich clears the field rather than falling back to stale "22" (got ${JSON.stringify(merged.issue)})`);
}

// ── Fixture 3: omitted field preserves ───────────────────────────────────
{
  const enrich = { identityProvisional: true, title: 'Adventure Time Summer Special', year: null, publisher: null, variantNote: null };
  // `issue` key deliberately absent — server made no attempt to resolve it this round.
  const prior = { title: 'Adventure Time', issue: '5' };
  const merged = applyProvisionalIdentity(enrich, prior);
  assertEq(merged.issue, '5', `omitted issue key preserves the prior stored value instead of nulling it (got ${JSON.stringify(merged.issue)})`);
  assertEq(Object.prototype.hasOwnProperty.call(enrich, 'issue'), false, 'fixture sanity check: enrich genuinely has no "issue" key');
}

// ── Fixture 4: Poison Ivy #1 control — non-provisional, ID_REQUIRED-class
//      card stays a true no-op regardless of issue presence/absence ───────
{
  const enrichNoIssue = { identityProvisional: false, title: 'Poison Ivy' };
  const enrichNullIssue = { identityProvisional: false, title: 'Poison Ivy', issue: null };
  const prior = { title: 'Poison Ivy', issue: null, decision: { action: 'ID_REQUIRED' } };
  assertEq(Object.keys(applyProvisionalIdentity(enrichNoIssue, prior)).length, 0,
    'Poison Ivy #1 control: non-provisional response with no issue key is a true no-op');
  assertEq(Object.keys(applyProvisionalIdentity(enrichNullIssue, prior)).length, 0,
    'Poison Ivy #1 control: non-provisional response with explicit issue:null is still a true no-op (identityProvisional gate wins first)');
}

// ── Fixture 5: drift reconstruction — repeated calls with omitted issue
//      no longer perturb an already-good value ──────────────────────────
{
  let cur = { title: 'Adventure Time', issue: '1' };
  // Round 2: server resolves a fresh, different value — corrects.
  cur = { ...cur, ...applyProvisionalIdentity({ identityProvisional: true, issue: '5', year: null, publisher: null, variantNote: null }, cur) };
  assertEq(cur.issue, '5', 'round 2: fresh value corrects #1 → #5');
  // Round 3: server omits issue entirely this round (e.g. thin/ambiguous pool) — preserves #5.
  cur = { ...cur, ...applyProvisionalIdentity({ identityProvisional: true, year: null, publisher: null, variantNote: null }, cur) };
  assertEq(cur.issue, '5', 'round 3: omitted issue key preserves #5 rather than drifting to #22 or null');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
