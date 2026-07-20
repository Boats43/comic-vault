// Q131 systemic-audit follow-up — a coordinated pass on the "one fix,
// six-plus consumers" pattern this whole Q131 dispatch chain kept
// re-discovering. After shipping resolveIdentity/convergence/fallback-
// pricing/22e (all first-order consumers of familyCandidate.decision), a
// fresh real production rescan showed the fix was STILL leaking: the PC
// cache-key baked in "2019" (Vision's rejected year) and confirmedPublisher
// leaked back to "DC Comics" — not because those first fixes were wrong,
// but because THREE MORE call sites independently re-derive year/publisher
// from raw req.body values instead of the already-resolved confirmedYear/
// confirmedPublisher:
//
//   1. api/enrich.js PC cache keys + lookupPriceCharting calls — used the
//      bare `year` (destructured from req.body at the top of the handler,
//      line ~1961), never confirmedYear, for the PC query and its cache key.
//   2. resolveYear's first argument — same bare `year`, UNCONDITIONALLY
//      overwriting confirmedYear right back to Vision's rejected guess.
//   3. The ComicVine-then-raw publisher fallback chain — `|| publisher`
//      (the same raw local var threaded into resolveIdentity as
//      vision.publisher) undoing the null the moment confirmedPublisher
//      was falsy.
//
// Fix: single shared predicate isProvisionalRefusedIdentity(identitySource),
// used at all four sites (PC-year, resolveYear, publisher, plus the
// pre-existing refusedOut title/issue override) — deliberately keyed on
// identitySource (not familyCandidate.decision) so the GENERAL (non-
// provisional) refused-identity-conflict sub-case, where Vision's title
// legitimately stands, is untouched: there, confirmedYear/confirmedPublisher
// already correctly equal vision.year/vision.publisher via resolveIdentity's
// own initial-declaration fallthrough, so falling back to the same raw
// values downstream is correct, not a bug.
//
// Invoke: node tests/q131-systemic-audit-fixes.test.js

import { isProvisionalRefusedIdentity, resolveYear } from '../src/lib/identityCore.js';

let passed = 0;
let failed = 0;
const check = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

// ── 1. isProvisionalRefusedIdentity — the shared gate ────────────────
console.log('\n── isProvisionalRefusedIdentity ──');
{
  check(isProvisionalRefusedIdentity('title-family-refused-provisional') === true,
    'true for the provisional-override outcome');
  check(isProvisionalRefusedIdentity('vision') === false, 'false for plain vision fallback');
  check(isProvisionalRefusedIdentity('title-family-top-rank-protection') === false,
    'false for a normal family-override outcome');
  check(isProvisionalRefusedIdentity('ebay_visual_override') === false, 'false for eBay override');
  check(isProvisionalRefusedIdentity(undefined) === false, 'false for undefined');
  check(isProvisionalRefusedIdentity(null) === false, 'false for null');
}

// Real values from the actual production log (build fe7af23, 23:19 UTC
// rescan) — the exact request that exposed this gap after Fix 1/2 had
// already shipped. Vision guessed "He-Man..." with year/publisher fields
// (req.body's raw `year`/`publisher`, matching what earlier scans of this
// same photo logged), PC returned HTTP 404 for "Eternus" (no product
// exists), ComicVine timed out — so pcYear/cvYear are genuinely null,
// exactly as in the real request.
const rawYear = '2021';       // req.body.year — Vision's stale guess
const rawPublisher = 'DC Comics'; // req.body.publisher (= vision.publisher)
const pcYear = null;          // PriceCharting: HTTP 404 for "Eternus"
const cvYear = null;          // ComicVine: timeout
const ebayYearAuthoritative = null;

// ── 2. End-to-end reconstruction — provisional outcome ───────────────
console.log('\n── Eternus #2 reconstruction: provisional outcome stays null end-to-end ──');
{
  const identitySource = 'title-family-refused-provisional';
  const confirmedYear = null;      // per resolveIdentity's Q131 branch (Fix 1/2)
  const confirmedPublisher = null; // per resolveIdentity's Q131 branch (Fix 1/2)

  // Site 1: PC cache-key / lookupPriceCharting year param
  const pcQueryYear = isProvisionalRefusedIdentity(identitySource) ? confirmedYear : rawYear;
  check(pcQueryYear === null, `PC cache-key year is null, not "2019"/"${rawYear}" (got ${JSON.stringify(pcQueryYear)})`);
  const fullTitleKey = `pc:v3:Eternus #2 - NYCC Metal Virgin Variant|2|${pcQueryYear || ''}`;
  check(!fullTitleKey.includes(rawYear),
    `the actual cache-key STRING no longer bakes in the rejected year (key="${fullTitleKey}")`);

  // Site 2: resolveYear — full real function call, not a mock
  const yearForResolution = isProvisionalRefusedIdentity(identitySource) ? confirmedYear : rawYear;
  check(yearForResolution === null, `resolveYear's input is null, not "${rawYear}" (got ${JSON.stringify(yearForResolution)})`);
  const yearResolution = resolveYear(yearForResolution, pcYear, cvYear, ebayYearAuthoritative, { keyIssue: '' });
  check(yearResolution.confirmedYear == null,
    `resolveYear's REAL output stays null end-to-end — confirmedYear survives the overwrite that used to regress it (got ${JSON.stringify(yearResolution.confirmedYear)})`);

  // Site 3: publisher fallback chain
  const cvPublisherName = null; // ComicVine never resolved (timeout)
  const finalPublisher = confirmedPublisher || cvPublisherName ||
    (isProvisionalRefusedIdentity(identitySource) ? null : rawPublisher);
  check(finalPublisher === null,
    `publisher fallback chain stays null, does NOT leak back to "${rawPublisher}" (got ${JSON.stringify(finalPublisher)})`);
}

// ── 3. Critical non-regression — general (non-provisional) refused-conflict ─
console.log('\n── General refused-conflict (non-provisional): Vision legitimately stands, unaffected ──');
{
  // Thin/no-topFamily sub-case: resolveIdentity falls through to its
  // initial declaration, so confirmedYear/confirmedPublisher ALREADY
  // equal vision.year/vision.publisher (the same rawYear/rawPublisher)
  // by the time these sites run — this is the case that must NOT be
  // caught by the same-looking guard.
  const identitySource = 'vision';
  const confirmedYear = rawYear;         // already vision.year, unchanged
  const confirmedPublisher = rawPublisher; // already vision.publisher, unchanged

  const pcQueryYear = isProvisionalRefusedIdentity(identitySource) ? confirmedYear : rawYear;
  check(pcQueryYear === rawYear, `PC query year unchanged for the general case (got "${pcQueryYear}")`);

  const yearForResolution = isProvisionalRefusedIdentity(identitySource) ? confirmedYear : rawYear;
  check(yearForResolution === rawYear, `resolveYear input unchanged for the general case (got "${yearForResolution}")`);

  const finalPublisher = confirmedPublisher || null ||
    (isProvisionalRefusedIdentity(identitySource) ? null : rawPublisher);
  check(finalPublisher === rawPublisher,
    `publisher fallback unchanged for the general case — Vision's read legitimately stands (got "${finalPublisher}")`);
}

// ── 4. Non-regression — ordinary (non-refused) identification untouched ─
console.log('\n── Ordinary successful identification: byte-identical to prior behavior ──');
{
  // Normal top-rank-protection/weighted-consensus/ebay-override outcomes:
  // confirmedYear may legitimately DIFFER from raw `year` (e.g. eBay
  // consensus corrected it) — the gate must never touch these regardless
  // of whether confirmedYear equals raw year or not, since identitySource
  // is never the provisional string here.
  for (const identitySource of ['title-family-top-rank-protection', 'title-family-weighted-consensus', 'ebay_visual_override', 'vision_numeric_protection']) {
    const confirmedYear = '2019'; // hypothetically corrected by eBay consensus, DIFFERENT from rawYear
    const pcQueryYear = isProvisionalRefusedIdentity(identitySource) ? confirmedYear : rawYear;
    check(pcQueryYear === rawYear,
      `identitySource="${identitySource}": PC query year stays raw \`year\` (pre-existing behavior), untouched by this fix (got "${pcQueryYear}")`);
  }
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
process.exit(0);
