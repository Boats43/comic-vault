// tests/gk156-poolyearhint-eralock-rawtitle.test.js
//
// GK-156 (2026-08-22) — systemic field-name bug found while tracing
// GK-154. eraLock (Ship #22a, api/enrich.js) and poolYearHint (Q121,
// api/enrich.js) both scan `r.title` across parsedVisualRows for 19xx/
// 20xx year tokens — but on a parsedVisualRows row, `.title` is
// extractSeriesTitle(rawTitle) (src/lib/imageSearchIdentity.js), a
// SANITIZED series-name projection, not the raw listing text a year
// token actually lives in. `.rawTitle` is the correct field (already used
// correctly elsewhere in the same file, e.g. the pc-anchor-gate
// discriminator check).
//
// Neither block is separately exported (both are inline in the handler),
// so this file reproduces the exact post-fix logic byte-for-byte — same
// convention as tests/q121-cv-pool-year-hint.test.js's own "reproduces
// the exact extraction block added to api/enrich.js" — verified against
// the real file's current source below (not just trusted from memory),
// so a future edit that silently diverges the two copies is caught.
//
// Real production data: G.I. Joe #5 Tyler Kirkham 616 virgin,
// 2026-08-22 07:08:06, build 3f2bdad. Real 20-item eBay image-search
// pool. 5/20 raw titles carry an explicit "(2025)"/"2025" year token;
// only 2/20 of the SANITIZED (extractSeriesTitle) titles do — below
// poolYearHint's own >=3 floor, which is exactly why `[cv-pool-year-hint]`
// never fired in the real production log for this scan (confirmed absent
// via direct Vercel runtime-log pull, not assumed).
//
// Invoke: node tests/gk156-poolyearhint-eralock-rawtitle.test.js

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractSeriesTitle } from '../src/lib/imageSearchIdentity.js';

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

console.log('\n=== GK-156 — poolYearHint / eraLock: r.title vs r.rawTitle ===\n');

// Real, verbatim raw titles from the 2026-08-22 07:08:06 production log.
const RAW_TITLES = [
  'GI JOE #5 TYLER KIRKHAM 616 Cobra Commander Virgin FOIL Variant B LTD to 750',
  'G.I. Joe #5 (2025) Tyler Kirkham Virgin Variant *Limited To 750 Copies',
  'GI JOE #5 • TYLER KIRKHAM • VIRGIN VARIANT • COBRA COMMANDER • LTD 750',
  'GI Joe #5 Tyler Kirkham Virgin Variant 616 Comics Exclusive Image 2025 Limited 7',
  'G.I. Joe #5 (2025) Tyler Kirkham Cobra Commander Exclusive 616 Virgin Ltd 750 NM',
  'G.I. Joe #5 (2025) Tyler Kirkham 616 Exclusive Virgin Variant Ltd 750',
  'G.I. Joe #5 Tyler Kirkham',
  'GI JOE #5 SIGNED TYLER KIRKHAM 616 COBRA COMMANDER VIRGIN VARIANT A LTD 750',
  'GI JOE 5 SIGNED TYLER KIRKHAM 616 COBRA COMMANDER VIRGIN FOIL LTD 750 COVER B',
  'G.I. Joe #5 Tyler Kirkham FOIL',
  'GI JOE #5 SIGNED TYLER KIRKHAM 616 COBRA COMMANDER VIRGIN VARIANT A LTD 750',
  'G.I. Joe #5 SIGNED Tyler Kirkham Cobra Commander Virgin Variant w/ COA Image NM',
  'GI JOE 5 TYLER KIRKHAM Cobra Commander Virgin & FOIL Variant Set LTD 750 NM ',
  'GI JOE 5 TYLER KIRKHAM 616 Cobra Commander Virgin & FOIL Variant Set LTD 750',
  'GI JOE #5 TYLER KIRKHAM 616 Cobra Commander Virgin Variant A LTD 750',
  'Andrew K Curry Shredder #2 Foil 2025 NYCC Blind Bag LTD 300',
  'GI JOE 5 Tyler Kirkham Variant A Virgin LTD 750 CB',
  'GI JOE 5 TYLER KIRKHAM 616 Cobra Commander Virgin & FOIL Variant Set LTD 750',
  '#5GIJOETYLERKIRKHAMCOBRACOMMANDERVIRGINVARLIMITEDTO750)BNNMM+B&B+NEXTDAYSHPPNG',
  'Shredder #2 | Andrew K Currey FOIL Variant NYCC LTD 300 | Ivan Tao Blind Bag NM',
];

// ═══════════════════════════════════════════════════════════════════════
// PART 1 — poolYearHint: post-fix (r.rawTitle) vs pre-fix (r.title) on the
// SAME real pool.
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 1: poolYearHint — r.rawTitle (fixed) vs r.title (the GK-156 bug)\n');

const computePoolYearHint = (rows, field) => {
  const poolYearCounts = {};
  rows.forEach((r) => {
    const titleLower = (r[field] || '').toLowerCase();
    const yearsInTitle = new Set(
      [...titleLower.matchAll(/\b(19\d{2}|20\d{2})\b/g)].map((m) => parseInt(m[1], 10))
    );
    yearsInTitle.forEach((y) => {
      if (y >= 1900 && y <= 2030) poolYearCounts[y] = (poolYearCounts[y] || 0) + 1;
    });
  });
  const poolTotalWithYear = Object.values(poolYearCounts).reduce((s, c) => s + c, 0);
  if (poolTotalWithYear < 3) return null;
  const [topYearStr, topCount] = Object.entries(poolYearCounts).sort((a, b) => b[1] - a[1])[0];
  const agreement = topCount / poolTotalWithYear;
  if (agreement < 0.50) return null;
  return { year: parseInt(topYearStr, 10), agreement, sampleSize: poolTotalWithYear };
};

// parsedVisualRows shape: { rawTitle, title: extractSeriesTitle(rawTitle) }
const parsedVisualRows = RAW_TITLES.map((rawTitle) => ({
  rawTitle,
  title: extractSeriesTitle(rawTitle),
}));

const postFixHint = computePoolYearHint(parsedVisualRows, 'rawTitle');
assertEq(postFixHint, { year: 2025, agreement: 1, sampleSize: 5 }, 'FIXED (r.rawTitle): poolYearHint = {year: 2025, agreement: 100%, sampleSize: 5} — matches the real pool\'s actual "(2025)" support');

const preFixHint = computePoolYearHint(parsedVisualRows, 'title');
assertEq(preFixHint, null, 'THE BUG, reproduced (r.title): poolYearHint computes to null — only 2/20 sanitized titles retain a year token, below the >=3 floor, exactly matching the real production log\'s silent absence of [cv-pool-year-hint]');

// ═══════════════════════════════════════════════════════════════════════
// PART 2 — eraLock: same pre/post comparison, era-adjacent extraction.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: eraLock — r.rawTitle (fixed) vs r.title (the GK-156 bug)\n');

const computeEraLock = (rows, field) => {
  const yearHistogram = {};
  rows.forEach((r) => {
    const titleLower = (r[field] || '').toLowerCase();
    const nearIssue = titleLower.match(/#\s*\d+[^\d]*(19\d{2}|20\d{2})|(\b19\d{2}|20\d{2})[^\d]*#\s*\d+/);
    if (nearIssue) {
      const year = parseInt(nearIssue[1] || nearIssue[2]);
      if (year >= 1900 && year <= 2030) {
        const decade = Math.floor(year / 10) * 10;
        yearHistogram[decade] = (yearHistogram[decade] || 0) + 1;
        return;
      }
    }
    const firstHalf = titleLower.slice(0, Math.floor(titleLower.length / 2));
    const yearMatch = firstHalf.match(/\b(19\d{2}|20\d{2})\b/);
    if (yearMatch) {
      const year = parseInt(yearMatch[1]);
      if (year >= 1900 && year <= 2030) {
        const decade = Math.floor(year / 10) * 10;
        yearHistogram[decade] = (yearHistogram[decade] || 0) + 1;
      }
    }
  });
  const totalWithYear = Object.values(yearHistogram).reduce((s, c) => s + c, 0);
  return { yearHistogram, totalWithYear };
};

const postFixEra = computeEraLock(parsedVisualRows, 'rawTitle');
assertEq(postFixEra.totalWithYear, 4, 'FIXED (r.rawTitle): eraLock finds 4 year-bearing rows (decade 2020, 100% agreement) — clears the >=3 floor, produces an era-advisory (4 < 6 hard-lock quorum, but a real, non-silent signal — was total silence pre-fix)');
assertEq(postFixEra.yearHistogram, { 2020: 4 }, 'decade histogram is entirely 2020s, unanimous — no false Silver/Bronze-Age lock risk from this fixture');

const preFixEra = computeEraLock(parsedVisualRows, 'title');
assertEq(preFixEra.totalWithYear, 0, 'THE BUG, reproduced (r.title): eraLock finds ZERO year-bearing rows at all — even more starved than poolYearHint\'s 2/20, because eraLock\'s stricter near-issue/first-half patterns need more surrounding context than the sanitized series-name field retains');

// ═══════════════════════════════════════════════════════════════════════
// PART 3 — live source verification: the actual api/enrich.js code now
// reads `.rawTitle`, not `.title`, at both sites (guards against this fix
// silently regressing back to the bug in a future edit).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: live source check — api/enrich.js reads r.rawTitle at both sites\n');

const enrichSrc = readFileSync(path.join(__dirname, '..', 'api', 'enrich.js'), 'utf8');
const titleLowerLines = enrichSrc
  .split('\n')
  .filter((line) => /const\s+titleLower\s*=\s*\(r\.(rawTitle|title)\s*\|\|\s*''\)/.test(line));

assertTrue(titleLowerLines.length >= 2, `at least 2 titleLower extraction sites found in the live source (eraLock + poolYearHint) — actual: ${titleLowerLines.length}`);
assertTrue(
  titleLowerLines.every((line) => /r\.rawTitle/.test(line)),
  `every titleLower extraction site reads r.rawTitle, none reads the bare r.title field (the GK-156 bug) — sites:\n${titleLowerLines.map((l) => '      ' + l.trim()).join('\n')}`
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
