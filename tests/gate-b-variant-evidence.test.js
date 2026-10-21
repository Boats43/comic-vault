// GATE B (2026-10-20) -- exact-variant evidence for a confirmed ratio variant (1:25), src/lib/priceBands.js.
//
// FIXTURES ARE REAL: the 16 regular-cover asks are the exact `rawComps` pool stored on the Production Old Man Logan #25 row (observed 2026-10-16T03:23:23Z, eleven seconds
// BEFORE the first variant correction at 03:23:34Z); the 5 variant asks are the stored `comps.recentSales` titles/prices of the same row (the sixth stored ask is not
// in the retained sample, so it is not invented here).
// PRODUCTION LOG EVIDENCE (Vercel runtime logs, 2026-10-16): passes at 03:57:57Z and 03:58:16Z priced `market=4.18 count=16` with the variant already confirmed, as the notation
// "1/25" (the operator's confirmed variant moved between "1/25" and "1:25"); eBay titles say "1:25", so (inference) the upstream variant preference did not narrow the pool. Case 5 below uses "1/25"
// on purpose. The pass at 03:58:31-34Z used "1:25", narrowed to 6 and returned $15.10.
//
// Before this change a confirmed variant only switched the variant-contamination reject OFF, so the 16 regular covers produced a Tier-3 band of $4.18 for a book whose
// variant asks run $15-25. Now a ratio variant requires listings whose own title names the SAME ratio; fewer than 3 such listings -> no band and an explicit insufficiency
// diagnostic (api/enrich.js turns that into the labelled refusal `refused-variant-evidence-insufficient`). The engine never invents a band.
//
// NEGATIVE CONTROL: set PRICEBANDS_UNDER_TEST to a copy of the pre-change module; the assertions about the new behavior must then FAIL.
// Invoke: node tests/gate-b-variant-evidence.test.js
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = process.env.PRICEBANDS_UNDER_TEST ? pathToFileURL(path.resolve(process.env.PRICEBANDS_UNDER_TEST)).href : pathToFileURL(path.join(here, '..', 'src', 'lib', 'priceBands.js')).href;
const mod = await import(target);
const { computePriceBands } = mod;
const ratioHelpersExist = typeof mod.getRatioVariantN === 'function';

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
const quiet = async (fn) => { const o = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = o; } };

const REGULAR = [
  [5.99, 'Old Man Logan #25 Mike Deodato Jr. (Marvel Comics August 2017)'], [2.5, 'Old Man Logan: Days of Anger #25 - Marvel 2017 Mike Deodato Jr. (Wolverine) VFNM'],
  [10, 'OLD MAN LOGAN #25 1st Print vs MAESTRO Marvel Comics 2017 WOLVERINE'], [4.24, 'Old Man Logan (2nd Series) #25 NM 9.4 2017  Mike Deodato Jr. Cover'],
  [4.24, 'Old Man Logan #25 NM+ 2017 Marvel Comics'], [3.35, 'OLD MAN LOGAN #25 MARVEL COMICS "B3"'], [3.99, 'OLD MAN LOGAN #25'], [9.99, 'Old Man Logan #25 Marvel Comics'],
  [3.3, 'Old Man Logan #25 NM (2017) Marvel Comics'], [3.96, 'OLD MAN LOGAN (2016 MARVEL) #25'], [2.99, 'Old Man Logan #25 (2017) NM Ed Brisson Marvel Comics'],
  [2.99, 'Old Man Logan #25 (2017) Old Man Logan Mint'], [4.63, 'OLD MAN LOGAN #25 (MARVEL 2017) "NEW UNREAD"'], [5, 'Old Man Logan #25 Main Cover 2017, Marvel NM'],
  [6.58, 'Old Man Logan #25 (NM) `17 Brisson/ Deodato  (1st Print)'], [4.92, 'Old Man Logan #25 Marvel Comics'],
].map(([price, title]) => ({ price, title }));
const VARIANT = [
  [15, 'Marvel Comics OLD MAN LOGAN #25 Mike Deodato 1:25 Variant Cover 2017 NM!'], [14.99, 'OLD MAN LOGAN #25 - Marvel Comics Mike Deodato Jr 1:25 Variant Cover'],
  [19.99, 'Old Man Logan #25 1:25 Mike Deodato Variant Marvel 2016 VF/NM'], [14.99, 'Old Man Logan #25 1:25 Deodato Teaser Variant 2017 NM-/NM'],
  [24.99, 'Old Man Logan #25 - 1:25 Mike Deodato variant Cover - Maestro app - NM- - Marvel'],
].map(([price, title]) => ({ price, title }));

const bands = async (rows, variant, extra = {}) => {
  const diagnostics = {};
  const result = await quiet(() => computePriceBands({
    soldComps: [], activeComps: { prices: rows }, pcBase: null, gradeMultiplier: 1.2,
    title: 'old man logan deodato', issue: '25', year: '2017', variant, diagnostics, ...extra,
  }));
  return { result, diagnostics };
};

console.log(`\n=== GATE B variant-evidence regression (module under test: ${process.env.PRICEBANDS_UNDER_TEST ? 'OVERRIDE ' + process.env.PRICEBANDS_UNDER_TEST : 'src/lib/priceBands.js'}) ===\n`);

console.log('-- the production sequence --');
let r = await bands(REGULAR, '');
ok(r.result && r.result.tier === 3 && r.result.market === 4.18 && r.result.count === 16, `1. variant NOT yet set + 16 regular covers: Tier 3, market $4.18, count 16 (reproduces the stored 03:23 band; got ${r.result && r.result.market})`);
r = await bands(VARIANT, '');
ok(r.result === null, '2. variant NOT yet set + only the 1:25 asks: the contamination reject removes them all, so no band (why the 03:23 pool held only regular covers)');
r = await bands(REGULAR, '1:25');
ok(r.result === null, `3. variant CONFIRMED 1:25 + the same 16 regular covers: NO band (was $4.18; got ${r.result && r.result.market})`);
ok(r.diagnostics.variantEvidence && r.diagnostics.variantEvidence.insufficient === true && r.diagnostics.variantEvidence.applicable === 0 && r.diagnostics.variantEvidence.nonVariant === 16, `   and the diagnostic says why: ${JSON.stringify(r.diagnostics.variantEvidence)}`);
r = await bands(VARIANT, '1:25');
const avg5 = VARIANT.reduce((a, v) => a + v.price, 0) / VARIANT.length;
ok(r.result && r.result.tier === 3 && r.result.count === 5 && r.result.market === Math.round(avg5 * 0.85 * 100) / 100, `4. variant CONFIRMED + the 5 real 1:25 asks: Tier 3 on exactly those 5, market $${r.result && r.result.market} (= avg $${avg5.toFixed(2)} x 0.85)`);
ok(r.result && r.result.variantEvidence && r.result.variantEvidence.applicable === 5 && r.result.variantEvidence.nonVariant === 0 && r.result.variantEvidence.ratio === '1:25', '   and the band carries proof it is variant-applicable: ' + JSON.stringify(r.result && r.result.variantEvidence));
r = await bands([...REGULAR, ...VARIANT], '1/25');
ok(r.result && r.result.count === 5 && r.result.market === Math.round(avg5 * 0.85 * 100) / 100, `5. mixed pool (16 regular + 5 variant), confirmed as "1/25": only the 5 variant asks price it, the regular covers do not drag it to $4 (market $${r.result && r.result.market})`);
ok(r.result && r.result.variantEvidence && r.result.variantEvidence.nonVariant === 16 && r.result.variantEvidence.applicable === 5, '   and the 16 excluded rows are counted, not silently dropped: ' + JSON.stringify(r.result && r.result.variantEvidence));

console.log('-- not enough applicable evidence --');
r = await bands([...REGULAR, ...VARIANT.slice(0, 2)], '1:25');
ok(r.result === null && r.diagnostics.variantEvidence.insufficient === true && r.diagnostics.variantEvidence.applicable === 2, '6. only 2 variant asks among 16 regular covers: no band (a band needs 3), insufficient=true');
r = await bands([{ price: 20, title: 'Old Man Logan #25 1:50 Variant Marvel 2017' }, { price: 21, title: 'Old Man Logan #25 1:50 Variant Marvel 2017' }, { price: 22, title: 'Old Man Logan #25 1:50 Variant Marvel 2017' }], '1:25');
ok(r.result === null, '7. a DIFFERENT ratio (1:50) is not evidence for 1:25');
r = await bands([20, 21, 22, 23], '1:25');
ok(r.result === null, '8. bare numbers carry no title, so they prove nothing about the variant');
r = await bands([{ price: 20, title: 'Old Man Logan #25 11:25 something' }, { price: 21, title: 'Old Man Logan #25 1:250' }, { price: 22, title: 'Old Man Logan #25 1:2500' }], '1:25');
ok(r.result === null, '9. look-alike ratios (11:25, 1:250, 1:2500) are not 1:25');
r = await bands([{ price: 25, title: 'Old Man Logan #25 (1 in 25) Deodato 2017' }, { price: 26, title: 'Old Man Logan #25 1-in-25 Deodato 2017' }, { price: 27, title: 'Old Man Logan #25 1/25 Deodato 2017' }], '1:25');
ok(r.result && r.result.count === 3, '10. the usual spellings (1 in 25, 1-in-25, 1/25) all count as the same variant');

console.log('-- legitimate generic behavior is preserved --');
r = await bands(REGULAR, '');
ok(r.result && r.result.market === 4.18 && !('variantEvidence' in r.result) && !('variantEvidence' in r.diagnostics), '11. no variant: unchanged band, no variantEvidence field');
r = await bands(REGULAR, 'newsstand');
ok(r.result && r.result.count === 16 && !('variantEvidence' in r.result), '12. a non-ratio variant (newsstand) behaves exactly as before: not subject to the ratio rule');
r = await bands(VARIANT, '1:25', { diagnostics: undefined });
ok(r.result && r.result.count === 5, '13. no diagnostics object supplied: still works');

console.log('-- helpers (new module surface) --');
if (ratioHelpersExist) {
  const n = (v) => mod.getRatioVariantN(v);
  ok(n('1:25') === '25' && n('1/25') === '25' && n('Mike Deodato 1:25 variant') === '25' && n('1 in 25') === '25' && n('newsstand') === null && n('Cover B') === null && n(null) === null && n('11:25') === null, 'getRatioVariantN reads 1:25 / 1/25 / "1 in 25" and ignores non-ratio variants and 11:25');
} else {
  ok(false, 'getRatioVariantN is exported (module under test lacks it)');
}
console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed ? 1 : 0);
