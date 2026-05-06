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
//   visionConfidence — normalized to 'high' | 'medium' | 'low' | null.
export const sanitizeIdentityFields = (input) => {
  const out = { title: null, issue: null, year: null, publisher: null, visionConfidence: null };
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
// Confident requires:
//   - title, issue, year, publisher all non-null
//   - EXCEPT: publisher is optional when identitySource includes 'ebay'
//     (eBay image search verified visually, publisher not needed)
//   - visionConfidence is NOT 'low' (null/medium/high all OK; null default
//     avoids gating books where Vision didn't surface a confidence string)
//
// External-lookup signals (PriceCharting / ComicVine / eBay match) are
// NOT consulted. Per Ship #20a.6.4 refinement A: legit indie books may
// fail all three external lookups while being cleanly identified by
// Vision (Biker Mice #1 2024, Whatnot exclusives, indie Webtoon prints).
// Conflating "we don't know this book" with "the world hasn't catalogued
// this book" produces too many false-positive gates.
export const assessIdentityConfidence = (sanitized, identitySource) => {
  const missingFields = [];
  const reasons = [];

  if (!sanitized?.title) {
    missingFields.push('title');
    reasons.push('title missing or uncertainty marker');
  }
  if (!sanitized?.issue) {
    missingFields.push('issue');
    reasons.push('issue number missing or non-numeric');
  }
  if (!sanitized?.year) {
    missingFields.push('year');
    reasons.push('year missing or not a 4-digit value');
  }
  // Skip publisher requirement when eBay image search confirmed identity
  const skipPublisher = identitySource && String(identitySource).includes('ebay');
  if (!sanitized?.publisher && !skipPublisher) {
    missingFields.push('publisher');
    reasons.push('publisher missing or uncertainty marker');
  }
  if (sanitized?.visionConfidence === 'low') {
    reasons.push('Vision self-reported low confidence');
  }

  const confident =
    missingFields.length === 0 && sanitized?.visionConfidence !== 'low';

  return { confident, missingFields, reasons };
};
