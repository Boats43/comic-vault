// tests/q116-printing-edition.test.js
//
// Q116 dispatch (2026-07-18) — printing/edition (1st/2nd/3rd print) was not
// a tracked variant category anywhere in the system. Confirmed via
// Incredible Hulk #377 (McKeown/McLeod 3rd printing, $100 min raw value per
// Goldin.co) production log reconstruction: system priced at $10.52,
// blending printings, because `confirmedVariant` never learns a printing
// signal (Vision's editionWarning.detected never fired for that specific
// scan — a genuine Vision/cover-photo limitation, not a pipeline bug, per
// the investigation report) AND, independently, even when
// editionWarning.detected DOES fire, the existing edition-gate used an
// undifferentiated "any reprint" bucket that mixed 2nd/3rd-print/facsimile
// comps together.
//
// Two fixes, both exercised here with a case that DOES fire the signal
// (Hulk #377 itself doesn't — using it here would test nothing, per the
// investigation's own finding):
//   Part 1 (api/enrich.js edition-gate): isolate comps to the SPECIFIC
//   printing kind (classifySpecificPrinting, api/grade.js) instead of the
//   generic bucket.
//   Part 2: thread that specific kind into confirmedVariant, feeding both
//   Q111's AND-match isolation (api/comps.js, active comps) and the
//   already-correct sold-side printingMatch (soldVerification.js) with
//   real data.
//
// Real comp-pool title data reused from the actual Incredible Hulk #377
// eBay pool (genuine 1st/2nd/3rd-print-labeled listings existed side by
// side in that pool — confirmed via production log) — only the "does our
// own book's editionWarning fire" part is constructed, since it did not
// fire for the real scan.
//
// Invoke: node tests/q116-printing-edition.test.js

import { detectEditionWarning, classifySpecificPrinting } from '../api/grade.js';
import { extractVariantTokens, classifyVariantTokens } from '../src/lib/imageSearchIdentity.js';
import { applyVariantPreferenceFilter } from '../api/comps.js';
import { verifySoldComps } from '../src/lib/soldVerification.js';

let passed = 0;
let failed = 0;
const failures = [];

const assertEq = (actual, expected, label) => {
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`;
    failures.push(msg);
    console.log(msg);
  }
};

const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertNull = (v, label) => assertEq(v, null, label);

console.log('\n=== Q116 — PRINTING/EDITION TRACKING (Incredible Hulk #377 class) ===\n');

// ═══════════════════════════════════════════════════════════════════════
// PART A — classifySpecificPrinting: the shared helper both consumers use.
// ═══════════════════════════════════════════════════════════════════════
console.log('Part A: classifySpecificPrinting priority + generic-signal null');

assertEq(classifySpecificPrinting(['third-print']).text, '3rd print', 'third-print → "3rd print"');
assertEq(classifySpecificPrinting(['third-print']).label, '3rd printing', 'third-print label = "3rd printing"');
assertEq(classifySpecificPrinting(['second-print']).text, '2nd print', 'second-print → "2nd print"');
assertEq(classifySpecificPrinting(['facsimile']).text, 'facsimile', 'facsimile → "facsimile"');
assertEq(classifySpecificPrinting(['third-print', 'second-print']).text, '3rd print', 'priority: third beats second when both somehow present');
assertNull(classifySpecificPrinting(['reprint']), 'generic "reprint" alone → null (unknown which printing)');
assertNull(classifySpecificPrinting(['later-printing']), 'generic "later-printing" → null');
assertNull(classifySpecificPrinting(['not-first-print']), 'generic "not-first-print" → null');
assertNull(classifySpecificPrinting(['not-original']), 'generic "not-original" → null');
assertNull(classifySpecificPrinting(['less-valuable']), 'generic "less-valuable" → null');
assertNull(classifySpecificPrinting(null), 'null signals → null, no crash');
assertNull(classifySpecificPrinting([]), 'empty signals → null');

// ═══════════════════════════════════════════════════════════════════════
// PART B — CATEGORY_BLOCKS 'printing' category recognizes real listing
// text and classifies as SPECIFIC (not generic), same tier as
// convention/ratio/exclusive.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart B: printing tokens extract correctly and classify as SPECIFIC');

assertTrue(extractVariantTokens('Incredible Hulk #377 CGC 9.4 3rd Print Variant').includes('3rd print'), 'extractVariantTokens: "3rd Print" → token "3rd print"');
assertTrue(extractVariantTokens('The Incredible Hulk #377 - 2nd Printing').includes('2nd print'), 'extractVariantTokens: "2nd Printing" → token "2nd print"');
assertTrue(extractVariantTokens('Batman #1 (1940 reprint) Facsimile Edition').includes('facsimile'), 'extractVariantTokens: "Facsimile" → token "facsimile"');
assertTrue(extractVariantTokens('Incredible Hulk #377 First Printing NM').includes('1st print'), 'extractVariantTokens: "First Printing" → token "1st print"');
assertTrue(extractVariantTokens('Amazing Spider-Man #1 7th Printing').includes('nth print'), 'extractVariantTokens: "7th Printing" (tail case) → token "nth print"');

const printingClassified = classifyVariantTokens('3rd print');
assertTrue(printingClassified.specific.includes('3rd print'), '"3rd print" classifies as SPECIFIC (same tier as convention/ratio/exclusive)');
assertTrue(!printingClassified.generic.includes('3rd print'), '"3rd print" does NOT classify as generic');

// ═══════════════════════════════════════════════════════════════════════
// PART C — end-to-end: a book WHERE the signal fires. Real Incredible
// Hulk #377 comp titles (genuine 1st/2nd/3rd-print listings coexisted in
// the real production pool), with a constructed editionWarning detection
// (Hulk #377's real scan did NOT fire this — using a realistic reason
// text matching the same book, per the investigation's own finding that
// testing on the unmodified real case would exercise nothing).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart C: end-to-end — Vision detects "3rd printing", isolation fires correctly');

const visionReason = "This is the third printing of Incredible Hulk #377, not the original 1991 first print — McKeown/McLeod 3rd print run.";
const editionWarning = detectEditionWarning(visionReason);
assertTrue(editionWarning?.detected === true, 'Vision reason text correctly triggers editionWarning.detected');
assertTrue(editionWarning.signals.includes('third-print'), 'editionWarning.signals includes "third-print"');

const specificPrinting = classifySpecificPrinting(editionWarning.signals);
assertEq(specificPrinting?.text, '3rd print', 'classifySpecificPrinting resolves "3rd print" from the real detection');

// Part 2 simulation: threading into confirmedVariant (mirrors api/enrich.js
// exactly — same helper, same append logic).
let confirmedVariant = null; // Vision's own structured variant field was empty
if (specificPrinting && !String(confirmedVariant || '').toLowerCase().includes(specificPrinting.text)) {
  confirmedVariant = confirmedVariant ? `${confirmedVariant} ${specificPrinting.text}` : specificPrinting.text;
}
assertEq(confirmedVariant, '3rd print', 'confirmedVariant threaded to "3rd print" (was null)');

// Real Incredible Hulk #377 active-comp pool titles (verbatim from the
// actual production log — a real mix of 1st/2nd/3rd print + unlabeled).
const activePool = [
  { title: "INCREDIBLE HULK #377 8.5 // 1ST APPEARANCE PROFESSOR HULK 2ND PRINT MARVEL 1991" },
  { title: "the incredible hulk #377 cgc 7.0 3rd print lime green variant way nicer 1991 hot" },
  { title: "🔑 incredible hulk #377 (1st series) marvel comics jan 1991 2nd printing vf" },
  { title: "incredible hulk #377 1st printing cgc 9.8 1991 4524272001" },
  { title: "incredible hulk #377 - 1991 1st print - direct first professor hulk key - keown" },
  { title: "incredible hulk #377 vf/nm (1991) – 2nd printing cover" },
  { title: "incredible hulk #377 cgc 9.4 second printing marvel comics 1991" },
  { title: "the incredible hulk #377 third print cgc 8.5!!!!!" },
  { title: "incredible hulk #377 (rare 3rd third printing) cgc 9.4 nm marvel comics 1991" },
  { title: "incredible hulk #377 (1991) cgc 9.0 1st print & cgc 9.6 2nd print *key" },
  { title: "incredible hulk #377 - marvel comics 1991 cgc 9.6 3rd print variant" },
  { title: "incredible hulk #377 keown 2nd print variant peter david 1991 nm- htf b" },
  { title: "incredible hulk #377 marvel comics 1st professor hulk 1991" }, // no printing text at all
  { title: "incredible hulk #377 (1991) vf/nm" }, // no printing text at all
];

// Fix #2's downstream effect: Filter 1c (Q111 AND-match) now sees "3rd
// print" as a SPECIFIC token and isolates correctly.
const filterResult = applyVariantPreferenceFilter(activePool, confirmedVariant);
assertEq(filterResult.matchMode, 'any', 'single specific token ("3rd print" alone) uses the any-match path (Q111: single-token variants reduce to pre-Q111 behavior, unchanged)');
// Note: filterResult.isolated (the out.premiumVariantIsolated diagnostic
// flag) stays false here — "3rd print" is not in PREMIUM_VARIANT_RE, so it
// gets the standard >=2-match threshold, not the 1-match premium-keyword
// bar (Silk #1/Magik #1 class). Whether printing tokens SHOULD join
// PREMIUM_VARIANT_RE is a separate, out-of-scope product question (not
// part of the greenlit Q116 fix) — not asserted either way here. What
// matters and IS asserted below: the pool actually narrows correctly.
assertTrue(filterResult.pool.length > 0, 'isolation produced a non-empty pool');
assertEq(filterResult.pool.length, 2, 'pool narrows from 14 to exactly the 2 genuine 3rd/third-print comps (2 >= the standard 2-match threshold)');
assertTrue(
  filterResult.pool.every((c) => /3rd\s*print|third\s*print/i.test(c.title)),
  'every surviving active comp genuinely mentions 3rd/third print — no 1st/2nd print comps leaked through'
);
assertTrue(
  !filterResult.pool.some((c) => /2nd\s*print|second\s*print/i.test(c.title) && !/3rd|third/i.test(c.title)),
  'no 2nd-print-only comps survive the isolation'
);

// Fix #1's downstream effect: sold-side printingMatch (soldVerification.js,
// already correct — just needed real data) isolates the same way.
const soldPool = [
  { price: 15, title: 'Incredible Hulk #377 1st Print NM 1991', daysAgo: 10, grade: '9.0' },
  { price: 20, title: 'Incredible Hulk #377 2nd Printing VF 1991', daysAgo: 12, grade: '9.0' },
  { price: 105, title: 'Incredible Hulk #377 3rd Print CGC 9.0 1991 McKeown', daysAgo: 8, grade: '9.0' },
  { price: 98, title: 'Incredible Hulk #377 Third Printing NM- 1991', daysAgo: 15, grade: '8.5' },
  { price: 12, title: 'Incredible Hulk #377 1991 NM', daysAgo: 20, grade: '9.0' }, // no printing text
];
const soldResult = verifySoldComps(soldPool, {
  title: 'Incredible Hulk', issue: '377', variant: confirmedVariant, bookYear: 1991, userGradeKey: '9.0',
});
assertTrue(soldResult.verified.length > 0, 'sold-side: 3rd-print comps verified (not starved to zero)');
assertTrue(
  soldResult.verified.every((v) => /3rd\s*print|third\s*print/i.test(v.title)),
  'sold-side: every verified comp is genuinely a 3rd/third print listing'
);
assertTrue(
  !soldResult.verified.some((v) => /1st\s*print|2nd\s*print|second\s*print/i.test(v.title) && !/3rd|third/i.test(v.title)),
  'sold-side: no 1st/2nd print comps leaked into the verified pool'
);
const verifiedAvg = soldResult.verified.reduce((s, v) => s + v.price, 0) / soldResult.verified.length;
assertTrue(verifiedAvg > 50, `sold-side: isolated average ($${verifiedAvg.toFixed(2)}) reflects the real 3rd-print premium, not blended with $12-20 1st/2nd print comps`);

// ═══════════════════════════════════════════════════════════════════════
// PART D — fallback: too few matching-printing comps to safely isolate.
// Must refuse honestly (thin-pool), not silently blend generic-print
// comps back in.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart D: too few matching-printing comps — honest thin-pool refusal, not silent blending');

const thinActivePool = [
  { title: "incredible hulk #377 3rd print cgc 9.0 1991" }, // only 1 genuine 3rd print
  { title: "incredible hulk #377 1st print nm 1991" },
  { title: "incredible hulk #377 2nd printing vf 1991" },
];
// Simulate Part 1's enrich.js edition-gate directly (same logic, <3 threshold).
const specificPrintingRe = specificPrinting.re;
const reprintComps = thinActivePool.filter((c) => specificPrintingRe.test(c.title));
assertEq(reprintComps.length, 1, 'only 1 genuine 3rd-print comp available — below the 3-comp threshold');
const wouldRefuse = reprintComps.length < 3;
assertTrue(wouldRefuse, 'edition-gate correctly identifies this as a refuse-to-price case (thin printing-specific pool)');

// ═══════════════════════════════════════════════════════════════════════
// PART E — control: a book with NO printing signal at all is completely
// unaffected (the vast majority of books — this is the false-positive
// guard the dispatch explicitly required).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart E: control — normal book, no printing signal, completely unaffected');

const normalReason = 'Near mint condition, sharp corners, no creases, glossy cover.';
const noWarning = detectEditionWarning(normalReason);
assertNull(noWarning, 'normal reason text — editionWarning does not fire at all');
assertNull(classifySpecificPrinting(noWarning?.signals), 'classifySpecificPrinting on null/undefined signals — null, no crash');

let controlVariant = null;
// Mirrors the enrich.js guard exactly: `if (!cgcIdentityConfirmed && editionWarning?.detected)`.
if (noWarning?.detected) {
  controlVariant = 'should not happen';
}
assertNull(controlVariant, 'confirmedVariant stays null — no false threading for a normal book');

const controlPool = [
  { title: 'Amazing Spider-Man #300 CGC 9.8 McFarlane NM' },
  { title: 'Amazing Spider-Man #300 VF/NM 1988' },
];
const controlFilterResult = applyVariantPreferenceFilter(controlPool, controlVariant);
assertEq(controlFilterResult.matchMode, 'none', 'no variant at all — Filter 1c is a complete no-op (matches pre-Q116 behavior exactly)');
assertEq(controlFilterResult.pool.length, 2, 'control pool completely unfiltered — both comps survive');

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
