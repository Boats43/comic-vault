// src/modules/auth/errors.js — PUBLIC (re-exported via index.js).
// Typed error taxonomy for the Auth module (DATA-1D, T1). Mirrors the
// AssetServiceError shape (common base + stable .code), same discipline,
// a different module — deliberately NOT reusing AssetServiceError's own
// classes: "authentication failed" (no valid session at all) and
// "authorization failed" (a real session, not permitted for this
// resource) are different concerns owned by different modules — auth/
// owns the former, assets/ (AuthorizationFailedError, unchanged) owns
// the latter.

export class AuthModuleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
  }
}

// Login failed — wrong passphrase, or no operator principal to log in as.
export class InvalidCredentialError extends AuthModuleError {
  constructor(message) {
    super('INVALID_CREDENTIAL', message);
  }
}

// A supplied token is missing, malformed, has a bad signature, or is
// expired. Deliberately one error class for all four cases (not
// distinguished further) — a caller checking "is this session valid"
// never needs to know WHY it failed, and distinguishing would leak
// information useful to an attacker probing token validity.
export class InvalidTokenError extends AuthModuleError {
  constructor(message) {
    super('INVALID_TOKEN', message);
  }
}

// The auth module cannot function right now — GRAILKEY_SESSION_SECRET
// unset, or no credential has ever been provisioned for the operator
// principal. A real, disclosed environment gap, not a caller error.
export class NotProvisionedError extends AuthModuleError {
  constructor(message) {
    super('NOT_PROVISIONED', message);
  }
}
