// Q83 — Vision low-confidence is a VOTE, not a VETO.
//
// Superman vs the Amazing Spider-Man #1 (1976 treasury) hit ID_REQUIRED
// despite 13 verified actives + 3 fresh solds converging on one identity:
// Vision hallucinated "not a valid comic title" + self-reported low
// confidence, and assessIdentityConfidence's visionConfidence==='low'
// veto (identityGate.js) outranked the consensus. The enrich gate now
// runs a consensus rescue (pool ≥10, fresh solds ≥1, Q58-TITLE ≥80%).
//
// These tests pin the two pure building blocks the rescue keys on:
//   1. backfillFromComps title consensus on the treasury pool shape
//   2. decisionEngine identity-from-consensus warning (priced, not blocked)
//
// Invoke: node tests/q83-consensus-rescue.test.js

import { backfillFromComps, extractTitleConsensus } from '../src/lib/identityCore.js';
import { computeDecision } from '../src/lib/decisionEngine.js';
import { assessIdentityConfidence, sanitizeIdentityFields } from '../src/lib/identityGate.js';

let passed = 0;
let failed = 0;
const check = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

// ── 1. Title consensus from the treasury pool ──────────────────────
const POOL = [
  // 13 verified actives
  'Superman vs the Amazing Spider-Man #1 1976 Treasury Marvel DC',
  'Superman vs The Amazing Spider-Man #1 (1976) Treasury Edition',
  'SUPERMAN VS THE AMAZING SPIDER-MAN #1 1976 Marvel Treasury VG',
  'Superman vs the Amazing Spider-Man #1 Treasury 1976 FN',
  'Superman Vs The Amazing Spider-Man #1 1976 Crossover Treasury',
  'Superman vs the Amazing Spider-Man #1 1976 DC Marvel VG+',
  'Superman vs Amazing Spider-Man #1 Treasury 1976',
  'Superman vs the Amazing Spider-Man #1 1976 Limited Collectors',
  'Superman vs. The Amazing Spider-Man #1 (Marvel/DC 1976) Treasury',
  'Superman vs the Amazing Spider-Man #1 1976 Treasury GD',
  'Superman vs The Amazing Spider-Man #1 1976 treasury sized',
  'Superman vs the Amazing Spider-Man #1 1976 FN- Treasury',
  'Superman VS The Amazing Spider-Man #1 Treasury Size 1976',
  // 3 fresh solds
  'Superman vs the Amazing Spider-Man #1 1976 Treasury VG 4.0',
  'Superman vs The Amazing Spider-Man #1 Treasury 1976 FN 6.0',
  'Superman vs the Amazing Spider-Man #1 (1976) Treasury GD/VG',
].map((title, i) => ({ title, price: [25, 29, 33, 35, 37, 40, 42, 44, 45, 46, 47, 48, 30, 25, 37, 48][i], daysAgo: i >= 13 ? 20 : null }));

const consensus = extractTitleConsensus(POOL, { minCount: 10, minRatio: 0.8 });
check(consensus != null, 'prefix consensus fires on the treasury pool');
check((consensus?.ratio || 0) >= 0.8, `consensus ratio >= 80% (got ${((consensus?.ratio || 0) * 100).toFixed(0)}%)`);
check(/superman vs/i.test(consensus?.title || ''), `consensus title reads "Superman vs..." (got "${consensus?.title}")`);

// Fragility documentation: the Q58-TITLE first-4-token join splinters on
// format-word variance in this pool — that is WHY the rescue uses the
// prefix extractor primary and Q58-TITLE only as fallback.
const q58 = backfillFromComps(null, '1976', null, POOL);
check(q58.titleBackfilled === false, 'Q58-TITLE alone does NOT converge on this pool (documents fallback ordering)');

// Sparse/junk pool → no consensus → ID_REQUIRED path stands
const junk = extractTitleConsensus(
  ['Random Comic Lot', 'Superman poster', 'Batman #5', 'X-Men #1'].map((t) => ({ title: t })),
  { minCount: 10, minRatio: 0.8 }
);
check(junk === null, 'sparse/divergent pool → null (ID_REQUIRED stands)');

// ── 2. Issue consensus regex shape (enrich inline logic replica) ───
const issueCounts = {};
POOL.forEach((it) => {
  const m = String(it.title).match(/#\s*(\d{1,4})\b/);
  if (m) issueCounts[m[1]] = (issueCounts[m[1]] || 0) + 1;
});
const ranked = Object.entries(issueCounts).sort((a, b) => b[1] - a[1]);
const total = ranked.reduce((s, [, c]) => s + c, 0);
check(ranked[0][0] === '1' && ranked[0][1] / total >= 0.70, 'issue consensus = #1 at >=70%');

// ── 3. Rescued identity passes the gate without the Vision veto ────
const rescued = sanitizeIdentityFields({
  title: consensus?.title, issue: '1', year: '1976', publisher: null,
  visionConfidence: null, author: null,
});
const idCheck2 = assessIdentityConfidence(rescued, 'ebay_comp_consensus', ['title', 'issue', 'year', 'publisher'], null);
check(idCheck2.confident === true, 'rescued identity passes gate (publisher skipped via ebay source)');

// Control: the pre-rescue veto still refuses (vote absent consensus)
const vetoed = sanitizeIdentityFields({
  title: 'Superman vs the Amazing Spider-Man', issue: '1', year: '1976',
  publisher: 'Marvel', visionConfidence: 'low', author: null,
});
const idCheck1 = assessIdentityConfidence(vetoed, 'vision_fallback', ['title', 'issue', 'year', 'publisher'], null);
check(idCheck1.confident === false, 'Vision low-confidence veto still refuses at unit level (consensus-absent path)');

// ── 4. Decision engine: priced with review flag, never blocked ─────
const decision = computeDecision({
  title: 'Superman vs the Amazing Spider-Man',
  issue: '1',
  publisher: 'Marvel',
  year: 1976,
  price: 37,
  identityConfident: true,
  identityFromConsensus: true,
  identityConsensus: { titleRatio: 0.94, issue: '1', poolSize: 16, freshSolds: 3 },
  pricingSource: 'verified_sold',
  rawComps: { average: 37, lowest: 25, highest: 48, count: 13 },
  soldComps: [{ price: 25 }, { price: 37 }, { price: 48 }],
});
check(decision.warnings.includes('identity-from-consensus'), 'identity-from-consensus warning present');
check(decision.action !== 'ID_REQUIRED' && decision.action !== 'DO_NOT_LIST',
  `not blocked (got ${decision.action})`);
check(decision.action !== 'LIST_NOW', `review retained — never silent LIST_NOW (got ${decision.action})`);

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
process.exit(0);
