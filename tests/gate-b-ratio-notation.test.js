// GATE B (2026-10-21) -- ratio-variant notation: "1/25", "1 in 25", "1-in-25" and "1:25" are one variant. Pure, no network, no DB.
import { canonicalizeRatioVariant } from '../src/lib/compHygiene.js';
import { applyVariantPreferenceFilter } from '../api/comps.js';
import { getRatioVariantN, titleShowsRatioVariant } from '../src/lib/priceBands.js';
let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
for (const v of ['1:25', '1/25', '1 in 25', '1-in-25', '1 In 25', 'Deodato 1/25']) ok(/1:25/.test(canonicalizeRatioVariant(v)), `"${v}" -> "${canonicalizeRatioVariant(v)}"`);
ok(canonicalizeRatioVariant('1:25') === '1:25', '"1:25" is returned unchanged');
ok(canonicalizeRatioVariant('Deodato 1/25 variant') === 'Deodato 1:25 variant', 'only the ratio token is rewritten; surrounding text is kept');
for (const v of ['newsstand', '2nd print', '1/2', '11/25x', '1:2', '3/25', '', null, undefined]) ok(canonicalizeRatioVariant(v) === v, `non-ratio / out-of-range text untouched: ${JSON.stringify(v)}`);
ok(canonicalizeRatioVariant('1/250') === '1:250' && getRatioVariantN('1/250') === '250', '1/250 is a different ratio (250), not 25');
ok(canonicalizeRatioVariant('21/25') === '21/25', 'a number ending in 1 ("21/25") is not a 1:25 ratio');
const pool = [{ price: 15, title: 'OLD MAN LOGAN #25 Deodato 1:25 Variant' }, { price: 19, title: 'Old Man Logan #25 1:25 Variant Marvel' }, { price: 4, title: 'Old Man Logan #25 Marvel' }, { price: 5, title: 'Old Man Logan #25 NM' }];
for (const v of ['1:25', '1/25', '1 in 25']) { const r = applyVariantPreferenceFilter(pool, v); ok(r.matched === true && r.pool.length === 2 && r.pool.every((p) => /1:25/.test(p.title)), `variant preference with "${v}" keeps exactly the 2 listings that name 1:25`); }
const r50 = applyVariantPreferenceFilter(pool, '1/50'); ok(r50.pool.length === pool.length && r50.matched === false, 'a different ratio (1/50) does not match 1:25 listings (keeps all, matched=false)');
ok(titleShowsRatioVariant('x 1:25 y', '25') && !titleShowsRatioVariant('x 1:250 y', '25'), 'band-level evidence check stays exact on the number');
console.log(`\n=== ${passed} passed, ${failed} failed ===\n`); process.exit(failed ? 1 : 0);
