// tests/gkp0-provider-identity.test.js -- GK-P0 PROVIDER IDEMPOTENCY, DB-free unit proof of
// src/lib/ebayPublicationIdentity.js plus source-placement assertions on api/list-ebay.js (fail, never skip).
//
//   node tests/gkp0-provider-identity.test.js

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { derivePublicationIdentity, parseDuplicateUuidError, parseListingIdentity, evaluateRecoveredListing } from '../src/lib/ebayPublicationIdentity.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0, failed = 0;
const failures = [];
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; failures.push(l); console.log(`  ✗ ${l}`); } };
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

const A1 = '01a0bb24-c806-7a63-aa86-ce26fe8eed83';
const A2 = '01a0bb24-c806-7a63-aa86-ce26fe8eed84';

console.log('\n=== GK-P0 provider identity (Item.UUID) ===\n');
console.log('-- derivation --');
{
  const g0 = derivePublicationIdentity({ gkAssetId: A1, generation: 0 });
  ok(/^[0-9A-F]{32}$/.test(g0.uuid), `exactly 32 hex characters, uppercase (${g0.uuid})`);
  ok(g0.sku === `GK-${g0.uuid}`, 'SKU label is GK-<UUID>, the same relation the attempt ledger uses');
  ok(JSON.stringify(g0) === JSON.stringify(derivePublicationIdentity({ gkAssetId: A1.toUpperCase(), generation: 0 })), 'deterministic and case-insensitive on the asset id (stable across any number of calls / crashes / new HTTP requests)');
  ok(g0.uuid !== derivePublicationIdentity({ gkAssetId: A1, generation: 1 }).uuid, 'a later listing generation gets a different UUID');
  ok(g0.uuid !== derivePublicationIdentity({ gkAssetId: A2, generation: 0 }).uuid, 'a different asset gets a different UUID');
  ok(new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((g) => derivePublicationIdentity({ gkAssetId: A1, generation: g }).uuid)).size === 10, '10 consecutive generations are 10 distinct UUIDs');
  for (const bad of [{ gkAssetId: 'nope', generation: 0 }, { gkAssetId: A1, generation: -1 }, { gkAssetId: A1, generation: 1.5 }, { gkAssetId: A1, generation: 0, channel: 'etsy' }, {}]) {
    let threw = false; try { derivePublicationIdentity(bad); } catch { threw = true; }
    ok(threw, `invalid input refused: ${JSON.stringify(bad)}`);
  }
}

console.log('\n-- error 488 parsing (documented shape: ParamID="1" is the existing item id) --');
const mk488 = ({ param1 = '110040602158', msgId = '110040602158', code = '488', extra = '' } = {}) => `<AddFixedPriceItemResponse><Ack>Failure</Ack><Errors><ShortMessage>Duplicate UUID used.</ShortMessage><LongMessage>The specified UUID has already been used; ListedByRequestAppId=1, item ID=${msgId}.</LongMessage><ErrorCode>${code}</ErrorCode><SeverityCode>Error</SeverityCode><ErrorParameters ParamID="0"><Value>1</Value></ErrorParameters>${param1 ? `<ErrorParameters ParamID="1"><Value>${param1}</Value></ErrorParameters>` : ''}</Errors>${extra}</AddFixedPriceItemResponse>`;
{
  const ok1 = parseDuplicateUuidError(mk488());
  ok(ok1.isDuplicateUuid && ok1.itemId === '110040602158' && ok1.reason === 'structured-item-id', 'documented sample -> ItemID from structured ParamID="1"');
  ok(parseDuplicateUuidError(mk488({ code: '21919136' })).isDuplicateUuid === false, 'a different error code is NOT treated as a duplicate-UUID refusal');
  ok(parseDuplicateUuidError('').isDuplicateUuid === false && parseDuplicateUuidError(null).isDuplicateUuid === false && parseDuplicateUuidError('<garbage/>').isDuplicateUuid === false, 'empty / null / garbage -> not 488, never throws');
  const noParam = parseDuplicateUuidError(mk488({ param1: '' }));
  ok(noParam.isDuplicateUuid && noParam.itemId === null && noParam.reason === 'no-structured-item-id', '488 without the structured id -> itemId null (the message text alone is never trusted)');
  const mism = parseDuplicateUuidError(mk488({ msgId: '999999999999' }));
  ok(mism.isDuplicateUuid && mism.itemId === null && mism.reason === 'structured-message-mismatch', 'structured id disagreeing with the message -> nothing trusted');
  ok(parseDuplicateUuidError(mk488({ param1: '12' })).itemId === null, 'a malformed (too short) id is rejected');
  ok(parseDuplicateUuidError(mk488({ param1: '1100406021581234567' })).itemId === null, 'a malformed (too long) id is rejected');
  const two = parseDuplicateUuidError(`<R><Errors><ErrorCode>488</ErrorCode><ErrorParameters ParamID="1"><Value>110040602158</Value></ErrorParameters></Errors><Errors><ErrorCode>488</ErrorCode><ErrorParameters ParamID="1"><Value>110040602159</Value></ErrorParameters></Errors></R>`);
  ok(two.itemId === null && two.reason === 'multiple-structured-item-ids', 'two different ids in one response -> ambiguous');
  ok(parseDuplicateUuidError(mk488({ param1: '110040602158&amp;' })).itemId === null, 'an id with trailing junk is rejected');
}

console.log('\n-- recovered-listing verification (a 488 is never proof by itself) --');
{
  const good = { ack: 'Success', itemId: '110040602158', sellerUserId: 'My-Seller', sku: 'GK-ABC', listingStatus: 'Active' };
  const base = { expectedItemId: '110040602158', expectedSellerUserId: 'my-seller', expectedSku: 'GK-ABC', identity: good };
  ok(evaluateRecoveredListing(base).verified === true, 'seller (case-insensitive) + SKU + Active + same item id -> verified');
  ok(evaluateRecoveredListing({ ...base, identity: null }).reason === 'getitem-unavailable', 'unreadable listing -> not verified');
  ok(evaluateRecoveredListing({ ...base, identity: { ...good, ack: 'Failure' } }).reason === 'getitem-failed', 'GetItem failure -> not verified');
  ok(evaluateRecoveredListing({ ...base, identity: { ...good, itemId: '1' } }).reason === 'item-id-mismatch', 'a different item came back -> not verified');
  ok(evaluateRecoveredListing({ ...base, identity: { ...good, sellerUserId: 'other' } }).reason === 'seller-mismatch', 'another seller -> not verified');
  ok(evaluateRecoveredListing({ ...base, expectedSellerUserId: null }).reason === 'seller-mismatch', 'unknown expected seller -> not verified (fail closed)');
  ok(evaluateRecoveredListing({ ...base, identity: { ...good, sku: 'GK-OTHER' } }).reason === 'sku-mismatch', 'another publication identity (SKU) -> not verified');
  ok(evaluateRecoveredListing({ ...base, identity: { ...good, sku: null } }).reason === 'sku-mismatch', 'no SKU on the listing -> not verified');
  ok(evaluateRecoveredListing({ ...base, identity: { ...good, listingStatus: 'Completed' } }).reason === 'listing-not-active', 'ended listing -> not verified');
  const parsed = parseListingIdentity('<GetItemResponse><Ack>Success</Ack><Item><ItemID>110040602158</ItemID><ListingStatus>Active</ListingStatus><SKU>GK-ABC</SKU><Seller><UserID>my-seller</UserID></Seller></Item></GetItemResponse>');
  ok(parsed.itemId === '110040602158' && parsed.sellerUserId === 'my-seller' && parsed.sku === 'GK-ABC' && parsed.listingStatus === 'Active', 'GetItem parsing reads the seller from the Seller block');
  ok(parseListingIdentity(null).sellerUserId === null, 'garbage parses to nulls without throwing');
}

console.log('\n-- source placement in api/list-ebay.js --');
{
  const src = read('api/list-ebay.js');
  const iMutex = src.indexOf('acquirePublicationMutex({ principalId: grailkeyPrincipalId');
  const iIdent = src.indexOf('publicationIdentity = await getPublicationIdentity(');
  const iPlan = src.indexOf('correlation: manualAttempt ? manualAttempt.providerCorrelation : publicationIdentity');
  const iAdd = src.indexOf('"X-EBAY-API-CALL-NAME": "AddFixedPriceItem"', iPlan); // the single-item call (the bundle branch earlier in the file has its own)
  const iRecover = src.indexOf('parseDuplicateUuidError(responseXml)');
  const iClassify = src.indexOf('const attemptClass = manualAttempt');
  ok(iMutex > 0 && iMutex < iIdent && iIdent < iPlan && iPlan < iAdd, 'order: mutex -> durable identity -> plan correlation -> provider write');
  ok(iClassify < iRecover && iRecover < src.indexOf('const ack = recovered'), '488 recovery runs right after the provider response, before success/failure handling');
  ok(/UUID>\$\{xmlEscape\(plan\.correlation\.uuid\)\}/.test(src), 'the UUID is emitted into the Item XML from the plan correlation');
  ok(/expectedSku: listingPlan\.correlation\.sku/.test(src) && /expectedSellerUserId: sellerAccount\?\.userId/.test(src), 'verification compares against the SKU of THIS publication and the GetUser-confirmed seller');
  ok(/recordAttempt\('AMBIGUOUS', \{ detail: \{ reason: `duplicate-uuid-unverified/.test(src), 'an unverified 488 is preserved as AMBIGUOUS on the attempt ledger path');
  ok(!/fetch\(EBAY_ENDPOINT[\s\S]{0,400}AddFixedPriceItem[\s\S]{0,600}fetch\(EBAY_ENDPOINT[\s\S]{0,200}AddFixedPriceItem/.test(src.slice(src.indexOf('const sellerAccount'))), 'a second AddFixedPriceItem is never issued from the single-item path (recovery only reads)');
  const vercel = JSON.parse(read('vercel.json'));
  ok(vercel.functions['api/list-ebay.js']?.maxDuration === 120, 'vercel.json pins api/list-ebay.js maxDuration to 120s');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) { console.log('Failures:'); failures.forEach((f) => console.log(`  ✗ ${f}`)); process.exit(1); }
process.exit(0);
