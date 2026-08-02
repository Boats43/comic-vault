// tests/grailkey-commit-b2-cv-cache-guard.test.js
//
// GrailKey dispatch, Commit B2 — extend the existing Commit B.1 null-issue
// cache guard (ac: namespace) to the cv: namespace.
//
// Root cause, confirmed via a real production trace (2026-08-02 22:53:21
// UTC, deployment dpl_CugaaDi3KmEa48SqXaji5qpAxoZF, build af32d21): a
// `mode==='conflict-locked'` q140 issue-consensus-conflict outcome (Vision
// asserted an issue, the marketplace family unanimously disagreed, neither
// was adopted) never calls deriveIssueAuthorityFromAdoption — that function
// only fires for `mode==='adopted'` — so out.issueAuthority stays
// null/undefined for this shape. api/enrich.js's own prior
// `marketCustodyConflicted = out.issueAuthority?.status === 'conflicted'`
// check therefore evaluated false, even though confirmedIssue was ALSO
// null in this exact case — precisely the shape the ac: namespace's own
// canUseExactIssuePricingCache already guards against
// (`if (confirmedIssue == null) return false;`). Confirmed live:
// `[active-cache] SKIP: confirmedIssue is null ... (Commit B.1)` correctly
// fired for ac:, while cv: had no equivalent check and wrote
// `cv:spawn brett booth|null|Image` unconditionally.
//
// Fix: api/enrich.js's cv:/pc: guard now reuses canUseExactIssuePricingCache
// directly (the same function ac: already trusts) instead of the narrower
// issueAuthority.status==='conflicted' check — a one-namespace extension of
// an existing, already-tested primitive, not a new subsystem.
//
// This test exercises canUseExactIssuePricingCache directly (the reused
// primitive) rather than re-deriving api/enrich.js's full request handler —
// consistent with this codebase's own "production and tests share one
// implementation" convention (issueAuthority.js's own module header).

import { canUseExactIssuePricingCache } from '../src/lib/issueAuthority.js';

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

test('conflict-locked shape: confirmedIssue null, issueAuthority null (mode!==adopted) — MUST reject', () => {
  const eligible = canUseExactIssuePricingCache(null, null, null);
  assertEq(eligible, false, 'null-issue conflict-locked case must be cache-ineligible');
});

test('the exact real production shape: confirmedIssue=null, out.issueAuthority=undefined', () => {
  // Mirrors the real 22:53:21 UTC trace exactly: mode='conflict-locked',
  // out.issueAuthority never assigned, confirmedIssue resolved to null.
  const confirmedIssue = null;
  const outIssueAuthority = undefined;
  const identityProvisionalFields = null;
  const eligible = canUseExactIssuePricingCache(confirmedIssue, outIssueAuthority, identityProvisionalFields);
  assertEq(eligible, false, 'real production shape must be cache-ineligible for cv:/pc: too, not just ac:');
});

test('non-regression: confirmed issue with no issueAuthority object at all — ordinary case, must remain eligible', () => {
  const eligible = canUseExactIssuePricingCache('351', null, null);
  assertEq(eligible, true, 'ordinary confirmed-issue case (no issueAuthority object) must remain unaffected');
});

test('non-regression: issueAuthority.status=confirmed (Commit 3 user-correction) — must remain eligible', () => {
  const eligible = canUseExactIssuePricingCache('351', { status: 'confirmed' }, null);
  assertEq(eligible, true, 'explicit user-confirmed status must remain cache-eligible');
});

test('non-regression: issueAuthority.status=provisional (Commit 4 adoption) — must remain ineligible', () => {
  const eligible = canUseExactIssuePricingCache('351', { status: 'provisional' }, null);
  assertEq(eligible, false, 'provisional status must remain cache-ineligible, unchanged by this fix');
});

test('non-regression: issueAuthority.status=conflicted (Commit 4.3 retention branch) — must remain ineligible', () => {
  const eligible = canUseExactIssuePricingCache('351', { status: 'conflicted' }, null);
  assertEq(eligible, false, 'conflicted status must remain cache-ineligible, unchanged by this fix');
});

// MUTATION PROOF (M3): restore the unguarded (pre-fix) marketCustodyConflicted
// shape by simulating the OLD check directly — confirm it would have
// incorrectly allowed the real production shape through, then confirm the
// restored (current) implementation correctly blocks it.
test('MUTATION M3: the OLD status-only check incorrectly passes the real shape; the NEW reused-function check correctly blocks it', () => {
  const confirmedIssue = null;
  const outIssueAuthority = undefined;

  // OLD (pre-fix) logic: marketCustodyConflicted = out.issueAuthority?.status === 'conflicted'
  const oldMarketCustodyConflicted = outIssueAuthority?.status === 'conflicted';
  assertEq(oldMarketCustodyConflicted, false, 'mutation check: OLD logic incorrectly evaluates false for this shape (confirms the bug existed)');

  // NEW (fixed) logic: marketCustodyConflicted = !canUseExactIssuePricingCache(...)
  const newMarketCustodyConflicted = !canUseExactIssuePricingCache(confirmedIssue, outIssueAuthority, null);
  assertEq(newMarketCustodyConflicted, true, 'mutation check: NEW logic correctly evaluates true (blocks cv:/pc: write) for this shape');
});

for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`✗ ${name}`);
    console.log(`  ${e.message}\n`);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed (${tests.length} total)`);
if (failed > 0) {
  process.exit(1);
}
