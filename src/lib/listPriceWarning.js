// Ship #15 — FR-LIST-PRICE-WARNING.
//
// Pure helper. Given a user-edited list price and the current item state,
// returns a structured warning when the list price exceeds market
// thresholds — or null when the price is within band.
//
// Three independent triggers; helper returns the most severe match
// (highest pctOver) when multiple fire so the UI surfaces the worst:
//
//   A — engine: listPrice > item.price × 1.25
//       (25% over the engine's recommended price)
//   B — high:   listPrice > item.comps.highestNum × 1.20
//       (20% over the highest comp on the market)
//   C — avg:    listPrice > item.comps.averageNum × 1.50
//       (50% over the 30-day market average)
//
// Skip when the engine deliberately set a high price — these are
// engine-authoritative, not user over-reach:
//   item.megaKeyFloorApplied / manualReviewRequired / gradeExceedsMap
//
// Engine rec source is RAW `item.price` (no getDisplayPrice fallback).
// If item.price is empty / 0, trigger A simply does not fire — B and C
// still cover the no-engine case via comp data when present.
//
// Returns:
//   { listPrice, triggered: ['engine'|'high'|'avg', ...], worst: { kind,
//     anchor, label, pctOver } }
//   or null when no trigger or input unsafe.
//
// Pure — no side effects, deterministic given inputs.
//
// Location note: lives under src/lib/ rather than api/ because every
// .js file in api/ becomes its own Vercel serverless function endpoint
// (Hobby plan limit: 12). This is a UI-only helper with no HTTP handler,
// so api/ would waste a function slot. Tests still import directly.

const TRIGGERS = [
  { kind: 'engine', label: 'engine recommendation', mult: 1.25, source: (it) =>
      parseFloat(String(it?.price || '0').replace(/[$,]/g, '')) || 0 },
  { kind: 'high', label: 'market high', mult: 1.20, source: (it) =>
      Number(it?.comps?.highestNum) || 0 },
  { kind: 'avg', label: '30-day average', mult: 1.50, source: (it) =>
      Number(it?.comps?.averageNum) || 0 },
];

export const computeListPriceWarning = (listPrice, item) => {
  const lp =
    typeof listPrice === 'number'
      ? listPrice
      : parseFloat(String(listPrice || '').replace(/[$,]/g, ''));
  if (!(lp > 0)) return null;
  if (!item || typeof item !== 'object') return null;

  // Engine-deliberate-high cases: skip entirely. Engine set the floor;
  // user is anchoring above it intentionally (or required to).
  if (item.megaKeyFloorApplied) return null;
  if (item.manualReviewRequired) return null;
  if (item.gradeExceedsMap) return null;

  const triggered = [];
  for (const t of TRIGGERS) {
    const anchor = t.source(item);
    if (!(anchor > 0)) continue;
    if (lp > anchor * t.mult) {
      triggered.push({
        kind: t.kind,
        label: t.label,
        anchor,
        pctOver: Math.round(((lp / anchor) - 1) * 100),
      });
    }
  }
  if (triggered.length === 0) return null;

  const worst = triggered.reduce((a, b) => (b.pctOver > a.pctOver ? b : a));
  return {
    listPrice: lp,
    triggered: triggered.map((t) => t.kind),
    worst,
  };
};
