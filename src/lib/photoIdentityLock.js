// GK-300 — an add-photo re-grade must never overwrite operator-confirmed
// identity. `addPhotoToComic` consumes a /api/grade response (not an enrich
// response) and historically assigned title/issue/publisher/year from it with
// plain `||` precedence, bypassing the GK-85 per-field OPERATOR_CONFIRMED lock
// that mergeConfirmedIdentity honors. Pure, no I/O.
//
// Scope: only fields the item's own `identityAuthority` marks
// OPERATOR_CONFIRMED are pinned to the stored value. Unlocked fields keep the
// pre-existing behavior (fresh grade response wins when present). variant and
// printingClass are never taken from a grade response here (the caller spreads
// `...item`), so they are listed only so a lock on them is reported.

export const PHOTO_LOCKABLE_IDENTITY_FIELDS = ['title', 'issue', 'publisher', 'year', 'variant', 'printingClass'];

export function lockedIdentityFields(item) {
  const authority = (item && typeof item.identityAuthority === 'object' && item.identityAuthority) || {};
  return PHOTO_LOCKABLE_IDENTITY_FIELDS.filter((f) => authority[f] === 'OPERATOR_CONFIRMED');
}

/**
 * @param {object} item  stored record (pre-photo)
 * @param {object} data  /api/grade re-grade response
 * @returns {{title:*, issue:*, publisher:*, year:*, lockedFields:string[]}}
 */
export function resolvePhotoRegradeIdentity(item, data) {
  const d = data || {};
  const locked = new Set(lockedIdentityFields(item));
  const photoIssue = d.issue || d.title?.match(/#(\d+)/)?.[1] || item?.issue || null;
  return {
    title: locked.has('title') ? item.title : (d.title || item?.title),
    issue: locked.has('issue') ? (item.issue ?? null) : photoIssue,
    publisher: locked.has('publisher') ? item.publisher : (d.publisher || item?.publisher),
    year: locked.has('year') ? item.year : (d.year || item?.year),
    lockedFields: [...locked],
  };
}
