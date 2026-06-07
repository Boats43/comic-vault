// tests/book-detection.test.js
//
// Session 4B — Book detection test
// Verifies detectBookSignals() logic and assetType routing

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}\nExpected: ${expected}\nActual: ${actual}`);
  }
}

function assertTrue(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

// Replicate detectBookSignals logic from api/grade.js
const detectBookSignals = (parsed) => {
  if (!parsed) return false;

  // Must have null or empty issue (not a comic)
  if (parsed.issue && String(parsed.issue).trim().length > 0) {
    return false;
  }

  // Check for book-specific signals in title or reason text
  const title = String(parsed.title || '').toLowerCase();
  const reason = String(parsed.reason || '').toLowerCase();
  const combined = `${title} ${reason}`;

  const BOOK_SIGNALS = [
    /\bauthor\b/i,
    /\bisbn\b/i,
    /\b978-\d{10}\b/,              // ISBN-13 pattern
    /\bpublished\s+by\b/i,
    /\bcopyright\b/i,
    /\bedition\b/i,
    /\bhardcover\b/i,
    /\bpaperback\b/i,
    /\bnovel\b/i,
    /\btitle\s+page\b/i,
    /\bdust\s+jacket\b/i,
    // Session 4B — Abbreviations
    /\bhc\b/i,                     // hardcover (abbreviated)
    /\bdj\b/i,                     // dust jacket (abbreviated)
    /\b\d+(st|nd|rd|th)\s*ed\b/i, // 1st ed, 5th ed, etc.
    /\bpress\b/i,                  // university press, publishing house
    /\bvol\b/i,                    // volume
  ];

  const matchCount = BOOK_SIGNALS.filter(pattern => pattern.test(combined)).length;

  // Require 2+ book signals to avoid false positives
  return matchCount >= 2;
};

// TEST 1: Einstein book with abbreviations
test('Einstein book — 5th ed hc dj detects as book', () => {
  const parsed = {
    title: "princeton press einstein the meaning of relativity 5th ed hc dj",
    issue: null,
    publisher: "Princeton University Press",
    reason: "This is not a comic book. It appears to be a hardcover book."
  };

  const isBook = detectBookSignals(parsed);
  assertTrue(isBook, 'Should detect as book (press, 5th ed, hc, dj = 4 signals)');
});

// TEST 2: Einstein book with issue field returns false
test('Einstein book with issue field — NOT detected as book', () => {
  const parsed = {
    title: "princeton press einstein the meaning of relativity 5th ed hc dj",
    issue: "1", // Has issue number = comic signal
    publisher: "Princeton University Press",
    reason: "This is not a comic book."
  };

  const isBook = detectBookSignals(parsed);
  assertEqual(isBook, false, 'Should NOT detect as book when issue is present');
});

// TEST 3: Hardcover full word pattern
test('Book with full hardcover keyword', () => {
  const parsed = {
    title: "Thinking Fast and Slow",
    issue: null,
    reason: "Hardcover edition published by Farrar"
  };

  const isBook = detectBookSignals(parsed);
  assertTrue(isBook, 'Should detect hardcover + published (2 signals)');
});

// TEST 4: Paperback with author
test('Book with paperback and author mention', () => {
  const parsed = {
    title: "The Great Gatsby",
    issue: null,
    reason: "Paperback edition. Author F. Scott Fitzgerald."
  };

  const isBook = detectBookSignals(parsed);
  assertTrue(isBook, 'Should detect paperback + author (2 signals)');
});

// TEST 5: Comic should NOT trigger (has issue number)
test('Comic with issue number — NOT a book', () => {
  const parsed = {
    title: "Amazing Spider-Man",
    issue: "300",
    publisher: "Marvel",
    reason: "First appearance of Venom"
  };

  const isBook = detectBookSignals(parsed);
  assertEqual(isBook, false, 'Should NOT detect comic as book (has issue)');
});

// TEST 6: Ambiguous title with only 1 signal
test('Ambiguous title with single signal — NOT detected', () => {
  const parsed = {
    title: "The Press Conference",
    issue: null,
    reason: "No clear book markers"
  };

  const isBook = detectBookSignals(parsed);
  assertEqual(isBook, false, 'Should NOT detect with only 1 signal (press)');
});

// TEST 7: ISBN pattern detection
test('Book with ISBN-13 pattern', () => {
  const parsed = {
    title: "Programming Book",
    issue: null,
    reason: "ISBN 978-0134685991 visible on back cover"
  };

  const isBook = detectBookSignals(parsed);
  assertTrue(isBook, 'Should detect ISBN pattern + isbn keyword (2 signals)');
});

// TEST 8: Volume abbreviation
test('Book with volume abbreviation', () => {
  const parsed = {
    title: "Encyclopedia Vol 3",
    issue: null,
    reason: "Hardcover reference book"
  };

  const isBook = detectBookSignals(parsed);
  assertTrue(isBook, 'Should detect vol + hardcover (2 signals)');
});

// TEST 9: Edition variations
test('Book with edition variations', () => {
  const tests = [
    { text: "1st ed", desc: "1st ed" },
    { text: "2nd ed", desc: "2nd ed" },
    { text: "3rd ed", desc: "3rd ed" },
    { text: "5th ed", desc: "5th ed" },
    { text: "10th ed", desc: "10th ed" }
  ];

  for (const t of tests) {
    const parsed = {
      title: `Test Book ${t.text}`,
      issue: null,
      reason: "hardcover"
    };
    const isBook = detectBookSignals(parsed);
    assertTrue(isBook, `Should detect ${t.desc} + hardcover`);
  }
});

// TEST 10: Null parsed object
test('Null parsed object returns false', () => {
  const isBook = detectBookSignals(null);
  assertEqual(isBook, false, 'Null object should return false');
});

// TEST 11: Empty issue string still blocks
test('Empty issue string (empty, not null) allows book detection', () => {
  const parsed = {
    title: "Book Title",
    issue: "",  // Empty string, not null
    reason: "hardcover edition"
  };

  const isBook = detectBookSignals(parsed);
  assertTrue(isBook, 'Empty issue string should allow book detection');
});

// TEST 12: Comic with "edition" in title (false positive guard)
test('Comic with edition variant — has issue so NOT book', () => {
  const parsed = {
    title: "Batman Deluxe Edition",
    issue: "1",
    publisher: "DC",
    reason: "Variant edition comic"
  };

  const isBook = detectBookSignals(parsed);
  assertEqual(isBook, false, 'Comic with issue should NOT be book (issue check prevents false positive)');
});

// Run all tests
console.log('🧪 Book Detection Tests (Session 4B)\n');
console.log('='.repeat(60));

for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`✗ ${name}`);
    console.log(`  ${err.message}`);
    failed++;
  }
}

console.log('='.repeat(60));
console.log(`\n📊 Results: ${passed} passed, ${failed} failed, ${passed + failed} total\n`);

if (failed > 0) {
  process.exit(1);
}
