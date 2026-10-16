// src/lib/reIdentifyControl.js — render state + disclosure of the saved-card "Re-evaluate" (re-identify) control
// (Ship #20a.6.19; restored and extended 2026-10-16).
//
// The action itself (reIdentifyBook in src/App.jsx -> /api/grade forceRegrade + /api/enrich ownedReidentify) is GOVERNED and
// unchanged: it merges through mergeConfirmedIdentity (OPERATOR_CONFIRMED title/issue/year/publisher/variant are held), never
// touches the write-once model baseline or the operator grade, never sets q41Ack, and mints no asset.
//
// The control stays VISIBLE on every saved comic/book card. It is enabled when a photo is available — raw bytes on this
// device, or the saved server copy (served through the existing protected image route). Otherwise it explains why not.
//
// Pure, no I/O.

export const RE_IDENTIFY_COST_UNITS = Object.freeze({ grade: 3, enrich: 2 }); // must equal SPEND_UNITS.grade / .enrich (tested)

export const RE_IDENTIFY_REASONS = Object.freeze({
  NO_PHOTO_AT_ALL: 'No photo is stored for this card, so there is nothing to re-evaluate from.',
});

/**
 * @returns {{ visible: boolean, enabled: boolean, photoSource: 'device'|'server'|null, reason: string|null, label: string }}
 */
export function reIdentifyControlState(item, { hasHandler = true } = {}) {
  const label = item && item.assetCategory === 'book' ? '🔍 Re-identify Book' : '🔍 Re-evaluate Comic';
  if (!item || !hasHandler || item.assetCategory === 'generic') return { visible: false, enabled: false, photoSource: null, reason: null, label };
  if (Array.isArray(item.images) && item.images[0]) return { visible: true, enabled: true, photoSource: 'device', reason: null, label };
  if (Array.isArray(item.remoteImages) && item.remoteImages.length > 0) return { visible: true, enabled: true, photoSource: 'server', reason: null, label };
  return { visible: true, enabled: false, photoSource: null, reason: RE_IDENTIFY_REASONS.NO_PHOTO_AT_ALL, label };
}

/** The paid-AI disclosure shown BEFORE anything runs. */
export function reIdentifyDisclosure(photoSource) {
  const units = RE_IDENTIFY_COST_UNITS.grade + RE_IDENTIFY_COST_UNITS.enrich;
  return (
    `Re-evaluate this card?\n\n` +
    `This runs a PAID AI re-grade of the ${photoSource === 'server' ? 'saved server copy of the photo' : 'photo on this device'} ` +
    `plus a market refresh (about ${units} usage units: ${RE_IDENTIFY_COST_UNITS.grade} grade + ${RE_IDENTIFY_COST_UNITS.enrich} market).\n\n` +
    `Your confirmed title, variant and grade are kept. The AI estimate and the price may change. ` +
    `Listing approval is not affected — you still acknowledge the price before listing.\n\nContinue?`
  );
}
