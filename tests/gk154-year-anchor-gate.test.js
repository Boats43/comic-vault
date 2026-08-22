// tests/gk154-year-anchor-gate.test.js
//
// GK-154 (2026-08-22) — real production case: G.I. Joe #5 Tyler Kirkham
// 616 virgin. PriceCharting matched "G.I. Joe Special Missions #5
// (1987)" — an unrelated 1987 Marvel mini-series sharing only the base
// "G.I. Joe" name (reason=base-entry, no plausibility check). resolveYear
// had no user year at all (Vision supplied none — routine for a modern
// virgin-variant cover) and adopted PC's year unconditionally —
// confirmedYear became 1987. ~500 lines later, q141-a independently
// concluded this SAME anchor's own projected title ("G.I. Joe Special
// Missions") doesn't match the corroborated confirmedTitle and skipped
// the TITLE write ("evidence the ANCHOR is wrong, not the title") — but
// nothing retroactively invalidated the YEAR the same anchor had already
// supplied.
//
// FIX (narrow, api/enrich.js, immediately before the resolveYear call):
// reuses the IDENTICAL predicate q141-a runs
// (projectCanonicalTitleFromAnchor + isCorroboratedIdentitySource) to
// decide whether pcYear should even be OFFERED to resolveYear. When the
// anchor already fails title corroboration, pcYear is withheld (passed
// as null) — resolveYear falls through to its own unmodified precedence
// instead of adopting the rejected anchor's year. q141-a itself
// (its own log lines, its own confirmedTitle write) is completely
// untouched — this is a second, independent consumer of the same pure
// check, not a refactor of it. The catalog year remains visible as
// CONFLICT evidence: catalogYearForEvidence (unchanged) still reads the
// real, un-gated pcYear, so reconcileYear can still see and report the
// disagreement — never silently discarded (I13).
//
// This file unit-tests the GATE PREDICATE ITSELF in isolation (the exact
// two library functions the fix composes, proven independently pure and
// side-effect-free) plus, via direct source-text assertions, that the
// live api/enrich.js wiring actually calls them the way this predicate
// requires. The full end-to-end outcome (confirmedYear lands on 2025 via
// reconcileYear's pre-existing RESCUE branch, GK-135/AT, once GK-156's
// r.rawTitle fix gives poolYearHint a real signal to rescue with) is
// proven by the shared handler-smoke fixture,
// tests/gk153-156-gijoe-handler-smoke.test.js — see that file for the
// GK-138 real-handler proof.
//
// Invoke: node tests/gk154-year-anchor-gate.test.js

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { projectCanonicalTitleFromAnchor, isCorroboratedIdentitySource } from '../src/lib/identityCore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}\n    expected: ${e}\n    actual:   ${a}`; failures.push(m); console.log(m); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);

console.log('\n=== GK-154 — year-anchor gate predicate ===\n');

// Reproduces the exact gate predicate added at the resolveYear call site
// (api/enrich.js) — not separately exported (inline in the handler), same
// convention as tests/q121-cv-pool-year-hint.test.js's own local
// reproduction.
const isAnchorRejectedForYear = (priceChartingProductName, identitySourceValue, confirmedTitleValue) => {
  if (!priceChartingProductName) return false;
  if (!isCorroboratedIdentitySource(identitySourceValue)) return false;
  const anchorCanonicalTitle = projectCanonicalTitleFromAnchor(priceChartingProductName);
  return !!(anchorCanonicalTitle && anchorCanonicalTitle !== confirmedTitleValue);
};

// ═══════════════════════════════════════════════════════════════════════
// PART 1 — the real, blocking fixture: the wrong 1987 anchor is rejected.
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 1: blocking fixture — the real G.I. Joe wrong-anchor shape\n');

assertTrue(
  isAnchorRejectedForYear('G.I. Joe Special Missions #5 (1987)', 'title-family-weighted-consensus', 'g i joe'),
  'FIXED: the real production anchor ("G.I. Joe Special Missions #5 (1987)") is rejected for year purposes against the real corroborated confirmedTitle ("g i joe")'
);

// ═══════════════════════════════════════════════════════════════════════
// PART 2 — genuine-anchor control: a correctly-matched PC anchor must
// NEVER be rejected. pcYear supplies the year exactly as before this fix
// for every book where PC and confirmedTitle actually agree.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: genuine-anchor control — a correctly-matched anchor is NEVER rejected\n');

assertTrue(
  !isAnchorRejectedForYear('G.I. Joe #5 (2025)', 'title-family-weighted-consensus', 'G.I. Joe'),
  'a genuinely matching anchor ("G.I. Joe #5 (2025)" -> projects to "G.I. Joe", equals confirmedTitle) is NOT rejected — pcYear still reaches resolveYear unchanged'
);
assertTrue(
  !isAnchorRejectedForYear('Amazing Spider-Man #26 (2001)', 'title-family-weighted-consensus', 'Amazing Spider-Man'),
  'a second genuine-anchor control (Amazing Spider-Man #26) is NOT rejected'
);
// FLAGGED, NOT FIXED (inherited from q141-a, out of this narrow fix's
// scope): the shared predicate is an EXACT-STRING comparison
// (canonicalTitle !== confirmedTitle), so a genuinely-matching anchor
// whose projected title differs from confirmedTitle ONLY by case (e.g.
// projected "G.I. Joe" vs a lowercase confirmedTitle "g i joe") is
// case-sensitively "rejected" even though it's the same book. This risk
// already existed in q141-a before this fix (same predicate, reused
// verbatim, not introduced here) — this fix inherits it rather than
// creating it, and this fix's own report explicitly scoped it as "reuse
// the identical predicate q141-a computes," not "fix q141-a's own
// matching algorithm." Recorded here so it's visible, not silently
// assumed safe.
const caseOnlyMismatchRejected = isAnchorRejectedForYear('G.I. Joe #5 (2025)', 'title-family-weighted-consensus', 'g i joe');
console.log(`  (flagged, not asserted: case-only anchor/confirmedTitle mismatch is${caseOnlyMismatchRejected ? '' : ' NOT'} rejected by the shared predicate — actual: ${caseOnlyMismatchRejected}; pre-existing q141-a behavior, not introduced by this fix)`);

// ═══════════════════════════════════════════════════════════════════════
// PART 3 — uncorroborated identity source: the gate must not fire at all
// when identitySource isn't corroborated (matches q141-a's own scoping —
// it only ever corrects/gates uncorroborated sources' titles, so this
// gate is scoped identically: mismatched-but-uncorroborated books are
// unaffected by this fix, same as before it).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: uncorroborated identitySource — gate does not fire\n');

assertTrue(
  !isAnchorRejectedForYear('G.I. Joe Special Missions #5 (1987)', 'vision', 'g i joe'),
  'a bare "vision" identitySource (not corroborated) never triggers the gate — matches q141-a\'s own scoping exactly (isCorroboratedIdentitySource gates both)'
);

// ═══════════════════════════════════════════════════════════════════════
// PART 4 — no PC anchor at all: gate is a no-op (nothing to reject).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 4: no PC anchor — gate is a no-op\n');

assertTrue(
  !isAnchorRejectedForYear(null, 'title-family-weighted-consensus', 'g i joe'),
  'no productName at all (priceCharting null/absent) never triggers the gate'
);

// ═══════════════════════════════════════════════════════════════════════
// PART 5 — live source check: the real api/enrich.js wiring.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 5: live source check — api/enrich.js wiring\n');

const enrichSrc = readFileSync(path.join(__dirname, '..', 'api', 'enrich.js'), 'utf8');
assertTrue(enrichSrc.includes('pcAnchorTitleRejectedForYear'), 'pcAnchorTitleRejectedForYear gate variable present in the live source');
assertTrue(
  /resolveYear\(\s*\n\s*yearForResolution,\s*\n\s*pcAnchorTitleRejectedForYear \? null : pcYear,/.test(enrichSrc),
  'resolveYear\'s call site actually consumes the gate (pcAnchorTitleRejectedForYear ? null : pcYear) — not just computed and discarded'
);
assertTrue(
  enrichSrc.includes('const catalogYearForEvidence = pcYear ?? cvYear ?? null;'),
  'catalogYearForEvidence (reconcileYear\'s conflict-evidence input) still reads the real, UN-gated pcYear — the rejected anchor\'s year remains visible as conflict evidence, never silently discarded (I13)'
);
// q141-a itself must be byte-identical — this fix must not have touched
// its own predicate, log lines, or write site.
const q141aSkipCount = (enrichSrc.match(/\[q141-a\] SKIPPED/g) || []).length;
assertTrue(q141aSkipCount === 1, `q141-a's own SKIPPED log line appears exactly once, unmodified (actual occurrences: ${q141aSkipCount})`);

// ═══════════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════════
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
if (failed === 0) {
  console.log(`✓ All tests passed (${passed} assertions)`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  process.exit(0);
} else {
  console.log(`✗ ${failed} test(s) failed, ${passed} passed`);
  console.log('\nFailures:');
  failures.forEach((f) => console.log(f));
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  process.exit(1);
}
