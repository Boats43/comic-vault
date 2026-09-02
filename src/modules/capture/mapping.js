// src/modules/capture/mapping.js — PRIVATE. Never imported outside
// src/modules/capture/ — enforced by tests/capture-module-boundary.test.js.
//
// Pure functions only — no I/O, no DB, no storage calls. Every function
// here takes a `scanPayload` shaped like the REAL, already-proven
// `scanLog` record (`src/lib/scanLog.js`, GK-145/146 fields) — NOT the
// full ephemeral `out.*` HTTP response `api/enrich.js` produces, which
// is never persisted anywhere (confirmed, docs/DATA-1-READINESS.md,
// section A1) and therefore isn't available as real input to test
// against. This is a disclosed, deliberate scoping choice for this
// dispatch — see docs/adr/DATA-1-CAPTURE-INTEGRATION.md, Task 1b.
//
// Real fields this module reads, confirmed against real scanLog records
// pulled via find-real-scan.mjs/find-aww-scan.mjs (not assumed):
//   book: { title, issue, year }
//   issueAuthority: { status, reasons, ... } | null   (issue-facet ONLY —
//     scanLog does not track title/year/variant authority separately;
//     see mapIdentityEvidence's own disclosed approximation below)
//   correlationId, collectionItemId, scanlogKey (not a real field on the
//     record itself, but the KV key it was stored under — callers may
//     pass it through scanPayload.scanlogKey as a fallback capture-basis
//     seed when correlationId is absent)
//   evidence: { promptVersion }   (a real git SHA, confirmed)
//   outcome: { decisionAction, pricingSource, price, gradeMultiplier }

// D3.1 (candidate-safe mint basis) — `candidateDiscriminator` is an
// OPTIONAL 3rd parameter, added additively. Every existing caller
// (today: src/modules/capture/service.js's captureFromScan, always
// calling this with 2 arguments) is byte-for-byte unaffected: when
// `candidateDiscriminator` is omitted, `key` is computed by the exact
// same expression this function has always used, and the returned
// object has the exact same 5 keys in the exact same order — so
// JSON.stringify(...) of the result is identical to what this function
// produced before this change, for the same (principalId, scanPayload)
// inputs (D3 Amendment A1 — see tests/d3-1-candidate-safe-mint-basis.test.js
// for the regression vectors proving this, and that file's own header
// comment for why a live-row byte-comparison isn't the applicable proof
// here: this function has never been the writer of any of the 110 real
// entity_mint_basis rows in data1_dev today — captureFromScan has no
// live caller yet, confirmed by grep across api/).
//
// A future multi-candidate caller (D8's own CaptureSession/Observation/
// ObjectCandidate graph — NOT built here) MAY pass a 3rd argument, one
// per distinct physical candidate detected within the SAME observation
// (same principalId + correlationId/scanlogKey). When present, it
// becomes a namespaced SUFFIX of `key` — a capture-basis component only.
// It is never written to `book`, never treated as catalog/variant/
// external identity, and never reaches any gk_asset column (gk_asset
// carries only id/asset_class/status/mint_basis_id/created_at — see
// db/data0/0004_data1_foundation.sql — none of which this function ever
// touches). Two different discriminators under the same observation
// produce two different `key` strings, so entity_mint_basis's existing
// UNIQUE (basis_namespace, basis_key) constraint — unmodified by this
// change — mints two distinct gk_asset rows instead of colliding them
// onto one (Law 2). The same discriminator replayed against the same
// observation reproduces the same `key` string, so the SAME existing
// constraint resolves it to the SAME asset instead of minting a second
// one for what is still the same physical candidate.
export function buildCaptureBasis(principalId, scanPayload, candidateDiscriminator) {
  const hasDiscriminator = candidateDiscriminator !== undefined && candidateDiscriminator !== null;
  const sessionKey = scanPayload.correlationId ? scanPayload.correlationId : scanPayload.scanlogKey;
  const key = hasDiscriminator
    ? `${principalId}/${sessionKey}/candidate:${candidateDiscriminator}`
    : `${principalId}/${sessionKey}`;
  const basis = {
    namespace: 'asset:capture',
    key,
    book: scanPayload.book ?? null,
    correlationId: scanPayload.correlationId ?? null,
    scanlogKey: scanPayload.scanlogKey ?? null,
  };
  if (hasDiscriminator) {
    // Provenance/basis-composition metadata only — participates in `key`
    // (above), which is what actually drives entity_mint_basis's
    // uniqueness check; this field itself is for audit/debugging
    // legibility, the same role basis_schema_version/mint_policy_version
    // already play one layer up (0003's own basis-key stability clause).
    basis.candidateDiscriminator = candidateDiscriminator;
  }
  return basis;
}

// CORROBORATED/CONTESTED/NONE is a single, whole-asset value in DATA-1B's
// assignIdentity contract — scanLog only tracks per-facet authority for
// the ISSUE facet (issueAuthority), not title/year/variant. This is
// therefore a disclosed APPROXIMATION, not a full facet-by-facet
// translation: an explicit issue-conflict signal wins (CONTESTED); a
// complete-looking book record with no conflict signal is treated as
// CORROBORATED (a real, but coarser, signal than the full per-facet
// ledger `api/enrich.js`'s own ephemeral `out.*` object would allow); an
// incomplete book record (Ruling 10's unknown-identity case) is NONE.
export function mapIdentityEvidence(scanPayload) {
  const book = scanPayload.book || {};
  const hasCompleteIdentity = !!(book.title && book.issue && book.year);
  if (scanPayload.issueAuthority?.status === 'conflicted') {
    return { authority: 'CONTESTED', source: 'vision' };
  }
  if (hasCompleteIdentity) {
    return { authority: 'CORROBORATED', source: 'vision' };
  }
  return { authority: 'NONE', source: 'unresolved' };
}

export function hasValuation(scanPayload) {
  return !!(scanPayload.outcome && scanPayload.outcome.price);
}

// scanLog's outcome.price is a formatted string ("$6.91"), not a number
// — real field shape, confirmed against real records, not assumed.
export function mapValuation(scanPayload) {
  const valueAmount = Number(String(scanPayload.outcome.price).replace(/[^0-9.]/g, ''));
  return {
    valueAmount,
    valueCurrency: 'USD',
    // 'engine-computed' is the real enum value valuation_event.method
    // actually has (src/modules/assets — requireEnum(['engine-computed',
    // 'operator-override', 'gocollect', 'other'])). The comic-vault
    // pricing pipeline IS the engine this value names.
    method: 'engine-computed',
    compSnapshotRef: scanPayload.correlationId ? `scanlog:${scanPayload.correlationId}` : null,
    // scanLog does not carry a numeric grade field (only
    // gradeMultiplier, a derived ratio, not a grade) — left null rather
    // than mis-mapping gradeMultiplier into a grade-shaped column.
    gradeAssumption: null,
    buildSha: scanPayload.evidence?.promptVersion || 'unknown',
  };
}

export function hasDecision(scanPayload) {
  return !!(scanPayload.outcome && scanPayload.outcome.decisionAction);
}

export function mapDecision(scanPayload, valuationResult) {
  return {
    recommendation: scanPayload.outcome.decisionAction,
    // scanLog does not carry decision.blockers/warnings (confirmed
    // against real records) — pricingSource is the one real, always-
    // present outcome field worth surfacing as a reason code; never
    // fabricating blocker/warning codes scanLog doesn't actually have.
    reasonCodes: scanPayload.outcome.pricingSource ? [scanPayload.outcome.pricingSource] : [],
    valuationEventId: valuationResult?.valuationEventId ?? null,
  };
}

// scanLog carries no cost-basis field at all (confirmed —
// docs/DATA-1-READINESS.md A4: purchasePrice lives only in the client's
// IndexedDB record, never sent to the server). A real captureFromScan
// caller may still pass an explicit `scanPayload.acquisition` block
// (e.g. operator-entered at capture time) — this mapping exists for that
// case; scanLog itself never populates it.
export function hasAcquisition(scanPayload) {
  return !!(scanPayload.acquisition && scanPayload.acquisition.costAmount != null);
}

export function mapAcquisition(scanPayload) {
  return {
    costAmount: scanPayload.acquisition.costAmount,
    costCurrency: scanPayload.acquisition.costCurrency || 'USD',
    source: scanPayload.acquisition.source || 'other',
    lotReference: scanPayload.acquisition.lotReference ?? null,
  };
}
