/**
 * Claude-gate CRITICAL/HIGH severity enforcement tests
 * Tests the fix for CRITICAL/HIGH flags falling through to WARNING ONLY
 */

import { computeDecision } from '../src/lib/decisionEngine.js';

const testCases = [
  {
    name: 'CRITICAL prefix - blocks pricing',
    input: {
      title: 'Marvel Team-Up',
      issue: '141',
      year: '1984',
      publisher: 'Marvel',
      price: 50,
      pricingSource: 'refused-claude-gate',
      claudeCheckBlocker: 'CRITICAL: MTU #141 is NOT the first appearance of Spider-Man\'s black costume - that\'s Secret Wars #8 (1984)',
      rawComps: { average: 45, count: 3 }
    },
    expected: {
      blockers: ['claude-check-critical'],
      action: 'DO_NOT_LIST',
      reasonContains: 'critical verification failure'
    }
  },
  {
    name: 'HIGH prefix - caps decision to LIST_LOW',
    input: {
      title: 'Amazing Spider-Man',
      issue: '300',
      year: '1988',
      publisher: 'Marvel',
      price: 150,
      pricingSource: 'pricecharting',
      claudeCheckHighSeverity: 'HIGH: Grade may be overstated by one full grade based on condition description',
      rawComps: { average: 140, count: 5 }
    },
    expected: {
      warnings: ['claude-check-high-severity'],
      action: 'RESEARCH',  // Critical warning escalates
      reasonContains: 'high-severity verification warning'
    }
  },
  {
    name: 'CRITICAL embedded mid-sentence',
    input: {
      title: 'Detective Comics',
      issue: '359',
      year: '1967',
      publisher: 'DC',
      price: 75,
      pricingSource: 'refused-claude-gate',
      claudeCheckBlocker: 'This is a CRITICAL: comp pool is for wrong era',
      rawComps: { average: 70, count: 2 }
    },
    expected: {
      blockers: ['claude-check-critical'],
      action: 'DO_NOT_LIST'
    }
  },
  {
    name: 'KEY ISSUE MISIDENTIFICATION prefix - blocks pricing',
    input: {
      title: 'Marvel Team-Up',
      issue: '141',
      year: '1984',
      publisher: 'Marvel',
      price: 50,
      pricingSource: 'refused-claude-gate',
      claudeCheckBlocker: 'KEY ISSUE MISIDENTIFICATION: Marvel Team-Up #141 is NOT the 1st appearance of Spider-Man\'s black costume - that\'s Secret Wars #8 (1984)',
      rawComps: { average: 45, count: 3 }
    },
    expected: {
      blockers: ['claude-check-critical'],
      action: 'DO_NOT_LIST',
      reasonContains: 'critical verification failure'
    }
  },
  {
    name: 'Existing wrong-issue pattern still fires',
    input: {
      title: 'X-Men',
      issue: '94',
      year: '1975',
      publisher: 'Marvel',
      price: null,
      pricingSource: 'refused-claude-gate',
      priceNote: 'Claude verification failed — wrong issue - comps are for #93 not #94',
      rawComps: { average: 200, count: 4 }
    },
    expected: {
      warnings: ['verification-failed-claude'],
      action: 'RESEARCH'
    }
  },
  {
    name: 'MEDIUM/LOW warning preserves current behavior',
    input: {
      title: 'Batman',
      issue: '423',
      year: '1988',
      publisher: 'DC',
      price: 20,
      pricingSource: 'pricecharting',
      claudeCheckWarning: 'Story description mentions different character',
      rawComps: { average: 18, count: 6 }
    },
    expected: {
      warnings: [],  // No new warnings added
      action: 'LIST_NOW',
      blockers: []
    }
  },
  {
    name: 'No prefix - WARNING ONLY behavior preserved',
    input: {
      title: 'Fantastic Four',
      issue: '52',
      year: '1966',
      publisher: 'Marvel',
      price: 500,
      pricingSource: 'pricecharting',
      claudeCheckWarning: 'Creators not listed in ComicVine data',
      rawComps: { average: 480, count: 3 }
    },
    expected: {
      warnings: [],  // No critical/high warnings
      action: 'LIST_NOW',
      blockers: []
    }
  },
  {
    name: 'KEY ISSUE MISMATCH - blocks pricing',
    input: {
      title: 'Marvel Team-Up',
      issue: '141',
      year: '1984',
      publisher: 'Marvel',
      price: null,
      pricingSource: 'refused-claude-gate',
      claudeCheckBlocker: 'KEY ISSUE MISMATCH: This is not the 1st appearance claimed in listings',
      rawComps: { average: 45, count: 3 }
    },
    expected: {
      blockers: ['claude-check-critical'],
      action: 'DO_NOT_LIST',
      reasonContains: 'critical verification failure'
    }
  },
  {
    name: 'KEY ISSUE MISLABELED - blocks pricing',
    input: {
      title: 'Marvel Team-Up',
      issue: '141',
      year: '1984',
      publisher: 'Marvel',
      price: null,
      pricingSource: 'refused-claude-gate',
      claudeCheckBlocker: 'KEY ISSUE MISLABELED: Sellers incorrectly label this as first black costume',
      rawComps: { average: 45, count: 3 }
    },
    expected: {
      blockers: ['claude-check-critical'],
      action: 'DO_NOT_LIST',
      reasonContains: 'critical verification failure'
    }
  },
  {
    name: 'CRITICAL flag with confidence=HIGH - blocks pricing',
    input: {
      title: 'Detective Comics',
      issue: '27',
      year: '2010',
      publisher: 'DC',
      price: null,
      pricingSource: 'refused-claude-gate',
      claudeCheckBlocker: 'CRITICAL: This is a reprint/facsimile, not the 1939 original',
      rawComps: { average: 25, count: 2 }
    },
    expected: {
      blockers: ['claude-check-critical'],
      action: 'DO_NOT_LIST',
      reasonContains: 'critical verification failure'
    }
  },
  {
    name: 'HIGH flag with confidence=HIGH - caps decision',
    input: {
      title: 'Amazing Spider-Man',
      issue: '252',
      year: '1984',
      publisher: 'Marvel',
      price: 200,
      pricingSource: 'pricecharting',
      claudeCheckHighSeverity: 'HIGH: Pricing may be inflated due to key issue contamination',
      rawComps: { average: 180, count: 4 }
    },
    expected: {
      warnings: ['claude-check-high-severity'],
      action: 'RESEARCH',
      reasonContains: 'high-severity verification warning'
    }
  },
  {
    name: 'MEDIUM/LOW no-prefix with confidence=HIGH - no blocker',
    input: {
      title: 'X-Men',
      issue: '101',
      year: '1976',
      publisher: 'Marvel',
      price: 75,
      pricingSource: 'pricecharting',
      claudeCheckWarning: 'Story description differs slightly from ComicVine',
      rawComps: { average: 70, count: 5 }
    },
    expected: {
      warnings: [],
      blockers: [],
      action: 'LIST_NOW'
    }
  }
];

console.log('🧪 Claude-gate CRITICAL/HIGH Severity Tests\n');
console.log('============================================================');

let passed = 0;
let failed = 0;

for (const test of testCases) {
  const decision = computeDecision(test.input);
  let testPassed = true;
  const errors = [];

  // Check blockers
  if (test.expected.blockers) {
    for (const blocker of test.expected.blockers) {
      if (!decision.blockers.includes(blocker)) {
        errors.push(`Missing blocker: ${blocker}`);
        testPassed = false;
      }
    }
  }

  // Check warnings
  if (test.expected.warnings) {
    for (const warning of test.expected.warnings) {
      if (!decision.warnings.includes(warning)) {
        errors.push(`Missing warning: ${warning}`);
        testPassed = false;
      }
    }
  }

  // Check action
  if (test.expected.action && decision.action !== test.expected.action) {
    errors.push(`Expected action=${test.expected.action}, got ${decision.action}`);
    testPassed = false;
  }

  // Check reason contains
  if (test.expected.reasonContains) {
    const reasonLower = (decision.reason || '').toLowerCase();
    const expectedLower = test.expected.reasonContains.toLowerCase();
    if (!reasonLower.includes(expectedLower)) {
      errors.push(`Reason should contain "${test.expected.reasonContains}"`);
      testPassed = false;
    }
  }

  if (testPassed) {
    console.log(`✓ ${test.name}`);
    passed++;
  } else {
    console.log(`✗ ${test.name}`);
    errors.forEach(err => console.log(`  ${err}`));
    console.log(`  Got: action=${decision.action}, blockers=[${decision.blockers.join(', ')}], warnings=[${decision.warnings.join(', ')}]`);
    failed++;
  }
}

console.log('============================================================\n');
console.log(`📊 Results: ${passed} passed, ${failed} failed, ${testCases.length} total\n`);

if (failed > 0) {
  process.exit(1);
}
