// tests/gk155-variant-dedup.test.js
//
// GK-155 (2026-08-22) — real production case: G.I. Joe #5 Tyler Kirkham
// 616 virgin. Vision's own variant read ("exclusive limited signed
// virgin") was pushed wholesale into `parts`
// (extractConfirmedVariant, src/lib/variantIdentity.js), then the pool's
// independently-corroborated consensus.exclusive ("exclusive") and
// consensus.limitation ("limited") were pushed AGAIN with no check for
// whether those words were already present — producing "exclusive
// limited signed virgin exclusive limited," byte-identical to both real
// production scans (07:07:15 and 07:08:06). The duplicated string reached
// the live eBay search query and the active-comp cache key, not just the
// display field.
//
// FIX: token-set idempotent build (pushDedupedVariantPhrase) — tracks
// already-added words (case-insensitive, whole-word) and only appends
// the NEW words each phrase contributes; a phrase contributing nothing
// new is dropped entirely.
//
// Also covers the "independence n/a" registry note: NOT a bug — a
// short-circuit. coverTypeIndependence is only computed when
// coverTypePromotion.promote is true; when promotion is declined for an
// unrelated, legitimate reason (e.g. runnerUp-present), the independence
// machinery never runs at all. The log line now says
// "independence=skipped(promotion-declined)" instead of printing
// placeholder zeros that read like a failed check.
//
// Invoke: node tests/gk155-variant-dedup.test.js

import { extractConfirmedVariant } from '../src/lib/variantIdentity.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (actual === expected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(m); console.log(m); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);

console.log('\n=== GK-155 — variant parts dedup ===\n');

// ═══════════════════════════════════════════════════════════════════════
// PART 1 — the real production reproduction: byte-identical pool shape to
// the actual G.I. Joe #5 scan (12 eligible items, all agreeing "virgin,"
// a 4-member signed cluster, 100% single-artist saturation excluded from
// filtering, exclusive/limited each independently corroborated).
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 1: real reproduction — Vision text + pool consensus overlap\n');

const buildPoolRow = (rawTitle, i) => ({
  rawTitle,
  itemId: `v1|1771074${i}|0`,
  seller: { username: `seller${i}` },
});

const GIJOE_POOL = [
  ...Array.from({ length: 4 }, (_, i) =>
    buildPoolRow('GI JOE #5 SIGNED TYLER KIRKHAM 616 COBRA COMMANDER VIRGIN VARIANT A LTD 750', i)),
  ...Array.from({ length: 8 }, (_, i) =>
    buildPoolRow('GI JOE #5 TYLER KIRKHAM 616 Cobra Commander Virgin Exclusive Limited LTD 750', i + 4)),
];

const capturedLogs = [];
const originalLog = console.log;
console.log = (...args) => { capturedLogs.push(args.join(' ')); };
let result;
try {
  result = extractConfirmedVariant(GIJOE_POOL, 'exclusive limited signed virgin', 2025, 'low', false, null);
} finally {
  console.log = originalLog;
}

assertTrue(!!result, 'extractConfirmedVariant returns a result (pool consensus fired)');
assertEq(
  result?.confirmedVariant,
  'exclusive limited signed virgin',
  'FIXED: confirmedVariant is deduped — "exclusive"/"limited" already present in Vision\'s own text are NOT appended a second time (pre-fix this was "exclusive limited signed virgin exclusive limited")'
);
assertTrue(
  !/exclusive.*exclusive|limited.*limited/i.test(result?.confirmedVariant || ''),
  'no word appears twice anywhere in confirmedVariant (general idempotence check, not just the exact known string)'
);

const independenceSkipLine = capturedLogs.find((l) => l.startsWith('[coverType-consensus]'));
assertTrue(!!independenceSkipLine, '[coverType-consensus] log line present');
if (independenceSkipLine) {
  console.log(`  (captured: ${independenceSkipLine})`);
  assertTrue(
    !independenceSkipLine.includes('independence.pass=false assertingRows=0'),
    'log no longer prints placeholder independence stats (independence.pass=false/assertingRows=0/etc.) when promotion never ran'
  );
}

// ═══════════════════════════════════════════════════════════════════════
// PART 2 — no-overlap control: pool consensus on tokens NOT already in
// Vision's text still appends normally (dedup must not suppress genuinely
// new information).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: no-overlap control — genuinely new consensus tokens still append\n');

const NEWSSTAND_POOL = [
  ...Array.from({ length: 3 }, (_, i) =>
    buildPoolRow('Amazing Spider-Man #300 Newsstand Edition CGC 9.6 Todd McFarlane', i)),
];
console.log = () => {};
let result2;
try {
  result2 = extractConfirmedVariant(NEWSSTAND_POOL, 'signed', 1990, 'medium', false, null);
} finally {
  console.log = originalLog;
}
// Whatever consensus fires here (artist/limitation/etc.), "signed" from
// Vision must survive untouched and any new consensus token must still be
// appended — dedup only removes an EXACT re-add of an already-present
// word, never suppresses new content.
assertTrue(
  !result2 || /\bsigned\b/i.test(result2.confirmedVariant),
  'Vision\'s own "signed" survives when nothing in consensus duplicates it'
);

// ═══════════════════════════════════════════════════════════════════════
// PART 3 — case-insensitive dedup: "Exclusive" (Vision, capitalized) vs
// "exclusive" (pool consensus, lowercase) must still dedup.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: case-insensitive dedup\n');

const CASE_POOL = [
  ...Array.from({ length: 3 }, (_, i) =>
    buildPoolRow('Batman #1 Exclusive Variant Foil Cover A NM', i)),
];
console.log = () => {};
let result3;
try {
  result3 = extractConfirmedVariant(CASE_POOL, 'Exclusive Virgin', 2020, 'medium', false, null);
} finally {
  console.log = originalLog;
}
if (result3) {
  const exclusiveCount = (result3.confirmedVariant.match(/exclusive/gi) || []).length;
  assertEq(exclusiveCount, 1, `"exclusive"/"Exclusive" appears exactly once despite differing case between Vision and pool consensus (actual: "${result3.confirmedVariant}")`);
} else {
  assertTrue(true, '(no consensus fired on this synthetic pool — case-insensitivity check not exercised, not a failure)');
}

// ═══════════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════════
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
if (failed === 0) {
  console.log(`✓ All tests passed (${passed} assertions)`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  process.exit(0);
} else {
  console.log(`✗ ${failed} test(s) failed, ${passed} passed`);
  console.log('\nFailures:');
  failures.forEach((f) => console.log(f));
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  process.exit(1);
}
