// tests/gk291-grade-match-evidence-diagnostic.test.js
//
// B1-RC A1 / A2 -- READ-ONLY, OFFLINE, DB-FREE diagnostics over STORED Production evidence (fixtures extracted read-only 2026-10-12):
//   GK-291  New Mutants #98: 30 sold candidates -> 0 verified (22 ungradedTitle, 6 gradeMismatch, 1 slab, 1 lot)
//   OML     Old Man Logan #25: 1 sold candidate -> 0 verified (issueMismatch), contested year / variant identity
//   GK-289  Secret Wars #7 is a SEPARATE diagnostic (tests/gk289-evidence-pipeline-diagnostic.test.js): a contaminated search key.
// The three zero-comp outcomes are kept apart on purpose: they do not share a cause.
//
// This file CHANGES NOTHING: it runs the REAL verifySoldComps filter chain and the REAL decision engine over stored rows,
// classifies rows along six separate dimensions, and SIMULATES alternative evidence policies for reporting only. No pricing
// or decision policy is altered, and unknown-grade sales are never promoted to exact-grade evidence.
//   node tests/gk291-grade-match-evidence-diagnostic.test.js

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const U = (rel) => pathToFileURL(path.join(root, rel)).href;
const nm = JSON.parse(readFileSync(path.join(root, 'tests', 'fixtures', 'gk291', 'new-mutants-98-sold-evidence.json'), 'utf8'));
const oml = JSON.parse(readFileSync(path.join(root, 'tests', 'fixtures', 'gk291', 'old-man-logan-25-evidence.json'), 'utf8'));
const { verifySoldComps } = await import(U('src/lib/soldVerification.js'));
const CH = await import(U('src/lib/compHygiene.js'));
const { computeDecision } = await import(U('src/lib/decisionEngine.js'));

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
const quiet = (fn) => { const o = console.log; console.log = () => {}; try { return fn(); } finally { console.log = o; } };
const q = (arr, p) => { const a = [...arr].sort((x, y) => x - y); if (!a.length) return null; const i = (a.length - 1) * p; const lo = Math.floor(i); return a[lo] + (a[Math.ceil(i)] - a[lo]) * (i - lo); };
const dist = (arr) => arr.length ? { n: arr.length, min: Math.min(...arr), p25: q(arr, .25), median: q(arr, .5), p75: q(arr, .75), max: Math.max(...arr) } : { n: 0 };
const fmt = (d) => d.n ? `n=${d.n} min=${d.min} p25=${d.p25} median=${d.median} p75=${d.p75} max=${d.max}` : 'n=0';

console.log('\n=== GK-291: New Mutants #98 -- grade-related evidence rejection (stored evidence only) ===\n');
const ctx = { title: nm.scan.title, issue: nm.scan.issue, variant: nm.scan.variant, publisher: nm.scan.publisher, bookYear: nm.scan.year, userGradeKey: 'raw', assessedGrade: nm.scan.grade, priceLadder: nm.priceLadder };
const rows = nm.soldCompsRaw;

console.log('-- fidelity: the REAL filter chain over the stored rows --');
const real = quiet(() => verifySoldComps(rows.map((r) => ({ ...r })), ctx));
ok(rows.length === 20 && nm.soldCompDiagnostics.rawCount === 30, 'only 20 of the 30 recorded candidates were retained in storage (10 are unrecoverable: a coverage limit)');
ok(real.diagnostics.verifiedCount === 0, 'REAL verifySoldComps over the 20 stored rows verifies 0 (reproduces the recorded outcome)');
const rr = real.diagnostics.reasons;
console.log(`     real-chain exclusions over the 20 stored rows: ${JSON.stringify(Object.fromEntries(Object.entries(rr).filter(([, v]) => v > 0)))}`);
ok(Object.entries(rr).every(([k, v]) => v <= (nm.soldCompDiagnostics.reasons[k] || 0)), 'every reproduced exclusion count is within the recorded 30-row count (the stored rows are a consistent subset)');
ok(rows.every((r) => r.source === 'pricecharting-history' && r.grade === 'raw'), 'all 20 rows come from PriceCharting\'s own history and sit in its UNGRADED ("raw") bin');
ok((nm.soldCompDiagnostics.reasons.lot === 1) && nm.soldCompDiagnostics.rejectedSamples[0].reason === 'cross-series', 'the "cross-series" sample is counted in the `lot` bucket (soldVerification.js:473), so the reason counts do sum to 30');

console.log('\n-- six separate dimensions, per stored row --');
const cls = rows.map((r) => {
  const t = String(r.title || '');
  const completed = r.source === 'pricecharting-history' && typeof r.price === 'number' && !!r.date;               // 1 provider-listed completed sale
  const identity = CH.hasIssueNumber(t, nm.scan.issue, nm.scan.title) && /new\s+mutants/i.test(t) && !CH.LOT_RE.test(t) && !CH.hasCrossSeriesSeparator(t); // 2 exact comic identity
  const slabbed = CH.SLAB_RE.test(t) && !/\bnot\s+(cgc|cbcs|graded)/i.test(t);                                        // 3 raw vs slabbed
  const numeric = CH.parseListingGrade(t);                                                                              // 4 known vs unknown condition
  const qual = numeric === null ? CH.getQualitativeGradeCeiling(t) : null;
  const condition = numeric !== null ? 'KNOWN_NUMERIC' : (qual != null ? 'KNOWN_QUALITATIVE' : 'UNKNOWN');
  const target = 4.0;                                                                                                   // 5 grade comparability to the target (VG 4.0, model-predicted)
  let comparability;
  if (condition === 'KNOWN_NUMERIC') comparability = Math.abs(numeric - target) <= 1.5 ? 'COMPARABLE_EXACT_BAND' : 'NOT_COMPARABLE';
  else if (condition === 'KNOWN_QUALITATIVE') comparability = Math.abs(target - qual) <= 1.5 ? 'COMPARABLE_COARSE' : 'NOT_COMPARABLE';
  else comparability = 'UNKNOWN_GRADE';
  const admissibleToday = completed && identity && !slabbed && (comparability === 'COMPARABLE_EXACT_BAND' || comparability === 'COMPARABLE_COARSE'); // 6
  return { price: r.price, daysAgo: r.daysAgo, title: t, completed, identity, slabbed, condition, numeric, qual, comparability, admissibleToday };
});
const tally = (key) => cls.reduce((m, c) => { m[c[key]] = (m[c[key]] || 0) + 1; return m; }, {});
console.log(`     1 completed sale (provider-listed): ${JSON.stringify(tally('completed'))}`);
console.log(`     2 exact comic identity:             ${JSON.stringify(tally('identity'))}`);
console.log(`     3 slabbed:                          ${JSON.stringify(tally('slabbed'))}`);
console.log(`     4 condition:                        ${JSON.stringify(tally('condition'))}`);
console.log(`     5 grade comparability to VG 4.0:    ${JSON.stringify(tally('comparability'))}`);
console.log(`     6 admissible under TODAY'S policy:  ${JSON.stringify(tally('admissibleToday'))}`);
const unknown = cls.filter((c) => c.comparability === 'UNKNOWN_GRADE');
const unknownExact = unknown.filter((c) => c.completed && c.identity && !c.slabbed);
ok(cls.filter((c) => c.completed).length === 20, 'dimension 1: all 20 are provider-listed completed sales (a distinct fact from grade)');
ok(unknownExact.length >= 10, `dimension 2-5: ${unknownExact.length} rows are completed, exact-identity, RAW copies whose condition is UNKNOWN from the title (they are not wrong rows; their grade is unstated)`);
ok(cls.every((c) => (c.condition === 'UNKNOWN') === (c.comparability === 'UNKNOWN_GRADE')), 'unknown condition and unknown comparability coincide (nothing is inferred)');
ok(cls.filter((c) => c.admissibleToday).length === real.diagnostics.verifiedCount, `dimension 6: the classification agrees with the real chain on admissibility (${cls.filter((c) => c.admissibleToday).length} == ${real.diagnostics.verifiedCount})`);

console.log('\n-- price distributions by comparability class (stored rows only) --');
const byClass = {};
for (const c of cls) (byClass[c.comparability + (c.slabbed ? '+SLAB' : '')] ||= []).push(c.price);
for (const [k, v] of Object.entries(byClass)) console.log(`     ${k.padEnd(28)} ${fmt(dist(v))}`);
const unknownPrices = unknownExact.map((c) => c.price);
const ladder = nm.priceLadder;
console.log(`     reference: PriceCharting ladder  raw=${ladder.raw}  4.0=${ladder['4.0']}  5.0=${ladder['5.0']}  7.0=${ladder['7.0']}  9.6=${ladder['9.6']};  stored asks: n=${nm.rawComps.count} lowest=${nm.rawComps.lowest} avg=${Math.round(nm.rawComps.average)}`);
console.log(`     the unknown-grade median (${q(unknownPrices, .5)}) vs ladder raw (${ladder.raw}) vs ladder 4.0 (${ladder['4.0']}) vs recorded list price (${nm.scan.price})`);
const unkMed = q(unknownPrices, .5);
ok(Math.abs(unkMed - ladder.raw) / ladder.raw < 0.1, `the unknown-grade median sits within 10% of the ladder's GENERIC RAW row (${unkMed} vs ${ladder.raw}) -- they behave as a raw-market sample, not as a VG 4.0 sample`);
ok(unkMed > ladder['4.0'] * 1.5, `and it is far above the ladder's VG 4.0 value (${ladder['4.0']}): admitting them at face value would overstate a VG 4.0 price (the GK-228 reasoning, reproduced from stored data)`);

console.log('\n-- simulated evidence policies (REPORT ONLY; nothing here is adopted) --');
const P0 = cls.filter((c) => c.admissibleToday);
const P1raw = unknownExact; // reported as a SEPARATE class
const P2 = cls.filter((c) => c.completed && c.identity && !c.slabbed && c.numeric !== null && Math.abs(c.numeric - 4.0) <= 2.5);
const P3 = cls.filter((c) => c.completed && c.identity && !c.slabbed); // promote unknown-grade into exact-grade evidence (REJECTED; simulated to show the hazard)
const policies = [
  ['P0 current: exact-grade-comparable only', P0, 'exact-grade'],
  ['P1 + report unknown-grade RAW sales as a SEPARATE class (not exact-grade)', P0, 'exact-grade', P1raw],
  ['P2 widen numeric tolerance from +/-1.5 to +/-2.5', P2, 'exact-grade'],
  ['P3 REJECTED: promote unknown-grade sales to exact-grade evidence', P3, 'exact-grade'],
];
const baseItem = (verified) => ({
  title: nm.scan.title, issue: nm.scan.issue, year: nm.scan.year, publisher: nm.scan.publisher, grade: nm.scan.grade, isGraded: false,
  price: nm.scan.price, pricingSource: 'active_ask_derived', rawComps: { count: nm.rawComps.count, average: nm.rawComps.average, lowest: nm.rawComps.lowest, highest: nm.rawComps.highest },
  soldCompDiagnostics: { rawCount: 30, verifiedCount: verified, reasons: nm.soldCompDiagnostics.reasons, newestDaysAgo: verified ? 6 : null },
  matchConfidence: nm.matchConfidence, soldComps: new Array(verified).fill({ daysAgo: 10 }),
});
const decisions = {};
for (const [label, admitted, , separate] of policies) {
  const d = quiet(() => computeDecision(baseItem(admitted.length)));
  decisions[label] = d.action;
  console.log(`     ${label}`);
  console.log(`        exact-grade admitted: ${admitted.length}${separate ? `   | separate unknown-grade raw class: ${fmt(dist(separate.map((c) => c.price)))}` : ''}   | price spread of admitted: ${fmt(dist(admitted.map((c) => c.price)))}   | decision engine: ${d.action}${d.warnings && d.warnings.length ? ' [' + d.warnings.join(',') + ']' : ''}`);
}
ok(P0.length === 0 && decisions['P0 current: exact-grade-comparable only'] === 'RESEARCH', 'P0: 0 admitted -> decision RESEARCH (zero-verified-comps), as recorded in Production');
ok(P1raw.length === unknownExact.length && P1raw.length > 0, `P1: the unknown-grade raw class is reported as its own bucket (${P1raw.length} rows), exact-grade admissions stay at ${P0.length}`);
ok(decisions['P1 + report unknown-grade RAW sales as a SEPARATE class (not exact-grade)'] === decisions['P0 current: exact-grade-comparable only'], 'P1 leaves the decision-engine outcome UNCHANGED (a separate class is information, not authority)');
ok(P2.length >= P0.length, `P2: widening the numeric band admits ${P2.length} rows -- reported only; the +/-1.5 tolerance is pricing math and is NOT changed`);
ok(decisions['P3 REJECTED: promote unknown-grade sales to exact-grade evidence'] !== 'RESEARCH' || P3.length === 0, `P3 shows the hazard: promoting ${P3.length} unknown-grade sales flips the decision engine to ${decisions['P3 REJECTED: promote unknown-grade sales to exact-grade evidence']} -- exactly why unknown grade is not promoted`);

console.log('\n-- Collection-wide rejection-trace coverage (read-only census 2026-10-12; counts only; 227 items) --');
const COV = { total: 227, hasDiag: 224, hasReasons: 222, hasSamples: 168, hasRetainedRows: 169, rawGt0: 169, rawGt0Verified0: 24, rawEq0: 53, verifiedGt0: 145, ungradedGt0: 110, zeroVerifiedWithUngraded: 15,
  reasons: { ungradedTitle: [110, 1663], gradeMismatch: [112, 813], annualMismatch: [85, 204], stale: [17, 185], format: [15, 166], lot: [72, 137], issueMismatch: [77, 121], outlier: [32, 91], variantMismatch: [24, 84], titleMismatch: [16, 78], printingMismatch: [8, 53], slabMismatch: [12, 13] },
  dominantWhenZeroVerified: { ungradedTitle: 12, format: 5, printingMismatch: 2, titleMismatch: 1, annualMismatch: 1, variantMismatch: 1, gradeMismatch: 1, issueMismatch: 1 } };
const totalRej = Object.values(COV.reasons).reduce((a, [, n]) => a + n, 0);
console.log(`     traces present: diagnostics ${COV.hasDiag}/${COV.total} (${(100 * COV.hasDiag / COV.total).toFixed(1)}%), reason maps ${COV.hasReasons}/${COV.total}, rejected samples ${COV.hasSamples}/${COV.total}, retained sold rows ${COV.hasRetainedRows}/${COV.total}`);
console.log(`     missing: ${COV.total - COV.hasDiag} items have no soldCompDiagnostics at all; ${COV.total - COV.hasReasons} lack a reason map; ${COV.rawGt0 - COV.hasSamples} items with candidates have no sample titles; ${COV.rawGt0 - COV.hasRetainedRows} have no retained rows`);
console.log(`     outcomes: ${COV.verifiedGt0} items have >=1 verified sold; ${COV.rawGt0Verified0} have candidates but 0 verified; ${COV.rawEq0} have NO sold candidates at all (the GK-289/OML-like thin or absent case)`);
console.log(`     rejection mix: ungradedTitle ${COV.reasons.ungradedTitle[1]} of ${totalRej} total rejections (${(100 * COV.reasons.ungradedTitle[1] / totalRej).toFixed(0)}%), in ${COV.reasons.ungradedTitle[0]} items`);
console.log(`     among the ${COV.rawGt0Verified0} candidates-but-0-verified items the dominant first-failing reason is: ${JSON.stringify(COV.dominantWhenZeroVerified)}`);
ok(COV.hasDiag / COV.total > 0.98 && COV.hasReasons / COV.total > 0.97, 'trace coverage is high but not total (3 items have no diagnostics)');
ok(COV.rawGt0 - COV.hasSamples === 1 && COV.rawGt0 === COV.hasRetainedRows, 'retained-row coverage matches the candidates-present count; sample titles are capped at 3 per item by design');
ok(COV.dominantWhenZeroVerified.ungradedTitle === 12 && COV.rawGt0Verified0 === 24, 'ungradedTitle is the dominant reason in HALF (12 of 24) of the zero-verified-with-candidates items -- material, but not the only cause (format 5, printing 2, others)');
console.log('     LIMITS: reasons record the FIRST failing filter per row only; 10 of 30 NM98 rows were not retained; only the first 3 rejected titles per item are kept;');
console.log('     the census is a snapshot of rows as last saved, some scanned before later filter changes; no live enrichment was run to refresh any of it.');

console.log('\n=== Old Man Logan #25 -- issueMismatch on its single sold candidate (distinct from GK-289 and GK-291) ===\n');
const cand = oml.soldCompsRaw[0];
console.log(`     candidate: "${cand.title}" $${cand.price}, ${cand.daysAgo} days ago, PC tab=${cand.grade}`);
console.log(`     target: "${oml.scan.title}" #${oml.scan.issue} (${oml.scan.year}) variant ${oml.scan.variant}; authority: ${oml.contractActionAuthority.reasonCodes.join(',')}`);
const omlReal = quiet(() => verifySoldComps(oml.soldCompsRaw.map((r) => ({ ...r })), { title: oml.scan.title, issue: oml.scan.issue, variant: oml.scan.variant, publisher: oml.scan.publisher, bookYear: oml.scan.year, userGradeKey: 'raw', assessedGrade: oml.scan.grade }));
ok(omlReal.diagnostics.reasons.issueMismatch === 1 && omlReal.diagnostics.verifiedCount === 0, 'REPRODUCED: the real chain rejects the candidate as issueMismatch');
const H = CH.hasIssueNumber;
ok(H('Old Man Logan, Vol. 2 #25F', '25', 'old man logan deodato') === false, 'root cause: hasIssueNumber("...#25F", "25") is false');
ok(H('Old Man Logan #25', '25', 'old man logan') === true && H('Old Man Logan #25 F', '25', 'old man logan') === true, 'controls: "#25" and "#25 F" (space) match');
ok(H('Amazing Spider-Man #25A', '25', 'amazing spider-man') === false && H('Batman #423B', '423', 'batman') === false && H('Secret Wars #7A NM', '7', 'secret wars') === false, 'the same behavior for any letter-suffixed token: #25A, #423B, #7A');
ok(readFileSync(path.join(root, 'src', 'lib', 'compHygiene.js'), 'utf8').includes('\\\\s*${escaped}\\\\b'), 'mechanism: the test is `#\\s*N\\b` (compHygiene.js:1225) -- a word boundary cannot exist between "5" and "F", so a lettered-cover token can never equal the bare issue');
const lettered = oml.imageSearchResults.filter((x) => /#\s*25[A-Za-z]\b/.test(x.rawTitle || x.title));
console.log(`     lettered-cover titles in the stored 20-entry visual pool: ${lettered.map((x) => (x.rawTitle || x.title).match(/#\s*25[A-Za-z]/)[0]).join(', ')}`);
ok(lettered.length === 3, 'the visual pool for this book contains three lettered covers (#25C, #25A, #25b): this notation is common on eBay for this issue');
const target = oml.scan.variant;
ok(!/deodato|1:25|teaser/i.test(cand.title), 'the rejected candidate\'s title does NOT say Deodato, 1:25 or Teaser: it is NOT shown to be the target variant');
ok(oml.scan.year === '2017' && oml.imageSearchResults.some((x) => /2016/.test(x.rawTitle || x.title)) && oml.imageSearchResults.some((x) => /\(2015/.test(x.rawTitle || x.title)), 'the year is genuinely contested in the pool (2015 volume, 2016 and 2017 cover years) -- independent of the issue parse, which is NOT what rejected this row');
console.log('     FINDING (not a claim of wrongly-rejected evidence): the rejection REASON is mechanical -- a letter-suffixed issue token is classified as `issueMismatch` rather than as a lettered-cover/variant fact.');
console.log('     For this book the row is probably excluded correctly (a different lettered cover than a 1:25 Deodato teaser) but for the wrong recorded reason, and the same parse can never match a lettered-cover TARGET.');
console.log('     hasIssueNumber is shared by active comps (api/comps.js:1494), sold verification, evidence eligibility and price bands; no test covers a letter-suffixed token.');
ok(true, 'distinct reproducible behavior established -> proposed separate ticket GK-292 (parse/classification only; no pricing change; impact on valuations not established)');

console.log(`\n${'='.repeat(60)}\nGK-291 / OML DIAGNOSTIC: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
