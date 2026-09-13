// tests/prediction-error-scoring-unit.test.js
//
// GK-209 Outcome #1 CLOSER — pure-function proof for
// src/lib/predictionErrorScoring.js. No DB, no network. Proves: never
// fabricates a realized outcome when none exists (Creepy's own real
// current state — CENSORED, ACTIVE_AT_CUTOFF-style), and correctly
// computes all four distinct facts once a real sale exists.
//
// Invoke: node tests/prediction-error-scoring-unit.test.js

import { scorePrediction, SCORE_STATUS } from '../src/lib/predictionErrorScoring.js';

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

console.log('\n=== scorePrediction -- pure-function proof ===\n');

console.log('-- Creepy\'s REAL current state: predicted $61.41, ask $75.00, no realized sale yet -- must be CENSORED, never a guessed price --\n');
{
  const result = scorePrediction({ predictedValue: 61.41, askAmount: 75.00, realizedGross: null, realizedNet: null, listedAt: '2026-09-13T04:20:24.542Z', realizedAt: null, isCensored: false });
  assertTrue(result.status === SCORE_STATUS.CENSORED, 'status = CENSORED (no realized sale yet)');
  assertTrue(result.grossSignedError === null && result.grossPercentError === null, 'gross error fields are null, never a fabricated number');
  assertTrue(result.netSignedError === null && result.netPercentError === null, 'net error fields are null');
  assertTrue(result.actualTimeToSaleDays === null, 'time-to-sale is null (no sale has occurred)');
  assertTrue(Math.abs(result.askVsPredictedSignedError - 13.59) < 0.001, `ask-vs-predicted IS scoreable right now (13.59 over), got ${result.askVsPredictedSignedError}`);
  assertTrue(result.predictedValue === 61.41 && result.askAmount === 75.00, 'predicted and ask are preserved as two separate, distinct facts');
}

console.log('\n-- explicit ACTIVE_AT_CUTOFF (right-censored) -- distinct reason text from "not sold yet" --\n');
{
  const result = scorePrediction({ predictedValue: 61.41, askAmount: 75.00, realizedGross: null, realizedNet: null, listedAt: '2026-09-13T04:20:24.542Z', realizedAt: null, isCensored: true });
  assertTrue(result.status === SCORE_STATUS.CENSORED, 'status = CENSORED');
  assertTrue(/ACTIVE_AT_CUTOFF/.test(result.censoredReason), 'censoredReason names ACTIVE_AT_CUTOFF specifically');
}

console.log('\n-- hypothetical real sale: predicted $61.41, ask $75.00, sold for $80.00 gross, $70.00 net, 10 days later --\n');
{
  const result = scorePrediction({
    predictedValue: 61.41, askAmount: 75.00, realizedGross: 80.00, realizedNet: 70.00,
    listedAt: '2026-09-13T04:20:24.542Z', realizedAt: '2026-09-23T04:20:24.542Z', isCensored: false,
  });
  assertTrue(result.status === SCORE_STATUS.SCORED, 'status = SCORED');
  assertTrue(Math.abs(result.grossSignedError - 18.59) < 0.001, `gross signed error = realizedGross - predicted = 18.59, got ${result.grossSignedError}`);
  assertTrue(Math.abs(result.netSignedError - 8.59) < 0.001, `net signed error = realizedNet - predicted = 8.59, got ${result.netSignedError}`);
  assertTrue(Math.abs(result.actualTimeToSaleDays - 10) < 0.001, `actual time-to-sale = 10 days, got ${result.actualTimeToSaleDays}`);
  assertTrue(result.predictedValue === 61.41 && result.askAmount === 75.00 && result.grossSignedError !== result.netSignedError, 'all four facts (predicted, ask, gross, net) remain distinct, never conflated');
}

console.log('\n-- realizedGross known but realizedNet not yet (economics still incomplete) -- gross scoreable, net still censored --\n');
{
  const result = scorePrediction({
    predictedValue: 61.41, askAmount: 75.00, realizedGross: 80.00, realizedNet: null,
    listedAt: '2026-09-13T04:20:24.542Z', realizedAt: '2026-09-23T04:20:24.542Z', isCensored: false,
  });
  assertTrue(result.status === SCORE_STATUS.SCORED, 'status = SCORED (a real sale occurred)');
  assertTrue(result.grossSignedError !== null, 'gross IS scoreable');
  assertTrue(result.netSignedError === null, 'net is NOT fabricated just because gross is known — genuinely null until economics components exist');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  console.log('Failures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
