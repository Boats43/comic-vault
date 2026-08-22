// GK-152 — Absolute Wonder Woman #16 Talavera virgin, 2026-08-22.
// rescueIssueFromCompsPoolConsensus (src/lib/identityCore.js) unit
// coverage. Real production shape: 5 unanimous "#16 Talavera" active
// comps, confirmedIssue null (vision-zero-support ESCALATE fired on a
// misidentified "Dark Nights: Death Metal" #1 read, family-level issue
// consensus only 43% on a genuinely mixed #16/#17/#18/#20 raw pool).
import { rescueIssueFromCompsPoolConsensus } from '../src/lib/identityCore.js';

let pass = 0, fail = 0;
function assertTrue(cond, msg) {
  if (cond) { pass++; console.log(`  PASS: ${msg}`); }
  else { fail++; console.log(`  FAIL: ${msg}`); }
}
function assertEq(actual, expected, msg) {
  assertTrue(JSON.stringify(actual) === JSON.stringify(expected), `${msg} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
}

console.log('\n=== GK-152: comps-pool issue rescue ===\n');

// Section 1 — the real AWW shape: 5 unanimous #16 comps.
console.log('Section 1: real AWW shape, 5/5 unanimous "#16 Talavera" comps');
{
  const rawComps = {
    prices: [
      { title: 'ABSOLUTE WONDER WOMAN #16 Talavera VIRGIN Variant Ltd 1000 DC 2026', price: 15.0 },
      { title: 'ABSOLUTE WONDER WOMAN #16 Ivan Talavera VIRGIN Variant Ltd 1000 DC 2026 Zatana', price: 14.5 },
      { title: 'Absolute Wonder Woman #16 Virgin Cover Art By Ivan Talavera Limited To 1000 NM', price: 16.99 },
      { title: 'ABSOLUTE WONDER WOMAN #16 IVAN TALAVERA VIRGIN FOIL VARIANT LTD 1000 ABS ZANTANA', price: 12.5 },
      { title: 'ABSOLUTE WONDER WOMAN #16 IVAN TALAVERA 616 FOIL Variant C', price: 16.75 },
    ],
  };
  const result = rescueIssueFromCompsPoolConsensus(null, rawComps, {});
  assertTrue(result !== null, 'rescue fires on a real 5/5 unanimous pool');
  assertEq(result?.issue, '16', 'rescued issue value is "16"');
  assertEq(result?.reconciledIssue?.authority, 'CONTESTED', 'authority is CONTESTED, never CORROBORATED, from this path');
  assertEq(result?.reconciledIssue?.source, 'comps-pool-consensus', 'source is comps-pool-consensus');
  assertEq(result?.reconciledIssue?.justifiedBy?.length, 5, 'justifiedBy carries all 5 corroborating rows');
}

// Section 2 — genuine no-issue control: empty pool. AS C3 unchanged.
console.log('\nSection 2: genuine no-issue control — empty pool');
{
  const result = rescueIssueFromCompsPoolConsensus(null, { prices: [] }, {});
  assertTrue(result === null, 'empty comps pool: no rescue, ID_REQUIRED path unchanged');
}

// Section 3 — genuine no-issue control: junk/non-unanimous pool.
console.log('\nSection 3: genuine no-issue control — junk/non-unanimous pool (mirrors the real raw 20-item pool: #16/#17/#18/#20 mixed)');
{
  const rawComps = {
    prices: [
      { title: 'ABSOLUTE WONDER WOMAN #16 Talavera VIRGIN Variant Ltd 1000 DC 2026' },
      { title: 'Absolute Wonder Woman #17 Kyuyong Eom C2E2 Zatanna Virgin Variant NM+' },
      { title: 'Absolute Wonder Woman #18 KyuYong Eom Virgin Variant (DC 2026) NM' },
      { title: 'Absolute Wonder Woman 20 Exclusive Taurin Clarke Virgin Foil LTD. 1000' },
      { title: 'ABSOLUTE WONDER WOMAN #16 Ivan Talavera VIRGIN Variant Ltd 1000 DC 2026 Zatana' },
    ],
  };
  const result = rescueIssueFromCompsPoolConsensus(null, rawComps, {});
  assertTrue(result === null, 'non-unanimous pool (2/5 agree, not 5/5): no rescue');
}

// Section 4 — row-count floor: 2 unanimous comps is not enough (below MINIMUM_CORROBORATING_ROWS=3).
console.log('\nSection 4: row-count floor — 2 unanimous comps, below the 3-row floor');
{
  const rawComps = {
    prices: [
      { title: 'ABSOLUTE WONDER WOMAN #16 Talavera VIRGIN Variant Ltd 1000 DC 2026' },
      { title: 'ABSOLUTE WONDER WOMAN #16 Ivan Talavera VIRGIN Variant Ltd 1000 DC 2026 Zatana' },
    ],
  };
  const result = rescueIssueFromCompsPoolConsensus(null, rawComps, {});
  assertTrue(result === null, '2 comps < MINIMUM_CORROBORATING_ROWS floor: no rescue');
}

// Section 5 — no-op when confirmedIssue is already set (nothing to rescue).
console.log('\nSection 5: confirmedIssue already non-null — no-op');
{
  const rawComps = {
    prices: [
      { title: 'ABSOLUTE WONDER WOMAN #16 Talavera VIRGIN Variant Ltd 1000 DC 2026' },
      { title: 'ABSOLUTE WONDER WOMAN #16 Ivan Talavera VIRGIN Variant Ltd 1000 DC 2026 Zatana' },
      { title: 'ABSOLUTE WONDER WOMAN #16 IVAN TALAVERA 616 FOIL Variant C' },
    ],
  };
  const result = rescueIssueFromCompsPoolConsensus('16', rawComps, {});
  assertTrue(result === null, 'confirmedIssue already "16": function is a no-op, does not re-derive');
}

// Section 6 — graded carve-out, mirrors vision-zero-support's own guard.
console.log('\nSection 6: graded book — carve-out, no rescue even with a unanimous pool');
{
  const rawComps = {
    prices: [
      { title: 'ABSOLUTE WONDER WOMAN #16 Talavera VIRGIN Variant Ltd 1000 DC 2026' },
      { title: 'ABSOLUTE WONDER WOMAN #16 Ivan Talavera VIRGIN Variant Ltd 1000 DC 2026 Zatana' },
      { title: 'ABSOLUTE WONDER WOMAN #16 IVAN TALAVERA 616 FOIL Variant C' },
    ],
  };
  const result = rescueIssueFromCompsPoolConsensus(null, rawComps, { isGraded: true });
  assertTrue(result === null, 'isGraded=true: no rescue, mirrors vision-zero-support carve-out');
}

// Section 7 — a comp with no extractable issue number at all breaks unanimity (no partial credit).
console.log('\nSection 7: one survivor with no extractable issue number — no partial-unanimity credit');
{
  const rawComps = {
    prices: [
      { title: 'ABSOLUTE WONDER WOMAN #16 Talavera VIRGIN Variant Ltd 1000 DC 2026' },
      { title: 'ABSOLUTE WONDER WOMAN #16 Ivan Talavera VIRGIN Variant Ltd 1000 DC 2026 Zatana' },
      { title: 'Absolute Wonder Woman Talavera Virgin — no issue number in this title at all' },
    ],
  };
  const result = rescueIssueFromCompsPoolConsensus(null, rawComps, {});
  assertTrue(result === null, 'one un-numbered survivor: no rescue, even though the other two agree');
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
