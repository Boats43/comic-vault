// tests/helpers/c1ReceiptFixtures.mjs -- TEST-ONLY authority-receipt fixtures for the live-handler publication suites.
//
// The C1 gate (api/list-ebay.js, 2bac0db) refuses every publish unless the OWNED ASSET'S durable canonical catalogue row carries
// an `authorityReceipt` that (a) verifies (HMAC, bound to the authenticated principal), (b) matches the row's identity
// (issue + >=50% title words), (c) is bound to THIS canonical row AND THIS gk_asset, and (d) carries the CURRENT media evidence
// version (hash of the asset's durable media content hashes). The receipt has no wall-clock expiry: staleness is evidence-version.
//
// These helpers produce receipts with the REAL issueAuthorityReceipt (the same function api/enrich.js uses) and the test
// process's own GRAILKEY_SESSION_SECRET. Nothing here weakens or bypasses the gate: a receipt is only valid for the exact
// principal / row / asset / evidence it was issued for, and every field can be corrupted on purpose for negative tests.

import { issueAuthorityReceipt, computeEvidenceVersion } from '../../src/lib/authorityReceipt.js';

/**
 * An enrich-shaped response (what api/enrich.js would have signed) for one identity. The DEFAULT is the honest standing the
 * Development Creepy asset has always had: a thin, ask-derived price with NO sold evidence -> RESEARCH / not READY. That is
 * the state the Q41 acknowledged-price suites were written for (the operator acknowledges an exact price on a non-READY book),
 * so a receipt must back the evidence WITHOUT silently upgrading the asset to READY. Pass `readyResponse()` for a READY standing.
 */
export function enrichLikeResponse(identity, overrides = {}) {
  return {
    title: identity.title, issue: identity.issue ?? null, year: identity.year ?? null,
    decision: { action: 'RESEARCH', blockers: [], warnings: [], confidence: 'LOW' },
    pricingSource: 'active_ask_derived',
    matchConfidence: { tier: 'LOW', score: 40 },
    identityConfident: true,
    refusedToPrice: false,
    soldCompDiagnostics: { rawCount: 0, verifiedCount: 0, newestDaysAgo: null },
    contract: { state: 'REVIEW', locks: [] },
    rawComps: { count: 2 },
    soldComps: [],
    ...overrides,
  };
}

/** Overrides for a READY-capable standing (verified sold evidence, high confidence) -- for tests of the READY path. */
export const readyResponse = () => ({
  decision: { action: 'LIST_NOW', blockers: [], warnings: [], confidence: 'HIGH' },
  pricingSource: 'verified_sold',
  matchConfidence: { tier: 'HIGH', score: 95 },
  soldCompDiagnostics: { rawCount: 6, verifiedCount: 6, newestDaysAgo: 9 },
  contract: { state: 'READY', locks: [] },
  rawComps: { count: 12 },
  soldComps: [{}, {}, {}, {}, {}, {}],
});

/**
 * Issue a receipt for one row. `bind` overrides let a negative test corrupt exactly one binding dimension:
 *   { collectionItemId, gkAssetId, evidenceVersion } (use `null` to leave a member unbound)
 */
export function issueFixtureReceipt({ principalId, collectionItemId, gkAssetId, contentHashes, identity, bind = {}, response = {} }) {
  const evidenceVersion = computeEvidenceVersion(contentHashes);
  const binding = {
    collectionItemId: 'collectionItemId' in bind ? bind.collectionItemId : collectionItemId,
    gkAssetId: 'gkAssetId' in bind ? bind.gkAssetId : gkAssetId,
    evidenceVersion: 'evidenceVersion' in bind ? bind.evidenceVersion : evidenceVersion,
  };
  const receipt = issueAuthorityReceipt({ principalId, response: enrichLikeResponse(identity, response), binding });
  if (!receipt) throw new Error('fixture receipt could not be issued (GRAILKEY_SESSION_SECRET must be >= 32 chars)');
  return receipt;
}

/**
 * Write `attrs` + a freshly issued receipt onto each transient canonical row (direct SQL on the test's OWN transient rows --
 * grade-authority keys are server-protected from ordinary collection writes, and the receipt is stored exactly as a real
 * enrich-signed receipt would be after /api/collection governance).
 */
export async function installFixtureReceipts({ client, schema = 'data1_dev', rowIds, principalId, gkAssetId, contentHashes, attrs, bind, response, tamper }) {
  for (const id of rowIds) {
    let receipt = issueFixtureReceipt({ principalId, collectionItemId: id, gkAssetId, contentHashes, identity: attrs, bind, response });
    if (tamper) receipt = tamper(receipt, id);
    const stored = receipt === undefined ? { ...attrs } : { ...attrs, authorityReceipt: receipt };
    await client.query(`UPDATE ${schema}.collection_item SET attributes = $1::jsonb WHERE id = $2 AND principal_id = $3`, [JSON.stringify(stored), id, principalId]);
  }
}
