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

test('eBay agrees with Vision → VERIFIED confidence, no override', () => {
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
  assert(result.confidence === 'VERIFIED', 'should be VERIFIED confidence');
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
  assert(result.confidence === 'UNCERTAIN', 'should be UNCERTAIN confidence');
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
  assert(result.confirmedSource === 'pricecharting', 'should be pricecharting');
  assert(result.overrodeVision === false, 'should not override');
  assert(result.confidence === 'UNCERTAIN', 'should be UNCERTAIN');
});

// ─────────────────────────────────────────────────────────────────
// Test 4: Nothing agrees → LOW confidence, flagged
// ─────────────────────────────────────────────────────────────────

test('Nothing agrees → UNVERIFIED confidence, flagged', () => {
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
  assert(result.confidence === 'UNVERIFIED', 'should be UNVERIFIED confidence');
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
  assert(result.confidence === 'VERIFIED', 'should be VERIFIED');
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
  assert(result.confidence === 'UNCERTAIN', 'should be UNCERTAIN');
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
  assert(result.confidence === 'UNCERTAIN', 'should be UNCERTAIN');
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
  assert(result.confidence === 'UNVERIFIED', 'should be UNVERIFIED confidence');
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
  assert(result.confirmedSource === 'pricecharting', 'should be pricecharting');
  assert(result.overrodeVision === false, 'should not override');
});

// ─────────────────────────────────────────────────────────────────
// Test 10: Medium confidence Vision + no text sources → MEDIUM
// ─────────────────────────────────────────────────────────────────

test('Medium confidence Vision + no text sources → UNCERTAIN', () => {
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
  assert(result.confidence === 'UNCERTAIN', 'should be UNCERTAIN (not UNVERIFIED)');
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

// ─────────────────────────────────────────────────────────────────
// RULE 0: eBay visual hard override tests
// ─────────────────────────────────────────────────────────────────

test('RULE 0: 20 eBay results, 0% overlap with Vision → eBay wins unconditionally', () => {
  // Real-world case: Vision identified "Grimm Fairy Tales Van Helsing vs. Dracula"
  // but eBay image search returned 20 "The Crow: Dead Time" results
  const result = alignIdentity({
    visionTitle: 'Grimm Fairy Tales Presents Van Helsing vs. Dracula #1',
    visionIssue: '1',
    visionYear: 2016,
    visionPublisher: 'Zenescope',
    visionConfidence: 'medium',
    ebayImageResults: [
      { title: 'The Crow: Dead Time #1 Alan Quah FanExpo Chicago Virgin Variant Ltd 300 W/COA' },
      { title: 'CROW DEAD TIME #1 ALAN QUAH FANEXPO CHICAGO EXCLUSIVE SPOT FOIL LTD 75' },
      { title: 'CROW DEAD TIME #1 SIGNED ALAN QUAH FANEXPO CHICAGO SPOT FOIL VIRGIN LTD 75 W/COA' },
      { title: 'Crow: Dead Time 1 FanExpo Chicago Alan Quah Spot Foil Embossed Variant LTD 75' },
      { title: 'The Crow: Dead Time #1 Alan Quah FanExpo Chicago Virgin Variant Ltd 300 W/COA' },
      { title: 'The Crow: Dead Time #1 - Alan Quah FanExpo Chicago Virgin Variant Ltd 300 W/ COA' },
      { title: 'The Crow: Dead Time #1 • Alan Quah FanExpo Chicago Virgin Variant Ltd 300' },
      { title: 'Crow: Dead Time 1 FanExpo Chicago Spot Foil Embossed Variant SIGNED Quah W/ CoA' },
      { title: 'CROW DEAD TIME #1 ALAN QUAH FANEXPO CHICAGO EXCLUSIVE VARIANT NM LTD 300' },
      { title: 'The Crow MegaCon 26 InHyuk Lee Virgin Ed Llimited to 100 W/COA NM' },
      { title: 'The Crow #1 Inhyuk Lee Virgin Legendary Variant Cover MegaCon Exclusive LTD 100' },
      { title: 'Crow #1  Inhyuk Lee EMBOSSED FOIL from blind bag MegaCon 2026 LTD 50 w/COA' },
      { title: 'CROW DEAD TIME #1 SIGNED ALAN QUAH FANEXPO CHICAGO EXCLUSIVE VIRGIN LTD 50 W/COA' },
      { title: 'CROW DEAD TIME 1 RAYMOND GAY EXCLUSIVE NYCC 2024 VIRGIN VARIANT NM' },
      { title: 'Crow DEAD TIME #1 MegaCon 2026 InHyuk Lee Virgin Variant LE 100 w/COA HIGH GRADE' },
      { title: 'The Crow Virgin Brandon Lee Tribute Rudy Ao Cvr Ltd 300 Dallas Fan Expo 2025' },
      { title: 'Crow: Dead Time#1 - InHyuk Lee LEGENDARY VIRGIN MegaCon 2026 Ltd 100 w/COA NM/M' },
      { title: "The Crow (MegaCon '26) InHyuk Lee Virgin Ed - limited 200 W/COA (New/unopened)" },
      { title: "The Crow InHyuk Lee Virgin Ed (Slight Damage) - limited 200 W/COA (MegaCon '26)" },
      { title: 'The Crow: Dead Time Megacon Inhyuk Lee Virgin Exclusive LTD To 100 Worldwide COA' },
    ],
    pcProductName: null,
    cvVolumeName: null,
  });

  assert(result.confirmedSource === 'ebay_image_override', 'should be ebay_image_override');
  assert(result.overrodeVision === true, 'should override Vision');
  assert(result.visionWas === 'Grimm Fairy Tales Presents Van Helsing vs. Dracula #1', 'should record Vision title');
  assert(result.confidence === 'UNCERTAIN', 'should be UNCERTAIN confidence');
  assert(result.authenticationScore === 65, 'should be 65 score');
  assert(result.needsReview === true, 'should need review');
  assert(result.conflicts.length === 1, 'should have 1 conflict');
  assert(result.conflicts[0].severity === 'CRITICAL', 'conflict should be CRITICAL');
  assert(result.conflicts[0].ebayCount === 20, 'should record 20 eBay results');
  assert(result.confirmedTitle.includes('Crow') || result.confirmedTitle.includes('CROW'), 'eBay consensus should be Crow-related');
});

test('RULE 0: 15 eBay results, 100% overlap with Vision → no override, existing logic runs', () => {
  // eBay agrees with Vision — RULE 0 does not fire
  const result = alignIdentity({
    visionTitle: 'Amazing Spider-Man #300',
    visionIssue: '300',
    visionYear: 1988,
    visionPublisher: 'Marvel',
    visionConfidence: 'high',
    ebayImageResults: [
      { title: 'Amazing Spider-Man #300' },
      { title: 'Amazing Spider-Man #300' },
      { title: 'Amazing Spider-Man #300' },
      { title: 'Amazing Spider-Man #300' },
      { title: 'Amazing Spider-Man #300' },
      { title: 'Amazing Spider-Man #300' },
      { title: 'Amazing Spider-Man #300' },
      { title: 'Amazing Spider-Man #300' },
      { title: 'Amazing Spider-Man #300' },
      { title: 'Amazing Spider-Man #300' },
      { title: 'Amazing Spider-Man #300' },
      { title: 'Amazing Spider-Man #300' },
      { title: 'Amazing Spider-Man #300' },
      { title: 'Amazing Spider-Man #300' },
      { title: 'Amazing Spider-Man #300' },
    ],
    pcProductName: 'Amazing Spider-Man #300',
    cvVolumeName: 'Amazing Spider-Man',
  });

  assert(result.confirmedSource !== 'ebay_image_override', 'should NOT be override (overlap >= 20%)');
  assert(result.overrodeVision === false, 'should not override Vision');
  assert(result.confidence === 'UNCERTAIN', 'should be UNCERTAIN (score 86, needs year/pub from CV)');
  assert(result.authenticationScore === 86, 'should be score 86');
});

test('RULE 0: 5 eBay results, 0% overlap → no override (threshold not met)', () => {
  // Only 5 results, RULE 0 requires ≥10 — falls back to existing logic
  const result = alignIdentity({
    visionTitle: 'Batman #1',
    visionIssue: '1',
    visionYear: 2024,
    visionPublisher: 'DC',
    visionConfidence: 'medium',
    ebayImageResults: [
      { title: 'Superman #1' },
      { title: 'Superman #1' },
      { title: 'Superman #1' },
      { title: 'Superman #1' },
      { title: 'Superman #1' },
    ],
    pcProductName: 'Batman (2024)',
    cvVolumeName: 'Batman',
  });

  assert(result.confirmedSource !== 'ebay_image_override', 'should NOT fire RULE 0 (< 10 results)');
  assert(result.confirmedTitle === 'Batman #1', 'should keep Vision title');
  // eBay consensus would be "Superman" but with only 5 results, the ≥10 threshold blocks the override
});

run();
