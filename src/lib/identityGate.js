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
    if (s && !isUncertaintyString(s) && /^\d+(\.\d+)?$/.test(s)) {
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
