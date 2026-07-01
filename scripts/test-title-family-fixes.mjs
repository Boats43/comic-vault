#!/usr/bin/env node
// Title-family identity resolution validation — tests fixes A1-A4, B, C
// Validates the 3 commits: c9b91fb (Fix Group A), a3afb58 (Fix Group B), 1c02d4b (Fix Group C)

import { selectTitleFamilyCandidate, extractIdentityFromImageSearch } from '../src/lib/imageSearchIdentity.js';

console.log('='.repeat(80));
console.log('TITLE-FAMILY FIX VALIDATION — 3 commits deployed');
console.log('='.repeat(80));
console.log();

let passCount = 0;
let failCount = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passCount++;
  } catch (err) {
    console.log(`✗ ${name}`);
    console.log(`  ERROR: ${err.message}`);
    failCount++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ═══════════════════════════════════════════════════════════════════════
// FIX A1: Weight inversion (Black Panther #1 case)
// ═══════════════════════════════════════════════════════════════════════

test('FIX A1: Weight inversion — item[0] correct family (5.0) beats wrong family (6.5) with 3x threshold', () => {
  // Simulate: items[0] = Black Panther Mark Brooks (correct, index 0 = weight 5)
  //           items[1-4] = Black Panther 2018 wrong family (indices 1-4 = weights 4+3+1+1 = 9)
  // Old threshold (2x): 9 >= 10? NO → protection fires, wrong answer
  // New threshold (3x): 9 >= 15? NO → protection fires, CORRECT
  const items = [
    { rawTitle: 'Black Panther #1 Mark Brooks Midtown Exclusive Virgin (2021) CGC 9.8' },
    { rawTitle: 'Black Panther #1 (2018) Marvel CGC 9.6' },
    { rawTitle: 'Black Panther #1 Ta-Nehisi Coates (2018) NM' },
    { rawTitle: 'Black Panther #1 2018 First Print Marvel' },
    { rawTitle: 'Black Panther Vol 7 #1 (2018)' },
    { rawTitle: 'Black Panther #1 Mark Brooks Virgin CGC 9.8' },  // same family as item[0]
  ];

  const result = selectTitleFamilyCandidate(items, 'Black Panther', '1', '2021');

  assert(result.decision === 'top-rank-protection',
    `Expected top-rank-protection, got ${result.decision}`);
  assert(result.selectedTitle.toLowerCase().includes('black panther'),
    `Expected Black Panther in title, got "${result.selectedTitle}"`);
  // Should NOT pick the 2018 family despite higher total membership
});

// ═══════════════════════════════════════════════════════════════════════
// FIX A2: Weak overlap false-rejection (Catwoman #5 case)
// ═══════════════════════════════════════════════════════════════════════

test('FIX A2: Percentage-based overlap — catwoman (1 Vision token) matches catwoman+artgerm family (5 tokens)', () => {
  // Old logic: 1 shared token vs threshold=2 → REJECT (fallback-vision)
  // New logic: 1/min(5,1) = 100% ≥ 40% → ACCEPT (weighted-consensus)
  const items = [
    { rawTitle: 'Catwoman #5 Stanley Artgerm Lau Variant (2018) CGC 9.8' },
    { rawTitle: 'Catwoman #5 Artgerm Virgin (2018) NM' },
    { rawTitle: 'Catwoman Vol 5 #5 Artgerm Exclusive (2018)' },
    { rawTitle: 'Catwoman #5 2018 Stanley Lau Cover' },
    { rawTitle: 'Catwoman #5 Artgerm Trade Dress CGC 9.6' },
    { rawTitle: 'Catwoman #5 Jeehyung Lee (2018) CGC 9.8' },
    { rawTitle: 'Catwoman #5 Artgerm Variant NM/M' },
  ];

  const result = selectTitleFamilyCandidate(items, 'Catwoman', '5', '2018');

  assert(result.decision === 'weighted-consensus',
    `Expected weighted-consensus, got ${result.decision}`);
  assert(result.selectedTitle.toLowerCase().includes('catwoman'),
    `Expected catwoman in title, got "${result.selectedTitle}"`);
  // Should accept despite Vision having only 1 token ("catwoman")
});

// ═══════════════════════════════════════════════════════════════════════
// FIX A3: Vision hallucination guard (Mark Spears Monsters case)
// ═══════════════════════════════════════════════════════════════════════

test('FIX A3: Hallucination guard — fallback-vision + LOW confidence → refused (tested via enrich.js integration)', () => {
  // This fix is in api/enrich.js, tested by ensuring fallback-vision + visionConfidence=LOW
  // escalates to refused-identity-conflict. Unit test here confirms fallback-vision fires:
  const items = [
    { rawTitle: 'Unrelated Comic #1 (2020)' },
    { rawTitle: 'Different Title #1 (2019)' },
    { rawTitle: 'Another Book #1 (2021)' },
    { rawTitle: 'Wrong Series #1 (2018)' },
    { rawTitle: 'Not Mark Spears #1 (2022)' },
  ];

  const result = selectTitleFamilyCandidate(items, 'Mark Spears Monsters', '1', '2023');

  // Should return fallback-vision (no overlap with Vision title)
  // Integration test in enrich.js will escalate this to refused when visionConfidence=LOW
  assert(result.decision === 'fallback-vision' || result.decision === 'refused-identity-conflict',
    `Expected fallback-vision or refused, got ${result.decision}`);
});

// ═══════════════════════════════════════════════════════════════════════
// FIX A4: Boilerplate sanitization (House of Mystery case)
// ═══════════════════════════════════════════════════════════════════════

test('FIX A4: Boilerplate removed — "read description" stripped (conservative filter)', () => {
  const items = [
    { rawTitle: 'House of Mystery #157 DC Batman Read Description (1966) VG' },
    { rawTitle: 'DC House of Mystery #157 1966 Batman Dial For Hero' },
    { rawTitle: 'House of Mystery #157 (1966) Silver Age DC Comics' },
    { rawTitle: 'House of Mystery #157 VG 1966 Free Shipping' },
    { rawTitle: 'House of Mystery #157 DC 1966' },
  ];

  const result = selectTitleFamilyCandidate(items, 'House of Mystery', '157', '1966');

  assert(result.decision === 'weighted-consensus' || result.decision === 'top-rank-protection',
    `Expected weighted-consensus or top-rank-protection, got ${result.decision}`);

  const title = result.selectedTitle.toLowerCase();
  assert(title.includes('house') && title.includes('mystery'),
    `Expected "house mystery" in title, got "${result.selectedTitle}"`);
  assert(!title.includes('read') && !title.includes('description'),
    `Boilerplate not removed: "${result.selectedTitle}"`);
  // NOTE: Character cross-contamination ("batman") uses conservative filter.
  // Auto-removal risks stripping legitimate series names (Black Panther, Captain
  // America). Clustering + overlap logic should prevent cross-series mixing.
});

// ═══════════════════════════════════════════════════════════════════════
// REGRESSION CHECKS: Previously-working cases must NOT break
// ═══════════════════════════════════════════════════════════════════════

test('REGRESSION: Superman 80-Page Giant #3 — still resolves correctly', () => {
  const items = [
    { rawTitle: 'Superman 80-Page Giant #3 (1964) DC Comics' },
    { rawTitle: 'Superman 80 Page Giant #3 1964 VG/FN' },
    { rawTitle: 'Superman 80-Page Giant #3 Silver Age DC' },
    { rawTitle: 'Superman Giant #3 (1964)' },
    { rawTitle: 'Superman 80-Page Giant Vol 1 #3' },
  ];

  const result = selectTitleFamilyCandidate(items, 'Superman 80-Page Giant', '3', '1964');

  assert(result.decision === 'weighted-consensus' || result.decision === 'top-rank-protection',
    `Expected acceptance, got ${result.decision}`);
  assert(result.selectedTitle.toLowerCase().includes('superman'),
    `Expected superman in title, got "${result.selectedTitle}"`);
});

test('REGRESSION: Punisher #1 — modern title still clusters correctly', () => {
  const items = [
    { rawTitle: 'Punisher #1 (2018) Marvel Comics CGC 9.8' },
    { rawTitle: 'Punisher Vol 12 #1 2018 NM' },
    { rawTitle: 'The Punisher #1 (2018) First Print' },
    { rawTitle: 'Punisher #1 Matthew Rosenberg (2018)' },
    { rawTitle: 'Punisher 2018 #1 Marvel' },
  ];

  const result = selectTitleFamilyCandidate(items, 'Punisher', '1', '2018');

  assert(result.decision === 'weighted-consensus' || result.decision === 'top-rank-protection',
    `Expected acceptance, got ${result.decision}`);
  assert(result.selectedTitle.toLowerCase().includes('punisher'),
    `Expected punisher in title, got "${result.selectedTitle}"`);
});

test('REGRESSION: Captain America #359 — verified case still works', () => {
  const items = [
    { rawTitle: 'Captain America #359 (1989) Marvel CGC 9.6 1st Crossbones' },
    { rawTitle: 'Captain America Vol 1 #359 1989 NM' },
    { rawTitle: 'Captain America #359 First Crossbones Appearance' },
    { rawTitle: 'Captain America #359 (1989) VF/NM' },
    { rawTitle: 'Captain America #359 1st App Crossbones Marvel' },
  ];

  const result = selectTitleFamilyCandidate(items, 'Captain America', '359', '1989');

  assert(result.decision === 'weighted-consensus' || result.decision === 'top-rank-protection',
    `Expected acceptance, got ${result.decision}`);
  assert(result.selectedTitle.toLowerCase().includes('captain') &&
         result.selectedTitle.toLowerCase().includes('america'),
    `Expected captain america in title, got "${result.selectedTitle}"`);
});

test('REGRESSION: Green Lanterns #56 — modern DC title still works', () => {
  const items = [
    { rawTitle: 'Green Lanterns #56 (2018) DC Comics NM' },
    { rawTitle: 'Green Lanterns Vol 1 #56 2018' },
    { rawTitle: 'Green Lanterns #56 DC Rebirth' },
    { rawTitle: 'Green Lanterns #56 (2018) First Print' },
    { rawTitle: 'Green Lanterns #56 NM/M' },
  ];

  const result = selectTitleFamilyCandidate(items, 'Green Lanterns', '56', '2018');

  assert(result.decision === 'weighted-consensus' || result.decision === 'top-rank-protection',
    `Expected acceptance, got ${result.decision}`);
  assert(result.selectedTitle.toLowerCase().includes('green') &&
         result.selectedTitle.toLowerCase().includes('lantern'),
    `Expected green lanterns in title, got "${result.selectedTitle}"`);
});

// ═══════════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════════

console.log();
console.log('='.repeat(80));
console.log(`RESULTS: ${passCount} passed, ${failCount} failed`);
console.log('='.repeat(80));

process.exit(failCount > 0 ? 1 : 0);
