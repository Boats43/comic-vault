// GK-271 — Multi-source market evidence foundation: unit/static proof.
// Run: node tests/gk271-market-evidence-foundation.test.js
import fs from 'node:fs';
import {
  EVIDENCE_CLASS, normalizePcSoldRow, normalizeActiveAsk, normalizeLadderEntry,
  buildMarketEvidence, deriveMarketCopy, NEUTRAL_MARKET_FOOTER,
} from '../src/lib/marketEvidence.js';
import { isUnconfirmedCountryClaim, deriveEditionStanding } from '../src/lib/editionAuthority.js';
import { guardConditionClaims } from '../src/lib/conditionEvidenceGuard.js';
import { evidenceIntegrityViolations, getMarketEvidence } from '../src/lib/marketEvidence.js';

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };

console.log('\n— normalization: classes stay distinct —');
const pcEbay = { price: 41.5, date: '2026-08-02', title: 'Classic Comics #13 Jekyll Hyde CGC 1.0', url: 'https://www.ebay.com/itm/123456789012', marketplace: 'ebay' };
const pcHer = { price: 900, date: '2026-05-01', title: 'Classic Comics #13 HRN 20', url: 'https://comics.ha.com/itm/x', marketplace: 'heritage' };
const sold = normalizePcSoldRow(pcEbay, { admitted: true });
const ask = normalizeActiveAsk({ price: 55, title: 'Classic Comics 13 Canadian', url: 'https://www.ebay.com/itm/9' });
const lad = normalizeLadderEntry('1.0', 12);
ok(sold.evidenceClass === EVIDENCE_CLASS.REALIZED_SALE, 'PC sold row → REALIZED_SALE');
ok(ask.evidenceClass === EVIDENCE_CLASS.ACTIVE_ASK && ask.saleDate === null, 'eBay listing → ACTIVE_ASK with no sale date');
ok(lad.evidenceClass === EVIDENCE_CLASS.STRUCTURED_HISTORICAL, 'PC ladder guide → STRUCTURED_HISTORICAL (not a sale)');
ok(sold.evidenceClass !== ask.evidenceClass && lad.evidenceClass !== sold.evidenceClass, 'REALIZED_SALE / ACTIVE_ASK / guide are three distinct classes');
ok(sold.providerRecordId === '123456789012', 'eBay item id extracted as providerRecordId');
ok(ask.country === 'CANADA', 'country read from a COMP ROW title is recorded on that row (row fact, not our book)');

console.log('\n— Heritage through PriceCharting keeps provider AND provenance —');
const her = normalizePcSoldRow(pcHer, { admitted: false, rejectionReason: 'printing-mismatch' });
ok(her.provider === 'HERITAGE' && her.sourceThrough === 'PRICECHARTING', 'provider=HERITAGE, sourceThrough=PRICECHARTING');
ok(her.hrn === '20', 'HRN parsed from row title');
ok(normalizePcSoldRow({ price: 5, date: '2026-01-01', title: 'x' }).provider === 'UNATTRIBUTED', 'unknown marketplace stays UNATTRIBUTED (unknown remains unknown)');
const { inventory: invH } = buildMarketEvidence({ soldComps: [pcEbay], soldCompsRaw: [pcEbay, pcHer] });
ok(invH.heritageThroughPriceCharting === 1 && invH.exactRealized === 1 && invH.notAdmittedRealized === 1, 'inventory: 1 admitted, 1 not admitted, 1 Heritage-through-PC');

console.log('\n— UI copy follows evidence —');
const noSold = deriveMarketCopy({ soldCompDiagnostics: { rawCount: 0, verifiedCount: 0 } });
ok(noSold.state === 'NO_SOLD' && noSold.headline === 'No recent realized sales confirmed for this exact printing.', 'no evidence → NO_SOLD copy');
ok(!/eBay sales/i.test(noSold.headline) && !/eBay sales/i.test(noSold.footer), 'no hardcoded "eBay sales" wording');
const activeOnly = deriveMarketCopy({ rawComps: { prices: [{ price: 50, title: 'a' }, { price: 60, title: 'b' }] }, soldCompDiagnostics: { rawCount: 0, verifiedCount: 0 } });
ok(activeOnly.state === 'ACTIVE_ONLY' && activeOnly.headline === 'Current asking prices found; no exact realized sale confirmed.', 'no exact sold + active asks → ACTIVE_ONLY');
ok(/not sold prices/i.test(activeOnly.footer), 'footer says asks are not sold prices');
const similar = deriveMarketCopy({
  contract: { actionAuthority: { marketStanding: 'SIMILAR_ONLY' } },
  soldComps: [], soldCompsRaw: [pcHer],
  soldCompDiagnostics: { rawCount: 3, verifiedCount: 0, reasons: { printingMismatch: 3 } },
});
ok(similar.state === 'SIMILAR_ONLY' && similar.headline === 'Recent sales exist for similar printings or editions.', 'SIMILAR_ONLY surfaces similar evidence');
ok(similar.detail === 'No realized sale is confirmed for this exact printing.', 'SIMILAR_ONLY states exact is NOT confirmed');
ok(similar.inventory.exactRealized === 0, 'similar evidence is NOT promoted into exact');
const exact = deriveMarketCopy({ contract: { actionAuthority: { marketStanding: 'EXACT_CURRENT' } }, soldComps: [pcEbay], soldCompDiagnostics: { rawCount: 1, verifiedCount: 1, newestDaysAgo: 30 } });
ok(exact.state === 'EXACT_CURRENT' && exact.footer.startsWith('Estimate based on admitted recent sold-market evidence'), 'EXACT_CURRENT copy + footer');
const exactNoRows = deriveMarketCopy({ contract: { actionAuthority: { marketStanding: 'EXACT_CURRENT' } }, soldComps: [] });
ok(exactNoRows.state !== 'EXACT_CURRENT', 'standing alone cannot claim exact without admitted rows (copy only gets MORE conservative)');
const aiOnly = deriveMarketCopy({ priceLow: '$10', priceHigh: '$20' });
ok(aiOnly.state === 'AI_ONLY' && aiOnly.headline === 'No verified market transaction evidence found.' && aiOnly.aiRangeLabel === 'AI context (unverified)', 'AI context only → labelled, never verified');
const ladOnly = deriveMarketCopy({ priceLadder: { '1.0': 12, raw: 8 } });
ok(ladOnly.state === 'STRUCTURED_ONLY', 'guide ladder alone is not a realized sale');
ok(new Set([noSold, activeOnly, similar, exact, aiOnly].map((c) => c.footer)).size === 5, 'footer differs per evidence state');
ok(!/derived from recent eBay sales data/.test(NEUTRAL_MARKET_FOOTER), 'neutral footer makes no single-source claim');

console.log('\n— static: hardcoded copy is gone from App.jsx —');
const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
ok(!app.includes('No recent eBay sales found'), 'App.jsx no longer hardcodes "No recent eBay sales found"');
ok(!app.includes('Price estimated from AI market knowledge'), 'App.jsx no longer hardcodes "Price estimated from AI market knowledge"');
ok(!app.includes('derived from recent eBay sales data'), 'App.jsx footer no longer always claims eBay sales data');
ok(app.includes('deriveMarketCopy(result).footer'), 'footer derives from the scan result evidence');

console.log('\n— edition authority: Vision-only country claim —');
ok(isUnconfirmedCountryClaim('Canadian edition', null), 'Vision "Canadian edition" with cleared confirmedVariant → unconfirmed');
ok(isUnconfirmedCountryClaim('Canadian price variant', 'exclusive'), 'confirmedVariant without the country claim → unconfirmed');
ok(!isUnconfirmedCountryClaim('Canadian price variant', 'Canadian price variant'), 'reconciler-confirmed country claim is NOT blocked');
ok(!isUnconfirmedCountryClaim('Whitman variant', null), 'non-country variants are untouched');
ok(deriveEditionStanding({ rawVariant: 'Canadian edition', confirmedVariant: null }).editionStanding === 'UNRESOLVED', 'editionStanding UNRESOLVED from Vision text alone');
ok(deriveEditionStanding({ foreignEditionFlag: true }).editionStanding === 'UNRESOLVED' && deriveEditionStanding({ foreignEditionFlag: true }).country === null, 'foreignEdition=true alone → UNRESOLVED, country null');
ok(deriveEditionStanding({}).editionStanding === 'NOT_CLAIMED', 'no claim → NOT_CLAIMED');
const enrichSrc = fs.readFileSync(new URL('../api/enrich.js', import.meta.url), 'utf8');
ok(/isUnconfirmedCountryClaim\(variantRawForMult, confirmedVariant\)/.test(enrichSrc), 'enrich.js multiplier site consults the country-claim guard');

console.log('\n— condition evidence guard —');
const reason = 'Severe staple failure with visible popping. Heavy corner chipping on all four corners. Significant polybag indentation damage across the front and back covers. Overall heavy wear and color fading.';
const g1 = guardConditionClaims({ reason, imageCount: 1, year: 1943, cgcPenaltyFlags: { polybagIndents: { detected: true }, staplePopping: { detected: true, severity: 'severe' } } });
ok(!/staple/i.test(g1.reason), 'front-only: staple/spine claim withheld');
ok(!/polybag|back covers/i.test(g1.reason), 'pre-1980 book: polybag claim withheld');
ok(/corner chipping/i.test(g1.reason) && /heavy wear/i.test(g1.reason), 'front-visible claims (corners, wear) are kept');
ok(g1.cgcPenaltyFlags.polybagIndents.detected === false && g1.cgcPenaltyFlags.polybagIndents.rejectedByEraGate === true, 'polybag flag rejected by era gate');
ok(g1.cgcPenaltyFlags.staplePopping.detected === false && g1.cgcPenaltyFlags.staplePopping.rejectedByViewGate === true, 'front-only: staplePopping flag rejected by the view gate (needs SPINE)');
ok(g1.withheld.length >= 2 && g1.withheld.every((w) => w.claim && w.reason), 'withheld claims are recorded with reasons, not silently dropped');
const g2 = guardConditionClaims({ reason: 'Back cover shows a crease. Spine has stress lines.', imageCount: 2, year: 1985 });
ok(g2.changed === false, 'multiple undeclared images: claims stand (cannot be disproven)');
const g3 = guardConditionClaims({ reason: 'Back cover shows a crease. Spine has stress lines. Front has a tear.', imageCount: 2, views: ['FRONT'], year: 1985 });
ok(!/back cover|spine/i.test(g3.reason) && /front has a tear/i.test(g3.reason), 'declared FRONT-only views withhold back/spine claims');
const g4 = guardConditionClaims({ reason: 'Back cover shows a crease.', imageCount: 2, views: ['FRONT', 'BACK'], year: 1985 });
ok(g4.changed === false, 'declared BACK view grounds a back-cover claim');
ok(!guardConditionClaims({ reason: 'Polybag indentation on front.', imageCount: 2, year: 1995 }).changed, 'plausible-era polybag claim with multiple images stands');

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
