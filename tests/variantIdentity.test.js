// Ship #20a.6.18 — Variant identity engine tests.
//
// Test coverage:
//   1. Crow Dead Time C2E2 Mico Suayan class (modern exclusive variant)
//   2. Silver Age book (year gate closes)
//   3. High confidence modern book (confidence gate closes)
//   4. No variant detected by Vision (variant gate closes)
//   5. Fanexpo Alan Quah exclusive (thin exclusive variant)
//   6. No eBay consensus (all different tokens)
//   7. Integration: consensus with exclusive markers
//
// All gates must pass for variant check to run:
//   - visualItems exists and is non-empty
//   - visionVariant exists
//   - bookYear >= 2000
//   - visionConfidence is NOT 'high'
//
// Invoke: node tests/variantIdentity.test.js
// Exit code: 0 on all-pass, 1 on any failure.

import { extractConfirmedVariant } from '../src/lib/variantIdentity.js';

let passed = 0;
let failed = 0;
const failures = [];

const assertEq = (actual, expected, label) => {
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push(`${label}\n    Expected: ${expected}\n    Got: ${actual}`);
    console.log(`  ✗ ${label}`);
  }
};

const assertTruthy = (actual, label) => {
  if (actual) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push(`${label}\n    Expected truthy, got: ${actual}`);
    console.log(`  ✗ ${label}`);
  }
};

const assertNull = (actual, label) => {
  if (actual === null) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push(`${label}\n    Expected null, got: ${actual}`);
    console.log(`  ✗ ${label}`);
  }
};

const assertContains = (str, substr, label) => {
  if (String(str || '').includes(substr)) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push(`${label}\n    Expected "${str}" to contain "${substr}"`);
    console.log(`  ✗ ${label}`);
  }
};

console.log('Testing variant identity engine...\n');

// Test 1: Crow Dead Time C2E2 Mico Suayan class
console.log('Test 1: Crow Dead Time C2E2 Mico Suayan — consensus fires');
{
  const visualItems = [
    {
      rawTitle: 'Crow Dead Time 1 C2E2 exclusive Virgin Secret drop limited to 200 signed by Mico Suayan',
      title: 'Crow Dead Time',
      issue: '1',
      year: '2025',
      variantTokens: ['c2e2', 'exclusive', 'limited', 'signed', 'virgin'],
    },
    {
      rawTitle: 'CROW DEAD TIME #1 MICO SUAYAN C2E2 EXCLUSIVE VARIANT LTD 150',
      title: 'Crow Dead Time',
      issue: '1',
      year: null,
      variantTokens: ['c2e2', 'exclusive', 'limited', 'virgin'],
    },
  ];

  const result = extractConfirmedVariant(visualItems, 'virgin variant', 2024, 'medium');
  assertTruthy(result, 'result is truthy');
  assertContains(result?.confirmedVariant, 'c2e2', 'confirmed variant contains c2e2');
  assertContains(result?.confirmedVariant, 'exclusive', 'confirmed variant contains exclusive');
  assertContains(result?.confirmedVariant?.toLowerCase(), 'mico suayan', 'confirmed variant contains mico suayan');
  assertEq(result?.consensus?.convention, 'c2e2', 'consensus convention is c2e2');
  assertTruthy(result?.consensus?.exclusive, 'consensus exclusive is truthy');
  assertEq(result?.source, 'ebay_image_consensus', 'source is ebay_image_consensus');
  assertEq(result?.overriddenVision, 'virgin variant', 'overriddenVision matches input');
}

// Test 2: Silver Age book (year gate closes)
console.log('\nTest 2: Silver Age book (year < 2000) — gate closes');
{
  const visualItems = [
    {
      rawTitle: 'Amazing Spider-Man #50 CGC 9.4 1st Kingpin',
      title: 'Amazing Spider Man',
      issue: '50',
      year: '1967',
      variantTokens: [],
    },
  ];

  const result = extractConfirmedVariant(visualItems, 'newsstand', 1967, 'medium');
  assertNull(result, 'result is null (year gate closes)');
}

// Test 3: High confidence modern book
console.log('\nTest 3: High confidence modern book — confidence gate closes');
{
  const visualItems = [
    {
      rawTitle: 'Absolute Batman #1 SDCC exclusive Mico Suayan virgin',
      title: 'Absolute Batman',
      issue: '1',
      year: '2024',
      variantTokens: ['sdcc', 'exclusive', 'virgin'],
    },
  ];

  const result = extractConfirmedVariant(visualItems, 'SDCC exclusive', 2024, 'high');
  assertNull(result, 'result is null (confidence gate closes)');
}

// Test 4: No variant detected by Vision, and no eBay consensus either
// Q109 Class A note: prior to the backfill path, a null visionVariant hit a
// hard Gate 2 early-return regardless of what visualItems contained. Now it
// routes into the backfill path and still returns null here — but because
// this fixture's pool has no consensus signal (single generic non-variant
// title), not because of a gate closure. See Test 12 for the case where a
// null visionVariant DOES have real eBay consensus to backfill from.
console.log('\nTest 4: No variant detected by Vision, no eBay consensus — stays null');
{
  const visualItems = [
    {
      rawTitle: 'Batman #1 2024 DC Comics',
      title: 'Batman',
      issue: '1',
      year: '2024',
      variantTokens: [],
    },
  ];

  const result = extractConfirmedVariant(visualItems, null, 2024, 'medium');
  assertNull(result, 'result is null (no consensus to backfill)');
}

// Test 5: Fanexpo Alan Quah exclusive
console.log('\nTest 5: Fanexpo Alan Quah exclusive — thin exclusive variant');
{
  const visualItems = [
    {
      rawTitle: 'Absolute Batman #1 Alan Quah Fanexpo exclusive virgin limited 250',
      title: 'Absolute Batman',
      issue: '1',
      year: '2024',
      variantTokens: ['fanexpo', 'exclusive', 'limited', 'virgin'],
    },
    {
      rawTitle: 'Absolute Batman #1 Fanexpo Alan Quah exclusive virgin',
      title: 'Absolute Batman',
      issue: '1',
      year: '2024',
      variantTokens: ['fanexpo', 'exclusive', 'virgin'],
    },
  ];

  const result = extractConfirmedVariant(visualItems, 'virgin variant', 2024, 'medium');
  assertTruthy(result, 'result is truthy');
  assertContains(result?.confirmedVariant, 'fanexpo', 'confirmed variant contains fanexpo');
  assertContains(result?.confirmedVariant, 'exclusive', 'confirmed variant contains exclusive');
  assertContains(result?.confirmedVariant?.toLowerCase(), 'alan quah', 'confirmed variant contains alan quah');
}

// Test 6: No eBay consensus
console.log('\nTest 6: No eBay consensus — all different tokens');
{
  const visualItems = [
    {
      rawTitle: 'Batman #1 2024 DC Comics',
      title: 'Batman',
      issue: '1',
      year: '2024',
      variantTokens: [],
    },
    {
      rawTitle: 'Superman #1 2024 virgin variant',
      title: 'Superman',
      issue: '1',
      year: '2024',
      variantTokens: ['virgin'],
    },
  ];

  const result = extractConfirmedVariant(visualItems, 'variant cover', 2024, 'medium');
  assertNull(result, 'result is null (no consensus)');
}

// Test 7: Integration with exclusive markers
console.log('\nTest 7: Integration: consensus with ≥2 matching exclusive markers');
{
  const visualItems = [
    {
      rawTitle: 'Spawn #1 store exclusive Puppeteer Lee virgin',
      title: 'Spawn',
      issue: '1',
      year: '2024',
      variantTokens: ['exclusive', 'virgin'],
    },
    {
      rawTitle: 'Spawn #1 Puppeteer Lee shop exclusive virgin',
      title: 'Spawn',
      issue: '1',
      year: '2024',
      variantTokens: ['exclusive', 'virgin'],
    },
  ];

  const result = extractConfirmedVariant(visualItems, 'virgin', 2024, 'low');
  assertTruthy(result, 'result is truthy');
  assertContains(result?.confirmedVariant, 'exclusive', 'confirmed variant contains exclusive');
  assertContains(result?.confirmedVariant?.toLowerCase(), 'puppeteer lee', 'confirmed variant contains puppeteer lee');
}

// Test 8: Empty visualItems array
console.log('\nTest 8: Edge case: empty visualItems array — gate closes');
{
  const result = extractConfirmedVariant([], 'variant', 2024, 'medium');
  assertNull(result, 'result is null (empty array)');
}

// Test 9: Single listing (< threshold)
console.log('\nTest 9: Edge case: single listing (< threshold) — no consensus');
{
  const visualItems = [
    {
      rawTitle: 'Absolute Batman #1 C2E2 exclusive Mico Suayan virgin',
      title: 'Absolute Batman',
      issue: '1',
      year: '2024',
      variantTokens: ['c2e2', 'exclusive', 'virgin'],
    },
  ];

  const result = extractConfirmedVariant(visualItems, 'virgin', 2024, 'medium');
  assertNull(result, 'result is null (single listing, no consensus)');
}

// Test 10: Limitation tokens captured
console.log('\nTest 10: Limitation tokens captured (LTD, limited to)');
{
  const visualItems = [
    {
      rawTitle: 'Spawn #1 C2E2 exclusive Puppeteer Lee LTD 150',
      title: 'Spawn',
      issue: '1',
      year: '2024',
      variantTokens: ['c2e2', 'exclusive', 'limited'],
    },
    {
      rawTitle: 'Spawn #1 C2E2 exclusive Puppeteer Lee limited to 150',
      title: 'Spawn',
      issue: '1',
      year: '2024',
      variantTokens: ['c2e2', 'exclusive', 'limited'],
    },
  ];

  const result = extractConfirmedVariant(visualItems, 'exclusive', 2024, 'medium');
  assertTruthy(result, 'result is truthy');
  assertEq(result?.consensus?.limitation, 'limited', 'consensus limitation is "limited"');
  assertContains(result?.confirmedVariant, 'limited', 'confirmed variant contains limited');
}

// Test 11: Multiple conventions — picks most frequent
console.log('\nTest 11: Multiple conventions — picks most frequent');
{
  const visualItems = [
    {
      rawTitle: 'Batman #1 C2E2 exclusive',
      title: 'Batman',
      issue: '1',
      year: '2024',
      variantTokens: ['c2e2', 'exclusive'],
    },
    {
      rawTitle: 'Batman #1 C2E2 exclusive virgin',
      title: 'Batman',
      issue: '1',
      year: '2024',
      variantTokens: ['c2e2', 'exclusive', 'virgin'],
    },
    {
      rawTitle: 'Batman #1 SDCC exclusive',
      title: 'Batman',
      issue: '1',
      year: '2024',
      variantTokens: ['sdcc', 'exclusive'],
    },
  ];

  const result = extractConfirmedVariant(visualItems, 'exclusive', 2024, 'medium');
  assertTruthy(result, 'result is truthy');
  assertEq(result?.consensus?.convention, 'c2e2', 'consensus convention is c2e2 (appears 2×)');
}

// Test 12 (Q109 Class A) — Captain America #25 class: Vision's cover-only
// read found no explicit variant text (visionVariant=null), but the eBay
// visual pool independently and repeatedly names "Skottie Young" — this is
// the exact production casualty (EX-A/EX-I follow-up investigation) the
// backfill path was greenlit to fix.
console.log('\nTest 12: Captain America #25 class — backfill fires from null Vision variant');
{
  const visualItems = [
    {
      rawTitle: 'Captain America #25 Skottie Young Variant CGC 9.8',
      title: 'Captain America',
      issue: '25',
      year: '2019',
      variantTokens: [],
    },
    {
      rawTitle: 'CAPTAIN AMERICA #25 SKOTTIE YOUNG VARIANT COVER',
      title: 'Captain America',
      issue: '25',
      year: '2019',
      variantTokens: [],
    },
  ];

  const result = extractConfirmedVariant(visualItems, null, 2019, 'high');
  assertTruthy(result, 'result is truthy (backfill fires despite null Vision variant)');
  assertContains(result?.confirmedVariant?.toLowerCase(), 'skottie young', 'confirmed variant contains skottie young');
  assertEq(result?.source, 'ebay_image_consensus_backfill', 'source is ebay_image_consensus_backfill');
  assertNull(result?.overriddenVision, 'overriddenVision is null — nothing to override, this is a backfill');
}

// Test 13 (Q109 Class A) — backfill path is NOT blocked by high confidence.
// Unlike the override path (Test 3), there is no Vision variant call to
// distrust on the backfill path, so Gate 4 (confidence != high) must not
// apply. Test 12 already uses confidence='high' and passes — this test
// isolates that specifically against the override-path behavior in Test 3
// to make the asymmetry explicit and regression-proof.
console.log('\nTest 13: Backfill path ignores confidence gate (override path Test 3 does not)');
{
  const visualItems = [
    {
      rawTitle: 'Absolute Batman #1 SDCC exclusive Mico Suayan virgin',
      title: 'Absolute Batman',
      issue: '1',
      year: '2024',
      variantTokens: ['sdcc', 'exclusive', 'virgin'],
    },
    {
      rawTitle: 'Absolute Batman #1 SDCC exclusive Mico Suayan virgin cover',
      title: 'Absolute Batman',
      issue: '1',
      year: '2024',
      variantTokens: ['sdcc', 'exclusive', 'virgin'],
    },
  ];

  // Same fixture shape as Test 3, but visionVariant=null (backfill) instead
  // of 'SDCC exclusive' (override) — Test 3 returns null at HIGH confidence;
  // this must NOT.
  const result = extractConfirmedVariant(visualItems, null, 2024, 'high');
  assertTruthy(result, 'result is truthy — backfill runs even at HIGH confidence');
  assertEq(result?.source, 'ebay_image_consensus_backfill', 'source is ebay_image_consensus_backfill');
}

// Test 14 (Q109 Class A) — backfill path still requires real consensus
// (≥2 agree, same mechanism as override). A single matching listing must
// not backfill off one data point.
console.log('\nTest 14: Backfill path still requires ≥2 consensus — single listing stays null');
{
  const visualItems = [
    {
      rawTitle: 'Edge of Spider-Verse #1 Skottie Young Baby Variant CGC 9.8',
      title: 'Edge of Spider-Verse',
      issue: '1',
      year: '2023',
      variantTokens: [],
    },
  ];

  const result = extractConfirmedVariant(visualItems, null, 2023, 'medium');
  assertNull(result, 'result is null (single listing, no consensus, nothing to backfill)');
}

// Summary
console.log(`\n${'='.repeat(60)}`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`  ${f}`));
}
console.log('='.repeat(60));

process.exit(failed > 0 ? 1 : 0);
