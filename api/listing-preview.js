// POST /api/listing-preview -- V1.1a: the seller-reviewable eBay LISTING PACKAGE for one owned physical asset.
//
//   { action: 'preview', gkAssetId, price, draft? }   -> the exact package that would publish (draft = unsaved what-if edits)
//   { action: 'approve', gkAssetId, price }           -> the same package built from the DURABLE saved draft + a server-signed
//                                                        approval bound to {principal, asset, packageHash}
//
// READ-ONLY: this endpoint writes nothing, calls no seller-authenticated eBay API and publishes nothing. It reads the owned
// asset's durable canonical catalogue row and durable media rows (ownership-checked), and (cached, app-token) eBay category
// metadata. A package is not permission to publish: api/list-ebay.js independently rebuilds the package and verifies the
// signed approval before any eBay call.
//
// Auth: verified GrailKey session (Bearer). Principal comes ONLY from the token; the asset must be owned by it.

import { verifyToken, InvalidTokenError } from '../src/modules/auth/index.js';
import { getCanonicalCollectionItemIdForAsset, listAssetMediaForListing, NotFoundError, AuthorizationFailedError } from '../src/modules/assets/index.js';
import { getMyCollectionItem } from '../src/modules/collection/index.js';
import { getAspectMetadata, getItemConditionPolicy } from '../src/lib/ebayListingMetadata.js';
import { buildListingPackage } from '../src/lib/listingPackage.js';
import { issueListingApproval } from '../src/lib/listingApproval.js';
import { verifyAuthorityReceipt } from '../src/lib/authorityReceipt.js';
import { checkRateLimit } from './rate-limit.js';

const CATEGORY_ID = '259104'; // Comics & Graphic Novels -- the same category api/list-ebay.js publishes to

function extractBearerToken(req) {
  const header = req.headers?.authorization || req.headers?.Authorization;
  return header && header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : null;
}

const sanitizeDraft = (d) => {
  const o = d && typeof d === 'object' ? d : {};
  const ids = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.length <= 64).slice(0, 24) : undefined);
  return {
    titleOverride: typeof o.titleOverride === 'string' ? o.titleOverride.slice(0, 200) : undefined,
    conditionNote: typeof o.conditionNote === 'string' ? o.conditionNote.slice(0, 1000) : undefined,
    selectedMediaIds: ids(o.selectedMediaIds),
    excludedMediaIds: ids(o.excludedMediaIds),
  };
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let principalId;
  try {
    ({ principalId } = verifyToken(extractBearerToken(req)));
  } catch (e) {
    if (e instanceof InvalidTokenError) return res.status(401).json({ error: 'Missing, invalid, or expired token' });
    console.error('[listing-preview] unexpected token-verification error:', e?.message || e);
    return res.status(500).json({ error: 'Internal error' });
  }

  // Authenticated first, then a per-principal rate limit (a shared anonymous bucket would let one user starve another).
  const rateCheck = checkRateLimit(req, { principalId });
  res.setHeader('x-ratelimit-remaining', String(rateCheck.remaining));
  if (!rateCheck.allowed) {
    res.setHeader('retry-after', String(rateCheck.reset));
    return res.status(429).json({ error: rateCheck.error, retryAfter: rateCheck.reset });
  }

  const { action = 'preview', gkAssetId, price, draft } = req.body || {};
  if (action !== 'preview' && action !== 'approve') return res.status(400).json({ error: 'LISTING_PREVIEW_BAD_ACTION' });
  if (typeof gkAssetId !== 'string' || !gkAssetId) return res.status(400).json({ error: 'gkAssetId required' });
  const amount = Number(price);

  let governed; let media;
  try {
    const canonicalId = await getCanonicalCollectionItemIdForAsset({ principalId, gkAssetId });
    if (!canonicalId) return res.status(409).json({ error: 'LISTING_FACTS_UNAVAILABLE', message: 'This asset has no governed catalogue row.' });
    const row = await getMyCollectionItem({ principalId, id: canonicalId });
    governed = row?.attributes || null;
    if (!governed || !governed.title) return res.status(409).json({ error: 'LISTING_FACTS_UNAVAILABLE', message: 'The governed catalogue row has no title.' });
    media = await listAssetMediaForListing({ principalId, gkAssetId });
  } catch (e) {
    // Not owned / not found / any lookup failure: one opaque answer, nothing about other principals' assets.
    const code = e instanceof AuthorizationFailedError || e instanceof NotFoundError ? 404 : 500;
    if (code === 500) console.error('[listing-preview] lookup failed:', e?.message || e);
    return res.status(code).json({ error: code === 404 ? 'Not found' : 'Internal error' });
  }

  let aspectMeta = null; let conditionPolicy = null; let metadataError = null;
  try { [aspectMeta, conditionPolicy] = await Promise.all([getAspectMetadata(CATEGORY_ID), getItemConditionPolicy(CATEGORY_ID)]); }
  catch (e) { metadataError = 'eBay category metadata is unavailable'; }

  // The seller's saved corrections live on the durable row. A preview may overlay unsaved what-if edits; an APPROVAL never does.
  const durableDraft = sanitizeDraft(governed.listingDraft);
  const effectiveDraft = action === 'preview' && draft ? sanitizeDraft(draft) : durableDraft;

  const receipt = verifyAuthorityReceipt(governed.authorityReceipt, principalId);
  const pricingSource = receipt.ok ? (receipt.payload.values?.pricingSource ?? null) : null;

  const pkg = buildListingPackage({
    governed, draft: effectiveDraft, media, price: amount, pricingSource, aspectMeta, conditionPolicy,
    isTPB: governed.isTPB === true, isMagazine: governed.isMagazine === true,
  });
  if (metadataError) pkg.unresolved.push({ field: 'metadata', severity: 'blocking', message: metadataError });

  if (action === 'preview') return res.status(200).json({ package: pkg, approval: null, draft: effectiveDraft });

  if (!pkg.approvable) {
    return res.status(409).json({ error: 'LISTING_PACKAGE_NOT_APPROVABLE', message: 'Resolve the blocking items before approving.', package: pkg });
  }
  const approval = issueListingApproval({ principalId, gkAssetId, packageHash: pkg.packageHash });
  if (!approval) return res.status(503).json({ error: 'LISTING_APPROVAL_UNAVAILABLE', message: 'The approval could not be signed.' });
  return res.status(200).json({ package: pkg, approval, draft: durableDraft });
}
