// GK-272C — RAW MARKET EVIDENCE != DERIVED ECONOMIC AUTHORITY, provenance, and
// condition-prose truthfulness, using the live Classic Comics #13 state as the
// fixture. Run: node tests/gk272c-derived-economics-authority.test.js
import fs from 'node:fs';
import { getDisplayPrice, getAuthorityPrice, isIdentityDisplayGated, describeActiveEvidenceProvenance } from '../src/lib/displayAuthority.js';
import { buildMarketEvidence, deriveMarketCopy } from '../src/lib/marketEvidence.js';
import { guardConditionClaims } from '../src/lib/conditionEvidenceGuard.js';
import { generatePacket, getWhatnotStartingBid } from '../src/lib/marketplacePackets.js';

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

// Live state: conflicted identity, LOCKED, RESEARCH, FALLBACK_ONLY, one active ask ~$59.95,
// rejected sold candidates, price derivations present on the item (the leak source).
const live = () => ({
  id: 'cc13', title: '; CLASSICS ILLUSTRATED; dr Jekyll & Mr. Hyde #13, april', issue: '13', year: 1953,
  identityConfident: false,
  price: '$59.95', priceLow: '$50.96', priceHigh: '$74.94',
  priceBands: { quick: '$50.96', market: '$59.95', stretch: '$74.94', count: 1, source: 'tier3_active_discounted' },
  comps: { source: 'browse_api', count: 1, lowestNum: 59.95, highestNum: 59.95, averageNum: 59.95,
    recentSales: [{ price: 59.95, title: 'Classic Comics #13 Jekyll Hyde', itemWebUrl: 'https://www.ebay.com/itm/227392678399' }] },
  rawComps: { count: 1, lowest: 59.95, prices: [{ price: 59.95, title: 'Classic Comics #13 Jekyll Hyde', url: 'https://www.ebay.com/itm/227392678399' }] },
  soldComps: [], soldCompsRaw: [{ price: 141, date: '2026-08-02', title: 'Classic Comics #13 Jekyll Hyde', marketplace: 'ebay' }],
  soldCompDiagnostics: { rawCount: 1, verifiedCount: 0, rejectedSamples: [{ title: 'Classic Comics #13 Jekyll Hyde', price: 141, reason: 'ungradedTitle' }], reasons: { ungradedTitle: 1 } },
  pricingSource: undefined, // the gated refresh merge preserved a missing value
  decision: { action: 'RESEARCH', blockers: [] },
  contract: { price: null, state: 'LOCKED', actionAuthority: { state: 'LOCKED', identityStanding: 'CONFLICTED', marketStanding: 'FALLBACK_ONLY', reasonCodes: ['IDENTITY_UNRESOLVED'] } },
  gradeMultiplier: 0.3, variantMultiplier: 1.0,
});
const confident = () => ({ ...live(), id: 'ok', identityConfident: true, pricingSource: 'verified_sold',
  contract: { price: 59.95, state: 'PRICED', source: 'verified_sold' }, decision: { action: 'LIST_NOW' } });

console.log('\n— 1. raw ask remains visible (evidence not deleted) —');
const ev = buildMarketEvidence(live());
ok(ev.rows.some((r) => r.evidenceClass === 'ACTIVE_ASK' && r.price === 59.95), 'the ACTIVE_ASK ~$59.95 is still in the evidence payload');
ok(ev.rows.some((r) => r.admissionStanding === 'REJECTED' && r.rejectionReason === 'ungradedTitle'), 'rejected sold candidates remain rejected, with their reason');
ok(live().comps.lowestNum === 59.95 && live().rawComps.count === 1, 'the raw comps object is untouched');
ok(/Active Listings/.test(app) && /Lowest active ask \(reference\)/.test(app), 'static: the active-listings panel and an explicitly-labelled raw ask row remain');

console.log('\n— 2-5. derived outputs do not display under a conflicted identity —');
const g = live();
ok(isIdentityDisplayGated(g), 'live fixture is gated (identityConfident=false)');
ok(getDisplayPrice(g) === 0, '2: recommended/display price → no display (0), even though item.price/priceBands/comps carry $59.95');
ok(getAuthorityPrice(g) === 0, 'listing prefill → 0');
ok(!app.includes('`⚠ Estimate${'), '3: the "⚠ Estimate NN" chip label is gone (it was the 0-100 match score, read as a price)');
ok(/isIdentityDisplayGated\(item\)\s*\?\s*"⚠ Identity unresolved"/.test(app), '3: gated items get "Identity unresolved" on that chip');
ok(/identityGatedItem \? "Lowest active ask \(reference\)" : "Floor"/.test(app), '4: "Floor" is relabelled as a raw ask for a gated item');
ok(/item\.priceBands && item\.contract\?\.state !== 'REFUSED' && !identityGatedItem && \(/.test(app), '5: PRICE BANDS (Quick Sale / Market / Stretch) block is gated');
ok(/!identityGatedItem && item\.price && \(/.test(app), '   PRICE DERIVATION block (incl. "= Final") is gated');
ok(/!identityGatedItem && item\.gradeMultiplier != null/.test(app) && /!identityGatedItem && item\.variantMultiplier != null/.test(app), '   Grade adj / Variant adj derivations are gated');
ok(/!identityGatedItem && item\.claudeCheck && item\.claudeCheck\.recommendation/.test(app), '   RECOMMENDATION block (derives "Market value") is gated');
ok(/const recommendedLabel = isIdentityDisplayGated\(result\)/.test(app), '   ResultCard Recommended (incl. the row inside the comps panel) is gated');

console.log('\n— 6. raw ask does not enter portfolio / value totals; other derived surfaces —');
const total = [g, confident()].reduce((s, c) => s + (getDisplayPrice(c) || 0), 0);
ok(total === 59.95, 'portfolio total counts only the confident item');
ok(generatePacket(g, 'ebay', getDisplayPrice, () => []).error === 'RESEARCH' || generatePacket(g, 'ebay', getDisplayPrice, () => []).error === 'NO_PRICE', 'listing/bundle packet is refused for a gated item (no price built from the ask)');
ok(generatePacket({ ...g, decision: { action: 'LIST_LOW', blockers: [] } }, 'ebay', getDisplayPrice, () => []).error === 'NO_PRICE', 'a gated item with a permissive decision still cannot build a priced packet');
ok(getWhatnotStartingBid(g, getDisplayPrice).startingBid === 1 && getWhatnotStartingBid(g, getDisplayPrice).warning === null, 'Whatnot starting bid is not derived from the ask (default floor only, no ask-based figure)');
const roi = (item) => (item.purchasePrice > 0 && getDisplayPrice(item) > 0 ? ((getDisplayPrice(item) - item.purchasePrice) / item.purchasePrice) * 100 : null);
ok(roi({ ...g, purchasePrice: 20 }) === null, 'ROI is not computed from the ask');

console.log('\n— 7. confident identity still shows allowed derived values —');
const c = confident();
ok(getDisplayPrice(c) === 59.95 && getAuthorityPrice(c) === 59.95, 'confident identity: display + prefill price still work');
ok(!isIdentityDisplayGated(c), 'confident identity is not gated, so bands/floor/adj blocks render as before');

console.log('\n— 8. ask range label and provenance —');
ok(!/`Asking \$\$\{Math\.round\(askLow\)\}`/.test(app) && /Active ask \$\$\{Math\.round\(askLow\)\}/.test(app), 'collection tile says "Active ask", not "Asking"');
ok(/<span>· Active ask \{activeRange\}<\/span>/.test(app), 'stats bar says "Active ask"');
ok(/activeLow && activeHigh && activeLow === activeHigh \? activeLow/.test(app), 'a single-value ask no longer renders "$60–$60"');
ok(describeActiveEvidenceProvenance(g) === 'Source: eBay Browse API — active listings (asking prices, reference only — not sales)', 'provenance for browse_api evidence says eBay active asks, reference only');
ok(describeActiveEvidenceProvenance({ comps: { source: 'mystery' } }) === null && describeActiveEvidenceProvenance({}) === null, 'unknown provenance → null (line suppressed), never "unknown"');
ok(/identityGatedItem\s*\?\s*describeActiveEvidenceProvenance\(item\)/.test(app), 'static: the gated Source line comes from the evidence, not item.pricingSource');
ok(g.pricingSource === undefined && describeActiveEvidenceProvenance(g) !== null, 'with pricingSource absent (the live merge shape) the line is still truthful');
const copy = deriveMarketCopy(g);
ok(/asking prices|no recent realized/i.test(copy.headline + copy.footer), 'market copy remains evidence-derived for the same fixture');

console.log('\n— 9-10. condition prose: front-only, identity-conflicted —');
const reason = 'Heavy wear consistent with a 1940s-era Golden Age copy. General brittleness indicative of age and storage. Corner chipping on all four corners. Moderate creasing along the spine edge of the front cover.';
const cg = guardConditionClaims({ reason, imageCount: 1, year: 1953 });
ok(!/brittl/i.test(cg.reason), '9: brittleness is not emitted as established fact from a front image');
ok(!/storage|indicative of age/i.test(cg.reason), '9: storage history is never emitted');
ok(!/1940s|golden age|era/i.test(cg.reason), '10: a decade/era identity claim cannot appear in condition prose (year 1953 displayed, prose said 1940s)');
ok(/corner chipping/i.test(cg.reason), 'visible front-cover observations survive');
ok(cg.withheld.some((w) => /identity-claim/.test(w.reason)) && cg.withheld.some((w) => /storage history/.test(w.reason)), 'each withheld claim is recorded with its reason');
const cg2 = guardConditionClaims({ reason: 'Brittle edges visible on the interior pages.', imageCount: 2, views: ['FRONT', 'PAGES'], undeclaredImageCount: 0, year: 1953 });
ok(!cg2.changed, 'a declared PAGES view can ground a paper-condition observation');
ok(guardConditionClaims({ reason: 'Brittle paper.', imageCount: 3, year: 1990 }).changed, 'undeclared multiple images still cannot establish brittleness');
ok(!guardConditionClaims({ reason: 'Cover is in an average state with considerable wear.', imageCount: 1 }).changed, '"average" is not mistaken for an era claim');
ok(!guardConditionClaims({ reason: 'Heavy wear and creasing across the front cover.', imageCount: 1, year: 1953 }).changed, 'ordinary front-cover wear prose is untouched');

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
