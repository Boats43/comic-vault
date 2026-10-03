// tests/outcome1-packet-safety.test.js — Outcome #1 packet safety (pure/library layer, no DB, no network).
// The real-handler proofs (price binding, shipping, photo last-mile, Best Offer, packet contents) are in
// tests/list-ebay-outcome1-handler-smoke.test.js.
//
// Invoke: node tests/outcome1-packet-safety.test.js

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { META_ASPECTS, META_CONDITIONS, SHIPPING_XML, HOSTED_PICTURE_URL, TINY_PNG_B64 } from './helpers/ebayPacketMocks.js';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
const U = (rel) => pathToFileURL(path.join(repoRoot, rel)).href;

const PB = await import(U('src/lib/listingPriceBinding.js'));
const MD = await import(U('src/lib/ebayListingMetadata.js'));
const PG = await import(U('src/lib/listingPhotoGuard.js'));
const { toBuyerSafeListingFacts } = await import(U('src/lib/buyerSafeListingCopy.js'));

console.log('\n=== PRICE: Q41 acknowledged amount must exactly equal the outbound price ===');
const bind = (ack, out) => { try { PB.assertQ41PriceBinding({ q41Override: { priceOverridden: true, manualPrice: ack }, outgoingPrice: out }); return 'pass'; } catch (e) { return e.code; } };
ok(bind(263.80, '$263.80') === 'pass' && bind(263.8, 263.80) === 'pass' && bind('263.80', '263.8') === 'pass', 'A. Q41 263.80 + packet 263.80 -> passes (string/number/format-insensitive, exact in cents)');
ok(bind(263.80, '$263.81') === 'MANUAL_PRICE_ACK_MISMATCH', 'B. Q41 263.80 + packet 263.81 -> MANUAL_PRICE_ACK_MISMATCH');
ok(bind(263.80, '$360.59') === 'MANUAL_PRICE_ACK_MISMATCH', 'C. Q41 263.80 + packet 360.59 -> MANUAL_PRICE_ACK_MISMATCH');
ok(bind(263.80, 263.804) === 'MANUAL_PRICE_ACK_MISMATCH' && bind(263.80, null) === 'MANUAL_PRICE_ACK_MISMATCH' && bind(null, '$263.80') === 'MANUAL_PRICE_ACK_MISMATCH', 'sub-cent / missing amounts are refused, never rounded');
ok(PB.toCents('$1,263.80') === 126380 && PB.toCents(0.1 + 0.2) === null && PB.toCents('19.995') === null && PB.toCents('19.9950') === null && PB.toCents('263.800') === 26380, 'toCents is currency-safe (no float equality; trailing zeros ok, sub-cent refused)');
const lap = (amt, out, req) => { try { return PB.assertListActionPriceBinding({ actionValueAmount: amt, outgoingPrice: out, requireRecorded: req }); } catch (e) { return e.code; } };
ok(lap('263.80', 263.80, true).recorded === true && lap('263.80', 263.81, true) === 'LIST_ACTION_PRICE_MISMATCH' && lap(null, 263.80, true) === 'LIST_ACTION_PRICE_NOT_RECORDED' && lap(null, 263.80, false).recorded === false, 'durable LIST action price: equal -> ok; different -> LIST_ACTION_PRICE_MISMATCH; absent on the Q41 path -> LIST_ACTION_PRICE_NOT_RECORDED');

console.log('\n=== SHIPPING: authoritative GeteBayDetails; Media Mail never selectable ===');
const services = MD.parseShippingServices(SHIPPING_XML);
const pick = MD.selectDomesticShippingService(services);
ok(pick && pick.token === 'USPSParcel' && pick.description === 'USPS Ground Advantage' && pick.validForSellingFlow === true, 'F. USPS Ground Advantage resolves to the SELLING token "USPSParcel" (not the return-label entry "USPSGroundAdvantageReturn", ValidForSellingFlow=false)');
ok(MD.selectDomesticShippingService(services.filter((s) => s.token === 'USPSMedia')) === null, 'E. Media Mail alone is never selected (null => fail-closed upstream)');
ok(MD.selectDomesticShippingService(services, { preferredDescription: 'USPS Media Mail' }) === null, 'E. even if Media Mail were requested by description it is refused');
ok(MD.FORBIDDEN_SHIPPING_TOKENS.includes('USPSMedia'), 'USPSMedia is on the forbidden list');
let fetched = null;
const svc = await MD.resolveDomesticShippingService({ headers: { 'X-EBAY-API-IAF-TOKEN': 't' }, fetchImpl: async (u, o) => { fetched = { u, call: o.headers['X-EBAY-API-CALL-NAME'] }; return { text: async () => SHIPPING_XML }; } });
ok(fetched?.call === 'GeteBayDetails' && svc.token === 'USPSParcel', 'resolution calls the real eBay GeteBayDetails API and returns its token');
let threw = false; try { await MD.resolveDomesticShippingService({ headers: {}, fetchImpl: async () => ({ text: async () => '<GeteBayDetailsResponse><Ack>Failure</Ack></GeteBayDetailsResponse>' }) }); } catch { threw = true; }
ok(threw, 'a failed GeteBayDetails call throws (the handler then fails closed with SHIPPING_SERVICE_UNRESOLVED)');

console.log('\n=== CONDITION: authoritative category policy only ===');
MD.__resetMetadataCachesForTests();
const mockFetch = async (url) => {
  const u = String(url);
  if (u.includes('identity/v1/oauth2/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'app-tok', expires_in: 7200 }) };
  if (u.includes('/sell/metadata/v1/')) return { ok: true, status: 200, json: async () => META_CONDITIONS };
  if (u.includes('/commerce/taxonomy/v1/')) return { ok: true, status: 200, json: async () => META_ASPECTS };
  throw new Error('unexpected ' + u);
};
const env = { EBAY_APP_ID: 'a', EBAY_CERT_ID: 'c' };
const policy = await MD.getItemConditionPolicy('259104', { fetchImpl: mockFetch, env });
ok(policy.itemConditionRequired === false && policy.itemConditions.length === 5 && policy.itemConditions[1].conditionId === '2750' && policy.itemConditions[1].conditionDescription === 'Like New', 'G. the RAW conditionId/conditionDescription pairs come from the Sell Metadata API response (2750 is "Like New" in this category, NOT "Graded")');
ok(MD.validateConditionId('4000', policy) && !MD.validateConditionId('7346', policy) && !MD.validateConditionId('3000', policy), 'I. only ids the CATEGORY policy lists validate (a global/browse-page id such as 7346 or 3000 does not)');
const src = readFileSync(path.join(repoRoot, 'api', 'list-ebay.js'), 'utf8');
const strip = (x) => x.replace(/\/\/.*$/gm, '');
ok(/conditionId: null/.test(strip(src)) && !/conditionIdFor/.test(strip(src)) && !/<ConditionID>\$\{conditionId\}/.test(strip(src).replace(/\$\{conditionId \? `/, '')), 'H. the handler never derives ConditionID from a grade string (conditionIdFor removed; plan.conditionId is null unless authoritatively validated)');

console.log('\n=== ITEM SPECIFICS: provenance classification ===');
MD.__resetMetadataCachesForTests();
const meta = await MD.getAspectMetadata('259104', { fetchImpl: mockFetch, env });
const nm = toBuyerSafeListingFacts({ title: 'the new mutants', issue: '98', year: '1991', publisher: 'Marvel' });
const specs = MD.buildItemSpecificsFromMetadata(nm, meta);
const byName = Object.fromEntries(specs.map((s) => [s.name, s]));
ok(byName.Era?.value === 'Copper Age (1984-1991)' && byName.Era.provenance === 'A', 'J/K. Era is resolved from eBay\'s own enum for the governed year (1991 -> "Copper Age (1984-1991)", class A) — the old constructed "Modern Age (1991-1999)" cannot be produced');
ok(MD.resolveEraAspect(1969, meta) === 'Silver Age (1956-69)' && MD.resolveEraAspect(1984, meta) === 'Copper Age (1984-1991)' && MD.resolveEraAspect(1992, meta) === 'Modern Age (1992-Now)' && MD.resolveEraAspect(1983, meta) === 'Bronze Age (1970-83)', 'Era parsing handles eBay\'s mixed 2-digit/4-digit/"Now" labels at every boundary');
ok(MD.resolveEraAspect(1700, meta) === null && MD.resolveEraAspect('', meta) === null && MD.resolveEraAspect(1991, new Map()) === null, 'L. no matching/ambiguous era => omitted, never guessed');
ok(['Publisher', 'Series Title', 'Issue Number', 'Publication Year'].every((n) => byName[n]?.provenance === 'B'), 'Publisher / Series Title / Issue Number / Publication Year are class B (governed catalogue facts)');
ok(byName.Format?.value === 'Single Issue' && byName.Format.provenance === 'A', 'Format "Single Issue" is an enum value validated against eBay metadata (class A), only when a governed issue number exists and it is not TPB/magazine');
ok(!specs.some((s) => ['Language', 'Grade Certification', 'Type', 'Professional Grader', 'Grade', 'Character'].includes(s.name)), 'constructed/ungoverned aspects (Language, "Grade Certification" — not an eBay aspect at all —, Grade, Character) are NOT emitted');
ok(!MD.buildItemSpecificsFromMetadata(nm, meta, { isTPB: true }).some((s) => s.name === 'Format') && !MD.buildItemSpecificsFromMetadata({ ...nm, issue: '' }, meta).some((s) => s.name === 'Format'), 'Format omitted for a TPB/magazine or when no governed issue number exists');
ok(MD.buildItemSpecificsFromMetadata({ title: 'X' }, meta).every((s) => s.value), 'unknown optional aspects are omitted instead of guessed');
ok(specs.every((s) => ['A', 'B'].includes(s.provenance)), 'every emitted specific is class A or B — NO class C (constructed) value ships');

console.log('\n=== PHOTO: last-mile guard ===');
const bytes = Buffer.from(TINY_PNG_B64, 'base64');
const owned = [PG.sha256Hex(bytes)];
const imgFetch = (ct, status = 206) => async () => ({ status, headers: { get: (h) => (String(h).toLowerCase() === 'content-type' ? ct : null) } });
const guard = async (images, hashes = owned, f = imgFetch('image/jpeg')) => { try { await PG.assertPublishPhotos({ sourceImages: images, assetMediaHashes: hashes, fetchImpl: f }); return 'pass'; } catch (e) { return e.code + ':' + e.reason; } };
ok(await guard([{ bytes, url: HOSTED_PICTURE_URL }]) === 'pass', 'S. valid hosted image of this asset (hash owned, https, ebayimg host, reachable, image/*) passes');
ok((await guard([])).startsWith('PUBLISH_BLOCKED_NO_PHOTO:no-photo'), 'N. missing photo refused');
ok((await guard([{ bytes, url: 'https://i.ebayimg.com/PLACEHOLDER/x.jpg' }])).includes('placeholder-url') && (await guard([{ bytes, url: 'https://i.ebayimg.com/DRYRUN-PLACEHOLDER-picture-url/primary.jpg' }])).includes('placeholder-url'), 'O. placeholder URL refused');
ok((await guard([{ bytes, url: 'http://i.ebayimg.com/x.jpg' }])).includes('not-https') && (await guard([{ bytes, url: 'https://cdn.evil-host.org/x.jpg' }])).includes('host-not-approved') && (await guard([{ bytes, url: 'not a url' }])).includes('invalid-url'), 'HTTPS + approved-host + valid-URL checks');
ok((await guard([{ bytes, url: HOSTED_PICTURE_URL }], owned, imgFetch('text/html', 404))).includes('unreachable'), 'P. unreachable URL refused');
ok((await guard([{ bytes, url: HOSTED_PICTURE_URL }], owned, async () => { throw new Error('ECONNRESET'); })).includes('unreachable'), 'P. a network failure refuses');
ok((await guard([{ bytes, url: HOSTED_PICTURE_URL }], owned, imgFetch('text/html'))).includes('not-an-image'), 'Q. non-image content-type refused');
ok((await guard([{ bytes: Buffer.from('another asset photo'), url: HOSTED_PICTURE_URL }])).includes('media-not-for-this-asset') && (await guard([{ bytes, url: HOSTED_PICTURE_URL }], [])).includes('media-not-for-this-asset'), 'R. media that does not hash to a media row of THIS gkAssetId refused (also when the asset has no media at all)');

console.log('\n=== BOUNDARY / structure ===');
ok(!/USPSMedia/.test(strip(src).slice(strip(src).indexOf('const buildXml'), strip(src).indexOf('export const __dryRunBuildListingXml'))), 'the single-listing packet builder contains no hard-coded USPSMedia token');
ok(/plan\.bestOffer === true/.test(strip(src)) && !/BestOfferEnabled>true<\/BestOfferEnabled>\s*\n\s*<\/BestOfferDetails>\s*\n\s*<ListingDetails>\s*\n.*\n.*\n\s*<\/ListingDetails>\s*\n  <\/Item>/.test(strip(src).replace(/plan\.bestOffer === true \? `/, 'X')), 'M. Best Offer is emitted only on explicit opt-in (default OFF)');
ok(!/\bitem\.reason\b/.test(strip(src)), 'T. raw item.reason remains absent from api/list-ebay.js');
ok(src.indexOf('assertQ41PriceBinding') < src.indexOf('uploadSiteHostedPicture(img, singleHeaders)') && src.indexOf('resolveDomesticShippingService({') < src.indexOf('uploadSiteHostedPicture(img, singleHeaders)') && src.indexOf('assertPublishPhotos({') < src.indexOf('const xml = buildXml(item, pictureUrls, listingPlan)'), 'ordering: price binding + shipping resolution precede any picture upload; the photo guard precedes AddFixedPriceItem construction');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
