// GK-152 — deriveMarketStanding's new issue-facet floor (src/lib/
// actionAuthority.js) and responseContract.js's matching lock. Proves
// the fourth of the four facets the existing comment block already
// named (variant/year/issue/title) but had never actually wired: a
// CONTESTED issue authority (out.issueAuthority.status === 'conflicted')
// floors standing to SIMILAR_ONLY, never EXACT_CURRENT/READY — same
// revocation-only principle as the AR/AT/AV siblings.
import { deriveMarketStanding } from '../src/lib/actionAuthority.js';
import { deriveLocks } from '../src/lib/responseContract.js';

let pass = 0, fail = 0;
function assertTrue(cond, msg) {
  if (cond) { pass++; console.log(`  PASS: ${msg}`); }
  else { fail++; console.log(`  FAIL: ${msg}`); }
}
function assertEq(actual, expected, msg) {
  assertTrue(actual === expected, `${msg} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
}

console.log('\n=== GK-152: deriveMarketStanding / responseContract issue-contested floor ===\n');

console.log('Section 1: an otherwise-EXACT_CURRENT source floors to SIMILAR_ONLY when issueAuthority is conflicted');
{
  const out = {
    pricingSource: 'active_ask_derived',
    issueAuthority: { status: 'conflicted', reasons: ['issue-evidence-contested'] },
  };
  assertEq(deriveMarketStanding(out), 'SIMILAR_ONLY', 'CONTESTED issue authority floors standing to SIMILAR_ONLY');
}

console.log('\nSection 2: negative control — no issueAuthority at all, standing reaches EXACT_CURRENT normally');
{
  const out = { pricingSource: 'active_ask_derived' };
  assertEq(deriveMarketStanding(out), 'EXACT_CURRENT', 'no issueAuthority set: unaffected, still EXACT_CURRENT');
}

console.log('\nSection 3: negative control — issueAuthority present but a different status (e.g. provisional) does not trip this specific floor');
{
  const out = { pricingSource: 'active_ask_derived', issueAuthority: { status: 'provisional' } };
  assertEq(deriveMarketStanding(out), 'EXACT_CURRENT', 'status=provisional (a different gate\'s concern) does not floor via this check');
}

console.log('\nSection 4: responseContract.js emits the market-standing-issue-contested lock');
{
  const out = {
    pricingSource: 'active_ask_derived',
    price: 12.91,
    issueAuthority: { status: 'conflicted', reasons: ['issue-evidence-contested'] },
    rawComps: { count: 5 },
    decision: { action: 'RESEARCH' },
  };
  const locks = deriveLocks(out);
  const issueLock = locks.find((l) => l.code === 'market-standing-issue-contested');
  assertTrue(!!issueLock, 'market-standing-issue-contested lock present');
  assertEq(issueLock?.hard, false, 'lock is soft (hard:false) — listable=false, price still shown, matches the sibling facet locks');
  assertEq(issueLock?.class, 'insufficiency', 'lock class is insufficiency, same as the variant/year/title siblings');
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
