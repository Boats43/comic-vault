// tests/q144-item1-canonical-issue-extraction.test.js
//
// Q144 Item 1 dispatch (2026-07-22, Adventure Time Summer Special class) —
// extractConfirmedVariant was returning null for this book's confirmed-
// identity scan (Gate 1, variantIdentity.js:540-542 — empty visualItems
// array), NOT because Vision's confidence was high or because no family-
// scoping mechanism existed (Ship 26.3B + Q115 already scope to the
// winning family + confirmed issue). The real cause: extractIssueFromTitle's
// Q12c MARKETING_KEYWORDS_RE guard (imageSearchIdentity.js) nulled the
// "#1" extraction on every real "Adventure Time Summer Special #1 SDCC
// Convention Exclusive..." listing, because "Special" sits directly before
// the issue number and "Exclusive"/"Variant" sit shortly after -- not
// marketing hype, the book's own genuine title/product-line words.
// filterItemsByIssue then dropped every one of them (item.issue null),
// leaving variantSourceItems empty before extractConfirmedVariant's
// consensus computation ever ran.
//
// FINAL SCOPE (tightened from an earlier canonical-title-text design,
// narrowed per direct instruction): the fallback is pure CORROBORATION of
// an already-established confirmedIssue (Q140's family-scoped issue
// adoption), not a new inference mechanism. MARKETING_KEYWORDS_RE itself
// is completely untouched -- extractIssueFromTitle is byte-identical to
// its pre-dispatch form. filterItemsByIssue instead accepts an optional
// `familyOverrideAccepted` boolean (default false, every existing call
// site byte-identical) and recovers a row ONLY when ALL of: an accepted
// family override is active, confirmedIssue is present, and the row's OWN
// raw title literally contains "#<confirmedIssue>" as text -- word-bounded
// so "#1" cannot match "#1B"/"#1C" (lettered suffixes) or "#10"/"#1000"
// (longer numbers sharing the same leading digits).
//
// Invoke: node tests/q144-item1-canonical-issue-extraction.test.js

import { extractIssueFromTitle } from '../src/lib/imageSearchIdentity.js';
import { filterItemsByIssue } from '../src/lib/variantIdentity.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (actual === expected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};

console.log('\n=== Q144 Item 1 — corroboration-only issue-extraction recovery ===\n');

// ═══════════════════════════════════════════════════════════════════════
// Part 1 — extractIssueFromTitle / MARKETING_KEYWORDS_RE completely
//      untouched — same signature, same behavior, no new parameter
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 1: extractIssueFromTitle stays globally intact — no signature change\n');

assertEq(extractIssueFromTitle('Amazing Spider-Man #300'), '300', 'control: ordinary extraction unaffected');
assertEq(extractIssueFromTitle('Amazing Spider-Man Anniversary Issue #1 Reprint'), null,
  'MARKETING_KEYWORDS_RE still fires exactly as before — no exemption mechanism added to this function');
assertEq(extractIssueFromTitle('Adventure Time Summer Special #1 SDCC Convention Exclusive Variant 2013 NEW'), null,
  'this function alone still nulls the real Summer Special case — the fix lives entirely in filterItemsByIssue now');

// ═══════════════════════════════════════════════════════════════════════
// Part 2 — filterItemsByIssue: the real Adventure Time recovery
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: filterItemsByIssue — real Adventure Time recovery (familyOverrideAccepted=true)\n');

const REAL_POOL = [
  { rawTitle: 'Adventure Time Summer Special #1 SDCC Convention Exclusive Variant 2013 NEW', issue: null },
  { rawTitle: 'Adventure Time Summer Special #1 SDCC Convention Exclusive 2013 NM', issue: null },
  { rawTitle: 'Adventure Time Summer Special #1 SDCC 2013 CGC 7.0', issue: null },
  { rawTitle: 'Adventure Time Summer Special #1 SDCC 2013 In Hand Ships Fast', issue: null },
];

assertEq(filterItemsByIssue(REAL_POOL, '1').length, 0,
  'default (familyOverrideAccepted omitted): byte-identical to pre-fix — all 4 excluded');
assertEq(filterItemsByIssue(REAL_POOL, '1', false).length, 0,
  'explicit familyOverrideAccepted=false: still excluded — corroboration requires the flag');
assertEq(filterItemsByIssue(REAL_POOL, '1', true).length, 4,
  'familyOverrideAccepted=true: all 4 real listings recovered via literal "#1" corroboration');

// ═══════════════════════════════════════════════════════════════════════
// Part 3 — required non-capture regressions (explicit, per instruction)
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: required non-capture regressions\n');

{
  // Year 2013 must never be captured as the issue number.
  const pool = [{ rawTitle: 'Adventure Time Summer Special SDCC Convention Exclusive 2013 NM', issue: null }];
  assertEq(filterItemsByIssue(pool, '2013', true).length, 0,
    'bare year "2013" is never captured as issue — no literal "#2013" in the title');
}

{
  // Ratio 1:25 must never be captured as issue "1".
  const pool = [{ rawTitle: 'Batman Beyond 1:25 Ratio Incentive Variant NM', issue: null }];
  assertEq(filterItemsByIssue(pool, '1', true).length, 0,
    'ratio "1:25" is never captured as issue "1" — no literal "#1" text, just "1:25"');
}

{
  // Limitation count 1/1000 must never be captured as issue "1".
  const pool = [{ rawTitle: 'Eternus Metal Variant Numbered 1/1000 LTD', issue: null }];
  assertEq(filterItemsByIssue(pool, '1', true).length, 0,
    'limitation count "1/1000" is never captured as issue "1" — no literal "#1" text');
}

{
  // Lettered suffixes #1B / #1C must never be accidentally captured as "#1".
  const pool = [
    { rawTitle: 'Adventure Time Summer Special #1B SDCC 2013 CBCS 9.8', issue: null },
    { rawTitle: 'Adventure Time Summer Special #1C SDCC Convention Exclusive 2013', issue: null },
    { rawTitle: 'Adventure Time Summer Special #1SDCC Con Exclusive 2013', issue: null },
  ];
  assertEq(filterItemsByIssue(pool, '1', true).length, 0,
    'lettered/suffixed forms ("#1B", "#1C", "#1SDCC") are NOT captured as bare "#1" — word-boundary lookahead holds');
  // Control: a genuinely bare "#1" elsewhere in the same title still recovers.
  const controlPool = [{ rawTitle: 'Adventure Time Summer Special #1 SDCC 2013 (also labeled 1B on slab)', issue: null }];
  assertEq(filterItemsByIssue(controlPool, '1', true).length, 1,
    'control: a genuine standalone "#1" in the title still recovers even when "1B" also appears elsewhere as plain text');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 4 — genuinely different-issue items still cannot recover
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 4: genuinely different issues still excluded (Q115 Batman #608 control)\n');

{
  const batman608Pool = [
    { rawTitle: 'Superman/Batman #657 Special Anniversary Exclusive Dell\'Otto', issue: '657' },
    { rawTitle: 'Batman #608 Hush Part 1 Jim Lee 2002', issue: '608' },
  ];
  const filtered = filterItemsByIssue(batman608Pool, '608', true);
  assertEq(filtered.length, 1, 'Batman #608 control: familyOverrideAccepted=true does not rescue a genuinely different issue');
  assertEq(filtered[0].rawTitle.includes('#608'), true, 'survivor is genuinely issue #608');
}

{
  // No rawTitle on an item with null issue — can't attempt recovery, stays excluded.
  const pool = [{ issue: null }];
  assertEq(filterItemsByIssue(pool, '1', true).length, 0, 'item with no rawTitle at all cannot be recovered, stays excluded');
}

{
  // Non-array input — unchanged passthrough behavior.
  assertEq(filterItemsByIssue(null, '1', true), null, 'non-array input returns input unchanged (existing behavior)');
}

{
  // confirmedIssue itself null/undefined — recovery never fires regardless of flag.
  const pool = [{ rawTitle: 'Adventure Time Summer Special #1 SDCC 2013', issue: null }];
  assertEq(filterItemsByIssue(pool, null, true).length, 0, 'confirmedIssue null: recovery never fires (nothing to corroborate)');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
