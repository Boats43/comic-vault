// GK-271b — evidence contract closeout: ACTIVE_ASK/REALIZED_SALE separation,
// server-payload authority, declared capture views, and the static proof that
// condition flags have no path to grade or price.
// Run: node tests/gk271b-evidence-contract.test.js
import fs from 'node:fs';
import {
  normalizePcSoldRow, buildMarketEvidence, deriveMarketCopy,
  evidenceIntegrityViolations, getMarketEvidence,
} from '../src/lib/marketEvidence.js';
import { guardConditionClaims } from '../src/lib/conditionEvidenceGuard.js';

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

const pcEbay = { price: 41.5, date: '2026-08-02', title: 'Classic Comics #13 Jekyll Hyde', url: 'https://www.ebay.com/itm/123456789012', marketplace: 'ebay' };
const pcHer = { price: 900, date: '2026-05-01', title: 'Classic Comics #13 HRN 20', url: 'https://comics.ha.com/itm/x', marketplace: 'heritage' };

console.log('\n— ACTIVE_ASK can never become REALIZED_SALE, whatever the container is called —');
const legacyDated = { price: 55, title: 'Classic Comics 13', date: '2026-09-01T00:00:00Z', daysAgo: 30, itemWebUrl: 'https://www.ebay.com/itm/555555555555' };
const viaRecent = buildMarketEvidence({ comps: { source: 'browse_api', recentSales: [legacyDated] } });
ok(viaRecent.rows.length === 1 && viaRecent.rows[0].evidenceClass === 'ACTIVE_ASK' && viaRecent.rows[0].saleDate === null, 'dated legacy recentSales row → ACTIVE_ASK, saleDate dropped');
const viaRaw = buildMarketEvidence({ rawComps: { prices: [{ ...legacyDated, url: 'x' }] } });
ok(viaRaw.rows.every((r) => r.evidenceClass === 'ACTIVE_ASK'), 'rawComps.prices rows → ACTIVE_ASK');
ok(viaRecent.inventory.exactRealized === 0 && viaRecent.inventory.activeAsks === 1, 'legacy recentSales active asks never count as sold evidence');
ok(buildMarketEvidence({ comps: { source: 'finding_api', recentSales: [legacyDated] } }).rows.length === 0, 'a Finding-sourced container is not silently relabelled as either class');
ok(evidenceIntegrityViolations([{ evidenceClass: 'REALIZED_SALE', saleDate: null, price: 5 }]).length === 1, 'integrity check flags a REALIZED_SALE row without a sale date');
ok(evidenceIntegrityViolations([{ evidenceClass: 'ACTIVE_ASK', saleDate: '2026-01-01' }]).length === 1, 'integrity check flags an ACTIVE_ASK row carrying a sale date');
ok(evidenceIntegrityViolations([{ provider: 'HERITAGE', sourceThrough: null, evidenceClass: 'REALIZED_SALE', saleDate: 'x', price: 1 }]).length === 1, 'integrity check flags Heritage with no sourceThrough');

console.log('\n— payload shape and server authority —');
const maxed = buildMarketEvidence({ rawComps: { prices: Array.from({ length: 80 }, (_, i) => ({ price: 10 + i, title: 'a' + i })) } });
ok(maxed.rows.length === 10 && maxed.inventory.activeAsks === 80, 'persisted rows are capped but the inventory counts the full pool');
const rej = buildMarketEvidence({
  soldComps: [], soldCompsRaw: [pcHer],
  soldCompDiagnostics: { rawCount: 1, verifiedCount: 0, rejectedSamples: [{ title: pcHer.title, price: 900, reason: 'printingMismatch' }], reasons: { printingMismatch: 1 } },
});
ok(rej.rows[0].rejectionReason === 'printingMismatch' && rej.rows[0].matchStanding === 'SIMILAR', 'per-row rejection reason is carried; a printing mismatch is SIMILAR, not exact');
ok(rej.rows[0].provider === 'HERITAGE' && rej.rows[0].sourceThrough === 'PRICECHARTING', 'rejected Heritage row keeps provider + sourceThrough');
const srv = { version: 1, rows: [], inventory: { exactRealized: 0, admittedSimilarRealized: 0, notAdmittedRealized: 0, similarEditionRealized: 0, activeAsks: 2, structuredReferences: 0, hasReference: false, hasAiContext: false } };
ok(getMarketEvidence({ normalizedEvidence: srv, rawComps: { prices: [] } }) === srv, 'server payload wins over local re-derivation');
ok(deriveMarketCopy({ normalizedEvidence: srv }).state === 'ACTIVE_ONLY', 'UI copy follows the SERVER inventory');
const disputed = buildMarketEvidence({ variantApplicability: 'UNVERIFIED', soldComps: [pcEbay], soldCompDiagnostics: { rawCount: 1, verifiedCount: 1 } });
ok(disputed.inventory.exactRealized === 0 && disputed.inventory.admittedSimilarRealized === 1, 'admitted rows under a disputed edition facet are SIMILAR, never exact');
ok(deriveMarketCopy({ variantApplicability: 'UNVERIFIED', soldComps: [pcEbay], soldCompDiagnostics: { rawCount: 1, verifiedCount: 1 } }).state === 'SIMILAR_ONLY', 'disputed-edition admitted sales surface as SIMILAR_ONLY copy');
ok(normalizePcSoldRow(pcHer).sourceThrough === 'PRICECHARTING', 'PC-mediated Heritage is never represented as a direct Heritage integration');

console.log('\n— declared capture views + staple gate —');
const gs = guardConditionClaims({ reason: 'Staples are rusted.', imageCount: 2, views: ['FRONT', 'SPINE'], undeclaredImageCount: 0, year: 1985, cgcPenaltyFlags: { staplePopping: { detected: true, severity: 'minor' } } });
ok(gs.cgcPenaltyFlags.staplePopping.detected === true && !gs.changed, 'declared SPINE view grounds the staple claim and flag');
const gp = guardConditionClaims({ reason: 'Back cover crease.', imageCount: 3, views: ['FRONT'], undeclaredImageCount: 2, year: 1985, cgcPenaltyFlags: { staplePopping: { detected: true } } });
ok(!gp.changed && gp.cgcPenaltyFlags.staplePopping.detected === true, 'partially-declared set: unverifiable claims stand (view never inferred from count/order)');
const gf = guardConditionClaims({ reason: '', imageCount: 1, year: 1985, cgcPenaltyFlags: { staplePopping: { detected: true } } });
ok(gf.cgcPenaltyFlags.staplePopping.detected === false && gf.cgcPenaltyFlags.staplePopping.rejectedByViewGate === true, 'flag gating works with no prose at all (watch-mode shape)');
const gb = guardConditionClaims({ reason: 'Back cover shows a crease.', imageCount: 2, views: ['FRONT', 'SPINE'], undeclaredImageCount: 0, year: 1985 });
ok(gb.changed && !/back cover/i.test(gb.reason), 'fully-declared FRONT+SPINE cannot support a BACK-only defect');

console.log('\n— condition flags have NO path to grade or price (static proof) —');
const enrichSrc = read('../api/enrich.js');
const gradeSrc = read('../api/grade.js');
ok(!/cgcPenaltyFlags|defectPenalty/.test(enrichSrc), 'api/enrich.js (all pricing math) never reads cgcPenaltyFlags or defectPenalty');
const libFiles = ['pricingEngine.js', 'decisionEngine.js', 'responseContract.js', 'priceBands.js', 'identityCore.js', 'actionAuthority.js'];
ok(libFiles.every((f) => !/cgcPenaltyFlags|defectPenalty/.test(read('../src/lib/' + f))), 'no pricing/decision/contract library reads cgcPenaltyFlags or defectPenalty');
ok((gradeSrc.match(/applyConditionGuard\(/g) || []).length >= 3 && /parseImageViews/.test(gradeSrc), 'all three grade response paths (watch, eBay-first, vision fallback) run the guard; imageViews is parsed server-side');
ok(/imageViews/.test(read('../src/App.jsx')), 'client sends operator-declared imageViews (addPhotoToComic)');

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
