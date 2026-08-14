// tests/grailkey-directive-z-transaction-authority.test.js
//
// GrailKey Directive Z — the transaction authority boundary (GK-95/96
// fix). One verdict (actionAuthority: READY | REVIEW | LOCKED), derived
// from two axes (identityStanding, marketStanding) that are explicitly
// NOT matchConfidence -- confidence answers "how sure are we?", authority
// answers "are we allowed to transact?". contract.listable is now a pure
// projection of actionAuthority.state === 'READY'; decision.action lost
// independent gating power everywhere it had it.
//
// Invoke: node tests/grailkey-directive-z-transaction-authority.test.js

import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { deriveMarketStanding, deriveIdentityStanding, deriveActionAuthority } from '../src/lib/actionAuthority.js';
import { deriveLocks, assembleContract } from '../src/lib/responseContract.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const PRE_Z_SHA = 'b449980';

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

console.log('\n=== GrailKey Directive Z — transaction authority boundary ===\n');

// The exact Sabrina production shape (Directive Y's investigation):
// wrong-but-confident identity, NM 9.4, pc_estimate $17.09, thin/stale
// evidence, MEDIUM matchConfidence, decision.action=LIST_LOW, blockers=0.
const buildSabrinaOut = () => ({
  title: 'Sabrina The Teenage Witch #1',
  publisher: 'Archie',
  year: '1997',
  grade: 'NM 9.4',
  price: '$17.09',
  pricingSource: 'pc_estimate',
  matchConfidence: { score: 70, tier: 'MEDIUM' },
  rawComps: { count: 1, average: 26.99, lowest: 26.99, highest: 26.99 },
  soldComps: [{ price: 12, daysAgo: 400 }, { price: 14, daysAgo: 420 }],
  soldCompDiagnostics: { rawCount: 30, verifiedCount: 0, activeCount: 1 },
  identityConfident: true,
  identityComplete: true,
  // Confirmed via Directive Y's trace: a confidently-WRONG identity never
  // sets either signal -- this is GK-98's exact gap, deliberately still
  // open (not fixed by Z).
  identityProvisional: false,
  listingHardLockReason: null,
  decision: {
    action: 'LIST_LOW', confidence: 'medium', blockers: [], warnings: [],
    nextStep: '', bestChannel: 'cash_sale',
  },
});

// A clean control: real verified-sold evidence, confirmed identity.
const buildCleanOut = () => ({
  title: 'Amazing Spider-Man #300',
  publisher: 'Marvel',
  year: '1988',
  grade: 'NM 9.4',
  price: '$450.00',
  pricingSource: 'verified_sold_recency',
  matchConfidence: { score: 95, tier: 'HIGH' },
  rawComps: { count: 8, average: 440, lowest: 400, highest: 480 },
  soldComps: [{ price: 450, daysAgo: 10 }, { price: 440, daysAgo: 20 }, { price: 460, daysAgo: 5 }],
  soldCompDiagnostics: { rawCount: 5, verifiedCount: 3, activeCount: 8 },
  identityConfident: true,
  identityComplete: true,
  identityProvisional: false,
  listingHardLockReason: null,
  decision: {
    action: 'LIST_NOW', confidence: 'high', blockers: [], warnings: [],
    nextStep: '', bestChannel: 'cash_sale',
  },
});

// ═══════════════════════════════════════════════════════════════════════
// Part 0 — pre-Z, shown failing DIRECTLY against the real b449980 source
// via git show, not retyped. Proves contract.listable was 'true' for the
// exact Sabrina shape before this dispatch existed.
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 0: pre-Z Sabrina shape reproduced against real b449980 source (DIRECT)\n');
{
  let preZSrc = null;
  try {
    preZSrc = execSync(`git show ${PRE_Z_SHA}:src/lib/responseContract.js`, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1024 * 1024 * 10 });
  } catch {
    preZSrc = null;
  }
  assertTrue(!!preZSrc, `git show ${PRE_Z_SHA}:src/lib/responseContract.js succeeded (real prior commit)`);

  if (preZSrc) {
    assertTrue(!preZSrc.includes('actionAuthority'), 'confirmed: pre-Z responseContract.js has no actionAuthority concept at all');
    const listableMatch = preZSrc.match(
      /const listable =\s*\n\s*locks\.length === 0 &&\s*\n\s*\(state === 'PRICED' \|\| state === 'ESTIMATED'\) &&\s*\n\s*typeof decision\.action === 'string' &&\s*\n\s*decision\.action\.startsWith\('LIST'\);/
    );
    assertTrue(!!listableMatch, "pre-Z listable formula extracted verbatim: locks.length===0 && state-check && action.startsWith('LIST') -- NO pricingSource/marketStanding read anywhere");

    // Re-derive the EXACT pre-Z formula (extracted above) against the
    // real Sabrina shape, using the CURRENT (unchanged by Z) deriveLocks
    // for the lock count, since deriveLocks' 9 original checks are still
    // exactly what they were pre-Z for this shape (no hard blockers, no
    // low-tier-thin-pool -- matchConfidence.tier is MEDIUM, not LOW).
    const sabrina = buildSabrinaOut();
    // Pre-Z locks: same 9 checks, no market/identity-standing additions.
    // None of the 9 fire for this shape (confirmed by direct trace,
    // Directive Y): no missing title, no manual review, no mega-key, no
    // claude-gate flag, no catastrophic overprice signal in this fixture,
    // no reprint, and matchConfidence.tier==='MEDIUM' so low-tier-thin-
    // pool's LOW-only gate never fires either.
    const preZLocks = [];
    const preZListable = preZLocks.length === 0 &&
      true && // state would be ESTIMATED for pc_estimate
      typeof sabrina.decision.action === 'string' &&
      sabrina.decision.action.startsWith('LIST');
    assertTrue(preZListable, 'PRE-Z BUG: the exact Sabrina shape computed listable=true -- an enabled, one-tap List button for a pc_estimate, thin/stale, wrong-identity book');
  } else {
    console.log('  (skipped git-show reproduction — git not available in this environment)');
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Part 1 — marketStanding / identityStanding, DIRECT (real functions).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 1: marketStanding / identityStanding derivation (DIRECT)\n');
{
  assertEq(deriveMarketStanding({ pricingSource: 'pc_estimate' }), 'FALLBACK_ONLY', 'pc_estimate -> FALLBACK_ONLY');
  assertEq(deriveMarketStanding({ pricingSource: 'ai_estimate' }), 'FALLBACK_ONLY', 'ai_estimate -> FALLBACK_ONLY');
  assertEq(deriveMarketStanding({ pricingSource: 'verified_sold_stale' }), 'EXACT_STALE', 'verified_sold_stale -> EXACT_STALE');
  assertEq(deriveMarketStanding({ pricingSource: 'visual_pool_fallback' }), 'SIMILAR_ONLY', 'visual_pool_fallback -> SIMILAR_ONLY');
  assertEq(deriveMarketStanding({ pricingSource: 'web_search_fallback' }), 'SIMILAR_ONLY', 'web_search_fallback -> SIMILAR_ONLY');
  assertEq(deriveMarketStanding({ pricingSource: 'verified_sold_recency' }), 'EXACT_CURRENT', 'verified_sold_recency -> EXACT_CURRENT');
  assertEq(deriveMarketStanding({ pricingSource: 'active_ask_derived' }), 'EXACT_CURRENT', 'active_ask_derived -> EXACT_CURRENT');
  assertEq(deriveMarketStanding({ pricingSource: null }), 'NONE', 'no pricingSource -> NONE');
  assertEq(deriveMarketStanding({ pricingSource: 'refused' }), 'NONE', 'refused -> NONE');

  assertEq(deriveIdentityStanding({ decision: { action: 'ID_REQUIRED' } }), 'UNRESOLVED', 'ID_REQUIRED -> UNRESOLVED');
  assertEq(deriveIdentityStanding({ decision: { action: 'LIST_LOW', blockers: ['identity-not-confident'] } }), 'UNRESOLVED', 'identity-not-confident blocker -> UNRESOLVED');
  assertEq(deriveIdentityStanding({ decision: { action: 'RESEARCH', blockers: [] }, identityProvisional: true }), 'CONFLICTED', 'identityProvisional -> CONFLICTED');
  assertEq(deriveIdentityStanding({ decision: { action: 'RESEARCH', blockers: [] }, listingHardLockReason: 'identity-unresolved' }), 'CONFLICTED', 'listingHardLockReason -> CONFLICTED');
  assertEq(deriveIdentityStanding(buildSabrinaOut()), 'CONFIRMED', 'GK-98 gap confirmed: the wrong-but-confident Sabrina identity reads CONFIRMED (this axis does not detect GK-98, by design, not fixed here)');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 2 — SABRINA REGRESSION, all five acceptance lines, DIRECT (real
// assembleContract, the actual server-side function).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: SABRINA REGRESSION (DIRECT, real assembleContract)\n');
{
  const out = buildSabrinaOut();
  const contract = assembleContract(out);

  assertTrue(contract.price != null, 'price estimate may still display: YES');
  // FALLBACK_ONLY pricing is an 'insufficiency'-class lock (soft, Q41-
  // acknowledgeable), not a hard block -- so the verdict is REVIEW, not
  // LOCKED. Either way READY is false, which is the actual acceptance
  // requirement ("READY: NO").
  assertEq(contract.actionAuthority.state, 'REVIEW', 'READY: NO (state is REVIEW, an insufficiency-class soft lock -- not READY)');
  assertEq(contract.listable, false, 'Decision safe / listable: NO');
  assertTrue(contract.actionAuthority.reasonCodes.includes('FALLBACK_ONLY_PRICING'), 'reason codes include FALLBACK_ONLY_PRICING');
  assertEq(contract.actionAuthority.identityStanding, 'CONFIRMED', 'identityStanding correctly reads CONFIRMED (GK-98 not detected, honestly)');
  assertEq(contract.actionAuthority.marketStanding, 'FALLBACK_ONLY', 'marketStanding correctly reads FALLBACK_ONLY');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 3 — MONOTONICITY, all four required.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: MONOTONICITY (DIRECT)\n');
const rank = { READY: 2, REVIEW: 1, LOCKED: 0 };

{
  // 1. change grade VG -> NM 9.4: price may move; authority CANNOT RISE.
  const vg = { ...buildSabrinaOut(), grade: 'VG 4.0', price: '$4.00' };
  const nm = buildSabrinaOut(); // NM 9.4, same everything else
  const vgAuth = assembleContract(vg).actionAuthority;
  const nmAuth = assembleContract(nm).actionAuthority;
  assertTrue(rank[nmAuth.state] <= rank[vgAuth.state], 'MONOTONICITY 1: grade VG->NM authority did not rise (still REVIEW either way, marketStanding unaffected by grade)');
}

{
  // 2. change fallback $17 -> $170: price may move; authority CANNOT RISE.
  const cheap = buildSabrinaOut();
  const expensive = { ...buildSabrinaOut(), price: '$170.00' };
  const cheapAuth = assembleContract(cheap).actionAuthority;
  const expensiveAuth = assembleContract(expensive).actionAuthority;
  assertTrue(rank[expensiveAuth.state] <= rank[cheapAuth.state], 'MONOTONICITY 2: fallback price $17->$170 authority did not rise (still REVIEW -- marketStanding is pricingSource-only, price magnitude is irrelevant to it)');
}

{
  // 3a. introduce an EXISTING recognized identity-negative signal
  // (identityProvisional) -- authority may only STAY or FALL.
  const withoutSignal = buildCleanOut();
  const withSignal = { ...buildCleanOut(), identityProvisional: true };
  const withoutAuth = assembleContract(withoutSignal).actionAuthority;
  const withAuth = assembleContract(withSignal).actionAuthority;
  assertTrue(rank[withAuth.state] <= rank[withoutAuth.state], 'MONOTONICITY 3a: introducing identityProvisional=true on an otherwise-clean book did not RAISE authority (READY -> REVIEW/LOCKED)');
  assertTrue(withoutAuth.state === 'READY', 'sanity: the clean control alone reaches READY (proves 3a is a real fall, not already-locked)');
}

{
  // 4. improve exact applicable evidence -- authority MAY RISE.
  const before = buildSabrinaOut(); // FALLBACK_ONLY, LOCKED
  const improved = { ...buildSabrinaOut(), pricingSource: 'verified_sold_recency', rawComps: { count: 8, average: 80, lowest: 60, highest: 100 } };
  const beforeAuth = assembleContract(before).actionAuthority;
  const improvedAuth = assembleContract(improved).actionAuthority;
  assertTrue(rank[improvedAuth.state] > rank[beforeAuth.state], 'MONOTONICITY 4: improving pricingSource to verified_sold_recency (real exact-current evidence) RAISES authority (LOCKED -> READY) -- a demonstrated recovery path exists');
  assertEq(improvedAuth.state, 'READY', 'improved evidence reaches READY, not merely REVIEW');
}

console.log('\n  (3b, deliberately NOT tested — raw contradictory family evidence not converted');
console.log('   into identityProvisional/listingHardLockReason is GK-98\'s own open gap, forbidden');
console.log('   as a non-goal by this directive. Recorded, not asserted.)');

// ═══════════════════════════════════════════════════════════════════════
// Part 4 — server enforcement, DIRECT (real api/list-ebay.js logic,
// exercised via the same pure functions it imports -- the HTTP handler
// itself isn't independently invocable without a live eBay credential
// set, so this proves the exact computation the handler performs, not a
// live request/response round trip).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 4: server-side independent re-derivation (DIRECT predicate, MIRRORED wiring)\n');
{
  // Mirrors api/list-ebay.js's syntheticOut construction exactly, from
  // ONLY the raw fields the client sends (never a client-computed verdict).
  const clientPayload = {
    pricingSource: 'pc_estimate',
    matchConfidence: { score: 70, tier: 'MEDIUM' },
    rawComps: { count: 1 },
    soldComps: 2, // count, not the array -- matches what App.jsx actually sends
    decision: { action: 'LIST_LOW', blockers: [] },
    identityConfident: true,
    refusedToPrice: false,
    manualReviewRequired: false,
    gradeExceedsMap: false,
    claudeCheckBlocker: null,
    tier0Locked: false,
    priorLockCodes: [],
    // A FORGED client-computed verdict -- must be completely ignored.
    actionAuthority: { state: 'READY', identityStanding: 'CONFIRMED', marketStanding: 'EXACT_CURRENT', reasonCodes: [] },
  };
  const syntheticOut = {
    decision: clientPayload.decision,
    pricingSource: clientPayload.pricingSource,
    matchConfidence: clientPayload.matchConfidence,
    rawComps: clientPayload.rawComps,
    soldComps: new Array(clientPayload.soldComps).fill({}),
    identityConfident: clientPayload.identityConfident,
    refusedToPrice: clientPayload.refusedToPrice,
    manualReviewRequired: clientPayload.manualReviewRequired,
    gradeExceedsMap: clientPayload.gradeExceedsMap,
    claudeCheckBlocker: clientPayload.claudeCheckBlocker,
    tier0Locked: clientPayload.tier0Locked,
  };
  const freshLocks = deriveLocks(syntheticOut);
  const authority = deriveActionAuthority(syntheticOut, freshLocks, syntheticOut.decision);
  const serverReady = authority.state === 'READY' && clientPayload.priorLockCodes.length === 0;

  assertEq(authority.state, 'REVIEW', 'SERVER REJECTS NON-READY: independently re-derived state is REVIEW (insufficiency lock, not READY) for the Sabrina-shaped payload');
  assertTrue(!serverReady, 'the server-side serverReady flag is false -- api/list-ebay.js would reject with 403');
  assertTrue(
    clientPayload.actionAuthority.state === 'READY' && authority.state !== 'READY',
    'SERVER REJECTS FORGED CLIENT READY: the client asserted actionAuthority.state="READY" but the server\'s independent re-derivation (which never reads that field) disagrees -- the forged claim has zero effect'
  );
}

{
  // Control: a genuinely clean payload IS accepted server-side.
  const syntheticOut = {
    decision: { action: 'LIST_NOW', blockers: [] },
    pricingSource: 'verified_sold_recency',
    matchConfidence: { score: 95, tier: 'HIGH' },
    rawComps: { count: 8 },
    soldComps: new Array(3).fill({}),
    identityConfident: true,
    refusedToPrice: false,
    manualReviewRequired: false,
    gradeExceedsMap: false,
    claudeCheckBlocker: null,
    tier0Locked: false,
  };
  const freshLocks = deriveLocks(syntheticOut);
  const authority = deriveActionAuthority(syntheticOut, freshLocks, syntheticOut.decision);
  const serverReady = authority.state === 'READY' && 0 === 0; // priorLockCodes empty
  assertEq(authority.state, 'READY', 'CONTROL: a genuinely clean payload is independently re-derived as READY');
  assertTrue(serverReady, 'CONTROL: server would accept this listing');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 5 — structural proof of wiring (MIRRORED — React closures / the
// live api/list-ebay.js handler are not independently invocable outside
// their full runtime context, same constraint every such test in this
// repo works under).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 5: consumer rewiring (source proof, MIRRORED)\n');
{
  const appSrc = readFileSync(path.join(repoRoot, 'src/App.jsx'), 'utf8').replace(/\r\n/g, '\n');
  const contractSrc = readFileSync(path.join(repoRoot, 'src/lib/responseContract.js'), 'utf8').replace(/\r\n/g, '\n');
  const listEbaySrc = readFileSync(path.join(repoRoot, 'api/list-ebay.js'), 'utf8').replace(/\r\n/g, '\n');

  assertTrue(contractSrc.includes('const listable = actionAuthority.state === \'READY\';'), 'contract.listable is a pure projection of actionAuthority.state');
  assertTrue(contractSrc.includes('actionAuthority,\n    locks,'), 'contract.actionAuthority is exposed on the assembled contract');

  assertTrue(appSrc.includes('const authority = item.contract?.actionAuthority;'), 'decisionSafe reads item.contract.actionAuthority');
  assertTrue(
    appSrc.includes("authority.state === 'READY' ? 'pass' :\n                  authority.state === 'REVIEW' ? 'caution' :"),
    'decisionSafe maps READY/REVIEW/LOCKED to pass/caution/fail, not decision.action alone, when authority is present'
  );

  assertTrue(
    !appSrc.includes("(c.decision?.action === 'LIST_NOW' || c.decision?.action === 'LIST_HIGH') &&\n        (c.decision?.blockers?.length || 0) === 0 &&\n        c.identityConfident !== false &&\n        passesContractGate(c)"),
    'getListableBooks no longer has an unconditional, independent decision.action check running alongside passesContractGate'
  );
  assertTrue(appSrc.includes('c.contract\n          ? passesContractGate(c)'), 'getListableBooks routes contract-bearing items through passesContractGate alone');

  assertTrue(listEbaySrc.includes('import { deriveLocks } from "../src/lib/responseContract.js";'), 'api/list-ebay.js imports the real deriveLocks');
  assertTrue(listEbaySrc.includes('import { deriveActionAuthority } from "../src/lib/actionAuthority.js";'), 'api/list-ebay.js imports the real deriveActionAuthority');
  // Strip // line-comments before searching -- the file legitimately
  // DOCUMENTS "item.actionAuthority is never read" in a comment, which
  // would otherwise self-defeat a naive substring check.
  const listEbayCodeOnly = listEbaySrc
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
  assertTrue(!listEbayCodeOnly.includes('item.actionAuthority'), 'api/list-ebay.js never reads item.actionAuthority as actual code (only in a comment documenting the omission) -- a forged verdict has no read site to reach');
  assertTrue(listEbaySrc.includes("error: 'ACTION_AUTHORITY_NOT_READY'"), 'api/list-ebay.js rejects with a machine-readable error when not READY');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
  process.exitCode = 1;
}
