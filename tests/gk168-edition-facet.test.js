// tests/gk168-edition-facet.test.js
//
// GK-168 (2026-08-24, Creepy #1 facsimile dispatch, plan review C1-C10,
// F1-F4) — the printing/edition facet. Part 1-3 are pure unit tests of
// reconcileEditionFacet/classifyPrintingClassFromEditionWarning/the
// manual-correction enum validator. Part 4 is the GK-138 real-handler
// smoke — the five required Creepy #1 controls, run through the actual
// api/enrich.js handler with mocked fetch (same harness as
// tests/grailkey-gk148-publisher-stoplist.test.js Part 3).
//
// Invoke: node tests/gk168-edition-facet.test.js

import { reconcileEditionFacet, PRINTING_CLASS_VALUES } from '../src/lib/identityCore.js';
import { classifyPrintingClassFromEditionWarning, detectEditionWarning } from '../api/grade.js';
import { validateManualAuthority, MANUAL_CORRECTION_ALLOWED_FIELDS, PRINTING_CLASS_ENUM } from '../src/lib/manualCorrection.js';
import { deriveLocks } from '../src/lib/responseContract.js';
import { deriveMarketStanding, deriveActionAuthority } from '../src/lib/actionAuthority.js';

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

console.log('\n=== Part 1: reconcileEditionFacet — origin-then-corroborate authority model ===\n');
{
  const r = reconcileEditionFacet({});
  assertEq(r.printingClass, 'UNKNOWN', 'no evidence at all -> UNKNOWN');
  assertEq(r.authority, 'NONE', 'no evidence at all -> authority NONE');
}
{
  // Law: no vote-count authority — marketplace rows alone, zero origin
  // claim, can NEVER establish printingClass no matter how many agree.
  const r = reconcileEditionFacet({
    corroboratingClaims: [
      { source: 'row-0', printingClass: 'FACSIMILE' },
      { source: 'row-1', printingClass: 'FACSIMILE' },
      { source: 'row-2', printingClass: 'FACSIMILE' },
      { source: 'row-3', printingClass: 'FACSIMILE' },
      { source: 'row-4', printingClass: 'FACSIMILE' },
    ],
  });
  assertEq(r.printingClass, 'UNKNOWN', 'SHIP-BLOCKING: 5 agreeing marketplace rows with NO origin claim still resolve to UNKNOWN — no vote-count authority');
  assertEq(r.authority, 'NONE', 'SHIP-BLOCKING: 5 agreeing marketplace rows with NO origin claim still resolve to authority NONE');
}
{
  // Control 3 shape: bare Vision origin, zero corroboration — C8, not authority.
  const r = reconcileEditionFacet({ visionPrintingClass: 'FACSIMILE' });
  assertEq(r.printingClass, 'UNKNOWN', 'Control 3: bare Vision claim, zero corroboration -> UNKNOWN (C8: not authority)');
  assertEq(r.authority, 'NONE', 'Control 3: bare Vision claim, zero corroboration -> authority NONE');
  assertTrue(r.conflicts.some((c) => c.source === 'vision' && c.value === 'FACSIMILE'), 'Control 3: the Vision claim is preserved as visible evidence, not silently discarded');
}
{
  // Vision origin + agreeing corroboration -> CORROBORATED, sufficient to price.
  const r = reconcileEditionFacet({
    visionPrintingClass: 'FACSIMILE',
    corroboratingClaims: [
      { source: 'row-0', printingClass: 'FACSIMILE' },
      { source: 'row-1', printingClass: 'FACSIMILE' },
    ],
  });
  assertEq(r.printingClass, 'FACSIMILE', 'Vision origin + agreeing corroboration -> FACSIMILE');
  assertEq(r.authority, 'CORROBORATED', 'Vision origin + agreeing corroboration -> CORROBORATED');
}
{
  // Vision origin + a LONE disagreeing corroborator, zero agreement — same
  // C8 shape as bare-Vision-alone (no winner exists to be "contested"
  // against), matching reconcileVariant's own real precedent (NONE when
  // no winner, regardless of whether disagreeing candidates exist).
  const r = reconcileEditionFacet({
    visionPrintingClass: 'FACSIMILE',
    corroboratingClaims: [{ source: 'row-0', printingClass: 'ORIGINAL' }],
  });
  assertEq(r.authority, 'NONE', 'Vision origin + ONLY a disagreeing corroborator (zero agreement) -> NONE, not CONTESTED — C8, no winner to contest');
}
{
  // Vision origin + BOTH an agreeing AND a disagreeing corroborator ->
  // genuinely CONTESTED (a winner exists, per agreement, but something
  // else disagrees with it).
  const r = reconcileEditionFacet({
    visionPrintingClass: 'FACSIMILE',
    corroboratingClaims: [
      { source: 'row-0', printingClass: 'FACSIMILE' },
      { source: 'row-1', printingClass: 'ORIGINAL' },
    ],
  });
  assertEq(r.authority, 'CONTESTED', 'Vision origin + one agreeing + one disagreeing corroborator -> CONTESTED');
}
{
  // Control 4 shape: operator resolves current state; Vision's disagreeing
  // claim is preserved, not discarded (F1).
  const r = reconcileEditionFacet({ visionPrintingClass: 'FACSIMILE', operatorPrintingClass: 'ORIGINAL' });
  assertEq(r.printingClass, 'ORIGINAL', 'Control 4: operator confirmation resolves current state over a disagreeing Vision detection');
  assertEq(r.authority, 'OPERATOR_CONFIRMED', 'Control 4: authority is OPERATOR_CONFIRMED');
  assertTrue(r.conflicts.some((c) => c.source === 'vision' && c.value === 'FACSIMILE'), 'Control 4: SHIP-BLOCKING — Vision\'s detector evidence remains preserved/visible, not silently erased');
}
{
  // F1 — both origins may coexist and agree; no spurious conflict.
  const r = reconcileEditionFacet({ visionPrintingClass: 'FACSIMILE', operatorPrintingClass: 'FACSIMILE' });
  assertEq(r.conflicts, [], 'F1: operator and Vision agreeing -> zero conflicts');
  assertEq(r.authority, 'OPERATOR_CONFIRMED', 'F1: operator confirmation still wins as the resolved-state authority even when it agrees with Vision');
}
{
  // Operator UNKNOWN/research — plan review correction: NOT the same
  // authority-bearing path as a resolved printingClass.
  const r = reconcileEditionFacet({ visionPrintingClass: 'FACSIMILE', operatorPrintingClass: 'UNKNOWN' });
  assertEq(r.printingClass, 'UNKNOWN', 'operator picks UNKNOWN/research -> printingClass stays UNKNOWN');
  assertEq(r.authority, 'NONE', 'SHIP-BLOCKING: operator UNKNOWN/research -> authority NONE, not OPERATOR_CONFIRMED — does not unlock edition-scoped pricing');
  assertEq(r.source, 'operator', 'operator UNKNOWN/research still records that an operator action occurred (audit trail)');
  assertTrue(r.conflicts.some((c) => c.source === 'vision' && c.value === 'FACSIMILE'), 'operator UNKNOWN/research still preserves the Vision detection as visible evidence');
}
{
  // Resolved operator confirmation with NO Vision claim at all — no
  // corroboration required, matches identityAuthority precedent.
  const r = reconcileEditionFacet({ operatorPrintingClass: 'SECOND_PRINT' });
  assertEq(r.printingClass, 'SECOND_PRINT', 'resolved operator confirmation alone (no Vision claim) is fully sufficient');
  assertEq(r.authority, 'OPERATOR_CONFIRMED', 'resolved operator confirmation alone -> OPERATOR_CONFIRMED, no corroboration required');
}

console.log('\n=== Part 2: classifyPrintingClassFromEditionWarning — signal mapping ===\n');
{
  assertEq(classifyPrintingClassFromEditionWarning(null), null, 'no detection -> null');
  assertEq(classifyPrintingClassFromEditionWarning(detectEditionWarning('This is a facsimile edition.')), 'FACSIMILE', '"facsimile" signal -> FACSIMILE');
  assertEq(classifyPrintingClassFromEditionWarning(detectEditionWarning('This is a 2nd printing.')), 'SECOND_PRINT', '"2nd printing" signal -> SECOND_PRINT');
  assertEq(classifyPrintingClassFromEditionWarning(detectEditionWarning('This is a 3rd printing.')), 'LATER_PRINT', '"3rd printing" signal -> LATER_PRINT (no dedicated THIRD_PRINT enum value)');
  assertEq(classifyPrintingClassFromEditionWarning(detectEditionWarning('NOT the original printing.')), 'REPRINT', 'generic non-original signal, no specific printing number -> REPRINT (the same generic bucket the pre-GK-168 isolator already used)');
}
{
  // GK-168 Control 5 negative control — "Collector's Edition" alone must
  // never fire the detector at all (none of the 8 EDITION_WARNING_PATTERNS
  // bare-match that phrase — verified by direct trace, this test proves
  // it observably).
  const w = detectEditionWarning("COLLECTOR'S EDITION — a beautiful presentation of this classic issue.");
  assertEq(w, null, 'Control 5: SHIP-BLOCKING — "Collector\'s Edition" text alone does not fire detectEditionWarning at all');
  assertEq(classifyPrintingClassFromEditionWarning(w), null, 'Control 5: consequently classifyPrintingClassFromEditionWarning also returns null');
}

console.log('\n=== Part 3: manual-correction enum validation (F4/F5) ===\n');
{
  assertTrue(MANUAL_CORRECTION_ALLOWED_FIELDS.includes('printingClass'), 'printingClass is an allow-listed correctable field');
  assertEq(PRINTING_CLASS_ENUM, PRINTING_CLASS_VALUES, 'manualCorrection.js\'s PRINTING_CLASS_ENUM matches identityCore.js\'s PRINTING_CLASS_VALUES exactly');
}
{
  const v = validateManualAuthority(
    { correctedFields: ['printingClass'] },
    { printingClass: 'FACSIMILE' },
  );
  assertTrue(v.acceptedFields.includes('printingClass'), 'a real enum value ("FACSIMILE") validates and is accepted');
  assertEq(v.normalizedValues.printingClass, 'FACSIMILE', 'normalized value is the canonical uppercase form');
}
{
  const v = validateManualAuthority(
    { correctedFields: ['printingClass'] },
    { printingClass: 'facsimile' },
  );
  assertEq(v.normalizedValues.printingClass, 'FACSIMILE', 'lowercase input normalizes to canonical uppercase');
}
{
  // F4 — the actual server-side enforcement: an arbitrary string must
  // never acquire OPERATOR_CONFIRMED authority.
  const v = validateManualAuthority(
    { correctedFields: ['printingClass'] },
    { printingClass: 'DROP TABLE comics; a totally made up value' },
  );
  assertTrue(!v.acceptedFields.includes('printingClass'), 'SHIP-BLOCKING (F4): an arbitrary non-enum string is REJECTED, not accepted');
  assertTrue(v.emptyFields.includes('printingClass'), 'the arbitrary string lands in emptyFields, same honest-rejection path as an out-of-range year');
}

console.log('\n=== Part 4: real /api/enrich handler smoke (GK-138) — Creepy #1 controls ===\n');

delete process.env.ACCESS_CODE;
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
process.env.EBAY_APP_ID = process.env.EBAY_APP_ID || 'test-app-id';
process.env.EBAY_CERT_ID = process.env.EBAY_CERT_ID || 'test-cert-id';
process.env.PRICECHARTING_TOKEN = process.env.PRICECHARTING_TOKEN || 'test-pc-token';

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}
const buildEbayItem = (title, price, idx, prefix) => ({
  itemId: `v1|${prefix}${idx}|0`,
  title,
  leafCategoryIds: ['259104'],
  categories: [{ categoryId: '259104', categoryName: 'Comics & Graphic Novels' }],
  image: { imageUrl: 'https://i.ebayimg.com/images/g/fake/s-l225.jpg' },
  price: { value: String(price), currency: 'USD' },
  itemHref: `https://api.ebay.com/buy/browse/v1/item/v1%7C${prefix}${idx}%7C0`,
  seller: { username: `testseller${idx}`, feedbackPercentage: '99.9', feedbackScore: 1000 },
  condition: 'Used', conditionId: '3000',
  thumbnailImages: [{ imageUrl: 'https://i.ebayimg.com/images/g/fake/s-l1600.jpg' }],
  buyingOptions: ['FIXED_PRICE'],
  itemWebUrl: `https://www.ebay.com/itm/${prefix}${idx}`,
  itemLocation: { postalCode: '000**', country: 'US' },
  legacyItemId: `${prefix}${idx}`,
  adultOnly: false,
  itemOriginDate: '2024-08-16T18:07:04.000Z',
  itemCreationDate: '2024-08-16T18:07:04.000Z',
  listingMarketplaceId: 'EBAY_US',
});

// Same original 1964 comp (the specific $64 figure the dispatch's own
// Control 1 names) present in EVERY pool below — proves it never leaks
// into a confirmed-facsimile committed price.
// Raw (not slabbed) title — "CGC 7.0" would trip api/comps.js's own slab
// filter against a raw-book request (isGraded:false), removing this
// comp regardless of any GK-168 logic and defeating the fixture's own
// intent.
const ORIGINAL_COMP = ['Creepy #1 1964 Warren Frazetta Cover VG Silver Age', 64];
const FACSIMILE_COMPS = [
  ['Creepy #1 Facsimile Edition Reprint Dark Horse 2019', 12],
  ['Creepy #1 Facsimile Reprint Collector Edition', 15],
  ['Creepy #1 Facsimile Edition NM', 10],
];

async function runScan({ label, reason, manualAuthority = null, printingClass = null, pool }) {
  const IMAGE_ITEMS = pool.map(([t, p], i) => buildEbayItem(t, p, i, '7000000000'));
  const COMPS_ITEMS = pool.map(([t, p], i) => buildEbayItem(t, p, i, '8000000000'));

  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('oauth2/token') || u.includes('/oauth/')) {
      return jsonResponse({ access_token: 'fake-token', expires_in: 7200, token_type: 'Application Access Token' });
    }
    if (u.includes('search_by_image')) return jsonResponse({ itemSummaries: IMAGE_ITEMS, total: IMAGE_ITEMS.length });
    if (u.includes('item_summary/search')) return jsonResponse({ itemSummaries: COMPS_ITEMS, total: COMPS_ITEMS.length });
    if (u.includes('comicvine.gamespot.com')) return jsonResponse({ results: [], status_code: 1, error: 'OK' });
    if (u.includes('pricecharting.com')) return jsonResponse({ error: 'not found' }, 404);
    if (u.includes('api.anthropic.com')) return jsonResponse({ content: [{ type: 'text', text: '{}' }] });
    return jsonResponse({});
  };

  const capturedLogs = [];
  const originalConsoleLog = console.log;
  console.log = (...args) => {
    capturedLogs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  };

  const handlerModule = await import('../api/enrich.js');
  const handler = handlerModule.default;
  const body = {
    title: 'Creepy', issue: '1', grade: 'VG 4.0', confidence: 'medium',
    isGraded: false, numericGrade: null, year: '1964', publisher: 'Warren',
    variant: null, keyIssue: null, reason: reason || 'Creepy magazine, Frazetta cover',
    images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='],
  };
  if (manualAuthority) {
    body.manualIdentity = true;
    body.skipVision = true;
    body.skipImageSearch = true;
    body.identitySource = 'manual';
    body.manualAuthority = manualAuthority;
    body.printingClass = printingClass;
  }
  const req = { method: 'POST', headers: {}, body };
  let capturedStatus = null;
  let capturedBody = null;
  const res = {
    status: (code) => ({ json: (data) => { capturedStatus = code; capturedBody = data; return { statusCode: code, body: data }; } }),
    setHeader: () => {},
  };

  let threw = null;
  try {
    await handler(req, res);
  } catch (err) {
    threw = err;
  }
  console.log = originalConsoleLog;

  assertTrue(threw === null, `[${label}] no exception escaped the handler (${threw ? threw.stack : ''})`);
  assertTrue(capturedStatus === 200, `[${label}] HTTP 200 (actual: ${capturedStatus})`);
  if (process.env.GK168_DEBUG) {
    console.log(`  [DEBUG ${label}] filtered logs:`);
    capturedLogs.filter((l) => /edition|comps\]|attempt|reconcile-edition|\[comps\]/i.test(l)).forEach((l) => console.log(`    ${l}`));
  }
  return { body: capturedBody || {}, logs: capturedLogs };
}

async function main() {
  console.log('\n--- CONTROL 1: confirmed FACSIMILE (Vision + marketplace corroboration) ---\n');
  {
    const { body } = await runScan({
      label: 'control1',
      reason: 'This looks like a facsimile edition, possibly not the original 1964 printing.',
      pool: [ORIGINAL_COMP, ...FACSIMILE_COMPS],
    });
    console.log(`  printingClass=${body.printingClass} authority=${body.editionReconciliation?.authority} price=${body.price} confirmedYear=${body.confirmedYear} count=${body.rawComps?.count}`);
    assertEq(body.printingClass, 'FACSIMILE', 'Control 1: printingClass resolves to FACSIMILE');
    assertEq(body.editionReconciliation?.authority, 'CORROBORATED', 'Control 1: authority is CORROBORATED (Vision origin + marketplace agreement)');
    // GK-172 Control 1 contract (ruling: the blanket full-response
    // substring check was semantically overbroad — it cannot distinguish
    // "excluded from committed pricing" from "deleted from evidence," and
    // the two are not the same law (I13: annotate/exclude, never
    // vaporize). Replaced with explicit per-surface assertions: every
    // PRICING-AUTHORITATIVE surface must exclude the original $64 row;
    // imageSearchResults (reference/evidence, never pricing-authoritative)
    // is explicitly asserted to STILL contain it.
    assertTrue(!(body.rawComps?.prices || []).some((p) => p.price === 64), 'Control 1: original $64 row absent from committed edition rawComps.prices');
    assertTrue((body.rawComps?.prices || []).every((p) => !/Frazetta Cover VG/.test(p.title || '')), 'Control 1: SHIP-BLOCKING — the original $64 comp is not present in the committed comp pool at all');
    assertTrue(body.rawComps?.average !== 64 && body.rawComps?.lowest !== 64 && body.rawComps?.highest !== 64, 'Control 1: original $64 does not establish committed rawComps average/low/high');
    assertTrue(!(body.rawComps?.recentSales || []).some((p) => p.price === 64), 'Control 1: original $64 row absent from committed edition recentSales');
    assertTrue(!(body.activeCached?.prices || []).some((p) => p.price === 64), 'Control 1: original $64 row absent from the edition activeCached pricing population');
    assertTrue(body.activeCached?.average !== 64 && body.activeCached?.lowest !== 64 && body.activeCached?.highest !== 64, 'Control 1: original $64 does not establish activeCached average/low/high');
    assertTrue(!(body.activeCached?.recentSales || []).some((p) => p.price === 64), 'Control 1: original $64 row absent from activeCached recentSales');
    assertTrue(['quick', 'market', 'stretch'].every((k) => body.priceBands?.[k] !== '$64.00'), 'Control 1: original $64 does not appear in the committed priceBands quick/market/stretch derivation');
    assertTrue(body.price !== '$64.00', 'Control 1: committed out.price is not the original $64');
    assertTrue(body.decision?.price !== 64, 'Control 1: original $64 does not influence the economic recommendation (decision.price)');
    assertTrue((body.imageSearchResults || []).some((r) => r.price === 64), 'Control 1: original $64 comp MAY and DOES remain visible as reference evidence in imageSearchResults — excluded from committed pricing is not deleted from evidence (I13)');
    assertEq(body.confirmedYear, '1964', 'Control 1: confirmedYear stays 1964 — work identity untouched by the facsimile confirmation (C4)');
    assertEq(body.printingYear, null, 'Control 1: printingYear is honestly null — not fabricated to enable pricing (F3)');

    const locks = deriveLocks(body);
    const marketStanding = deriveMarketStanding(body);
    const authority = deriveActionAuthority(body, locks, body.decision);
    console.log(`  marketStanding=${marketStanding} authority.state=${authority.state} reasonCodes=${JSON.stringify(authority.reasonCodes)}`);
    assertEq(marketStanding, 'SIMILAR_ONLY', 'Control 1: REVIEW ceiling — marketStanding floors to SIMILAR_ONLY, not EXACT_CURRENT (C7)');
    assertTrue(authority.state !== 'READY', 'Control 1: REVIEW ceiling — authority.state is not READY');
    assertTrue(authority.reasonCodes.includes('EDITION_REVIEW_CEILING'), 'Control 1: the specific EDITION_REVIEW_CEILING reason code is present');
  }

  console.log('\n--- CONTROL 2: original Creepy #1 — byte-identical, no facsimile contamination ---\n');
  {
    const { body } = await runScan({
      label: 'control2',
      reason: 'Creepy magazine, Frazetta cover, some wear on the spine.',
      pool: [ORIGINAL_COMP, ['Creepy #1 1964 Warren Publishing Horror Magazine Frazetta', 58], ['Creepy #1 1964 Warren Frazetta Cover GD/VG', 50]],
    });
    console.log(`  printingClass=${body.printingClass} price=${body.price} decision=${body.decision?.action}`);
    assertEq(body.printingClass, undefined, 'Control 2: no editionWarning fired at all -> out.printingClass is not even set (byte-identical to pre-GK-168 shape)');
    assertEq(body.editionReconciliation, undefined, 'Control 2: out.editionReconciliation is not set — the whole edition-gate block never engaged');
    assertTrue(!body.refusedToPrice, 'Control 2: an ordinary original book is not refused');
  }

  console.log('\n--- CONTROL 3: Vision-origin suspicion, insufficient authority -> honest refusal ---\n');
  {
    const { body } = await runScan({
      label: 'control3',
      reason: 'This might be a facsimile edition, hard to tell for certain.',
      pool: [ORIGINAL_COMP, ['Creepy #1 1964 Warren Publishing Horror Magazine Frazetta', 58]], // zero facsimile-titled comps -> zero corroboration
    });
    console.log(`  printingClass=${body.printingClass} authority=${body.editionReconciliation?.authority} price=${body.price} pricingSource=${body.pricingSource}`);
    assertEq(body.editionReconciliation?.authority, 'NONE', 'Control 3: bare Vision claim, zero corroboration -> authority NONE (C8)');
    assertEq(body.price, null, 'Control 3: SHIP-BLOCKING — does not price as original');
    assertEq(body.printingClass, 'UNKNOWN', 'Control 3: SHIP-BLOCKING — does not price as confirmed facsimile either — printingClass stays UNKNOWN');
    assertTrue(body.refusedToPrice === true, 'Control 3: honest refusal — refusedToPrice is true');
  }

  console.log('\n--- CONTROL 4: operator confirms ORIGINAL against a detected FACSIMILE ---\n');
  {
    const { body } = await runScan({
      label: 'control4',
      reason: 'This looks like a facsimile edition, possibly not the original 1964 printing.',
      manualAuthority: { correctedBy: 'operator', correctedFields: ['printingClass'] },
      printingClass: 'ORIGINAL',
      pool: [ORIGINAL_COMP, ['Creepy #1 1964 Warren Publishing Horror Magazine Frazetta', 58], ['Creepy #1 1964 Warren Frazetta Cover GD/VG', 50], ...FACSIMILE_COMPS],
    });
    console.log(`  printingClass=${body.printingClass} authority=${body.editionReconciliation?.authority} conflicts=${JSON.stringify(body.editionReconciliation?.conflicts)} price=${body.price}`);
    assertEq(body.printingClass, 'ORIGINAL', 'Control 4: operator resolves current state to ORIGINAL');
    assertEq(body.editionReconciliation?.authority, 'OPERATOR_CONFIRMED', 'Control 4: authority is OPERATOR_CONFIRMED');
    assertTrue((body.editionReconciliation?.conflicts || []).some((c) => c.source === 'vision' && c.value === 'FACSIMILE'), 'Control 4: SHIP-BLOCKING — the detector\'s FACSIMILE evidence remains visible/preserved, not silently erased');
    assertTrue((body.rawComps?.prices || []).every((p) => !/facsimile/i.test(p.title || '')), 'Control 4: SHIP-BLOCKING — facsimile-titled comps are excluded from the original-population price');
    assertTrue((body.identityAlignment?.conflicts || []).some((c) => c.field === 'printingClass'), 'Control 4: the operator-vs-detector disagreement is surfaced via identityAlignment.conflicts (F1)');
    assertTrue(body.identityAuthority?.printingClass === 'OPERATOR_CONFIRMED', 'Control 4: identityAuthority locks printingClass for a genuinely resolved value (not the UNKNOWN carve-out case)');
  }

  console.log('\n--- CONTROL 4b: operator picks UNKNOWN/research — must NOT lock or unlock pricing ---\n');
  {
    const { body } = await runScan({
      label: 'control4b',
      reason: 'This looks like a facsimile edition, possibly not the original 1964 printing.',
      manualAuthority: { correctedBy: 'operator', correctedFields: ['printingClass'] },
      printingClass: 'UNKNOWN',
      pool: [ORIGINAL_COMP, ...FACSIMILE_COMPS],
    });
    console.log(`  printingClass=${body.printingClass} authority=${body.editionReconciliation?.authority} identityAuthority=${JSON.stringify(body.identityAuthority)}`);
    assertEq(body.printingClass, 'UNKNOWN', 'Control 4b: printingClass stays UNKNOWN');
    assertEq(body.editionReconciliation?.authority, 'NONE', 'Control 4b: SHIP-BLOCKING — authority is NONE, not OPERATOR_CONFIRMED');
    assertTrue(body.identityAuthority?.printingClass !== 'OPERATOR_CONFIRMED', 'Control 4b: SHIP-BLOCKING — printingClass is NOT locked at OPERATOR_CONFIRMED — a future scan can still re-surface the detect-and-verify slot');
    assertEq(body.price, null, 'Control 4b: no committed edition-scoped pricing while unresolved');
  }

  console.log('\n--- CONTROL 5: genuine original carrying "Collector\'s Edition" text — negative control ---\n');
  {
    const { body } = await runScan({
      label: 'control5',
      reason: "COLLECTOR'S EDITION — Frazetta cover, some spine wear, otherwise well preserved.",
      pool: [ORIGINAL_COMP, ['Creepy #1 1964 Warren Publishing Horror Magazine Frazetta', 58], ['Creepy #1 1964 Warren Frazetta GD/VG', 50]],
    });
    console.log(`  printingClass=${body.printingClass} price=${body.price}`);
    assertEq(body.printingClass, undefined, 'Control 5: SHIP-BLOCKING — "Collector\'s Edition" cover text alone does NOT classify FACSIMILE — editionWarning never fires, out.printingClass is not even set');
    assertTrue(!body.refusedToPrice, 'Control 5: not refused — priced normally as an ordinary original');
  }

  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) {
    console.log('FAILURES:');
    failures.forEach((f) => console.log(f));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
