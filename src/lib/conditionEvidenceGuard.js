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

// GK-272C — claims that are not observations of the photographed surface.
//  * ERA_IDENTITY_RE: a decade / "Golden Age" claim in condition prose is an
//    IDENTITY claim (year/printing era), not a condition observation. The
//    prompt already forbids introducing a competing identification here; this
//    enforces it. Withheld unconditionally: no durable identity authority is
//    available to this guard, and when identity is conflicted such prose would
//    contradict (or silently stand in for) the displayed year.
//  * STORAGE_HISTORY_RE: storage history / "indicative of age" is never
//    observable from a photograph.
//  * BRITTLE_PAPER_RE: paper brittleness / flexibility / acidity needs an
//    interior (PAGES) view; it can never be inferred from a front image or
//    from an image count.
export const ERA_IDENTITY_RE =
  /\b(?:19|20)\d0'?s\b|\b(?:golden|silver|bronze|copper|modern)[- ]age\b|\b(?:pre|post)[- ]?war\b|\bera\b/i;
export const STORAGE_HISTORY_RE =
  /\bstorage\b|\bstored\b|\bindicative of (?:age|storage)\b|\b(?:age|aging)[- ]related\b|\bconsistent with (?:its |the )?age\b/i;
export const BRITTLE_PAPER_RE =
  /\bbrittl(?:e|eness)\b|\bpaper (?:quality|stock|tone|flexib\w*)\b|\bflexib(?:le|ility)\b|\bacid(?:ic|ity)?\b|\bcrumbl\w*\b/i;

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
export const guardConditionClaims = ({ reason, imageCount = 0, views = null, undeclaredImageCount = 0, year = null, cgcPenaltyFlags = null } = {}) => {
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
  // Images whose role was never declared could show anything, so a claim
  // not matched by a declared view cannot be disproven — it stands. Only a
  // fully-declared set (or a lone undeclared image) makes grounding knowable.
  const fullyDeclared = !!knownViews && undeclaredImageCount === 0;

  const y = parseInt(year, 10);
  const polybagImpossible = Number.isFinite(y) && y > 0 && y < POLYBAG_EARLIEST_YEAR;

  // Line structure (bullets/newlines) is preserved: sentences are guarded
  // per line and a line that loses every sentence is dropped.
  const keptLines = [];
  for (const rawLine of String(reason || '').split('\n')) {
  const kept = [];
  for (const sentence of splitSentences(rawLine)) {
    if (polybagImpossible && POLYBAG_RE.test(sentence)) {
      withheld.push({ claim: sentence, reason: `era-implausible: polybag indentation in a ${y} book` });
      continue;
    }
    if (ERA_IDENTITY_RE.test(sentence)) {
      withheld.push({ claim: sentence, reason: 'identity-claim: era/decade is an identity assertion, not a condition observation' });
      continue;
    }
    if (STORAGE_HISTORY_RE.test(sentence)) {
      withheld.push({ claim: sentence, reason: 'not-observable: storage history cannot be established from photographs' });
      continue;
    }
    if (BRITTLE_PAPER_RE.test(sentence) && !hasView('PAGES')) {
      withheld.push({ claim: sentence, reason: 'not-visible-from-supplied-evidence: paper condition needs a declared PAGES view' });
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
      const groundingKnowable = frontOnly || fullyDeclared;
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
  if (kept.length > 0) keptLines.push(kept.join(' '));
  }

  let flags = cgcPenaltyFlags;
  let flagsChanged = false;
  if (polybagImpossible && flags?.polybagIndents?.detected === true) {
    flags = { ...flags, polybagIndents: { ...flags.polybagIndents, detected: false, rejectedByEraGate: true } };
    flagsChanged = true;
    withheld.push({ claim: 'cgcPenaltyFlags.polybagIndents', reason: `era-implausible: polybag indentation in a ${y} book` });
  }

  // Structured penalty flag that needs a SPINE view: staple popping is only
  // observable on the spine/staple line. Same grounding rule as the prose.
  if (flags?.staplePopping?.detected === true && !hasView('SPINE') && (frontOnly || fullyDeclared)) {
    flags = { ...flags, staplePopping: { ...flags.staplePopping, detected: false, severity: null, rejectedByViewGate: true } };
    flagsChanged = true;
    withheld.push({
      claim: 'cgcPenaltyFlags.staplePopping',
      reason: frontOnly ? 'not-visible-from-supplied-evidence: single front image' : 'not-grounded: no declared SPINE view',
    });
  }

  return {
    reason: keptLines.join('\n'),
    cgcPenaltyFlags: flags,
    flagsChanged,
    withheld,
    changed: withheld.length > 0,
  };
};
