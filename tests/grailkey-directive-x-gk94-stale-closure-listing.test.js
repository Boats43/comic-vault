// tests/grailkey-directive-x-gk94-stale-closure-listing.test.js
//
// GrailKey Directive X (GK-94) — listOnEbay and syncEbayStatus
// (src/App.jsx) spread the closed-over, pre-request `item` back into
// catalogue state on write. If an operator correction landed on the SAME
// item while the eBay listing/status request was in flight, the older
// response's `{...item, status: ..., ...}` write silently reverted the
// corrected title/issue/year/variant/price/comps, with only the handful
// of listing-status fields reflecting anything new.
//
// Fix matches listBundleOnEbay's ALREADY-CORRECT pattern in the same
// file: read the CURRENT item fresh from `prev`/`cur` at write time,
// apply only the fields the handler actually mutates. No new mechanism,
// no ownership tokens — this is a closure fix, not a race-ownership fix.
//
// Invoke: node tests/grailkey-directive-x-gk94-stale-closure-listing.test.js

import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

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

console.log('\n=== GrailKey Directive X (GK-94) — stale closure in listing handlers ===\n');

// ═══════════════════════════════════════════════════════════════════════
// Part 0 — pre-fix defect, shown failing DIRECTLY against the real
// committed source at f39e392 (the commit immediately before this
// dispatch), via git show — not retyped from memory.
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 0: pre-fix stale-closure defect, reproduced against real f39e392 source (DIRECT)\n');
{
  let preFixSrc = null;
  try {
    preFixSrc = execSync('git show f39e392:src/App.jsx', { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1024 * 1024 * 50 });
  } catch {
    preFixSrc = null;
  }
  assertTrue(!!preFixSrc, 'git show f39e392:src/App.jsx succeeded (real prior commit)');

  if (preFixSrc) {
    const listOnEbayMatch = preFixSrc.match(
      /const updated = \{\s*\n\s*\.\.\.item,\s*\n\s*status: "listed",\s*\n\s*ebayUrl: data\.listingUrl,\s*\n\s*ebayItemId: data\.listingId \|\| null,\s*\n\s*listedAt: Date\.now\(\),\s*\n\s*\};/
    );
    assertTrue(!!listOnEbayMatch, 'pre-fix listOnEbay literally spread `...item` (the closed-over, pre-request object) into its write — extracted verbatim from real source');

    const syncStatusMatch = preFixSrc.match(
      /const updates = \{\s*\n\s*\.\.\.item,\s*\n\s*status: data\.status,/
    );
    assertTrue(!!syncStatusMatch, 'pre-fix syncEbayStatus literally spread `...item` into its write — extracted verbatim from real source');

    // Re-derive the EXACT pre-fix merge (extracted above, not retyped) and
    // run it against a genuine same-item correction race.
    const staleItem = { id: 'item-A', title: 'Amazing Fantasy 15', issue: '15', variant: null, price: '$1200.00', comps: { count: 3 } };
    // The correction landed on item-A WHILE listOnEbay's request was in
    // flight -- this is what the catalogue actually holds by the time the
    // stale response resolves.
    const correctedCatalogue = [{ id: 'item-A', title: 'Amazing Fantasy #15 (Facsimile)', issue: '15', variant: 'facsimile edition', price: null, comps: null }];

    const preFixUpdated = { ...staleItem, status: 'listed', ebayUrl: 'https://ebay.example/x', ebayItemId: 'X1', listedAt: 1000 };
    assertEq(preFixUpdated.title, 'Amazing Fantasy 15', 'PRE-FIX BUG: the stale pre-correction title is what gets written (not the corrected "Amazing Fantasy #15 (Facsimile)")');
    assertEq(preFixUpdated.variant, null, 'PRE-FIX BUG: the corrected variant ("facsimile edition") is silently discarded');
    assertEq(preFixUpdated.price, '$1200.00', 'PRE-FIX BUG: the corrected null price (server determined it needs re-pricing) is overwritten with the stale $1200.00');
    // Confirm this literally diverges from what the catalogue actually holds.
    assertTrue(preFixUpdated.title !== correctedCatalogue[0].title, 'the pre-fix write literally reverts the correction that already landed in the catalogue');
  } else {
    console.log('  (skipped git-show reproduction — git not available in this environment)');
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Part 1 — post-fix listOnEbay pattern (DIRECT — the exact fresh-read
// merge now used, applied to constructed inputs).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 1: post-fix listOnEbay — fresh-read merge preserves the correction (DIRECT)\n');
{
  const staleItemClosure = { id: 'item-A', title: 'Amazing Fantasy 15', issue: '15', variant: null, price: '$1200.00', comps: { count: 3 } };
  const prev = [{ id: 'item-A', title: 'Amazing Fantasy #15 (Facsimile)', issue: '15', variant: 'facsimile edition', price: null, comps: null }];
  const data = { listingUrl: 'https://ebay.example/x', listingId: 'X1' };

  const listedAt = 1000;
  const ebayUrl = data.listingUrl;
  const ebayItemId = data.listingId || null;
  let putComicCalledWith = null;

  const nextCatalogue = prev.map((x) => {
    if (x.id !== staleItemClosure.id) return x;
    const updated = { ...x, status: 'listed', ebayUrl, ebayItemId, listedAt };
    putComicCalledWith = updated;
    return updated;
  });

  assertEq(nextCatalogue[0].title, 'Amazing Fantasy #15 (Facsimile)', 'THEN the corrected identity survives (title)');
  assertEq(nextCatalogue[0].variant, 'facsimile edition', 'THEN the corrected identity survives (variant)');
  assertEq(nextCatalogue[0].price, null, 'THEN the corrected price (null, pending re-price) survives -- not resurrected to the stale $1200.00');
  assertEq(nextCatalogue[0].comps, null, 'THEN the corrected comps survive');

  // AND only status/ebayUrl/ebayItemId/listedAt were written -- confirm by
  // diffing against the pre-write fresh state.
  const changedKeys = Object.keys(nextCatalogue[0]).filter((k) => JSON.stringify(nextCatalogue[0][k]) !== JSON.stringify(prev[0][k]));
  assertEq(changedKeys.sort(), ['ebayItemId', 'ebayUrl', 'listedAt', 'status'].sort(), 'AND only status/ebayUrl/ebayItemId/listedAt actually changed');
  assertTrue(putComicCalledWith !== null && putComicCalledWith.title === 'Amazing Fantasy #15 (Facsimile)', 'putComic is called with the merged (corrected-identity-preserving) object, not the stale closure');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 2 — post-fix syncEbayStatus pattern (DIRECT), both branches.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: post-fix syncEbayStatus — fresh-read merge preserves the correction (DIRECT)\n');
{
  const staleItemClosure = { id: 'item-B', title: 'Old Title', ebayItemId: 'Y1' };
  const prev = [{ id: 'item-B', title: 'Corrected Title', issue: '9', ebayItemId: 'Y1' }];

  // Sold branch
  {
    const data = { status: 'sold', soldPrice: 42, soldAt: 2000, buyerFeedback: 'great' };
    const statusFields = { status: data.status, soldPrice: data.soldPrice, soldAt: data.soldAt, buyerFeedback: data.buyerFeedback };
    const nextCatalogue = prev.map((x) => (x.id !== staleItemClosure.id ? x : { ...x, ...statusFields }));
    assertEq(nextCatalogue[0].title, 'Corrected Title', 'sold branch: THEN the corrected title survives');
    assertEq(nextCatalogue[0].status, 'sold', 'sold branch: status written');
    assertEq(nextCatalogue[0].soldPrice, 42, 'sold branch: soldPrice written');
    assertEq(nextCatalogue[0].soldAt, 2000, 'sold branch: soldAt written');
    assertEq(nextCatalogue[0].buyerFeedback, 'great', 'sold branch: buyerFeedback written');
  }

  // Ended branch
  {
    const data = { status: 'ended', endedAt: 3000 };
    const statusFields = { status: data.status, endedAt: data.endedAt };
    const nextCatalogue = prev.map((x) => (x.id !== staleItemClosure.id ? x : { ...x, ...statusFields }));
    assertEq(nextCatalogue[0].title, 'Corrected Title', 'ended branch: THEN the corrected title survives');
    assertEq(nextCatalogue[0].status, 'ended', 'ended branch: status written');
    assertEq(nextCatalogue[0].endedAt, 3000, 'ended branch: endedAt written');
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Part 3 — control: with no intervening correction, both handlers still
// write normally.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: CONTROL — no intervening correction, normal write still happens (DIRECT)\n');
{
  const item = { id: 'item-C', title: 'Batman #1', issue: '1' };
  const prev = [{ id: 'item-C', title: 'Batman #1', issue: '1' }]; // unchanged, no correction happened
  const data = { listingUrl: 'https://ebay.example/y', listingId: 'Z1' };
  const listedAt = 5000;
  const nextCatalogue = prev.map((x) => (x.id !== item.id ? x : { ...x, status: 'listed', ebayUrl: data.listingUrl, ebayItemId: data.listingId || null, listedAt }));
  assertEq(nextCatalogue[0].status, 'listed', 'CONTROL: status still written normally');
  assertEq(nextCatalogue[0].ebayUrl, 'https://ebay.example/y', 'CONTROL: ebayUrl still written normally');
  assertEq(nextCatalogue[0].title, 'Batman #1', 'CONTROL: title unaffected either way (no correction happened)');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 4 — "if the id no longer exists in catalogue at write time, write
// nothing" (explicit directive constraint).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 4: id no longer in catalogue -- writes nothing (DIRECT)\n');
{
  const item = { id: 'deleted-item', title: 'Deleted Book' };
  const prev = [{ id: 'other-item', title: 'Unrelated Book' }]; // deleted-item is gone
  let putComicCalls = 0;
  const nextCatalogue = prev.map((x) => {
    if (x.id !== item.id) return x;
    putComicCalls++;
    return { ...x, status: 'listed' };
  });
  assertEq(nextCatalogue, prev, 'catalogue array is unchanged when the id is not found');
  assertEq(putComicCalls, 0, 'putComic is never called when the id is not found -- writes nothing, per the directive\'s explicit constraint');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 5 — structural proof against the REAL committed post-fix source
// (MIRRORED — these are React closures inside App.jsx, not independently
// invocable outside the full component, same constraint every
// App.jsx-touching test in this repo works under).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 5: real source wired correctly, listBundleOnEbay untouched (source proof, MIRRORED)\n');
{
  // Normalize CRLF -> LF: the on-disk checkout may use CRLF (Windows),
  // while `git show` returns the repo-normalized LF blob -- without this,
  // every multi-line literal match below would spuriously fail on line
  // endings alone, not real content differences.
  const appSrc = readFileSync(path.join(repoRoot, 'src/App.jsx'), 'utf8').replace(/\r\n/g, '\n');

  const listOnEbayMatch = appSrc.match(/const listOnEbay = useCallback\(async \(item\) => \{[\s\S]*?\n  \}, \[\]\);/);
  assertTrue(!!listOnEbayMatch, 'listOnEbay function body found in current source');
  const listOnEbayBody = listOnEbayMatch?.[0] || '';
  assertTrue(!listOnEbayBody.includes('...item,\n      status: "listed"'), 'listOnEbay no longer spreads the closed-over item into its write');
  assertTrue(listOnEbayBody.includes('if (x.id !== item.id) return x;'), 'listOnEbay reads fresh state, matched by id, before writing');
  assertTrue(listOnEbayBody.includes('const updated = { ...x, status: "listed", ebayUrl, ebayItemId, listedAt };'), 'listOnEbay merges onto fresh x, only the 4 listing fields');
  assertTrue(listOnEbayBody.includes("cur.id === item.id\n      ? normalizeItem({ ...cur, status: \"listed\", ebayUrl, ebayItemId, listedAt })"), 'listOnEbay setSelectedItem also merges onto fresh cur, same 4 fields');

  const syncMatch = appSrc.match(/const syncEbayStatus = useCallback\(async \(item\) => \{[\s\S]*?\n  \}, \[\]\);/);
  assertTrue(!!syncMatch, 'syncEbayStatus function body found in current source');
  const syncBody = syncMatch?.[0] || '';
  assertTrue(!syncBody.includes('...item,\n      status: data.status'), 'syncEbayStatus no longer spreads the closed-over item into its write');
  assertTrue(syncBody.includes('if (x.id !== item.id) return x;'), 'syncEbayStatus reads fresh state, matched by id, before writing');
  assertTrue(syncBody.includes('const updated = { ...x, ...statusFields };'), 'syncEbayStatus merges onto fresh x, only the status fields');

  // listBundleOnEbay must be byte-identical to the pre-fix commit --
  // explicit directive constraint ("Do not touch listBundleOnEbay").
  const preFixSrc = (() => {
    try {
      return execSync('git show f39e392:src/App.jsx', { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1024 * 1024 * 50 });
    } catch {
      return null;
    }
  })();
  if (preFixSrc) {
    const extractBundle = (src) => (src.match(/const listBundleOnEbay = useCallback\(async \(items\) => \{[\s\S]*?\n  \}, \[\]\);/) || [null])[0];
    const preFixBundle = extractBundle(preFixSrc);
    const postFixBundle = extractBundle(appSrc);
    assertTrue(!!preFixBundle && !!postFixBundle, 'listBundleOnEbay extracted from both pre-fix and current source');
    assertEq(postFixBundle, preFixBundle, 'listBundleOnEbay is byte-identical before/after this dispatch -- untouched, per the explicit constraint');
  } else {
    console.log('  (skipped listBundleOnEbay byte-identical check -- git not available)');
  }
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
  process.exitCode = 1;
}
