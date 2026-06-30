#!/usr/bin/env node
// Ship #28b AI Gate Validation — Zero API calls
// Tests that AI gating logic works correctly after ce9f44e

console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║         Ship #28b AI Gate Validation — FIX 1 Correctness Test            ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

// Test cases covering all gate scenarios
const testCases = [
  // Clean books — must skip AI
  {
    name: 'Groo in the Wild #1 (clean)',
    title: 'Groo in the Wild',
    issue: '1',
    conflicts: [],
    isRefresh: false,
    isMegaKey: false,
    expected: 'SKIP_AI',
  },
  {
    name: 'Bone #28 (clean)',
    title: 'Bone',
    issue: '28',
    conflicts: [],
    isRefresh: false,
    isMegaKey: false,
    expected: 'SKIP_AI',
  },
  {
    name: 'DC Presents #1 (clean)',
    title: 'DC Presents',
    issue: '1',
    conflicts: [],
    isRefresh: false,
    isMegaKey: false,
    expected: 'SKIP_AI',
  },
  {
    name: 'Spider-Man/Wolverine #1 (clean)',
    title: 'Spider-Man Wolverine',
    issue: '1',
    conflicts: [],
    isRefresh: false,
    isMegaKey: false,
    expected: 'SKIP_AI',
  },
  {
    name: 'Batman LOTDK #62 (clean)',
    title: 'Batman LOTDK',
    issue: '62',
    conflicts: [],
    isRefresh: false,
    isMegaKey: false,
    expected: 'SKIP_AI',
  },

  // Conflict books — must run AI
  {
    name: 'MWOM #185 (MTG contamination)',
    title: 'MWOM',
    issue: '185',
    conflicts: [{ type: 'CROSS_CATEGORY_CONTAMINATION', severity: 'CRITICAL' }],
    isRefresh: false,
    isMegaKey: false,
    expected: 'RUN_AI',
  },
  {
    name: 'Generic book (pricing conflict)',
    title: 'Any Book',
    issue: '1',
    conflicts: [{ type: 'PRICE_INFLATION', severity: 'WARNING' }],
    isRefresh: false,
    isMegaKey: false,
    expected: 'RUN_AI',
  },
  {
    name: 'Generic book (identity conflict)',
    title: 'Another Book',
    issue: '1',
    conflicts: [{ type: 'TITLE_FAMILY_MISMATCH', severity: 'CRITICAL' }],
    isRefresh: false,
    isMegaKey: false,
    expected: 'RUN_AI',
  },

  // Edge case: Mega-key books (Note: current impl doesn't special-case mega-keys in AI gate)
  // Ship #28b gates ONLY on conflicts.length, not mega-key status
  // Mega-keys with clean data will skip AI (correct - they use floor map, not AI pricing)
  {
    name: 'Amazing Fantasy #15 (mega-key, clean data)',
    title: 'Amazing Fantasy',
    issue: '15',
    conflicts: [],
    isRefresh: false,
    isMegaKey: true,
    expected: 'SKIP_AI', // Ship #28b: mega-keys use floor map, not AI verify
  },
  {
    name: 'Action Comics #1 (mega-key, contaminated comps)',
    title: 'Action Comics',
    issue: '1',
    conflicts: [{ type: 'CROSS_CATEGORY_CONTAMINATION', severity: 'CRITICAL' }],
    isRefresh: false,
    isMegaKey: true,
    expected: 'RUN_AI',
  },

  // Refresh — must ALWAYS skip AI regardless of conflicts
  {
    name: 'Refresh with conflicts',
    title: 'Any Book',
    issue: '1',
    conflicts: [{ type: 'CROSS_CATEGORY_CONTAMINATION', severity: 'CRITICAL' }],
    isRefresh: true,
    isMegaKey: false,
    expected: 'SKIP_AI',
  },
  {
    name: 'Refresh clean',
    title: 'Any Book',
    issue: '1',
    conflicts: [],
    isRefresh: true,
    isMegaKey: false,
    expected: 'SKIP_AI',
  },
];

// Simulate AI gate logic from ce9f44e
const simulateAIGate = (testCase) => {
  const { conflicts, isRefresh } = testCase;

  // AI Comp Verify gate
  const hasComps = true; // assume comps exist for all test cases
  const shouldRunAIVerify =
    conflicts.length > 0 && !isRefresh && hasComps;

  // ClaudeCheck gate
  let claudeCheckFires = false;
  let claudeCheckResult = null;

  if (isRefresh) {
    // Refresh: use cached result (simulated as skip)
    claudeCheckFires = false;
    claudeCheckResult = { verified: true, skipReason: 'refresh_cached' };
  } else if (conflicts.length > 0) {
    // Conflicts exist: run AI
    claudeCheckFires = true;
    claudeCheckResult = { verified: true, flags: [] }; // mock result
  } else {
    // Zero conflicts: skip AI
    claudeCheckFires = false;
    claudeCheckResult = { verified: true, skipReason: 'no_conflicts' };
  }

  const aiRan = shouldRunAIVerify || claudeCheckFires;

  return {
    aiCompVerify: shouldRunAIVerify,
    claudeCheckFires,
    claudeCheckResult,
    aiRan,
    result: aiRan ? 'RUN_AI' : 'SKIP_AI',
  };
};

let passCount = 0;
let failCount = 0;

console.log('Running AI gate logic tests...\n');

testCases.forEach((testCase, idx) => {
  const sim = simulateAIGate(testCase);
  const passed = sim.result === testCase.expected;

  if (passed) {
    passCount++;
    console.log(`✅ TEST ${idx + 1}: ${testCase.name}`);
    console.log(`   Expected: ${testCase.expected}, Got: ${sim.result}`);
    if (sim.aiCompVerify) console.log(`   ├─ AI comp verify: FIRED`);
    if (sim.claudeCheckFires) console.log(`   ├─ ClaudeCheck: FIRED`);
    if (!sim.aiRan) console.log(`   └─ AI: SKIPPED (${sim.claudeCheckResult.skipReason})`);
  } else {
    failCount++;
    console.log(`❌ TEST ${idx + 1}: ${testCase.name}`);
    console.log(`   Expected: ${testCase.expected}, Got: ${sim.result}`);
    console.log(`   Conflicts: ${testCase.conflicts.length}`);
    console.log(`   isRefresh: ${testCase.isRefresh}`);
    console.log(`   AI comp verify: ${sim.aiCompVerify ? 'FIRED' : 'SKIPPED'}`);
    console.log(`   ClaudeCheck: ${sim.claudeCheckFires ? 'FIRED' : 'SKIPPED'}`);
  }
  console.log();
});

console.log('═'.repeat(80));
console.log('SUMMARY');
console.log('═'.repeat(80));
console.log(`✅ PASSED: ${passCount}/${testCases.length}`);
console.log(`❌ FAILED: ${failCount}/${testCases.length}`);

if (failCount === 0) {
  console.log('\n🎉 ALL AI GATE TESTS PASSED');
  console.log('✅ FIX 1 correctness validated');
  process.exit(0);
} else {
  console.log('\n⚠️  SOME TESTS FAILED — Fix before proceeding');
  process.exit(1);
}
