// tests/helpers/c1ListEbayStubs.mjs -- LOCAL stand-ins for every module api/list-ebay.js uses to touch a database, a
// session or the seller's eBay connection. Installed by c1ListEbayHooks.mjs (a module-resolution hook) so the REAL
// handler runs unmodified against them. Every call is recorded on globalThis.__C1.calls so a test can prove that a
// refused request made ZERO writes and ZERO provider-side calls. Nothing here reaches a network or a database.
import { EBAY_MEDIA_SCOPE } from '../../src/lib/ebayMediaApi.js';

const C1 = (globalThis.__C1 ||= { calls: [], cfg: {} });
const rec = (name, arg) => { C1.calls.push(name); return arg; };

export class NotFoundError extends Error {}
export class InvalidTokenError extends Error {}
export class AuthorizationFailedError extends Error {}
export class ValidationFailedError extends Error {}
export class ListingAttemptBlockedError extends Error {}
export class ListingPreflightFailedError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
export class EbayConnectionRequiredError extends Error {}
export class EbayReconnectRequiredError extends Error {}
export class EbayTemporaryFailureError extends Error {}
export class EbayTokenResolutionInternalError extends Error {}

// Session: "Bearer tok:<principalId>" resolves to that principal.
export const verifyToken = (t) => { rec('verifyToken'); if (!String(t).startsWith('tok:')) throw new InvalidTokenError('bad'); return { principalId: String(t).slice(4) }; };
export const requireMarketplaceOperator = async (req) => { rec('requireMarketplaceOperator'); return { ok: true }; };

// Reads (counted, not "writes").
export const getMyCollectionItem = async ({ principalId, id }) => { rec('getMyCollectionItem'); return { id, attributes: C1.cfg.rowAttributes }; };
export const getCanonicalCollectionItemIdForAsset = async () => { rec('getCanonicalCollectionItemIdForAsset'); return C1.cfg.canonicalRowId; };
export const getAssetMediaContentHashes = async () => { rec('getAssetMediaContentHashes'); return C1.cfg.mediaHashes; };
export const validateOutcomeAttachment = async () => { rec('validateOutcomeAttachment'); };
export const assertListingAuthorized = async () => { rec('assertListingAuthorized'); };
export const getOperatorActionForListing = async () => { rec('getOperatorActionForListing'); return { actionValueAmount: C1.cfg.listActionAmount }; };
export const resolveOwnedAssetForListing = async () => { rec('resolveOwnedAssetForListing'); return { found: false }; };
export const resolveCollectionItemLink = async () => { rec('resolveCollectionItemLink'); return undefined; };
// GK-P0 READY-RACE: the publication mutex is a DB-level primitive; this DB-free harness always grants it (and it is not a WRITE).
export const acquirePublicationMutex = async () => { rec('acquirePublicationMutex'); return { acquired: true, release: async () => {} }; };

// Writes / provider-side (every one of these must stay at ZERO on a refusal).
export const authorizeOperatorManualListing = async () => { rec('WRITE:authorizeOperatorManualListing'); return { attemptId: 'a1b2c3d4-e5f6-4789-8abc-def012345678', providerCorrelation: { uuid: 'A1B2C3D4E5F647898ABCDEF012345678', sku: 'GK-A1B2C3D4E5F647898ABCDEF012345678' } }; };
export const recordMarketplaceAttemptPhase = async () => { rec('WRITE:recordMarketplaceAttemptPhase'); };
export const recordOutcomeEvent = async () => { rec('WRITE:recordOutcomeEvent'); return {}; };
export const attemptListedOutcome = async () => { rec('WRITE:attemptListedOutcome'); return { attempted: false }; };
export const resolveEbayUserAccessToken = async () => { rec('WRITE:resolveEbayUserAccessToken'); return { accessToken: 'at-c1', scopes: [EBAY_MEDIA_SCOPE] }; };
