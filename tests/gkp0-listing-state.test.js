// tests/gkp0-listing-state.test.js
//
// GK-P0 LISTING RECONCILIATION (2026-10-26) -- Package A/C regression. DB-free, network-free.
// Proves the pure listing-state model (src/lib/listingState.js) and, via source assertions that FAIL
// (never skip) when the file cannot be read, that src/App.jsx actually uses it.
//
//   node tests/gkp0-listing-state.test.js

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  isItemListed, getItemEbayUrl, ebayItemUrl, normalizeListingStatus, applyProviderStatus,
  patchFromDurableListing, reconcileCatalogueWithDurableListings,
} from '../src/lib/listingState.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0, failed = 0;
const failures = [];
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; failures.push(l); console.log(`  ✗ ${l}`); } };
const read = (rel) => readFileSync(path.join(root, rel), 'utf8'); // throws -> the test process fails: a source test can never skip

const ID = '366762997648';
const URL = `https://www.ebay.com/itm/${ID}`;
const published = () => ({ id: 'cv_1', status: 'listed', ebayItemId: ID, ebayUrl: URL, listedAt: 1000, price: '$15.13', listPrice: '15.42' });
const durable = (state, extra = {}) => ({ collectionItemId: 'cv_1', gkAssetId: 'a', channel: 'ebay', externalListingId: ID, state, askAmount: 15.42, listedAt: 1000, ...extra });

console.log('\n=== GK-P0 listing state ===\n');

console.log('-- 14. publish -> sync active -> LISTED display (the reported regression) --');
{
  const patch = applyProviderStatus(published(), { status: 'active' });
  const after = { ...published(), ...patch };
  ok(patch.status === 'listed', 'provider "active" maps to GrailKey "listed", never stored as "active"');
  ok(patch.ebayProviderStatus === 'active', 'the raw provider status is recorded separately');
  ok(isItemListed(after) && getItemEbayUrl(after) === URL, 'card still shows Listed + the eBay URL after Sync');
  ok(after.ebayItemId === ID && after.ebayUrl === URL && after.listedAt === 1000, 'listing association (item id / url / listedAt) untouched');
  ok(after.listPrice === '15.42' && after.price === '$15.13', 'operator price fields untouched');
  ok(!('ebayItemId' in patch) && !('ebayUrl' in patch) && !('price' in patch) && !('listPrice' in patch), 'the sync patch can never carry association or price keys');
}

console.log('\n-- legacy repair: a device already corrupted by the old Sync (status "active") --');
{
  const corrupted = { ...published(), status: 'active' };
  ok(isItemListed(corrupted), 'isItemListed treats legacy "active"+ebayItemId as listed');
  ok(normalizeListingStatus(corrupted).status === 'listed', 'normalizeListingStatus rewrites it to "listed"');
  ok(!isItemListed({ id: 'x', status: 'active' }), 'a bare "active" with no eBay item id is NOT a listing');
  ok(normalizeListingStatus({ id: 'x', status: 'active' }).status === 'active', 'and is not rewritten');
}

console.log('\n-- 15. refresh / empty IndexedDB recovery from the durable ledger --');
{
  const empty = { id: 'cv_1', title: 'Old Man Logan', price: '$15.13', listPrice: '15.42' }; // no listing fields at all
  const patch = patchFromDurableListing(empty, durable('LISTED'));
  const after = { ...empty, ...patch };
  ok(isItemListed(after), 'an item with no local listing fields becomes listed from the durable LISTED row');
  ok(after.ebayItemId === ID && after.ebayUrl === URL, 'eBay item id restored and URL derived from it');
  ok(after.listedAt === 1000, 'listedAt restored from the durable row');
  ok(after.price === '$15.13' && after.listPrice === '15.42' && Object.keys(patch).every((k) => ['ebayItemId', 'ebayUrl', 'listedAt', 'status'].includes(k)), 'only listing keys are patched; price fields untouched');
  ok(patchFromDurableListing(after, durable('LISTED')) === null, 'idempotent: a second reconcile changes nothing');
  ok(ebayItemUrl('abc') === null && ebayItemUrl(null) === null, 'a malformed id never produces a URL');
}

console.log('\n-- 16. second device: authenticated login hydrates server attributes (no listing fields), ledger restores them --');
{
  const serverRow = { id: 'cv_1', title: 'Old Man Logan', price: '$15.13', _syncStatus: 'synced' }; // what /api/collection returns
  const { items, changed } = reconcileCatalogueWithDurableListings([serverRow, { id: 'cv_other', title: 'Other' }], [durable('LISTED')]);
  ok(changed.length === 1 && changed[0].id === 'cv_1', 'only the linked catalogue item is patched');
  ok(isItemListed(items[0]) && items[0].ebayItemId === ID, 'device B shows the listing');
  ok(items[1] === undefined ? false : items[1].id === 'cv_other' && !isItemListed(items[1]), 'an unrelated item is untouched and unlisted');
  const foreign = reconcileCatalogueWithDurableListings([{ id: 'cv_zzz' }], [durable('LISTED', { collectionItemId: 'cv_1' })]);
  ok(foreign.changed.length === 0, 'a durable summary for a catalogue id this device does not hold changes nothing');
  ok(reconcileCatalogueWithDurableListings([serverRow], null).changed.length === 0 && reconcileCatalogueWithDurableListings([serverRow], [{}]).changed.length === 0, 'malformed / empty listings payload is inert');
}

console.log('\n-- 17/18. ended, sold, unknown and failed provider responses; ended is NEVER sold --');
{
  const ended = applyProviderStatus(published(), { status: 'ended', endedAt: 5 });
  ok(ended.status === 'ended' && ended.endedAt === 5 && !('soldPrice' in ended) && !('soldAt' in ended), 'ended -> status "ended" with endedAt and NO sold fields');
  ok(!isItemListed({ ...published(), ...ended }) && ({ ...published(), ...ended }).ebayItemId === ID, 'ended is not listed, but the eBay item id is preserved');
  const sold = applyProviderStatus(published(), { status: 'sold', soldPrice: 15.42, soldAt: 9 });
  ok(sold.status === 'sold' && sold.soldPrice === 15.42, 'provider sold -> displayed as sold');
  for (const bad of [null, undefined, {}, { status: 'weird' }, { status: 42 }, { error: 'Failed to check eBay status' }, 'active']) {
    ok(applyProviderStatus(published(), bad) === null, `unknown/failed response ${JSON.stringify(bad)} -> null patch (changes nothing)`);
  }
  ok(isItemListed(published()), 'after a failed/unknown sync the item is STILL listed, so a provider error cannot re-enable publication');
  const delisted = patchFromDurableListing(published(), durable('DELISTED'));
  ok(delisted?.status === 'ended', 'durable DELISTED -> ended');
  ok(patchFromDurableListing(published(), durable('EXPIRED_UNSOLD'))?.status === 'ended', 'durable EXPIRED_UNSOLD -> ended, not sold');
  ok(!('soldPrice' in delisted) && !('soldAt' in delisted), 'ended/delisted patches never carry sale fields');
  ok(patchFromDurableListing(published(), durable('SOLD'))?.status === 'sold', 'only a durable SOLD outcome produces sold from the ledger');
}

console.log('\n-- ordering guards: the ledger never overrides a newer local observation --');
{
  ok(patchFromDurableListing({ ...published(), status: 'sold' }, durable('LISTED')) === null, 'local sold is not downgraded by an unreconciled LISTED row');
  ok(patchFromDurableListing({ ...published(), status: 'ended' }, durable('LISTED')) === null, 'a locally observed end is not re-opened by an unreconciled LISTED row');
  ok(patchFromDurableListing({ ...published(), status: 'sold' }, durable('DELISTED')) === null, 'local sold is not downgraded by DELISTED');
}

console.log('\n-- 5. badges, buttons, filters and counts all use one predicate --');
{
  const catalogue = [published(), { ...published(), id: 'b', status: 'active' }, { id: 'c', status: 'ended', ebayItemId: '1' }, { id: 'd' }, { id: 'e', status: 'sold' }];
  ok(catalogue.filter(isItemListed).map((c) => c.id).join() === 'cv_1,b', 'listed count = items that are actually listed (incl. legacy-corrupted)');
  ok(catalogue.filter((c) => !isItemListed(c)).length === 3, 'unlisted = the rest');
}

console.log('\n-- source assertions (fail, never skip) --');
{
  const app = read('src/App.jsx');
  ok(!/\.status\s*===\s*["']listed["']/.test(app) && !/\.status\s*!==\s*["']listed["']/.test(app), 'App.jsx has no remaining raw status === / !== "listed" test');
  ok(/isItemListed\(item\)\s*&&\s*!!getItemEbayUrl\(item\)/.test(app), 'the card\'s Listed state uses isItemListed + derived URL');
  ok(/const statusFields = applyProviderStatus\(item, data\);/.test(app) && !/const statusFields = \{ status: data\.status \}/.test(app), 'syncEbayStatus uses applyProviderStatus and no longer writes the raw provider word into status');
  ok(/if \(!statusFields\) return data;/.test(app), 'an unrecognised provider response returns without touching state');
  ok(/\.\.\.normalizeListingStatus\(item\)/.test(app), 'normalizeItem repairs legacy "active" rows');
  ok(/keepListing/.test(app) && /\.\.\.keepListing,/.test(app), 'login hydrate preserves this device\'s listing fields instead of erasing them');
  ok(/authFetch\('\/api\/assets\?listings=1'\)/.test(app) && /reconcileCatalogueWithDurableListings\(items, body\.listings\)/.test(app), 'login hydrate reconciles with the durable outcome ledger');
  const api = read('api/assets.js');
  ok(/listings === '1'/.test(api) && /listMyListingStates\(\{ principalId \}\)/.test(api), 'GET /api/assets?listings=1 is wired and principal-scoped (principal from the verified token only)');
  const repo = read('src/modules/assets/repository.js');
  ok(/JOIN data1_dev\.current_owner co ON co\.asset_id = oe\.gk_asset_id AND co\.owner_principal_id = \$1/.test(repo), 'the durable read enforces ownership in the join itself');
  const list = read('api/list-ebay.js');
  ok(/DUPLICATE_ACTIVE_LISTING|assertListingAuthorized/.test(list), 'api/list-ebay.js still runs the duplicate preflight');
  ok(!/listings === '1'|listMyListingStates/.test(list), 'api/list-ebay.js (publication) is not modified by the reconcile read');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) { console.log('Failures:'); failures.forEach((f) => console.log(`  ✗ ${f}`)); process.exit(1); }
process.exit(0);
