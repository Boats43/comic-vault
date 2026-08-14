// tests/grailkey-directive-ae-cache-identity-atomicity.test.js
//
// GrailKey Directive AE — GK-107 (cache-key identity coverage) + GK-108
// (Q41 acknowledge vs correction-pending lock).
//
// GK-107: AD reported cache keys as identity-derived and therefore safe
// against stale reuse under a correction. Production evidence (a pc:v2:
// key missing a year segment) prompted re-verification — the pc:/ac: keys
// genuinely never encoded publisher (confirmed by direct source read),
// so a publisher-only correction could reuse a PC anchor / active-comp
// pool fetched under the wrong publisher's query terms. Fixed by adding
// publisher to buildFilterContextFingerprint (ac:) and
// buildPriceChartingCacheKey (pc:), version-bumped so old entries can't
// be misread as still valid.
//
// GK-108: AD's own handoff flagged "a Q41-acknowledged item's price-bound
// override could theoretically still coexist with a pending correction"
// as noted-not-chased. Traced here: a SECOND, independent Q41 acknowledge
// path (the `item.contract.locks.length > 0` branch, distinct from the
// one AD's correctionSubmitting check covered) reads item.priceOverridden
// (which flips true on every keystroke in the price input, unconditionally)
// and item.q41Ack (settable by that button, also unconditionally) — neither
// gated by correctionSubmitting, and both survive past the in-flight
// window since correctionSubmitting resets to false whether the
// correction succeeds OR fails. Fixed with a single top-of-render guard
// keyed on item.listingHardLockReason === 'correction-pending' (a field
// AD already introduced, never reverted on failure) that preempts BOTH
// Q41 paths and the List button uniformly — closes the in-flight window
// AND the post-failure window in one check, no new mechanism.
//
// Server-side (api/list-ebay.js): confirmed as a STOP GATE, not fixed.
// listingHardLocked/listingHardLockReason are not in syntheticOut at all,
// and the pending-correction state is a pure client-side value with no
// server-side echo or independent verification path — the same
// underlying shape as GK-103 (client-supplied/client-only state at the
// listing trust boundary), not a new gap. Logged, not fixed, per this
// dispatch's own explicit STOP GATE instruction.
//
// Invoke: node tests/grailkey-directive-ae-cache-identity-atomicity.test.js

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import {
  buildFilterContextFingerprint,
  buildActiveCompCacheKey,
  buildPriceChartingCacheKey,
  buildComicVineCacheKey,
  parseCacheKeyIssueSegment,
} from '../src/lib/cacheKeys.js';
import { COMP_FILTER_VERSION } from '../src/lib/compHygiene.js';
import { PC_FILTER_VERSION, CV_FILTER_VERSION } from '../api/kv-cache.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const PRE_AE_SHA = 'ba5b130'; // HEAD at dispatch start — GrailKey Directive AD close-out

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed++; console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`;
    failures.push(msg); console.log(msg);
  }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);

console.log('\n=== GrailKey Directive AE — cache-key identity coverage + Q41 atomicity (GK-107/GK-108) ===\n');

// ═══════════════════════════════════════════════════════════════════════
// Task 1a — key composition table, DIRECT (real functions).
// ═══════════════════════════════════════════════════════════════════════
console.log('Task 1a: cache-key composition (DIRECT)\n');
{
  const cvKey = buildComicVineCacheKey('sabrina the teenage witch', '1', 'Archie', '1997', CV_FILTER_VERSION, null);
  console.log(`  [DIRECT] cv: ${cvKey}`);
  assertTrue(cvKey.includes('|1997|'), 'cv: key contains year');
  assertTrue(cvKey.includes('|Archie|'), 'cv: key contains publisher');
  assertTrue(!cvKey.toLowerCase().includes('nycc'), 'cv: key never contained variant (Dispatch 36 P1 — confirmed dead segment, unchanged by this dispatch)');

  const pcKey = buildPriceChartingCacheKey(PC_FILTER_VERSION, 'Sabrina the Teenage Witch', '1', '1997', 'Dan Parent NYCC variant', 'Archie');
  console.log(`  [DIRECT] pc: ${pcKey}`);
  assertTrue(pcKey.includes('|1997|'), 'pc: key contains year (POST-FIX: unchanged, was already present)');
  assertTrue(pcKey.includes('|Archie|'), 'pc: key contains publisher (POST-FIX: NEW)');
  assertTrue(pcKey.includes('Dan Parent NYCC variant'), 'pc: key contains variant (unchanged)');

  const fp = buildFilterContextFingerprint({ grade: 'NM 9.4', year: '1997', variant: 'Dan Parent NYCC variant', publisher: 'Archie' });
  const acKey = buildActiveCompCacheKey(COMP_FILTER_VERSION, 'Sabrina the Teenage Witch', '1', fp);
  console.log(`  [DIRECT] ac: ${acKey}`);
  assertTrue(acKey.startsWith(`v${COMP_FILTER_VERSION}:`), `ac: key uses the current v${COMP_FILTER_VERSION} prefix`);
  assertTrue(!acKey.includes('Archie'), 'ac: publisher is inside the opaque SHA-256 fingerprint, not a plain segment (expected — verified via the differential Control B below, not string inspection)');
}

// ═══════════════════════════════════════════════════════════════════════
// Control A — year-only correction. DIRECT.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nControl A: year-only correction\n');
{
  const before = buildPriceChartingCacheKey(PC_FILTER_VERSION, 'Amazing Spider-Man', '300', '1988', null, 'Marvel');
  const after = buildPriceChartingCacheKey(PC_FILTER_VERSION, 'Amazing Spider-Man', '300', '1989', null, 'Marvel');
  console.log(`  [DIRECT] pc: BEFORE (year=1988): ${before}`);
  console.log(`  [DIRECT] pc: AFTER  (year=1989): ${after}`);
  assertTrue(before !== after, 'pc: key genuinely differs on a year-only change — no cache hit on the old entry');

  const fpBefore = buildFilterContextFingerprint({ grade: 'NM 9.4', year: '1988', publisher: 'Marvel' });
  const fpAfter = buildFilterContextFingerprint({ grade: 'NM 9.4', year: '1989', publisher: 'Marvel' });
  assertTrue(fpBefore !== fpAfter, 'ac: fingerprint genuinely differs on a year-only change — confirmed already covered pre-AE (year was already a fingerprint input)');
}

// ═══════════════════════════════════════════════════════════════════════
// Control B — publisher-only correction. DIRECT. This is the confirmed
// real gap — shown failing against the real pre-AE source (git show),
// then passing against current code.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nControl B: publisher-only correction\n');
{
  let preAeSrc = null;
  try {
    preAeSrc = execSync(`git show ${PRE_AE_SHA}:src/lib/cacheKeys.js`, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1024 * 1024 * 5 });
  } catch {
    preAeSrc = null;
  }
  assertTrue(!!preAeSrc, `git show ${PRE_AE_SHA}:src/lib/cacheKeys.js succeeded (real prior commit)`);
  if (preAeSrc) {
    assertTrue(
      preAeSrc.includes("`pc:v${filterVersion}:${title}|${confirmedIssue}|${year || ''}|${variant || ''}`"),
      'PRE-AE BUG, confirmed verbatim in real source: buildPriceChartingCacheKey had 4 segments (title|issue|year|variant) — no publisher parameter existed at all'
    );
    const preAePcFn = preAeSrc.slice(preAeSrc.indexOf('export const buildPriceChartingCacheKey'));
    assertTrue(
      !preAePcFn.slice(0, preAePcFn.indexOf('\n\n')).toLowerCase().includes('publisher'),
      'confirmed: pre-AE buildPriceChartingCacheKey itself has zero mention of publisher (the CV key builder elsewhere in the same file already used it — narrowly scoped check)'
    );
  }

  const before = buildPriceChartingCacheKey(PC_FILTER_VERSION, 'Batman', '1', '2016', null, 'DC Comics');
  const after = buildPriceChartingCacheKey(PC_FILTER_VERSION, 'Batman', '1', '2016', null, 'Oni Press');
  console.log(`  [DIRECT] pc: KEY BEFORE (publisher=DC Comics): ${before}`);
  console.log(`  [DIRECT] pc: KEY AFTER  (publisher=Oni Press): ${after}`);
  assertTrue(before !== after, 'POST-FIX: pc: key genuinely differs on a publisher-only change — the confirmed gap is closed');

  const fpBefore = buildFilterContextFingerprint({ grade: 'NM 9.4', year: '2016', publisher: 'DC Comics' });
  const fpAfter = buildFilterContextFingerprint({ grade: 'NM 9.4', year: '2016', publisher: 'Oni Press' });
  assertTrue(fpBefore !== fpAfter, 'POST-FIX: ac: fingerprint genuinely differs on a publisher-only change — the confirmed gap is closed (this is the ACTIONABLE one — ac: caches the fully filtered, PRICED pool, sourced from EXACT_CURRENT-tier pricingSource values)');

  // Version bumps — old cached entries must not be misread as still valid.
  assertEq(PC_FILTER_VERSION, 3, 'PC_FILTER_VERSION bumped 2 -> 3 (GK-107)');
  assertEq(COMP_FILTER_VERSION, 12, 'COMP_FILTER_VERSION bumped 11 -> 12 (GK-107)');

  // parseCacheKeyIssueSegment unaffected by the new segment (title/issue
  // stay positions 0/1; nothing downstream reads `rest` positionally —
  // confirmed by grep across tests/*.test.js before this fix landed).
  assertEq(parseCacheKeyIssueSegment(after).title, 'batman', 'parseCacheKeyIssueSegment still extracts title correctly with the new publisher segment present');
  assertEq(parseCacheKeyIssueSegment(after).issue, '1', 'parseCacheKeyIssueSegment still extracts issue correctly with the new publisher segment present');
}

// ═══════════════════════════════════════════════════════════════════════
// Task 1c — actionability. Reported as findings (not simulated end-to-end
// — the actual pipeline requires live PC/eBay network calls, per AD's own
// established precedent for not invoking fetchComps/lookupPriceCharting
// from an offline test).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nTask 1c: actionability findings (REPORT)\n');
{
  console.log('  [REPORT] DIRECT route (isFromPC variant/key multiplier): NOT actionable toward READY.');
  console.log('  [REPORT]   VARIANT_MULT_ELIGIBLE_SOURCES (api/enrich.js:8362-8366) = {pricecharting,');
  console.log('  [REPORT]   pc_estimate, browse_api} — none of these are EXACT_CURRENT_SOURCES');
  console.log('  [REPORT]   (src/lib/actionAuthority.js). A stale PC anchor can only ever contaminate');
  console.log('  [REPORT]   an already-FALLBACK_ONLY-or-NONE price, which deriveActionAuthority can');
  console.log('  [REPORT]   never promote to READY regardless.');
  console.log('  [REPORT] INDIRECT route (confirmed ACTIONABLE, the one fixed here): the ac: cache key');
  console.log('  [REPORT]   IS the fully filtered, PRICED active-comp pool (per cacheKeys.js\'s own');
  console.log('  [REPORT]   header doctrine: "NOT raw evidence — it\'s the fully filtered, priced pool").');
  console.log('  [REPORT]   Before this fix, a publisher-only correction produced a byte-identical ac:');
  console.log('  [REPORT]   key and could return a pool fetched under the OLD publisher\'s eBay search');
  console.log('  [REPORT]   query text (api/comps.js Attempt 0 includes pubKeyword), sourced');
  console.log('  [REPORT]   active_ask_derived/verified_active — EXACT_CURRENT-tier, reachable READY —');
  console.log('  [REPORT]   for a comp population that was never actually queried for the corrected');
  console.log('  [REPORT]   book\'s publisher. This is the branch fixed in this dispatch.');
  console.log('  [REPORT] Secondary INDIRECT input (not independently fixed, covered by the same');
  console.log('  [REPORT]   ac: fingerprint fix): pcYear feeds resolveYear() unconditionally');
  console.log('  [REPORT]   (api/enrich.js:4765-4773, runs regardless of identitySource) and could');
  console.log('  [REPORT]   shift confirmedYear, which the era-consistency filter then consumes when');
  console.log('  [REPORT]   building the (now correctly publisher-scoped) ac: pool.');
  assertTrue(true, 'findings reported above, not hidden in a pass/fail count');
}

// ═══════════════════════════════════════════════════════════════════════
// Task 2 — Q41 atomicity. MIRRORED (App.jsx is not component-renderable
// in this repo — same convention as Directive AD's Fixture 8/9).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nTask 2: Q41 acknowledge vs correction-pending lock\n');
{
  let preAeSrc = null;
  try {
    preAeSrc = execSync(`git show ${PRE_AE_SHA}:src/App.jsx`, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1024 * 1024 * 20 });
  } catch {
    preAeSrc = null;
  }
  assertTrue(!!preAeSrc, `git show ${PRE_AE_SHA}:src/App.jsx succeeded (real prior commit)`);
  if (preAeSrc) {
    assertTrue(
      !preAeSrc.includes("item.listingHardLockReason === 'correction-pending'"),
      "PRE-AE BUG, confirmed verbatim in real source: no check anywhere reads listingHardLockReason === 'correction-pending' — the second Q41 path (locks.length>0 branch) had no awareness of a pending correction at all"
    );
    // The second Q41 path (bypass route) existed unchanged pre-AE too —
    // proving it's a real, reachable path, not a hypothetical one this
    // dispatch invented to justify a fix.
    assertTrue(
      preAeSrc.includes("if (allInsufficiency && item.priceOverridden && q41AckValid) {"),
      'confirmed: the second Q41 path (locks.length>0 branch) already existed pre-AE, independent of the path AD\'s correctionSubmitting check covered'
    );
    assertTrue(
      preAeSrc.includes("'priceOverridden',\n                    true"),
      'confirmed: the price input\'s onUpdateField write already set priceOverridden=true unconditionally pre-AE, with no correctionSubmitting gate anywhere near it'
    );
  }

  const currentSrc = readFileSync(path.join(repoRoot, 'src/App.jsx'), 'utf8');
  assertTrue(
    currentSrc.includes("if (item.listingHardLockReason === 'correction-pending') {"),
    'POST-AE: a single top-of-render guard now checks listingHardLockReason before ANY acknowledge path or the List button can render'
  );

  // Ordering proof: the guard must appear BEFORE both Q41 branches and the
  // List button in source order, so it actually preempts them (an IIFE
  // with sequential `if...return` early-exits — position determines
  // precedence).
  const guardIdx = currentSrc.indexOf("if (item.listingHardLockReason === 'correction-pending') {");
  const q41Path1Idx = currentSrc.indexOf('if (allInsufficiency && item.priceOverridden && q41AckValid) {');
  const q41Path2Idx = currentSrc.indexOf('const researchAckNeeded =');
  const listButtonIdx = currentSrc.indexOf('const listLocked = correctionSubmitting || (item.contract');
  assertTrue(guardIdx > -1 && q41Path1Idx > guardIdx, 'guard appears BEFORE the first Q41 path (locks.length>0 branch) in source order');
  assertTrue(q41Path2Idx > guardIdx, 'guard appears BEFORE the second Q41 path (researchAckNeeded) in source order');
  assertTrue(listButtonIdx > guardIdx, 'guard appears BEFORE the List button\'s own disabled computation in source order');

  // Persistence proof: listingHardLockReason is set BEFORE the fetch and
  // never reverted on failure (re-confirms Directive AD's own Fixture 9
  // finding — this dispatch's fix relies on that persistence being real).
  const fnStart = currentSrc.indexOf('const submitManualCorrection = useCallback(async (item, correctedValues, correctedFields) => {');
  const fnEnd = currentSrc.indexOf('\n  }, []);', fnStart);
  const fnBody = currentSrc.slice(fnStart, fnEnd);
  assertTrue(fnBody.includes("listingHardLockReason: 'correction-pending'"), 'submitManualCorrection still writes the pending lock (unchanged by this dispatch)');
  assertTrue(!fnBody.includes('listingHardLockReason: null'), 'still never writes listingHardLockReason back to null anywhere in the function — the guard\'s persistence assumption holds');
}

// ═══════════════════════════════════════════════════════════════════════
// Server-side STOP GATE — recorded, not a pass/fail assertion of a fix
// (there is deliberately no fix here).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nServer-side STOP GATE (api/list-ebay.js) — recorded\n');
{
  const listEbaySrc = readFileSync(path.join(repoRoot, 'api/list-ebay.js'), 'utf8');
  assertTrue(
    !listEbaySrc.includes('listingHardLocked') && !listEbaySrc.includes('correction-pending'),
    "confirmed: api/list-ebay.js's syntheticOut has NO visibility into listingHardLocked/listingHardLockReason at all — STOP GATE, per this dispatch's own instruction NOT to accept a new client-supplied lock boolean to close this"
  );
  console.log('  [REPORT] This is the same underlying shape as GK-103 (client-supplied/client-only');
  console.log('  [REPORT]   state at the /api/list-ebay trust boundary), not a new, independent gap —');
  console.log('  [REPORT]   "spoof away the correction-pending state" is one more concrete instance of');
  console.log('  [REPORT]   the already-logged Trigger A/B shape. Logged under GK-108, cross-referenced');
  console.log('  [REPORT]   to GK-103, deliberately not fixed (would require a server-owned session/KV');
  console.log('  [REPORT]   tracking mechanism — explicitly out of scope, "no new mechanism").');
}

// ═══════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════
console.log(`\n${'='.repeat(60)}`);
console.log(`GrailKey Directive AE: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
} else {
  console.log('All checks passed.');
  process.exit(0);
}
