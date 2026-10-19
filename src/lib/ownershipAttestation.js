// V1 CERTIFICATION — P0-D: durable owned-asset creation requires an EXPLICIT ownership attestation.
//
// A scan, a quick lookup, a reference photo and a photo of a screen are not possession. Minting a physical
// asset (a gk_asset with an owner) is the one place that asserts "this principal holds this object", so the
// operator must state that, in words, at the moment of the act. The statement is fixed and versioned so a bare
// boolean cannot stand in for it; the server records it (and the time it received it) in the asset's
// `asset.minted` domain event. This is an ASSERTION by the operator, recorded as such — never a verification
// that the object exists, and nothing here reads or claims screen detection.

export const OWNERSHIP_ATTESTATION_VERSION = 1;
export const OWNERSHIP_ATTESTATION_STATEMENT =
  'I physically possess this item, and the photo I am saving shows the item itself.';
export const OWNERSHIP_ATTESTATION_REQUIRED_CODE = 'OWNERSHIP_ATTESTATION_REQUIRED';
export const CAPTURE_REFERENCE_ONLY_CODE = 'CAPTURE_REFERENCE_ONLY';

/** Client: the exact object to send. `surface` names the UI that collected it. */
export function buildOwnershipAttestation(surface) {
  return {
    attested: true,
    version: OWNERSHIP_ATTESTATION_VERSION,
    statement: OWNERSHIP_ATTESTATION_STATEMENT,
    surface: typeof surface === 'string' ? surface.slice(0, 40) : 'unknown',
  };
}

/** Server: returns the normalized attestation, or null when missing/invalid. Never throws. */
export function normalizeOwnershipAttestation(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.attested !== true) return null;
  if (raw.version !== OWNERSHIP_ATTESTATION_VERSION) return null;
  if (raw.statement !== OWNERSHIP_ATTESTATION_STATEMENT) return null;
  return {
    attested: true,
    version: OWNERSHIP_ATTESTATION_VERSION,
    statement: OWNERSHIP_ATTESTATION_STATEMENT,
    surface: typeof raw.surface === 'string' ? raw.surface.slice(0, 40) : 'unknown',
  };
}
