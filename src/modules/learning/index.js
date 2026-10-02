// src/modules/learning/index.js -- PUBLIC. The only file anything outside
// src/modules/learning/ may import (db.js and repository.js are private).
//
// WRITER SURFACE (server-side callers only; none is wired to an HTTP route):
//   recordModelPrediction            -- api/grade.js's own inference path only
//   appendOperatorCorrectionEventTx  -- src/modules/collection's own transaction only

export {
  recordModelPrediction,
  getModelPredictionEvent,
  appendOperatorCorrectionEventTx,
  listOperatorCorrectionEvents,
  canonicalJson,
  sha256Hex,
} from './service.js';

export { LearningModuleError, ValidationFailedError, IdempotencyConflictError } from './errors.js';

// Test/shutdown only.
export { closePool } from './db.js';
