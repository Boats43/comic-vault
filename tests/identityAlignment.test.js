// Ship #20a.6.7c — Identity Alignment Tests

import { alignIdentity, extractIssueFromEbayResults } from '../src/lib/identityAlignment.js';

const tests = [];
let passed = 0;
let failed = 0;

function test(desc, fn) {
  tests.push({ desc, fn });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function run() {
  console.log('='.repeat(60));
  console.log('Ship #20a.6.7c — Identity Alignment Tests');
  console.log('='.repeat(60));

  tests.forEach(({ desc, fn }) => {
    try {
      fn();
      console.log(`  ✓ ${desc}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${desc}`);
      console.error(`    ${err.message}`);
      failed++;
    }
  });

  console.log('');
  console.log(`=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

// ─────────────────────────────────────────────────────────────────
// Test 1: eBay agrees with Vision → HIGH confidence, no override
// ─────────────────────────────────────────────────────────────────

test('eBay agrees with Vision → HIGH confidence, no override', () => {
  const result = alignIdentity({
    visionTitle: 'Batman #1',
    visionIssue: '1',
    visionYear: 2024,
    visionConfidence: 'medium',
    ebayImageResults: [
      { title: 'Batman' },
      { title: 'Batman' },
      { title: 'Batman' },
    ],
    pcProductName: 'Batman (2024)',
    cvVolumeName: 'Batman',
  });

  assert(result.confirmedTitle === 'Batman #1', 'should keep Vision title');
  assert(result.confirmedSource === 'vision+text', 'should be vision+text source');
  assert(result.overrodeVision === false, 'should not override');
  assert(result.confidence === 'HIGH', 'should be HIGH confidence');
});

// ─────────────────────────────────────────────────────────────────
// Test 2: eBay disagrees → eBay wins, Vision overridden
// ─────────────────────────────────────────────────────────────────

test('eBay disagrees → eBay wins, Vision overridden', () => {
  const result = alignIdentity({
    visionTitle: 'Sinful Suzi #1',
    visionIssue: '1',
    visionYear: 2024,
    visionConfidence: 'medium',
    ebayImageResults: [
      { title: 'Shadow & Vice' },
      { title: 'Shadow & Vice' },
      { title: 'Shadow & Vice' },
    ],
    pcProductName: null,
    cvVolumeName: null,
  });

  assert(result.confirmedTitle === 'Shadow & Vice', 'should use eBay consensus');
  assert(result.confirmedSource === 'ebay_image', 'should be ebay_image source');
  assert(result.overrodeVision === true, 'should override Vision');
  assert(result.visionWas === 'Sinful Suzi #1', 'should record Vision title');
  assert(result.confidence === 'HIGH', 'should be HIGH confidence');
});

// ─────────────────────────────────────────────────────────────────
// Test 3: PC agrees with Vision → confirmed
// ─────────────────────────────────────────────────────────────────

test('PC agrees with Vision → confirmed', () => {
  const result = alignIdentity({
    visionTitle: 'Amazing Spider-Man #300',
    visionIssue: '300',
    visionYear: 1988,
    visionConfidence: 'high',
    ebayImageResults: [],
    pcProductName: 'Amazing Spider-Man #300 (1988)',
    cvVolumeName: null,
  });

  assert(result.confirmedTitle === 'Amazing Spider-Man #300', 'should keep Vision');
  assert(result.confirmedSource === 'vision+text', 'should be vision+text');
  assert(result.overrodeVision === false, 'should not override');
  assert(result.confidence === 'HIGH', 'should be HIGH');
});

// ─────────────────────────────────────────────────────────────────
// Test 4: Nothing agrees → LOW confidence, flagged
// ─────────────────────────────────────────────────────────────────

test('Nothing agrees → LOW confidence, flagged', () => {
  const result = alignIdentity({
    visionTitle: 'Unknown Title #1',
    visionIssue: '1',
    visionYear: 2024,
    visionConfidence: 'low',
    ebayImageResults: [],
    pcProductName: null,
    cvVolumeName: null,
  });

  assert(result.confirmedTitle === 'Unknown Title #1', 'should keep Vision title');
  assert(result.confirmedSource === 'vision_only', 'should be vision_only');
  assert(result.overrodeVision === false, 'should not override');
  assert(result.confidence === 'LOW', 'should be LOW confidence');
  assert(result.needsReview === true, 'should be flagged for review');
});

// ─────────────────────────────────────────────────────────────────
// Test 5: No eBay results → falls back to Vision
// ─────────────────────────────────────────────────────────────────

test('No eBay results → falls back to Vision', () => {
  const result = alignIdentity({
    visionTitle: 'X-Men #1',
    visionIssue: '1',
    visionYear: 2024,
    visionConfidence: 'high',
    ebayImageResults: null,
    pcProductName: 'X-Men (2024)',
    cvVolumeName: 'X-Men',
  });

  assert(result.confirmedTitle === 'X-Men #1', 'should keep Vision');
  assert(result.confirmedSource === 'vision+text', 'should be vision+text');
  assert(result.confidence === 'HIGH', 'should be HIGH');
});

// ─────────────────────────────────────────────────────────────────
// Test 6: Sinful Suzi case — eBay overrides with Harley Quinn variant
// ─────────────────────────────────────────────────────────────────

test('Sinful Suzi case — eBay overrides with Harley Quinn variant', () => {
  const result = alignIdentity({
    visionTitle: 'Sinful Suzi #1',
    visionIssue: '1',
    visionYear: 2024,
    visionConfidence: 'medium',
    ebayImageResults: [
      { title: 'Shadow & Vice #1 Harley Quinn' },
      { title: 'Shadow & Vice #1 Harley Quinn' },
      { title: 'Shadow & Vice #1 Harley Quinn' },
    ],
    pcProductName: null,
    cvVolumeName: null,
  });

  assert(result.confirmedTitle === 'Shadow & Vice #1 Harley Quinn', 'should use eBay consensus');
  assert(result.confirmedSource === 'ebay_image', 'should be ebay_image');
  assert(result.overrodeVision === true, 'should override');
  assert(result.visionWas === 'Sinful Suzi #1', 'should record original');
});

// ─────────────────────────────────────────────────────────────────
// Test 7: High confidence Vision → kept even if PC disagrees
// ─────────────────────────────────────────────────────────────────

test('High confidence Vision → kept even if PC disagrees', () => {
  const result = alignIdentity({
    visionTitle: 'Batman #100',
    visionIssue: '100',
    visionYear: 2020,
    visionConfidence: 'high',
    ebayImageResults: [],
    pcProductName: 'Detective Comics #100',
    cvVolumeName: 'Batman',
  });

  // PC has "Detective" but CV has "Batman" - CV matches Vision
  assert(result.confirmedTitle === 'Batman #100', 'should keep Vision');
  assert(result.confirmedSource === 'vision+text', 'should be vision+text (CV agrees)');
  assert(result.confidence === 'HIGH', 'should be HIGH');
});

// ─────────────────────────────────────────────────────────────────
// Test 8: Empty inputs → graceful, no crash
// ─────────────────────────────────────────────────────────────────

test('Empty inputs → graceful, no crash', () => {
  const result = alignIdentity({
    visionTitle: null,
    visionIssue: null,
    visionYear: null,
    visionConfidence: null,
    ebayImageResults: [],
    pcProductName: null,
    cvVolumeName: null,
  });

  assert(result !== null, 'should not crash');
  assert(result.confirmedTitle === null, 'should return null title');
  assert(result.confidence === 'LOW', 'should be LOW confidence');
});

// ─────────────────────────────────────────────────────────────────
// Test 9: eBay single match → no consensus, keeps Vision
// ─────────────────────────────────────────────────────────────────

test('eBay single match → no consensus, keeps Vision', () => {
  const result = alignIdentity({
    visionTitle: 'Batman #1',
    visionIssue: '1',
    visionYear: 2024,
    visionConfidence: 'medium',
    ebayImageResults: [
      { title: 'Superman' },
    ],
    pcProductName: 'Batman (2024)',
    cvVolumeName: null,
  });

  // No eBay consensus (needs ≥2), PC agrees with Vision
  assert(result.confirmedTitle === 'Batman #1', 'should keep Vision');
  assert(result.confirmedSource === 'vision+text', 'should be vision+text');
  assert(result.overrodeVision === false, 'should not override');
});

// ─────────────────────────────────────────────────────────────────
// Test 10: Medium confidence Vision + no text sources → MEDIUM
// ─────────────────────────────────────────────────────────────────

test('Medium confidence Vision + no text sources → MEDIUM', () => {
  const result = alignIdentity({
    visionTitle: 'Unknown Comic #1',
    visionIssue: '1',
    visionYear: 2024,
    visionConfidence: 'medium',
    ebayImageResults: [],
    pcProductName: null,
    cvVolumeName: null,
  });

  assert(result.confirmedTitle === 'Unknown Comic #1', 'should keep Vision');
  assert(result.confirmedSource === 'vision_only', 'should be vision_only');
  assert(result.confidence === 'MEDIUM', 'should be MEDIUM (not LOW)');
  assert(result.needsReview === true, 'should need review');
});

// ─────────────────────────────────────────────────────────────────
// extractIssueFromEbayResults tests
// ─────────────────────────────────────────────────────────────────

test('extractIssueFromEbayResults: consensus issue → extracted', () => {
  const items = [
    { title: 'Batman #42' },
    { title: 'Batman #42' },
    { title: 'Batman #43' },
  ];
  const issue = extractIssueFromEbayResults(items);
  assert(issue === '42', 'should extract consensus issue #42');
});

test('extractIssueFromEbayResults: no consensus → null', () => {
  const items = [
    { title: 'Batman #1' },
    { title: 'Batman #2' },
    { title: 'Batman #3' },
  ];
  const issue = extractIssueFromEbayResults(items);
  assert(issue === null, 'should return null when no consensus');
});

test('extractIssueFromEbayResults: empty array → null', () => {
  const issue = extractIssueFromEbayResults([]);
  assert(issue === null, 'should return null for empty array');
});

test('extractIssueFromEbayResults: no issues in titles → null', () => {
  const items = [
    { title: 'Batman' },
    { title: 'Batman' },
  ];
  const issue = extractIssueFromEbayResults(items);
  assert(issue === null, 'should return null when no issues found');
});

run();
