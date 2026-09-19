// src/lib/physicalMediaChecklist.js — GK-227.
//
// Certification photo-completeness must derive from durable kernel
// media rows + their captureView, and ONLY that — never raw photo count,
// never collection_item.attributes.remoteImages, never Vision/model
// prose describing what a photo "seems to show." A media row with
// capture_view IS the durable fact; anything else is an inference this
// function refuses to make.
//
// Pure function — takes the `media` array exactly as
// getPhysicalAsset()/getAssetGraph() already return it (each row shaped
// like the real data1_dev.media columns, including `capture_view`,
// added by migration 0029). No I/O, no DB, importable by both a UI
// component and a plain Node test.

export const REQUIRED_CAPTURE_VIEWS = ['FRONT', 'BACK', 'SPINE', 'PAGES'];
export const ALL_CAPTURE_VIEWS = ['FRONT', 'BACK', 'SPINE', 'PAGES', 'DETAIL'];

// { FRONT: boolean, BACK: boolean, SPINE: boolean, PAGES: boolean, DETAIL: boolean }
// true means: at least one durable media row exists with that exact
// capture_view value. A row with capture_view === null (every
// pre-GK-227 row, e.g. every original capture-time photo minted before
// this dispatch) contributes to none of these — it is real evidence, but
// evidence of an UNKNOWN view, never silently counted toward any
// specific one.
export function computeCaptureViewChecklist(mediaRows) {
  const checklist = Object.fromEntries(ALL_CAPTURE_VIEWS.map((v) => [v, false]));
  for (const row of mediaRows || []) {
    const view = row?.capture_view;
    if (view && Object.prototype.hasOwnProperty.call(checklist, view)) {
      checklist[view] = true;
    }
  }
  return checklist;
}

// Certification-readiness requires the 4 core views. DETAIL is
// supplementary evidence, never required.
export function isCertificationPhotoPacketComplete(mediaRows) {
  const checklist = computeCaptureViewChecklist(mediaRows);
  return REQUIRED_CAPTURE_VIEWS.every((v) => checklist[v] === true);
}

// Which of the 4 required views are still missing, for a human-readable
// report — never fabricates a reason, just names the durable gaps.
export function missingRequiredCaptureViews(mediaRows) {
  const checklist = computeCaptureViewChecklist(mediaRows);
  return REQUIRED_CAPTURE_VIEWS.filter((v) => checklist[v] !== true);
}
