// POST /api/capture-scan -> src/lib/captureScanHandler.js's handleCaptureScan
// (src/modules/capture's captureFromScan).
//
// GrailKey Capture Endpoint Implementation Authorization (2026-09-17),
// auth-order security correction (same day, "CAPTURE ENDPOINT ACCEPTED /
// AUTH-ORDER FIX / DEPLOY FAIL-CLOSED" dispatch).
//
// This file is the ONLY thing that makes captureFromScan reachable from a
// real request. handleCaptureScan itself is reused verbatim, unmodified —
// rate limiting and request/error mapping still live there entirely
// unchanged (it was written as a harness specifically so a real endpoint
// would be a copy, not a redesign — see that file's own header).
//
// HISTORICAL STATE CORRECTION (belongs on the board, restated here so the
// next reader of this file has it too): before this dispatch, there was
// no capture-specific runtime switch to "turn on." captureScanHandler had
// zero live callers and api/ had no route naming it at all — capture was
// UNWIRED BY DEFAULT, not flag-gated-and-disabled. MILESTONE_TEN_H8_PASS
// below is a NEW gate belonging to this NEW route, not a rediscovered old
// one.
//
// ORDERING (security correction): auth runs FIRST, in this file, before
// the H8 gate and before handleCaptureScan is ever called. The original
// version checked H8 before auth, which let an UNAUTHENTICATED caller
// learn from the response body alone that this endpoint exists, that
// Production capture is gated, and the internal milestone name
// (PRODUCTION_CAPTURE_BLOCKED_H8_NOT_PROVEN) — an information leak to a
// caller who was never authenticated in the first place. Required order
// now: request -> auth -> H8 gate -> rate limit -> DB/handler. The auth
// mechanism itself (verifyToken/InvalidTokenError, Bearer-token
// extraction) is untouched — this file calls the exact same function
// handleCaptureScan already calls; principalId from this first check is
// otherwise discarded, and handleCaptureScan re-derives it itself when
// it runs, exactly as it always has. This means an authenticated
// caller's token is verified twice per request (here, then again inside
// handleCaptureScan) — a deliberate, disclosed, cheap redundancy chosen
// over restructuring the reused harness's own internal order.
//
// H8 GATE (Milestone Ten): Production physical-asset capture must stay
// fail-closed until H8 (independent phone/desktop durability proof) is
// explicitly recorded PASS. Checked immediately after auth succeeds,
// still before rate limiting and before any DB connection — an
// authenticated Production request with H8 unproven never touches the
// database and never mints or half-creates anything. Non-Production
// environments (development, preview — GRAILKEY_CATALOG_ENVIRONMENT,
// GK-179) are unaffected and may exercise this route today against
// their own isolated database.
//
// MILESTONE_TEN_H8_PASS=true is a runtime unlock, never itself evidence
// that H8 passed. It may only be set in Production after the real H8
// proof is independently recorded (phone auth, the bootstrap-captured
// asset retrieved on phone, desktop independently retrieves the same
// asset/media, matching gkAssetId/mediaId/byte length) — see
// docs/adr/DATA-1D-CORRECTION-PASS.md, H8. Setting this flag is not
// part of, and is not authorized by, this dispatch.
//
// H8 BOOTSTRAP DEADLOCK RESOLUTION (2026-09-19): H8 as originally
// formulated is circular — it requires a Production durable asset to
// retrieve and compare, but Production durable capture stays blocked
// until H8 passes. Direct read-only evidence this dispatch (root-cause
// report accepted) found ZERO gk_asset/media/collection_item_link rows
// in real Production — the "Creepy #1" asset this file's own comments
// used to reference lives only in Development; it is legitimate
// Development machinery/history evidence, never Production durable-asset
// proof. MILESTONE_TEN_H8_BOOTSTRAP=true is the resolution: a SEPARATE,
// narrower one-shot exception, never itself H8 proof (bootstrap
// authorization != H8 proof, a required invariant) — it exists only to
// let exactly ONE real Production capture happen so H8-B's own
// independent phone/desktop retrieval-and-compare proof has something
// real to retrieve. It is checked ONLY when MILESTONE_TEN_H8_PASS is not
// already true, and is exhausted the instant Production holds ANY
// gk_asset row — reusing the EXISTING asset-count read
// (src/modules/assets/index.js's hasAnyPhysicalAsset(), no new
// table/column/token) rather than inventing a second mechanism, per the
// "reuse a safer existing one-shot mechanism if one exists" instruction.
// A failure to determine that count (a DB error, an environment-identity
// mismatch under the shared GK-179 guard, anything) fails CLOSED — never
// silently treated as "zero assets, bootstrap still available." Once one
// asset exists, bootstrap denies every further Production request with
// PRODUCTION_CAPTURE_BOOTSTRAP_EXHAUSTED, unconditionally, even with the
// env var still set to true, until MILESTONE_TEN_H8_PASS is separately
// recorded true (the operator's job after H8-B's proof, not this file's).
//
// Photo transport: captureFromScan's photos[i].bytes must be a real
// Buffer/Uint8Array (src/modules/assets/service.js's attachMedia asserts
// `bytes instanceof Uint8Array`). JSON has no binary type, so a real HTTP
// caller sends base64; this route decodes each photo's bytes from base64
// to a Buffer before handing off — the one piece of request-shape glue
// captureScanHandler (an in-process harness whose callers always built
// Buffers by hand) never needed and still does not contain. No other
// transformation of the request happens here.

import { verifyToken, InvalidTokenError } from '../src/modules/auth/index.js';
import { hasAnyPhysicalAsset } from '../src/modules/assets/index.js';
import { handleCaptureScan } from '../src/lib/captureScanHandler.js';

function extractBearerToken(req) {
  const header = req.headers?.authorization || req.headers?.Authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
}

export default async function handler(req, res) {
  // 1. Auth — first, before anything else is revealed to the caller.
  const token = extractBearerToken(req);
  try {
    verifyToken(token);
  } catch (e) {
    if (e instanceof InvalidTokenError) {
      return res.status(401).json({ error: 'Missing, invalid, or expired token' });
    }
    console.error('[capture-scan] unexpected token-verification error:', e?.message || e);
    return res.status(500).json({ error: 'Internal error' });
  }

  // 2. H8 gate — only reachable once the caller is authenticated. Still
  // before rate limiting and before any real DB write.
  const environment = process.env.GRAILKEY_CATALOG_ENVIRONMENT;
  const h8Pass = process.env.MILESTONE_TEN_H8_PASS === 'true';
  if (environment === 'production' && !h8Pass) {
    const h8Bootstrap = process.env.MILESTONE_TEN_H8_BOOTSTRAP === 'true';
    if (!h8Bootstrap) {
      return res.status(403).json({
        error: 'PRODUCTION_CAPTURE_BLOCKED_H8_NOT_PROVEN',
        detail:
          'Milestone Ten (H8, independent phone/desktop durability proof) has not been recorded PASS. ' +
          'Production physical-asset capture stays fail-closed until then.',
      });
    }
    // Bootstrap is authorized but NOT itself proof — exhausted the
    // instant one asset exists. Any failure to determine that (thrown
    // error of any kind, including a GK-179 environment-identity
    // mismatch) is treated identically to "bootstrap exhausted" — fail
    // closed, never fail open.
    let alreadyBootstrapped = true;
    try {
      alreadyBootstrapped = await hasAnyPhysicalAsset();
    } catch (e) {
      console.error('[capture-scan] bootstrap eligibility check failed — failing closed:', e?.message || e);
    }
    if (alreadyBootstrapped) {
      return res.status(403).json({
        error: 'PRODUCTION_CAPTURE_BOOTSTRAP_EXHAUSTED',
        detail:
          'The one-shot H8 bootstrap capture has already been used (or its eligibility could not be verified). ' +
          'Production capture stays fail-closed until MILESTONE_TEN_H8_PASS is recorded true.',
      });
    }
    // Falls through: exactly one bootstrap capture permitted.
  }

  // 3. Photo transport decode, then delegate to the reused, unmodified
  // harness (rate limit -> method check -> auth again -> business logic).
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
