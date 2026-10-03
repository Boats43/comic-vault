// src/modules/capture/index.js — PUBLIC. The only file anything outside
// src/modules/capture/ may import. Re-exports captureFromScan and the
// Asset Service's own error taxonomy (re-thrown verbatim by this
// module's orchestration, never wrapped or renamed) — nothing else.
// mapping.js is never re-exported here and never imported directly by
// any file outside this directory (see
// tests/capture-module-boundary.test.js).
//
// See docs/adr/DATA-1-CAPTURE-INTEGRATION.md for the full design.

export { captureFromScan, listSaveTimeCopyCandidates, confirmSameCopyAtSave, recordAnotherCopyAtSave, assertPhysicalCopySaveAllowed } from './service.js';

export {
  AssetServiceError,
  NotFoundError,
  ConflictError,
  IdempotentReplayError,
  IdempotencyConflictError,
  ValidationFailedError,
  AuthorizationFailedError,
  PhysicalCopyDecisionRequiredError,
  PhysicalCopyCandidateCheckUnavailableError,
} from '../assets/index.js';

export { __setCandidateCheckFaultForTests } from '../assets/index.js';
