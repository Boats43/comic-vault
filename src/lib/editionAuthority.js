// GK-271 — Edition-authority guard for COUNTRY claims.
//
// A country/edition claim ("Canadian edition") is edition-bearing truth
// only when edition-bearing evidence supports it (indicia, publisher/
// country marker, HRN/back-cover marker, a deterministic publication
// identifier). Vision's free-text `variant` / `reason` / `foreignEdition`
// boolean is a single uncorroborated model read — it must never become
// confirmed edition authority, and must never reach the Canadian price
// multiplier.
//
// PURE. No pricing math here: this only decides whether a variant string's
// country claim is CONFIRMED by the reconciled `confirmedVariant` (which
// api/enrich.js's reconciler clears when no independent evidence exists).

export const COUNTRY_CLAIM_RE = /\bcanad(?:a|ian)\b/i;

export const hasCountryClaim = (s) => COUNTRY_CLAIM_RE.test(String(s || ''));

// True when `rawVariant` (Vision/client-supplied) asserts a country that
// the reconciled `confirmedVariant` does NOT also carry. Such a claim is
// UNRESOLVED: it may not drive a price multiplier or edition identity.
export const isUnconfirmedCountryClaim = (rawVariant, confirmedVariant) =>
  hasCountryClaim(rawVariant) && !hasCountryClaim(confirmedVariant);

// editionStanding for the card. Never "CONFIRMED" from Vision alone.
export const deriveEditionStanding = ({ rawVariant = null, confirmedVariant = null, foreignEditionFlag = false } = {}) => {
  const claimed = hasCountryClaim(rawVariant) || foreignEditionFlag === true;
  if (!claimed) return { editionStanding: 'NOT_CLAIMED', country: null };
  if (hasCountryClaim(confirmedVariant)) return { editionStanding: 'CONFIRMED_BY_RECONCILER', country: 'CANADA' };
  return { editionStanding: 'UNRESOLVED', country: null };
};
