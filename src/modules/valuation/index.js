// src/modules/valuation/index.js — PUBLIC. The only file anything
// outside src/modules/valuation/ may import. Re-exports the service
// functions and the error classes -- nothing else. repository.js,
// db.js, and idempotency.js are never re-exported here and never
// imported directly by any file outside this directory (see
// tests/valuation-module-boundary.test.js).
//
// D5D isolated-writer-design dispatch (GrailKey, 2026-09-03). ZERO
// production call sites -- nothing under api/ imports this file.
// Runtime wiring into any live request path is explicitly HOLD until
// Milestone Ten's independent phone proof closes (CLAUDE.md, "WHAT
// MUST NOT BE DONE"). GK-180 (zero writer call sites) is unaffected by
// this module's existence.

export {
  resolveEligibleSubject,
  evaluateMarketPopulation,
  getEvaluatedPopulation,
  attemptDurablePersistence,
} from './service.js';

export {
  ValuationServiceError,
  NotFoundError,
  ValidationFailedError,
  AuthorizationFailedError,
  IdempotencyConflictError,
  SKIP_REASONS,
} from './errors.js';

// Test/shutdown only.
export { closePool } from './db.js';
