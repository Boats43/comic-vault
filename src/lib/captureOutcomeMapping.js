// src/lib/captureOutcomeMapping.js — GK-226. Pure helper extracted from
// GrailKeyOperatorPanel.jsx's captureAsOwnedAsset() so it can be imported
// both by the component and by a plain Node test (the component itself
// is JSX, not importable from a Node test script in this repo).
//
// `item.price` is a dollar-formatted STRING throughout this codebase
// (api/enrich.js's fmtUsd(), e.g. "$15.28" — confirmed live in
// collection_item.attributes.price), never a raw number. The original
// inline expression here did `Number(item.price).toFixed(2)` directly —
// Number("$15.28") is NaN, so this always produced the string "$NaN".
// That string is non-empty (src/modules/capture/mapping.js's
// hasValuation() only checks truthiness, so it passed), but
// mapValuation()'s digit-only regex (`replace(/[^0-9.]/g, '')`) strips
// the letters "N"/"a" right along with the "$", leaving an empty string
// -> Number('') -> 0. A real capture (Old Man Logan #25, gkAssetId
// 01a0bb24-c806-7a63-aa86-ce26fe8eed83) durably recorded valueAmount
// 0.00 this way — GK-226. parsePriceNumber (src/lib/responseContract.js,
// already used elsewhere in this codebase for the exact same "$X.XX"
// shape) fixes this.
import { parsePriceNumber } from "./responseContract.js";

export function buildCaptureOutcomePrice(item) {
  const n = parsePriceNumber(item?.price);
  return n != null ? `$${n.toFixed(2)}` : null;
}
