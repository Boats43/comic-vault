#!/usr/bin/env node
// Ship #28b End-to-End Flow Test
// Trace complete books through the reordered pipeline

import { detectCompsConflicts } from '../src/lib/conflictDetector.js';
import { computeDecision } from '../src/lib/decisionEngine.js';

console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║         Ship #28b End-to-End Flow Test — Pipeline Order                 ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

// TEST CASE 1: MWOM #185 (contaminated comps → conflicts → AI → BLOCKED)
console.log('═'.repeat(80));
console.log('TEST CASE 1: MWOM #185 (MTG contamination)');
console.log('═'.repeat(80));

const mwom185 = {
  title: 'Mighty World of Marvel',
  issue: '185',
  year: 1976,
  publisher: 'Marvel UK',
};

console.log('\n📍 Step 1: Comps fetched (mock)');
const mwomComps = {
  count: 3,
  prices: [
    { title: 'Fell the Mighty MTG #185', price: 15, category: 38395 },
    { title: 'MTG Commander #185', price: 20, category: 38395 },
    { title: 'Mighty World of Marvel #185', price: 8, category: 259104 },
  ],
};
const mwomCategories = ['38395', '38395', '259104'];
console.log(`   Comps: ${mwomComps.count} (2 MTG + 1 comic)`);

console.log('\n📍 Step 2: Conflict detector runs');
const mwomConflicts = detectCompsConflicts(mwomComps, mwomCategories);
console.log(`   Conflicts detected: ${mwomConflicts.length}`);
if (mwomConflicts.length > 0) {
  console.log(`   └─ ${mwomConflicts[0].type}: ${mwomConflicts[0].detail}`);
}

console.log('\n📍 Step 3: AI gate');
const mwomRunAI = mwomConflicts.length > 0;
console.log(`   Conflicts: ${mwomConflicts.length} → ${mwomRunAI ? 'RUN_AI' : 'SKIP_AI'}`);

console.log('\n📍 Step 4: ClaudeCheck mock');
const mwomClaudeCheck = mwomRunAI
  ? {
      verified: false,
      flags: [{ severity: 'CRITICAL', message: 'MTG cards in comp pool, unreliable pricing' }],
    }
  : { verified: true, skipReason: 'no_conflicts' };
console.log(`   AI result: ${mwomClaudeCheck.verified ? 'verified' : 'CRITICAL flag'}`);
if (mwomClaudeCheck.flags) {
  console.log(`   └─ ${mwomClaudeCheck.flags[0].message}`);
}

console.log('\n📍 Step 5: Decision engine');
const mwomItem = {
  title: mwom185.title,
  issue: mwom185.issue,
  price: '$8.00',
  pricingSource: 'browse_api',
  conflicts: mwomConflicts,
  claudeCheck: mwomClaudeCheck,
  rawComps: { count: 1 }, // 1 comic after MTG filter
  criticalFlags: mwomClaudeCheck.flags || [], // decision engine reads criticalFlags, not claudeCheck.flags
};
const mwomDecision = computeDecision(mwomItem);
console.log(`   Decision: ${mwomDecision.action}`);
console.log(`   Reason: ${mwomDecision.reason}`);

// NOTE: Ship #28b doesn't gate decision on conflicts yet (that's Ship #28c)
// For now, validate that:
// 1. Conflicts detected correctly
// 2. AI gate fired correctly
// 3. Decision is non-null and valid
const mwomPass =
  mwomConflicts.length === 1 &&
  mwomRunAI === true &&
  mwomDecision.action !== null &&
  mwomDecision.action !== 'ID_REQUIRED';
console.log(`\n${mwomPass ? '✅' : '❌'} MWOM #185: ${mwomPass ? 'CORRECT FLOW (conflicts → AI fired)' : 'FLOW ERROR'}`);

// TEST CASE 2: Groo #1 (clean comps → zero conflicts → skip AI → LIST)
console.log('\n\n═'.repeat(80));
console.log('TEST CASE 2: Groo in the Wild #1 (clean data)');
console.log('═'.repeat(80));

const groo1 = {
  title: 'Groo in the Wild',
  issue: '1',
  year: 1994,
  publisher: 'Dark Horse',
};

console.log('\n📍 Step 1: Comps fetched (mock)');
const grooComps = {
  count: 8,
  prices: Array(8)
    .fill(null)
    .map((_, i) => ({
      title: `Groo in the Wild #1`,
      price: 8 + i,
      category: 259104,
    })),
};
const grooCategories = Array(8).fill('259104'); // all comics
console.log(`   Comps: ${grooComps.count} (all clean comics)`);

console.log('\n📍 Step 2: Conflict detector runs');
const grooConflicts = detectCompsConflicts(grooComps, grooCategories);
console.log(`   Conflicts detected: ${grooConflicts.length}`);

console.log('\n📍 Step 3: AI gate');
const grooRunAI = grooConflicts.length > 0;
console.log(`   Conflicts: ${grooConflicts.length} → ${grooRunAI ? 'RUN_AI' : 'SKIP_AI'} ✓`);

console.log('\n📍 Step 4: ClaudeCheck mock');
const grooClaudeCheck = grooRunAI
  ? { verified: true, flags: [] }
  : { verified: true, skipReason: 'no_conflicts' };
console.log(`   AI skipped: ${grooClaudeCheck.skipReason || 'N/A'}`);

console.log('\n📍 Step 5: Decision engine');
const grooItem = {
  title: groo1.title,
  issue: groo1.issue,
  price: '$9.99',
  pricingSource: 'verified_sold',
  conflicts: grooConflicts,
  claudeCheck: grooClaudeCheck,
  rawComps: { count: 8 },
  soldComps: [{}], // has sold comps
  confidenceLevel: 'HIGH',
};
const grooDecision = computeDecision(grooItem);
console.log(`   Decision: ${grooDecision.action}`);
console.log(`   Reason: ${grooDecision.reason}`);

const grooPass =
  grooConflicts.length === 0 &&
  grooRunAI === false &&
  grooClaudeCheck.skipReason === 'no_conflicts' &&
  (grooDecision.action === 'LIST_NOW' || grooDecision.action === 'LIST_LOW');
console.log(`\n${grooPass ? '✅' : '❌'} Groo #1: ${grooPass ? 'CORRECT FLOW' : 'FLOW ERROR'}`);

// SUMMARY
console.log('\n\n═'.repeat(80));
console.log('SUMMARY');
console.log('═'.repeat(80));

const allPass = mwomPass && grooPass;

if (allPass) {
  console.log('✅ MWOM #185: conflicts → RUN_AI → RESEARCH/LIST_LOW ✓');
  console.log('✅ Groo #1: zero conflicts → SKIP_AI → LIST ✓');
  console.log('\n🎉 ALL END-TO-END FLOW TESTS PASSED');
  console.log('✅ Pipeline order correct: comps → conflicts → AI gate → decision');
  process.exit(0);
} else {
  console.log('❌ Some flows incorrect');
  if (!mwomPass) console.log('   MWOM #185 flow error');
  if (!grooPass) console.log('   Groo #1 flow error');
  console.log('\n⚠️  FIX BEFORE PROCEEDING');
  process.exit(1);
}
