// src/modules/inventory/index.js — PUBLIC. The only file outside
// src/modules/inventory/ may import. db.js, errors.js, idempotency.js,
// and repository.js are never imported directly by anything outside
// this directory.

export {
  enrollAsset,
  reserveAsset,
  releaseReservation,
  markSold,
  getInventoryState,
  assertListable,
} from './service.js';

export {
  InventoryModuleError,
  NotFoundError,
  ValidationFailedError,
  AuthorizationFailedError,
  ConflictError,
  IdempotencyConflictError,
} from './errors.js';

// Test/shutdown only.
export { closePool } from './db.js';
