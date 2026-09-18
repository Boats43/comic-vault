// POST /api/capture-scan -> src/lib/captureScanHandler.js's handleCaptureScan
// (src/modules/capture's captureFromScan).
//
// GrailKey Capture Endpoint Implementation Authorization (2026-09-17).
// This file is the ONLY thing that makes captureFromScan reachable from a
// real request. handleCaptureScan itself is reused verbatim, unmodified —
// auth (Bearer token -> principalId), rate limiting, and request/error
// mapping all already lived there before this file existed (it was
// written as a harness specifically so a real endpoint would be a copy,
// not a redesign — see that file's own header).
//
// HISTORICAL STATE CORRECTION (belongs on the board, restated here so the
// next reader of this file has it too): before this dispatch, there was
// no capture-specific runtime switch to "turn on." captureScanHandler had
// zero live callers and api/ had no route naming it at all — capture was
// UNWIRED BY DEFAULT, not flag-gated-and-disabled. MILESTONE_TEN_H8_PASS
// below is a NEW gate belonging to this NEW route, not a rediscovered old
// one.
//
// H8 GATE (Milestone Ten): Production physical-asset capture must stay
// fail-closed until H8 (independent phone/desktop durability proof) is
// explicitly recorded PASS. Checked BEFORE any other work — before auth,
// before rate limiting, before captureFromScan is ever reached — so a
// Production request with H8 unproven never touches the database and
// never mints or half-creates anything. Non-Production environments
// (development, preview — GRAILKEY_CATALOG_ENVIRONMENT, GK-179) are
// unaffected and may exercise this route today against their own
// isolated database.
//
// Photo transport: captureFromScan's photos[i].bytes must be a real
// Buffer/Uint8Array (src/modules/assets/service.js's attachMedia asserts
// `bytes instanceof Uint8Array`). JSON has no binary type, so a real HTTP
// caller sends base64; this route decodes each photo's bytes from base64
// to a Buffer before handing off — the one piece of request-shape glue
// captureScanHandler (an in-process harness whose callers always built
// Buffers by hand) never needed and still does not contain. No other
// transformation of the request happens here.

import { handleCaptureScan } from '../src/lib/captureScanHandler.js';

export default async function handler(req, res) {
  const environment = process.env.GRAILKEY_CATALOG_ENVIRONMENT;
  const h8Pass = process.env.MILESTONE_TEN_H8_PASS === 'true';

  if (environment === 'production' && !h8Pass) {
    return res.status(403).json({
      error: 'PRODUCTION_CAPTURE_BLOCKED_H8_NOT_PROVEN',
      detail:
        'Milestone Ten (H8, independent phone/desktop durability proof) has not been recorded PASS. ' +
        'Production physical-asset capture stays fail-closed until then.',
    });
  }

  if (req.body && Array.isArray(req.body.photos)) {
    req.body.photos = req.body.photos.map((photo) => {
      if (photo && typeof photo.bytes === 'string') {
        return { ...photo, bytes: Buffer.from(photo.bytes, 'base64') };
      }
      return photo;
    });
  }

  return handleCaptureScan(req, res);
}
