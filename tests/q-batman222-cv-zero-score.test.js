// Q-BATMAN222 — ComicVine's issue-matching tiebreaker no longer picks a
// "winner" when every scored candidate totals 0. Tests the actual exported
// lookupComicVine() end-to-end with a mocked fetch, not just the isolated
// condition, since the scoring/tiebreak closures aren't separately
// exported (same constraint noted for the Q-ADV397 visual guard).
//
// Regression anchor — Batman #222 (2026-07-15 production log, pulled via
// `vercel logs`): ComicVine's search for "batman 222" returned 9 issue-
// number matches. Only the first 5 unique volume ids get a volume-detail
// fetch (uniqueVolIds.slice(0,5), Ship #20a.6.16 Win #1) — the other 4
// skip straight to scoring with no detail data, and BOTH the token-gate
// and publisher-gate fail OPEN when a candidate has no fetched volume
// name ("if (!vol?.name) return true"), so a completely unrelated volume
// (Tiger, Zembla, Knockout -- confirmed via the real log's
// "[comicvine] top scores:" line) can reach the scoring stage untouched
// by the very gates built to reject it. There, scoreMatch reads the
// volume name straight off the ORIGINAL search result (r.volume.name,
// unaffected by the missing detail fetch) and correctly scores it 0 --
// but the pre-fix tiebreaker adopted scored[0] regardless, because
// nothing checked whether that "best" score meant anything at all.
//
// This test reproduces that exact mechanism: 5 filler volumes (details
// fetched, legitimately rejected by token-gate) plus the 3 real junk
// volumes from the log (details never fetched, survive every gate by
// default, score total=0). Separately notes -- but does not fix, out of
// scope for this greenlight -- that the *real* root cause is one layer up:
// the 5-volume-detail cap plus fail-open gates let ANY unrelated volume
// past when detail data wasn't fetched for it. This fix is the safety net
// at the end of the pipeline, not a fix to that leak.
//
// Invoke: node tests/q-batman222-cv-zero-score.test.js

import { lookupComicVine } from '../api/enrich.js';

let passed = 0;
let failed = 0;
const failures = [];

const assertEq = (actual, expected, label) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}\n    expected: ${e}\n    actual:   ${a}`;
    failures.push(msg);
    console.log(msg);
  }
};

console.log('\n=== Q-BATMAN222 — ComicVine zero-score tiebreaker ===\n');

process.env.COMICVINE_API_KEY = 'test-key-not-real';

// 5 filler volumes: unique ids 90001-90005, names unrelated to "batman"
// (so token-gate correctly rejects them once their details ARE fetched --
// matching real behavior for candidates that don't skip the gate).
const FILLER_VOL_IDS = [90001, 90002, 90003, 90004, 90005];
const FILLER_NAMES = ['Wobble', 'Frunk', 'Glazier', 'Marmot', 'Cinderblock'];

// The real junk candidates from tonight's log, in order.
const REAL_JUNK = [
  { id: 37555, name: 'Tiger' },
  { id: 39787, name: 'Zembla' },
  { id: 41224, name: 'Knockout' },
];

const searchResults = [
  ...FILLER_VOL_IDS.map((id, i) => ({
    issue_number: '222',
    cover_date: '1970-01-01',
    volume: { id, name: FILLER_NAMES[i] },
  })),
  ...REAL_JUNK.map((v) => ({
    issue_number: '222',
    cover_date: '1970-01-01',
    volume: { id: v.id, name: v.name },
  })),
];

const volDetailResponses = {
  90001: { id: 90001, name: 'Wobble', start_year: '1985', publisher: { name: 'Some Publisher' } },
  90002: { id: 90002, name: 'Frunk', start_year: '1985', publisher: { name: 'Some Publisher' } },
  90003: { id: 90003, name: 'Glazier', start_year: '1985', publisher: { name: 'Some Publisher' } },
  90004: { id: 90004, name: 'Marmot', start_year: '1985', publisher: { name: 'Some Publisher' } },
  90005: { id: 90005, name: 'Cinderblock', start_year: '1985', publisher: { name: 'Some Publisher' } },
  // Tiger/Zembla/Knockout deliberately absent -- the real request never
  // fetched details for them either (only the first 5 unique ids do).
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

let result;
try {
  result = await lookupComicVine({ title: 'Batman #222', issue: '222', year: '1970', publisher: 'DC' });
} finally {
  global.fetch = originalFetch;
  console.log = originalLog;
}

assertEq(result, null, 'lookupComicVine returns null instead of adopting "Tiger" (or Zembla/Knockout) as a fake match');

const sawAllZeroLog = logs.some((l) => l.includes('all') && l.includes('candidates score total=0'));
assertEq(sawAllZeroLog, true, 'the new [comicvine] all-zero log line fired');

const sawTiebreakerLog = logs.some((l) => l.includes('[cv-pub-tiebreaker]'));
assertEq(sawTiebreakerLog, false, 'the old tiebreaker path did NOT run -- short-circuited before it, not patched after');

const sawTokenGateRejects = logs.filter((l) => l.includes('[cv-token-gate] REJECT')).length;
assertEq(sawTokenGateRejects, 5, 'all 5 filler volumes (which DID get detail data) were correctly rejected by the existing token-gate, confirming that gate still works for candidates it can see');

console.log(`\n=== RESULTS ===`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) {
  console.log('\n=== FAILURES ===');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
console.log('All tests passed.\n');
process.exit(0);
