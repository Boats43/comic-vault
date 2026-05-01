// Ship #25.1 — Era Filter Bug Fix Test
//
// Tests Golden Age active listing filter rejects modern relaunches.
//
// Bug: Action Comics #33 (1941) was getting $2.99-$4.99 comps from
// 2011 New 52 relaunch because listings had no year in title.
//
// Fix: Pre-1970 books REJECT listings without year (assume modern).
//      Also detect modern relaunch markers (N52, Rebirth, etc.)
//
// Invoke: node tests/ship25-era-filter.test.js

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

const assertTrue = (actual, label) => assertEq(actual, true, label);
const assertFalse = (actual, label) => assertEq(actual, false, label);

console.log('\n=== SHIP #25.1 — ERA FILTER BUG FIX ===\n');

// Simulate the era filter logic
const MODERN_RELAUNCH_RE = /\b(n52|new\s*52|rebirth|infinite\s*frontier|legacy|prime\s*earth)\b/i;

const extractYear = (titleStr) => {
  const m = String(titleStr || '').match(/\b(19|20)\d{2}\b/);
  return m ? parseInt(m[0], 10) : null;
};

const shouldKeepListing = (listing, bookYear) => {
  const titleStr = String(listing.title || '');
  const yearNum = parseInt(String(bookYear), 10);

  // Reject modern relaunches for pre-2000 books
  if (yearNum < 2000 && MODERN_RELAUNCH_RE.test(titleStr)) {
    return false;
  }

  const ly = extractYear(titleStr);

  // For pre-1970 books, REJECT listings with no year (assume modern)
  if (ly == null) {
    if (yearNum < 1970) {
      return false; // REJECT
    }
    return true; // Modern books: keep listings without year
  }

  // Year tolerance check
  const tolerance = yearNum < 1970 ? 5 : yearNum < 1985 ? 3 : 3;
  const diff = Math.abs(ly - yearNum);
  return diff <= tolerance;
};

// ─── Golden Age: Action Comics #33 (1941) ──────────────────────
console.log('Golden Age — Action Comics #33 (1941):');

// Should REJECT: New 52 relaunch listings (no year in title)
assertFalse(
  shouldKeepListing({ title: 'Action Comics #33 N52 Regular Cover NM' }, 1941),
  'REJECT: New 52 listing (N52 marker)'
);

assertFalse(
  shouldKeepListing({ title: 'DC COMICS SUPERMAN ACTION ISSUE #33 (PC1)' }, 1941),
  'REJECT: Modern listing (no year, pre-1970 book)'
);

assertFalse(
  shouldKeepListing({ title: 'Action Comics #33 New 52 Variant' }, 1941),
  'REJECT: New 52 variant (relaunch marker)'
);

// Should KEEP: Correct era listings
assertTrue(
  shouldKeepListing({ title: 'Action Comics #33 1941 Golden Age Superman' }, 1941),
  'KEEP: 1941 listing (exact year match)'
);

assertTrue(
  shouldKeepListing({ title: 'Action Comics #33 1940 DC Comics Golden Age' }, 1941),
  'KEEP: 1940 listing (within ±5y tolerance)'
);

assertTrue(
  shouldKeepListing({ title: 'Action Comics #33 1945 Superman DC' }, 1941),
  'KEEP: 1945 listing (within ±5y)'
);

// Should REJECT: Outside tolerance
assertFalse(
  shouldKeepListing({ title: 'Action Comics #33 1950 DC Comics' }, 1941),
  'REJECT: 1950 listing (9y gap, outside ±5y)'
);

assertFalse(
  shouldKeepListing({ title: 'Action Comics #33 2011 New 52' }, 1941),
  'REJECT: 2011 listing (70y gap)'
);

// ─── Silver Age: Amazing Spider-Man #129 (1974) ────────────────
console.log('\nSilver Age — Amazing Spider-Man #129 (1974):');

// Should REJECT: No year (pre-1970 rule doesn't apply to 1974)
// But 1974 > 1970, so no-year listings are kept for modern books
assertTrue(
  shouldKeepListing({ title: 'Amazing Spider-Man #129 1st Punisher' }, 1974),
  'KEEP: No year, but book is 1974 (modern books keep no-year listings)'
);

// Should REJECT: Outside ±3y tolerance
assertFalse(
  shouldKeepListing({ title: 'Amazing Spider-Man #129 1980 Reprint' }, 1974),
  'REJECT: 1980 listing (6y gap, outside ±3y)'
);

// Should KEEP: Within tolerance
assertTrue(
  shouldKeepListing({ title: 'Amazing Spider-Man #129 1974 Marvel' }, 1974),
  'KEEP: 1974 listing (exact)'
);

assertTrue(
  shouldKeepListing({ title: 'Amazing Spider-Man #129 1976 1st Punisher' }, 1974),
  'KEEP: 1976 listing (within ±3y)'
);

// ─── Modern Relaunch Markers ────────────────────────────────────
console.log('\nModern Relaunch Markers:');

assertFalse(
  shouldKeepListing({ title: 'Batman #1 Rebirth 2016' }, 1940),
  'REJECT: Rebirth marker (pre-2000 book)'
);

assertFalse(
  shouldKeepListing({ title: 'Superman #1 Infinite Frontier' }, 1939),
  'REJECT: Infinite Frontier marker (pre-2000 book)'
);

assertFalse(
  shouldKeepListing({ title: 'Flash #1 New 52 Variant' }, 1940),
  'REJECT: New 52 marker (pre-2000 book)'
);

// Modern books should keep modern markers
assertTrue(
  shouldKeepListing({ title: 'Batman #1 Rebirth 2016' }, 2016),
  'KEEP: Rebirth marker, but book is 2016'
);

// ─── Edge Cases ─────────────────────────────────────────────────
console.log('\nEdge Cases:');

// Exactly at 1970 boundary
assertTrue(
  shouldKeepListing({ title: 'X-Men #1 Giant-Size' }, 1970),
  'KEEP: No year, 1970 is NOT < 1970 (modern rule applies, keeps no-year)'
);

assertFalse(
  shouldKeepListing({ title: 'X-Men #1 Giant-Size' }, 1969),
  'REJECT: No year, 1969 < 1970 (Golden Age rule applies, rejects no-year)'
);

// Year exactly at boundary of tolerance
assertTrue(
  shouldKeepListing({ title: 'Action Comics #33 1946' }, 1941),
  'KEEP: 1946 = exactly +5y (boundary)'
);

assertTrue(
  shouldKeepListing({ title: 'Action Comics #33 1936' }, 1941),
  'KEEP: 1936 = exactly -5y (boundary)'
);

assertFalse(
  shouldKeepListing({ title: 'Action Comics #33 1947' }, 1941),
  'REJECT: 1947 = +6y (outside ±5y)'
);

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
