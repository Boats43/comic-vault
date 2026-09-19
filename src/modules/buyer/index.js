// src/modules/buyer/index.js — PUBLIC. The only file outside
// src/modules/buyer/ may import. db.js, errors.js, idempotency.js, and
// repository.js are never imported directly by anything outside this
// directory.

export {
  appendBuyerDecision,
  appendBuyerAcquisition,
  listBuyerDecisions,
} from './service.js';

export {
  BuyerModuleError,
  NotFoundError,
  ValidationFailedError,
  AuthorizationFailedError,
  IdempotencyConflictError,
} from './errors.js';

// Test/shutdown only — see src/modules/assets/index.js's closePool for
// the same rationale.
export { closePool } from './db.js';
