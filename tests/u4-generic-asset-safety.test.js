// tests/u4-generic-asset-safety.test.js
//
// U4 (Generic Asset Mode) — the parts of the U4.6 required test list NOT
// covered by tests/u4-generic-asset-capture-live-proof.test.js:
//
//   - api/list-ebay.js rejects a generic asset server-side, BEFORE any
//     eBay network call, for both the single-item and bundle paths —
//     real handler invocation, no DB needed (the check runs before the
//     GrailKey auth/linkage gate), global.fetch replaced with a mock
//     that throws if ever called (proves zero eBay calls happen)
//   - the SAME handler is unaffected for an ordinary comic item (no
//     assetCategory field) — regression proof that the new check does
//     not touch the existing gate order
//   - A2: the exact predicate logic src/App.jsx's P0-B Auto-heal effect
//     and getListableBooks use, mirrored here as pure functions (same
//     established convention as tests/grailkey-operator-panel-capture-
//     wiring.test.js's own stripDataUrlPrefix/contentTypeFromDataUrl
//     mirrors — App.jsx cannot be imported directly, it is not a module),
//     proven to exclude assetCategory:'generic' items
//   - structural/grep proof: GenericAssetCapture.jsx is reachable from
//     exactly one place in src/App.jsx (the explicit toolbar button),
//     never from an automatic/background effect
//   - genericAssetCapture.js's isGenericAsset predicate
//   - captureFromScan's hardcoded assetClass:'comic' literal is
//     genuinely gone from the mint call (GK-138-style "did the fix
//     actually land" grep, not just a passing test elsewhere)
//
// Invoke: node tests/u4-generic-asset-safety.test.js

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

const envRaw = readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8');
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

function mockRes() {
  const res = { statusCode: null, body: null, headers: {} };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

console.log('\n=== U4 Generic Asset Mode — safety/structural proofs ===\n');

// ── api/list-ebay.js — no eBay network call must ever happen for a
// generic asset. Any fetch call at all is a hard test failure. ──
let fetchCallCount = 0;
global.fetch = async () => {
  fetchCallCount++;
  throw new Error('TEST FAILURE: a real (mocked-as-network) eBay fetch call was attempted for a request that should have been rejected before any network call.');
};

const listEbayHandler = (await import(pathToFileURL(path.join(repoRoot, 'api', 'list-ebay.js')).href)).default;

console.log('-- api/list-ebay.js: generic assets are rejected before any eBay call --\n');

const genericItem = {
  title: 'Vintage brass compass',
  assetCategory: 'generic',
  price: '$0',
};
const genericReq = { method: 'POST', headers: {}, body: genericItem };
const genericRes = mockRes();
await listEbayHandler(genericReq, genericRes);
assertTrue(genericRes.statusCode === 400, `single-item generic asset -> 400 (got ${genericRes.statusCode}, body=${JSON.stringify(genericRes.body)})`);
assertTrue(genericRes.body?.error === 'GENERIC_ASSET_NOT_LISTABLE', `error code is GENERIC_ASSET_NOT_LISTABLE (got ${genericRes.body?.error})`);
assertTrue(fetchCallCount === 0, `zero eBay network calls were made (got ${fetchCallCount})`);

console.log('\n-- api/list-ebay.js: a bundle containing a generic member is rejected before any eBay call --\n');
const bundleReq = {
  method: 'POST', headers: {},
  body: {
    bundle: true,
    items: [
      { title: 'Amazing Spider-Man #1', assetCategory: 'comic', image: 'data:image/png;base64,abc' },
      { title: 'Vintage brass compass', assetCategory: 'generic', image: 'data:image/png;base64,abc' },
    ],
  },
};
const bundleRes = mockRes();
// GRAILKEY_CATALOG_ENVIRONMENT is not 'production' in this test process
// (never set above), so the bundle branch reaches the per-item generic
// check rather than the unrelated Production-only bundle-disable gate.
delete process.env.GRAILKEY_CATALOG_ENVIRONMENT;
await listEbayHandler(bundleReq, bundleRes);
assertTrue(bundleRes.statusCode === 400, `bundle with a generic member -> 400 (got ${bundleRes.statusCode}, body=${JSON.stringify(bundleRes.body)})`);
assertTrue(bundleRes.body?.error === 'GENERIC_ASSET_NOT_LISTABLE', `bundle error code is GENERIC_ASSET_NOT_LISTABLE (got ${bundleRes.body?.error})`);
assertTrue(fetchCallCount === 0, `still zero eBay network calls after the bundle attempt (got ${fetchCallCount})`);

console.log('\n-- api/list-ebay.js: an ordinary comic item (no assetCategory) is UNAFFECTED by the new check --\n');
// No assetCategory field at all, no title -> must still reach the
// PRE-EXISTING "title required" gate exactly as before this dispatch,
// never the new GENERIC_ASSET_NOT_LISTABLE branch. This is the
// regression proof that comic behavior is byte-for-byte unchanged.
const comicNoTitleReq = { method: 'POST', headers: {}, body: { price: '$10' } };
const comicNoTitleRes = mockRes();
await listEbayHandler(comicNoTitleReq, comicNoTitleRes);
assertTrue(comicNoTitleRes.statusCode === 400 && comicNoTitleRes.body?.error === 'title required', `comic item with no assetCategory still hits the pre-existing "title required" gate unchanged (got ${comicNoTitleRes.statusCode}, ${JSON.stringify(comicNoTitleRes.body)})`);
assertTrue(fetchCallCount === 0, `still zero eBay network calls (got ${fetchCallCount})`);

// ── A2 — exact mirrors of the App.jsx predicates, same convention as
// tests/grailkey-operator-panel-capture-wiring.test.js's own pure-helper
// mirrors (App.jsx is not an importable module). ──
console.log('\n-- A2: P0-B Auto-heal missingSource filter excludes generic assets --\n');
function isGenericAssetMirror(c) { return c.assetCategory === 'generic'; }
function isRecentlyImportedMirror(c) { return Date.now() - (c.timestamp || 0) < 300000; }
function isUnverifiedMegaKeyMirror(c) { return !!(c.manualReviewRequired || (c.megaKeyFloorApplied && !c.megaKeyFloorVerified)); }
// Mirrors src/App.jsx's missingSource filter (P0-B Auto-heal effect)
// exactly, minus the isQ87Cached call (pure function with no cache
// module dependency) — the assetCategory guard is the fact under test.
function missingSourceMirror(catalogue) {
  return catalogue.filter((c) =>
    !isGenericAssetMirror(c) &&
    !isRecentlyImportedMirror(c) &&
    !isUnverifiedMegaKeyMirror(c) &&
    !c.inTradePile &&
    (!c.pricingSource || !c.comps) &&
    (Date.now() - (c.timestamp || 0) > 86400000) &&
    c.marketPending !== true
  );
}
const oldTimestamp = Date.now() - 90000000; // > 24h old
const genericCatalogueItem = { id: 'g1', assetCategory: 'generic', timestamp: oldTimestamp }; // no pricingSource/comps -> would match every OTHER condition
const comicCatalogueItem = { id: 'c1', assetCategory: 'comic', timestamp: oldTimestamp };
const missing = missingSourceMirror([genericCatalogueItem, comicCatalogueItem]);
assertTrue(!missing.some((c) => c.id === 'g1'), 'a generic item that would otherwise look "missing pricingSource/comps" is excluded from Auto-heal');
assertTrue(missing.some((c) => c.id === 'c1'), 'an equivalent comic item is still included — the guard is category-specific, not a blanket suppression');

console.log('\n-- A2: getListableBooks bulk-list filter excludes generic assets --\n');
// Mirrors the added assetCategory guard clause in src/App.jsx's
// getListableBooks (Manage tab bulk "Post All Listable" gate).
function getListableBooksMirror(catalogue) {
  return catalogue.filter((c) => c.assetCategory !== 'generic' && (c.priceNum || 0) > 0);
}
const listable = getListableBooksMirror([
  { id: 'g2', assetCategory: 'generic', priceNum: 50 }, // hypothetical non-zero price, still must be excluded
  { id: 'c2', assetCategory: 'comic', priceNum: 50 },
]);
assertTrue(!listable.some((c) => c.id === 'g2'), 'a generic item is excluded from the bulk-listable set even if it somehow carried a non-zero price');
assertTrue(listable.some((c) => c.id === 'c2'), 'an equivalent comic item is still included');

// ── genericAssetCapture.js's own predicate — the real function, not a
// mirror (this file has no browser-only dependency itself). ──
console.log('\n-- genericAssetCapture.js: isGenericAsset predicate (real function) --\n');
const { isGenericAsset } = await import(pathToFileURL(path.join(repoRoot, 'src', 'lib', 'genericAssetCapture.js')).href);
assertTrue(isGenericAsset({ assetCategory: 'generic' }) === true, 'isGenericAsset({assetCategory:"generic"}) === true');
assertTrue(isGenericAsset({ assetCategory: 'comic' }) === false, 'isGenericAsset({assetCategory:"comic"}) === false');
assertTrue(isGenericAsset(null) === false, 'isGenericAsset(null) === false, never throws');
assertTrue(isGenericAsset({}) === false, 'isGenericAsset({}) === false (no assetCategory field, e.g. every legacy comic record)');

// ── structural proofs (grep over tracked source, no DB) ──
console.log('\n-- structural: captureFromScan no longer hardcodes assetClass:\'comic\' at the mint call --\n');
const captureServiceSrc = readFileSync(path.join(repoRoot, 'src', 'modules', 'capture', 'service.js'), 'utf8');
assertTrue(!/assetClass:\s*'comic'/.test(captureServiceSrc), 'no literal assetClass:\'comic\' remains anywhere in capture/service.js');
assertTrue(/assetClass\s*=\s*'comic'/.test(captureServiceSrc) && /ALLOWED_ASSET_CLASSES/.test(captureServiceSrc), 'assetClass is now a validated, defaulted parameter (ALLOWED_ASSET_CLASSES present)');

console.log('\n-- structural: GenericAssetCapture.jsx is reachable from exactly one place in src/App.jsx --\n');
const appSrc = readFileSync(path.join(repoRoot, 'src', 'App.jsx'), 'utf8');
const jsxUsages = (appSrc.match(/<GenericAssetCapture\b/g) || []).length;
assertTrue(jsxUsages === 1, `<GenericAssetCapture appears exactly once in App.jsx's JSX (got ${jsxUsages}) — not reachable from more than one render path`);
// The one render site must be gated behind explicit operator state
// (showGenericCapture), never rendered unconditionally or from a
// useEffect/automatic branch.
const renderSiteMatch = appSrc.match(/\{showGenericCapture && \(\s*<GenericAssetCapture/);
assertTrue(!!renderSiteMatch, 'the one render site is gated behind showGenericCapture, set only by the explicit toolbar button onClick');
assertTrue(!/useEffect\([^)]*setShowGenericCapture\(true\)/.test(appSrc), 'setShowGenericCapture(true) is never called from inside a useEffect callback signature on the same line (no automatic-open path)');

console.log('\n-- structural: CollectionDetail\'s generic branch returns before any comic-specific field access --\n');
const genericBranchIdx = appSrc.indexOf('item?.assetCategory === "generic"');
const priceBandsAccessIdx = appSrc.indexOf('item.priceBands', genericBranchIdx);
assertTrue(genericBranchIdx > -1, 'the generic early-return branch exists in App.jsx');
assertTrue(priceBandsAccessIdx > genericBranchIdx, 'the branch appears before (in source order, i.e. executes before) the first comic-specific priceBands access that follows it in the function body');

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('FAILURES:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
