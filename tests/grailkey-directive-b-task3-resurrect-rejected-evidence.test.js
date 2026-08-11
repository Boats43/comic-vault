// GrailKey Directive 2026-08-11-B, Task 3 — Resurrect-Rejected-Evidence
// pattern, three ComicVine gates.
//
// Standing invariant (already ratified, GrailKey Directive A/B — "Rejection
// Must Not Create Authority"): evidence rejected by an admissibility gate
// cannot regain authority merely because the surviving set is empty. Zero
// survivors means UNRESOLVED (empty candidate set, comicVine() falls
// through to null / other identity sources), never "use the rejected ones
// anyway."
//
// Three gates in api/enrich.js shared the identical violation: when a
// filter would remove every remaining candidate, the code discarded the
// filter result and silently restored the pre-filter (rejected) set.
//   - year-strict gate:  api/enrich.js (was ~:770-775)
//   - token gate:        api/enrich.js (was ~:907-916)
//   - publisher gate:    api/enrich.js (was ~:944-953)
//
// api/enrich.js is a request handler, not an importable module (same
// documented constraint as tests/ship23-consistency.test.js) — each gate's
// exact filter-then-branch logic is mirrored here, byte-for-byte against
// the real source, cited by line. A fourth candidate instance of the same
// SHAPE was found during the sweep this task required (api/comps.js:1803,
// eBay grade-proximity filter falling back to the unfiltered pool) —
// deliberately NOT touched: fixing it would alter which comps enter price
// computation, a pricing-math change outside this task's authorization.
// Logged to docs/TICKET-REGISTRY.md as OPEN, not tested or fixed here.
//
// Invoke: node tests/grailkey-directive-b-task3-resurrect-rejected-evidence.test.js
// Exit code: 0 on all-pass, 1 on any failure.

let passed = 0;
let failed = 0;
const failures = [];

const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`;
    failures.push(msg);
    console.log(msg);
  }
};

console.log('\n=== GrailKey Directive B, Task 3 — Resurrect-Rejected-Evidence (3 gates) ===\n');

// ─── Mirror of the CURRENT (post-fix) source shape, all three gates ───
// Fixed shape (api/enrich.js, current): when filtered.length > 0, use it;
// otherwise EMPTY the candidate set (candidates.length = 0) — matching the
// reprint-publisher gate's own already-correct precedent (api/enrich.js
// :818-835, Q99 ruling, deliberately untouched by this task since it was
// never part of the violation).
const applyGateFixed = (candidates, predicate) => {
  const filtered = candidates.filter(predicate);
  if (filtered.length > 0) {
    return filtered;
  }
  return []; // zero survivors -> UNRESOLVED, never the rejected set
};

// ─── GATE 1: year-strict (api/enrich.js cv-year-strict) ───
console.log('GATE 1 — cv-year-strict (±4y cover_date vs comicYear):');
const yearStrictPredicate = (comicYear) => (r) => {
  const coverDate = r?.cover_date;
  if (!coverDate) return true;
  const coverYear = parseInt(String(coverDate).split('-')[0], 10);
  if (isNaN(coverYear)) return true;
  return Math.abs(coverYear - comicYear) <= 4;
};

const allWrongYearIssues = [
  { cover_date: '1963-05-01', volume: { name: 'Wrong Era Vol A' } },
  { cover_date: '1965-01-01', volume: { name: 'Wrong Era Vol B' } },
];
const yearGateResult = applyGateFixed(allWrongYearIssues, yearStrictPredicate(2005));
assertEq(yearGateResult, [], 'year-strict: all candidates >4y off -> empty set (UNRESOLVED), not the rejected pair');

const someRightYearIssues = [
  { cover_date: '1963-05-01', volume: { name: 'Wrong Era' } },
  { cover_date: '2005-03-01', volume: { name: 'Right Era' } },
];
const yearGateMixed = applyGateFixed(someRightYearIssues, yearStrictPredicate(2005));
assertEq(yearGateMixed.length, 1, 'year-strict: mixed pool still keeps the genuinely-matching survivor (unchanged behavior)');
assertEq(yearGateMixed[0].volume.name, 'Right Era', 'year-strict: the surviving candidate is the correct one, not a rejected one');

// ─── GATE 2: token overlap (api/enrich.js cv-token-gate) ───
console.log('\nGATE 2 — cv-token-gate (≥50% query-token overlap):');
const tokenizeForGate = (str) =>
  String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(t => t.length >= 2);

const tokenPredicate = (queryTokens, coreTokens) => (r) => {
  const volTokens = tokenizeForGate(r.volume?.name);
  const overlap = queryTokens.filter(qt => volTokens.includes(qt)).length;
  const overlapRatio = queryTokens.length > 0 ? overlap / queryTokens.length : 0;
  const coreOverlap = coreTokens.filter(ct => volTokens.includes(ct)).length;
  if (coreOverlap === 0 && coreTokens.length > 0) return false;
  if (overlapRatio < 0.5) return false;
  return true;
};

const ourQueryTokens = tokenizeForGate('scorched earth');
const noOverlapVolumes = [
  { volume: { name: 'Unrelated Sci-Fi Anthology' } },
  { volume: { name: 'Totally Different Series' } },
];
const tokenGateResult = applyGateFixed(noOverlapVolumes, tokenPredicate(ourQueryTokens, ourQueryTokens.slice(0, 3)));
assertEq(tokenGateResult, [], 'cv-token-gate: zero token overlap on every candidate -> empty set (UNRESOLVED), not the unrelated volumes');

// ─── GATE 3: publisher (api/enrich.js cv-pub-gate) ───
console.log('\nGATE 3 — cv-pub-gate (nameScore<75 && no publisher confirmation):');
const pubPredicate = (seriesLower, pubLower) => (r) => {
  const volName = String(r.volume?.name || '').toLowerCase().replace(/^(the|a|an)\s+/i, '').trim();
  const nameScore = volName === seriesLower ? 100
    : volName.includes(seriesLower) || seriesLower.includes(volName) ? 50
    : 0;
  const volPub = String(r.volume?.publisher || '').toLowerCase().trim();
  const publisherScore = pubLower && volPub && (volPub.includes(pubLower) || pubLower.includes(volPub)) ? 2 : 0;
  if (nameScore < 75 && publisherScore === 0 && pubLower) return false;
  return true;
};

const weakPublisherMismatches = [
  { volume: { name: 'Generic Anthology', publisher: 'Some Indie Press' } },
  { volume: { name: 'Another Generic Title', publisher: 'A Different Press' } },
];
const pubGateResult = applyGateFixed(weakPublisherMismatches, pubPredicate('spawn', 'image'));
assertEq(pubGateResult, [], 'cv-pub-gate: all candidates weak-name + wrong-publisher -> empty set (UNRESOLVED), not the mismatched volumes');

// ─── Regression: reprint-publisher gate's pre-existing correct behavior (Q99) unchanged ───
console.log('\nREGRESSION — reprint-publisher gate (already correct, untouched by this task):');
const REPRINT_PUBLISHERS = ['marvel uk', 'panini', 'dynapubs'];
const reprintPredicate = (r) => {
  const volPub = String(r.volume?.publisher || '').toLowerCase();
  return !REPRINT_PUBLISHERS.some(rp => volPub.includes(rp));
};
const allReprintCandidates = [
  { volume: { name: 'X', publisher: 'Panini Brasil' } },
  { volume: { name: 'Y', publisher: 'Marvel UK' } },
];
const reprintGateResult = applyGateFixed(allReprintCandidates, reprintPredicate);
assertEq(reprintGateResult, [], 'reprint gate: all candidates known reprints -> empty set (Q99 ruling, already correct before this task)');

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  console.log('FAILURES:');
  failures.forEach(f => console.log(f));
  process.exit(1);
}
process.exit(0);
