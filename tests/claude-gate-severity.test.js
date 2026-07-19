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
      reasonContains: 'critical'
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
      reasonContains: 'high'
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
      reasonContains: 'key issue misidentification'
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
      reasonContains: 'key issue mismatch'
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
      reasonContains: 'key issue mislabeled'
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
      reasonContains: 'critical'
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
      reasonContains: 'high'
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
  },
  {
    name: 'Pattern M: Story-only CRITICAL + strong identity + active comps → downgrade to RESEARCH',
    input: {
      title: 'Batman Gotham Adventures',
      issue: '2',
      year: '1998',
      publisher: 'DC',
      price: 11,
      pricingSource: 'pricecharting',
      visionConfidence: 'high',
      claudeCheckHighSeverity: 'HIGH: Story content is Italian and references Detective Comics 2019 issues — does NOT match Batman: Gotham Adventures #2 1998',
      rawComps: { average: 9, count: 5 },
      soldCompDiagnostics: { verifiedCount: 2 }
    },
    expected: {
      warnings: ['claude-check-high-severity'],
      blockers: [],
      action: 'RESEARCH',
      reasonContains: 'high'
    }
  },
  {
    name: 'Pattern M: Story-only CRITICAL + verified sold comps ≥ 2 → downgrade to RESEARCH',
    input: {
      title: 'Infinity',
      issue: '1',
      year: '2013',
      publisher: 'Marvel',
      price: 10,
      pricingSource: 'pricecharting',
      visionConfidence: 'medium',
      claudeCheckHighSeverity: 'HIGH: Story description is for unrelated music industry conspiracy story, not Marvel Infinity',
      rawComps: { average: 8, count: 2 },
      soldCompDiagnostics: { verifiedCount: 3 }
    },
    expected: {
      warnings: ['claude-check-high-severity'],
      blockers: [],
      action: 'RESEARCH'
    }
  },
  {
    name: 'Pattern M: KEY ISSUE in CRITICAL stays hard block despite story language',
    input: {
      title: 'Marvel Team-Up',
      issue: '141',
      year: '1984',
      publisher: 'Marvel',
      price: null,
      pricingSource: 'refused-claude-gate',
      visionConfidence: 'high',
      claudeCheckBlocker: 'CRITICAL: MTU #141 is NOT the first appearance - KEY ISSUE misidentified',
      rawComps: { average: 45, count: 5 }
    },
    expected: {
      blockers: ['claude-check-critical'],
      action: 'DO_NOT_LIST',
      reasonContains: 'critical'
    }
  },
  {
    name: 'Pattern M: Story-only CRITICAL + weak identity → stays hard block',
    input: {
      title: 'Infinity',
      issue: '1',
      year: '2013',
      publisher: 'Marvel',
      price: null,
      pricingSource: 'refused-claude-gate',
      visionConfidence: 'low',
      claudeCheckBlocker: 'CRITICAL: Story description is for unrelated music industry conspiracy',
      rawComps: { average: 8, count: 2 },
      soldCompDiagnostics: { verifiedCount: 0 }
    },
    expected: {
      blockers: ['claude-check-critical'],
      action: 'DO_NOT_LIST'
    }
  },
  {
    name: 'Pattern M: Story-only CRITICAL + thin comps → stays hard block',
    input: {
      title: 'Obscure Comic',
      issue: '1',
      year: '2020',
      publisher: 'Indie',
      price: null,
      pricingSource: 'refused-claude-gate',
      visionConfidence: 'medium',
      claudeCheckBlocker: 'CRITICAL: Story metadata is wrong',
      rawComps: { average: 5, count: 2 },
      soldCompDiagnostics: { verifiedCount: 1 }
    },
    expected: {
      blockers: ['claude-check-critical'],
      action: 'DO_NOT_LIST'
    }
  },
  {
    name: 'Pattern M: Wrong issue CRITICAL → stays hard block',
    input: {
      title: 'X-Men',
      issue: '94',
      year: '1975',
      publisher: 'Marvel',
      price: null,
      pricingSource: 'refused-claude-gate',
      visionConfidence: 'high',
      claudeCheckBlocker: 'CRITICAL: Comps are for wrong issue #93 not #94',
      rawComps: { average: 200, count: 5 }
    },
    expected: {
      blockers: ['claude-check-critical'],
      action: 'DO_NOT_LIST'
    }
  },
  {
    name: 'Pattern M: Reprint CRITICAL → stays hard block',
    input: {
      title: 'Detective Comics',
      issue: '27',
      year: '2010',
      publisher: 'DC',
      price: null,
      pricingSource: 'refused-claude-gate',
      visionConfidence: 'high',
      claudeCheckBlocker: 'CRITICAL: This is a reprint/facsimile, not the 1939 original',
      rawComps: { average: 25, count: 5 }
    },
    expected: {
      blockers: ['claude-check-critical'],
      action: 'DO_NOT_LIST'
    }
  },
  {
    name: 'Pattern M: Chronological impossibility → stays hard block',
    input: {
      title: 'Marvel Team-Up',
      issue: '11',
      year: '1973',
      publisher: 'Marvel',
      price: null,
      pricingSource: 'refused-claude-gate',
      visionConfidence: 'medium',
      claudeCheckBlocker: 'CRITICAL: Venom appears in 1973 story - chronologically impossible',
      rawComps: { average: 30, count: 4 }
    },
    expected: {
      blockers: ['claude-check-critical'],
      action: 'DO_NOT_LIST'
    }
  },
  {
    name: 'No-comparable-sales phrase does not hard-block by itself',
    input: {
      title: 'Fantastic Four Artgerm Invisible Woman',
      issue: '1',
      year: '2024',
      publisher: 'Marvel',
      price: 12,
      pricingSource: 'pricecharting',
      claudeCheckWarning: 'No comparable sales data (0 comps) - pricing estimate is unreliable',
      rawComps: { average: 0, count: 0 },
      visionConfidence: 'medium'
    },
    expected: {
      warnings: [],  // No claude-check-critical from this phrase
      blockers: [],  // No blocker solely from no-comps phrase
      action: 'LIST_NOW'  // Price from PC ships, not hard-blocked
    }
  },
  {
    name: 'Zero comparable variants remain warning-only',
    input: {
      title: 'Test Comic',
      issue: '1',
      year: '2024',
      publisher: 'Marvel',
      price: 10,
      pricingSource: 'pricecharting',
      claudeCheckWarning: 'Zero comparable sales (0 comps)',
      rawComps: { average: 0, count: 0 }
    },
    expected: {
      warnings: [],
      blockers: [],
      action: 'LIST_NOW'  // Price from PC ships, not hard-blocked
    }
  },
  {
    name: 'Crossover with supporting comps downgrades to RESEARCH',
    input: {
      title: 'DC Marvel Superman Spider-Man Jorge Jimenez',
      issue: '1',
      year: '2026',
      publisher: 'DC',
      price: 26,
      pricingSource: 'pricecharting',
      claudeCheckHighSeverity: 'HIGH: Listing title mixes DC (Superman) and Marvel (Spider-Man) properties - verify crossover product',
      rawComps: { average: 22.49, count: 2 },
      soldCompDiagnostics: { verifiedCount: 1 },
      visionConfidence: 'medium'
    },
    expected: {
      warnings: ['claude-check-high-severity'],
      blockers: [],
      action: 'RESEARCH',
      reasonContains: 'high'
    }
  },
  {
    name: 'Crossover without supporting comps remains blocked',
    input: {
      title: 'DC Marvel Superman Spider-Man',
      issue: '1',
      year: '2026',
      publisher: 'DC',
      price: null,
      pricingSource: 'refused-claude-gate',
      claudeCheckBlocker: 'CRITICAL: Listing title mixes DC (Superman) and Marvel (Spider-Man) properties - factually impossible',
      rawComps: { average: 0, count: 0 }
    },
    expected: {
      blockers: ['claude-check-critical'],
      action: 'DO_NOT_LIST',
      reasonContains: 'critical'
    }
  },
  {
    name: 'Crossover with only 1 comp remains blocked (threshold not met)',
    input: {
      title: 'DC Marvel Superman Spider-Man',
      issue: '1',
      year: '2026',
      publisher: 'DC',
      price: null,
      pricingSource: 'refused-claude-gate',
      claudeCheckBlocker: 'CRITICAL: Listing title mixes DC (Superman) and Marvel (Spider-Man) properties - factually impossible',
      rawComps: { average: 20, count: 1 }
    },
    expected: {
      blockers: ['claude-check-critical'],
      action: 'DO_NOT_LIST',
      reasonContains: 'critical'
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
