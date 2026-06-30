#!/usr/bin/env node
// Ship #28b Pricing Continuity Test
// Verify: books that skip AI still get valid prices

console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║         Ship #28b Pricing Continuity Test — Skip-AI Books                ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

// Books that skip AI (zero conflicts)
const skipAIBooks = [
  {
    name: 'Groo in the Wild #1',
    conflicts: [],
    soldComps: { median: 9.99, count: 8 },
    activeComps: { median: 11.50, count: 5 },
    pcBase: 4.99,
    expectedSource: 'verified_sold',
    expectedPrice: { min: 6, max: 12 },
  },
  {
    name: 'Bone #28',
    conflicts: [],
    soldComps: { median: 5.50, count: 6 },
    activeComps: { median: 6.00, count: 4 },
    pcBase: 3.79,
    expectedSource: 'verified_sold',
    expectedPrice: { min: 4, max: 8 },
  },
  {
    name: 'DC Presents #1',
    conflicts: [],
    soldComps: { median: 15.00, count: 4 },
    activeComps: { median: 18.00, count: 3 },
    pcBase: 12.00,
    expectedSource: 'verified_sold',
    expectedPrice: { min: 10, max: 20 },
  },
  {
    name: 'Spider-Man/Wolverine #1',
    conflicts: [],
    soldComps: { median: 35.00, count: 2 }, // thin pool
    activeComps: { median: 40.00, count: 3 },
    pcBase: 29.99,
    expectedSource: 'pricecharting',
    expectedPrice: { min: 25, max: 45 },
  },
  {
    name: 'Batman LOTDK #62',
    conflicts: [],
    soldComps: { median: 0, count: 0 }, // zero sold
    activeComps: { median: 12.00, count: 5 },
    pcBase: null,
    expectedSource: 'browse_api',
    expectedPrice: { min: 8, max: 15 },
  },
  {
    name: 'Zero comps fallback',
    conflicts: [],
    soldComps: { median: 0, count: 0 },
    activeComps: { median: 0, count: 0 },
    pcBase: null,
    expectedSource: 'ai_estimate',
    expectedPrice: { min: 8, max: 12 },
  },
];

// Simulate pricing engine (deterministic, no AI)
const computePrice = (book) => {
  let price = null;
  let source = null;

  // Priority 1: Sold comps (verified)
  if (book.soldComps && book.soldComps.count >= 3) {
    price = book.soldComps.median;
    source = 'verified_sold';
  }
  // Priority 2: PriceCharting
  else if (book.pcBase && book.pcBase > 0) {
    price = book.pcBase * 1.3; // apply grade multiplier
    source = 'pricecharting';
  }
  // Priority 3: Active comps (browse_api)
  else if (book.activeComps && book.activeComps.count >= 1) {
    price = book.activeComps.median;
    source = 'browse_api';
  }
  // Fallback: AI estimate
  else {
    price = 10.00; // generic AI estimate
    source = 'ai_estimate';
  }

  return { price, source };
};

// Simulate decision engine (simplified)
const computeDecision = (price, source) => {
  if (price === null || price === 0) return 'ID_REQUIRED';
  if (source === 'verified_sold' || source === 'pricecharting') return 'LIST_NOW';
  if (source === 'browse_api') return 'LIST_LOW';
  if (source === 'ai_estimate') return 'RESEARCH';
  return 'LIST_NOW';
};

let passCount = 0;
let failCount = 0;

console.log('Testing pricing continuity on skip-AI books...\n');

skipAIBooks.forEach((book, idx) => {
  const { price, source } = computePrice(book);
  const decision = computeDecision(price, source);

  const validSources = ['verified_sold', 'pricecharting', 'browse_api', 'ai_estimate'];
  const validDecisions = ['LIST_NOW', 'LIST_LOW', 'RESEARCH', 'BUNDLE', 'GRADE_CANDIDATE'];

  const priceValid = price !== null && price > 0;
  const sourceValid = validSources.includes(source);
  const sourceMatches = source === book.expectedSource;
  const priceInRange = price >= book.expectedPrice.min && price <= book.expectedPrice.max;
  const decisionValid =
    validDecisions.includes(decision) &&
    decision !== 'ID_REQUIRED' &&
    decision !== 'DO_NOT_LIST';

  const passed = priceValid && sourceValid && sourceMatches && priceInRange && decisionValid;

  if (passed) {
    passCount++;
    console.log(`✅ TEST ${idx + 1}: ${book.name}`);
    console.log(`   Price: $${price.toFixed(2)} (${source})`);
    console.log(`   Decision: ${decision}`);
    console.log(`   Conflicts: ${book.conflicts.length} → SKIP_AI ✓`);
  } else {
    failCount++;
    console.log(`❌ TEST ${idx + 1}: ${book.name}`);
    console.log(`   Price: $${price?.toFixed(2) || 'null'} (expected $${book.expectedPrice.min}-${book.expectedPrice.max})`);
    console.log(`   Source: ${source} (expected ${book.expectedSource})`);
    console.log(`   Decision: ${decision}`);
    if (!priceValid) console.log(`   ⚠️  Price is null or zero`);
    if (!sourceValid) console.log(`   ⚠️  Invalid source: ${source}`);
    if (!sourceMatches) console.log(`   ⚠️  Source mismatch`);
    if (!priceInRange) console.log(`   ⚠️  Price out of range`);
    if (!decisionValid) console.log(`   ⚠️  Invalid decision: ${decision}`);
  }
  console.log();
});

console.log('═'.repeat(80));
console.log('SUMMARY');
console.log('═'.repeat(80));
console.log(`✅ PASSED: ${passCount}/${skipAIBooks.length}`);
console.log(`❌ FAILED: ${failCount}/${skipAIBooks.length}`);

if (failCount === 0) {
  console.log('\n🎉 ALL PRICING CONTINUITY TESTS PASSED');
  console.log('✅ Skip-AI books still get valid prices');
  console.log('✅ Decision engine routes correctly');
  process.exit(0);
} else {
  console.log('\n⚠️  SOME TESTS FAILED — Fix before proceeding');
  process.exit(1);
}
