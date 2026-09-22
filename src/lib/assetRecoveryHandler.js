// src/lib/assetRecoveryHandler.js — U4.4 / Ruling 46 — HARNESS-ONLY
// HTTP-shaped handler, same pattern as captureScanHandler.js: composes
// two peer modules' PUBLIC surfaces (src/modules/assets/,
// src/modules/collection/) from outside both, exactly mirroring
// src/modules/capture/service.js's own precedent for cross-module
// orchestration — capture/service.js already composes assets+media the
// same way, so this file composes assets+collection the same way for
// the same reason: neither module may write to the other's tables
// directly (module-boundary discipline, tests/assets-module-boundary
// and tests/collection-module-boundary), so anything that needs both
// lives one layer up.
//
// GET  -> detection only. Returns { physicalOrphans, missingProjections }
//         for the authenticated principal (Ruling 46, Case A / Case B).
// POST -> { action: 'recoverProjection', collectionItemId } — Case B's
//         recovery only. Re-creates the collection_item row using the
//         EXACT collectionItemId already recorded on the real
//         collection_item_link row (never invents a new id — the same
//         physical asset must never acquire two different catalogue
//         ids). assetCategory is read from the real gk_asset.asset_class
//         this link points at, never guessed or defaulted to 'comic'.
//         The recreated row's `attributes` is honestly minimal (no
//         fabricated name/description — those only ever existed in the
//         client draft this recovery path exists because we don't have).
//
// Case A (physical orphan) is detection-only in this dispatch — Ruling
// 46 itself designs its full recovery action (mint a fresh
// collection_item_id, complete link+projection) as separate, larger
// future work, not required here.
//
// principalId is NEVER accepted from the request body — derived
// exclusively from the caller's Bearer token, the same boundary every
// other real endpoint in this project already relies on.

import { verifyToken, InvalidTokenError } from '../modules/auth/index.js';
import {
  listPhysicalOrphans, listMissingProjections, getPhysicalAsset,
  NotFoundError as AssetNotFoundError,
  AuthorizationFailedError as AssetAuthorizationFailedError,
} from '../modules/assets/index.js';
import {
  createCollectionItem,
  ValidationFailedError as CollectionValidationFailedError,
} from '../modules/collection/index.js';

function extractBearerToken(req) {
  const header = req.headers?.authorization || req.headers?.Authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
}

export async function handleAssetRecovery(req, res) {
  const token = extractBearerToken(req);
  let principalId;
  try {
    ({ principalId } = verifyToken(token));
  } catch (e) {
    if (e instanceof InvalidTokenError) {
      return res.status(401).json({ error: 'Missing, invalid, or expired token' });
    }
    console.error('[asset-recovery] unexpected token-verification error:', e?.message || e);
    return res.status(500).json({ error: 'Internal error' });
  }

  try {
    if (req.method === 'GET') {
      const [physicalOrphans, missingProjections] = await Promise.all([
        listPhysicalOrphans({ principalId }),
        listMissingProjections({ principalId }),
      ]);
      return res.status(200).json({
        physicalOrphans: physicalOrphans.map((r) => ({
          gkAssetId: r.gk_asset_id, assetClass: r.asset_class, createdAt: r.created_at,
        })),
        missingProjections: missingProjections.map((r) => ({
          collectionItemId: r.collection_item_id, gkAssetId: r.gk_asset_id,
        })),
      });
    }

    if (req.method === 'POST') {
      const { action, collectionItemId } = req.body || {};
      if (action !== 'recoverProjection') {
        return res.status(400).json({ error: 'Unsupported action' });
      }
      if (!collectionItemId) {
        return res.status(400).json({ error: 'collectionItemId is required' });
      }
      // Re-verify the link independently rather than trusting the
      // caller's own GET result — this call must be safe even if a
      // client replays a stale/forged collectionItemId that no longer
      // (or never did) belong to a real missing-projection case for
      // THIS principal.
      const missing = await listMissingProjections({ principalId });
      const target = missing.find((r) => r.collection_item_id === collectionItemId);
      if (!target) {
        return res.status(404).json({
          error: 'NOT_A_MISSING_PROJECTION',
          message: 'No missing-projection case exists for this collectionItemId and principal.',
        });
      }
      // getPhysicalAsset independently re-checks ownership (never trusts
      // the anti-join alone) and is the one place asset_class is read
      // from — the real, durable gk_asset row, never guessed.
      const graph = await getPhysicalAsset({ principalId, gkAssetId: target.gk_asset_id });
      const assetCategory = graph.asset?.asset_class || 'comic';
      const created = await createCollectionItem({
        principalId,
        id: collectionItemId,
        assetCategory,
        attributes: {
          _recoveredAt: new Date().toISOString(),
          _recoveryNote: 'Auto-recovered after a capture that never reached the projection step. Name/description were never durably captured server-side and are not fabricated here.',
        },
      });
      return res.status(200).json({ recovered: true, collectionItem: created });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    if (e instanceof AssetNotFoundError || e instanceof AssetAuthorizationFailedError) {
      return res.status(404).json({ error: 'Not found' });
    }
    if (e instanceof CollectionValidationFailedError) {
      return res.status(400).json({ error: e.message });
    }
    console.error('[asset-recovery] unexpected error:', e?.message || e);
    return res.status(500).json({ error: 'Internal error' });
  }
}
