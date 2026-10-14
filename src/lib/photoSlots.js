// GK-300 — explicit photo-slot roles for the Collection photo strip.
//
// A photo's role (FRONT/BACK/SPINE/PAGES, or DETAIL) is chosen by the operator
// and stored in `item.photoRoles`, an array PARALLEL to the photo array (null
// = role not declared). It is never inferred from upload order for new photos.
// Legacy photos (no recorded role) keep their historical positional meaning
// (index 0 = FRONT, 1 = BACK, 2 = SPINE, 3 = PAGES), but a role explicitly
// claimed by another photo always wins. Pure, no I/O.

export const PHOTO_ROLES = ['FRONT', 'BACK', 'SPINE', 'PAGES'];
export const PHOTO_ROLE_LABELS = { FRONT: 'Front', BACK: 'Back', SPINE: 'Spine', PAGES: 'Pages', DETAIL: 'Detail' };
const VALID = new Set([...PHOTO_ROLES, 'DETAIL']);
const RANK = { FRONT: 0, BACK: 1, SPINE: 2, PAGES: 3, DETAIL: 4 };

const norm = (r) => (typeof r === 'string' && VALID.has(r.toUpperCase()) ? r.toUpperCase() : null);

/** Role of each photo: explicit first, then legacy-positional if unclaimed, else null. */
export function effectiveRoles(photoCount, photoRoles) {
  const explicit = Array.from({ length: photoCount }, (_, i) => norm(Array.isArray(photoRoles) ? photoRoles[i] : null));
  const claimed = new Set();
  const out = explicit.map((r) => {
    if (r && !claimed.has(r)) { claimed.add(r); return r; }
    return null; // duplicate explicit claim: first wins, later one is unassigned
  });
  return out.map((r, i) => {
    if (r) return r;
    if (explicit[i]) return null; // a losing duplicate explicit claim stays unassigned
    const legacy = PHOTO_ROLES[i];
    return legacy && !claimed.has(legacy) ? legacy : null;
  });
}

/** Slot roles (of the four) that have no photo — by ROLE, not by position. */
export function missingRoles(photoCount, photoRoles) {
  const have = new Set(effectiveRoles(photoCount, photoRoles));
  return PHOTO_ROLES.filter((r) => !have.has(r));
}

/**
 * Add `newPhoto` under the explicitly selected `role`. Returns
 * { images, photoRoles, replaced }. If the role already has a photo it is
 * replaced in place (explicit operator selection of that role wins; count
 * unchanged). Otherwise the photo is inserted in canonical role order so
 * images[0] is FRONT whenever a FRONT exists. Stored roles contain only
 * explicitly declared roles (legacy positional photos stay null).
 */
export function addPhotoWithRole(images, photoRoles, newPhoto, role) {
  const r = norm(role);
  if (!r) throw new Error(`Invalid photo role: ${role}`);
  const imgs = Array.isArray(images) ? images.slice() : [];
  const eff = effectiveRoles(imgs.length, photoRoles);
  const stored = imgs.map((_, i) => norm(Array.isArray(photoRoles) ? photoRoles[i] : null));
  const at = r === 'DETAIL' ? -1 : eff.indexOf(r);
  if (at >= 0) {
    imgs[at] = newPhoto;
    stored[at] = r;
    return { images: imgs, photoRoles: stored, replaced: true };
  }
  const entries = imgs.map((img, i) => ({ img, stored: stored[i], rank: RANK[eff[i]] ?? 9, i }));
  entries.push({ img: newPhoto, stored: r, rank: RANK[r], i: imgs.length });
  entries.sort((a, b) => a.rank - b.rank || a.i - b.i);
  return { images: entries.map((e) => e.img), photoRoles: entries.map((e) => e.stored), replaced: false };
}

/** Declared-only views for the grade request (never positional guesses). */
export function declaredViews(photoRoles, photoCount) {
  const v = Array.from({ length: photoCount }, (_, i) => norm(Array.isArray(photoRoles) ? photoRoles[i] : null));
  return v.some(Boolean) ? v : null;
}
