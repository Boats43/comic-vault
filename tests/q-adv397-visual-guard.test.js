// Q-ADV397 — lookupEbayVisual (enrich.js) now delegates its issue-consensus
// vote to extractConsensus instead of a separate ad-hoc freq/maxCount tally.
// The two implementations disagreed because they used different
// denominators: the old tally counted only rows with a parseable issue
// number, extractConsensus counts the full returned pool. lookupEbayVisual
// itself isn't exported (lives inline in api/enrich.js, makes a live eBay
// fetch), so this tests the shared logic it now delegates to directly,
// against real production data.
//
// Regression anchor 1 — Adventure Comics #397 (2026-07-15 production log,
// pulled via `vercel logs`): Vision correctly read #397. eBay visual pool
// returned 20 results; the old ad-hoc tally counted issue-frequency only
// over the 18 rows with a parseable issue number ("[visual] winner: 401
// (9/18)" = 50%, cleared its flat >=3-hit bar) and silently discarded
// the 2 unparseable rows from its denominator. extractConsensus counts the
// full pool of 20 ("[phase1] eBay consensus: ... #null (confidence 48%)"
// in the same real request) -- 9/20 = 45%, fails issueOk>=50%. Titles below
// are the exact 20 raw eBay titles from that request.
//
// Regression anchor 2 — Ultimate Spider-Man #2 (same log window): winner
// "1" at 6/12 (50%), but Vision's #2 has 2 hits (present, non-zero) so the
// override never should have been in play regardless of the winner's
// share -- the claudeInResults branch decides this case, not mostCommon's
// percentage. Reconstructed to match the real observed counts (6/12 for
// "1", Vision's "2" present 2x); the exact raw titles weren't retained
// from that log pull, only the aggregate counts extractConsensus itself
// would also reproduce from them.
//
// Invoke: node tests/q-adv397-visual-guard.test.js

import { extractIdentityFromImageSearch, extractConsensus } from '../src/lib/imageSearchIdentity.js';

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
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertFalse = (cond, label) => assertEq(!!cond, false, label);

console.log('\n=== Q-ADV397 — visual-guard denominator fix ===\n');

// ─── Regression anchor 1: Adventure Comics #397 ────────────────────────
console.log('Adventure Comics #397 (real production titles, 2026-07-15):');

const ADV397_TITLES = [
  'SUPERGIRL Adventure Comics 401 - DC Comics 1971 ',
  'Adventure Comics Presents Supergirl #401 (DC Comics January 1971)',
  'Adventure Comics Presents Supergirl #401 (DC Comics January 1971)',
  'ADVENTURE COMICS #401 DC Comics 1971 THE NEW SUPERGIRL VG+ 4.5 Combine Shipping',
  'ADVENTURE COMICS #401 FN DC 1971 SUPERGIRL SCARED MIKE SEKOWSKY FRANK GIACOIA',
  'Adventure Comics starring Supergirl #402 Comic Book VF',
  'Adventure Comics #408  Comic Book',
  'ADVENTURE COMICS Presents The New SUPERGIRL  #407 Vol 1 JUNE 1971 See Photos',
  'Adventure Comics #401 DC 1971 The Frightened Supergirl!  Combine Shipping! Nice!',
  'Adventure Comics #407  Comic Book',
  'DC - ADVENTURE COMICS - FEATURING SUPERGIRL - 407 - SUSPICION CONFIRMED!',
  'Adventure Comics #407 Supergirl Linda Danvers DC Comics JL',
  'DC Adventure Comics #401 (1970) Supergirl - "The Frightened Supergirl"',
  'Adventure Comics #407 1971 Supergirl',
  'Adventure comics Presents Supergirl #401 ~ 1971 DC Comics ~ Frightened Supergirl',
  'Adventure Comics Supergirl #405 1971 Quality Vintage',
  'Supergirl #10 (1974) DC Comics Final Issue! Vol 1 President Appearance',
  'Adventure Comics Presents Supergirl #401 DC Comics 1971',
  'ADVENTURE COMICS # 401,  DC 1970, Hi Def. Scans, (EJG01), Fine + 6.5',
  'DC Adventure Comics Presents Supergirl #399 November 1970 Comic Book',
];

assertEq(ADV397_TITLES.length, 20, 'fixture has all 20 real titles');

const adv397Rows = extractIdentityFromImageSearch(ADV397_TITLES.map((title) => ({ title })));
const adv397ParseableIssues = adv397Rows.map((r) => r.issue).filter(Boolean);

assertEq(adv397ParseableIssues.length, 18, '18 of 20 rows yield a parseable issue (matches real log)');
assertEq(adv397ParseableIssues.filter((i) => i === '401').length, 9, '9 of those 18 are #401 (matches real log "9/18")');
assertEq(adv397ParseableIssues.filter((i) => i === '397').length, 0, 'zero rows are #397 -- Vision\'s read has no pool support');

const adv397Consensus = extractConsensus(adv397Rows, '397');

assertTrue(adv397Consensus !== null, 'extractConsensus attempts consensus (pool of 20 >= 5)');
assertEq(adv397Consensus.agreement.total, 20, 'denominator is the full pool (20), not just parseable-issue rows (18)');
assertEq(adv397Consensus.agreement.issue, 9, '#401 still gets 9 raw votes');
assertEq(adv397Consensus.issue, null, 'issueOk fails at 9/20=45% (<50%) -- NO consensus issue, unlike the old 9/18=50% ad-hoc tally');
assertEq(adv397Consensus.agreement.visionIssueCount, 0, 'Vision\'s #397 confirmed zero pool support');

// This is exactly the value lookupEbayVisual's `mostCommon` now resolves
// to for this real case -- null, so the override branch (mostCommon &&
// claudeStr && mostCommon !== claudeStr && !claudeInResults) never fires.
assertEq(adv397Consensus.issue ?? null, null, 'mostCommon resolves to null -- override guard does not fire, Vision\'s #397 stands');

// ─── Regression anchor 2: Ultimate Spider-Man #2 (must NOT regress) ────
console.log('\nUltimate Spider-Man #2 (reconstructed from real observed counts, same log window):');

// 12 parseable issues: 6x "1" (the visual-pool winner), 2x "2" (Vision's
// read, present but a minority), 4 scattered others -- matches the real
// "[visual] winner: 1 (6/12)" / "Claude=#2 present in eBay results (2 hits)"
// log lines exactly. Built via title/# strings so this exercises the same
// extractIdentityFromImageSearch parse path as anchor 1, not hand-built rows.
const USM2_TITLES = [
  'Ultimate Spider-Man #1 Marvel 2000 Bendis Bagley',
  'Ultimate Spider-Man #1 Marvel 2000 NM',
  'Ultimate Spider-Man #1 1st print Marvel',
  'Ultimate Spider-Man #1 Marvel Comics 2000',
  'Ultimate Spider-Man #1 VF/NM Bendis',
  'Ultimate Spider-Man #1 Marvel key issue',
  'Ultimate Spider-Man #2A ; Marvel | Bendis - Bagley',
  'Ultimate Spider-Man #2 Marvel 2000 Bagley cover',
  'Ultimate Spider-Man #3 Marvel 2001',
  'Ultimate Spider-Man #4 Marvel VF',
  'Ultimate Spider-Man #5 Marvel Bendis',
  'Ultimate Spider-Man #6 Marvel Bendis Bagley',
];

const usm2Rows = extractIdentityFromImageSearch(USM2_TITLES.map((title) => ({ title })));
const usm2ParseableIssues = usm2Rows.map((r) => r.issue).filter(Boolean);

assertEq(usm2ParseableIssues.length, 12, 'fixture yields 12 parseable issues (matches real "6/12" denominator)');
assertEq(usm2ParseableIssues.filter((i) => i === '1').length, 6, '"1" wins 6 of 12 (matches real log)');
assertEq(usm2ParseableIssues.filter((i) => i === '2').length, 2, 'Vision\'s "2" has 2 hits, non-zero (matches real log)');

const usm2Consensus = extractConsensus(usm2Rows, '2');

assertTrue(usm2Consensus !== null, 'extractConsensus attempts consensus (pool of 12 >= 5)');
assertTrue(usm2Consensus.agreement.visionIssueCount > 0, 'Vision\'s issue "2" has non-zero pool support');
// The decisive branch in lookupEbayVisual is claudeInResults (visionIssueCount > 0),
// evaluated BEFORE mostCommon's share matters -- confirms the fix (which
// only changes how mostCommon/issueOk is computed) cannot touch this case.
assertEq(usm2Consensus.agreement.visionIssueCount, 2, 'exactly 2 hits for Vision\'s #2, as in the real log');

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
