// Ship #20a.6.4 — refuse-to-price when identity uncertain (Layer A trust gate).
//
// Vision's JSON_SHAPE in api/grade.js forces non-nullable price/priceLow/
// priceHigh strings. When Vision can't confidently identify a book, it
// returns uncertainty strings ("Cannot determine from visible cover")
// or year ranges ("1940s-1950s") in the identity fields AND still produces
// a price guess. Without this gate, that guess persists through the
// client merge ("enrich.price || cur.price") and renders to the user.
//
// Surfaced 2026-04-27 via Donald Duck Whitman #978: priced $50 with no
// verified ID. Real Golden Age key in same shape would be 10× wrong.
//
// LOCATION NOTE: pure helper, no HTTP handler. Per Ship #15 architectural
// rule, helpers used by both api/* and src/* live in src/lib/. Vercel
// bundles transitively when imported by api/enrich.js. Keeps function
// count at 12/12.

// Patterns indicating Vision returned uncertainty rather than a value.
// Case-insensitive. Substring match — "could not determine" matches because
// "cannot\s+determine" is the pinned phrasing in current Vision output.
const UNCERTAINTY_PATTERNS = [
  /cannot\s+determine/i,
  /could\s+not\s+determine/i,
  /unable\s+to\s+(?:determine|read|identify)/i,
  /\bunclear\b/i,
  /\bnot\s+visible\b/i,
  /\billegible\b/i,
  /\bapproximately\b/i,
  /\bcirca\b/i,
  /\bunknown\b/i,
  /\bn\/a\b/i,
];

const isUncertaintyString = (s) => {
  if (typeof s !== 'string') return false;
  const trimmed = s.trim();
  if (!trimmed) return false;
  if (/^\?+$/.test(trimmed)) return true;
  if (/^-+$/.test(trimmed)) return true;
  return UNCERTAINTY_PATTERNS.some((re) => re.test(trimmed));
};

// Strict 4-digit year, 1900-2100 inclusive. Rejects ranges, decades,
// circa, question-marked years.
const isCleanYearString = (s) => {
  if (typeof s !== 'string') return false;
  if (!/^\d{4}$/.test(s)) return false;
  const n = parseInt(s, 10);
  return n >= 1900 && n <= 2100;
};

// Sanitize identity fields by nulling out uncertainty/range strings.
// Returns a new object; original input untouched.
//
// Per Ship #20a.6.4 refinement B: consumers should pass POST-derive values
// (correctedIssue, confirmedYear) so the PC/CV year-healing chain has
// already run. This avoids gating books where Vision said "1970s" but
// PriceCharting healed to 1972.
//
// Field rules:
//   title       — uncertainty → null; otherwise trimmed non-empty string.
//   issue       — must be numeric (123 / "123" / "1.5"); otherwise null.
//   year        — strict 4-digit string in [1900, 2100]; otherwise null.
//   publisher   — uncertainty → null; otherwise trimmed non-empty string.
//   author      — Session 4B: uncertainty → null; otherwise trimmed non-empty string.
//   visionConfidence — normalized to 'high' | 'medium' | 'low' | null.
export const sanitizeIdentityFields = (input) => {
  const out = { title: null, issue: null, year: null, publisher: null, author: null, visionConfidence: null };
  if (!input || typeof input !== 'object') return out;

  // title
  if (typeof input.title === 'string') {
    const t = input.title.trim();
    if (t && !isUncertaintyString(t)) out.title = t;
  }

  // issue — accept number or numeric string
  if (input.issue != null) {
    const s = String(input.issue).trim();
    // Ship 15 — Accept treasury/annual/special issue formats.
    //
    // Production data 2026-05-05: Limited Collectors' Edition #C-44 (Batman
    // Treasury, 1976) refused with "issue number missing or non-numeric"
    // despite having $15-$58 active comps. Whole format (DC treasuries +
    // annuals + specials + magazines with letter codes) was excluded by
    // overly-strict numeric-only regex.
    //
    // Accepted formats:
    //   Pure numeric:    "1", "123", "1.5"           (existing)
    //   Treasury:        "C-44", "F-21", "P-1", "R-12"
    //   Letter suffix:   "1A", "100B", "606Z"
    //   Year special:    "'85", "'92"
    //   Annual/Special:  "Annual 1", "Special 1", "Giant-Size 1", "King-Size 1"
    //   No-number:       "nn"
    //
    // Still rejected: empty strings, pure letters ("ABC"), uncertainty
    // markers ("?", "unknown", etc.) — handled by isUncertaintyString.
    const isAcceptableIssue = (str) => {
      // Pure numeric (existing behavior preserved)
      if (/^\d+(\.\d+)?$/.test(str)) return true;
      // Treasury format: letter-dash-digits (C-44, F-21, P-1, R-12)
      if (/^[A-Z]-\d+$/i.test(str)) return true;
      // Letter suffix: digits-letter (1A, 100B, 606Z)
      if (/^\d+[A-Z]$/i.test(str)) return true;
      // Year special: apostrophe-2-digits ('85, '92)
      if (/^'\d{2}$/.test(str)) return true;
      // Annual/Special/Giant-Size/King-Size + number
      if (/^(?:annual|special|giant[\s-]?size|king[\s-]?size)\s*#?\s*\d+$/i.test(str)) return true;
      // No-number placeholder (one-shots, undated specials)
      if (/^nn$/i.test(str)) return true;
      return false;
    };
    if (s && !isUncertaintyString(s) && isAcceptableIssue(s)) {
      out.issue = s;
    }
  }

  // year — accept number or numeric string
  if (input.year != null) {
    const s = String(input.year).trim();
    if (s && !isUncertaintyString(s) && isCleanYearString(s)) {
      out.year = s;
    }
  }

  // publisher
  if (typeof input.publisher === 'string') {
    const p = input.publisher.trim();
    if (p && !isUncertaintyString(p)) out.publisher = p;
  }

  // author — Session 4B: book identity field
  if (typeof input.author === 'string') {
    const a = input.author.trim();
    if (a && !isUncertaintyString(a)) out.author = a;
  }

  // visionConfidence — normalize 'high'/'medium'/'low'; anything else null
  if (typeof input.visionConfidence === 'string') {
    const v = input.visionConfidence.trim().toLowerCase();
    if (v === 'high' || v === 'medium' || v === 'low') {
      out.visionConfidence = v;
    }
  }

  return out;
};

// Assess identity confidence on sanitized fields. Returns
//   { confident: boolean, missingFields: string[], reasons: string[] }
//
// Session 4B — Adapter-aware identity confidence.
// Required fields vary by asset type (from adapterRegistry):
//   - Comic: title, issue, year, publisher
//   - Book: title, author, year
//   - Card: player, year, cardNumber, set
//
// Publisher is optional when identitySource includes 'ebay' (visual confirmation).
// visionConfidence must NOT be 'low' (null/medium/high all OK).
//
// External-lookup signals (PriceCharting / ComicVine / eBay match) are
// NOT consulted. Per Ship #20a.6.4 refinement A: legit indie items may
// fail all external lookups while being cleanly identified by Vision.
export const assessIdentityConfidence = (sanitized, identitySource, identityFields = ['title', 'issue', 'year', 'publisher'], pcProductId = null) => {
  const missingFields = [];
  const reasons = [];

  // Check each required field from adapter config
  for (const field of identityFields) {
    // Publisher gets special skip logic for visual/manual sources
    // Crow Dead Time fix: Broadened to cover ANY identitySource where the book
    // was resolved via eBay-based signals (visual search, title-family clustering)
    // OR where PC successfully resolved a real product match (pcProductId exists).
    // If PC matched a specific real product page, that's strong enough signal to
    // proceed without requiring publisher separately.
    if (field === 'publisher') {
      const skipPublisher = identitySource && (
        String(identitySource).includes('ebay') ||
        String(identitySource).includes('title-family') ||
        String(identitySource) === 'manual' ||
        Boolean(pcProductId)  // PC resolved a real product = trust it even without publisher
      );
      // Skip publisher requirement if:
      // 1. Publisher is already present (backfilled from CV/PC upstream)
      // 2. OR identitySource allows backfill (ebay/manual/title-family)
      // 3. OR PriceCharting matched a real product (pcProductId exists)
      if (!sanitized?.publisher && !skipPublisher) {
        missingFields.push('publisher');
        reasons.push('publisher missing or uncertainty marker');
      }
      continue;
    }

    // All other fields required unconditionally
    if (!sanitized?.[field]) {
      missingFields.push(field);
      const fieldName = field === 'issue' ? 'issue number' : field;
      reasons.push(`${fieldName} missing or uncertainty marker`);
    }
  }

  // Vision confidence check (universal across all asset types)
  if (sanitized?.visionConfidence === 'low') {
    reasons.push('Vision self-reported low confidence');
  }

  const confident =
    missingFields.length === 0 && sanitized?.visionConfidence !== 'low';

  return { confident, missingFields, reasons };
};

// Q87 — ID_REQUIRED enrich cache predicate. A book the gate refused
// re-enriches only after a user identity edit bumps identityRevision;
// until then the same fields produce the same refusal and the enrich
// call is pure waste. q87CheckedRevision is stamped by the client merge
// paths when an enrich returns identityConfident === false, and cleared
// when identity becomes confident.
export const shouldSkipIdRequiredEnrich = (item) => {
  if (!item) return false;
  return (
    item.identityConfident === false &&
    (item.identityRevision || 0) === (item.q87CheckedRevision ?? -1)
  );
};
