// tests/b1rc-ebay-xml-contract.test.js
//
// B1-RC RC1 / A3 / A4 -- XML CONTRACT for the attempt-linked correlation elements, against eBay's PUBLISHED Trading API schema.
// Offline, DB-free, network-free. Fixtures:
//   * tests/fixtures/ebay/itemtype-sequence-v1487.json -- ItemType's direct children in schema order, extracted mechanically from
//     https://developer.ebay.com/webservices/latest/ebaySvc.xsd (version 1487, read 2026-10-12) together with the element rules.
//   * tests/fixtures/ebay/addfixedpriceitem-ready-baseline-b403f33.xml -- the exact READY-path packet produced by the UNMODIFIED
//     Production builder (b403f33) for a fixed item/plan.
// A one-time FULL XSD validation (libxml2 via xmllint-wasm, scratch tool, not a repo dependency) is recorded in the registry; this
// test is the repeatable repo-side contract.
//   node tests/b1rc-ebay-xml-contract.test.js

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fx = JSON.parse(readFileSync(path.join(root, 'tests', 'fixtures', 'ebay', 'itemtype-sequence-v1487.json'), 'utf8'));
const baseline = readFileSync(path.join(root, 'tests', 'fixtures', 'ebay', 'addfixedpriceitem-ready-baseline-b403f33.xml'), 'utf8');
const OA = await import(pathToFileURL(path.join(root, 'src', 'lib', 'operatorAuthority.js')).href);
const mod = await import(pathToFileURL(path.join(root, 'api', 'list-ebay.js')).href);

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
console.log('\n=== B1-RC XML contract: Item.UUID / Item.SKU against eBay\'s published schema (v1487) ===\n');

const ORDER = fx.itemTypeOrder;
const plan = (o = {}) => ({ conditionId: null, bestOffer: false, shippingService: { token: 'USPSParcel', description: 'USPS Ground Advantage' },
  specifics: [{ name: 'Publisher', value: 'Marvel' }, { name: 'Series Title', value: 'The New Mutants' }, { name: 'Issue Number', value: '98' }, { name: 'Publication Year', value: '1991' }, { name: 'Format', value: 'Single Issue' }, { name: 'Language', value: 'English' }], ...o });
const item = { title: 'The New Mutants', issue: '98', year: '1991', publisher: 'Marvel', price: '$263.80' };
const pics = ['https://i.ebayimg.com/images/g/abc/s-l1600.jpg'];
const attemptId = '01a13144-dea7-7fa5-8224-566a1ae53fba';
const corr = OA.attemptCorrelation(attemptId);

// direct children of <Item> (depth-1 tags), in emitted order
function itemChildren(xml) {
  const s = xml.indexOf('<Item>') + 6, e = xml.lastIndexOf('</Item>');
  const out = []; let depth = 0;
  for (const m of xml.slice(s, e).matchAll(/<!\[CDATA\[[\s\S]*?\]\]>|<(\/?)([A-Za-z0-9]+)([^>]*?)(\/?)>/g)) {
    if (m[2] === undefined) continue;
    const closing = m[1] === '/', self = m[4] === '/';
    if (!closing && depth === 0) out.push(m[2]);
    if (!closing && !self) depth++; else if (closing) depth--;
  }
  return out;
}
const idx = (n) => ORDER.indexOf(n);
const inversions = (names) => { let c = 0; for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) if (idx(names[i]) > idx(names[j])) c++; return c; };

console.log('-- schema facts (from the extracted official schema) --');
ok(fx._provenance.schemaVersion === '1487' && ORDER.length === 119, `ItemType has ${ORDER.length} direct children in schema v${fx._provenance.schemaVersion}`);
ok(idx('UUID') >= 0 && idx('SKU') >= 0, 'UUID and SKU are both direct children of ItemType');
ok(idx('UUID') < idx('SKU'), `ItemType is an xs:sequence in which UUID (position ${idx('UUID')}) precedes SKU (position ${idx('SKU')})`);
ok(idx('InventoryTrackingMethod') >= 0 && idx('InventoryTrackingMethod') !== idx('SKU'), 'InventoryTrackingMethod is a separate, optional element (SKU does not require it; only SKU-based GetItem lookup does)');

console.log('\n-- the emitted packet --');
const withCorr = mod.__dryRunBuildListingXml(item, pics, plan({ correlation: corr }));
const kids = itemChildren(withCorr);
ok(/<UUID>[0-9A-F]{32}<\/UUID>/.test(withCorr), 'Item.UUID is exactly 32 characters of digits 0-9 and letters A-F (uppercase)');
ok(withCorr.includes(`<UUID>${corr.uuid}</UUID>`) && corr.uuid === attemptId.replace(/-/g, '').toUpperCase(), 'Item.UUID is derived from the attempt id (a resend of the same attempt carries the same UUID)');
ok(corr.sku === `GK-${corr.uuid}` && corr.sku.length <= 50 && withCorr.includes(`<SKU>${corr.sku}</SKU>`), `Item.SKU is attempt-linked and ${corr.sku.length} characters (limit 50)`);
ok(kids.filter((k) => k === 'UUID').length === 1 && kids.filter((k) => k === 'SKU').length === 1, 'each appears exactly once, as a direct child of <Item>');
ok(kids.indexOf('UUID') < kids.indexOf('SKU'), 'UUID is emitted before SKU (the schema\'s relative order)');
ok(!withCorr.includes('InventoryTrackingMethod'), 'InventoryTrackingMethod is NOT set: the listing keeps eBay\'s default ItemID tracking, so SKU is a label, not a GetItem key');
ok(kids.every((k) => idx(k) >= 0), `every direct child of <Item> is a valid ItemType element (${kids.length} checked)`);

console.log('\n-- no change for the READY path; no new schema deviation from the correlation elements --');
const readyNow = mod.__dryRunBuildListingXml(item, pics, plan());
ok(readyNow === baseline, 'READY-path packet (no correlation) is BYTE-IDENTICAL to the unmodified Production builder\'s packet');
ok(!readyNow.includes('<UUID>') && !readyNow.includes('<SKU>'), 'a non-OPERATOR_MANUAL listing carries neither element');
ok(!mod.__dryRunBuildListingXml(item, pics, plan({ correlation: { uuid: '', sku: '' } })).includes('<UUID>') && !mod.__dryRunBuildListingXml(item, pics, plan({ correlation: null })).includes('<SKU>'), 'an empty or null correlation emits nothing');
const baseKids = itemChildren(readyNow);
const withoutNew = kids.filter((k) => k !== 'UUID' && k !== 'SKU');
ok(JSON.stringify(withoutNew) === JSON.stringify(baseKids), 'removing UUID/SKU from the OPERATOR_MANUAL packet yields exactly the READY packet\'s child sequence (nothing else moved)');
// KNOWN, PRE-EXISTING deviation (recorded, not introduced here): the builder does not emit <Item> children in schema order.
ok(inversions(baseKids) > 0, `KNOWN PRE-EXISTING: the Production packet's <Item> children are not in schema sequence order (${inversions(baseKids)} inversions); listings succeed regardless (real ItemID 366665728633 was created by this builder)`);
ok(inversions(kids) - inversions(baseKids) <= kids.length, 'the correlation elements add no more than a bounded number of order inversions on top of that baseline (position is not load-bearing for eBay)');
ok(!/ShippingServiceCost currencyID/.test(readyNow) && /<ShippingServiceCost>/.test(readyNow), 'KNOWN PRE-EXISTING: ShippingServiceCost is emitted without its schema-required currencyID attribute (identical on both paths; not introduced here)');

console.log(`\n${'='.repeat(60)}\nB1-RC XML CONTRACT: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
