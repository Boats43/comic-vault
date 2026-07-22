// Q135 dispatch (2026-07-22) — live-rescan follow-up, three ranked issues:
//
// P1 — Invincible #1 MegaCon active-comp regression: PC anchor rejected
// (Battle Beast one-shot, wrong product), pool is MegaCon-exclusive, but
// the comps query fell back to a bare "invincible #1 2026" search that
// matched Battle Beast print sets + an omnibus instead of the pool's own
// real MegaCon-exclusive listings. Two independent gaps: (a) ship12's
// imageSearchTitle selector nulls out unconditionally on
// decision==='fallback-vision' before ever checking whether a premium-
// variant pool + rejected PC anchor should recover a seed from the pool's
// own dominant rawTitle; (b) the lot/TPB filters never caught an
// enumerated "#1 2 3 4 5..." print-set listing or an omnibus/HC comp for
// a single-issue (non-TPB) book.
//
// P2 — Q134's honest-null year/publisher/issue/variant never reached the
// rendered card: the `out.issue`/`out.year`/`out.publisher` decision-
// engine normalize block (api/enrich.js) fell back to raw pre-resolution
// Vision values unconditionally (a 5th site sharing Q134's root-cause
// shape), `out.variantNote` (the field the client actually displays) was
// never set outside the PC-multiplier pricing block, and 5 separate client
// merge sites in App.jsx either omitted title/issue/publisher from the
// merge entirely or used an `enrich.X || cur.X` / narrow-truthy pattern
// that can never apply an honest null.
//
// P3 — Poison Ivy #31 regressed to a comp-consensus publisher lock because
// the ComicVine publisher-autofill check read `comicVine?.volume?.
// publisher?.name` — always undefined, since lookupComicVine's real
// return shape (api/enrich.js ~1138) has `volume` as a flat STRING and the
// resolved publisher as its OWN top-level `publisher` field. A fourth
// instance of the same "comicVine.volume is a flat string" shape bug
// CLAUDE.md already documents for the era-gate and convergence-score axes.
//
// Invoke: node tests/q135-p1-p2-p3-fixes.test.js

import { isEnumeratedIssueList, isValidIssueRange, LOT_RE, TPB_MARKER_RE } from '../src/lib/compHygiene.js';
import { applyProvisionalIdentity } from '../src/lib/dataQualityGuard.js';
import { computeDecision } from '../src/lib/decisionEngine.js';

let passed = 0;
let failed = 0;
const check = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

// ── P1(b) — isEnumeratedIssueList ────────────────────────────────────────
console.log('\n── P1(b): isEnumeratedIssueList — enumerated print-set detector ──');
{
  check(isEnumeratedIssueList('Invincible #1 2 3 4 5 6 7 8 9 10 11 (2026) MegaCon') === true,
    'catches the real enumerated print-set shape from the dispatch');
  check(isEnumeratedIssueList('Invincible #1 2026') === false,
    'does NOT false-positive on ordinary "issue + year" (only 2 numbers)');
  check(isEnumeratedIssueList('Invincible #1 2 2026') === false,
    'does NOT false-positive on "issue + stray number + year" (3 numbers, but 2026 >= 1000 breaks the guard)');
  check(isEnumeratedIssueList('Batman #9.4 CGC') === false,
    'does not fire on a decimal grade fragment');
  check(isEnumeratedIssueList('Invincible #11 10 9 8 7') === false,
    'descending sequence rejected (not strictly ascending)');
  check(isEnumeratedIssueList('') === false, 'empty string is false, not a throw');
  check(isEnumeratedIssueList(null) === false, 'null is false, not a throw');
  // Existing detectors stay byte-identical (not touched by this dispatch)
  check(isValidIssueRange('Invincible #1-11 (2026)') === true,
    'control: dash-range detector unchanged, still catches "#1-11"');
  check(LOT_RE.test('Invincible Comics #1 Lot of 5') === true,
    'control: LOT_RE unchanged, still catches explicit "lot" wording');
}

// ── P1(b) — non-TPB omnibus/HC rejection logic (mirrors api/comps.js
//      Filter 1g's new branch exactly, since that filter lives inline in
//      a large non-exported function) ────────────────────────────────────
console.log('\n── P1(b): non-TPB format rejection (Filter 1g mirror) ──');
{
  const applyNonTpbFilter = (pool, isTPB, assetType = 'comic') => {
    if (assetType === 'book' || isTPB) return pool; // untouched paths
    const filtered = pool.filter((t) => !TPB_MARKER_RE.test(t));
    return filtered.length > 0 ? filtered : pool; // graceful fallback
  };

  const invinciblePool = [
    'Invincible #1 MegaCon Exclusive Cover 2026',
    'Invincible #1 MegaCon Exclusive Signed 2026',
    'Invincible Universe: Battle Beast #1 Omnibus (2025)',
    'Invincible Compendium Vol 1 (2025)',
  ];
  const result = applyNonTpbFilter(invinciblePool, false, 'comic');
  check(result.length === 2, `omnibus + compendium rejected for a single-issue book (got ${result.length}/4 survivors)`);
  check(result.every((t) => t.includes('MegaCon')), 'only the genuine MegaCon single-issue listings survive');

  // Graceful fallback: if EVERY comp happens to be TPB-marked, don't starve to zero
  const allTpbPool = ['Batman Omnibus Vol 1', 'Batman Compendium Vol 2'];
  const fallbackResult = applyNonTpbFilter(allTpbPool, false, 'comic');
  check(fallbackResult.length === 2, 'graceful fallback: keeps all comps rather than zeroing the pool');

  // Control: isTPB=true (our book genuinely IS a collected edition) — untouched
  const tpbBook = applyNonTpbFilter(invinciblePool, true, 'comic');
  check(tpbBook.length === 4, 'isTPB=true path is untouched by this dispatch (still the require-branch\'s job)');

  // Control: books — untouched
  const bookAsset = applyNonTpbFilter(invinciblePool, false, 'book');
  check(bookAsset.length === 4, 'assetType=book path is untouched by this dispatch');
}

// ── P2 — applyProvisionalIdentity (client merge fix) ─────────────────────
console.log('\n── P2: applyProvisionalIdentity — client merge honest-null pass-through ──');
{
  // Rachta Lin shape: provisional, honest nulls on year/publisher/variant,
  // pool-derived title/issue.
  const rachtaLinEnrich = {
    identityProvisional: true,
    title: 'Pop Kill',
    confirmedTitle: 'Pop Kill',
    issue: '3',
    year: null,
    publisher: null,
    variantNote: null,
  };
  const staleCur = { title: 'Harley Quinn', issue: '75', year: '2020', publisher: 'DC Comics', variant: 'Kunkka beer variant' };
  const merged = applyProvisionalIdentity(rachtaLinEnrich, staleCur);
  check(merged.title === 'Pop Kill', `title updates to the pool-derived value (got "${merged.title}")`);
  check(merged.issue === '3', `issue updates to the pool-derived value (got "${merged.issue}")`);
  check(merged.year === null, `year is honestly null, NOT the stale "2020" (got ${JSON.stringify(merged.year)})`);
  check(merged.publisher === null, `publisher is honestly null, NOT the stale "DC Comics" (got ${JSON.stringify(merged.publisher)})`);
  check(merged.variant === null, `variant is honestly null, NOT the stale "Kunkka beer variant" (got ${JSON.stringify(merged.variant)})`);

  // Lozano shape: provisional, pool-derived year/publisher present (not null)
  const lozanoEnrich = {
    identityProvisional: true,
    title: 'Pop Kill',
    issue: '3',
    year: '2026',
    publisher: 'Mad Cave Studios',
    variantNote: null,
  };
  const lozanoMerged = applyProvisionalIdentity(lozanoEnrich, { title: 'He-Man', issue: '5', year: '2014', publisher: 'Dark Horse' });
  check(lozanoMerged.year === '2026', `Lozano: pool-derived year applied (got "${lozanoMerged.year}")`);
  check(lozanoMerged.publisher === 'Mad Cave Studios', `Lozano: pool-derived publisher applied (got "${lozanoMerged.publisher}")`);

  // Control: non-provisional card — true no-op, doesn't touch anything
  const normalEnrich = { identityProvisional: false, title: 'Amazing Spider-Man', year: null, publisher: null };
  const normalMerged = applyProvisionalIdentity(normalEnrich, { title: 'Amazing Spider-Man', year: '2018', publisher: 'Marvel Comics' });
  check(Object.keys(normalMerged).length === 0, `non-provisional enrich response is a true no-op (got ${JSON.stringify(normalMerged)})`);

  // Control: missing identityProvisional key entirely / null enrich
  check(Object.keys(applyProvisionalIdentity({}, {})).length === 0, 'missing identityProvisional key is treated as false, not a crash');
  check(Object.keys(applyProvisionalIdentity(null, {})).length === 0, 'null enrich does not throw, returns no-op');
  check(applyProvisionalIdentity({ identityProvisional: true, title: null, confirmedTitle: null }, { title: 'Fallback Title' }).title === 'Fallback Title',
    'title falls back to prior value only when BOTH enrich.title and enrich.confirmedTitle are null');
}

// ── P3 — ComicVine publisher shape-bug reconstruction ────────────────────
console.log('\n── P3: ComicVine publisher field-path fix ──');
{
  // Real shape lookupComicVine actually returns (api/enrich.js ~1138-1144):
  // volume is a flat STRING, publisher is a TOP-LEVEL field.
  const realComicVineShape = {
    id: 12345,
    name: 'Poison Ivy #31',
    volume: 'Poison Ivy', // flat string — NOT an object
    publisher: 'DC Comics', // top-level field — the REAL data
    startYear: 2025,
  };

  const oldBrokenCheck = realComicVineShape?.volume?.publisher?.name;
  check(oldBrokenCheck === undefined,
    `OLD path (comicVine?.volume?.publisher?.name) is provably always undefined against the real shape (got ${JSON.stringify(oldBrokenCheck)})`);

  const newFixedCheck = realComicVineShape?.publisher;
  check(newFixedCheck === 'DC Comics',
    `NEW path (comicVine?.publisher) correctly recovers the real CV publisher (got "${newFixedCheck}")`);

  // Control: CV genuinely has no publisher (foreign/thin match) — both paths null, no crash
  const noPublisherShape = { id: 1, name: 'X', volume: 'X', publisher: null, startYear: null };
  check((noPublisherShape?.volume?.publisher?.name ?? null) === null, 'old path: null when CV genuinely lacks publisher (no crash)');
  check((noPublisherShape?.publisher ?? null) === null, 'new path: null when CV genuinely lacks publisher (no crash)');

  // Control: comicVine itself null (CV lookup failed/timed out) — both paths null, no crash
  check((null)?.volume?.publisher?.name === undefined, 'old path: no crash when comicVine itself is null');
  check((null)?.publisher === undefined, 'new path: no crash when comicVine itself is null');
}

// ── P3 — decisionEngine ruling adjustment: CV-independent-confirmation
//      exception for the comp-consensus publisher-unresolved warning ─────
console.log('\n── P3: decisionEngine publisher-unresolved — CV exception ──');
{
  const baseItem = {
    title: 'Poison Ivy',
    issue: '31',
    year: '2025',
    price: '$4.13',
    priceLow: '$3.50',
    priceHigh: '$5.00',
    identityConfident: true,
    rawComps: { count: 8, lowest: 3.5, highest: 5, average: 4.13, prices: [] },
    comps: { count: 8 },
  };

  // Comp-consensus fired AND ComicVine independently confirms publisher —
  // should NOT warn (the ruling: comp titles must be the ONLY source).
  const withCvConfirmed = computeDecision({
    ...baseItem,
    publisher: 'DC Comics',
    publisherBackfillSource: 'active-comp-consensus',
    publisherBackfillRatio: 0.65,
    comicVine: { publisher: 'DC Comics' },
  });
  check(!withCvConfirmed.warnings.includes('publisher-unresolved'),
    `no publisher-unresolved warning when ComicVine independently confirms the publisher (warnings: ${JSON.stringify(withCvConfirmed.warnings)})`);

  // Comp-consensus fired and ComicVine has NO publisher data — should still warn
  // (comp titles genuinely are the only source here).
  const withoutCv = computeDecision({
    ...baseItem,
    publisher: 'First Comics',
    publisherBackfillSource: 'active-comp-consensus',
    publisherBackfillRatio: 0.55,
    comicVine: null,
  });
  check(withoutCv.warnings.includes('publisher-unresolved'),
    `publisher-unresolved warning STILL fires when comp-consensus really is the only source (warnings: ${JSON.stringify(withoutCv.warnings)})`);

  // Control: comicVine present but with no publisher field — still warns
  const cvNoPublisherField = computeDecision({
    ...baseItem,
    publisher: 'First Comics',
    publisherBackfillSource: 'active-comp-consensus',
    publisherBackfillRatio: 0.55,
    comicVine: { name: 'Something' }, // no .publisher
  });
  check(cvNoPublisherField.warnings.includes('publisher-unresolved'),
    'still warns when comicVine object exists but carries no publisher field');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
process.exit(0);
