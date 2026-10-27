// src/lib/listingApproval.js -- V1.1a: the SELLER'S APPROVAL of one exact listing package, signed by the server.
//
// A generated package is not permission to publish. Approval is a separate act: the authenticated seller reviews the preview
// and the server (api/listing-preview.js, action "approve") signs {principal, asset, packageHash, approvedAt}. api/list-ebay.js
// verifies that signature and that the hash still equals the package it would publish RIGHT NOW (title, description body,
// specifics, ordered photo hashes, price). Any change -- a correction, a new photo, a different price -- invalidates it.
//
// HMAC-SHA256 under a key derived from the server session secret with its own purpose label (so a session token or an
// authority receipt can never double as a listing approval). Stateless, principal-bound, asset-bound. Two independent freshness
// rules: the package hash (any content change invalidates it) and a 24-hour lifetime (a human review does not stay valid forever). Pure (node:crypto only).

import { createHmac, timingSafeEqual } from 'node:crypto';

export const LISTING_APPROVAL_VERSION = 1;
/** A review is not good forever: an approval older than this is refused even when the package is unchanged. */
export const LISTING_APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

const key = () => {
  const s = process.env.GRAILKEY_SESSION_SECRET;
  if (!s || s.length < 32) return null; // same 32-char floor as the auth module; fail closed below it
  return createHmac('sha256', s).update('grailkey/listing-approval/v1').digest();
};

const stable = (v) => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
};

/** @returns {{v:number,principalId:string,body:string,sig:string}|null} null when it cannot be issued. */
export function issueListingApproval({ principalId, gkAssetId, packageHash, now = Date.now() } = {}) {
  const k = key();
  if (!k || !principalId || !gkAssetId || !packageHash) return null;
  const body = stable({ gkAssetId, packageHash, approvedAt: now });
  const sig = createHmac('sha256', k).update(`${LISTING_APPROVAL_VERSION}.${principalId}.${body}`).digest('base64url');
  return { v: LISTING_APPROVAL_VERSION, principalId, body, sig };
}

/** @returns {{ok:true,payload:{gkAssetId:string,packageHash:string,approvedAt:number}}|{ok:false,reason:string}} Never throws. */
export function verifyListingApproval(approval, principalId) {
  try {
    const k = key();
    if (!k) return { ok: false, reason: 'no-secret' };
    if (!approval || typeof approval !== 'object') return { ok: false, reason: 'absent' };
    if (approval.v !== LISTING_APPROVAL_VERSION) return { ok: false, reason: 'version' };
    if (!principalId || approval.principalId !== principalId) return { ok: false, reason: 'principal-mismatch' };
    if (typeof approval.body !== 'string' || typeof approval.sig !== 'string') return { ok: false, reason: 'malformed' };
    const expected = createHmac('sha256', k).update(`${LISTING_APPROVAL_VERSION}.${principalId}.${approval.body}`).digest();
    const given = Buffer.from(approval.sig, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: 'bad-signature' };
    const payload = JSON.parse(approval.body);
    if (!payload || typeof payload.packageHash !== 'string' || typeof payload.gkAssetId !== 'string') return { ok: false, reason: 'malformed' };
    return { ok: true, payload };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

/**
 * The publish-time check: signature + principal + asset + the hash of the package that would publish now.
 * @returns {{ok:true}|{ok:false,reason:string}}
 */
export function checkListingApproval(approval, { principalId, gkAssetId, currentPackageHash, now = Date.now() }) {
  const v = verifyListingApproval(approval, principalId);
  if (!v.ok) return { ok: false, reason: v.reason === 'absent' ? 'absent' : `invalid:${v.reason}` };
  if (v.payload.gkAssetId !== gkAssetId) return { ok: false, reason: 'asset-mismatch' };
  const at = Number(v.payload.approvedAt);
  if (!Number.isFinite(at) || now - at > LISTING_APPROVAL_TTL_MS || at - now > CLOCK_SKEW_MS) return { ok: false, reason: 'expired' };
  if (!currentPackageHash) return { ok: false, reason: 'package-unavailable' };
  if (v.payload.packageHash !== currentPackageHash) return { ok: false, reason: 'stale-package' };
  return { ok: true };
}
