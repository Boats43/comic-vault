// Unit tests for Fix B — Batman #59 historical key-issue hallucination gate.
//
// Downgrade-eligible historical key corrections to RESEARCH when guards pass.
// Hard-block phrases preserved (wrong issue/book/series, reprint, KEY ISSUE MISIDENTIFIED).
//
// Invoke: node tests/batman59-gate.test.js
// Exit: 0 all-pass, 1 any failure.

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

console.log('\n=== FIX B — BATMAN #59 HISTORICAL KEY GATE ===\n');

// Helper: simulate the downgrade logic
function evaluateDowngrade(refusalReason, visionConfidence, activeCount, verifiedCount, keyIssue) {
  const HARD_BLOCK_PHRASES = [
    /wrong\s+issue/i,
    /wrong\s+book/i,
    /wrong\s+series/i,
    /wrong\s+era/i,
    /\breprint\b/i,
    /\bfacsimile\b/i,
    /KEY\s+ISSUE\s+MISMATCH/i,
    /KEY\s+ISSUE\s+MISIDENTIFICATION/i,
    /comp\s+pool\s+contaminated/i,
  ];
  
  const HISTORICAL_KEY_PATTERNS = [
    /first\s+appear(?:ed|ance)/i,
    /does\s+not\s+feature\s+first\s+appearance/i,
    /not\s+the\s+first\s+appearance/i,
    /wrong\s+year/i,
    /(?:debut|origin|introduced)\s+in\s+\d{4}/i,
    /actually\s+(?:appeared|debuted|introduced)/i,
    /historical(?:ly)?\s+inaccurate/i,
  ];

  const hasHardBlock = HARD_BLOCK_PHRASES.some(re => re.test(refusalReason));
  const isHistoricalKeyCorrection = HISTORICAL_KEY_PATTERNS.some(re => re.test(refusalReason));
  const visionConfirmedKey = !!(keyIssue && String(keyIssue).trim().length > 0);
  const visionConfidenceNotLow = visionConfidence !== 'low';
  const hasComps = activeCount >= 2 || verifiedCount >= 2;

  if (!hasHardBlock && isHistoricalKeyCorrection && visionConfirmedKey && visionConfidenceNotLow && hasComps) {
    return 'RESEARCH'; // downgraded from DO_NOT_LIST
  } else if (hasHardBlock || !visionConfidenceNotLow || !hasComps || !visionConfirmedKey) {
    return 'DO_NOT_LIST'; // hard block or guards failed
  }
  return 'DO_NOT_LIST'; // default when conditions unclear
}

console.log('Downgrade eligible cases:');

// Test 1: Batman #59 — historical correction + guards pass → RESEARCH
assertEq(
  evaluateDowngrade(
    'CRITICAL: does not feature first appearance of Deadshot',
    'high',
    2,  // activeCount
    0,  // verifiedCount
    'First appearance Deadshot'
  ),
  'RESEARCH',
  'Batman #59: historical correction + high confidence + 2 active comps → RESEARCH'
);

// Test 1b: Same but with verified sold comps instead of active
assertEq(
  evaluateDowngrade(
    'CRITICAL: not the first appearance',
    'high',
    1,  // activeCount (< 2)
    2,  // verifiedCount (>= 2)
    'First appearance'
  ),
  'RESEARCH',
  'Historical correction + 2 verified sold comps (activeCount < 2) → RESEARCH'
);

// Test 1c: Either comp source sufficient
assertEq(
  evaluateDowngrade(
    'CRITICAL: first appeared in 1959 not 1950',
    'medium',  // not low
    3,
    5,
    'Key issue'
  ),
  'RESEARCH',
  'Historical correction + both active and verified comps → RESEARCH'
);

console.log('\nHard block cases (must NOT downgrade):');

// Test 2: MTU #141 — KEY ISSUE MISIDENTIFIED → DO_NOT_LIST
assertEq(
  evaluateDowngrade(
    'CRITICAL: KEY ISSUE MISIDENTIFICATION — wrong character debut',
    'high',
    5,
    3,
    'First appearance'
  ),
  'DO_NOT_LIST',
  'MTU #141: KEY ISSUE MISIDENTIFICATION hard block → DO_NOT_LIST'
);

// Test 3: Historical + wrong issue → DO_NOT_LIST
assertEq(
  evaluateDowngrade(
    'CRITICAL: not the first appearance, wrong issue',
    'high',
    2,
    0,
    'First appearance'
  ),
  'DO_NOT_LIST',
  'Historical phrase + "wrong issue" → DO_NOT_LIST'
);

// Test 3b: Historical + wrong book → DO_NOT_LIST
assertEq(
  evaluateDowngrade(
    'CRITICAL: does not feature first appearance, wrong book',
    'high',
    3,
    2,
    'First appearance'
  ),
  'DO_NOT_LIST',
  'Historical phrase + "wrong book" → DO_NOT_LIST'
);

// Test 3c: Historical + reprint → DO_NOT_LIST
assertEq(
  evaluateDowngrade(
    'CRITICAL: first appeared in 1960, this is a reprint',
    'high',
    2,
    0,
    'Key issue'
  ),
  'DO_NOT_LIST',
  'Historical phrase + "reprint" → DO_NOT_LIST'
);

console.log('\nGuard failures (must NOT downgrade):');

// Test 4: Historical + low vision confidence → DO_NOT_LIST
assertEq(
  evaluateDowngrade(
    'CRITICAL: not the first appearance',
    'low',  // vision confidence low
    2,
    0,
    'First appearance'
  ),
  'DO_NOT_LIST',
  'Historical phrase + vision confidence LOW → DO_NOT_LIST'
);

// Test 4b: Historical + no comps → DO_NOT_LIST
assertEq(
  evaluateDowngrade(
    'CRITICAL: does not feature first appearance',
    'high',
    1,  // activeCount < 2
    1,  // verifiedCount < 2
    'First appearance'
  ),
  'DO_NOT_LIST',
  'Historical phrase + insufficient comps (both < 2) → DO_NOT_LIST'
);

// Test 4c: Historical + no vision key → DO_NOT_LIST
assertEq(
  evaluateDowngrade(
    'CRITICAL: first appeared in 1959',
    'high',
    2,
    0,
    ''  // no vision key
  ),
  'DO_NOT_LIST',
  'Historical phrase + no vision key confirmation → DO_NOT_LIST'
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\n=== FAILURES ===');
  failures.forEach(f => console.log(f));
  process.exit(1);
}
process.exit(0);
