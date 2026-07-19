// tests/q117-cv-title-axis-field.test.js
//
// Q117 dispatch (2026-07-18) — the [22c] convergence-score title axis
// compared our confirmed series title against comicVine?.name, the
// ComicVine ISSUE record's own `name` field. Per ComicVine's schema that
// field is the story/chapter title, not the series name (the series name
// lives at comicVine.volume.name) — confirmed via real production logs
// across THREE unrelated books in the same scan sweep, all with a 100/100
// volume-name match score at the ComicVine lookup stage moments earlier:
//   - Batman #608 (2002, "Hush"): cv name="Hush Chapter One: The Ransom"
//   - Batman #215 (1969, "Call Me Master"): cv name="Los Apuros del Titere
//     Flash" (a translated/alternate-language issue name on the same record)
//   - Absolute Batman #1 (2025): cv name="Le Zoo"
// Every one of these produced `[22c] cv display suppressed — rejected on
// axes: title` and the misleading "content-unverified" / "story metadata
// rejected" warning on a card whose identity was otherwise fully correct —
// a false positive most likely to fire on exactly the notable, valuable
// keys worth naming a story arc for.
//
// Fix (api/enrich.js ~2806): comicVine?.name -> comicVine?.volume?.name,
// matching the pattern already used correctly elsewhere in the file
// (era-gate logging ~2899, UPC-lookup title resolution ~536).
//
// This test operates at the same level as tests/cv-scoring.test.js's FIX-3
// fixtures (computeConvergenceScore directly), but specifically exercises
// the FIELD-SELECTION question — what value api/enrich.js should feed as
// convergenceSources.title.cv given a realistic comicVine object shape
// { name, volume: { name } } — which the existing GSX/"Gone" fixtures
// don't cover (they pass a pre-selected `cv` string directly, bypassing
// the field-selection step entirely).
//
// Invoke: node tests/q117-cv-title-axis-field.test.js

import { computeConvergenceScore } from '../src/lib/convergenceScore.js';

let passed = 0;
let failed = 0;
const failures = [];

const assertTrue = (cond, label) => {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}`;
    failures.push(msg);
    console.log(msg);
  }
};

// Mirrors the exact field-selection line under test — api/enrich.js ~2806.
const OLD_cvTitleField = (comicVine) => comicVine?.name || null;
const NEW_cvTitleField = (comicVine) => comicVine?.volume?.name || null;

const titleAxisRejectsOnCv = (confirmedTitle, cvValue) => {
  const result = computeConvergenceScore(
    { title: confirmedTitle, issue: '1', era: 'vintage', publisher: 'DC Comics', grade: null },
    {
      title: { vision: confirmedTitle, cv: cvValue },
      issue: { vision: '1', cv: '1' },
      era: { vision: 'vintage' },
      publisher: { vision: 'DC Comics', cv: 'DC Comics' },
    }
  );
  return (result.axes.title?.rejections || []).some((r) => r.source === 'cv');
};

console.log('\n=== Q117 — CV TITLE AXIS FIELD FIX (Batman #608 "Hush" class) ===\n');

// ═══════════════════════════════════════════════════════════════════════
// PART A — three real production cases, reconstructed from actual Vercel
// runtime logs for this exact build. Each shows the ComicVine lookup
// itself found the CORRECT volume (100/100 name score) yet the OLD field
// selection still produced a false title-axis rejection.
// ═══════════════════════════════════════════════════════════════════════
console.log('Part A: real production cases — OLD field falsely rejects, NEW field correctly passes\n');

const CASES = [
  {
    label: 'Batman #608 (2002, "Hush")',
    confirmedTitle: 'Batman',
    comicVine: { name: 'Hush Chapter One: The Ransom', volume: { name: 'Batman' } },
  },
  {
    label: 'Batman #215 (1969, "Call Me Master")',
    confirmedTitle: 'batman',
    comicVine: { name: 'Los Apuros del Titere Flash', volume: { name: 'Batman' } },
  },
  {
    label: 'Absolute Batman #1 (2025)',
    confirmedTitle: 'absolute batman',
    comicVine: { name: 'Le Zoo', volume: { name: 'Absolute Batman' } },
  },
];

for (const c of CASES) {
  const oldCv = OLD_cvTitleField(c.comicVine);
  const newCv = NEW_cvTitleField(c.comicVine);
  const oldRejects = titleAxisRejectsOnCv(c.confirmedTitle, oldCv);
  const newRejects = titleAxisRejectsOnCv(c.confirmedTitle, newCv);

  assertTrue(oldRejects, `${c.label}: OLD field (comicVine.name="${oldCv}") reproduces the false rejection`);
  assertTrue(!newRejects, `${c.label}: NEW field (comicVine.volume.name="${newCv}") — no false rejection, matches confirmed title "${c.confirmedTitle}"`);
}

// ═══════════════════════════════════════════════════════════════════════
// PART B — genuine mismatch must still be caught. The fix changes WHICH
// field is compared, not whether mismatches are detected — a book whose
// ComicVine VOLUME itself is wrong (not just its story-arc name) must
// still trigger the warning. Reuses the exact GSX/"Gone" shape from
// tests/cv-scoring.test.js's FIX-3 fixture, now via the volume.name path.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart B: genuine title mismatch (wrong volume, not just wrong story-arc name) still rejects\n');

const genuineMismatch = {
  confirmedTitle: 'Giant-Size X-Men',
  comicVine: { name: 'Some Story Arc Name', volume: { name: 'Gone' } }, // wrong SERIES, not just wrong story title
};
const newCvGenuine = NEW_cvTitleField(genuineMismatch.comicVine);
assertTrue(
  titleAxisRejectsOnCv(genuineMismatch.confirmedTitle, newCvGenuine),
  `Giant-Size X-Men vs wrong CV volume ("${newCvGenuine}") — NEW field still correctly rejects a genuine mismatch`
);

// ═══════════════════════════════════════════════════════════════════════
// PART C — control: CV volume genuinely matches (no story-arc name at
// all, or a title with no distinct story title) — no rejection, unaffected
// by the fix either way.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart C: control — CV volume genuinely matches, unaffected by the fix\n');

const cleanBook = {
  confirmedTitle: 'Amazing Spider-Man',
  comicVine: { name: null, volume: { name: 'Amazing Spider-Man' } }, // no story-arc name at all
};
assertTrue(
  !titleAxisRejectsOnCv(cleanBook.confirmedTitle, NEW_cvTitleField(cleanBook.comicVine)),
  'Amazing Spider-Man, no story-arc name on the CV record — no rejection'
);
// Confirms the OLD field would ALSO have been fine here (null name, not a
// false-positive case) — this class of book was never affected, isolating
// exactly which books the bug hit (ones with a populated story-arc name).
assertTrue(
  !titleAxisRejectsOnCv(cleanBook.confirmedTitle, OLD_cvTitleField(cleanBook.comicVine)),
  'same book, OLD field — also no rejection (confirms bug was specific to named-arc issues, not universal)'
);

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
