// src/modules/collection/index.js — PUBLIC. The only file anything
// outside src/modules/collection/ may import. Re-exports the service
// functions and error classes — nothing else. repository.js and db.js
// are never re-exported here and never imported directly by any file
// outside this directory (see tests/collection-module-boundary.test.js).

export {
  listMyCollection,
  getMyCollectionItem,
  createCollectionItem,
  updateCollectionItem,
  deleteCollectionItem,
  getRemoteImageUri,
  saveCollectionItemWithGradeClaim, // GK-280A — api/collection.js only, with a VERIFIED proof/receipt; save + association in one transaction
  claimModelBaseline, // GK-261 — api/collection.js only, with a server-claimed receipt
  applyIdentityAuthorityPatch, // GK-261 — api/enrich.js only, after a validated manual correction
  applyGradingAuthorityPatch, // GK-260 — internal callers only (api/enrich.js); never wired to a public HTTP route
} from './service.js';

export {
  CollectionModuleError,
  ValidationFailedError,
  AuthorizationFailedError,
  NotFoundError,
  CategoryImmutableError,
} from './errors.js';

// Test/shutdown only.
export { closePool } from './db.js';
