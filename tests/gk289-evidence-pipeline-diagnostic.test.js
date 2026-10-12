// tests/gk289-evidence-pipeline-diagnostic.test.js
//
// B1-FINAL A4 -- GK-289 STAGED EVIDENCE-PIPELINE DIAGNOSTIC. READ-ONLY, OFFLINE, DB-FREE.
// Canonical regression fixture: tests/fixtures/gk289/secret-wars-7-scan.json (the real Secret Wars #7 Production scan,
// extracted read-only 2026-10-12 and sanitized). Nothing here fetches anything, calls a model, or implements GK-289.
//
// What this IS: a staged accounting of RECORDED evidence, with an OFFLINE REPLAY of a clean-identity predicate over the
// recorded visual pool. What this is NOT: a re-run of the pipeline. Stage counts that need a live provider call under a
// corrected query are reported UNKNOWN / BLOCKED -- never inferred from "a clean query would have worked".
//   node tests/gk289-evidence-pipeline-diagnostic.test.js

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fx = JSON.parse(readFileSync(path.join(root, 'tests', 'fixtures', 'gk289', 'secret-wars-7-scan.json'), 'utf8'));

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
console.log('\n=== GK-289 staged evidence diagnostic: Secret Wars #7 (canonical fixture) ===\n');

// ─────────────── the corrected, unambiguous identity (what a clean query/predicate encodes) ───────────────
const CLEAN = { series: ['secret', 'wars'], issue: '7', publisher: 'Marvel', coverYears: ['2015', '2016'] }; // Secret Wars (2015 series) #7 is cover-dated Jan 2016
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9#]+/g, ' ').trim();
function classifyListing(r) {
  const t = norm(r.rawTitle || r.title);
  const toks = new Set(t.split(' '));
  if (!CLEAN.series.every((w) => toks.has(w))) return { stage2: false, reason: 'TITLE_MISMATCH' };
  if (String(r.issue) !== CLEAN.issue) return { stage2: false, reason: 'ISSUE_MISMATCH' };
  if (/\bdigital\b/.test(t)) return { stage2: false, reason: 'DIGITAL_EDITION' };
  if (/\b(2nd|second|3rd|third)\s+print/.test(t)) return { stage2: false, reason: 'DIFFERENT_PRINTING' };
  if (r.year === null || r.year === undefined) return { stage2: false, reason: 'YEAR_UNSTATED_IDENTITY_UNCONFIRMED' };
  if (!CLEAN.coverYears.includes(String(r.year))) return { stage2: false, reason: 'YEAR_MISMATCH' };
  return { stage2: true, reason: null };
}
const tally = (list) => list.reduce((m, x) => { m[x] = (m[x] || 0) + 1; return m; }, {});

console.log('-- the banked fixture is the real scan --');
ok(fx.scan.title === 'SECRET WARS SPIDER MAN HULK JANE FOSTER ILLUMINATI V 1 DR DOOM THOR' && fx.scan.issue === '7' && fx.scan.year === '2015' && fx.scan.publisher === 'Marvel', 'scan identity as stored: the title field is a keyword-stuffed seller title');
ok(fx.scan.pricingSource === 'visual_pool_fallback' && fx.scan.price === 7.99 && fx.scan.decision.action === 'RESEARCH', 'priced from the visual-pool fallback at $7.99, decision RESEARCH');
ok(fx.imageSearchResults.length === 20 && !JSON.stringify(fx).includes('sellerUsername'), 'fixture holds the 20 recorded pool entries and no seller names');
// The pipeline extracted the issue (7) and the cover artist (Alex Ross -> variant) out of the title; what remains is the seller's keyword-stuffed string.
const EXTRACTED = new Set(['7', 'alex', 'ross']);
const bare = (t) => norm(t).split(' ').filter((w) => !EXTRACTED.has(w)).join(' ');
const stuffed = fx.imageSearchResults.filter((r) => bare(r.rawTitle || r.title) === bare(fx.scan.title));
ok(stuffed.length === 2 && stuffed.every((r) => [0, 2].includes(r.rank)), `CONTAMINATION EVIDENCE: the stored title equals the rawTitle (after removing the pipeline-extracted issue and cover-artist tokens) of pool entries #${stuffed.map((r) => r.rank).join(' and #')} (a seller\'s keyword-stuffed listing title was adopted as the series title)`);
const extra = norm(fx.scan.title).split(' ').filter((w) => !CLEAN.series.includes(w) && w !== '7' && w !== 'v' && w !== '1');
ok(extra.length >= 8, `the contaminated title carries ${extra.length} tokens that are not part of the series identity (${extra.slice(0, 8).join(', ')}, ...)`);

console.log('\n-- recorded contaminated-title path --');
ok(fx.rawComps.count === 0 && JSON.stringify(fx.comps) === '{"recentSales":[]}', 'text-search active comps admitted: 0 (rawComps.count 0, no comps payload)');
ok(Array.isArray(fx.soldCompsRaw) && fx.soldCompsRaw.length === 0 && fx.soldCompDiagnostics.rawCount === 0 && fx.soldCompDiagnostics.verifiedCount === 0, 'sold candidates: 0 raw, 0 verified');
ok(fx.contractActionAuthority.marketStanding === 'SIMILAR_ONLY' && fx.scan.decision.evidence.warnings.includes('no-sold-candidates'), 'authority: SIMILAR_ONLY standing, "no-sold-candidates" warning');
ok(fx.scan.decision.evidence.noSoldCandidates.activeCount === 0, 'the decision itself recorded "priced from 0 active listings"');

console.log('\n-- offline replay: clean identity predicate over the RECORDED visual pool --');
const results = fx.imageSearchResults.map((r) => ({ r, ...classifyListing(r) }));
const stage2 = results.filter((x) => x.stage2);
const excluded = results.filter((x) => !x.stage2);
const reasons = tally(excluded.map((x) => x.reason));
const asks = stage2.map((x) => Number(x.r.price)).sort((a, b) => a - b);
const median = asks.length ? (asks.length % 2 ? asks[(asks.length - 1) / 2] : (asks[asks.length / 2 - 1] + asks[asks.length / 2]) / 2) : null;
console.log(`     stage 1 retrieved (recorded visual pool): ${fx.imageSearchResults.length}`);
console.log(`     stage 2 exact identity (offline predicate): ${stage2.length}   exclusions: ${JSON.stringify(reasons)}`);
console.log(`     exact-identity asks: min ${asks[0]}, median ${median}, max ${asks[asks.length - 1]}  (recorded price: ${fx.scan.price})`);
ok(stage2.length === 14, `stage 2: 14 of 20 recorded pool entries are the exact comic (got ${stage2.length})`);
ok(reasons.YEAR_UNSTATED_IDENTITY_UNCONFIRMED === 4 && reasons.DIGITAL_EDITION === 1 && reasons.DIFFERENT_PRINTING === 1 && excluded.length === 6, `stage 2 exclusions by reason: ${JSON.stringify(reasons)}`);
ok(results.filter((x) => [0, 2].includes(x.r.rank)).every((x) => x.reason === 'YEAR_UNSTATED_IDENTITY_UNCONFIRMED'), 'the two keyword-stuffed listings are NOT counted as exact identity (year unstated) even though they ARE the comic');

console.log('\n-- what is NOT known, stated rather than inferred --');
const UNKNOWN = {
  contaminatedPathPreFilterRetrieval: 'UNKNOWN -- the text-search candidate pool before filtering is not persisted; only the admitted set (0) is',
  cleanQueryTextSearchRetrieval: 'BLOCKED -- needs a live eBay Browse call under the corrected query; not authorized by this dispatch',
  cleanQueryCompletedSales: 'BLOCKED/UNKNOWN -- needs a live PriceCharting / sold-data fetch; the recorded path found 0 sold candidates and that is all that is known',
  cleanQueryAdmission: 'INFERRED ONLY -- depends on the sold/active fetches above and on the unchanged pricing engine, which was not run',
};
for (const [k, v] of Object.entries(UNKNOWN)) console.log(`     ${k}: ${v}`);
ok(fx.soldCompsRaw.length === 0, 'the only RECORDED completed-sale count for this scan is 0; no assertion is made that a clean query would produce any');
ok(stage2.length > 0 && fx.rawComps.count === 0, 'the recorded visual pool contains exact-identity asks even though the contaminated text path admitted none (the search key is implicated; completed sales remain unknown)');

console.log('\n-- the other two Production candidates: recorded sold-evidence stages (read-only census 2026-10-12) --');
// Recorded values (Production catalogue rows; no re-fetch). Stage 2 is not separately recorded for these rows: the sold
// diagnostics only record a first-failing filter per candidate.
const NM98 = { active: 21, visualPool: 20, soldRaw: 30, soldRetained: 20, verified: 0, admitted: 0, reasons: { ungradedTitle: 22, gradeMismatch: 6, slabMismatch: 1, lot: 1 }, sample: 'the "cross-series" sample is counted in the `lot` bucket (soldVerification.js:473), so the four reason counts sum to 30' };
const OML = { active: 8, visualPool: 20, soldRaw: 1, verified: 0, admitted: 0, reasons: { issueMismatch: 1 }, sample: '"Old Man Logan, Vol. 2 #25F" $35 rejected as issueMismatch (a lettered/variant printing of the same issue number)' };
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
ok(sum(NM98.reasons) === NM98.soldRaw && NM98.verified === 0, `New Mutants #98: 30 sold candidates -> 0 verified; exclusions ${JSON.stringify(NM98.reasons)} (73% "ungradedTitle")`);
ok(sum(OML.reasons) === OML.soldRaw && OML.verified === 0, `Old Man Logan #25: 1 sold candidate -> 0 verified; exclusion ${JSON.stringify(OML.reasons)}`);
console.log(`     NM98 note: ${NM98.sample}`);
console.log(`     OML note: ${OML.sample}`);
console.log('     INTERPRETATION GUARD: for NM98 the dominant exclusion is a GRADE-MATCHING outcome (ungraded-title sold listings vs a graded target), not a search-key defect;');
console.log('     for OML the stored title ("old man logan deodato") already carries an artist token, but the one sold candidate was rejected on issue/variant, so a cleaner key is NOT shown to change the outcome.');
console.log('     Zero final admissions is therefore not evidence that the search key was irrelevant, and a clean key is not evidence that comps exist.');

console.log(`\n${'='.repeat(60)}\nGK-289 DIAGNOSTIC: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
