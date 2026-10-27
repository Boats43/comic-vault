// tests/c3-targeted-correction.test.js
//
// C3 TARGETED CORRECTION - Ownership != Pricing, Variant Integrity, Q32 Consistency.
// Golden physical asset: Avengers #4 (2023) Alex Ross Connecting Virgin Variant (COLOR).
// DB-free and network-free. (The R1 handler call proves the screen gate is gone; with no database configured it
// then reaches captureFromScan and fails there with a 500, which is exactly the point - it is past the gate.) The real-handler wiring proof is tests/c3-avengers4-handler-smoke.test.js.
//
// Invoke: node tests/c3-targeted-correction.test.js

import './helpers/spendGuardTestSetup.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

if (!process.env.GRAILKEY_SESSION_SECRET) {
  process.env.GRAILKEY_SESSION_SECRET = (await import('node:crypto')).randomBytes(32).toString('base64url');
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const imp = (p) => import(new URL(`../${p}`, import.meta.url).href);

let passed = 0; let failed = 0; const failures = [];
const ok = (cond, label) => {
  if (cond) { passed++; console.log(`  PASS ${label}`); }
  else { failed++; failures.push(label); console.log(`  FAIL ${label}`); }
};

const { containCaptureEvidence, isReferenceOnlyCapture } = await imp('src/lib/captureAuthenticity.js');
const { buildOwnershipAttestation } = await imp('src/lib/ownershipAttestation.js');
const { handleCaptureScan } = await imp('src/lib/captureScanHandler.js');
const { assessPhotoAuthority } = await imp('src/lib/evidenceEligibility.js');
const { issueToken } = await imp('src/modules/auth/token.js');
const { resolveAssetTypeConfident, isAssetTypeUncertain } = await imp('src/lib/assetTypeStanding.js');
const { computeDecision } = await imp('src/lib/decisionEngine.js');
const { getAssetConfirmationBadge } = await imp('src/lib/assetConfirmationBadge.js');
const { partitionByEdition, targetEditionKind, placeListing, describeEditionAxis, EDITION_KIND } = await imp('src/lib/variantEditionAxis.js');
const { applyVariantPreferenceFilter } = await imp('api/comps.js');
const { buildCorrectedCatalogueItem } = await imp('src/lib/manualCorrection.js');

const mockRes = () => { const r = { statusCode: null, body: null, headers: {} }; r.setHeader = (k, v) => { r.headers[k] = v; }; r.status = (c) => { r.statusCode = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };
const token = issueToken({ principalId: 'c3-principal' }).token;
const post = async (body) => { const res = mockRes(); await handleCaptureScan({ method: 'POST', headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': `c3-${Math.random()}` }, body }, res); return res; };

const VARIANT = 'Alex Ross Connecting Virgin Variant';
const POOL = [
  { title: 'Avengers #4 2023 Alex Ross Virgin Variant Color Cover NM', price: 8.99 },
  { title: 'Avengers #4 2023 Alex Ross 1:25 Black and White Sketch Virgin Variant NM', price: 41 },
  { title: 'Avengers #4 (2023) Alex Ross B&W Virgin Sketch Variant', price: 38 },
  { title: 'Avengers #4 2023 Alex Ross Connecting Trade Dress Cover Variant NM', price: 12 },
  { title: 'Avengers #4 (2023) Marvel Cover A NM', price: 4.5 },
];

console.log('\n=== R1 - screen detection is ADVISORY ===');
// 1. A physical comic with glare, fingers and a backing board: the model says screen. It must not refuse alone.
const glare = containCaptureEvidence({ title: 'Avengers', captureSurface: 'screen_or_reproduction', reason: 'glare on bag, fingers at edge, backing board' });
ok(glare.captureAuthenticity.status === 'SCREEN_SUSPECTED' && glare.captureAuthenticity.verified === false && glare.captureAuthenticity.basis === 'model-claim', 'the screen read is recorded as an UNVERIFIED model claim (provenance kept)');
ok(isReferenceOnlyCapture(glare.captureAuthenticity) === true, 'the advisory flag is still raised for the card');
const handlerSrc = read('src/lib/captureScanHandler.js');
ok(!/status\s*===\s*'SCREEN_SUSPECTED'/.test(handlerSrc) && !/CAPTURE_REFERENCE_ONLY_CODE\s*,/.test(handlerSrc), 'captureScanHandler no longer refuses on the model screen flag');
const att = buildOwnershipAttestation('operator-panel');
let res = await post({ assetClass: 'comic', ownershipAttestation: att, scanPayload: { correlationId: 'x', collectionItemId: 'never-created', captureAuthenticity: { status: 'SCREEN_SUSPECTED' } }, photos: [], idempotencyKey: 'k-c3-1' });
ok(res.body?.code !== 'CAPTURE_REFERENCE_ONLY', `attested + model SCREEN_SUSPECTED is NOT refused at the screen gate (got ${res.statusCode} ${res.body?.code ?? res.body?.error})`);
const panelSrc = read('src/components/GrailKeyOperatorPanel.jsx');
ok(!/disabled=\{[^}]*SCREEN_SUSPECTED/.test(panelSrc) && !/captureAuthenticity\?\.status === "SCREEN_SUSPECTED"\) \{\s*setCaptureState/.test(panelSrc), 'operator panel no longer blocks the attested capture button on the model flag');
ok(/Advisory/.test(panelSrc) && /not a refusal/.test(panelSrc), 'operator panel still shows the screen warning as advisory text');

console.log('\n=== R2/R3 - ownership and pricing are independent; publication authority unchanged ===');
// 2. Reference-image research never establishes ownership.
res = await post({ assetClass: 'comic', scanPayload: { correlationId: 'x', collectionItemId: 'never-created', captureAuthenticity: { status: 'PHYSICAL_CLAIMED' } }, photos: [], idempotencyKey: 'k-c3-2' });
ok(res.statusCode === 400 && res.body?.code === 'OWNERSHIP_ATTESTATION_REQUIRED', 'a model "physical" read WITHOUT the operator attestation still cannot create an owned asset');
res = await post({ assetClass: 'comic', ownershipAttestation: { attested: true }, scanPayload: { correlationId: 'x', collectionItemId: 'never-created' }, photos: [], idempotencyKey: 'k-c3-3' });
ok(res.statusCode === 400 && res.body?.code === 'OWNERSHIP_ATTESTATION_REQUIRED', 'a bare { attested: true } is not an attestation');
ok(assessPhotoAuthority('Avengers #4 stock photo for reference only').ownershipEvidence === false, 'a reference/stock listing photo is never ownership evidence');
ok(assessPhotoAuthority('Avengers #4 Alex Ross Virgin NM').identityPhotoEligible === true, 'a reference photo can still help identity/research (pricing is not gated on ownership)');
const enrichSrc = read('api/enrich.js');
ok(!/ownershipAttest/i.test(enrichSrc.replace(/\/\/.*$/gm, '')), 'api/enrich.js (pricing) never reads ownership - a non-owned scan still gets market research');
const listSrc = read('api/list-ebay.js');
ok(/validateOutcomeAttachment/.test(listSrc) && /gkAssetId/.test(listSrc), 'publication authority (durable asset + governed LIST action + exact price binding) is still enforced in api/list-ebay.js');
ok(/ownershipAttestation/.test(read('src/lib/captureScanHandler.js')) && /OWNERSHIP_ATTESTATION_REQUIRED_CODE/.test(read('src/lib/captureScanHandler.js')), 'the attestation requirement is unchanged on the capture path');

console.log('\n=== R6 - the server Q32 override reaches the client ===');
const overridden = { assetTypeConfident: false, assetTypeConfidentOverride: true };
const notOverridden = { assetTypeConfident: false };
ok(resolveAssetTypeConfident(overridden) === true && isAssetTypeUncertain(overridden) === false, 'resolved standing honours the server Q32 override');
ok(isAssetTypeUncertain(notOverridden) === true, 'without the override the model flag still stands (still advisory-uncertain)');
ok(resolveAssetTypeConfident({ assetTypeConfident: true }) === true && resolveAssetTypeConfident({}) === undefined, 'confident/absent flags pass through unchanged');
const appSrc = read('src/App.jsx');
ok(!/enrich\.assetTypeConfident === false/.test(appSrc), 'App.jsx never re-applies the raw model flag to enrich responses');
ok((appSrc.match(/isAssetTypeUncertain\(enrich\)/g) || []).length >= 7 && (appSrc.match(/resolveAssetTypeConfident\(enrich/g) || []).length >= 7, 'every enrich merge site reads the resolved standing');
// price visibility: the client nulls price only when idGated; the override keeps it.
const idGated = (e) => e.identityConfident === false || isAssetTypeUncertain(e);
ok(idGated({ identityConfident: true, ...overridden }) === false, 'with identity confirmed + Q32 override the price is NOT nulled by the client');
ok(idGated({ identityConfident: true, ...notOverridden }) === true, 'negative control: without the override the client still gates');
ok(getAssetConfirmationBadge({ assetType: 'comic', ...overridden }).state === 'confirmed', 'badge shows the comic as confirmed under the override');
ok(getAssetConfirmationBadge({ assetType: 'comic', ...notOverridden }).state === 'uncertain', 'negative control: badge stays cautious without the override');
const baseItem = { title: 'Avengers', issue: '4', year: '2023', price: '$8.99', pricingSource: 'active_ask_derived', identityConfident: true, comps: { count: 3 }, rawComps: { count: 3, prices: [8, 9, 10], average: 9, lowest: 8, highest: 10 } };
const dOverride = computeDecision({ ...baseItem, ...overridden }, {});
const dNo = computeDecision({ ...baseItem, ...notOverridden }, {});
ok(!(dOverride.warnings || []).includes('asset-type-uncertain'), 'decision engine does not re-warn when the server lifted the lock');
ok((dNo.warnings || []).includes('asset-type-uncertain'), 'negative control: decision engine warns without the override');

console.log('\n=== R4 - hard variant-edition distinction ===');
ok(targetEditionKind(VARIANT) === EDITION_KIND.COLOR_VIRGIN, 'Alex Ross Connecting Virgin (colour) targets COLOR_VIRGIN');
ok(targetEditionKind('Alex Ross B&W Sketch Virgin Variant') === EDITION_KIND.BW_SKETCH, 'a B&W sketch virgin targets BW_SKETCH');
ok(targetEditionKind('Connecting Trade Dress Cover') === EDITION_KIND.TRADE_DRESS, 'a trade-dress cover targets TRADE_DRESS');
ok(targetEditionKind('Newsstand') === null, 'an unrelated variant is untouched by this axis');
// 6. colour virgin excludes B&W/sketch
const color = applyVariantPreferenceFilter(POOL, VARIANT);
ok(color.pool.length === 1 && color.pool[0].price === 8.99 && color.matched === true, 'colour virgin target: the exact pool is ONLY the colour-virgin listing');
ok(!color.pool.some((p) => /black and white|b&w|sketch/i.test(p.title)), 'colour virgin target: B&W / sketch listings excluded');
ok(!color.pool.some((p) => /trade dress/i.test(p.title)), 'colour virgin target: trade-dress listings excluded');
ok(color.editionAxis.excludedCount === 4 && color.editionAxis.excluded.every((e) => e.reason), 'every excluded listing keeps a reason (I13 - annotated, not silently dropped)');
// 7. B&W/sketch excludes colour virgin
const bw = applyVariantPreferenceFilter(POOL, 'Alex Ross B&W Sketch Virgin Variant');
ok(bw.pool.length === 2 && bw.pool.every((p) => [41, 38].includes(p.price)), 'B&W/sketch target: the exact pool is only the two B&W/sketch listings');
ok(!bw.pool.some((p) => p.price === 8.99), 'B&W/sketch target: the colour-virgin listing is excluded');
// 8. trade-dress stays separate
const td = applyVariantPreferenceFilter(POOL, 'Connecting Trade Dress Cover');
ok(td.pool.length === 1 && td.pool[0].price === 12, 'trade-dress target: only the trade-dress listing');
ok(placeListing('Avengers #4 Virgin Cover', EDITION_KIND.COLOR_VIRGIN).place === 'NEARBY', '"Virgin" alone (colour unstated) is NEARBY-family, never EXACT');
ok(placeListing('Avengers #4 Alex Ross Trade Dress', EDITION_KIND.COLOR_VIRGIN).place === 'EXCLUDED', 'trade-dress is a different edition from colour virgin');
// broad any-match must not admit mutually exclusive attributes when no listing affirms colour
const noStated = applyVariantPreferenceFilter(POOL.filter((p) => p.price !== 8.99), VARIANT);
ok(!noStated.pool.some((p) => [41, 38, 12].includes(p.price)), 'with no colour listing, B&W/trade-dress still never stand in for the exact edition');
// 5. no fabricated price when evidence is insufficient
const onlyOther = applyVariantPreferenceFilter(POOL.filter((p) => [41, 38, 12].includes(p.price)), VARIANT);
ok(onlyOther.pool.length === 0 && onlyOther.matched === false, 'only other-edition listings -> EMPTY pool (no price can be derived)');
// 9. sparse exact matches labelled truthfully
const label = describeEditionAxis(color.editionAxis);
ok(/1 active listing/.test(label) && /asking price, not a sold price/.test(label) && /4 other-edition listings excluded/.test(label), `sparse exact pool is labelled truthfully: "${label}"`);
ok(/No listing affirms/.test(describeEditionAxis(onlyOther.editionAxis)), 'zero exact listings is stated plainly');
ok(partitionByEdition(POOL, 'Newsstand') === null, 'axis does not apply to unrelated variants (existing behaviour untouched)');

console.log('\n=== R5 - a rejected anchor cannot create a year conflict ===');
ok(/buildYearEvidence/.test(enrichSrc) && /rejected PC anchor year/.test(enrichSrc), 'year evidence is rebuilt without the rejected catalog anchor (real-handler proof in c3-avengers4-handler-smoke)');
const rebuildIdx = enrichSrc.indexOf('rejected PC anchor year');
const gateIdx = enrichSrc.indexOf('[pc-anchor-gate] rejecting PC match');
ok(rebuildIdx > gateIdx && gateIdx > 0, 'the rebuild runs AFTER pc-anchor-gate has rejected the anchor');

console.log('\n=== R7 - corrected variant invalidates the stale price ===');
const stale = {
  id: 'cv_1793075346040_c6e7o1', title: 'Avengers', issue: '4', year: '2023', variant: 'Alex Ross B&W Sketch Virgin',
  price: '$18.71', priceLow: '$15.00', priceHigh: '$22.00', pricingSource: 'active_ask_derived',
  rawComps: { count: 9, prices: [18, 19, 20, 17, 18, 19, 20, 17, 18] }, comps: { count: 9 }, images: ['data:image/png;base64,AA=='],
  contract: { state: 'READY' }, decision: { action: 'LIST_NOW' }, grade: 'NM',
};
const corrected = buildCorrectedCatalogueItem(stale, { variantNote: VARIANT, title: 'Avengers', issue: '4', confirmedYear: '2023' });
ok(corrected.price == null && corrected.priceLow == null && corrected.priceHigh == null, 'the old $18.71 is NOT carried onto the corrected variant');
ok(corrected.rawComps == null && corrected.contract == null && corrected.decision == null, 'incompatible comps, contract and decision are invalidated');
ok(corrected.variant === VARIANT, 'the corrected variant is the authoritative one');
ok(Array.isArray(corrected.supersededResearch) && corrected.supersededResearch[0].price === '$18.71' && corrected.supersededResearch[0].status === 'SUPERSEDED', 'the prior research is kept as SUPERSEDED history');
ok(corrected.images?.[0] === stale.images[0] && corrected.grade === 'NM', 'physical evidence (photos, grade) is preserved');
const again = buildCorrectedCatalogueItem(corrected, { variantNote: VARIANT });
ok(again.supersededResearch?.length === 1 && again.price == null, 'a second correction does not resurrect the superseded price');

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) { failures.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
process.exit(0);
