// src/lib/buyerSafeListingCopy.js — INTERNAL DECISION REASONING != BUYER-FACING
// MARKETPLACE COPY.  (Outcome #1 V1 policy applied.)
//
// The ONE explicit projection from GOVERNED catalogue facts to the facts a
// marketplace listing may be built from. It selects named fields only — it
// NEVER spreads the item, the decision, or the contract — and the listing
// builders (api/list-ebay.js title, description, item specifics) receive ONLY
// this projection, so they structurally cannot read:
//   item.reason (grader/model rationale), decision/contract reasoning,
//   claudeCheck (flags AND the model-suggested title), pricing evidence
//   (priceBands / sold comps / demand / census), internal IDs, error text,
//   authority explanations, unverified model grades, free-text key-issue claims.
// Those stay in GrailKey (operator UI / durable history); they are not deleted,
// merely not projectable into public copy.
//
// Buyer-facing copy may come only from: explicit governed catalogue facts, an
// explicit operator-entered public note (none exists today — omitted rather than
// invented), or deliberately generated public copy with known provenance and an
// explicit public-copy contract (none today).
//
// PUBLIC GRADE: a grade is projected ONLY when governed — an operator-confirmed
// grade (gradeAuthority === 'OPERATOR_CONFIRMED'). A legacy client/model-predicted
// grade (modelPredictedGrade / catalogue `grade` without operator authority) is
// NEVER published as if verified; the listing then carries the fixed factual
// condition sentence instead.

const str = (v) => (typeof v === 'string' ? v.trim() : (typeof v === 'number' && Number.isFinite(v) ? String(v) : ''));

const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs']);

// Deterministic formatting only (never a content change): an all-lowercase title
// (a common OCR/Vision artifact) is Title-Cased; a title that already carries
// any capital letter is preserved verbatim.
export function formatPublicTitle(title) {
  const t = str(title).replace(/\s+/g, ' ');
  if (!t) return '';
  if (t !== t.toLowerCase()) return t;
  return t.split(' ').map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
}

const NO_TITLE_VARIANTS = ['corner box', 'masterpieces', 'design variant', 'cover a', 'cover b', 'cover c', 'cover d', 'headshot'];
export function variantForPublicTitle(variant) {
  const v = str(variant);
  if (!v) return '';
  if (NO_TITLE_VARIANTS.some((nv) => v.toLowerCase().includes(nv))) return '';
  return v;
}

// Governed public grade label, or '' when no governed grade exists.
export function governedPublicGrade(attrs) {
  const a = attrs && typeof attrs === 'object' ? attrs : {};
  if (a.gradeAuthority !== 'OPERATOR_CONFIRMED') return '';
  const g = str(a.operatorGrade);
  if (!g) return '';
  if (a.operatorIsGraded === true && a.operatorGradeNumeric != null && Number.isFinite(Number(a.operatorGradeNumeric))) {
    return `CGC ${Number(a.operatorGradeNumeric)}`;
  }
  return g;
}

// Descriptive condition label for a RAW (not professionally graded) copy, from the
// standard 0.5-10 grade scale. Descriptive only -- never a certification claim.
const RAW_CONDITION_LABELS = {
  '10': 'GM', '9.9': 'MT', '9.8': 'NM/M', '9.6': 'NM+', '9.4': 'NM', '9.2': 'NM-', '9': 'VF/NM',
  '8.5': 'VF+', '8': 'VF', '7.5': 'VF-', '7': 'FN/VF', '6.5': 'FN+', '6': 'FN', '5.5': 'FN-', '5': 'VG/FN',
  '4.5': 'VG+', '4': 'VG', '3.5': 'VG-', '3': 'GD/VG', '2.5': 'GD+', '2': 'GD', '1.8': 'GD-', '1.5': 'FR/GD',
  '1': 'FR', '0.5': 'PR',
};
export function rawConditionLabel(numeric) {
  const n = Number(numeric);
  return Number.isFinite(n) ? (RAW_CONDITION_LABELS[String(n)] || '') : '';
}

// Numeric grade of a governed raw copy: the stored operatorGradeNumeric, else the number in the
// operator grade text ("VF 8.0" -> 8). null when neither exists.
function rawNumericGrade(it) {
  if (it.operatorGradeNumeric != null && Number.isFinite(Number(it.operatorGradeNumeric))) return Number(it.operatorGradeNumeric);
  const m = str(it.operatorGrade).match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

export function toBuyerSafeListingFacts(governedItem) {
  const it = governedItem && typeof governedItem === 'object' ? governedItem : {};
  const publicGrade = governedPublicGrade(it);
  // RAW = a governed operator grade on a copy that is NOT a professional slab.
  const isRaw = publicGrade !== '' && !publicGrade.startsWith('CGC ') && it.operatorIsGraded !== true;
  const rawNumeric = isRaw ? rawNumericGrade(it) : null;
  return Object.freeze({
    isRaw,
    rawConditionLabel: rawNumeric != null ? rawConditionLabel(rawNumeric) : '',
    rawGradeText: rawNumeric != null ? rawNumeric.toFixed(1) : '',
    title: formatPublicTitle(it.title),
    issue: str(it.issue).replace(/^#\s*/, ''),
    year: str(it.year),
    publisher: str(it.publisher),
    variant: str(it.variant),
    publicGrade,
    isSlab: it.operatorIsGraded === true && publicGrade.startsWith('CGC '),
    numericGrade: publicGrade.startsWith('CGC ') ? Number(publicGrade.slice(4)) : null,
  });
}

// Exact raw-condition disclosure for the description. Never claims professional certification.
export function rawConditionDisclosure(facts) {
  const f = facts || {};
  if (f.isRaw !== true) return '';
  if (f.rawConditionLabel && f.rawGradeText) {
    return `Raw copy. GrailKey/operator condition assessment approximately ${f.rawConditionLabel} ${f.rawGradeText}. Not professionally graded or slabbed.`;
  }
  return `Raw copy. GrailKey/operator condition assessment: ${f.publicGrade}. Not professionally graded or slabbed.`;
}

// Deterministic eBay title from governed facts ONLY (<= 80 chars). No model
// suggestion, no key-issue marketing phrase, no unverified grade.
export function buildGovernedListingTitle(facts) {
  const f = facts || {};
  if (f.isRaw === true) {
    // RAW copy: identity first, then "Raw <condition label>" at the END, which truncation never cuts.
    const suffix = `Raw${f.rawConditionLabel ? ` ${f.rawConditionLabel}` : ''}`;
    const core = [f.title, f.issue ? `#${f.issue}` : '', variantForPublicTitle(f.variant), f.publisher, f.year].filter(Boolean).join(' ').trim();
    const room = 80 - suffix.length - 1;
    return `${core.length > room ? core.slice(0, room).trim() : core} ${suffix}`.trim();
  }
  const parts = [
    f.title,
    f.issue ? `#${f.issue}` : '',
    variantForPublicTitle(f.variant),
    f.publicGrade,
    f.publisher,
    f.year,
  ].filter(Boolean);
  const joined = parts.join(' ').trim();
  return joined.length > 80 ? joined.slice(0, 80).trim() : (joined || 'Comic Book');
}
