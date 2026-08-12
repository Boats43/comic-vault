// tests/grailkey-directive-h-item1-stale-pc-anchor.test.js
//
// GrailKey Directive H, Item 1 (2026-08-11). Directive G Task 2 shipped
// out.pcAnchorTrust/pcAnchorYear, stamped server-side only when a PC
// record exists (api/enrich.js: `if (priceCharting) { out.pcAnchorTrust
// = ...; }`) -- absence means annotated, per Task 2 item 5. But the
// client-side merge at 6 of 7 explicit src/App.jsx sites read
// `enrich.pcAnchorTrust ?? cur.pcAnchorTrust ?? null` -- when a later
// scan's enrich response carries no PC anchor at all (undefined), the
// `??` falls through to the OLD item's value, resurrecting a stale
// EXACT_EDITION verdict the current scan never re-verified. Same shape
// as GK-73's third finding (api/enrich.js:6240-6244, ebaySourceUnavailable
// stale-true survival) -- now named as mechanism (c), Stale Authority
// Inheritance, in the Pattern Library's Authority Propagation Invariant
// entry.
//
// The 8th site, buildCorrectedCatalogueItem (src/lib/manualCorrection.js),
// merges by full spread (`{...cleared, ...enrichData}`) rather than `??`
// fallback -- a DIFFERENT mechanism producing the SAME symptom: when
// enrichData omits the key entirely (JSON drops undefined-valued
// properties), the spread never overwrites `cleared`'s value, so
// `cleared.pcAnchorTrust`/`pcAnchorYear` (= the OLD item's stale values,
// since these fields are not auto-nulled unless clear-listed) survive.
// pcAnchorTrust was already clear-listed (Commit E1, 2026-07-29, before
// Directive G Task 2 existed); pcAnchorYear -- new in Task 2 -- was not.

import { buildCorrectedCatalogueItem } from '../src/lib/manualCorrection.js';

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}\nExpected: ${expected}\nActual: ${actual}`);
  }
}

// ─────────────────────────────────────────────────────────────────
// (1) The 7 explicit App.jsx merge-site expressions, mirrored literally.
//     Not independently importable (inline JSX) -- these mirror the exact
//     shape at src/App.jsx:10310/10832/10956/11333/11877/12873 (post-fix)
//     against the pre-fix shape those lines carried in commit 26d5cf6,
//     side by side on the same fixture.
// ─────────────────────────────────────────────────────────────────

function preFixMerge(enrich, cur) {
  // The exact expression shipped in 26d5cf6, before this directive.
  return enrich.pcAnchorTrust ?? cur.pcAnchorTrust ?? null;
}

function postFixMerge(enrich, cur) {
  // The exact expression after this directive's fix.
  return enrich.pcAnchorTrust ?? null;
}

test('PRE-FIX mirror: a fresh enrich with no PC anchor resurrects the OLD EXACT_EDITION verdict (the bug)', () => {
  const cur = { pcAnchorTrust: 'EXACT_EDITION', pcAnchorYear: 1996 };
  const enrich = { title: 'Bone', issue: '1' }; // no PC match this scan -- pcAnchorTrust absent
  assertEqual(preFixMerge(enrich, cur), 'EXACT_EDITION',
    'Documents the actual pre-fix production defect: the old value survives a scan with no current PC evidence backing it.');
});

test('POST-FIX mirror: the same inputs no longer resurrect the stale verdict', () => {
  const cur = { pcAnchorTrust: 'EXACT_EDITION', pcAnchorYear: 1996 };
  const enrich = { title: 'Bone', issue: '1' };
  assertEqual(postFixMerge(enrich, cur), null,
    'A missing pcAnchorTrust on the fresh response must merge to null/absent, never inherit the prior scan\'s verdict.');
});

test('POST-FIX mirror: a fresh EXACT_EDITION verdict still merges through correctly (positive control)', () => {
  const cur = { pcAnchorTrust: 'COMPATIBLE_REFERENCE', pcAnchorYear: 1991 };
  const enrich = { pcAnchorTrust: 'EXACT_EDITION', pcAnchorYear: 1996 };
  assertEqual(postFixMerge(enrich, cur), 'EXACT_EDITION',
    'The fix must not block a genuinely fresh EXACT_EDITION verdict from taking effect.');
});

// ─────────────────────────────────────────────────────────────────
// (2) The 8th site -- buildCorrectedCatalogueItem, real function, real
//     import, no mirroring needed.
// ─────────────────────────────────────────────────────────────────

test('buildCorrectedCatalogueItem: stale pcAnchorTrust does not survive a correction with no PC match', () => {
  const oldItem = { id: 'x1', title: 'Bone', issue: '1', pcAnchorTrust: 'EXACT_EDITION', pcAnchorYear: 1996 };
  const enrichData = { title: 'Bone', issue: '1', confirmedYear: 1996 }; // no PC fields at all
  const result = buildCorrectedCatalogueItem(oldItem, enrichData);
  if (result.pcAnchorTrust === 'EXACT_EDITION') {
    throw new Error(`Stale EXACT_EDITION survived a manual correction with no PC match. Got: ${JSON.stringify(result.pcAnchorTrust)}`);
  }
});

test('buildCorrectedCatalogueItem: stale pcAnchorYear does not survive a correction with no PC match (the actual gap this item fixes)', () => {
  const oldItem = { id: 'x1', title: 'Bone', issue: '1', pcAnchorTrust: 'EXACT_EDITION', pcAnchorYear: 1996 };
  const enrichData = { title: 'Bone', issue: '1', confirmedYear: 1996 };
  const result = buildCorrectedCatalogueItem(oldItem, enrichData);
  if (result.pcAnchorYear === 1996) {
    throw new Error(`Stale pcAnchorYear (1996) survived a manual correction whose fresh response carries no PC anchor at all. Got: ${JSON.stringify(result.pcAnchorYear)}`);
  }
});

test('buildCorrectedCatalogueItem: a genuinely fresh PC anchor still comes through correctly (positive control)', () => {
  const oldItem = { id: 'x1', title: 'Bone', issue: '1', pcAnchorTrust: 'COMPATIBLE_REFERENCE', pcAnchorYear: 1991 };
  const enrichData = { title: 'Bone', issue: '1', confirmedYear: 1996, pcAnchorTrust: 'EXACT_EDITION', pcAnchorYear: 1996 };
  const result = buildCorrectedCatalogueItem(oldItem, enrichData);
  assertEqual(result.pcAnchorTrust, 'EXACT_EDITION', 'A fresh EXACT_EDITION verdict must still merge through');
  assertEqual(result.pcAnchorYear, 1996, 'A fresh pcAnchorYear must still merge through');
});

// ─────────────────────────────────────────────────────────────────

console.log('\n=== GrailKey Directive H, Item 1 -- stale PC anchor inheritance ===\n');
for (const t of tests) {
  try {
    t.fn();
    console.log(`  ✓ ${t.name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${t.name}`);
    console.log(`    ${err.message.split('\n').join('\n    ')}`);
    failed++;
  }
}
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exitCode = 1;
