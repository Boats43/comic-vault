// GK-300 — governed physical-evidence capture, DECOUPLED from identity resolution.
//
// EVIDENCE CAPTURE IS NOT IDENTITY RESOLUTION. This module takes an operator-supplied
// photo, prepares it, and appends it as a durable `media` row under an EXPLICIT declared
// role (captureView) through /api/asset-media-append. It deliberately does NOT:
//   * call /api/grade (no paid re-grade, no spend units, no model_prediction_event),
//   * touch item.images / the four-photo catalogue limit / listing photos,
//   * read or write title/issue/publisher/year/grade/price or any identity field,
//   * send a grade proof or claim a grade prediction for the item.
// Listing photographs remain a separate path (the Collection strip -> addPhotoToComic).
//
// Image preparation is unchanged from the previous evidence path: 1200px, quality 0.85
// (A6: no resolution increase is authorized). The prepared image is corroborating
// evidence; it is not asserted to independently establish a UPC or any identifier.
//
// Dependencies are injected so the real function is executable in tests.

import { CAPTURE_VIEWS } from "./physicalMediaAppend.js";

// HTTP statuses that mean "this exact request can never succeed as sent" — retrying
// automatically would only repeat the refusal, so they are surfaced, never queued.
const DEFINITIVE_REFUSAL_STATUSES = new Set([400, 404, 409, 413]);

export class EvidenceRefusedError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = "EvidenceRefusedError";
    this.status = status ?? null;
    this.code = code ?? null;
  }
}

const refusalMessage = (status, body) => {
  if (body?.error === "MEDIA_CAPACITY_EXCEEDED") {
    return `This asset already holds the maximum of ${body.limit ?? 20} evidence photos.`;
  }
  if (body?.error === "CAPTURE_VIEW_REQUIRED") return "That photo role is not valid.";
  if (status === 404) return "This asset could not be found for your account.";
  if (status === 413) return "That photo is too large to upload.";
  return body?.error ? `Evidence photo was refused (${body.error}).` : `Evidence photo was refused (HTTP ${status}).`;
};

/**
 * @param {object} p
 * @param {File|Blob} p.file                 operator-selected photo (camera or library)
 * @param {string} p.itemId                  catalogue item id (idempotency scope only)
 * @param {string} p.gkAssetId               the linked physical asset
 * @param {string} p.captureView             FRONT | BACK | SPINE | PAGES | DETAIL (explicit, never inferred)
 * @param {Array}  p.pendingAppends          the item's current local _pendingEvidenceAppends
 * @param {object} p.deps                    { fileToBase64, makeThumbnail, appendDetailed, getKey, retireKey }
 * @returns {Promise<{status:'APPENDED'|'PENDING', mediaId?:string, pendingAppends:Array}>}
 * @throws {EvidenceRefusedError} for a definitive server refusal (e.g. capacity); never for a transient failure
 */
export async function captureEvidencePhoto({ file, itemId, gkAssetId, captureView, pendingAppends, deps }) {
  if (!gkAssetId || typeof gkAssetId !== "string") throw new Error("gkAssetId is required for evidence capture");
  if (!CAPTURE_VIEWS.includes(captureView)) throw new Error(`captureView must be one of ${CAPTURE_VIEWS.join(", ")}`);
  if (!file) throw new Error("A photo is required");
  const { fileToBase64, makeThumbnail, appendDetailed, getKey, retireKey } = deps;

  const prior = Array.isArray(pendingAppends) ? pendingAppends : [];
  const rawB64 = await fileToBase64(file);
  const dataUrl = await makeThumbnail(rawB64, 1200, 0.85);
  const idempotencyKey = getKey(itemId, captureView);

  const r = await appendDetailed({ gkAssetId, dataUrl, captureView, idempotencyKey });

  if (r.ok && r.body?.mediaId) {
    retireKey(itemId, captureView);
    return { status: "APPENDED", mediaId: r.body.mediaId, pendingAppends: prior.filter((p) => p.captureView !== captureView) };
  }

  if (r.status != null && DEFINITIVE_REFUSAL_STATUSES.has(r.status)) {
    retireKey(itemId, captureView);
    throw new EvidenceRefusedError(refusalMessage(r.status, r.body), { status: r.status, code: r.body?.error });
  }

  // Transient (no session, network, 5xx, 401, 429): keep the EXACT bytes locally for the
  // existing authenticated-reconnect retry (retryPendingPhysicalMediaAppends).
  const entry = { gkAssetId, captureView, dataUrl, idempotencyKey };
  return { status: "PENDING", pendingAppends: [...prior.filter((p) => p.captureView !== captureView), entry] };
}
