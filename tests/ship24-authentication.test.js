// Ship #24 — Identity Authentication Score Tests
//
// Tests cross-source validation scoring (title/issue/year/publisher)
// and UI gating logic.
//
// Invoke: node tests/ship24-authentication.test.js

import { alignIdentity } from '../src/lib/identityAlignment.js';

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

const assertRange = (actual, min, max, label) => {
  if (actual >= min && actual <= max) {
    passed++;
    console.log(`  ✓ ${label} (${actual} in [${min}, ${max}])`);
  } else {
    failed++;
    const msg = `  ✗ ${label}\n    expected: ${min}-${max}\n    actual:   ${actual}`;
    failures.push(msg);
    console.log(msg);
  }
};

const assertTrue = (actual, label) => assertEq(actual, true, label);
const assertFalse = (actual, label) => assertEq(actual, false, label);

console.log('\n=== SHIP #24 — IDENTITY AUTHENTICATION SCORE ===\n');

// ─── Perfect Agreement (All Sources Match) ──────────────────────
console.log('SCENARIO 1 — Perfect Agreement (ASM #129):');
const perfect = alignIdentity({
  visionTitle: 'Amazing Spider-Man',
  visionIssue: '129',
  visionYear: 1974,
  visionPublisher: 'Marvel',
  visionConfidence: 'high',
  ebayImageResults: [
    { title: 'Amazing Spider-Man', rawTitle: 'Amazing Spider-Man #129' },
    { title: 'Amazing Spider-Man', rawTitle: 'Amazing Spider-Man #129 1974' },
  ],
  pcProductName: 'Amazing Spider-Man #129',
  pcIssue: null,
  pcYear: 1974,
  cvVolumeName: 'Amazing Spider-Man',
  cvIssue: '129',
  cvYear: 1974,
  cvPublisher: 'Marvel Comics',
  cgcTitle: null,
  cgcIssue: null,
});

assertEq(perfect.confidence, 'VERIFIED', 'Perfect agreement → VERIFIED tier');
assertRange(perfect.authenticationScore, 90, 100, 'Perfect agreement → 90-100 score (VERIFIED tier)');
assertEq(perfect.conflicts.length, 0, 'Perfect agreement → zero conflicts');
assertFalse(perfect.needsReview, 'Perfect agreement → no review needed');
assertEq(perfect.confirmedTitle, 'Amazing Spider-Man', 'Title confirmed');
assertEq(perfect.confirmedIssue, '129', 'Issue confirmed');
assertEq(perfect.confirmedYear, 1974, 'Year confirmed');

// ─── CGC Override (Authoritative Source) ────────────────────────
console.log('\nSCENARIO 2 — CGC Override (Vision Wrong):');
const cgcOverride = alignIdentity({
  visionTitle: 'Amazing Spider-Man',
  visionIssue: '121', // WRONG
  visionYear: 1973,
  visionPublisher: 'Marvel',
  visionConfidence: 'medium',
  ebayImageResults: [],
  pcProductName: 'Amazing Spider-Man #129',
  pcIssue: null,
  pcYear: 1974,
  cvVolumeName: 'Amazing Spider-Man',
  cvIssue: '129',
  cvYear: 1974,
  cvPublisher: 'Marvel Comics',
  cgcTitle: 'Amazing Spider-Man',
  cgcIssue: '129', // CGC corrects Vision
});

assertEq(cgcOverride.confirmedIssue, '129', 'CGC issue overrides Vision');
assertTrue(cgcOverride.conflicts.length > 0, 'Conflicts detected (Vision vs CGC)');
assertRange(cgcOverride.authenticationScore, 60, 95, 'CGC partial override → UNCERTAIN/VERIFIED');

// ─── Partial Agreement (PC + CV agree, Vision differs) ─────────
console.log('\nSCENARIO 3 — Partial Agreement (Vision Issue Wrong):');
const partial = alignIdentity({
  visionTitle: 'X-Men',
  visionIssue: '101', // Vision wrong
  visionYear: 1976,
  visionPublisher: 'Marvel',
  visionConfidence: 'high',
  ebayImageResults: [],
  pcProductName: 'X-Men #100',
  pcIssue: null,
  pcYear: 1976,
  cvVolumeName: 'X-Men',
  cvIssue: '100', // PC + CV agree
  cvYear: 1976,
  cvPublisher: 'Marvel Comics',
  cgcTitle: null,
  cgcIssue: null,
});

assertRange(partial.authenticationScore, 65, 85, 'Partial agreement → UNCERTAIN tier');
assertTrue(partial.conflicts.length > 0, 'Conflicts detected (issue mismatch)');
assertTrue(partial.needsReview, 'Partial agreement → needs review');

// ─── Major Conflicts (All Sources Disagree) ─────────────────────
console.log('\nSCENARIO 4 — Major Conflicts (Vision vs All):');
const conflicts = alignIdentity({
  visionTitle: 'The Crow',
  visionIssue: '1',
  visionYear: 2020,
  visionPublisher: 'IDW',
  visionConfidence: 'low',
  ebayImageResults: [
    { title: 'Crow Dead Time', rawTitle: 'Crow Dead Time #1' },
    { title: 'Crow Dead Time', rawTitle: 'Crow Dead Time #1 2020' },
  ],
  pcProductName: 'Crow Dead Time #1',
  pcIssue: null,
  pcYear: 2020,
  cvVolumeName: 'Crow: Dead Time',
  cvIssue: '1',
  cvYear: 2020,
  cvPublisher: 'IDW Publishing',
  cgcTitle: null,
  cgcIssue: null,
});

assertEq(conflicts.confidence, 'UNCERTAIN', 'Major title conflict → UNCERTAIN or UNVERIFIED');
assertTrue(conflicts.authenticationScore < 80, 'Major conflicts → score < 80');
assertTrue(conflicts.conflicts.length > 0, 'Conflicts array populated');
assertTrue(conflicts.needsReview, 'Major conflicts → needs review');

// ─── Vision Only (No External Sources) ──────────────────────────
console.log('\nSCENARIO 5 — Vision Only (Obscure Indie):');
const visionOnly = alignIdentity({
  visionTitle: 'Obscure Indie Comic',
  visionIssue: '1',
  visionYear: 1985,
  visionPublisher: 'Small Press',
  visionConfidence: 'high',
  ebayImageResults: [],
  pcProductName: null, // No PC match
  pcIssue: null,
  pcYear: null,
  cvVolumeName: null, // No CV match
  cvIssue: null,
  cvYear: null,
  cvPublisher: null,
  cgcTitle: null,
  cgcIssue: null,
});

assertRange(visionOnly.authenticationScore, 50, 70, 'Vision only (high conf) → 50-70 score');
assertEq(visionOnly.confirmedSource, 'vision_only', 'Source = vision_only');
assertTrue(visionOnly.needsReview, 'Vision only → needs review');
assertTrue(visionOnly.conflicts.length > 0, 'Vision only → conflicts flag lack of sources');

// ─── Year Tolerance (Cover Date Drift) ──────────────────────────
console.log('\nSCENARIO 6 — Year Tolerance (±2y Cover Date):');
const yearTolerance = alignIdentity({
  visionTitle: 'Action Comics',
  visionIssue: '33',
  visionYear: 1941,
  visionPublisher: 'DC',
  visionConfidence: 'high',
  ebayImageResults: [],
  pcProductName: 'Action Comics #33',
  pcIssue: null,
  pcYear: 1940, // 1y diff (cover date vs publication)
  cvVolumeName: 'Action Comics',
  cvIssue: '33',
  cvYear: 1941,
  cvPublisher: 'Detective Comics Inc', // Substring match: "dc" in "detective comics inc"
  cgcTitle: null,
  cgcIssue: null,
});

assertRange(yearTolerance.authenticationScore, 93, 100, 'Year ±2y tolerance → VERIFIED (fixed publisher substring)');
assertEq(yearTolerance.conflicts.length, 0, 'Year within ±2y → no conflict');

// ─── eBay Consensus Override (Visual Match) ─────────────────────
console.log('\nSCENARIO 7 — eBay Consensus (Partial Match, No Override):');
const ebayPartial = alignIdentity({
  visionTitle: 'Crow',
  visionIssue: '1',
  visionYear: 2020,
  visionPublisher: 'IDW',
  visionConfidence: 'medium',
  ebayImageResults: [
    { title: 'Crow Dead Time', rawTitle: 'Crow Dead Time #1 2020' },
    { title: 'Crow Dead Time', rawTitle: 'Crow Dead Time #1 C2E2 exclusive' },
    { title: 'Crow Dead Time', rawTitle: 'Crow Dead Time #1 IDW' },
  ],
  pcProductName: 'Crow Dead Time #1',
  pcIssue: null,
  pcYear: 2020,
  cvVolumeName: 'Crow: Dead Time',
  cvIssue: '1',
  cvYear: 2020,
  cvPublisher: 'IDW Publishing',
  cgcTitle: null,
  cgcIssue: null,
});

// eBay consensus "Crow Dead Time" only 33% overlap with "Crow" → doesn't override
assertFalse(ebayPartial.overrodeVision, 'eBay consensus (low overlap) does not override Vision');
assertEq(ebayPartial.confirmedSource, 'vision+text', 'Source = vision+text (PC+CV confirm)');
assertRange(ebayPartial.authenticationScore, 60, 80, 'Partial match → UNCERTAIN tier');

// ─── Publisher Normalization ────────────────────────────────────
console.log('\nSCENARIO 8 — Publisher Normalization (Substring Match):');
const pubNorm = alignIdentity({
  visionTitle: 'Batman',
  visionIssue: '1',
  visionYear: 1940,
  visionPublisher: 'DC',
  visionConfidence: 'high',
  ebayImageResults: [],
  pcProductName: 'Batman #1',
  pcIssue: null,
  pcYear: 1940,
  cvVolumeName: 'Batman',
  cvIssue: '1',
  cvYear: 1940,
  cvPublisher: 'Detective Comics Inc', // "dc" substring of "detective comics inc"
  cgcTitle: null,
  cgcIssue: null,
});

// Publisher should match via substring: "dc" in "detective comics inc"
assertRange(pubNorm.authenticationScore, 93, 100, 'Publisher substring match → VERIFIED');

// ─── Breakdown Scoring ──────────────────────────────────────────
console.log('\nSCENARIO 9 — Breakdown Weights (Title 50%, Issue 25%, Year 15%, Pub 10%):');
const breakdown = alignIdentity({
  visionTitle: 'Amazing Spider-Man',
  visionIssue: '129',
  visionYear: 1974,
  visionPublisher: 'Marvel',
  visionConfidence: 'high',
  ebayImageResults: [],
  pcProductName: 'Amazing Spider-Man #129',
  pcIssue: null,
  pcYear: 1974,
  cvVolumeName: 'Amazing Spider-Man',
  cvIssue: '129',
  cvYear: 1974,
  cvPublisher: 'Marvel Comics',
  cgcTitle: null,
  cgcIssue: null,
});

// When PC+CV both present with perfect match, expect high scores
// Title: PC+CV agree, both >=0.5 overlap → score = min(90, avg(overlap)*100)
// For perfect match: overlap=1.0 → (1.0+1.0)/2*100 = 100, min(90,100) = 90
assertRange(breakdown.breakdown.title, 88, 92, 'Title score ~90 (PC+CV perfect match)');
assertTrue(breakdown.breakdown.issue >= 90, 'Issue score >= 90 (perfect match)');
assertTrue(breakdown.breakdown.year >= 90, 'Year score >= 90 (perfect match)');
assertTrue(breakdown.breakdown.publisher >= 90, 'Publisher score >= 90 (substring match)');

// ─── Summary ────────────────────────────────────────────────────
console.log(`\n=== RESULTS ===`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  console.log('\n=== FAILURES ===');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
console.log('All tests passed.\n');
process.exit(0);
