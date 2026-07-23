/**
 * Data Quality Write-Back Guard
 * Principle 2: Better data never replaced by worse
 *
 * Prevents quality degradation when re-scanning books.
 * A verified_sold price ($13.18) should never be overwritten
 * by browse_api ($32) on refresh.
 */

const PRICE_RANK = {
  'verified_sold': 1,
  'verified_active': 2,
  'browse_api': 3,
  'pc_estimate': 4,
  'gocollect': 4,
  'web_search_fallback': 5,
  'ai_estimate': 6,
  'image_search_fallback': 7,
  'refused-no-data-sources': 8,
  'refused-reprint-thin-pool': 8,
  'refused-identity-conflict': 8,
  'refused-claude-gate': 8,
  'refused': 8,
  'identity-required': 9,
  null: 9,
  undefined: 9
};

const GRADE_RANK = {
  'high': 1,
  'HIGH': 1,
  'medium': 2,
  'MEDIUM': 2,
  'low': 3,
  'LOW': 3,
  null: 4,
  undefined: 4
};

/**
 * Choose between incoming and current price based on quality rank.
 * Lower rank = better quality. Preserves current if incoming is worse.
 *
 * @param {object} incoming - new data from enrich API
 * @param {object} current - existing data in catalogue
 * @returns {object} { price, pricingSource, preserved }
 */
export function chooseBetterPrice(incoming, current) {
  const inRank = PRICE_RANK[incoming?.pricingSource] ?? 9;
  const curRank = PRICE_RANK[current?.pricingSource] ?? 9;

  // Lower rank = better. Keep current if incoming is worse.
  if (inRank > curRank && current?.price != null) {
    console.log('[data-guard] PRESERVE', current.pricingSource,
      '$' + current.price, '— rejected', incoming?.pricingSource);
    return {
      price: current.price,
      priceLow: current.priceLow,
      priceHigh: current.priceHigh,
      pricingSource: current.pricingSource,
      priceNote: current.priceNote,
      preserved: true
    };
  }

  return {
    price: incoming?.price ?? current?.price,
    priceLow: incoming?.priceLow ?? current?.priceLow,
    priceHigh: incoming?.priceHigh ?? current?.priceHigh,
    pricingSource: incoming?.pricingSource ?? current?.pricingSource,
    priceNote: incoming?.priceNote ?? current?.priceNote,
    preserved: false
  };
}

/**
 * Choose between incoming and current grade based on confidence rank.
 * Lower rank = better confidence. Preserves current if incoming is worse.
 *
 * @param {object} incoming - new data from enrich API
 * @param {object} current - existing data in catalogue
 * @returns {object} { grade, gradeConfidence, preserved }
 */
export function chooseBetterGrade(incoming, current) {
  const inRank = GRADE_RANK[incoming?.confidenceLevel] ?? 4;
  const curRank = GRADE_RANK[current?.confidenceLevel] ?? 4;

  if (inRank > curRank && current?.grade) {
    console.log('[data-guard] PRESERVE grade', current.grade,
      current.confidenceLevel, '— rejected', incoming?.confidenceLevel);
    return {
      grade: current.grade,
      confidenceLevel: current.confidenceLevel,
      preserved: true
    };
  }

  return {
    grade: incoming?.grade ?? current?.grade,
    confidenceLevel: incoming?.confidenceLevel ?? current?.confidenceLevel,
    preserved: false
  };
}

/**
 * Q135 dispatch (2026-07-22, Lozano/Rachta Lin last-mile) — pool-provisional
 * identity (title-family-refused-provisional, Q131/Q134) means the server's
 * resolved title/issue/year/publisher/variant are honest signals — possibly
 * null when the pool doesn't corroborate a field — that must overwrite the
 * stored record. Every one of the 5 client merge sites in App.jsx builds its
 * updated record with `enrich.X || cur.X` (or omits identity fields from the
 * merge entirely for title/issue/publisher on 2 of the 5) — an OR-fallback
 * or an omission both treat an honest server-side null identically to "no
 * new data," silently keeping Vision's stale, already-rejected scan values
 * on the rendered card. That's true even when api/enrich.js correctly sends
 * `year: null` / `publisher: null` for a provisional card (confirmed via
 * unit test in Q134) — the fix never had a way to reach the screen.
 *
 * Single source of truth, spread into every merge site AFTER its own
 * existing field assignments so it wins on key collision (year/variant are
 * already keys in every merge object; this overrides them only when
 * provisional). Returns {} — a true no-op — for any non-provisional enrich
 * response, so every other card's merge stays byte-identical to before.
 *
 * Q144C dispatch (2026-07-22, Adventure Time #1→#5→#22→#5 drift) — `issue`
 * used bare `enrich.issue ?? null`, which collapses two genuinely different
 * server signals into the same outcome: an EXPLICIT `null` (server resolved
 * this round and honestly found no issue) and an OMITTED key (server never
 * attempted issue resolution this round at all) both nulled the field, with
 * no fallback to the prior stored value either way. On a repeatedly
 * rescanned provisional card, every fresh call's own transient issue guess
 * — never checked for actually being new information — overwrote the card
 * each time, which is what produced the observed drift. Presence-checked via
 * `hasOwnProperty` instead: key present (even if its value is null) is
 * trusted as a fresh, deliberate signal (a real value corrects the stale
 * one; an explicit null clears it) — key absent falls back to the prior
 * stored value instead of nulling it. title/year/publisher/variant are
 * unchanged (out of scope for this dispatch; enrich.js always sets those
 * keys on a provisional response, so no observed bug there).
 *
 * @param {object} enrich - enrich API response
 * @param {object} prior - the existing stored record (cur/s/item, depending on call site)
 * @returns {object} {} when not provisional, else honest title/issue/year/publisher/variant
 */
export function applyProvisionalIdentity(enrich, prior) {
  if (!enrich?.identityProvisional) return {};
  return {
    title: enrich.title ?? enrich.confirmedTitle ?? prior?.title,
    issue: Object.prototype.hasOwnProperty.call(enrich, 'issue') ? enrich.issue : (prior?.issue ?? null),
    year: enrich.year ?? null,
    publisher: enrich.publisher ?? null,
    variant: enrich.variantNote ?? null,
  };
}
