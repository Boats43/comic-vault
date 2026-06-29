#!/usr/bin/env node

// SPEED TEST — DETERMINISTIC LAYER ONLY
// Measures all logic that runs WITHOUT AI/Anthropic calls.
// Proves the deterministic engine is fast before spending on AI.

import { detectIdentityConflicts, detectPricingConflicts, detectCompsConflicts } from '../src/lib/conflictDetector.js';
import { computeRecencyWeightedPrice } from '../src/lib/pricingEngine.js';
import { computeDecision } from '../src/lib/decisionEngine.js';
import { detectAutoKey } from '../src/lib/autoKeyDetector.js';

// Timing utility
const time = (label, fn) => {
  const start = performance.now();
  const result = fn();
  const elapsed = performance.now() - start;
  return { result, elapsed, label };
};

const timeAsync = async (label, fn) => {
  const start = performance.now();
  const result = await fn();
  const elapsed = performance.now() - start;
  return { result, elapsed, label };
};

// Mock data generators
const mockVisionData = (title, issue, year, publisher) => ({
  title, issue, year, publisher
});

const mockVisualConsensus = (title, issue, agreement = 0.85) => ({
  title,
  issue,
  year: null,
  publisher: null,
  confidence: agreement,
  agreement: { total: 10, title: 8, issue: 9, year: 0, publisher: 0 }
});

const mockComicVine = (hasFirstAppearance = false) => ({
  description: "A classic comic book story",
  volume: { publisher: { name: "Marvel Comics" } },
  firstAppearanceCharacters: hasFirstAppearance ? ["Spider-Man", "Green Goblin"] : [],
  characterCredits: hasFirstAppearance ? ["Spider-Man", "Green Goblin", "Aunt May"] : ["Batman", "Robin"],
  personCredits: [
    { name: "Stan Lee", role: "writer" },
    { name: "Steve Ditko", role: "artist" }
  ]
});

const mockSoldComps = (count = 10, avgPrice = 50) => {
  const comps = [];
  for (let i = 0; i < count; i++) {
    const daysAgo = Math.floor(Math.random() * 120); // 0-120 days
    const priceVariation = (Math.random() - 0.5) * 20; // ±$10 variation
    comps.push({
      price: avgPrice + priceVariation,
      daysAgo,
      date: new Date(Date.now() - daysAgo * 86400000).toISOString(),
      title: "Amazing Spider-Man #1",
      grade: "9.4",
      marketplace: "ebay"
    });
  }
  return comps;
};

const mockRawComps = (count = 15, avgPrice = 45) => ({
  count,
  average: avgPrice,
  lowest: avgPrice * 0.7,
  highest: avgPrice * 1.3,
  prices: Array.from({ length: count }, (_, i) => ({
    price: avgPrice + (Math.random() - 0.5) * 20,
    title: "Amazing Spider-Man #1 CGC 9.4"
  }))
});

const mockEnrichItem = (overrides = {}) => ({
  title: "Amazing Spider-Man",
  issue: "1",
  year: "1963",
  publisher: "Marvel Comics",
  grade: "VF",
  isGraded: false,
  price: 150,
  identityComplete: true,
  identityConfident: true,
  rawComps: mockRawComps(),
  soldComps: mockSoldComps(),
  soldCompDiagnostics: {
    rawCount: 10,
    verifiedCount: 8,
    rejectedCount: 2
  },
  pricingSource: 'browse_api',
  confidenceLevel: 'HIGH',
  autoDetectedKey: true,
  keyCharacters: ["Spider-Man"],
  goCollect: {
    velocity: 'HIGH',
    trend: 'UP',
    daysToSell: 14
  },
  ...overrides
});

// Test books (6 vault books from test-deterministic.mjs)
const vaultBooks = [
  { title: "Amazing Spider-Man", issue: "1", year: "1963", publisher: "Marvel Comics", hasKey: true },
  { title: "Batman", issue: "1", year: "1940", publisher: "DC Comics", hasKey: true },
  { title: "X-Men", issue: "1", year: "1963", publisher: "Marvel Comics", hasKey: true },
  { title: "Fantastic Four", issue: "1", year: "1961", publisher: "Marvel Comics", hasKey: true },
  { title: "Groo", issue: "1", year: "1982", publisher: "Pacific", hasKey: false },
  { title: "Saga", issue: "1", year: "2012", publisher: "Image", hasKey: false }
];

console.log('═══════════════════════════════════════════════════════════════════════════════');
console.log('SPEED TEST — DETERMINISTIC LAYER (NO AI)');
console.log('═══════════════════════════════════════════════════════════════════════════════\n');

// TEST 1: CONFLICT DETECTOR SPEED
console.log('TEST 1: CONFLICT DETECTOR SPEED');
console.log('─────────────────────────────────────────────────────────────────────────────');

let conflictTimes = [];
for (const book of vaultBooks) {
  const vision = mockVisionData(book.title, book.issue, book.year, book.publisher);
  const visualConsensus = mockVisualConsensus(book.title, book.issue);

  const { elapsed } = time('identityConflicts', () =>
    detectIdentityConflicts(vision, visualConsensus, null, null)
  );

  conflictTimes.push(elapsed);
  console.log(`  ${book.title} #${book.issue}: ${elapsed.toFixed(2)}ms`);
}

const avgConflictTime = conflictTimes.reduce((a, b) => a + b, 0) / conflictTimes.length;
console.log(`\n  ✓ Average: ${avgConflictTime.toFixed(2)}ms per book`);
console.log(`  ✓ Total: ${conflictTimes.reduce((a, b) => a + b, 0).toFixed(2)}ms for 6 books\n`);

// TEST 2: PRICING ENGINE SPEED
console.log('TEST 2: PRICING ENGINE SPEED (Recency Weighting)');
console.log('─────────────────────────────────────────────────────────────────────────────');

const soldComps = mockSoldComps(20, 50);
const { elapsed: pricingTime, result: weightedResult } = time('recencyWeighting', () =>
  computeRecencyWeightedPrice(soldComps)
);

console.log(`  Comps: 20 sold comps (0-120 days old)`);
console.log(`  Weighted avg: $${weightedResult.price?.toFixed(2) || 'N/A'}`);
console.log(`  Most recent: ${weightedResult.recencyDays}d`);
console.log(`  Distribution: fresh:${weightedResult.weights.fresh} recent:${weightedResult.weights.recent} stale:${weightedResult.weights.stale}`);
console.log(`  ✓ Time: ${pricingTime.toFixed(2)}ms\n`);

// TEST 3: DECISION ENGINE SPEED
console.log('TEST 3: DECISION ENGINE SPEED (Velocity + Auto Key)');
console.log('─────────────────────────────────────────────────────────────────────────────');

let decisionTimes = [];
for (const book of vaultBooks) {
  const item = mockEnrichItem({
    title: book.title,
    issue: book.issue,
    year: book.year,
    publisher: book.publisher,
    autoDetectedKey: book.hasKey,
    keyCharacters: book.hasKey ? [book.title] : []
  });

  const { elapsed, result } = time('decision', () => computeDecision(item));
  decisionTimes.push(elapsed);

  console.log(`  ${book.title} #${book.issue}:`);
  console.log(`    Action: ${result.action}, Confidence: ${result.confidence}`);
  console.log(`    Time: ${elapsed.toFixed(2)}ms`);
}

const avgDecisionTime = decisionTimes.reduce((a, b) => a + b, 0) / decisionTimes.length;
console.log(`\n  ✓ Average: ${avgDecisionTime.toFixed(2)}ms per book`);
console.log(`  ✓ Total: ${decisionTimes.reduce((a, b) => a + b, 0).toFixed(2)}ms for 6 books\n`);

// TEST 4: AUTO KEY DETECTION SPEED
console.log('TEST 4: AUTO KEY DETECTION SPEED');
console.log('─────────────────────────────────────────────────────────────────────────────');

let keyDetectTimes = [];
for (const book of vaultBooks) {
  const cv = mockComicVine(book.hasKey);
  const { elapsed, result } = time('autoKey', () => detectAutoKey(cv));
  keyDetectTimes.push(elapsed);

  console.log(`  ${book.title} #${book.issue}: ${elapsed.toFixed(2)}ms (isKey: ${result.isKey})`);
}

const avgKeyTime = keyDetectTimes.reduce((a, b) => a + b, 0) / keyDetectTimes.length;
console.log(`\n  ✓ Average: ${avgKeyTime.toFixed(2)}ms per book\n`);

// TEST 5: KV CACHE SPEED (if env vars present)
console.log('TEST 5: KV CACHE SPEED');
console.log('─────────────────────────────────────────────────────────────────────────────');

let kvAvailable = false;
let kvSetTime = null;
let kvGetHitTime = null;
let kvGetMissTime = null;

try {
  // Try to import KV (will fail if not available)
  const kvModule = await import('@upstash/redis');
  const redis = kvModule.Redis.fromEnv();

  kvAvailable = true;
  const testKey = `speed-test:${Date.now()}`;
  const testValue = { title: "Test Book", price: 100 };

  // Test SET
  const { elapsed: setTime } = await timeAsync('kvSet', async () => {
    await redis.set(testKey, testValue, { ex: 60 });
  });
  kvSetTime = setTime;

  // Test GET (HIT)
  const { elapsed: hitTime } = await timeAsync('kvGetHit', async () => {
    await redis.get(testKey);
  });
  kvGetHitTime = hitTime;

  // Test GET (MISS)
  const { elapsed: missTime } = await timeAsync('kvGetMiss', async () => {
    await redis.get(`missing-key-${Date.now()}`);
  });
  kvGetMissTime = missTime;

  // Cleanup
  await redis.del(testKey);

  console.log(`  ✓ KV SET: ${kvSetTime.toFixed(2)}ms`);
  console.log(`  ✓ KV GET (HIT): ${kvGetHitTime.toFixed(2)}ms`);
  console.log(`  ✓ KV GET (MISS): ${kvGetMissTime.toFixed(2)}ms`);
  console.log(`  ✓ Round-trip (SET + GET): ${(kvSetTime + kvGetHitTime).toFixed(2)}ms`);
} catch (err) {
  console.log(`  ⚠️ KV not available: ${err.message}`);
  console.log(`  (Local dev without KV_REST_API_URL — expected)`);
}
console.log('');

// TEST 6: FULL DETERMINISTIC PIPELINE
console.log('TEST 6: FULL DETERMINISTIC PIPELINE (Mock Book)');
console.log('─────────────────────────────────────────────────────────────────────────────');

const pipelineStart = performance.now();

// Step 1: Identity conflicts
const vision = mockVisionData("Amazing Spider-Man", "1", "1963", "Marvel Comics");
const visualConsensus = mockVisualConsensus("Amazing Spider-Man", "1");
const conflicts = detectIdentityConflicts(vision, visualConsensus, null, null);

// Step 2: Auto key detection
const comicVine = mockComicVine(true);
const keyResult = detectAutoKey(comicVine);

// Step 3: Recency-weighted pricing
const soldCompsData = mockSoldComps(15, 50);
const weighted = computeRecencyWeightedPrice(soldCompsData);

// Step 4: Decision engine
const enrichItem = mockEnrichItem({
  autoDetectedKey: keyResult.isKey,
  keyCharacters: keyResult.keyCharacters,
  price: weighted.price
});
const decision = computeDecision(enrichItem);

const pipelineElapsed = performance.now() - pipelineStart;

console.log(`  Book: Amazing Spider-Man #1 (1963)`);
console.log(`  Steps:`);
console.log(`    1. Conflict detection: ${conflicts.length} conflicts`);
console.log(`    2. Auto key detection: isKey=${keyResult.isKey}`);
console.log(`    3. Recency weighting: $${weighted.price?.toFixed(2)} (${weighted.recencyDays}d)`);
console.log(`    4. Decision: ${decision.action} (${decision.confidence})`);
console.log(`\n  ✓ Total pipeline time: ${pipelineElapsed.toFixed(2)}ms\n`);

// SUMMARY
console.log('═══════════════════════════════════════════════════════════════════════════════');
console.log('SUMMARY');
console.log('═══════════════════════════════════════════════════════════════════════════════\n');

const totalDeterministicTime = avgConflictTime + pricingTime + avgDecisionTime + avgKeyTime;

console.log('Deterministic Phase Timings:');
console.log(`  Conflict Detection:     ${avgConflictTime.toFixed(2)}ms avg per book`);
console.log(`  Pricing Engine:         ${pricingTime.toFixed(2)}ms per book`);
console.log(`  Decision Engine:        ${avgDecisionTime.toFixed(2)}ms avg per book`);
console.log(`  Auto Key Detection:     ${avgKeyTime.toFixed(2)}ms avg per book`);
console.log(`  ─────────────────────────────────────────────────`);
console.log(`  Total Deterministic:    ${totalDeterministicTime.toFixed(2)}ms per book`);
console.log(`  Full Pipeline (mock):   ${pipelineElapsed.toFixed(2)}ms\n`);

if (kvAvailable && kvSetTime !== null) {
  console.log('KV Cache Timings:');
  console.log(`  SET operation:          ${kvSetTime.toFixed(2)}ms`);
  console.log(`  GET (hit):              ${kvGetHitTime.toFixed(2)}ms`);
  console.log(`  GET (miss):             ${kvGetMissTime.toFixed(2)}ms`);
  console.log(`  Round-trip:             ${(kvSetTime + kvGetHitTime).toFixed(2)}ms\n`);
}

// Performance assessment
console.log('Performance Assessment:');
const targetTime = 50;
const passedTarget = totalDeterministicTime < targetTime;

if (passedTarget) {
  console.log(`  ✅ PASS — All deterministic phases < ${targetTime}ms target`);
} else {
  console.log(`  ⚠️ SLOW — Total ${totalDeterministicTime.toFixed(2)}ms exceeds ${targetTime}ms target`);
}

// Flag slow phases
const phases = [
  { name: 'Conflict Detection', time: avgConflictTime },
  { name: 'Pricing Engine', time: pricingTime },
  { name: 'Decision Engine', time: avgDecisionTime },
  { name: 'Auto Key Detection', time: avgKeyTime }
];

const slowPhases = phases.filter(p => p.time > 10);
if (slowPhases.length > 0) {
  console.log('\n  Phases requiring optimization (>10ms):');
  slowPhases.forEach(p => {
    console.log(`    - ${p.name}: ${p.time.toFixed(2)}ms`);
  });
} else {
  console.log('  ✅ All individual phases < 10ms');
}

console.log('\nConclusion:');
if (totalDeterministicTime < 100) {
  console.log(`  ✅ Deterministic layer is FAST (${totalDeterministicTime.toFixed(2)}ms)`);
  console.log('  Ready for production AI integration — logic cost is negligible');
} else {
  console.log(`  ⚠️ Deterministic layer needs optimization (${totalDeterministicTime.toFixed(2)}ms)`);
  console.log('  Optimize before spending on AI');
}

console.log('\n═══════════════════════════════════════════════════════════════════════════════\n');

// Exit with appropriate code
process.exit(passedTarget ? 0 : 1);
