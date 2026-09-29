// src/modules/marketplace/index.js — PUBLIC. The only file anything
// outside src/modules/marketplace/ may import. Re-exports the service
// functions and the error classes — nothing else. repository.js,
// db.js, and crypto.js are never re-exported here and never imported
// directly by any file outside this directory (see
// tests/marketplace-module-boundary.test.js).
//
// GK-263 Phase 1 — storage + ownership + encryption primitives only.
// No HTTP handler in this repo imports this module yet.

export {
  upsertMarketplaceConnection,
  getMarketplaceConnection,
  resolveMarketplaceRefreshCredential,
  markMarketplaceReconnectRequired,
  disconnectMarketplaceConnection,
} from './service.js';

export {
  MarketplaceModuleError,
  NotFoundError,
  ConflictError,
  ValidationFailedError,
  AuthorizationFailedError,
  ProviderIdentityConflictError,
} from './errors.js';

// Test/shutdown only.
export { closePool } from './db.js';
