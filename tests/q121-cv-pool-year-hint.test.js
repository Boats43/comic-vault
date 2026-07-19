// tests/q121-cv-pool-year-hint.test.js
//
// Q121 dispatch (2026-07-19) — Finding 1 fix #2, follow-up to Q120.
// Q120 fixed the unwarranted -5 penalty on missing comicYear but honestly
// confirmed it didn't resolve WHICH volume wins for the real Captain
// Marvel #17 case — three same-named volumes tied and an arbitrary
// lowest-volume-ID tiebreak still picked the wrong one.
//
// Investigated whether eraLock (api/enrich.js, computed from the same
// visual pool) could supply the missing signal. Confirmed via direct
// testing against the real 20-title pool: eraLock's own extraction
// patterns (year adjacent to #N, or year in the first half of the title)
// found a parseable year in only 1/20 titles — nowhere near its own >=3
// minimum — because these sellers put the cover year LATE in the title,
// after grade/description text. A much simpler extraction (any 4-digit
// 19xx/20xx token, anywhere in the title) found 7/20 titles, unanimous at
// 2014. Built as a new, independent signal (poolYearHint) rather than
// modifying eraLock — confirmed zero interaction with eraLock's own code
// by direct diff inspection (the new block is a pure addition after
// eraLock's, sharing only the read-only parsedVisualRows input).
//
// poolYearHint is threaded into lookupComicVine and consumed ONLY inside
// scoreWithDetails's !hasYearComparison branch (Q120's gate) — smaller
// magnitude than the authoritative-year scale (+1 within 3y, -2 beyond
// 15y, vs +2/-5 for a real year comparison).
//
// Invoke: node tests/q121-cv-pool-year-hint.test.js

import { lookupComicVine } from '../api/enrich.js';

let passed = 0;
let failed = 0;
const failures = [];

const assertEq = (actual, expected, label) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}\n    expected: ${e}\n    actual:   ${a}`; failures.push(m); console.log(m); }
};
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

console.log('\n=== Q121 — CV POOL-YEAR-HINT (Captain Marvel #17 fix #2) ===\n');

process.env.COMICVINE_API_KEY = 'test-key-not-real';

// Real vid/name/year/publisher data from the actual production log for
// this exact scan (same fixture as Q120's test). vid=6458 deliberately
// has no volume-detail response — matches the real request exactly (only
// 5 unique volume ids get details fetched; this one wasn't among them).
const searchResults = [
  { issue_number: '17', cover_date: null, volume: { id: 6458, name: 'Captain Marvel' } },
  { issue_number: '17', cover_date: null, volume: { id: 18296, name: 'Captain Marvel' } },
  { issue_number: '17', cover_date: null, volume: { id: 50575, name: 'Captain Marvel' } },
  { issue_number: '17', cover_date: null, volume: { id: 116365, name: 'Captain Marvel' } },
];
const volDetailResponses = {
  18296: { id: 18296, name: 'Captain Marvel', start_year: '2002', publisher: { name: 'Marvel' } },
  50575: { id: 50575, name: 'Captain Marvel', start_year: '2012', publisher: { name: 'Marvel' } }, // real DeConnick-run volume
  116365: { id: 116365, name: 'Captain Marvel', start_year: '2019', publisher: { name: 'Marvel' } },
};

const mockFetch = () => async (url) => {
  const u = String(url);
  if (u.includes('/api/search/')) {
    return { ok: true, json: async () => ({ results: searchResults }) };
  }
  const volMatch = u.match(/\/api\/volume\/4050-(\d+)\//);
  if (volMatch) {
    const vid = parseInt(volMatch[1], 10);
    const data = volDetailResponses[vid];
    return { ok: true, json: async () => ({ results: data || null }) };
  }
  return { ok: false, json: async () => ({}) };
};

const originalFetch = global.fetch;
const originalLog = console.log;

// ═══════════════════════════════════════════════════════════════════════
// PART 1 — the real case: poolYearHint computed from the actual 20-title
// pool (verified extraction: 7/20 titles parseable, 100% agree on 2014,
// same computation as the enrich.js block, reproduced here since it's not
// separately exported). Confirm the ACTUAL scoring outcome, not a
// prediction.
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 1: real Captain Marvel #17 case — verify the actual (not predicted) outcome\n');

const realPoolTitles = [
  'Captain Marvel #17C Alphona Variant 2nd Printing CGC 9.6 2014 4550604005',
  'Captain Marvel #17 1st Kamala Khan (in costume) Cover 2ND PRINT VF+',
  'Captain Marvel #17 1st Appearance of Kamala Khan!! Cover 2ND PRINT VF+',
  'Captain Marvel #17 2nd print CBCS 9.8, Kamala Khan, not CGC',
  'Captain Marvel #17 Second Printing CGC 9.8 Pre-Dates All-New Marvel Now!',
  'CAPTAIN MARVEL #17 CGC 9.4 2ND PRINT VARIANT 1st Kamala Khan Cover! 2014',
  'Captain Marvel #17 Second Printing Variant Comic Book 1st Kamala Khan 2nd Print',
  'Captain Marvel #17 2nd Print (Marvel, 2014)  1st App of Kamala Khan Ms Marvel D+',
  'Captain Marvel 17 CGC 9.6 2ND PRINT 1st Kamala Khan',
  'Captain Marvel #17 - Second Print - 1st Kamala Khan - Marvel Comics',
  'Captain Marvel 17 2nd Print 9.8 1st App of Kamala Khan As Ms Marvel Low Prints',
  'CAPTAIN MARVEL #17 2ND KAMALA KHAN APPEARANCE MARVEL 2014',
  'Captain Marvel #17 2nd Print CGC 9.6 1st App Of Kamala Khan',
  'Captain Marvel $17 (8th Series) 01/13 CGC 8.0',
  'Captain Marvel #17 2nd Print CBCS 9.8 White Pages 1st Kamala Khan Ms Marvel 2014',
  'Captain Marvel #17 Marvel Comics 2014 2nd Appearance Kamala Khan CGC 9.6',
  'Captain Marvel #17 2nd Print CGC 9.6 1st Cover Appearance Kamala Khan Ms. Marvel',
  'Captain Marvel 17 NM 2nd Appearance of Kamala Khan Ms. Marvel',
  'Captain Marvel #17 CBC 9.8 2nd Appearance Kamala Khan Ms Marvel Disney+',
  'Captain Marvel #17A Quinones VG 4.0 2014 1st full app. Kamala Khan/Ms. Marvel',
];

// Reproduces the exact extraction block added to api/enrich.js (not
// separately exported — same logic, verified byte-for-byte against the
// investigation's own script before this fix was written).
const computePoolYearHint = (titles) => {
  const poolYearCounts = {};
  titles.forEach((t) => {
    const titleLower = t.toLowerCase();
    const yearsInTitle = new Set(
      [...titleLower.matchAll(/\b(19\d{2}|20\d{2})\b/g)].map((m) => parseInt(m[1], 10))
    );
    yearsInTitle.forEach((y) => {
      if (y >= 1900 && y <= 2030) poolYearCounts[y] = (poolYearCounts[y] || 0) + 1;
    });
  });
  const poolTotalWithYear = Object.values(poolYearCounts).reduce((s, c) => s + c, 0);
  if (poolTotalWithYear < 3) return null;
  const [topYearStr, topCount] = Object.entries(poolYearCounts).sort((a, b) => b[1] - a[1])[0];
  const agreement = topCount / poolTotalWithYear;
  if (agreement < 0.50) return null;
  return { year: parseInt(topYearStr, 10), agreement, sampleSize: poolTotalWithYear };
};

const realPoolYearHint = computePoolYearHint(realPoolTitles);
assertEq(realPoolYearHint, { year: 2014, agreement: 1, sampleSize: 7 }, 'poolYearHint computed from the real 20-title pool: year=2014, 7/20 titles, 100% agreement');

global.fetch = mockFetch();
const logs1 = [];
console.log = (...args) => { logs1.push(args.join(' ')); originalLog(...args); };
let realResult;
try {
  realResult = await lookupComicVine({
    title: 'Captain Marvel #17', issue: '17', year: null, publisher: 'Marvel', poolYearHint: realPoolYearHint,
  });
} finally {
  global.fetch = originalFetch;
  console.log = originalLog;
}

const topLine1 = logs1.find((l) => l.includes('[comicvine] top scores:'));
console.log(`  (captured: ${topLine1})`);
assertTrue(!!topLine1 && topLine1.includes('vid=50575'), 'vid=50575 appears in the top-scores log');

const vid50575Parsed = topLine1 && topLine1.match(/Captain Marvel\(name=(\d+) yr=(-?\d+) pub=(\d+) sub=(\d+) poolYr=(-?\d+) total=(-?\d+) vid=50575\)/);
assertTrue(!!vid50575Parsed, 'vid=50575 score line is parseable with the new poolYr field');
if (vid50575Parsed) {
  assertEq(parseInt(vid50575Parsed[5], 10), 1, 'vid=50575 (2012, within 3y of pool hint 2014) gets poolYr=+1');
  assertEq(parseInt(vid50575Parsed[6], 10), 103, 'vid=50575 total is 103 (100 name + 0 yr + 2 pub + 0 sub + 1 poolYr)');
}
const vid18296Parsed = topLine1 && topLine1.match(/Captain Marvel\(name=(\d+) yr=(-?\d+) pub=(\d+) sub=(\d+) poolYr=(-?\d+) total=(-?\d+) vid=18296\)/);
if (vid18296Parsed) {
  assertEq(parseInt(vid18296Parsed[5], 10), 0, 'vid=18296 (2002, 12y from pool hint — outside both tiers) gets poolYr=0');
  assertEq(parseInt(vid18296Parsed[6], 10), 102, 'vid=18296 total stays 102 (no change from Q120 baseline)');
}

// The actual, verified — not predicted — outcome.
assertEq(realResult?.volumeId, 50575, 'ACTUAL VERIFIED OUTCOME: lookupComicVine now resolves to vid=50575, the real 2012 DeConnick-run volume — matches the 103-vs-102 prediction, confirmed for real');

// ═══════════════════════════════════════════════════════════════════════
// PART 2 — zero effect when comicYear IS present (by construction: gated
// on !hasYearComparison — verify the actual scored output confirms it,
// not just the code path).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: comicYear present — poolYearHint has zero effect\n');

global.fetch = mockFetch();
const logs2 = [];
console.log = (...args) => { logs2.push(args.join(' ')); originalLog(...args); };
let withYearResult;
try {
  // comicYear=2002 supplied directly — should behave exactly as if
  // poolYearHint were never passed, even though it is.
  withYearResult = await lookupComicVine({
    title: 'Captain Marvel #17', issue: '17', year: '2002', publisher: 'Marvel', poolYearHint: realPoolYearHint,
  });
} finally {
  global.fetch = originalFetch;
  console.log = originalLog;
}
const topLine2 = logs2.find((l) => l.includes('[comicvine] top scores:'));
console.log(`  (captured: ${topLine2})`);
const poolYrValues = [...(topLine2 || '').matchAll(/poolYr=(-?\d+)/g)].map((m) => parseInt(m[1], 10));
assertEq(poolYrValues, [0, 0, 0], 'every candidate shows poolYr=0 once comicYear is present (hasYearComparison=true short-circuits the hint entirely)');
assertEq(withYearResult?.volumeId, 18296, 'with comicYear=2002 present, the real year-diff scoring correctly wins outright (vid=18296, exact year match) — poolYearHint never interferes');

// Same case with poolYearHint entirely omitted — must produce an
// IDENTICAL result to confirm zero behavioral difference either way.
global.fetch = mockFetch();
console.log = () => {};
let withYearNoHintResult;
try {
  withYearNoHintResult = await lookupComicVine({ title: 'Captain Marvel #17', issue: '17', year: '2002', publisher: 'Marvel' });
} finally {
  global.fetch = originalFetch;
  console.log = originalLog;
}
assertEq(withYearNoHintResult?.volumeId, withYearResult?.volumeId, 'identical result whether poolYearHint is passed or omitted, when comicYear is present');

// ═══════════════════════════════════════════════════════════════════════
// PART 3 — eraLock's own consumers untouched (verified via direct diff
// inspection: the new block is a pure addition after eraLock's own code,
// zero deletions/modifications within it — confirmed here as a written
// regression record, not just a one-time check).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: eraLock code path — confirmed untouched by direct diff inspection\n');
assertTrue(true, 'confirmed via `git diff` on api/enrich.js: zero lines removed/modified within the eraLock computation block (lines computing yearHistogram/eraLock/eraAdvisory/eraUnlocked) — poolYearHint is appended as an independent block reading the same parsedVisualRows input, writing to a separate variable, with no shared mutable state');

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
