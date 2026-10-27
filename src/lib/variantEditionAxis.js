// C3-R4 — HARD VARIANT-EDITION AXIS. Pure; no I/O; no pricing math.
//
// Evidence (Production, Avengers #4 (2023) Alex Ross Connecting VIRGIN variant, COLOR): the comp filter's generic
// token "virgin" ran in `mode=any`, so B&W / sketch virgin editions (a different, more expensive physical
// edition) and trade-dress connecting covers entered the exact pool and set the price. Three physical editions
// are DISTINCT and mutually exclusive:
//   COLOR_VIRGIN   - full-colour virgin (no title text) cover
//   BW_SKETCH      - black-and-white / sketch / line-art / pencil virgin edition
//   TRADE_DRESS    - the cover WITH trade dress (logo/barcode/title)
// "Virgin" alone cannot establish exact equivalence: a listing that says only "virgin" does not say which
// edition it is, so it is NEARBY-FAMILY (labelled), never exact.

export const EDITION_KIND = {
  COLOR_VIRGIN: 'COLOR_VIRGIN',
  BW_SKETCH: 'BW_SKETCH',
  TRADE_DRESS: 'TRADE_DRESS',
};

const BW_SKETCH_RE = /\b(?:b\s*(?:&|and|\/|n)\s*w|black\s*(?:&|and|\/|n)?\s*white|monochrome|sketch(?:es)?|line\s*art|pencils?)\b/i;
const VIRGIN_RE = /\bvirgin\b/i;
const COLOR_RE = /\b(?:colou?r|colou?red|full\s*colou?r)\b/i;
const TRADE_DRESS_RE = /\b(?:trade\s*dress|with\s*(?:logo|title)|logo\s*cover)\b/i;
const CONNECTING_RE = /\bconnecting\b/i;

/** Classify TEXT (a variant string or a listing title) on the edition axis. Booleans only - no guessing. */
export function readEditionSignals(text) {
  const t = String(text || '');
  const bw = BW_SKETCH_RE.test(t);
  return {
    virgin: VIRGIN_RE.test(t),
    bw,
    color: COLOR_RE.test(t) && !bw,
    tradeDress: TRADE_DRESS_RE.test(t),
    connecting: CONNECTING_RE.test(t),
  };
}

/**
 * The edition our OWN (operator/physical-evidence-confirmed) variant string pins, or null when it does not pin
 * one of the three (then this axis does not apply and the existing filter chain is untouched).
 */
export function targetEditionKind(variant) {
  const s = readEditionSignals(variant);
  if (s.bw) return EDITION_KIND.BW_SKETCH;
  if (s.virgin) return EDITION_KIND.COLOR_VIRGIN; // a virgin that is not B&W/sketch is the colour virgin
  if (s.tradeDress) return EDITION_KIND.TRADE_DRESS;
  return null;
}

/**
 * Where a listing sits relative to a target edition.
 *   EXACT      - affirmatively the same edition
 *   NEARBY     - same family but cannot be confirmed as the same edition (labelled; never prices the exact book)
 *   EXCLUDED   - affirmatively a DIFFERENT, mutually exclusive edition
 */
export function placeListing(title, targetKind) {
  const s = readEditionSignals(title);
  if (targetKind === EDITION_KIND.COLOR_VIRGIN) {
    if (s.bw) return { place: 'EXCLUDED', reason: 'bw-sketch-edition' };
    if (s.tradeDress && !s.virgin) return { place: 'EXCLUDED', reason: 'trade-dress-edition' };
    if (s.virgin && s.color) return { place: 'EXACT', reason: 'color-virgin-stated' };
    if (s.virgin) return { place: 'NEARBY', reason: 'virgin-colour-unstated' };
    if (s.connecting) return { place: 'NEARBY', reason: 'connecting-edition-unstated' };
    return { place: 'EXCLUDED', reason: 'not-a-virgin-edition' };
  }
  if (targetKind === EDITION_KIND.BW_SKETCH) {
    if (s.bw) return { place: 'EXACT', reason: 'bw-sketch-stated' };
    if (s.color || s.tradeDress) return { place: 'EXCLUDED', reason: 'colour-or-trade-dress-edition' };
    if (s.virgin) return { place: 'NEARBY', reason: 'virgin-colour-unstated' };
    return { place: 'EXCLUDED', reason: 'not-a-sketch-edition' };
  }
  if (targetKind === EDITION_KIND.TRADE_DRESS) {
    if (s.virgin || s.bw) return { place: 'EXCLUDED', reason: 'virgin-or-bw-edition' };
    if (s.tradeDress) return { place: 'EXACT', reason: 'trade-dress-stated' };
    return { place: 'NEARBY', reason: 'trade-dress-unstated' };
  }
  return { place: 'NEARBY', reason: 'no-target-edition' };
}

/**
 * Partition a comp pool for a target variant. Returns null when the axis does not apply.
 * `exact` alone may price the exact edition; `nearby` is returned separately and labelled; `excluded` is kept
 * (I13: shown with its reason) but never priced.
 */
export function partitionByEdition(pool, variant) {
  const kind = targetEditionKind(variant);
  if (!kind || !Array.isArray(pool)) return null;
  const exact = []; const nearby = []; const excluded = [];
  for (const it of pool) {
    const { place, reason } = placeListing(it?.title, kind);
    if (place === 'EXACT') exact.push(it);
    else if (place === 'NEARBY') nearby.push({ ...it, editionNote: reason });
    else excluded.push({ title: it?.title ?? null, price: it?.price ?? null, reason });
  }
  return { kind, exact, nearby, excluded };
}

const KIND_LABEL = {
  COLOR_VIRGIN: 'colour virgin',
  BW_SKETCH: 'black-and-white / sketch virgin',
  TRADE_DRESS: 'trade-dress',
};

/**
 * C3-R4/R8 - the truthful sentence for a sparse exact pool. Active listings are ASKING prices, never sold
 * evidence; the sentence says how many affirm the exact edition and how many other-edition listings were kept out.
 */
export function describeEditionAxis(axis) {
  if (!axis || !axis.kind) return null;
  const k = KIND_LABEL[axis.kind] || axis.kind;
  const n = axis.exactCount || 0;
  const other = (axis.excludedCount || 0);
  const nearby = axis.nearbyCount || 0;
  const head = n > 0
    ? `${n} active listing${n === 1 ? '' : 's'} (asking price, not a sold price) affirm the exact ${k} edition`
    : `No listing affirms the exact ${k} edition`;
  const tail = [
    other > 0 ? `${other} other-edition listing${other === 1 ? '' : 's'} excluded` : null,
    nearby > 0 ? `${nearby} nearby-family listing${nearby === 1 ? '' : 's'} unconfirmed` : null,
  ].filter(Boolean).join('; ');
  return tail ? `${head}; ${tail}.` : `${head}.`;
}
