// tests/helpers/listingApprovalFixture.mjs -- TEST-ONLY: obtain the seller's server-signed LISTING-PACKAGE APPROVAL for a publish
// request from the REAL api/listing-preview.js "approve" action (same auth, same durable row + media, same eBay-metadata mock).
// Nothing is forged or bypassed: if the real endpoint declines to approve (non-approvable package, wrong principal, unknown
// asset) no approval is attached and the publish handler's own refusal is what the test observes.
//
//   const attachApproval = makeApprover({ repoRoot, mockRes });
//   await attachApproval(req);           // mutates req.body.listingApproval when the real endpoint approves
//   req.__noApproval = true              // opt out for the negative case

import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function makeApprover({ repoRoot, mockRes, tag = 'approver' }) {
  let seq = 0;
  let previewHandler = null;
  return async function attachApproval(req) {
    const b = req?.body || {};
    if (!b.gkAssetId || b.listingApproval || req.__noApproval) return req;
    previewHandler ||= (await import(pathToFileURL(path.join(repoRoot, 'api', 'listing-preview.js')).href)).default;
    const pm = String(b.price ?? b.priceHigh ?? b.priceLow ?? '').replace(/,/g, '').match(/[\d.]+/);
    const res = mockRes();
    // each approval call looks like a distinct client so the endpoint's per-principal+IP limiter (30/10 min) is not tripped by a long suite
    await previewHandler({ method: 'POST', headers: { ...req.headers, 'x-forwarded-for': `${tag}-${++seq}` }, body: { action: 'approve', gkAssetId: b.gkAssetId, price: pm ? parseFloat(pm[0]) : null } }, res);
    if (res.statusCode === 200 && res.body?.approval) b.listingApproval = res.body.approval;
    return req;
  };
}
