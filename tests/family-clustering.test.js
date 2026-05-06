// Ship 26.1 — Title-family clustering helper tests
//
// Pure unit tests for rank-weighted visual title-family consensus helpers.
// Uses captured/constructed title arrays (no live API calls).
//
// Invoke: node tests/family-clustering.test.js
// Exit code: 0 on all-pass, 1 on any failure.

import {
  tokenizeTitleFamily,
  buildTitleFamilies,
  scoreTitleFamilies,
  selectTitleFamilyCandidate,
} from '../src/lib/imageSearchIdentity.js';

let passed = 0;
let failed = 0;
const failures = [];

const assertEq = (actual, expected, label) => {
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`;
    failures.push(msg);
    console.log(msg);
  }
};

const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertIncludes = (str, substr, label) => {
  if (String(str).toLowerCase().includes(String(substr).toLowerCase())) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}\n    "${str}" should include "${substr}"`;
    failures.push(msg);
    console.log(msg);
  }
};

const assertNotIncludes = (str, substr, label) => {
  if (!String(str).toLowerCase().includes(String(substr).toLowerCase())) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}\n    "${str}" should NOT include "${substr}"`;
    failures.push(msg);
    console.log(msg);
  }
};

console.log('\n=== SHIP 26.1 — TITLE-FAMILY CLUSTERING ===\n');

// ═══════════════════════════════════════════════════════════════════════
// FIXTURE A — Catwoman/Gotham War (top-rank protection)
// ═══════════════════════════════════════════════════════════════════════
console.log('Fixture A: Catwoman/Gotham War (captured production pattern)');

const catwomanItems = [
  // Correct result at index 0 (top eBay match)
  'Batman Catwoman: Gotham War Scorched Earth #1 (2023) Cover C Lim Virgin Variant DC Comics',
  // Wrong family cluster (more inventory)
  'Catwoman Uncovered #1 (2023) Artgerm Foil Virgin Variant NM DC Comics',
  'Catwoman Uncovered #1 (2023) Artgerm Virgin Cover NM+ DC',
  'Catwoman Uncovered #1 Kendrick Lim Virgin Variant 2023 DC Comics NM',
  // More Gotham War scattered at lower ranks
  'Batman Catwoman Gotham War Scorched Earth #1 Cover A 2023 DC NM',
  'Batman Catwoman: Gotham War Scorched Earth #1 (2023) Cover B Virgin DC',
  'Catwoman Uncovered #1 Artgerm Exclusive Foil NM 2023 DC Comics',
  'Batman Catwoman Gotham War Scorched Earth #1 2023 DC Comics NM/NM+',
  'Catwoman Uncovered #1 (2023) Virgin Variant Artgerm DC Comics NM',
  'Batman Catwoman Gotham War Scorched Earth #1 Virgin Cover C 2023',
  'Catwoman Uncovered #1 2023 Artgerm Foil Exclusive Variant DC NM',
  'Catwoman Uncovered #1 Kendrick Lim Virgin DC Comics 2023 NM+',
  'Catwoman Uncovered #1 (2023) Artgerm Variant Foil DC Comics',
  'Batman Catwoman Gotham War Scorched Earth #1 Cover D 2023 DC',
  'Catwoman Uncovered #1 Virgin Artgerm 2023 DC Comics Exclusive NM',
  'Catwoman Uncovered #1 Foil Variant 2023 Artgerm DC NM',
  'Catwoman Uncovered #1 (2023) Virgin Exclusive Kendrick Lim DC Comics',
  'Catwoman Uncovered #1 Artgerm 2023 DC Comics Foil Variant NM+',
  'Catwoman Uncovered #1 Virgin Cover 2023 DC Artgerm NM',
  'Catwoman Uncovered #1 (2023) DC Comics Artgerm Foil Exclusive NM',
];

const catwomanResult = selectTitleFamilyCandidate(
  catwomanItems,
  'Batman Catwoman Gotham War Scorched Earth',
  '1'
);

assertEq(catwomanResult.decision, 'top-rank-protection', 'decision = top-rank-protection');
assertIncludes(catwomanResult.selectedTitle, 'batman', 'selectedTitle includes "batman"');
assertIncludes(catwomanResult.selectedTitle, 'catwoman', 'selectedTitle includes "catwoman"');
assertIncludes(catwomanResult.selectedTitle, 'gotham', 'selectedTitle includes "gotham"');
assertIncludes(catwomanResult.selectedTitle, 'war', 'selectedTitle includes "war"');
assertIncludes(catwomanResult.selectedTitle, 'scorched', 'selectedTitle includes "scorched"');
assertIncludes(catwomanResult.selectedTitle, 'earth', 'selectedTitle includes "earth"');
assertNotIncludes(catwomanResult.selectedTitle, 'uncovered', 'selectedTitle does NOT include "uncovered"');
assertTrue(catwomanResult.topFamily !== null, 'topFamily populated');
assertTrue(catwomanResult.topFamily.weightSum >= 5, 'topFamily weight ≥5');

// ═══════════════════════════════════════════════════════════════════════
// FIXTURE B — Fall of the House of X (refused unrelated)
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture B: Fall of the House of X (unrelated pool)');

const fallItems = [
  'Hunt for Wolverine #1 (2018) Marvel Comics NM',
  'Hunt for Wolverine #1 Variant Cover 2018 Marvel NM+',
  'Marvel #1000 (2019) Alex Ross Cover NM Marvel Comics',
  'Hunt for Wolverine #1 2018 Marvel Comics Adamantium Agenda NM',
  'X-Men Red #1 (2022) Marvel Comics NM',
  'Marvel #1000 (2019) Exclusive Variant Marvel NM+',
  'Hunt for Wolverine #1 Marvel 2018 Claws of Killer NM',
  'X-Men Red #1 2022 Variant Cover Marvel Comics NM',
  'Marvel #1000 Alex Ross 2019 Marvel Comics Exclusive NM',
  'Hunt for Wolverine #1 (2018) Marvel Weapon Lost NM+',
  'X-Men Red #1 Marvel Comics 2022 NM',
  'Marvel #1000 (2019) Marvel Comics Variant NM',
  'Hunt for Wolverine #1 2018 Marvel Dead Ends NM',
  'X-Men Red #1 (2022) Exclusive Variant Marvel NM+',
  'Marvel #1000 2019 Alex Ross Marvel Comics NM',
];

const fallResult = selectTitleFamilyCandidate(
  fallItems,
  'Fall of the House of X',
  '1'
);

// Should refuse OR fallback (not top-rank-protection)
assertTrue(
  fallResult.decision === 'refused-identity-conflict' || fallResult.decision === 'fallback-vision',
  `decision = refused or fallback (got: ${fallResult.decision})`
);
assertNotIncludes(fallResult.selectedTitle || '', 'hunt', 'must NOT select "hunt for wolverine"');
assertNotIncludes(fallResult.selectedTitle || '', 'wolverine', 'must NOT select wolverine title');
assertNotIncludes(fallResult.selectedTitle || '', 'marvel 1000', 'must NOT select "marvel 1000"');
assertTrue(fallResult.selectedTitle === null, 'selectedTitle = null (refused/fallback)');

// ═══════════════════════════════════════════════════════════════════════
// FIXTURE C — Sinful Suzi (refused unrelated pin-up pool)
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture C: Sinful Suzi (unrelated pin-up pool)');

const sinfulItems = [
  'Harley Quinn #1 (2021) DC Comics NM',
  'Siria Underworld #1 Virgin Variant 2023 Bad Kitty Studios NM',
  'White Widow #1 (2019) Absolute Comics NM+',
  'Harley Quinn #1 Variant Cover 2021 DC Comics NM',
  'Siria Underworld #1 Kendrick Lim Virgin 2023 NM',
  'White Widow #1 Virgin Exclusive 2019 Absolute NM',
  'Harley Quinn #1 2021 DC Comics Exclusive Variant NM+',
  'Siria Underworld #1 (2023) Bad Kitty Virgin Cover NM',
  'White Widow #1 2019 Absolute Comics NM',
  'Harley Quinn #1 (2021) Virgin Variant DC NM+',
];

const sinfulResult = selectTitleFamilyCandidate(
  sinfulItems,
  'Sinful Suzi Queen of Hearts',
  '1'
);

// Should refuse OR fallback (not select wrong family)
assertTrue(
  sinfulResult.decision === 'refused-identity-conflict' || sinfulResult.decision === 'fallback-vision',
  `decision = refused or fallback (got: ${sinfulResult.decision})`
);
assertNotIncludes(sinfulResult.selectedTitle || '', 'siria', 'must NOT select "siria underworld"');
assertNotIncludes(sinfulResult.selectedTitle || '', 'harley', 'must NOT select "harley quinn"');
assertNotIncludes(sinfulResult.selectedTitle || '', 'widow', 'must NOT select "white widow"');
assertTrue(sinfulResult.selectedTitle === null, 'selectedTitle = null');

// ═══════════════════════════════════════════════════════════════════════
// FIXTURE D — Marvel Tales #111 (publisher-title preservation)
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture D: Marvel Tales #111 (publisher-title preservation)');

const marvelTalesTokens = tokenizeTitleFamily('Marvel Tales #111 (1952) Marvel Comics VG');
assertIncludes(marvelTalesTokens.join(' '), 'marvel', 'tokens preserve "marvel"');
assertIncludes(marvelTalesTokens.join(' '), 'tales', 'tokens preserve "tales"');
assertTrue(marvelTalesTokens.length >= 2, 'at least 2 tokens');

// Verify title does NOT collapse to just "tales"
const collapsedBad = marvelTalesTokens.length === 1 && marvelTalesTokens[0] === 'tales';
assertEq(collapsedBad, false, 'title must NOT collapse to just "tales"');

// ═══════════════════════════════════════════════════════════════════════
// FIXTURE E — DC Pride (publisher-title preservation)
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture E: DC Pride (publisher-title preservation)');

const dcPrideTokens = tokenizeTitleFamily('DC Pride #1 (2021) DC Comics NM');
assertIncludes(dcPrideTokens.join(' '), 'dc', 'tokens preserve "dc"');
assertIncludes(dcPrideTokens.join(' '), 'pride', 'tokens preserve "pride"');
assertTrue(dcPrideTokens.length >= 2, 'at least 2 tokens');

// Verify title does NOT collapse to just "pride"
const dcCollapsedBad = dcPrideTokens.length === 1 && dcPrideTokens[0] === 'pride';
assertEq(dcCollapsedBad, false, 'title must NOT collapse to just "pride"');

// ═══════════════════════════════════════════════════════════════════════
// FIXTURE F — Wrong-family-first edge case
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture F: Wrong-family-first edge case (items[0] wrong)');

const wrongFirstItems = [
  // WRONG family at index 0
  'Catwoman Uncovered #1 (2023) Artgerm Foil Virgin Variant DC Comics NM',
  'Catwoman Uncovered #1 Artgerm Virgin 2023 DC Comics NM+',
  'Catwoman Uncovered #1 (2023) Foil Exclusive DC NM',
  'Catwoman Uncovered #1 Kendrick Lim Virgin 2023 DC Comics',
  'Catwoman Uncovered #1 Artgerm 2023 DC Foil Variant NM',
  // CORRECT family at indices 5-9
  'Batman Catwoman: Gotham War Scorched Earth #1 (2023) Cover A DC Comics NM',
  'Batman Catwoman Gotham War Scorched Earth #1 Cover B 2023 DC NM+',
  'Batman Catwoman: Gotham War Scorched Earth #1 (2023) Virgin Cover C DC',
  'Batman Catwoman Gotham War Scorched Earth #1 2023 DC Comics NM',
  'Batman Catwoman: Gotham War Scorched Earth #1 Cover D 2023 DC NM+',
  // Mixed/unrelated
  'Batman #1 (2016) DC Rebirth NM',
  'Catwoman #1 (2018) DC Comics Joelle Jones NM',
  'Nightwing #1 (2016) DC Rebirth NM+',
  'Detective Comics #1000 (2019) DC Comics NM',
  'Justice League #1 (2018) DC Comics NM',
];

const wrongFirstResult = selectTitleFamilyCandidate(
  wrongFirstItems,
  'Batman Catwoman Gotham War Scorched Earth',
  '1'
);

// Should NOT be top-rank-protection (items[0] is wrong family)
assertTrue(
  wrongFirstResult.decision !== 'top-rank-protection',
  `decision must NOT be top-rank-protection (got: ${wrongFirstResult.decision})`
);

// Should NOT select Catwoman Uncovered
if (wrongFirstResult.selectedTitle) {
  assertNotIncludes(wrongFirstResult.selectedTitle, 'uncovered', 'must NOT select "catwoman uncovered"');
}

// Should either:
// (a) select Gotham War by weighted-consensus, OR
// (b) refuse-identity-conflict
const validOutcome =
  wrongFirstResult.decision === 'weighted-consensus' ||
  wrongFirstResult.decision === 'refused-identity-conflict' ||
  wrongFirstResult.decision === 'fallback-vision';

assertTrue(validOutcome, `decision should be weighted-consensus, refused, or fallback (got: ${wrongFirstResult.decision})`);

// If weighted-consensus fired, verify it selected Gotham War
if (wrongFirstResult.decision === 'weighted-consensus') {
  assertIncludes(wrongFirstResult.selectedTitle, 'batman', 'weighted-consensus selected correct family (batman)');
  assertIncludes(wrongFirstResult.selectedTitle, 'gotham', 'weighted-consensus selected correct family (gotham)');
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
  failures.forEach(f => console.log(f));
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  process.exit(1);
}
