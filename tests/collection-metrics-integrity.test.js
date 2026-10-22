// A8 — collection accounting invariants (docs/COLLECTION-INTEGRITY-AUDIT-2026-10-22.md, R1/R2/R5/R6).
//
// Runs the REAL readiness / metrics / channel functions (src/lib/collectionMetrics.js, moved verbatim
// from src/App.jsx) over fixtures shaped like the audited Production records. Only getComicPhotos is
// stubbed, because the real one mints session-bound signed image links; the stub reproduces the same
// photo-COUNT semantics (images[] > image > remoteImages.length).
//
// What this proves, and what it deliberately does not:
//   - every record is in exactly one status bucket and exactly one routing bucket; counts and values reconcile
//   - an un-enriched record (no channel) is counted as `unrouted`, never dropped
//   - null item.price + contract-derived price is valued identically by status and routing
//   - a listable:false record is never counted as listable value (its STATUS is unchanged - no item moves)
//   - a LIST recommendation is not photo readiness and not publishing authority
//   - the router (getAuthoritativeChannel) and source grades/pricing evidence are untouched
// It does NOT assert that the router should treat DO_NOT_LIST as blocked: that is a documented, deliberately
// unchanged follow-up (audit section 10).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createCollectionMetrics, COLLECTION_VALUE_DEFINITIONS } from '../src/lib/collectionMetrics.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;
const ok = (cond, name) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name); } };
const eq = (a, b, name) => ok(a === b, name + (a === b ? '' : ` (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`));
const near = (a, b, name) => ok(Math.abs(a - b) < 0.005, name + (Math.abs(a - b) < 0.005 ? '' : ` (got ${a}, want ${b})`));

const getComicPhotos = (c) => {
  if (!c) return [];
  if (Array.isArray(c.images) && c.images.length > 0) return c.images.filter(Boolean);
  if (c.image) return [c.image];
  if (Array.isArray(c.remoteImages) && c.remoteImages.length > 0 && c.id) return c.remoteImages.map((_, i) => `signed:${c.id}:${i}`);
  return [];
};
const M = createCollectionMetrics({ getComicPhotos });
const { getReadinessStatus, getCollectionMetrics, getChannelMetrics, getAuthoritativeChannel, reconcileCollectionMetrics } = M;

// ── fixtures (shapes taken from audited Production rows; titles generic) ──
const aa = (state) => ({ state, reasonCodes: [], marketStanding: 'EXACT_CURRENT', identityStanding: 'CONFIRMED' });
const listRow = (id, price, photos = 1) => ({ id, title: 'List Candidate ' + id, issue: '1', remoteImages: Array(photos).fill('x'), price: `$${price}`,
  decision: { action: 'LIST_NOW', blockers: [], bestChannel: 'cash_sale' },
  contract: { state: 'PRICED', price, listable: true, bestChannel: 'cash_sale', actionAuthority: aa('READY') } });
const READY_4PHOTO = listRow('ready4', 80, 4);
const LIST_1PHOTO = listRow('list1', 50, 1);
const UNENRICHED = { id: 'classic13', title: 'classic comics', issue: '13', year: '', publisher: '', grade: 'GD 2.0', price: null, marketPending: true, remoteImages: ['x'] }; // no contract, no decision
const ASM148_SHAPE = { id: 'asm148', title: 'asm', issue: '148', price: null, remoteImages: ['x'],
  decision: { action: 'RESEARCH', blockers: [], bestChannel: 'research' },
  contract: { state: 'PRICED', price: 25.1, listable: true, bestChannel: 'research', actionAuthority: aa('REVIEW') } };
const BLOCKED_ARCHIE = { id: 'archie', title: 'archie', issue: '271', price: null, remoteImages: ['x'],
  decision: { action: 'DO_NOT_LIST', blockers: ['no-data-sources'], bestChannel: 'research' },
  contract: { state: 'REFUSED', price: null, listable: false, bestChannel: 'blocked', actionAuthority: { state: 'LOCKED', reasonCodes: [], identityStanding: 'CONFIRMED' } } };
const ID_REQUIRED = { id: 'idreq', title: 'supergirl', issue: '685', price: null, remoteImages: ['x'],
  decision: { action: 'ID_REQUIRED', blockers: ['identity-not-confident'], bestChannel: 'blocked' },
  contract: { state: 'ID_REQUIRED', price: null, listable: false, bestChannel: 'blocked', actionAuthority: { state: 'LOCKED', reasonCodes: [], identityStanding: 'UNRESOLVED' } } };
const NONLISTABLE_READYAUTH = { id: 'nonlist', title: 'spectre', issue: '1', remoteImages: ['x'], price: '$27.27',
  decision: { action: 'RESEARCH', blockers: [], bestChannel: 'research' },
  contract: { state: 'INCOMPLETE', price: 27.27, listable: false, bestChannel: 'research', actionAuthority: aa('READY') } };
const THROWER = { id: 'thrower', title: 'x', remoteImages: ['x'], get decision() { throw new Error('malformed'); } };
const NONFINITE = { id: 'nanprice', title: 'nan', issue: '2', remoteImages: ['x'], listPrice: 'abc', price: 'abc',
  decision: { action: 'RESEARCH', blockers: [], bestChannel: 'research' }, contract: { state: 'PRICED', price: NaN, listable: true, bestChannel: 'research', actionAuthority: aa('REVIEW') } };

const CATALOGUE = [READY_4PHOTO, LIST_1PHOTO, UNENRICHED, ASM148_SHAPE, BLOCKED_ARCHIE, ID_REQUIRED, NONLISTABLE_READYAUTH, NONFINITE];

console.log('\n=== A8 collection accounting invariants ===\n');

console.log('Invariant: exactly one status + exactly one routing; sums reconcile');
{
  const r = reconcileCollectionMetrics(CATALOGUE);
  eq(r.total, CATALOGUE.length, 'total = catalogue length');
  eq(r.statusCount, r.total, 'sum(status) == total');
  eq(r.routingCount, r.total, 'sum(routing) == total');
  ok(r.balanced, 'status value == routing value == total value (balanced)');
  const withBad = [...CATALOGUE, null, THROWER];
  const r2 = reconcileCollectionMetrics(withBad);
  eq(r2.statusCount, withBad.length, 'a null entry and a throwing record are still counted (unclassified), not dropped');
  eq(r2.routingCount, withBad.length, 'a null entry and a throwing record are still routed-or-unrouted, not dropped');
  const m = getCollectionMetrics(withBad);
  eq(m.unclassified.count, 2, 'unclassified = {null, throwing record}');
}

console.log('\nR1: missing-channel record is accounted for');
{
  eq(getAuthoritativeChannel(UNENRICHED), null, 'un-enriched partial has no channel (premise)');
  const c = getChannelMetrics(CATALOGUE);
  eq(c.unrouted.count, 1, 'it is counted as unrouted');
  eq(c.unrouted.count + c.cash_sale.count + c.bundle.count + c.grade.count + c.barter.count + c.research.count + c.blocked.count, CATALOGUE.length, 'routing buckets sum to the catalogue length');
  eq(getReadinessStatus(UNENRICHED).badge, 'NEEDS REVIEW', 'its STATUS is unchanged (status never dropped it; only routing did)');
}

console.log('\nR2: null item.price + contract.price valued identically in both views');
{
  const solo = [ASM148_SHAPE];
  const s = getCollectionMetrics(solo), c = getChannelMetrics(solo);
  near(s.totalValue, 25.1, 'status view values it at the contract price');
  near(c.research.value, 25.1, 'routing view values it at the contract price (was dropped when item.price was null)');
  ok(reconcileCollectionMetrics(solo).balanced, 'balanced');
  const nf = reconcileCollectionMetrics([NONFINITE]);
  ok(nf.balanced && nf.statusCount === 1 && nf.routingCount === 1, 'a non-finite price is counted at $0 in both views, not skipped from both');
}

console.log('\nR5: non-listable records are distinguished, never counted as listable value; no status moves');
{
  const s = getCollectionMetrics([NONLISTABLE_READYAUTH]);
  eq(getReadinessStatus(NONLISTABLE_READYAUTH).badge, 'PHOTOS NEEDED', 'status badge unchanged (authority semantics untouched)');
  eq(s.photosNeeded.count, 1, 'still counted in the PHOTOS NEEDED bucket');
  eq(s.nonListable.count, 1, 'reported as non-listable');
  near(s.nonListable.value, 27.27, 'with its value');
  near(s.listableValue, 0, 'and contributes $0 to listable value');
  const mix = getCollectionMetrics([LIST_1PHOTO, NONLISTABLE_READYAUTH]);
  near(mix.listableValue, 50, 'listable value = only the listable:true record');
}

console.log('\nR6: definitions travel with the numbers');
{
  const m = getCollectionMetrics(CATALOGUE);
  ok(m.definitions === COLLECTION_VALUE_DEFINITIONS, 'metrics carry the definitions object');
  ok(/not sale proceeds/i.test(m.definitions.totalValue) && /Not a sale or liquidation figure/i.test(m.definitions.listableValue), 'definitions say estimate, not proceeds');
  ok(/not publishing authority/i.test(m.definitions.routing), 'definition: routing is not publishing authority');
  near(m.totalValue, 80 + 50 + 25.1 + 27.27, 'total estimated value = sum of every record estimate (blocked/refused contribute $0)');
  ok(!('liquidValue' in m), 'the misleading `liquidValue` field no longer exists');
}

console.log('\nLIST recommendation != photo readiness != publishing authority');
{
  const s = getCollectionMetrics([LIST_1PHOTO]);
  eq(getAuthoritativeChannel(LIST_1PHOTO), 'cash_sale', 'premise: routed to LIST');
  eq(s.ready.count, 0, '...yet NOT READY (1 photo)');
  eq(s.photosNeeded.count, 1, '...it is PHOTOS NEEDED');
  eq(getReadinessStatus(READY_4PHOTO).badge, 'READY', 'READY needs the full photo set');
  ok(!('gkAssetId' in LIST_1PHOTO) && getChannelMetrics([LIST_1PHOTO]).cash_sale.count === 1, 'LIST counts records with no physical-asset binding at all: it is a recommendation, not authorization');
}

console.log('\nBlocked / non-listable records are not executable inventory');
{
  const c = getChannelMetrics([BLOCKED_ARCHIE, ID_REQUIRED, NONLISTABLE_READYAUTH]);
  eq(c.cash_sale.count + c.bundle.count + c.grade.count + c.barter.count, 0, 'none of them routes to an executable channel');
  eq(getReadinessStatus(BLOCKED_ARCHIE).badge, 'BLOCKED', 'DO_NOT_LIST record is status BLOCKED');
  eq(getReadinessStatus(ID_REQUIRED).badge, 'BLOCKED', 'ID_REQUIRED record is status BLOCKED');
}

console.log('\nScope guards (router, source grades, pricing evidence unchanged)');
{
  const lib = readFileSync(join(__dirname, '../src/lib/collectionMetrics.js'), 'utf8').replace(/\r\n/g, '\n');
  const ROUTER_6BC07C5 = `const getAuthoritativeChannel = (item) => {
  if (!item) return null;
  const contract = item.contract;
  const legacy = item.decision?.bestChannel || null;
  if (!contract) return legacy;

  if (contract.state === 'ID_REQUIRED') return 'blocked';
  if (contract.state === 'REFUSED' || contract.state === 'LOCKED' || contract.listable === false) {
    return 'research';
  }
  return contract.bestChannel || legacy || null;
};`;
  ok(lib.includes(ROUTER_6BC07C5), 'getAuthoritativeChannel is byte-identical to src/App.jsx@6bc07c5 (router logic not changed)');
  const frozen = JSON.stringify(CATALOGUE.map((i) => i.id));
  const before = JSON.stringify(CATALOGUE, (k, v) => (typeof v === 'number' && Number.isNaN(v) ? 'NaN' : v));
  getCollectionMetrics(CATALOGUE); getChannelMetrics(CATALOGUE);
  ok(JSON.stringify(CATALOGUE, (k, v) => (typeof v === 'number' && Number.isNaN(v) ? 'NaN' : v)) === before && JSON.stringify(CATALOGUE.map((i) => i.id)) === frozen, 'metric functions never mutate records (grade, price, evidence)');
  const app = readFileSync(join(__dirname, '../src/App.jsx'), 'utf8').replace(/\r\n/g, '\n');
  ok(!/const getReadinessStatus = \(item\) =>|const getChannelMetrics = \(catalogue\) =>|const getCollectionMetrics = \(catalogue\) =>/.test(app), 'App.jsx no longer carries a second copy of the metric functions');
  ok(!app.includes('liquidValue') && !app.includes('LIQUID VALUE') && !app.includes('Liquid Value</div>'), 'App.jsx no longer presents a "Liquid Value" figure');
  ok(app.includes('LISTABLE VALUE (EST.)') && app.includes('TOTAL ESTIMATED VALUE') && app.includes('UNROUTED'), 'App.jsx renders the listable-value, total-estimated-value and unrouted chips');
  ok(app.includes('resolveGoverningGrade(item)') && app.includes('{operatorGradeTxt ? ` · ${operatorGradeTxt} (operator)` : ""}'), 'operator grade is shown as a separate labelled value');
  ok(/const gradeTxt = item\.isGraded === true && item\.numericGrade != null/.test(app), 'catalogue grade text (item.grade) is still rendered from item.grade, unaltered');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
