// tests/grailkey-commit-c-collection-header.test.js
//
// GrailKey dispatch, Commit C — collection-header aggregate status.
//
// Confirmed live: "Collection Status: READY" displayed alongside
// "PHOTOS 2 · REVIEW 0 · BLOCKED 1 · READY 0" — zero ready items, one
// blocked item, header claiming READY. No pre-existing single-word
// aggregate status computation was found anywhere in App.jsx (searched;
// only the section-header LABEL TEXT "Collection Status" existed, no
// computed value beside it) — this is new logic filling a real gap, not
// a fix to a previously-miscomputed value.
//
// Also fixes a second, independently confirmed defect in the same view:
// the top stats-row "Liquid Value" reused a readiness-blind raw sum
// (App.jsx's own totalValue) under the "Liquid Value" label, producing
// a DIFFERENT number than the correctly-filtered "Liquid Value" already
// shown lower on the same screen (getCollectionMetrics(items).liquidValue,
// ready+photosNeeded only) — two numbers, one label, same view. Not
// independently testable here (it's a prop-wiring change inside App.jsx,
// which contains JSX and cannot be imported by this test runner) — noted
// for completeness; verified instead via build + full-file lint parity
// (see commit message).
//
// getAggregateCollectionStatus itself is extracted to
// src/lib/collectionMetrics.js specifically so it CAN be tested here —
// App.jsx contains JSX and is not importable by this repo's plain-Node
// test runner.

import { getAggregateCollectionStatus } from '../src/lib/collectionMetrics.js';

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

// Helper matching getCollectionMetrics' own real output shape.
function metrics({ total, blocked = 0, review = 0, photos = 0, ready = 0 }) {
  return {
    totalComics: total,
    blocked: { count: blocked, value: 0 },
    needsReview: { count: review, value: 0 },
    photosNeeded: { count: photos, value: 0 },
    ready: { count: ready, value: 0 },
  };
}

// C1 — single-state BLOCKED only
test('C1: single-state BLOCKED', () => {
  const m = metrics({ total: 3, blocked: 3 });
  assertEq(getAggregateCollectionStatus(m), 'BLOCKED', 'all-blocked collection');
});

// C2 — single-state REVIEW only
test('C2: single-state REVIEW', () => {
  const m = metrics({ total: 2, review: 2 });
  assertEq(getAggregateCollectionStatus(m), 'REVIEW', 'all-review collection');
});

// C3 — single-state PHOTOS only
test('C3: single-state PHOTOS', () => {
  const m = metrics({ total: 4, photos: 4 });
  assertEq(getAggregateCollectionStatus(m), 'PHOTOS', 'all-photos-needed collection');
});

// C4 — single-state READY only (every item ready)
test('C4: single-state READY (every item ready)', () => {
  const m = metrics({ total: 5, ready: 5 });
  assertEq(getAggregateCollectionStatus(m), 'READY', 'all-ready collection');
});

// C5 — EMPTY (zero items)
test('C5: EMPTY collection', () => {
  const m = metrics({ total: 0 });
  assertEq(getAggregateCollectionStatus(m), 'EMPTY', 'zero-item collection is never READY');
});

// C6 — mixed ready+blocked -> BLOCKED wins (the exact real production shape)
test('C6: mixed ready+blocked -> BLOCKED (real production shape: PHOTOS 2, BLOCKED 1, READY 0)', () => {
  const m = metrics({ total: 3, photos: 2, blocked: 1, ready: 0 });
  assertEq(getAggregateCollectionStatus(m), 'BLOCKED', 'any blocked item forces BLOCKED regardless of other buckets');
});

// C7 — mixed ready+review -> REVIEW wins
test('C7: mixed ready+review -> REVIEW', () => {
  const m = metrics({ total: 4, ready: 2, review: 2 });
  assertEq(getAggregateCollectionStatus(m), 'REVIEW', 'review outranks a partial-ready collection');
});

// C8 — mixed ready+photos -> PHOTOS wins
test('C8: mixed ready+photos -> PHOTOS', () => {
  const m = metrics({ total: 4, ready: 2, photos: 2 });
  assertEq(getAggregateCollectionStatus(m), 'PHOTOS', 'photos-needed outranks a partial-ready collection');
});

// C9 — header/card agreement: READY can ONLY report when literally every
// item is ready (structural proof — READY never fires on a partial set,
// matching what individual per-item card badges would independently show)
test('C9: READY never fires unless ready.count === totalComics (header/card agreement)', () => {
  const partial = metrics({ total: 10, ready: 9 }); // 9/10 ready, 1 unaccounted
  assertEq(getAggregateCollectionStatus(partial), 'EMPTY', '9/10 ready must not report READY — defensive fallback, not a false positive');

  const complete = metrics({ total: 10, ready: 10 });
  assertEq(getAggregateCollectionStatus(complete), 'READY', '10/10 ready correctly reports READY');
});

// MUTATION PROOF: a naive precedence checking READY before the blocking
// states would wrongly report READY for a mixed collection whenever ANY
// ready items exist, regardless of blocked/review/photos — restore that
// naive order inline and confirm it fails against the real C6 fixture;
// the real (correct) function order is BLOCKED > REVIEW > PHOTOS > READY.
test('MUTATION: naive READY-first precedence wrongly reports READY on the real production shape; correct precedence does not', () => {
  const naiveAggregateStatus = (m) => {
    if (!m || m.totalComics === 0) return 'EMPTY';
    if (m.ready.count > 0) return 'READY'; // WRONG: checked before BLOCKED
    if (m.blocked.count > 0) return 'BLOCKED';
    if (m.needsReview.count > 0) return 'REVIEW';
    if (m.photosNeeded.count > 0) return 'PHOTOS';
    return 'EMPTY';
  };
  // Real production shape: PHOTOS 2, REVIEW 0, BLOCKED 1, READY 0 — ready
  // is actually 0 here, so use a shape where ready>0 AND blocked>0 to
  // actually distinguish the two orderings.
  const mixedShape = metrics({ total: 4, ready: 1, blocked: 1, photos: 2 });
  assertEq(naiveAggregateStatus(mixedShape), 'READY', 'mutation check: naive order incorrectly reports READY when any ready item exists');
  assertEq(getAggregateCollectionStatus(mixedShape), 'BLOCKED', 'real (fixed) order correctly reports BLOCKED');
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
