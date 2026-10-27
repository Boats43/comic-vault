// C3-R6 — resolved asset-type standing. The model's raw `assetTypeConfident:false` ("this may not be a comic")
// is ADVISORY. When api/enrich.js's Q32 comic-category consensus (>=5 votes, >=60% of the eBay pool in the
// comics category tree, merchandise below the hard-block region) overrides it, it sets
// `assetTypeConfidentOverride:true` on the response. Every consumer must read the RESOLVED standing, never
// re-apply the superseded raw flag. Pure; no I/O.
export function resolveAssetTypeConfident(src) {
  if (!src || typeof src !== 'object') return undefined;
  if (src.assetTypeConfident === false && src.assetTypeConfidentOverride === true) return true;
  return src.assetTypeConfident;
}

/** True only when the asset type is still genuinely uncertain after any server-side Q32 override. */
export const isAssetTypeUncertain = (src) => resolveAssetTypeConfident(src) === false;

/** True when the card should offer the one-tap "This is a comic" action (genuinely unresolved, comic category). */
export const canOfferOperatorComicConfirmation = (item) =>
  !!item && (item.assetType === 'comic') && isAssetTypeUncertain(item) && item.assetTypeOperatorConfirmation?.classification !== 'comic';
