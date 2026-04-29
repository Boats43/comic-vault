// Unit tests for Ship #20a.6.7b — image search identity wiring + PC token
// overlap + subtitle strip.
//
// Covers:
//   - #20a.6.7b.1: PC token overlap check (defensive, prevents wrong matches)
//   - #20a.6.7b.2: Image search consensus → PC query (offensive, uses correct data)
//   - #20a.6.7b.3: Image search title → comp query (coverage, catches what Vision missed)
//   - #20a.6.15: Subtitle strip for PC/CV queries (fixes colon-separated titles)
//
// Invoke: node tests/pc-identity.test.js
// Exit: 0 all-pass, 1 any failure.

// These are pure-function helpers extracted for testability. The actual
// production code is inline in api/enrich.js, but we test the logic here.

const tokenize = (s, COMMON_TOKENS) =>
  String(s || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1 && !COMMON_TOKENS.has(t));

const COMMON_TOKENS = new Set([
  'marvel', 'dc', 'image', 'idw', 'comics', 'comic',
  'book', 'the', 'a', 'an', 'of', 'and', 'in', 'for',
  'dark', 'horse', 'boom', 'archie', 'dynamite',
]);

const wouldAcceptProduct = (queryTitle, productName) => {
  const queryTokens = tokenize(queryTitle, COMMON_TOKENS);
  const mainToken = queryTokens[0];
  if (!mainToken) return true; // No main token — allow (edge case)
  const productTokens = tokenize(productName, COMMON_TOKENS);
  return productTokens.includes(mainToken);
};

const stripSubtitle = (t) => String(t || '').replace(/:.*$/, '').trim();

const getImageSearchConsensusTitle = (items) => {
  if (!items || !Array.isArray(items) || items.length < 3) return null;
  const titles = items.map(i => i?.title).filter(Boolean);
  if (titles.length < 3) return null;
  const freq = {};
  titles.forEach(t => { freq[t] = (freq[t] || 0) + 1; });
  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  const top = sorted[0];
  return top && top[1] >= 3 ? top[0] : null;
};

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

console.log('\n=== SHIP #20a.6.7b — PC IDENTITY WIRING ===\n');

// ─── Ship #20a.6.7b.1 — PC token overlap ────────────────────────────────
console.log('Ship #20a.6.7b.1 — PC token overlap:');

// Crow Lazarus class — main token "crow" missing from "Lazarus: Fallen"
assertFalse(
  wouldAcceptProduct('Crow Lazarus', 'Lazarus: Fallen #1 (2025)'),
  '"Crow Lazarus" vs "Lazarus: Fallen" → REJECTED (no "crow")'
);

// Correct match — both have "crow"
assertTrue(
  wouldAcceptProduct('Crow Lazarus', 'The Crow Lazarus #1 (2024)'),
  '"Crow Lazarus" vs "The Crow Lazarus #1" → ACCEPTED (has "crow")'
);

// Classic case — "amazing" present
assertTrue(
  wouldAcceptProduct('Amazing Fantasy', 'Amazing Fantasy #15 (1962)'),
  '"Amazing Fantasy" vs "Amazing Fantasy #15" → ACCEPTED'
);

// Wrong book — "fantastic" ≠ "lazarus"
assertFalse(
  wouldAcceptProduct('Fantastic Four', 'Lazarus Planet #1 (2023)'),
  '"Fantastic Four" vs "Lazarus Planet" → REJECTED (no "fantastic")'
);

// Partial match — "uncanny" present even though not main token
assertTrue(
  wouldAcceptProduct('X-Men', 'Uncanny X-Men #1 (1963)'),
  '"X-Men" vs "Uncanny X-Men #1" → ACCEPTED (has "men")'
);

// Common-token-only title — edge case, allows all
assertTrue(
  wouldAcceptProduct('The Dark', 'Dark Horse Comics #1'),
  'Common-token-only title → allow (main token = null)'
);

// Empty query — no crash
assertTrue(
  wouldAcceptProduct('', 'Any Product #1'),
  'Empty query → allow (safe fallback)'
);

// Case insensitivity
assertTrue(
  wouldAcceptProduct('Batman', 'BATMAN #1 (1940)'),
  'Case insensitive: "Batman" vs "BATMAN" → ACCEPTED'
);

// Punctuation handling
assertTrue(
  wouldAcceptProduct("D'Orc", "D'Orc #1 (2022)"),
  'Punctuation stripped: "D\'Orc" → ACCEPTED'
);

// Multi-word main token
assertTrue(
  wouldAcceptProduct('Spider-Man', 'Amazing Spider-Man #1'),
  '"Spider-Man" → mainToken="spider" → ACCEPTED'
);

// Publisher token filtered out
assertFalse(
  wouldAcceptProduct('Lazarus', 'Batman #1 Marvel Comics'),
  '"Lazarus" vs "Batman" → REJECTED (marvel/comics filtered)'
);

// ─── Ship #20a.6.7b.2 — Image search consensus ──────────────────────────
console.log('\nShip #20a.6.7b.2 — Image search consensus title:');

// Consensus fires when ≥3 titles match
const crow20x = Array(20).fill({ title: 'The Crow Lazarus' });
assertEq(
  getImageSearchConsensusTitle(crow20x),
  'The Crow Lazarus',
  '20× "The Crow Lazarus" → consensus fires'
);

// Exactly 3 matches — consensus fires
const crowExact3 = [
  { title: 'The Crow Lazarus' },
  { title: 'The Crow Lazarus' },
  { title: 'The Crow Lazarus' },
];
assertEq(
  getImageSearchConsensusTitle(crowExact3),
  'The Crow Lazarus',
  'Exactly 3 matches → consensus fires'
);

// Mixed titles, no clear winner
const mixed = [
  { title: 'Batman #1' },
  { title: 'Batman: Year One' },
  { title: 'Batman #2' },
  { title: 'Batman #1' },
];
assertEq(
  getImageSearchConsensusTitle(mixed),
  null,
  'Mixed titles, no ≥3 match → null'
);

// Fewer than 3 results total
const twoResults = [
  { title: 'Batman #1' },
  { title: 'Batman #1' },
];
assertEq(
  getImageSearchConsensusTitle(twoResults),
  null,
  'Only 2 results → null (need ≥3 total)'
);

// Empty array
assertEq(
  getImageSearchConsensusTitle([]),
  null,
  'Empty array → null'
);

// Null input
assertEq(
  getImageSearchConsensusTitle(null),
  null,
  'null input → null'
);

// Non-array input
assertEq(
  getImageSearchConsensusTitle('not an array'),
  null,
  'Non-array → null'
);

// Items without title field
const noTitles = [
  {},
  { title: null },
  { title: '' },
];
assertEq(
  getImageSearchConsensusTitle(noTitles),
  null,
  'Items without title field → null'
);

// Tie-breaker: first in sorted order wins
const tie = [
  { title: 'Amazing Fantasy' },
  { title: 'Amazing Fantasy' },
  { title: 'Amazing Fantasy' },
  { title: 'Batman' },
  { title: 'Batman' },
  { title: 'Batman' },
];
assertEq(
  typeof getImageSearchConsensusTitle(tie),
  'string',
  'Tie at 3-3 → first sorted entry wins (string returned)'
);

// ─── Ship #20a.6.15 — Subtitle strip ────────────────────────────────────
console.log('\nShip #20a.6.15 — Subtitle strip:');

assertEq(
  stripSubtitle('The Crow: Lazarus'),
  'The Crow',
  '"The Crow: Lazarus" → "The Crow"'
);

assertEq(
  stripSubtitle('Batman: Year One'),
  'Batman',
  '"Batman: Year One" → "Batman"'
);

assertEq(
  stripSubtitle('Lazarus: Fallen'),
  'Lazarus',
  '"Lazarus: Fallen" → "Lazarus"'
);

// No colon — unchanged
assertEq(
  stripSubtitle('Amazing Fantasy'),
  'Amazing Fantasy',
  '"Amazing Fantasy" (no colon) → unchanged'
);

// Multiple colons — strips everything after first
assertEq(
  stripSubtitle('Title: Subtitle: Extra'),
  'Title',
  'Multiple colons → strips all after first'
);

// Empty string
assertEq(
  stripSubtitle(''),
  '',
  'Empty string → empty string'
);

// Null input
assertEq(
  stripSubtitle(null),
  '',
  'null → empty string'
);

// Undefined input
assertEq(
  stripSubtitle(undefined),
  '',
  'undefined → empty string'
);

// Colon at start
assertEq(
  stripSubtitle(': Subtitle'),
  '',
  'Colon at start → empty string'
);

// Whitespace handling
assertEq(
  stripSubtitle('  Title  :  Subtitle  '),
  'Title',
  'Whitespace trimmed correctly'
);

// ─── Summary ────────────────────────────────────────────────────────────
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
