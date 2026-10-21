// Shared fixtures for the Gate B pricing-coherence tests. Shapes match what the real /api/enrich handler returns (verified 2026-10-21 against the handler:
// comps.count == rawComps.count, rawComps.prices rows {price,title,url,date,condition}, comps.recentSales rows {price,title,itemWebUrl,date,daysAgo,priceFormatted}).
// The five 1:25 titles/prices are the real OML #25 records read from Production on 2026-10-21 (public listing titles); the SIXTH record is NOT stored there and is never invented.

export const OML_FIVE = [
  [15, 'Marvel Comics OLD MAN LOGAN #25 Mike Deodato 1:25 Variant Cover 2017 NM!'],
  [14.99, 'OLD MAN LOGAN #25 - Marvel Comics Mike Deodato Jr 1:25 Variant Cover'],
  [19.99, 'Old Man Logan #25 1:25 Mike Deodato Variant Marvel 2016 VF/NM'],
  [14.99, 'Old Man Logan #25 1:25 Deodato Teaser Variant 2017 NM-/NM'],
  [24.99, 'Old Man Logan #25 - 1:25 Mike Deodato variant Cover - Maestro app - NM- - Marvel'],
];
export const REGULAR_SIXTEEN = Array.from({ length: 16 }, (_, i) => [[5.99, 2.5, 10, 4.24, 4.24, 3.35, 3.99, 9.99, 3.3, 3.96, 2.99, 2.99, 4.63, 5, 6.58, 4.92][i], `Old Man Logan #25 Marvel Comics regular cover copy ${i + 1}`]);

const money = (n) => `$${n.toFixed(2)}`;
export const row = ([price, title], i = 0) => ({ price, title, url: `https://www.ebay.com/itm/4000000${i}`, date: null, condition: null });
export const sale = ([price, title], i = 0) => ({ price, priceFormatted: money(price), title, date: null, daysAgo: null, itemWebUrl: `https://www.ebay.com/itm/4000000${i}` });

/** A COHERENT bundle for `pairs` priced as Tier 3 (average x 0.85), the way the real handler returns it. */
export function coherentBundle(pairs, { variant = '1:25', ratio = '1:25', withVariantEvidence = true } = {}) {
  const ps = pairs.map((p) => p[0]);
  const average = ps.reduce((a, b) => a + b, 0) / ps.length;
  const market = Math.round(average * 0.85 * 100) / 100;
  const quick = Math.round(Math.min(...ps) * 0.85 * 100) / 100;
  const stretch = Math.round(market * 1.15 * 100) / 100;
  return {
    variant,
    price: money(market),
    rawComps: { count: pairs.length, average, lowest: Math.min(...ps), highest: Math.max(...ps), prices: pairs.map(row), evidenceObservedAt: '2026-10-21T00:00:00.000Z' },
    comps: {
      count: pairs.length, average: money(average), averageNum: average, lowest: money(Math.min(...ps)), lowestNum: Math.min(...ps), highest: money(Math.max(...ps)), highestNum: Math.max(...ps),
      recentSales: pairs.slice(0, 5).map(sale), query: 'old man logan #25 1:25 2017 Marvel', source: 'browse_api', fellBack: false, verifiedByAI: false, verificationRemoved: 0,
    },
    priceBands: {
      tier: 3, count: pairs.length, quick: money(quick), market: money(market), stretch: money(stretch), source: 'tier3_active_discounted', variantAdjusted: false,
      ...(withVariantEvidence ? { variantEvidence: { required: true, ratio, variant, applicable: pairs.length, nonVariant: 0, insufficient: false } } : {}),
    },
    priceDerivationTrace: { finalPrice: market },
    // execution-deciding keys (server-owned; carried by the receipt)
    exec: {
      pricingSource: 'active_ask_derived',
      soldCompDiagnostics: { rawCount: 0, verifiedCount: 0, newestDaysAgo: null },
      variantApplicability: 'CONFIRMED',
      decision: { action: 'RESEARCH' },
      matchConfidence: { tier: 'HIGH', score: 90 },
      identityConfident: true,
      contract: { state: 'ESTIMATED', listable: false, locks: [{ code: 'market-standing-no-sold-evidence', severity: 'soft' }] },
    },
  };
}

/** The recorded OML mixed-generation row: `comps` is the final 6-pool pass, rawComps/bands/trace are an older 16-regular-cover pass, the stored price is the 6-pool contract price. */
export function historicalMixedRow() {
  const sixAvg = 17.761666666666667;
  return {
    variant: '1:25',
    price: '$15.10',
    rawComps: { count: 16, average: 4.916875, lowest: 2.5, highest: 10, prices: REGULAR_SIXTEEN.map(row), evidenceObservedAt: '2026-10-16T03:23:23.728Z' },
    comps: {
      count: 6, average: '$17.76', averageNum: sixAvg, lowest: '$14.99', lowestNum: 14.99, highest: '$24.99', highestNum: 24.99,
      recentSales: OML_FIVE.map(sale), query: 'old man logan deodato #25 1:25 2017 Marvel', source: 'browse_api', fellBack: false, verifiedByAI: false, verificationRemoved: 0,
    },
    priceBands: { tier: 3, count: 16, quick: '$2.13', market: '$4.18', stretch: '$4.81', source: 'tier3_active_discounted', variantAdjusted: false },
    priceDerivationTrace: { finalPrice: 4.18 },
    exec: {
      pricingSource: 'active_ask_derived',
      soldCompDiagnostics: { rawCount: 0, verifiedCount: 0, newestDaysAgo: null },
      variantApplicability: 'UNRESOLVED',
      decision: { action: 'RESEARCH' },
      matchConfidence: { tier: 'HIGH', score: 91 },
      identityConfident: true,
      contract: { state: 'ESTIMATED', listable: false, locks: [{ code: 'market-standing-no-sold-evidence', severity: 'soft' }] },
    },
    receiptPoolCount: 6, // what the final pass would have signed
  };
}
