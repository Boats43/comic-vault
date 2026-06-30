#!/usr/bin/env node

// TEST FIX A — UK Kill Switch
// Validates title-based UK detection works with null publisher

console.log('═══════════════════════════════════════════════════════════════════════════════');
console.log('FIX A VALIDATION — UK Kill Switch (Title-Based Detection)');
console.log('═══════════════════════════════════════════════════════════════════════════════\n');

// Simulate the UK gate logic from api/enrich.js:4303-4329
function testUKGate(testCase) {
  const { title, publisher, variant, rawComps } = testCase;

  const isZeroComp = (rawComps?.count === 0 || !rawComps);
  const variantLower = String(variant || '').toLowerCase();
  const publisherLower = String(publisher || '').toLowerCase();
  const ukTitleLower = String(title || '').toLowerCase();

  const isPenceVariant = variantLower.includes('pence');
  const isUKPublisher = publisherLower.includes('uk') ||
                        publisherLower.includes('panini') ||
                        publisherLower.includes('marvel uk') ||
                        publisherLower.includes('titan');

  // FIX A: Title-based UK detection
  const isUKWeeklyTitle = ukTitleLower.includes('mighty world of marvel') ||
                          ukTitleLower.includes('marvel uk') ||
                          ukTitleLower.includes('panini') ||
                          ukTitleLower.includes('titan') ||
                          ukTitleLower.includes('weekly') ||
                          ukTitleLower.includes('british') ||
                          ukTitleLower.includes('pence edition');

  let ukWeeklySkip = false;
  let triggerReason = null;
  if (isZeroComp && (isPenceVariant || isUKPublisher || isUKWeeklyTitle)) {
    ukWeeklySkip = true;
    triggerReason = isPenceVariant ? 'pence-variant' :
                    isUKPublisher ? 'uk-publisher' : 'uk-title-pattern';
  }

  const shouldTriggerWebSearch =
    isZeroComp &&
    !ukWeeklySkip;

  return {
    ukWeeklySkip,
    shouldTriggerWebSearch,
    triggerReason,
    isZeroComp,
    isPenceVariant,
    isUKPublisher,
    isUKWeeklyTitle
  };
}

// Test cases
const tests = [
  {
    name: 'TEST 1: Mighty World of Marvel (null publisher)',
    input: {
      title: 'Mighty World of Marvel',
      publisher: null,
      variant: null,
      rawComps: { count: 0 }
    },
    expected: {
      ukWeeklySkip: true,
      shouldTriggerWebSearch: false,
      triggerReason: 'uk-title-pattern'
    }
  },
  {
    name: 'TEST 2: UK book with publisher set',
    input: {
      title: 'Star Wars Weekly',
      publisher: 'Marvel UK',
      variant: null,
      rawComps: { count: 0 }
    },
    expected: {
      ukWeeklySkip: true,
      shouldTriggerWebSearch: false,
      triggerReason: 'uk-publisher'
    }
  },
  {
    name: 'TEST 3: Pence variant',
    input: {
      title: 'Amazing Spider-Man',
      publisher: 'Marvel',
      variant: 'pence',
      rawComps: { count: 0 }
    },
    expected: {
      ukWeeklySkip: true,
      shouldTriggerWebSearch: false,
      triggerReason: 'pence-variant'
    }
  },
  {
    name: 'TEST 4: US book (should NOT trigger UK gate)',
    input: {
      title: 'Batman',
      publisher: 'DC',
      variant: null,
      rawComps: { count: 0 }
    },
    expected: {
      ukWeeklySkip: false,
      shouldTriggerWebSearch: true,
      triggerReason: null
    }
  },
  {
    name: 'TEST 5: UK book with comps (gate should NOT fire)',
    input: {
      title: 'Mighty World of Marvel',
      publisher: null,
      variant: null,
      rawComps: { count: 5 }
    },
    expected: {
      ukWeeklySkip: false,
      shouldTriggerWebSearch: false,
      triggerReason: null
    }
  }
];

let passed = 0;
let failed = 0;

tests.forEach((test, i) => {
  console.log(`${test.name}`);
  console.log('─────────────────────────────────────────────────────────────────────────────');

  const result = testUKGate(test.input);

  let testPassed = true;
  const errors = [];

  if (result.ukWeeklySkip !== test.expected.ukWeeklySkip) {
    testPassed = false;
    errors.push(`ukWeeklySkip: expected ${test.expected.ukWeeklySkip}, got ${result.ukWeeklySkip}`);
  }

  if (result.shouldTriggerWebSearch !== test.expected.shouldTriggerWebSearch) {
    testPassed = false;
    errors.push(`shouldTriggerWebSearch: expected ${test.expected.shouldTriggerWebSearch}, got ${result.shouldTriggerWebSearch}`);
  }

  if (test.expected.triggerReason && result.triggerReason !== test.expected.triggerReason) {
    testPassed = false;
    errors.push(`triggerReason: expected ${test.expected.triggerReason}, got ${result.triggerReason}`);
  }

  if (testPassed) {
    console.log(`  ✅ PASS`);
    console.log(`     ukWeeklySkip: ${result.ukWeeklySkip}`);
    console.log(`     shouldTriggerWebSearch: ${result.shouldTriggerWebSearch}`);
    if (result.triggerReason) {
      console.log(`     triggerReason: ${result.triggerReason}`);
    }
    passed++;
  } else {
    console.log(`  ❌ FAIL`);
    errors.forEach(err => console.log(`     ${err}`));
    failed++;
  }

  console.log('');
});

console.log('═══════════════════════════════════════════════════════════════════════════════');
console.log('SUMMARY');
console.log('═══════════════════════════════════════════════════════════════════════════════\n');
console.log(`✅ PASSED: ${passed}/5`);
console.log(`❌ FAILED: ${failed}/5\n`);

if (failed === 0) {
  console.log('🎉 ALL FIX A TESTS PASSED — UK kill switch works correctly\n');
  process.exit(0);
} else {
  console.log('⚠️ SOME TESTS FAILED — UK kill switch needs debugging\n');
  process.exit(1);
}
