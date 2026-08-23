// src/modules/assets/index.js — PUBLIC. The only file anything outside
// src/modules/assets/ may import. Re-exports the service functions and
// the error classes — nothing else. repository.js, db.js, and
// idempotency.js are never re-exported here and never imported directly
// by any file outside this directory (see
// tests/assets-module-boundary.test.js, S3-11).
//
// See docs/adr/DATA-1B-ASSET-SERVICE-DESIGN.md for the full design.

export {
  createPhysicalAsset,
  getPhysicalAsset,
  listMyAssets,
  getMediaById,
  assignIdentity,
  correctIdentity,
  attachMediaMetadata,
  attachMedia,
  transferOwnership,
  recordAcquisition,
  recordValuation,
  recordDecision,
  linkCollectionItem,
  resolveCollectionItemLink,
} from './service.js';

export {
  AssetServiceError,
  NotFoundError,
  ConflictError,
  IdempotentReplayError,
  IdempotencyConflictError,
  ValidationFailedError,
  AuthorizationFailedError,
} from './errors.js';

// Test/shutdown only — not part of the operational contract, but a real
// proof suite running many scripts against a pooled connection needs a
// clean way to exit. Not re-exported as a "service operation."
export { closePool } from './db.js';
