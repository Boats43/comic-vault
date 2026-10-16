// src/lib/reIdentifyControl.js — render state of the saved-card "Re-identify" control (Ship #20a.6.19, restored 2026-10-16).
//
// The action itself (reIdentifyBook in src/App.jsx -> /api/grade forceRegrade + /api/enrich ownedReidentify) is unchanged and
// is GOVERNED: it merges through mergeConfirmedIdentity (an OPERATOR_CONFIRMED title/issue/year/publisher/variant is held,
// not overwritten), never touches the write-once model baseline or the operator grade, and never sets q41Ack.
//
// Until now the control was REMOVED from the card whenever this device had no raw photo bytes (`item.images[0]`) — which is
// every card hydrated from the server on a device/origin that never scanned it. A control that silently vanishes cannot be
// found, explained, or trusted. It now stays visible and says why it is disabled.
//
// Pure, no I/O.

export const RE_IDENTIFY_REASONS = Object.freeze({
  NO_LOCAL_PHOTO: 'This device does not hold the original photo for this card (it is stored on the server). Re-identify needs that photo — open the card on the device that scanned it.',
  NO_PHOTO_AT_ALL: 'No photo is stored for this card, so there is nothing to re-identify from.',
});

/**
 * @param {object|null} item  the saved catalogue card
 * @param {{ hasHandler?: boolean }} [opts]
 * @returns {{ visible: boolean, enabled: boolean, reason: string|null }}
 */
export function reIdentifyControlState(item, { hasHandler = true } = {}) {
  if (!item || !hasHandler) return { visible: false, enabled: false, reason: null };
  const hasLocalPhoto = Array.isArray(item.images) && Boolean(item.images[0]);
  if (hasLocalPhoto) return { visible: true, enabled: true, reason: null };
  const hasServerPhoto = Array.isArray(item.remoteImages) && item.remoteImages.length > 0;
  return { visible: true, enabled: false, reason: hasServerPhoto ? RE_IDENTIFY_REASONS.NO_LOCAL_PHOTO : RE_IDENTIFY_REASONS.NO_PHOTO_AT_ALL };
}
