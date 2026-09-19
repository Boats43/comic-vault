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
} from './service.js';

export {
  CollectionModuleError,
  ValidationFailedError,
  AuthorizationFailedError,
  NotFoundError,
} from './errors.js';

// Test/shutdown only.
export { closePool } from './db.js';
