// tests/grailkey-commit-r.test.js
//
// GrailKey Commit R — the two residual TPB_MARKER_RE collision sites Q1c
// found and reported but deliberately did not migrate, per that dispatch's
// explicit scope.
//
//   R1 — api/comps.js's "non-tpb-format filter" (Q135 dispatch branch,
//        assetType !== 'book' && !isTPB): independently tests COMP titles
//        against the loose TPB_MARKER_RE to exclude hardcovers/omnibuses
//        from a single-issue pool. Every "Absolute Batman" comp matched
//        the loose form regardless of format, so nonTpbFiltered was ALWAYS
//        empty for that book, and the graceful-fallback-to-keep-all
//        silently admitted every hardcover/omnibus it exists to exclude.
//        Migrated to IDENTITY_TPB_MARKER_RE — confirmed (report before
//        changing) that migrating this one site is sufficient; the
//        fallback condition itself was never broken, only fed a garbage
//        classification.
//
//   R2 — hasContaminatedMember (compHygiene.js), shared by three real call
//        sites (identityCore.js's Commit 4.3 retention gate,
//        issueAuthority.js's Commit P1 gate, imageSearchIdentity.js's
//        mergeFragmentedTitleFamilies) — investigated (report before
//        changing): all three use it for the identical purpose ("is this
//        row a lot/reprint/slab/graded/signed/TPB listing," i.e. not a
//        genuine floppy that should count toward family coherence). None
//        of the three wants a bare "absolute" match — the loose form was
//        never the intended check at any site, so the fix is made once,
//        at the single shared function, rather than three independently-
//        migrated call sites.
//
// R1's real call site is embedded inside api/comps.js's large stateful
// comp-fetch loop (not an independently invokable pure function) — same
// limitation Commit P's own P-5/P-6 tests document for App.jsx render
// sites. Asserted here is the REAL exported IDENTITY_TPB_MARKER_RE the
// real call site now uses, applied with the identical predicate shape.
// R2's hasContaminatedMember IS directly exported and testable end-to-end.
//
// Invoke: node tests/grailkey-commit-r.test.js

import { IDENTITY_TPB_MARKER_RE, TPB_MARKER_RE, hasContaminatedMember } from '../src/lib/compHygiene.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertFalse = (cond, label) => assertEq(!!cond, false, label);

console.log('\n=== GrailKey Commit R — Filter 1h (non-tpb-format) + hasContaminatedMember ===\n');

// ══════════════════════════════════════════════════════════════════════════════
// R1 — api/comps.js "non-tpb-format filter" (the real call site's exact
// predicate: `p.filter((item) => !IDENTITY_TPB_MARKER_RE.test(item.title))`)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nR1 — non-tpb-format filter predicate\n');
{
  const nonTpbFilter = (titles) => titles.filter((t) => !IDENTITY_TPB_MARKER_RE.test(t));

  const pool = [
    'Absolute Batman #1 Snyder Dragotta Cover A NM+',       // genuine floppy — survive
    'Absolute Batman #1 7th Print Snyder Dragotta',         // genuine floppy — survive
    'Absolute Batman: The Zoo [Hardcover] #1',              // named in the dispatch — must exclude
    'Absolute Batman Haunted Knight (2025 Edition) HC',     // named in the dispatch — must exclude
  ];
  const survivors = nonTpbFilter(pool);
  assertEq(survivors.length, 2, 'R1: both hardcover/HC listings excluded, both genuine floppies survive');
  assertTrue(survivors.every((t) => !/hardcover/i.test(t) && !/\bhc\b/i.test(t)), 'R1: no hardcover/HC title survives');
  assertFalse(survivors.includes('Absolute Batman: The Zoo [Hardcover] #1'), 'R1: "The Zoo [Hardcover] #1" specifically excluded');
  assertFalse(survivors.includes('Absolute Batman Haunted Knight (2025 Edition) HC'), 'R1: "Haunted Knight (2025 Edition) HC" specifically excluded');

  // MUTATION — verbatim pre-Commit-R predicate (the loose TPB_MARKER_RE),
  // run against the identical fixture.
  const naiveNonTpbFilter = (titles) => titles.filter((t) => !TPB_MARKER_RE.test(t));
  const naiveSurvivors = naiveNonTpbFilter(pool);
  assertEq(naiveSurvivors.length, 0, 'MUTATION: the naive pre-fix predicate (TPB_MARKER_RE) excludes all 4 rows, including both genuine floppies — reproduces the fallback-to-keep-all-then-everything-is-excluded shape (nonTpbFiltered.length === 0 for a real Absolute pool)');
  assertTrue(survivors.length > naiveSurvivors.length, 'MUTATION CONTRAST: the REAL post-fix predicate correctly separates format, the naive one cannot');
}

// ══════════════════════════════════════════════════════════════════════════════
// R2 — hasContaminatedMember, real end-to-end calls at all three call sites'
// shared function
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nR2 — hasContaminatedMember\n');
{
  const absoluteBatmanFamily = [
    { rawTitle: 'Absolute Batman #1 Snyder Dragotta Cover A NM+' },
    { rawTitle: 'ABSOLUTE BATMAN #1 CVR A NICK DRAGOTTA NM DC COMICS SNYDER' },
    { rawTitle: 'Absolute Batman #1 DC Comics Snyder Dragotta' },
  ];
  assertFalse(
    hasContaminatedMember(absoluteBatmanFamily, [0, 1, 2]),
    'R2: a family whose members are titled "Absolute Batman #1 ..." is NOT flagged contaminated (was wrongly true before this fix — every member matched TPB_MARKER_RE\'s bare "absolute")'
  );

  const mixedFamily = [
    { rawTitle: 'Absolute Batman #1 Snyder Dragotta Cover A NM+' },
    { rawTitle: 'Absolute Batman #1 DC Comics Snyder Dragotta' },
    { rawTitle: 'Absolute Batman: The Zoo [Hardcover] #1' }, // genuine TPB/collected-edition member
  ];
  assertTrue(
    hasContaminatedMember(mixedFamily, [0, 1, 2]),
    'R2: a family genuinely mixing a TPB/collected-edition member with floppies IS still flagged contaminated'
  );

  // Confirm the OTHER five contamination axes (lot/reprint/slab/graded/
  // signed) are completely unaffected — this fix only touches the TPB leg.
  assertTrue(hasContaminatedMember([{ rawTitle: 'Batman #1, #2, #3 Lot' }], [0]), 'R2: lot detection unaffected');
  assertTrue(hasContaminatedMember([{ rawTitle: 'Batman #1 CGC 9.8' }], [0]), 'R2: slab detection unaffected');
  assertTrue(hasContaminatedMember([{ rawTitle: 'Batman #1 Signed by Snyder' }], [0]), 'R2: signed detection unaffected');
  assertFalse(hasContaminatedMember([{ rawTitle: 'Batman #1 NM' }], [0]), 'R2: an ordinary clean single-issue title is never flagged');

  // MUTATION — verbatim pre-Commit-R body (TPB_MARKER_RE, not
  // IDENTITY_TPB_MARKER_RE) run against the identical family fixture.
  const naiveHasContaminatedMember = (visualItems, indices) => {
    const LOT_LOOSE = /\b(lot|bundle|complete\s*set|full\s*run|comic\s*library|comic\s*collection)\b/i;
    for (const idx of indices) {
      const raw = String(visualItems?.[idx]?.rawTitle || '');
      if (LOT_LOOSE.test(raw) || TPB_MARKER_RE.test(raw)) return true;
    }
    return false;
  };
  assertTrue(
    naiveHasContaminatedMember(absoluteBatmanFamily, [0, 1, 2]),
    'MUTATION: the naive pre-fix predicate (TPB_MARKER_RE) wrongly flags the clean Absolute Batman family as contaminated — reproduces the latent P1/retention-gate coupling bug'
  );
  assertFalse(
    hasContaminatedMember(absoluteBatmanFamily, [0, 1, 2]),
    'MUTATION CONTRAST: the REAL post-fix hasContaminatedMember correctly clears the identical family'
  );
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  console.log('Failures:\n' + failures.join('\n\n'));
}
process.exit(failed > 0 ? 1 : 0);
