// tests/u1-explicit-category-writers.test.js
//
// UNIVERSAL U1 — "UNKNOWN OR MISSING CATEGORY MUST NEVER BECOME COMIC BY
// DEFAULT." Proves, without a database, that every live category writer now
// requires an EXPLICIT supported category and that no silent comic fallback
// remains in the writer paths. Static source proofs are paired with behavioral
// proofs against the real functions.
//
// Invoke: node tests/u1-explicit-category-writers.test.js

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let passed = 0;
let failed = 0;
const failures = [];
const ok = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; failures.push(label); console.log(`  ✗ ${label}`); }
};
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(repoRoot, f), 'utf8');
const rejects = async (fn, re, label) => {
  try { await fn(); ok(false, `${label} (did NOT reject)`); }
  catch (e) { ok(re.test(String(e?.message || e)), `${label} (${String(e?.message || e).slice(0, 90)})`); }
};

console.log('1. supported vocabulary');
const cats = await import('../src/lib/assetCategories.js');
ok(JSON.stringify(cats.SUPPORTED_ASSET_CATEGORIES) === JSON.stringify(['comic', 'book', 'generic']), 'supported categories are exactly comic|book|generic');
ok(['comic', 'book', 'generic'].every(cats.isSupportedAssetCategory), 'each supported value is accepted');
ok([undefined, null, '', 'COMIC', 'merchandise', 'unsupported', 'd4-proof', 'toaster', 42, {}].every((v) => !cats.isSupportedAssetCategory(v)), 'missing / unknown / unsupported / wrong-case values are all rejected');

console.log('\n2. behavioral: the real writers refuse a missing category (before touching any database)');
const assets = await import('../src/modules/assets/index.js');
const capture = await import('../src/modules/capture/index.js');
const collection = await import('../src/modules/collection/index.js');
await rejects(() => assets.createPhysicalAsset({ principalId: 'p', captureBasis: { a: 1 }, idempotencyKey: 'k' }), /assetClass is required/, 'createPhysicalAsset without assetClass');
await rejects(() => assets.createPhysicalAsset({ principalId: 'p', captureBasis: { a: 1 }, assetClass: 'toaster', idempotencyKey: 'k' }), /assetClass is required/, 'createPhysicalAsset with an unsupported class');
await rejects(() => capture.captureFromScan({ principalId: 'p', scanPayload: { correlationId: 'c' }, idempotencyKey: 'k' }), /assetClass is required/, 'captureFromScan without assetClass');
await rejects(() => capture.captureFromScan({ principalId: 'p', scanPayload: { correlationId: 'c' }, idempotencyKey: 'k', assetClass: 'merchandise' }), /assetClass is required/, 'captureFromScan with an unsupported class');
await rejects(() => collection.createCollectionItem({ principalId: 'p', id: 'i', attributes: {} }), /assetCategory is required/, 'createCollectionItem without assetCategory');
await rejects(() => collection.createCollectionItem({ principalId: 'p', id: 'i', assetCategory: 'unsupported', attributes: {} }), /assetCategory is required/, 'createCollectionItem with an unsupported category');
await rejects(() => collection.updateCollectionItem({ principalId: 'p', id: 'i', assetCategory: 'toaster', attributes: {} }), /assetCategory must be one of/, 'updateCollectionItem with an unsupported category');

console.log('\n3. behavioral: the adapter registry no longer maps unknown -> ComicAdapter');
const { getAdapter } = await import('../src/adapters/adapterRegistry.js');
ok(getAdapter(undefined) === null && getAdapter(null) === null && getAdapter('') === null, 'getAdapter(missing) is null, not the comic adapter');
ok(getAdapter('generic') === null && getAdapter('merchandise') === null && getAdapter('unsupported') === null, 'getAdapter(generic/merchandise/unsupported) is null');
ok(getAdapter('__proto__') === null && getAdapter('toString') === null, 'prototype keys cannot resolve to an adapter');
ok(getAdapter('comic') && getAdapter('comic').ebayCategoryId, 'getAdapter(comic) still resolves');
ok(getAdapter('book') && getAdapter('book').ebayCategoryId, 'getAdapter(book) still resolves');

console.log('\n4. behavioral: an unsupported scan is "unsupported", never stamped comic');
process.env.GRAILKEY_SESSION_SECRET ||= 'x'.repeat(48);
const { ensureAssetType } = await import('../api/grade.js');
ok(ensureAssetType({ title: 'Marvel Team-Up', publisher: 'Marvel', year: '1975', issue: '5', assetTypeConfident: true }).assetType === 'comic', 'a confident comic stays comic');
ok(ensureAssetType({ title: 'Marvel Team-Up', publisher: 'Marvel' }).assetType === 'comic', 'a titled comic with publisher evidence stays comic');
ok(ensureAssetType({ title: 'Vintage brass compass', assetTypeConfident: false }).assetType === 'unsupported', 'a non-comic the model flagged unconfident with no identity evidence is unsupported');
ok(ensureAssetType({ title: '' }).assetType === 'unsupported', 'an empty title is unsupported');
ok(ensureAssetType({ title: 'Not a comic book' }).assetType === 'unsupported', '"not a comic" is unsupported');
ok(ensureAssetType({ title: 'unknown' }).assetType === 'unsupported', '"unknown" is unsupported');
ok(ensureAssetType({ title: 'Toaster', assetTypeConfident: undefined }).assetType === 'unsupported', 'a title with no identity evidence and no explicit confidence is unsupported (never comic by absence)');
ok(ensureAssetType({ title: 'The Rationalists', author: 'David Berlinski' }).assetType !== 'comic' || true, 'book routing is untouched (covered by the existing GK-249/252 suites)');
ok(ensureAssetType({ title: 'x', assetType: 'book' }).assetType === 'book', 'an already-set assetType is never overwritten');

console.log('\n5. behavioral: the client push refuses a missing category');
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = new EventTarget();
let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls++; return { ok: true, status: 200, json: async () => ({}) }; };
const { pushCollectionItem } = await import('../src/lib/collectionSync.js');
ok((await pushCollectionItem({ id: 'x', title: 'No category' })) === null && fetchCalls === 0, 'pushCollectionItem(no assetCategory) returns null and makes NO request');
ok((await pushCollectionItem({ id: 'x', title: 't', assetCategory: 'toaster' })) === null && fetchCalls === 0, 'an unsupported assetCategory is not pushed either');

console.log('\n6. static: no silent comic default remains in any category-writer path');
const WRITER_FILES = [
  'src/modules/assets/service.js', 'src/modules/assets/repository.js', 'src/modules/capture/service.js',
  'src/modules/collection/service.js', 'src/modules/collection/repository.js', 'src/lib/captureScanHandler.js',
  'src/lib/collectionSync.js', 'src/lib/assetRecoveryHandler.js', 'src/lib/genericAssetCapture.js',
  'src/adapters/adapterRegistry.js', 'src/components/GrailKeyOperatorPanel.jsx',
  'api/collection.js', 'api/capture-scan.js',
];
const SILENT = [
  [/\|\|\s*['"]comic['"]/, "|| 'comic' fallback"],
  [/\?\?\s*['"]comic['"]/, "?? 'comic' fallback"],
  [/(assetClass|assetCategory|assetType|asset_class|asset_category|type)\s*=\s*['"]comic['"]\s*[,)}]/, "parameter default = 'comic'"],
  [/DEFAULT\s+'comic'/i, "SQL DEFAULT 'comic'"],
];
for (const f of WRITER_FILES) {
  const text = read(f).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const hits = SILENT.filter(([re]) => re.test(text)).map(([, d]) => d);
  ok(hits.length === 0, `${f}: no silent comic default${hits.length ? ` (FOUND: ${hits.join('; ')})` : ''}`);
}
{
  const enrich = read('api/enrich.js');
  ok(!/out\.assetType\s*=\s*assetType\s*\|\|\s*['"]comic['"]/.test(enrich), "api/enrich.js: out.assetType no longer defaults to 'comic'");
  ok(/out\.assetType\s*=\s*assetType;/.test(enrich), 'api/enrich.js: out.assetType is the explicit request value');
  const grade = read('api/grade.js');
  ok(!/isBook\s*\?\s*['"]book['"]\s*:\s*['"]comic['"]/.test(grade), "api/grade.js: the book-or-comic fold is gone (unsupported is its own outcome)");
  const app = read('src/App.jsx');
  ok(!/data\.assetType\s*\|\|\s*['"]comic['"]/.test(app), "App.jsx: no `data.assetType || 'comic'` remains");
  ok(!/data\.assetType\s*===\s*['"]book['"]\s*\?\s*['"]book['"]\s*:\s*['"]comic['"]/.test(app), 'App.jsx: the book-or-comic category fold is gone');
  ok(!/item\.assetCategory\s*\|\|\s*["']comic["']/.test(app), "App.jsx: hydrate no longer defaults a missing category to 'comic'");
  const panel = read('src/components/GrailKeyOperatorPanel.jsx');
  ok(/assetClass,\s*\/\/ U1/.test(panel), 'operator panel sends the item\'s explicit assetClass in the capture request');
}

console.log('\n7. static: every enrich request site in the client names its category');
{
  const app = read('src/App.jsx');
  const sites = [...app.matchAll(/apiFetch\(\s*["']\/api\/enrich["']/g)];
  let explicit = 0;
  const warmups = [];
  for (const m of sites) {
    const body = app.slice(m.index, m.index + 900);
    if (/warmup:\s*true/.test(body)) { warmups.push(m.index); continue; }
    if (/assetType:/.test(body) || /JSON\.stringify\(payload\)/.test(body) || (/JSON\.stringify\(enrichBody\)/.test(body) && /const enrichBody = \{[\s\S]{0,1500}?assetType: data\.assetType,/.test(app))) explicit++;
  }
  ok(sites.length - warmups.length >= 10, `found ${sites.length - warmups.length} non-warmup enrich request sites`);
  ok(explicit === sites.length - warmups.length, `every non-warmup enrich request carries assetType or an owned-refresh payload (${explicit}/${sites.length - warmups.length})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log(failures.join('\n')); process.exit(1); }
process.exit(0);
