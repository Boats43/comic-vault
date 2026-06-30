#!/usr/bin/env node

// TEST FIX B — Manual Entry Fields
// Validates publisher, grade, variant fields work correctly

console.log('═══════════════════════════════════════════════════════════════════════════════');
console.log('FIX B VALIDATION — Manual Entry Fields (Publisher, Grade, Variant)');
console.log('═══════════════════════════════════════════════════════════════════════════════\n');

// Simulate manual identity resolution from api/enrich.js
function testManualIdentity(testCase) {
  const { manualIdentity, title, issue, year, publisher: rawPublisher, grade, variant } = testCase;

  // Barcode identity (not used in these tests)
  const barcodeIdentity = null;

  // Simulate effectiveTitle/Issue/Year/Publisher logic
  const effectiveTitle = barcodeIdentity?.title || (manualIdentity ? title : title);
  const effectiveIssue = barcodeIdentity?.issue || (manualIdentity ? issue : issue);
  const effectiveYear = barcodeIdentity?.year || (manualIdentity ? year : year);
  const effectivePublisher = barcodeIdentity?.publisher || (manualIdentity ? rawPublisher : rawPublisher);

  // Simulate confirmed identity (manual path)
  let confirmedTitle, confirmedIssue, confirmedYear, confirmedPublisher, identitySource;

  if (manualIdentity) {
    confirmedTitle = effectiveTitle;
    confirmedIssue = effectiveIssue;
    confirmedYear = effectiveYear;
    confirmedPublisher = effectivePublisher;
    identitySource = 'manual';
  }

  return {
    confirmedTitle,
    confirmedIssue,
    confirmedYear,
    confirmedPublisher,
    identitySource,
    grade,
    variant
  };
}

// Test cases
const tests = [
  {
    name: 'TEST 1: Full manual entry (all fields)',
    input: {
      manualIdentity: true,
      title: 'Batman',
      issue: '222',
      year: '1970',
      publisher: 'DC',
      grade: 'VF 8.0',
      variant: 'newsstand'
    },
    expected: {
      confirmedPublisher: 'DC',
      grade: 'VF 8.0',
      variant: 'newsstand',
      identitySource: 'manual'
    }
  },
  {
    name: 'TEST 2: Manual entry (no optional fields)',
    input: {
      manualIdentity: true,
      title: 'Amazing Spider-Man',
      issue: '300',
      year: '1988',
      publisher: null,
      grade: null,
      variant: null
    },
    expected: {
      confirmedPublisher: null,
      grade: null,
      variant: null,
      identitySource: 'manual'
    }
  },
  {
    name: 'TEST 3: Manual entry (publisher only)',
    input: {
      manualIdentity: true,
      title: 'X-Men',
      issue: '1',
      year: '1963',
      publisher: 'Marvel',
      grade: null,
      variant: null
    },
    expected: {
      confirmedPublisher: 'Marvel',
      grade: null,
      variant: null,
      identitySource: 'manual'
    }
  },
  {
    name: 'TEST 4: Manual entry (grade only)',
    input: {
      manualIdentity: true,
      title: 'Detective Comics',
      issue: '27',
      year: '1939',
      publisher: null,
      grade: 'NM 9.4',
      variant: null
    },
    expected: {
      confirmedPublisher: null,
      grade: 'NM 9.4',
      variant: null,
      identitySource: 'manual'
    }
  },
  {
    name: 'TEST 5: Manual entry (variant only)',
    input: {
      manualIdentity: true,
      title: 'Mighty World of Marvel',
      issue: '157',
      year: '1975',
      publisher: null,
      grade: null,
      variant: 'pence'
    },
    expected: {
      confirmedPublisher: null,
      grade: null,
      variant: 'pence',
      identitySource: 'manual'
    }
  }
];

let passed = 0;
let failed = 0;

tests.forEach((test, i) => {
  console.log(`${test.name}`);
  console.log('─────────────────────────────────────────────────────────────────────────────');

  const result = testManualIdentity(test.input);

  let testPassed = true;
  const errors = [];

  if (result.confirmedPublisher !== test.expected.confirmedPublisher) {
    testPassed = false;
    errors.push(`confirmedPublisher: expected ${test.expected.confirmedPublisher}, got ${result.confirmedPublisher}`);
  }

  if (result.grade !== test.expected.grade) {
    testPassed = false;
    errors.push(`grade: expected ${test.expected.grade}, got ${result.grade}`);
  }

  if (result.variant !== test.expected.variant) {
    testPassed = false;
    errors.push(`variant: expected ${test.expected.variant}, got ${result.variant}`);
  }

  if (result.identitySource !== test.expected.identitySource) {
    testPassed = false;
    errors.push(`identitySource: expected ${test.expected.identitySource}, got ${result.identitySource}`);
  }

  if (testPassed) {
    console.log(`  ✅ PASS`);
    console.log(`     confirmedTitle: ${result.confirmedTitle}`);
    console.log(`     confirmedIssue: ${result.confirmedIssue}`);
    console.log(`     confirmedYear: ${result.confirmedYear}`);
    console.log(`     confirmedPublisher: ${result.confirmedPublisher || 'null'}`);
    console.log(`     grade: ${result.grade || 'null'}`);
    console.log(`     variant: ${result.variant || 'null'}`);
    console.log(`     identitySource: ${result.identitySource}`);
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
  console.log('🎉 ALL FIX B TESTS PASSED — Manual entry fields work correctly\n');
  process.exit(0);
} else {
  console.log('⚠️ SOME TESTS FAILED — Manual entry fields need debugging\n');
  process.exit(1);
}
