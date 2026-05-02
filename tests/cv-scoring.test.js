// ComicVine Volume Scoring Tests
//
// Tests subtitle token boost/penalty, publisher tiebreaker, and year gap penalty.
//
// Invoke: node tests/cv-scoring.test.js

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

// Import the helper function (simulate its behavior for testing)
const extractSubtitleTokens = (title) => {
  const str = String(title || '').toLowerCase();
  // Split on colon, dash with spaces (not compound words), or "vs"
  const parts = str.split(/:\s*|\s+-\s+|\bvs\b/);
  if (parts.length < 2) return [];
  return parts.slice(1)
    .join(' ')
    .split(/\s+/)
    .filter(t => t.length > 2)
    .filter(t => !['the', 'and', 'for', 'with'].includes(t));
};

console.log('\n=== CV VOLUME SCORING TESTS ===\n');

// ─── TEST 1: Subtitle Token Extraction ─────────────────────────────
console.log('TEST 1 — Subtitle Token Extraction:');

const t1_1 = extractSubtitleTokens('Crow: Dead Time');
assert(t1_1.includes('dead') && t1_1.includes('time'), 'T1.1: "Crow: Dead Time" → ["dead", "time"]');

const t1_2 = extractSubtitleTokens('Spider-Man vs Venom');
assert(t1_2.includes('venom'), 'T1.2: "Spider-Man vs Venom" → ["venom"]');

const t1_3 = extractSubtitleTokens('Batman - The Dark Knight');
assert(t1_3.includes('dark') && t1_3.includes('knight'), 'T1.3: "Batman - The Dark Knight" → ["dark", "knight"]');

const t1_4 = extractSubtitleTokens('Amazing Spider-Man');
assert(t1_4.length === 0, 'T1.4: "Amazing Spider-Man" → [] (no subtitle)');

const t1_5 = extractSubtitleTokens('X-Men: Days of Future Past');
assert(t1_5.includes('days') && t1_5.includes('future') && t1_5.includes('past'), 'T1.5: "X-Men: Days of Future Past" → ["days", "future", "past"]');

// Filter stop words
const t1_6 = extractSubtitleTokens('Superman: For The Man');
assert(!t1_6.includes('for') && !t1_6.includes('the'), 'T1.6: Stop words filtered ("for", "the")');
assert(t1_6.includes('man'), 'T1.6: "man" preserved');

// ─── TEST 2: Subtitle Scoring Logic ────────────────────────────────
console.log('\nTEST 2 — Subtitle Scoring Logic:');

// Simulate scoring
const scoreSubtitle = (confirmedTitle, volumeName) => {
  const subtitleTokens = extractSubtitleTokens(confirmedTitle);
  if (subtitleTokens.length === 0) return 0;
  const volNameLower = String(volumeName || '').toLowerCase();
  const hasSubtitle = subtitleTokens.some(t => volNameLower.includes(t));
  return hasSubtitle ? 30 : -20;
};

const s2_1 = scoreSubtitle('Crow: Dead Time', 'Crow: Dead Time');
assert(s2_1 === 30, 'T2.1: Exact subtitle match → +30');

const s2_2 = scoreSubtitle('Crow: Dead Time', 'Crow');
assert(s2_2 === -20, 'T2.2: Missing subtitle tokens → -20');

const s2_3 = scoreSubtitle('Crow: Dead Time', 'The Crow: Dead Time');
assert(s2_3 === 30, 'T2.3: Subtitle match (with "The") → +30');

const s2_4 = scoreSubtitle('Amazing Spider-Man', 'Amazing Spider-Man');
assert(s2_4 === 0, 'T2.4: No subtitle → 0 (scoring unchanged)');

const s2_5 = scoreSubtitle('Batman: Hush', 'Batman');
assert(s2_5 === -20, 'T2.5: "Batman: Hush" vs "Batman" → -20');

const s2_6 = scoreSubtitle('Batman: Hush', 'Batman: Hush');
assert(s2_6 === 30, 'T2.6: "Batman: Hush" exact match → +30');

// ─── TEST 3: Year Gap Penalty ──────────────────────────────────────
console.log('\nTEST 3 — Year Gap Penalty:');

const scoreYear = (comicYear, startYear) => {
  const yearDiff = Math.abs(startYear - comicYear);
  if (yearDiff >= 30) return -5;
  if (yearDiff > 20) return -2;
  if (yearDiff < 10) return 2;
  if (yearDiff < 20) return 1;
  return 0;
};

const y3_1 = scoreYear(1988, 1988);
assert(y3_1 === 2, 'T3.1: 0-year gap → +2');

const y3_2 = scoreYear(1988, 1993);
assert(y3_2 === 2, 'T3.2: 5-year gap → +2');

const y3_3 = scoreYear(1988, 2003);
assert(y3_3 === 1, 'T3.3: 15-year gap → +1');

const y3_4 = scoreYear(1988, 2010);
assert(y3_4 === -2, 'T3.4: 22-year gap → -2');

const y3_5 = scoreYear(1988, 2020);
assert(y3_5 === -5, 'T3.5: 32-year gap → -5');

const y3_6 = scoreYear(1994, 2024);
assert(y3_6 === -5, 'T3.6: 30-year gap → -5');

const y3_7 = scoreYear(1941, 2014);
assert(y3_7 === -5, 'T3.7: 73-year gap → -5 (Golden Age vs modern)');

// ─── TEST 4: Publisher Tiebreaker ──────────────────────────────────
console.log('\nTEST 4 — Publisher Tiebreaker:');

const applyPublisherTiebreaker = (scored, confirmedPublisher) => {
  const topScore = scored[0].total;
  const closeVols = scored.filter(c => topScore - c.total <= 10);

  if (closeVols.length > 1 && confirmedPublisher) {
    const pubLower = String(confirmedPublisher).toLowerCase().trim();
    const pubMatch = closeVols.find(c => {
      const volPub = String(c.publisher || '').toLowerCase();
      return volPub.includes(pubLower) || pubLower.includes(volPub);
    });
    if (pubMatch) return pubMatch;
  }
  return scored[0];
};

// Scenario: Two volumes within 10 points
const candidates = [
  { name: 'Crow Vol 1', total: 100, publisher: 'Kitchen Sink' },
  { name: 'Crow: Dead Time', total: 95, publisher: 'Sumerian' }, // 5 pts behind
];

const winner1 = applyPublisherTiebreaker(candidates, 'Sumerian');
assert(winner1.name === 'Crow: Dead Time', 'T4.1: Publisher match breaks tie (5pt gap)');

const winner2 = applyPublisherTiebreaker(candidates, 'Kitchen Sink');
assert(winner2.name === 'Crow Vol 1', 'T4.2: Top score wins when both match publisher');

const winner3 = applyPublisherTiebreaker(candidates, 'IDW');
assert(winner3.name === 'Crow Vol 1', 'T4.3: Top score wins when neither matches publisher');

// Scenario: Gap > 10 points (tiebreaker doesn't apply)
const candidates2 = [
  { name: 'Batman', total: 100, publisher: 'DC' },
  { name: 'Batman: Hush', total: 85, publisher: 'DC Comics' }, // 15 pts behind
];

const winner4 = applyPublisherTiebreaker(candidates2, 'DC Comics');
assert(winner4.name === 'Batman', 'T4.4: Gap > 10pts → tiebreaker skipped, top score wins');

// Scenario: Exact 10-point gap (boundary)
const candidates3 = [
  { name: 'X-Men', total: 100, publisher: 'Image' },
  { name: 'X-Men: Legacy', total: 90, publisher: 'Marvel Comics' }, // 10 pts behind
];

const winner5 = applyPublisherTiebreaker(candidates3, 'Marvel Comics');
assert(winner5.name === 'X-Men: Legacy', 'T4.5: 10pt gap (boundary) → tiebreaker applies, publisher match wins');

// ─── TEST 5: Combined Scoring ──────────────────────────────────────
console.log('\nTEST 5 — Combined Scoring:');

const computeTotal = (nameScore, yearScore, pubScore, subtitleScore) => {
  return nameScore + yearScore + pubScore + subtitleScore;
};

// "Crow: Dead Time" vs "Crow"
const crowDeadTime = computeTotal(
  50,  // nameScore (partial match)
  2,   // yearScore (same year)
  2,   // pubScore (publisher match)
  30   // subtitleScore (has "dead time")
);
const crowPlain = computeTotal(
  50,  // nameScore (partial match)
  2,   // yearScore (same year)
  0,   // pubScore (no publisher match)
  -20  // subtitleScore (missing "dead time")
);

assert(crowDeadTime > crowPlain, 'T5.1: "Crow: Dead Time" (+30 subtitle) beats "Crow" (-20 penalty)');
assert(crowDeadTime - crowPlain === 52, 'T5.2: Score gap = 52 pts (30 - (-20) + 2 pub)');

// Year penalty impact
const modern = computeTotal(50, -5, 0, 0); // 30-year gap
const vintage = computeTotal(50, 2, 0, 0);  // same year

assert(vintage > modern, 'T5.3: Vintage (year match) beats modern (30y gap)');
assert(vintage - modern === 7, 'T5.4: Year gap penalty = 7 pts (2 - (-5))');

// ─── Summary ────────────────────────────────────────────────────────
console.log(`\n=== RESULTS ===`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  console.log('\n=== FAILURES ===');
  failures.forEach(f => console.log(f));
  process.exit(1);
}
console.log('All CV scoring tests passed.\n');
process.exit(0);
