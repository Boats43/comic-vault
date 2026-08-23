// src/modules/auth/index.js — PUBLIC. The only file anything outside
// src/modules/auth/ may import. Re-exports login/verifyToken and the
// error classes — nothing else. repository.js, db.js, token.js, and
// credentials.js are never re-exported here and never imported directly
// by any file outside this directory (see
// tests/auth-module-boundary.test.js).
//
// See docs/adr/DATA-1D-AUTH-CROSS-DEVICE.md for the full design.

export { login, verifyToken } from './service.js';

export {
  AuthModuleError,
  InvalidCredentialError,
  InvalidTokenError,
  NotProvisionedError,
} from './errors.js';

// Test/shutdown only — see src/modules/assets/index.js's closePool for
// the same rationale.
export { closePool } from './db.js';
