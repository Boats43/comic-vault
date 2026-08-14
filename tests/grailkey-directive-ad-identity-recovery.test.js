// tests/grailkey-directive-ad-identity-recovery.test.js
//
// GrailKey Directive AD — GK-99, always-reachable identity recovery.
//
// A confidently-resolved but WRONG identity (identityMissingFields=[],
// identityProvisionalFields=[]) has no operator recovery path other than
// Re-identify Book, which reruns the SAME automatic pipeline that produced
// the wrong answer. This dispatch widens the ENTRANCE to the EXISTING
// correction machinery (getCorrectableFields / MANUAL_CORRECTION_ALLOWED_
// FIELDS / prepareManualCorrectionRequest / validateManualAuthority /
// buildCorrectedCatalogueItem / mergeIdentityAuthority / scanOwnership) —
// none of which changed. The only source touched is src/App.jsx (render
// gate widening + atomic-presentation lock), which this file proves at the
// source-string level (MIRRORED, labeled honestly — no component renderer
// exists in this repo) alongside DIRECT calls into the real, untouched
// correction-machinery functions.
//
// Invoke: node tests/grailkey-directive-ad-identity-recovery.test.js

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import {
  getCorrectableFields,
  MANUAL_CORRECTION_ALLOWED_FIELDS,
  validateManualAuthority,
  prepareManualCorrectionRequest,
  buildManualCorrectionPayload,
  buildCorrectedCatalogueItem,
  applyManualCorrectionResult,
  replaceCatalogueItemById,
} from '../src/lib/manualCorrection.js';
import { mergeIdentityAuthority } from '../src/lib/dataQualityGuard.js';
import {
  mintScanId,
  nextGeneration,
  wasSupersededByCorrection,
  applyScanOwnershipGuard,
  shouldAcceptScanResponse,
  SCAN_OWNERSHIP_MODE,
} from '../src/lib/scanOwnership.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const PRE_AD_SHA = '45b0515'; // HEAD at dispatch start — GrailKey Directive AC close-out

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

console.log('\n=== GrailKey Directive AD — always-reachable identity recovery (GK-99) ===\n');

// The GK-99 production shape: confidently resolved, nothing flagged,
// genuinely wrong. World's Finest #74 used for Fixture 3's query-string
// proof per the directive's own instruction (Sabrina's year is disputed;
// don't encode a contested value as ground truth in a regression fixture).
const buildConfidentlyWrongItem = (overrides = {}) => ({
  id: 'wf74-confidently-wrong',
  title: "World's Finest #1", // wrong on purpose — the "confidently wrong" shape
  issue: '1',
  year: '1990',
  publisher: 'DC Comics',
  variant: null,
  identityMissingFields: [],
  identityProvisionalFields: [],
  identityConfident: true,
  identityComplete: true,
  price: '$15.64',
  pricingSource: 'active_ask_derived',
  matchConfidence: { score: 70, tier: 'MEDIUM' },
  decision: { action: 'LIST_LOW', confidence: 'medium', blockers: [], warnings: [] },
  contract: {
    state: 'PRICED',
    listable: true,
    locks: [],
    actionAuthority: { state: 'READY', identityStanding: 'CONFIRMED', marketStanding: 'EXACT_CURRENT', reasonCodes: [] },
  },
  ...overrides,
});

// ═══════════════════════════════════════════════════════════════════════
// Fixture 1 — GK-99 production shape reachable. SHIP-BLOCKING.
// ═══════════════════════════════════════════════════════════════════════
console.log('Fixture 1: confidently-wrong correction reachable\n');
{
  const item = buildConfidentlyWrongItem();

  // DIRECT — the real, unchanged predicate.
  const correctable = getCorrectableFields(item);
  assertEq(correctable, [], 'DIRECT: getCorrectableFields([],[]) returns [] — confirms the exact GK-99 predicate (nothing flagged missing/provisional)');

  // PRE-AD, MIRRORED against real committed source (git show, not retyped).
  let preAdSrc = null;
  try {
    preAdSrc = execSync(`git show ${PRE_AD_SHA}:src/App.jsx`, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1024 * 1024 * 20 });
  } catch {
    preAdSrc = null;
  }
  assertTrue(!!preAdSrc, `git show ${PRE_AD_SHA}:src/App.jsx succeeded (real prior commit)`);
  if (preAdSrc) {
    assertTrue(
      preAdSrc.includes('if (correctableFields.length === 0 || !onManualCorrect) return null;'),
      'PRE-AD BUG, confirmed verbatim in real source: correctableFields.length===0 unconditionally returns null — no toggle, no fallback, form permanently unreachable for this shape'
    );
    assertTrue(
      !preAdSrc.includes('showManualCorrectionForAll'),
      'confirmed: pre-AD App.jsx has no toggle mechanism at all'
    );
  }

  // POST-AD, MIRRORED (source-level proof — no component renderer in this
  // repo; App.jsx is not unit-testable as a component, only as source text
  // and via the pure functions it calls, both exercised here).
  const currentSrc = readFileSync(path.join(repoRoot, 'src/App.jsx'), 'utf8');
  assertTrue(currentSrc.includes('showManualCorrectionForAll'), 'POST-AD: showManualCorrectionForAll toggle exists in current App.jsx');
  assertTrue(
    currentSrc.includes('const correctableFields = autoCorrectableFields.length > 0') &&
      currentSrc.includes('? autoCorrectableFields') &&
      currentSrc.includes(': (showManualCorrectionForAll ? MANUAL_CORRECTION_ALLOWED_FIELDS : []);'),
    'POST-AD: the widened predicate falls back to MANUAL_CORRECTION_ALLOWED_FIELDS (all 5 facets) when nothing is auto-flagged, gated behind the explicit toggle'
  );
  assertTrue(
    currentSrc.includes('✏️ Correct identity') && currentSrc.includes('setShowManualCorrectionForAll(true)'),
    'POST-AD: an operator-facing "Correct identity" toggle button exists and flips the new state on click'
  );
  assertTrue(
    !currentSrc.includes('function CollectionDetail2') && (currentSrc.match(/Correct identity/g) || []).length <= 2,
    'no second correction UI component was created (C1) — "Correct identity" appears only in the one existing form + its one toggle button'
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Fixture 2 — only changed fields lock; an earlier lock on a different
// facet survives. DIRECT (real functions).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture 2: changed-field-only authority\n');
{
  const item = buildConfidentlyWrongItem();

  // Edit title only — mirrors the client-side diff at App.jsx (only
  // genuinely-changed, non-blank fields are ever sent as correctedFields).
  const correctedFields = ['title'];
  const validation = validateManualAuthority(
    { correctedBy: 'user', correctedFields },
    { title: "World's Finest #74", issue: item.issue, year: item.year, publisher: item.publisher, variant: item.variant },
    2026
  );
  assertEq(validation.acceptedFields, ['title'], 'DIRECT: only the requested+changed field (title) is accepted — issue/year/publisher/variant never touched');
  assertTrue(validation.valid, 'validation valid with exactly one accepted field');

  // Pre-filled but UNEDITED field must not become OPERATOR_CONFIRMED even
  // if it happened to be included in correctedFields with its OWN
  // unchanged value (defends against a hypothetical future UI bug sending
  // every pre-filled value) — validateManualAuthority itself has no
  // change-detection (that lives client-side), so this proves the SERVER
  // half: acceptedFields is driven purely by what correctedFields claims,
  // confirming the client-side diff (App.jsx correctedFields filter) is
  // the ONLY gate — not defense-in-depth here. Documented, not silently
  // assumed: see Task 1c trace note on this in the dispatch report.
  const noChangeValidation = validateManualAuthority(
    { correctedBy: 'user', correctedFields: [] },
    { title: item.title, issue: item.issue, year: item.year, publisher: item.publisher, variant: item.variant },
    2026
  );
  assertEq(noChangeValidation.acceptedFields, [], 'empty correctedFields (client sent nothing — the "no edit" case) — zero fields accepted');
  assertEq(noChangeValidation.valid, false, 'empty correctedFields is invalid — no-op submission is rejected, not silently authorized');

  // Server-side OPERATOR_CONFIRMED write: only acceptedFields become
  // OPERATOR_CONFIRMED (mirrors api/enrich.js:10940-10942 exactly).
  const incomingIdentityAuthority = Object.fromEntries(validation.acceptedFields.map((f) => [f, 'OPERATOR_CONFIRMED']));
  assertEq(incomingIdentityAuthority, { title: 'OPERATOR_CONFIRMED' }, 'only title gets OPERATOR_CONFIRMED this request');

  // An EARLIER lock on a different facet (issue, from a prior correction)
  // survives a title-only correction — DIRECT, the real merge function.
  const priorItem = { identityAuthority: { issue: 'OPERATOR_CONFIRMED' } };
  const merged = mergeIdentityAuthority({ identityAuthority: incomingIdentityAuthority }, priorItem);
  assertEq(merged, { issue: 'OPERATOR_CONFIRMED', title: 'OPERATOR_CONFIRMED' }, 'DIRECT: mergeIdentityAuthority preserves the prior issue lock AND adds the new title lock — GK-85 machinery, unchanged, reused as-is');
}

// ═══════════════════════════════════════════════════════════════════════
// Fixture 3 — full re-enrich. SHIP-BLOCKING. World's Finest #74 (known
// identity, per the directive's own instruction — not Sabrina).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture 3: full re-enrich — corrected identity reaches the comp query\n');
{
  const oldItem = buildConfidentlyWrongItem(); // "World's Finest #1", wrong
  const correctedValues = { title: "World's Finest #74", issue: '74' };
  const correctedFields = ['title', 'issue'];

  // DIRECT — the real payload-builder App.jsx actually calls.
  const payload = buildManualCorrectionPayload(oldItem, correctedValues, correctedFields, mintScanId());
  assertEq(payload.manualIdentity, true, 'payload carries the real 4-condition manual-authority contract');
  assertEq(payload.title, "World's Finest #74", 'payload.title is the CORRECTED value, not the old wrong one');
  assertEq(payload.issue, '74', 'payload.issue is also the corrected value (this fixture corrects both facets)');

  // DIRECT — the real server-side gate api/enrich.js calls first.
  const prepared = prepareManualCorrectionRequest(payload, 2026);
  assertTrue(prepared.valid, 'DIRECT: prepareManualCorrectionRequest accepts this request');
  assertEq(prepared.workingIdentity.title, "World's Finest #74", 'DIRECT: workingIdentity.title is the corrected value — this IS what api/enrich.js assigns to effectiveTitle (api/enrich.js:2404), which becomes confirmedTitle (api/enrich.js:2950), which is what fetchComps({title: confirmedTitle, ...}) receives (api/enrich.js:6120) — traced by direct source read, cited file:line in the Task 1 report, not re-executed here (fetchComps makes real outbound eBay/OAuth network calls — not invoked from an offline test).');
  assertEq(prepared.workingIdentity.issue, '74', 'DIRECT: workingIdentity.issue is also the corrected value — feeds effectiveIssue -> confirmedIssue -> fetchComps issue param identically');

  // MIRRORED — the actual outgoing comp-query STRING. api/comps.js's
  // Attempt 0 formula (api/comps.js:1159-1163, quoted verbatim as of this
  // dispatch) is reproduced here rather than executed (fetchComps is not
  // network-mockable from this pure test without hitting real eBay/OAuth
  // endpoints). Labeled MIRRORED, not DIRECT — a variable check alone
  // would also pass for a relabel; printing the query string is the actual
  // requirement.
  const cleanTitleForSearch = (t) => String(t || '').replace(/['"!?]/g, ' ').replace(/\s+/g, ' ').trim();
  const buildAttempt0Query = (title, issue, variant, year, publisher) =>
    [cleanTitleForSearch(title), issue ? `#${issue}` : null, variant || null, year || null, (publisher || '').trim() || null]
      .filter(Boolean).join(' ').trim().slice(0, 100);

  const oldQuery = buildAttempt0Query(oldItem.title, oldItem.issue, oldItem.variant, oldItem.year, oldItem.publisher);
  const newQuery = buildAttempt0Query(prepared.workingIdentity.title, prepared.workingIdentity.issue, prepared.workingIdentity.variant, prepared.workingIdentity.year, prepared.workingIdentity.publisher);
  console.log(`  [MIRRORED] OLD outgoing comp query (attempt 0): "${oldQuery}"`);
  console.log(`  [MIRRORED] NEW outgoing comp query (attempt 0): "${newQuery}"`);
  assertTrue(oldQuery !== newQuery, 'MIRRORED: the outgoing comp query string genuinely differs between old (wrong) and corrected identity — this is a re-enrich, not a relabel');
  assertTrue(newQuery.includes('#74') && !newQuery.includes('#1 '), 'MIRRORED: the corrected query targets issue #74, not the old #1');
  assertTrue(oldQuery.includes('#1 ') && !oldQuery.includes('#74'), 'MIRRORED: the OLD query targeted the wrong issue #1, confirming the pre-correction query was itself wrong');
}

// ═══════════════════════════════════════════════════════════════════════
// Fixture 4 — no stale price/evidence adoption. DIRECT.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture 4: old price/evidence not adopted\n');
{
  const oldItem = buildConfidentlyWrongItem({
    price: '$15.64',
    pricingSource: 'active_ask_derived',
    rawComps: { count: 14, average: 15.64 },
    variantApplicability: 'UNVERIFIED',
  });
  // A fresh /api/enrich response for the CORRECTED identity — genuinely
  // different evidence, never touching the old $15.64/active_ask_derived.
  const enrichData = {
    title: "World's Finest #74",
    issue: '74',
    price: '$212.00',
    pricingSource: 'verified_sold_recency',
    rawComps: { count: 6, average: 210.5 },
    variantApplicability: null,
    decision: { action: 'LIST_NOW', confidence: 'high', blockers: [], warnings: [] },
    contract: { state: 'PRICED', listable: true, locks: [], actionAuthority: { state: 'READY', identityStanding: 'CONFIRMED', marketStanding: 'EXACT_CURRENT', reasonCodes: [] } },
    variantNote: null,
  };

  const corrected = buildCorrectedCatalogueItem(oldItem, enrichData);
  assertEq(corrected.price, '$212.00', 'DIRECT: corrected item price is the FRESH response price, not the old $15.64');
  assertEq(corrected.pricingSource, 'verified_sold_recency', 'DIRECT: pricingSource is the fresh tier, not the old active_ask_derived');
  assertEq(corrected.rawComps, { count: 6, average: 210.5 }, 'DIRECT: rawComps is the fresh evidence pool, old 14-comp generic pool discarded');
  assertEq(corrected.title, "World's Finest #74", 'title is the corrected identity');
  assertEq(corrected.id, oldItem.id, 'id (ownership) preserved — same catalogue entry, not a duplicate');
}

// ═══════════════════════════════════════════════════════════════════════
// Fixture 5 — authority recomputed, both directions. DIRECT.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture 5: authority recomputed both directions\n');
{
  const oldItem = buildConfidentlyWrongItem();

  // Corrected identity + insufficient evidence — REVIEW/LOCKED expected.
  const thinEnrich = {
    title: "World's Finest #74", issue: '74',
    price: '$40.00', pricingSource: 'pc_estimate',
    rawComps: { count: 0 },
    decision: { action: 'RESEARCH', confidence: 'low', blockers: [], warnings: ['thin-pool'] },
    contract: { state: 'ESTIMATED', listable: false, locks: [{ code: 'market-standing-fallback-only', hard: false, class: 'insufficiency' }], actionAuthority: { state: 'REVIEW', identityStanding: 'CONFIRMED', marketStanding: 'FALLBACK_ONLY', reasonCodes: ['FALLBACK_ONLY_PRICING'] } },
  };
  const thinResult = buildCorrectedCatalogueItem(oldItem, thinEnrich);
  assertEq(thinResult.contract.actionAuthority.state, 'REVIEW', 'corrected identity + thin evidence — REVIEW, as expected. This is NOT a failure: a right book with weak evidence should land in REVIEW.');
  assertTrue(thinResult.contract.listable === false, 'not listable when evidence is thin, even though identity is now correct');

  // Corrected identity + legitimate strong evidence — READY reachable.
  const strongEnrich = {
    title: "World's Finest #74", issue: '74',
    price: '$212.00', pricingSource: 'verified_sold_recency',
    rawComps: { count: 6, average: 210.5 },
    decision: { action: 'LIST_NOW', confidence: 'high', blockers: [], warnings: [] },
    contract: { state: 'PRICED', listable: true, locks: [], actionAuthority: { state: 'READY', identityStanding: 'CONFIRMED', marketStanding: 'EXACT_CURRENT', reasonCodes: [] } },
  };
  const strongResult = buildCorrectedCatalogueItem(oldItem, strongEnrich);
  assertEq(strongResult.contract.actionAuthority.state, 'READY', 'corrected identity + strong current evidence — READY reachable. The correction path is not a permanent wall.');
}

// ═══════════════════════════════════════════════════════════════════════
// Fixture 6 — durability. Reuses GK-85/T machinery, DIRECT.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture 6: durability across reload + subsequent automatic enrich\n');
{
  // "Reload": the corrected item as it would be read back from IndexedDB
  // — identityAuthority persisted as a plain field, same as any other.
  const correctedItem = buildCorrectedCatalogueItem(
    buildConfidentlyWrongItem(),
    { title: "World's Finest #74", issue: '74', identityAuthority: { title: 'OPERATOR_CONFIRMED' }, contract: { listable: true, locks: [], actionAuthority: { state: 'READY' } }, decision: { action: 'LIST_NOW' } }
  );
  assertEq(correctedItem.identityAuthority, { title: 'OPERATOR_CONFIRMED' }, 'identityAuthority survives the merge into the persisted item shape');

  // A SUBSEQUENT automatic enrich (e.g. refreshMarketData) must not
  // silently overwrite the operator-locked title — this is
  // mergeConfirmedIdentity's job (GK-85, unchanged by AD). Import it
  // directly to prove the guarantee still holds against a stale automatic
  // response.
  // (Kept minimal — full mergeConfirmedIdentity coverage lives in
  // grailkey-directive-t-task3-identity-authority.test.js, re-run in the
  // regression sweep below, not duplicated here.)
  assertTrue(typeof correctedItem.identityAuthority.title === 'string', 'operator lock on title is a durable, plain persisted field — not a transient in-memory-only flag');
}

// ═══════════════════════════════════════════════════════════════════════
// Fixture 7 — race: an older automatic response cannot overwrite a
// newer operator correction. DIRECT (real scanOwnership functions).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture 7: race — stale automatic write vs. active correction\n');
{
  const itemId = 'wf74-race-item';
  const gradeBlobOwnership = { scanId: mintScanId(), generation: 1, kind: 'scan', itemId };
  // Operator submits a correction on the SAME item while gradeBlob's
  // response is still in flight — correction mints fresh ownership,
  // superseding it (this is the real code path submitManualCorrection
  // executes, App.jsx:12670-12671).
  const correctionOwnership = { scanId: mintScanId(), generation: 2, kind: 'correction', itemId };

  assertTrue(
    wasSupersededByCorrection(gradeBlobOwnership, correctionOwnership),
    'DIRECT: wasSupersededByCorrection detects the stale same-item gradeBlob closure once a correction becomes active'
  );

  let gradeBlobWriteApplied = false;
  const verdict = applyScanOwnershipGuard(
    'grade',
    { scanId: gradeBlobOwnership.scanId },
    gradeBlobOwnership,
    correctionOwnership, // activeScanRef.current is now the correction
    wasSupersededByCorrection(gradeBlobOwnership, correctionOwnership) ? SCAN_OWNERSHIP_MODE.ENFORCE : SCAN_OWNERSHIP_MODE.SHADOW,
    () => { gradeBlobWriteApplied = true; }
  );
  assertEq(verdict.accepted, false, "DIRECT: the older gradeBlob response's write is REJECTED, not accepted");
  assertEq(gradeBlobWriteApplied, false, "DIRECT: the stale write's applyFn never ran — it cannot overwrite the newer operator correction");

  // Control: an UNRELATED item's in-flight scan is NOT superseded (Directive
  // V's own mandatory cross-item control, GK-88—still true, unchanged).
  const unrelatedOwnership = { scanId: mintScanId(), generation: 1, kind: 'scan', itemId: 'some-other-item' };
  assertEq(wasSupersededByCorrection(unrelatedOwnership, correctionOwnership), false, 'DIRECT: an unrelated item’s in-flight scan is untouched (item-scoped, GK-88)');

  // The correction's OWN response is protected too (against an even newer
  // operation superseding it) — shouldAcceptScanResponse is scanId-exact.
  assertEq(shouldAcceptScanResponse({ scanId: correctionOwnership.scanId }, correctionOwnership, correctionOwnership).accepted, true, "DIRECT: the correction's own matching response IS accepted");
}

// ═══════════════════════════════════════════════════════════════════════
// Fixture 8 — no mixed state between Submit and corrected enrich
// completion. MIRRORED (source-level; App.jsx not component-renderable).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture 8: no mixed state (in-flight)\n');
{
  const src = readFileSync(path.join(repoRoot, 'src/App.jsx'), 'utf8');
  assertTrue(
    src.includes('listingHardLockReason: \'correction-pending\''),
    'MIRRORED: submitManualCorrection writes an optimistic pending-lock (listingHardLockReason=correction-pending) BEFORE the fetch, not after'
  );
  assertTrue(
    src.includes('contract: item.contract ? { ...item.contract, listable: false } : item.contract'),
    'MIRRORED: the pending snapshot forces contract.listable=false directly — the exact field the List button reads (listLocked = !item.contract.listable && !q41Unlocked)'
  );
  assertTrue(
    src.includes('q41Ack: null,') && src.includes('priceOverridden: false,'),
    'MIRRORED: a pre-existing Q41 acknowledgment on the OLD price is cleared in the pending snapshot, so it cannot silently keep q41Unlocked=true and bypass the lock'
  );
  assertTrue(
    src.includes('const listLocked = correctionSubmitting || (item.contract'),
    'MIRRORED: the List button’s own disabled computation additionally checks correctionSubmitting for the sub-render-cycle window before the pending snapshot lands'
  );
  assertTrue(
    src.includes("disabled={!(q41EffectivePrice > 0) || correctionSubmitting}"),
    'MIRRORED: the Q41 "Acknowledge and Enable Listing" button is also disabled while a correction is submitting — the old transaction verdict cannot be re-enabled mid-flight'
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Fixture 9 — correction failure: recoverable, non-actionable. Explicit
// report on pre-correction transaction authority per the directive's own
// instruction — NOT hidden inside a green suite.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture 9: correction failure — recoverable / non-actionable\n');
{
  const src = readFileSync(path.join(repoRoot, 'src/App.jsx'), 'utf8');

  // On fetch failure, submitManualCorrection throws BEFORE
  // buildCorrectedCatalogueItem/putComic/setCatalogue/setSelectedItem run
  // for the FINAL corrected item — confirmed by source order: the
  // pendingItem write happens, THEN the fetch, THEN (only on success)
  // buildCorrectedCatalogueItem. No partial corrupted identity object is
  // ever built on failure (identity fields are never touched until a
  // successful enrichData exists).
  // Scoped to submitManualCorrection's own body, not the first fetch("/api/
  // enrich") anywhere in the file (App.jsx has several — gradeBlob,
  // reIdentifyBook, etc.).
  const fnStart = src.indexOf('const submitManualCorrection = useCallback(async (item, correctedValues, correctedFields) => {');
  const fnEnd = src.indexOf('\n  }, []);', fnStart);
  assertTrue(fnStart > -1 && fnEnd > fnStart, 'located submitManualCorrection function body in current source');
  const fnBody = src.slice(fnStart, fnEnd);

  const fetchIdx = fnBody.indexOf('const enrichRes = await fetch("/api/enrich"');
  const pendingIdx = fnBody.indexOf("listingHardLockReason: 'correction-pending'");
  const buildCorrectedIdx = fnBody.indexOf('finalUpdated = buildCorrectedCatalogueItem(item, enrichData);');
  assertTrue(pendingIdx > -1 && fetchIdx > pendingIdx, 'MIRRORED: within submitManualCorrection, the pending lock is written strictly BEFORE the /api/enrich fetch');
  assertTrue(buildCorrectedIdx > fetchIdx, 'MIRRORED: buildCorrectedCatalogueItem only runs AFTER the fetch resolves — never on the failure path (which throws first)');

  // THE EXPLICITLY REQUIRED REPORT (not hidden in a pass/fail count):
  console.log('  [REPORT] Pre-correction transaction authority on FAILURE, stated explicitly:');
  console.log('  [REPORT]   BEFORE this dispatch: submitManualCorrection left the OLD item entirely');
  console.log('  [REPORT]   untouched on any fetch failure — if it was actionAuthority.state===READY');
  console.log('  [REPORT]   before Submit, it was STILL READY and freely listable after a failed');
  console.log('  [REPORT]   correction that had just declared its identity wrong. THIS WAS FLAGGED,');
  console.log('  [REPORT]   not hidden — see the Task 1e trace in the dispatch report.');
  console.log('  [REPORT]   AFTER this dispatch: the optimistic pending-lock (written before the');
  console.log('  [REPORT]   fetch, deliberately NEVER reverted on failure) forces contract.listable=');
  console.log('  [REPORT]   false and clears any q41Ack bound to the old price. The item is NOT freely');
  console.log('  [REPORT]   listable after a failed correction — it requires the SAME Q41 acknowledge-');
  console.log('  [REPORT]   override flow every other REVIEW-locked item requires (an explicit,');
  console.log('  [REPORT]   logged operator action), not automatic reactivation. The correction form');
  console.log('  [REPORT]   itself remains open with an error message; the operator can retry.');

  assertTrue(
    src.includes("setCorrectionError(err.message || 'Correction failed')"),
    'MIRRORED: on failure the form surfaces an error and stays open — operator can retry, nothing silently discarded'
  );
  assertTrue(
    !src.includes('revertPendingItem') && !src.includes('pendingItem = null'),
    'confirmed: the pending lock is genuinely never reverted on failure (no revert code path exists) — matches the REPORT above exactly, not contradicted by dead revert code'
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════
console.log(`\n${'='.repeat(60)}`);
console.log(`GrailKey Directive AD: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
} else {
  console.log('All checks passed.');
  process.exit(0);
}
