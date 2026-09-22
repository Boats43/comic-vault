// GET/POST /api/asset-recovery -> src/lib/assetRecoveryHandler.js's
// handleAssetRecovery. U4.4 / Ruling 46 — server-side, authenticated,
// cross-device physical-orphan / missing-projection detection and
// Case B recovery. See that file's own header for the full design.
import { handleAssetRecovery } from '../src/lib/assetRecoveryHandler.js';

export default async function handler(req, res) {
  return handleAssetRecovery(req, res);
}
