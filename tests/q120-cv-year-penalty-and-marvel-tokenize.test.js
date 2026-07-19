// tests/q120-cv-year-penalty-and-marvel-tokenize.test.js
//
// Q120 dispatch (2026-07-19) — Captain Marvel #17 class, two findings.
//
// FINDING 1: lookupComicVine's scoreWithDetails (api/enrich.js) applied a
// -5/-2 year-gap penalty using a yearDiff that defaults to 999 whenever
// EITHER comicYear or a candidate's startYear is simply missing — not just
// when the two years are genuinely far apart. Real production case:
// comicYear was null (no year signal from Vision or an authoritative eBay
// consensus) for a "Captain Marvel #17" ComicVine search that matched
// multiple same-named volumes. vid=50575 (2012, the real Kelly Sue
// DeConnick-run volume — #17 of that run is the 2014 1st Kamala Khan cover
// appearance) had its volume details fetched and was punished -5 purely
// for having data available to compare against a year that didn't exist.
// vid=6458 never got its details fetched at all (capped at 5 unique volume
// IDs per Ship #20a.6.16 Win #1) and scored 0 by omission, winning by
// default. Fix: gate the gap-based scoring (positive AND negative) behind
// an explicit hasYearComparison check — absence of a year to compare is
// not evidence of a mismatch.
//
// Explicitly scoped: this fix does NOT claim to fully resolve which
// volume wins — that's Finding 1's fix #2 (a visual-pool year hint fed
// into comicYear), deliberately queued as a separate dispatch. This test
// honestly reports whatever the actual post-fix outcome is.
//
// FINDING 2: tokenizeTitle (src/lib/compHygiene.js) strips "marvel"/"dc"
// from a title's token set via TWO independent, unguarded layers —
// stripMetadataTokens (titleHygiene.js, its own separate PUBLISHER_NAMES
// list) AND the STOP_WORDS set used in tokenizeTitle's own final filter.
// Fixing only stripMetadataTokens (as originally scoped) would NOT have
// resolved the symptom — STOP_WORDS independently strips "marvel"/"dc"
// regardless, discovered while implementing and confirmed by direct testing
// BEFORE this fix landed. The actual fix routes through a THIRD existing
// mechanism instead of patching either downstream layer piecemeal:
// compHygiene.js's own pre-existing Q54 COMPOUND_WHITELIST early-return
// (already used for "Marvel Tales"/"X-Men"/etc.) was ALSO missing "captain
// marvel"/"ms. marvel" — a SEVENTH independently-drifted copy of the same
// underlying fact, found under yet another name. Extending it makes
// tokenizeTitle return the canonical ["captain","marvel"] split BEFORE
// stripMetadataTokens or STOP_WORDS ever run, closing both layers at
// once. stripMetadataTokens itself is ALSO fixed directly (as originally
// instructed) for defense-in-depth, since COMPOUND_WHITELIST's match
// requires the compound at the START of the title (bareTitle === entry ||
// startsWith(entry + ' ')) and won't catch every position.
//
// Invoke: node tests/q120-cv-year-penalty-and-marvel-tokenize.test.js

import { lookupComicVine } from '../api/enrich.js';
import { tokenizeTitle, hasSufficientTitleOverlap } from '../src/lib/compHygiene.js';
import { stripMetadataTokens } from '../src/lib/titleHygiene.js';

let passed = 0;
let failed = 0;
const failures = [];

const assertEq = (actual, expected, label) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}\n    expected: ${e}\n    actual:   ${a}`; failures.push(m); console.log(m); }
};
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

console.log('\n=== Q120 — CV YEAR PENALTY + MARVEL TOKENIZATION (Captain Marvel #17 class) ===\n');

// ═══════════════════════════════════════════════════════════════════════
// FINDING 1 — reconstruct the real ComicVine scoring scenario
// ═══════════════════════════════════════════════════════════════════════
console.log('Finding 1: ComicVine year-gap penalty with no comicYear to compare\n');

process.env.COMICVINE_API_KEY = 'test-key-not-real';

// Real vid/name/year/publisher data from the actual production log for
// this exact scan (Vercel runtime logs, build 58996b9). vid=6458 is the
// real winner from the unfixed code — deliberately has NO volume-detail
// response below, matching the real request (only 5 unique volume ids get
// details fetched; this one wasn't among them).
const searchResults = [
  { issue_number: '17', cover_date: null, volume: { id: 6458, name: 'Captain Marvel' } },
  { issue_number: '17', cover_date: null, volume: { id: 18296, name: 'Captain Marvel' } },
  { issue_number: '17', cover_date: null, volume: { id: 50575, name: 'Captain Marvel' } },
  { issue_number: '17', cover_date: null, volume: { id: 116365, name: 'Captain Marvel' } },
];
const volDetailResponses = {
  18296: { id: 18296, name: 'Captain Marvel', start_year: '2002', publisher: { name: 'Marvel' } },
  50575: { id: 50575, name: 'Captain Marvel', start_year: '2012', publisher: { name: 'Marvel' } }, // the real DeConnick-run volume
  116365: { id: 116365, name: 'Captain Marvel', start_year: '2019', publisher: { name: 'Marvel' } },
  // 6458 deliberately absent — matches the real request exactly.
};

const originalFetch = global.fetch;
global.fetch = async (url) => {
  const u = String(url);
  if (u.includes('/api/search/')) {
    return { ok: true, json: async () => ({ results: searchResults }) };
  }
  const volMatch = u.match(/\/api\/volume\/4050-(\d+)\//);
  if (volMatch) {
    const vid = parseInt(volMatch[1], 10);
    const data = volDetailResponses[vid];
    return { ok: true, json: async () => ({ results: data || null }) };
  }
  return { ok: false, json: async () => ({}) };
};

const logs = [];
const originalLog = console.log;
console.log = (...args) => { logs.push(args.join(' ')); originalLog(...args); };

let cvResult;
try {
  // No year passed — matches the real request exactly (Vision provided
  // none; the eBay visual consensus wasn't authoritative enough).
  cvResult = await lookupComicVine({ title: 'Captain Marvel #17', issue: '17', year: null, publisher: 'Marvel' });
} finally {
  global.fetch = originalFetch;
  console.log = originalLog;
}

const topScoresLine = logs.find((l) => l.includes('[comicvine] top scores:'));
console.log(`  (captured: ${topScoresLine})`);

// Parse out vid=50575's score from the captured log line to confirm the
// -5 penalty is gone.
// Q121 dispatch note: the [comicvine] top scores log line gained a
// poolYr= field after this test was written — regex updated to match
// (not a behavior change; total/yr/pub/sub semantics here are unaffected
// since this test never passes a poolYearHint, so poolYr is always 0).
const vid50575Match = topScoresLine && topScoresLine.match(/Captain Marvel\(name=(\d+) yr=(-?\d+) pub=(\d+) sub=(\d+) poolYr=-?\d+ total=(-?\d+) vid=50575\)/);
assertTrue(!!vid50575Match, 'vid=50575 appears in the top-scores log line (parseable)');
if (vid50575Match) {
  const yr50575 = parseInt(vid50575Match[2], 10);
  assertEq(yr50575, 0, 'vid=50575 (2012, the real DeConnick volume) no longer takes the -5 year-gap penalty — yr=0, not yr=-5');
}

// Honest, non-overclaiming check: report what actually won, without
// asserting it must be vid=50575 (that's fix #2's job, not this one's).
// Note: lookupComicVine's return shape uses `volumeId`, not `volume.id`
// (the raw internal `match.volume` is a {id,name} object; the public
// return flattens it — `volume` becomes the NAME string, `volumeId` the id).
assertTrue(cvResult !== null, 'lookupComicVine still returns a match (not over-corrected into refusing everything)');
console.log(`  (honest result: matched volumeId = ${cvResult?.volumeId ?? 'null'}, publisher = ${cvResult?.publisher ?? 'null'} — this fix closes the score gap; it does not by itself guarantee the correct volume wins, per the explicit scope note)`);

// Control: a genuine large year gap must still be penalized normally —
// this fix must not make the scorer blind to REAL mismatches, only to the
// no-comparison-possible case.
global.fetch = async (url) => {
  const u = String(url);
  if (u.includes('/api/search/')) {
    return {
      ok: true,
      json: async () => ({
        results: [
          { issue_number: '1', cover_date: null, volume: { id: 77001, name: 'Test Series' } },
          { issue_number: '1', cover_date: null, volume: { id: 77002, name: 'Test Series' } },
        ],
      }),
    };
  }
  const volMatch = u.match(/\/api\/volume\/4050-(\d+)\//);
  if (volMatch) {
    const vid = parseInt(volMatch[1], 10);
    const data = {
      77001: { id: 77001, name: 'Test Series', start_year: '1965', publisher: { name: 'Marvel' } }, // far from comicYear=2020
      77002: { id: 77002, name: 'Test Series', start_year: '2018', publisher: { name: 'Marvel' } }, // close to comicYear=2020
    }[vid];
    return { ok: true, json: async () => ({ results: data || null }) };
  }
  return { ok: false, json: async () => ({}) };
};
const controlLogs = [];
console.log = (...args) => { controlLogs.push(args.join(' ')); originalLog(...args); };
let controlResult;
try {
  controlResult = await lookupComicVine({ title: 'Test Series #1', issue: '1', year: '2020', publisher: 'Marvel' });
} finally {
  global.fetch = originalFetch;
  console.log = originalLog;
}
assertEq(controlResult?.volumeId, 77002, 'control: genuine year mismatch (comicYear=2020 present) still correctly picks the close volume (2018) over the far one (1965)');
const controlTopLine = controlLogs.find((l) => l.includes('[comicvine] top scores:'));
assertTrue(!!(controlTopLine && controlTopLine.includes('yr=-5')), `control: the far-off volume (1965 vs 2020, 55y gap) still correctly takes the -5 penalty when a genuine comparison exists: "${controlTopLine}"`);

// ═══════════════════════════════════════════════════════════════════════
// FINDING 2 — tokenizeTitle preserves "marvel"/"dc" in compound titles
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFinding 2: tokenizeTitle preserves compound publisher-in-title words\n');

assertTrue(
  tokenizeTitle('Captain Marvel').includes('marvel'),
  `tokenizeTitle("Captain Marvel") includes "marvel" (got ${JSON.stringify(tokenizeTitle('Captain Marvel'))})`
);
assertTrue(
  tokenizeTitle('Captain Marvel #17 CGC 9.6').includes('marvel'),
  `tokenizeTitle("Captain Marvel #17 CGC 9.6") includes "marvel" (got ${JSON.stringify(tokenizeTitle('Captain Marvel #17 CGC 9.6'))})`
);
assertTrue(
  tokenizeTitle('Ms. Marvel').includes('marvel'),
  `tokenizeTitle("Ms. Marvel") includes "marvel" (got ${JSON.stringify(tokenizeTitle('Ms. Marvel'))})`
);
assertTrue(
  tokenizeTitle('Marvel Team-Up').includes('marvel'),
  `tokenizeTitle("Marvel Team-Up") includes "marvel" (got ${JSON.stringify(tokenizeTitle('Marvel Team-Up'))})`
);

// Filter 0c behavior: a Captain Marvel search must now correctly REJECT
// Captain America / Captain Britain comps (previously passed on loose
// "captain"-only overlap once "marvel" silently vanished from our tokens).
const ourTokens = tokenizeTitle('Captain Marvel');
assertTrue(
  !hasSufficientTitleOverlap('Captain America #17 CGC 9.6', ourTokens, 0.5),
  'Filter 0c: "Captain America" comp correctly REJECTED against a Captain Marvel search'
);
assertTrue(
  !hasSufficientTitleOverlap('Captain Britain #17 VF', ourTokens, 0.5),
  'Filter 0c: "Captain Britain" comp correctly REJECTED against a Captain Marvel search'
);
assertTrue(
  hasSufficientTitleOverlap('Captain Marvel #17 2nd Print', ourTokens, 0.5),
  'Filter 0c: a genuine "Captain Marvel" comp still correctly ACCEPTED'
);

// stripMetadataTokens direct check (defense-in-depth fix, independent of
// the COMPOUND_WHITELIST early-return in tokenizeTitle).
assertTrue(
  stripMetadataTokens('captain marvel').includes('marvel'),
  `stripMetadataTokens("captain marvel") preserves "marvel" directly (got "${stripMetadataTokens('captain marvel')}")`
);

// Control: genuine non-compound titles still get "marvel"/"dc" stripped
// normally — the whitelist must not become so permissive it stops doing
// its actual job.
assertTrue(
  !tokenizeTitle('Fantastic Four Marvel CGC 9.8').includes('marvel'),
  `control: tokenizeTitle("Fantastic Four Marvel CGC 9.8") still strips "marvel" (got ${JSON.stringify(tokenizeTitle('Fantastic Four Marvel CGC 9.8'))})`
);
assertTrue(
  tokenizeTitle('Fantastic Four Marvel CGC 9.8').includes('fantastic'),
  'control: core title "Fantastic Four" preserved'
);
assertTrue(
  !stripMetadataTokens('fantastic four marvel comics').includes('marvel'),
  `control: stripMetadataTokens strips "marvel" from a genuinely non-compound title (got "${stripMetadataTokens('fantastic four marvel comics')}")`
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
