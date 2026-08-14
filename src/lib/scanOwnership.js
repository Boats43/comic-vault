// src/lib/scanOwnership.js
//
// Track B Phase 0, Slice 7 — immutable per-scan asynchronous ownership.
//
// Closes the confirmed gradeBlob race (src/App.jsx): two overlapping
// gradeBlob invocations (two physical scans started close together) each
// await their own /api/grade and /api/enrich requests independently —
// nothing prevented a stale response from overwriting the live `result`
// preview state at either write site. Reuses the shape already proven safe
// by refreshMarketData's activeCardEnrichIdRef/enrichId mechanism
// (App.jsx), extended with a second dimension (generation) because a
// scanId-only design — even crypto.randomUUID()-based, effectively
// collision-free under normal operation — cannot be proven to fail closed
// against a deliberately forced collision in a test harness; generation
// can, since it is a pure client-side ordering signal never sent to or
// echoed by the server, immune to any server-side echo defect.
//
// Pure functions only, mirroring src/lib/cacheKeys.js's own stated design
// purpose: both the real App.jsx call sites and this feature's tests
// import the SAME implementation — including the orchestration function
// (applyScanOwnershipGuard) at the bottom of this file, not just the
// isolated predicate. gradeBlob calls applyScanOwnershipGuard directly at
// both write sites; a test that calls applyScanOwnershipGuard is exercising
// the real integration, not a parallel test-local reimplementation.

// Mints a new scan's identity. crypto.randomUUID() is available in all
// modern browsers (the deployment target here) and in Node 19+ test
// environments without a polyfill.
export const mintScanId = () => crypto.randomUUID();

// Advances a monotonic local invocation counter, stored on a ref-like
// object ({ current }) so React's useRef can be passed directly. Returns
// the new value. Independent of scanId's own randomness — this is the
// second ownership dimension, never sent to or echoed by the server.
export const nextGeneration = (generationRef) => {
  const next = (generationRef.current || 0) + 1;
  generationRef.current = next;
  return next;
};

// Decides whether a response belongs to the CURRENT scan.
//
//   response — the parsed JSON body from /api/grade or /api/enrich.
//   closure  — { scanId, generation } captured by the gradeBlob closure
//              that issued the request this response answers.
//   active   — activeScanRef.current, i.e. { scanId, generation } | null,
//              the ownership identity of whichever scan is CURRENT right
//              now (may belong to a different, later invocation).
//
// Returns { accepted: boolean, reason: string | null }. `reason` is one of
// 'missing-echo' | 'altered-echo' | 'scanid-mismatch' | 'generation-mismatch'
// when accepted is false; null when accepted is true. Checked in this
// exact order so a caller can distinguish "the server didn't echo
// correctly" (missing-echo/altered-echo — a server-side defect, unrelated
// to whether this scan is still current) from "this scan is simply no
// longer current" (scanid-mismatch/generation-mismatch — the expected,
// common staleness case).
export const shouldAcceptScanResponse = (response, closure, active) => {
  const responseScanId =
    response && typeof response.scanId === 'string' && response.scanId.length > 0
      ? response.scanId
      : null;

  if (!responseScanId) {
    return { accepted: false, reason: 'missing-echo' };
  }
  if (responseScanId !== closure?.scanId) {
    return { accepted: false, reason: 'altered-echo' };
  }
  if (!active || closure?.scanId !== active.scanId) {
    return { accepted: false, reason: 'scanid-mismatch' };
  }
  if (closure?.generation !== active.generation) {
    return { accepted: false, reason: 'generation-mismatch' };
  }
  return { accepted: true, reason: null };
};

// ---------------------------------------------------------------------
// Shadow-versus-enforcement rollout.
//
// SHADOW  — evaluate the full ownership predicate; log every would-reject
//           mismatch; but ALWAYS still perform the write (the existing,
//           pre-Slice-7 unconditional behavior). Collects real production
//           incidence data with zero user-visible behavior change.
// ENFORCE — evaluate the same predicate; log the rejection; perform the
//           write ONLY when accepted (drops a stale write).
//
// A CODE CONSTANT, not an environment variable, controls the mode —
// chosen deliberately over an env var for three reasons: (1) this value
// is purely client-side and bundled at build time regardless (Vite
// inlines both a literal constant and an import.meta.env.VITE_* read at
// build time — an env var buys no runtime flexibility here that a
// constant doesn't already have); (2) a constant makes the eventual
// enforcement flip a single-line, git-reviewed, git-blamed diff — the
// exact "one-line separately-reviewed change" this rollout is designed to
// produce, whereas a dashboard-toggled env var leaves no equivalent
// code-review trail; (3) matches the standing "conservative when
// uncertain" doctrine — a missing/misconfigured env var at deploy time
// must never silently enable enforcement, and a constant cannot be
// "missing" the way an env var can.
export const SCAN_OWNERSHIP_MODE = Object.freeze({
  SHADOW: 'shadow',
  ENFORCE: 'enforce',
});

// PRODUCTION DEFAULT — SHADOW. Flipping this to SCAN_OWNERSHIP_MODE.ENFORCE,
// after a production shadow window shows zero unexplained incidence, is the
// entire enforcement-activation change per the accepted rollout plan — no
// other file needs to change for that flip.
export const CURRENT_SCAN_OWNERSHIP_MODE = SCAN_OWNERSHIP_MODE.SHADOW;

// Structured stale-response observability. No image or other sensitive
// request content is logged — identifiers and the rejection reason only.
// `mode` is included so shadow-mode "would have rejected, wrote through
// anyway" log lines are never confused with enforce-mode "rejected, write
// dropped" ones in production logs.
export const logStaleScanResponse = (stage, response, closure, active, reason, mode) => {
  const responseScanId =
    response && typeof response.scanId === 'string' ? response.scanId : null;
  const enforcing = mode === SCAN_OWNERSHIP_MODE.ENFORCE;
  console.log(
    `[scan-ownership] ${enforcing ? 'stale' : 'would-be-stale'} ${stage} response ` +
    `${enforcing ? 'rejected' : 'observed'} — mode=${mode} reason=${reason} ` +
    `closureScanId=${closure?.scanId ?? null} responseScanId=${responseScanId} ` +
    `activeScanId=${active?.scanId ?? null} ` +
    `closureGeneration=${closure?.generation ?? null} ` +
    `activeGeneration=${active?.generation ?? null}`
  );
};

// GrailKey Directive U, Task 2 (GK-87, closing the picker-required race
// scope) — a correction changing activeScanRef must reject a stale
// gradeBlob write REGARDLESS of CURRENT_SCAN_OWNERSHIP_MODE. That constant
// stays SHADOW for every other staleness cause (scan-vs-scan included) —
// flipping it wholesale is explicitly out of scope, pending the shadow-
// window read the rollout plan requires first. shouldAcceptScanResponse
// already returns accepted:false (reason 'scanid-mismatch') the moment a
// correction has superseded a scan's closure; what's missing is a way for
// a call site to choose ENFORCE specifically for THAT cause while every
// other cause still defers to the shared constant. `kind` is a plain tag
// ('scan' | 'correction') on the ownership object set by the two callers
// that mint one (gradeBlob, submitManualCorrection) — the same
// {scanId, generation} shape plus one field, not a parallel mechanism.
//
// CORRECTED, GrailKey Directive V, Task 2 (GK-88, ownership perimeter) —
// the version above was item-BLIND: it rejected on ANY correction,
// anywhere in the app, regardless of which comic it targeted. Proven live
// against the real, already-shipped Directive U code (Part 0 of this
// dispatch's test, DIRECT): a correction on comic A would wrongly discard
// a completely unrelated, still-valid gradeBlob/refreshMarketData/etc.
// response for comic B — a global kill switch, not a guard, exactly the
// shape this directive's mandatory cross-item control test exists to
// catch. `itemId` (a plain field on the SAME ownership object, not a new
// mechanism) now scopes the check: rejection fires ONLY when the active
// correction targets the SAME item the stale closure was writing to.
// itemId is `null` for gradeBlob's transient grade-stage closure specifically
// (the item doesn't exist yet — addToCatalogue hasn't resolved) and for
// any producer whose target item isn't yet known; in that state the
// correction-supersession special case never fires (there is no item
// identity to compare), and the write falls back to whatever
// CURRENT_SCAN_OWNERSHIP_MODE already governs — never a behavior change
// for that case, since it was never eligible for ENFORCE to begin with.
export const wasSupersededByCorrection = (closure, active) =>
  !!active
  && active.kind === 'correction'
  && active.scanId !== closure?.scanId
  && closure?.itemId != null
  && active.itemId != null
  && closure.itemId === active.itemId;

// The single orchestration point BOTH gradeBlob's write sites (App.jsx)
// and this feature's tests call — the exact same function, not a
// test-local reimplementation, so a test that exercises this function
// exercises the real integration, not just the isolated predicate.
//
//   stage    — 'grade' | 'enrich', for logging only.
//   response — the parsed response body.
//   closure  — { scanId, generation } captured at scan capture time.
//   active   — activeScanRef.current at call time.
//   mode     — SCAN_OWNERSHIP_MODE.SHADOW | .ENFORCE.
//   applyFn  — () => void, performs the real state write (e.g.
//              setResult(...)). Called when the response is accepted, OR
//              unconditionally in SHADOW mode (shadow never blocks a
//              write, by definition).
//
// Returns the acceptance verdict ({ accepted, reason }) for callers that
// want it (tests, mostly) — but the write decision itself is fully
// handled here; callers never need their own mode branch.
export const applyScanOwnershipGuard = (stage, response, closure, active, mode, applyFn) => {
  const verdict = shouldAcceptScanResponse(response, closure, active);
  if (!verdict.accepted) {
    logStaleScanResponse(stage, response, closure, active, verdict.reason, mode);
  }
  if (verdict.accepted || mode === SCAN_OWNERSHIP_MODE.SHADOW) {
    applyFn();
  }
  return verdict;
};
