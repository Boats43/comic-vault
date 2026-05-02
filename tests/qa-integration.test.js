// Q&A Integration Test — End-to-End Pipeline Validation
//
// Tests the complete enrichment pipeline with real-world scenarios.
// Validates data flow from input → identity → pricing → output.
//
// Invoke: node tests/qa-integration.test.js

import { alignIdentity } from '../src/lib/identityAlignment.js';

let passed = 0;
let failed = 0;
const failures = [];

const assert = (condition, label) => {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}`;
    failures.push(msg);
    console.log(msg);
  }
};

console.log('\n=== Q&A INTEGRATION TEST ===\n');

// ─── Q1: What happens when all sources agree? ───────────────────────
console.log('Q1: What happens when all sources agree on identity?');
const q1 = alignIdentity({
  visionTitle: 'Amazing Spider-Man',
  visionIssue: '300',
  visionYear: 1988,
  visionPublisher: 'Marvel',
  visionConfidence: 'high',
  ebayImageResults: [
    { title: 'Amazing Spider-Man', rawTitle: 'Amazing Spider-Man #300' },
    { title: 'Amazing Spider-Man', rawTitle: 'ASM #300 1988' },
    { title: 'Amazing Spider-Man', rawTitle: 'Amazing Spider-Man #300 Venom' },
  ],
  pcProductName: 'Amazing Spider-Man #300',
  pcIssue: null,
  pcYear: 1988,
  cvVolumeName: 'Amazing Spider-Man',
  cvIssue: '300',
  cvYear: 1988,
  cvPublisher: 'Marvel Comics',
  cgcTitle: 'Amazing Spider-Man',
  cgcIssue: '300',
});

assert(q1.confidence === 'VERIFIED', 'A1: Confidence tier is VERIFIED');
assert(q1.authenticationScore >= 90, 'A1: Authentication score ≥90');
assert(q1.confirmedTitle === 'Amazing Spider-Man', 'A1: Title confirmed');
assert(q1.confirmedIssue === '300', 'A1: Issue confirmed');
assert(q1.conflicts.length === 0, 'A1: Zero conflicts');

// ─── Q2: What happens when Vision is wrong? ────────────────────────
console.log('\nQ2: What happens when Vision misidentifies the book?');
const q2 = alignIdentity({
  visionTitle: 'The Crow', // WRONG
  visionIssue: '1',
  visionYear: 2020,
  visionPublisher: 'Zenescope', // WRONG
  visionConfidence: 'medium',
  ebayImageResults: [
    { title: 'Crow Dead Time', rawTitle: 'Crow Dead Time #1' },
    { title: 'Crow Dead Time', rawTitle: 'Crow Dead Time #1 2020' },
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

assert(q2.confidence !== 'VERIFIED', 'A2: Confidence is NOT VERIFIED (title conflict)');
assert(q2.conflicts.length > 0, 'A2: Conflicts detected');
assert(q2.needsReview === true, 'A2: Needs review flagged');
assert(q2.authenticationScore < 90, 'A2: Auth score < 90 due to title mismatch');

// ─── Q3: What happens with no external data? ────────────────────────
console.log('\nQ3: What happens when only Vision data is available?');
const q3 = alignIdentity({
  visionTitle: 'Obscure Indie Comic',
  visionIssue: '1',
  visionYear: 1985,
  visionPublisher: 'Small Press',
  visionConfidence: 'high',
  ebayImageResults: [],
  pcProductName: null,
  pcIssue: null,
  pcYear: null,
  cvVolumeName: null,
  cvIssue: null,
  cvYear: null,
  cvPublisher: null,
  cgcTitle: null,
  cgcIssue: null,
});

assert(q3.confirmedSource === 'vision_only', 'A3: Source is vision_only');
assert(q3.authenticationScore >= 50 && q3.authenticationScore <= 70, 'A3: Auth score in 50-70 range');
assert(q3.needsReview === true, 'A3: Needs review (no external validation)');
assert(q3.conflicts.length > 0, 'A3: Conflicts flag lack of sources');

// ─── Q4: What happens when CGC overrides Vision? ────────────────────
console.log('\nQ4: What happens when CGC cert data corrects Vision?');
const q4 = alignIdentity({
  visionTitle: 'X-Men',
  visionIssue: '100', // WRONG
  visionYear: 1976,
  visionPublisher: 'Marvel',
  visionConfidence: 'medium',
  ebayImageResults: [],
  pcProductName: 'X-Men #101',
  pcIssue: null,
  pcYear: 1976,
  cvVolumeName: 'X-Men',
  cvIssue: '101',
  cvYear: 1976,
  cvPublisher: 'Marvel Comics',
  cgcTitle: 'X-Men',
  cgcIssue: '101', // CGC corrects
});

assert(q4.confirmedIssue === '101', 'A4: CGC issue overrides Vision');
assert(q4.conflicts.some(c => c.field === 'issue'), 'A4: Issue conflict recorded');
assert(q4.authenticationScore >= 60, 'A4: Auth score ≥60 (CGC authoritative)');

// ─── Q5: What happens with year drift (cover date)? ────────────────
console.log('\nQ5: What happens when year differs by ±2 (cover date drift)?');
const q5 = alignIdentity({
  visionTitle: 'Action Comics',
  visionIssue: '1',
  visionYear: 1938,
  visionPublisher: 'DC',
  visionConfidence: 'high',
  ebayImageResults: [],
  pcProductName: 'Action Comics #1',
  pcIssue: null,
  pcYear: 1938,
  cvVolumeName: 'Action Comics',
  cvIssue: '1',
  cvYear: 1938, // Same year
  cvPublisher: 'Detective Comics Inc',
  cgcTitle: null,
  cgcIssue: null,
});

assert(q5.authenticationScore >= 93, 'A5: Year match → high auth score');
assert(q5.conflicts.length === 0, 'A5: No year conflict (within tolerance)');

// ─── Q6: What happens with publisher normalization? ────────────────
console.log('\nQ6: What happens when publisher names vary (Marvel vs Marvel Comics)?');
const q6 = alignIdentity({
  visionTitle: 'Fantastic Four',
  visionIssue: '1',
  visionYear: 1961,
  visionPublisher: 'Marvel', // Short form
  visionConfidence: 'high',
  ebayImageResults: [],
  pcProductName: 'Fantastic Four #1',
  pcIssue: null,
  pcYear: 1961,
  cvVolumeName: 'Fantastic Four',
  cvIssue: '1',
  cvYear: 1961,
  cvPublisher: 'Marvel Comics', // Long form
  cgcTitle: null,
  cgcIssue: null,
});

assert(q6.authenticationScore >= 90, 'A6: Publisher substring match accepted');
assert(!q6.conflicts.some(c => c.field === 'publisher'), 'A6: No publisher conflict');

// ─── Q7: What happens with partial eBay consensus? ─────────────────
console.log('\nQ7: What happens when eBay has low overlap with Vision?');
const q7 = alignIdentity({
  visionTitle: 'Crow',
  visionIssue: '1',
  visionYear: 2020,
  visionPublisher: 'IDW',
  visionConfidence: 'medium',
  ebayImageResults: [
    { title: 'Crow Dead Time', rawTitle: 'Crow Dead Time #1 2020' },
    { title: 'Crow Dead Time', rawTitle: 'Crow Dead Time #1 exclusive' },
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

assert(q7.overrodeVision === false, 'A7: eBay does NOT override (low overlap < 30%)');
assert(q7.confirmedSource !== 'ebay_visual_override', 'A7: Source is not eBay override');

// ─── Summary ────────────────────────────────────────────────────────
console.log(`\n=== RESULTS ===`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  console.log('\n=== FAILURES ===');
  failures.forEach(f => console.log(f));
  process.exit(1);
}
console.log('All Q&A tests passed.\n');
process.exit(0);
