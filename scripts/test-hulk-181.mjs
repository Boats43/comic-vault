#!/usr/bin/env node
// Determinism test — Incredible Hulk #181, 10 iterations
// Validates Fix 1 (temperature=0) resolves non-determinism

const API_ENDPOINT = 'https://comic-vault-rouge.vercel.app/api/enrich';
const ITERATIONS = 10;

console.log('='.repeat(80));
console.log('DETERMINISM TEST — Incredible Hulk #181');
console.log(`Endpoint: ${API_ENDPOINT}`);
console.log(`Iterations: ${ITERATIONS}`);
console.log('='.repeat(80));
console.log();

// Test case: Incredible Hulk #181 (the drift case from original sweep)
const payload = {
  manualIdentity: true,
  skipVision: true,
  skipImageSearch: true,
  title: 'Incredible Hulk',
  issue: '181',
  year: '1974',
  publisher: 'Marvel',
  grade: '7.0',
  certNumber: '7777777777',
  keyIssue: 'First appearance Wolverine',
  isGraded: true,
  confidence: 'HIGH'
};

// Call API helper
async function callEnrich(iteration) {
  const start = Date.now();
  const response = await fetch(API_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const elapsed = Date.now() - start;

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  return { data, elapsed, iteration };
}

// Extract key fields for comparison
function extractFields(data) {
  return {
    price: data.price,
    pricingSource: data.pricingSource,
    decision: data.decision?.action,
    decisionConfidence: data.decision?.confidence,
    verified: data.verified,
    claudeCheckVerified: data.claudeCheck?.verified,
    criticalFlags: data.criticalFlags?.length || 0
  };
}

// Run test
console.log(`Running ${ITERATIONS} identical API calls...`);
console.log();

const results = [];
const timings = [];

try {
  for (let i = 1; i <= ITERATIONS; i++) {
    process.stdout.write(`Call ${i}/${ITERATIONS}... `);
    const result = await callEnrich(i);
    const fields = extractFields(result.data);
    results.push(fields);
    timings.push(result.elapsed);
    console.log(`${result.elapsed}ms — price: ${fields.price || 'null'}, decision: ${fields.decision}`);
  }

  console.log();
  console.log('='.repeat(80));
  console.log('RESULTS');
  console.log('='.repeat(80));

  // Check for uniqueness
  const uniquePrices = [...new Set(results.map(r => r.price))];
  const uniqueDecisions = [...new Set(results.map(r => r.decision))];
  const uniquePricingSources = [...new Set(results.map(r => r.pricingSource))];

  console.log(`Unique prices: ${uniquePrices.length}`);
  uniquePrices.forEach(p => {
    const count = results.filter(r => r.price === p).length;
    console.log(`  ${p || 'null'}: ${count}/${ITERATIONS} (${((count/ITERATIONS)*100).toFixed(1)}%)`);
  });
  console.log();

  console.log(`Unique decisions: ${uniqueDecisions.length}`);
  uniqueDecisions.forEach(d => {
    const count = results.filter(r => r.decision === d).length;
    console.log(`  ${d}: ${count}/${ITERATIONS} (${((count/ITERATIONS)*100).toFixed(1)}%)`);
  });
  console.log();

  console.log(`Unique pricing sources: ${uniquePricingSources.length}`);
  uniquePricingSources.forEach(s => {
    const count = results.filter(r => r.pricingSource === s).length;
    console.log(`  ${s}: ${count}/${ITERATIONS} (${((count/ITERATIONS)*100).toFixed(1)}%)`);
  });
  console.log();

  const avgTiming = timings.reduce((a, b) => a + b, 0) / timings.length;
  const minTiming = Math.min(...timings);
  const maxTiming = Math.max(...timings);
  console.log(`Timing: avg ${avgTiming.toFixed(0)}ms, min ${minTiming}ms, max ${maxTiming}ms`);
  console.log();

  // Determinism check
  const isDeterministic = uniquePrices.length === 1 && uniqueDecisions.length === 1;

  if (isDeterministic) {
    console.log('✅ PASS: 100% deterministic');
    console.log(`  All ${ITERATIONS} calls returned identical results`);
    console.log(`  Price: ${uniquePrices[0] || 'null'}`);
    console.log(`  Decision: ${uniqueDecisions[0]}`);
    console.log(`  Pricing source: ${uniquePricingSources[0]}`);
    console.log();
    console.log('FIX 1 VALIDATED — temperature=0 achieves determinism');
    process.exit(0);
  } else {
    console.log('❌ FAIL: Non-deterministic results detected');
    console.log(`  Price variance: ${uniquePrices.length} different values`);
    console.log(`  Decision variance: ${uniqueDecisions.length} different values`);
    console.log();
    console.log('Detailed breakdown:');
    results.forEach((r, i) => {
      console.log(`  Call ${i+1}: price=${r.price || 'null'}, decision=${r.decision}, source=${r.pricingSource}`);
    });
    console.log();
    console.log('FIX 1 INCOMPLETE — temperature=0 did not fully resolve non-determinism');
    process.exit(1);
  }
} catch (error) {
  console.error();
  console.error(`❌ ERROR: ${error.message}`);
  process.exit(1);
}
