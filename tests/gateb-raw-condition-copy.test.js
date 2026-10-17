// tests/gateb-raw-condition-copy.test.js
//
// GATE B payload fix: a RAW, operator-graded comic is listed with a truthful title and an
// explicit raw-condition disclosure; professionally graded (slab) and ungoverned-grade
// behavior is preserved. Unit layer (pure functions). The REAL-HANDLER proof of the outbound
// AddFixedPriceItem body lives in tests/list-ebay-outcome1-handler-smoke.test.js
// ("GATE B RAW CONDITION COPY" section).
//
// Invoke: node tests/gateb-raw-condition-copy.test.js

import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
const { toBuyerSafeListingFacts, buildGovernedListingTitle, rawConditionDisclosure, rawConditionLabel } =
  await import(pathToFileURL(path.join(repoRoot, 'src/lib/buyerSafeListingCopy.js')).href);

const OML = { title: 'Old Man Logan', issue: '25', year: '2017', publisher: 'Marvel', variant: '1:25 Mike Deodato Teaser Variant' };
const RAW92 = { ...OML, gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: '9.2', operatorGradeNumeric: 9.2, operatorIsGraded: false };
const title = (it) => buildGovernedListingTitle(toBuyerSafeListingFacts(it));
const disc = (it) => rawConditionDisclosure(toBuyerSafeListingFacts(it));

console.log('\n=== raw 9.2 (Old Man Logan #25) ===');
ok(title(RAW92) === 'Old Man Logan #25 1:25 Mike Deodato Teaser Variant Marvel 2017 Raw NM-', 'exact required title');
ok(disc(RAW92) === 'Raw copy. GrailKey/operator condition assessment approximately NM- 9.2. Not professionally graded or slabbed.', 'exact required disclosure');
ok(title(RAW92).length <= 80, `title length ${title(RAW92).length} <= 80`);
ok(title({ ...RAW92, operatorGradeNumeric: undefined, operatorGrade: 'NM- 9.2' }) === title(RAW92), 'numeric derived from operator grade text when no stored numeric');
ok(disc({ ...RAW92, operatorGradeNumeric: undefined, operatorGrade: 'NM- 9.2' }) === disc(RAW92), 'disclosure identical when numeric is parsed from text');
const f = toBuyerSafeListingFacts(RAW92);
ok(f.isRaw === true && f.isSlab === false && f.numericGrade === null && Object.isFrozen(f), 'facts: raw, not slab, no CGC numeric, frozen');
ok(f.publicGrade === '9.2' && f.variant === OML.variant && f.title === 'Old Man Logan', 'governed identity/grade/variant preserved verbatim in the projection');
ok(!/CGC|certified|graded by/i.test(title(RAW92)), 'title makes no certification claim');
ok(/Not professionally graded or slabbed\.$/.test(disc(RAW92)), 'disclosure ends with the not-graded statement');

console.log('\n=== label scale (descriptive only) ===');
ok(rawConditionLabel(9.2) === 'NM-' && rawConditionLabel(9.4) === 'NM' && rawConditionLabel(9.8) === 'NM/M' && rawConditionLabel(8) === 'VF' && rawConditionLabel(6) === 'FN' && rawConditionLabel(4) === 'VG' && rawConditionLabel(1.8) === 'GD-', 'standard scale labels');
ok(rawConditionLabel(9.1) === '' && rawConditionLabel(NaN) === '' && rawConditionLabel(null) === '' && rawConditionLabel('x') === '', 'off-scale / non-numeric -> no label (never guessed)');
const off = { ...RAW92, operatorGrade: '9.1', operatorGradeNumeric: 9.1 };
ok(title(off) === 'Old Man Logan #25 1:25 Mike Deodato Teaser Variant Marvel 2017 Raw' && /^Raw copy\..*: 9\.1\. Not professionally graded or slabbed\.$/.test(disc(off)), 'off-scale raw grade: title says only "Raw", disclosure quotes the operator grade, still not-graded');

console.log('\n=== professionally graded (slab) behavior preserved ===');
const SLAB = { title: 'Batman', issue: '1', year: '1940', publisher: 'DC', gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: 'CGC', operatorIsGraded: true, operatorGradeNumeric: 7.5 };
ok(title(SLAB) === 'Batman #1 CGC 7.5 DC 1940', 'slab title unchanged');
ok(toBuyerSafeListingFacts(SLAB).isRaw === false && disc(SLAB) === '', 'slab is not raw; no raw disclosure');
ok(toBuyerSafeListingFacts({ ...RAW92, operatorIsGraded: true }).isRaw === false, 'operatorIsGraded=true is never described as raw, even if the numeric is on the scale');

console.log('\n=== missing / ungoverned grade ===');
const NOGRADE = { title: 'Creepy', issue: '1', year: '1964', publisher: 'Warren Publishing' };
ok(title(NOGRADE) === 'Creepy #1 Warren Publishing 1964' && disc(NOGRADE) === '' && toBuyerSafeListingFacts(NOGRADE).isRaw === false, 'no grade -> unchanged title, no raw claim');
const MODEL = { ...NOGRADE, grade: 'NM- 9.2', numericGrade: 9.2, modelPredictedGrade: 'NM- 9.2' };
ok(title(MODEL) === 'Creepy #1 Warren Publishing 1964' && disc(MODEL) === '', 'model/legacy grade without OPERATOR_CONFIRMED is never published (not raw, not graded)');
ok(title({ ...NOGRADE, operatorGrade: '9.2', operatorGradeNumeric: 9.2 }) === 'Creepy #1 Warren Publishing 1964', 'operator grade value without OPERATOR_CONFIRMED authority is not published');
ok(title(null) === 'Comic Book' && title(undefined) === 'Comic Book' && disc(null) === '', 'null/undefined safe');

console.log('\n=== long titles ===');
const LONG = { ...RAW92, title: 'A'.repeat(120) };
ok(title(LONG).length <= 80 && title(LONG).endsWith(' Raw NM-'), `120-char title truncated to ${title(LONG).length} chars; "Raw NM-" suffix survives`);
const LONGVAR = { ...RAW92, variant: 'V'.repeat(200) };
ok(title(LONGVAR).length <= 80 && title(LONGVAR).endsWith(' Raw NM-') && title(LONGVAR).startsWith('Old Man Logan #25'), 'very long variant: identity prefix + raw suffix both survive');
ok(title({ ...RAW92, title: 'X'.repeat(500), publisher: 'P'.repeat(500) }).length <= 80, 'pathological lengths still <= 80');

console.log('\n=== special characters / injection (copy layer keeps text; XML escaping is proven in the handler test) ===');
const SPECIAL = { ...RAW92, title: 'AT&T <b>Hero</b> "Q"', variant: "O'Brien <script>1</script>" };
ok(title(SPECIAL).endsWith(' Raw NM-') && disc(SPECIAL) === disc(RAW92), 'special characters do not disturb the suffix or the disclosure');
ok(!disc(SPECIAL).includes('<') && !disc(SPECIAL).includes('script'), 'the disclosure never embeds item text when the grade maps to a label');

console.log('\n=== no incorrect variant substitution ===');
const NOVAR = { ...RAW92 }; delete NOVAR.variant;
ok(title(NOVAR) === 'Old Man Logan #25 Marvel 2017 Raw NM-', 'no governed variant -> no variant in the title');
const FORGED = { ...RAW92, claudeCheck: { suggestedListingTitle: 'AI TITLE', variant: 'AI VARIANT' }, suggestedVariant: 'AI VARIANT', reason: 'AI VARIANT' };
ok(title(FORGED) === title(RAW92) && !JSON.stringify(toBuyerSafeListingFacts(FORGED)).includes('AI '), 'AI/claudeCheck/reason fields can never become the variant or title');
const COVER = { ...RAW92, variant: 'Cover A' };
ok(!title(COVER).includes('Cover A'), 'existing NO_TITLE_VARIANTS rule still applies to raw titles');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
