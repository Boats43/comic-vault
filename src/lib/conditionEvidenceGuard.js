// GK-271 — View-grounded condition claims + era plausibility.
//
// Vision's condition prose (`reason`) may only assert what the supplied
// images can actually show. With a single (front) image it must not make
// definitive claims about the back cover, spine, staples, interior pages.
// Defects that cannot exist in a book's era (polybag indentation on a
// pre-polybag book) are rejected as hallucinated. Model prose may not
// invent supporting defects for a grade.
//
// PURE. Never raises a grade or price; only withholds unsupported claims
// and records what was withheld and why (annotation, not silent deletion).

// Polybagged comics are a modern retail practice; nothing before ~1980 can
// carry polybag indentation. Conservative cut: anything dated before 1980.
export const POLYBAG_EARLIEST_YEAR = 1980;

const UNSUPPORTED_WITH_FRONT_ONLY_RE =
  /\b(?:back\s+cover|rear\s+cover|spine|staples?|stapl(?:e|ing)\s+(?:popping|failure)|interior|inside\s+(?:cover|pages?)|pages?|centerfold|rear)\b/i;

const POLYBAG_RE = /\bpoly\s?bag(?:ged)?\b|\bbag(?:ged)?\s+indent/i;

// Split into sentences conservatively; keep delimiters out.
const splitSentences = (text) =>
  String(text || '').split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);

/**
 * @param {object} p
 * @param {string} p.reason   Vision condition prose
 * @param {number} p.imageCount number of images supplied to Vision
 * @param {string[]} [p.views] capture_view roles when known (FRONT/BACK/SPINE/PAGES/DETAIL)
 * @param {number|string|null} [p.year] publication year if known
 * @param {object|null} [p.cgcPenaltyFlags]
 */
export const guardConditionClaims = ({ reason, imageCount = 0, views = null, year = null, cgcPenaltyFlags = null } = {}) => {
  const withheld = [];
  const knownViews = Array.isArray(views) && views.length > 0
    ? new Set(views.map((v) => String(v).toUpperCase()))
    : null;
  // Declared views (GK-227 capture_view) are authoritative: a back/spine/
  // pages claim needs the matching view. When views are NOT declared, a
  // single image is front-only evidence (withhold); multiple undeclared
  // images cannot be disproven, so their claims are left standing.
  const hasView = (name) => (knownViews ? knownViews.has(name) : false);
  const frontOnly = !knownViews && imageCount <= 1;

  const y = parseInt(year, 10);
  const polybagImpossible = Number.isFinite(y) && y > 0 && y < POLYBAG_EARLIEST_YEAR;

  const kept = [];
  for (const sentence of splitSentences(reason)) {
    if (polybagImpossible && POLYBAG_RE.test(sentence)) {
      withheld.push({ claim: sentence, reason: `era-implausible: polybag indentation in a ${y} book` });
      continue;
    }
    if (UNSUPPORTED_WITH_FRONT_ONLY_RE.test(sentence)) {
      const needsBack = /\b(?:back|rear)\b/i.test(sentence);
      const needsSpine = /\b(?:spine|staples?|stapl)/i.test(sentence);
      const needsPages = /\b(?:interior|pages?|centerfold|inside)\b/i.test(sentence);
      const grounded =
        (!needsBack || hasView('BACK')) &&
        (!needsSpine || hasView('SPINE')) &&
        (!needsPages || hasView('PAGES'));
      const groundingKnowable = frontOnly || !!knownViews;
      if (!grounded && groundingKnowable) {
        withheld.push({
          claim: sentence,
          reason: frontOnly
            ? 'not-visible-from-supplied-evidence: single front image'
            : 'not-grounded: no declared capture_view supports this claim',
        });
        continue;
      }
    }
    kept.push(sentence);
  }

  let flags = cgcPenaltyFlags;
  let flagsChanged = false;
  if (polybagImpossible && flags?.polybagIndents?.detected === true) {
    flags = { ...flags, polybagIndents: { ...flags.polybagIndents, detected: false, rejectedByEraGate: true } };
    flagsChanged = true;
    withheld.push({ claim: 'cgcPenaltyFlags.polybagIndents', reason: `era-implausible: polybag indentation in a ${y} book` });
  }

  return {
    reason: kept.join(' '),
    cgcPenaltyFlags: flags,
    flagsChanged,
    withheld,
    changed: withheld.length > 0,
  };
};
