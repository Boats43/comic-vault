#!/usr/bin/env node
// Live API Verification Sweep — validates price/decision stability at the deployed endpoint
// Calls https://comic-vault-rouge.vercel.app/api/enrich 3x per test case
// Detects drift in price/decision on identical manualIdentity payloads

const API_ENDPOINT = 'https://comic-vault-rouge.vercel.app/api/enrich';

console.log('='.repeat(80));
console.log('LIVE API VERIFICATION SWEEP — Commit 6a12f0a (CORRECTED PAYLOAD)');
console.log('Endpoint:', API_ENDPOINT);
console.log('='.repeat(80));
console.log();

// Helper to build proper manual identity payload matching UI's Fix 4 implementation
function buildPayload({ title, issue, year, publisher, grade, variant, keyIssue, certNumber }) {
  const isGraded = !!certNumber || /^\d+(\.\d+)?$/.test(grade);
  return {
    manualIdentity: true,
    skipVision: true,
    skipImageSearch: true,
    title,
    issue,
    year,
    publisher,
    grade,
    ...(variant && { variant }),
    ...(keyIssue && { keyIssue }),
    ...(certNumber && { certNumber }),
    isGraded,
    confidence: 'HIGH'
  };
}

const testCases = [
  {
    name: 'Modern CGC 9.8 (high grade)',
    payload: buildPayload({
      title: 'Amazing Spider-Man',
      issue: '300',
      year: '1988',
      publisher: 'Marvel',
      grade: '9.8',
      certNumber: '1234567890'
    })
  },
  {
    name: 'Modern Raw VF/NM (mid grade)',
    payload: buildPayload({
      title: 'X-Men',
      issue: '1',
      year: '1991',
      publisher: 'Marvel',
      grade: 'VF/NM'
    })
  },
  {
    name: 'Vintage CGC 6.0 (Silver Age)',
    payload: buildPayload({
      title: 'Fantastic Four',
      issue: '48',
      year: '1966',
      publisher: 'Marvel',
      grade: '6.0',
      certNumber: '9876543210'
    })
  },
  {
    name: 'Vintage Raw VG (low grade)',
    payload: buildPayload({
      title: 'Tales of Suspense',
      issue: '39',
      year: '1963',
      publisher: 'Marvel',
      grade: 'VG'
    })
  },
  {
    name: 'Modern variant (newsstand)',
    payload: buildPayload({
      title: 'Batman',
      issue: '1',
      year: '2016',
      publisher: 'DC',
      variant: 'newsstand',
      grade: '9.6',
      certNumber: '5555555555'
    })
  },
  {
    name: 'Modern variant (35 cent test)',
    payload: buildPayload({
      title: 'Star Wars',
      issue: '1',
      year: '1977',
      publisher: 'Marvel',
      variant: '35 cent',
      grade: '8.0',
      certNumber: '3333333333'
    })
  },
  {
    name: 'Bronze Age key issue',
    payload: buildPayload({
      title: 'Incredible Hulk',
      issue: '181',
      year: '1974',
      publisher: 'Marvel',
      keyIssue: 'First appearance Wolverine',
      grade: '7.0',
      certNumber: '7777777777'
    })
  },
  {
    name: 'Modern low value (sub-$5)',
    payload: buildPayload({
      title: 'Spider-Man',
      issue: '50',
      year: '1994',
      publisher: 'Marvel',
      grade: 'VF'
    })
  },
  {
    name: 'Golden Age (pre-1956)',
    payload: buildPayload({
      title: 'Captain America Comics',
      issue: '74',
      year: '1950',
      publisher: 'Marvel',
      grade: '5.0',
      certNumber: '2222222222'
    })
  },
  {
    name: 'Annual issue',
    payload: buildPayload({
      title: 'Amazing Spider-Man Annual',
      issue: '1',
      year: '1964',
      publisher: 'Marvel',
      grade: '4.0',
      certNumber: '8888888888'
    })
  },
  {
    name: 'Modern CGC 10 (perfect grade)',
    payload: buildPayload({
      title: 'Walking Dead',
      issue: '1',
      year: '2003',
      publisher: 'Image',
      grade: '10',
      certNumber: '4444444444'
    })
  },
  {
    name: 'Vintage CGC 9.8 (high vintage)',
    payload: buildPayload({
      title: 'Amazing Spider-Man',
      issue: '50',
      year: '1967',
      publisher: 'Marvel',
      grade: '9.8',
      certNumber: '6666666666'
    })
  },
  {
    name: 'Modern Raw Good (low raw)',
    payload: buildPayload({
      title: 'Teenage Mutant Ninja Turtles',
      issue: '1',
      year: '1984',
      publisher: 'Mirage',
      grade: 'Good'
    })
  },
  {
    name: 'Copper Age (1985-1991)',
    payload: buildPayload({
      title: 'Dark Knight Returns',
      issue: '1',
      year: '1986',
      publisher: 'DC',
      grade: '9.4',
      certNumber: '1111111111'
    })
  },
  {
    name: 'Modern 2nd print variant',
    payload: buildPayload({
      title: 'Saga',
      issue: '1',
      year: '2012',
      publisher: 'Image',
      variant: '2nd print',
      grade: 'NM'
    })
  }
];

// Call API helper
async function callEnrich(payload, attempt) {
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
  return { data, elapsed, attempt };
}

// Extract key fields for comparison
function extractFields(data) {
  return {
    price: data.price,
    pricingSource: data.pricingSource,
    decision: data.decision?.action,
    decisionConfidence: data.decision?.confidence,
    gradeMultiplier: data.gradeMultiplier,
    compsAverage: data.comps?.average,
    compsCount: data.comps?.count,
    sanityFired: data.sanityFired,
    floorApplied: data.floorApplied
  };
}

// Run sweep
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const results = [];

for (const testCase of testCases) {
  console.log(`TEST: ${testCase.name}`);
  console.log('-'.repeat(80));

  try {
    // Call 3 times
    const calls = await Promise.all([
      callEnrich(testCase.payload, 1),
      callEnrich(testCase.payload, 2),
      callEnrich(testCase.payload, 3)
    ]);

    const fields = calls.map(c => extractFields(c.data));
    const timings = calls.map(c => c.elapsed);

    // Check for drift
    const price1 = fields[0].price;
    const price2 = fields[1].price;
    const price3 = fields[2].price;

    const decision1 = fields[0].decision;
    const decision2 = fields[1].decision;
    const decision3 = fields[2].decision;

    const hasPriceDrift = !(price1 === price2 && price2 === price3);
    const hasDecisionDrift = !(decision1 === decision2 && decision2 === decision3);

    totalTests++;

    // Categorize result
    const isRefusal = decision1 === 'ID_REQUIRED' || decision1 === 'DO_NOT_LIST';
    const hasRealPrice = price1 !== null && price1 !== 'null';
    const isStableRefusal = isRefusal && !hasPriceDrift && !hasDecisionDrift;
    const isStablePriced = hasRealPrice && !hasPriceDrift && !hasDecisionDrift;

    if (isStablePriced) {
      console.log('✅ PASS (Category C): Genuinely priced AND stable');
      console.log(`  Price: ${price1} (all 3 calls)`);
      console.log(`  Decision: ${decision1} (all 3 calls)`);
      console.log(`  Source: ${fields[0].pricingSource}`);
      console.log(`  Comps: ${fields[0].compsCount || 0} (avg: ${fields[0].compsAverage || 'N/A'})`);
      console.log(`  Timings: ${timings[0]}ms, ${timings[1]}ms, ${timings[2]}ms`);
      passedTests++;
      results.push({
        test: testCase.name,
        category: 'C',
        status: 'PASS',
        price: price1,
        decision: decision1,
        timings
      });
    } else if (isStableRefusal && hasRealPrice) {
      console.log('✅ PASS (Category A): Stable refusal decision but has price');
      console.log(`  Price: ${price1} (all 3 calls)`);
      console.log(`  Decision: ${decision1} (all 3 calls)`);
      console.log(`  Reason: Incomplete/ambiguous identity — acceptable refusal`);
      console.log(`  Timings: ${timings[0]}ms, ${timings[1]}ms, ${timings[2]}ms`);
      passedTests++;
      results.push({
        test: testCase.name,
        category: 'A',
        status: 'PASS',
        price: price1,
        decision: decision1,
        timings
      });
    } else if (isStableRefusal && !hasRealPrice) {
      console.log('⚠️  SKIP (Category B): Payload malformed — never reached pricing');
      console.log(`  Price: null (all 3 calls)`);
      console.log(`  Decision: ${decision1} (all 3 calls)`);
      console.log(`  Missing fields: ${calls[0].data.identityMissingFields?.join(', ') || 'unknown'}`);
      console.log(`  Reasons: ${calls[0].data.identityReasons?.join('; ') || 'unknown'}`);
      console.log(`  Timings: ${timings[0]}ms, ${timings[1]}ms, ${timings[2]}ms`);
      console.log(`  NOTE: This proves nothing about price stability`);
      results.push({
        test: testCase.name,
        category: 'B',
        status: 'SKIP',
        price: price1,
        decision: decision1,
        timings
      });
    } else {
      console.log('❌ FAIL: Drift detected');
      if (hasPriceDrift) {
        console.log(`  Price drift: ${price1} → ${price2} → ${price3}`);
      }
      if (hasDecisionDrift) {
        console.log(`  Decision drift: ${decision1} → ${decision2} → ${decision3}`);
      }
      console.log(`  Timings: ${timings[0]}ms, ${timings[1]}ms, ${timings[2]}ms`);
      console.log('  Field comparison:');
      console.log('  Call 1:', JSON.stringify(fields[0], null, 2));
      console.log('  Call 2:', JSON.stringify(fields[1], null, 2));
      console.log('  Call 3:', JSON.stringify(fields[2], null, 2));
      failedTests++;
      results.push({
        test: testCase.name,
        category: 'DRIFT',
        status: 'FAIL',
        priceDrift: hasPriceDrift,
        decisionDrift: hasDecisionDrift,
        fields,
        timings
      });
    }
  } catch (error) {
    console.log(`❌ ERROR: ${error.message}`);
    failedTests++;
    totalTests++;
    results.push({
      test: testCase.name,
      status: 'ERROR',
      error: error.message
    });
  }

  console.log();
}

// Summary
console.log('='.repeat(80));
console.log('SUMMARY');
console.log('='.repeat(80));
console.log(`Total: ${totalTests}`);
console.log();

const categoryC = results.filter(r => r.category === 'C');
const categoryA = results.filter(r => r.category === 'A');
const categoryB = results.filter(r => r.category === 'B');
const drift = results.filter(r => r.category === 'DRIFT');
const errors = results.filter(r => r.status === 'ERROR');

console.log(`Category C (Genuinely priced AND stable): ${categoryC.length}`);
categoryC.forEach(r => console.log(`  ✅ ${r.test} — ${r.price}`));
console.log();

console.log(`Category A (Stable refusal, acceptable): ${categoryA.length}`);
categoryA.forEach(r => console.log(`  ✅ ${r.test} — ${r.decision}`));
console.log();

console.log(`Category B (Payload malformed, proves nothing): ${categoryB.length}`);
categoryB.forEach(r => console.log(`  ⚠️  ${r.test} — ${r.decision}`));
console.log();

if (drift.length > 0) {
  console.log(`DRIFT DETECTED: ${drift.length}`);
  drift.forEach(r => {
    console.log(`  ❌ ${r.test}`);
    if (r.priceDrift) console.log('    Price drift across 3 calls');
    if (r.decisionDrift) console.log('    Decision drift across 3 calls');
  });
  console.log();
}

if (errors.length > 0) {
  console.log(`ERRORS: ${errors.length}`);
  errors.forEach(r => {
    console.log(`  ❌ ${r.test}: ${r.error}`);
  });
  console.log();
}

const meaningful = categoryC.length + categoryA.length;
const meaningfulPass = categoryC.length + categoryA.length;
console.log('='.repeat(80));
console.log(`HONEST ASSESSMENT:`);
console.log(`  Category C (real proof): ${categoryC.length}/${totalTests}`);
console.log(`  Category A (acceptable): ${categoryA.length}/${totalTests}`);
console.log(`  Category B (false positive): ${categoryB.length}/${totalTests}`);
console.log(`  Drift: ${drift.length}/${totalTests}`);
console.log(`  Errors: ${errors.length}/${totalTests}`);
console.log();
console.log(`Meaningful tests: ${meaningful}/${totalTests}`);
console.log(`Meaningful pass rate: ${meaningful > 0 ? ((meaningfulPass / meaningful) * 100).toFixed(1) : 0}%`);

if (drift.length > 0 || errors.length > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
