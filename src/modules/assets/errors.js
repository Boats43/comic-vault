// src/modules/assets/errors.js
//
// Typed error taxonomy for the Asset Service (DATA-1B). Every error extends
// AssetServiceError with a stable `.code` so a future API layer can map
// these to HTTP statuses without string-matching `.message`.
//
// See docs/adr/DATA-1B-ASSET-SERVICE-DESIGN.md, Section 3, for the
// rationale behind each class (including why IdempotentReplayError is
// named but never actually thrown — a replay is a successful return, not
// an error).

export class AssetServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
  }
}

export class NotFoundError extends AssetServiceError {
  constructor(message) {
    super('NOT_FOUND', message);
  }
}

export class ConflictError extends AssetServiceError {
  constructor(message) {
    super('CONFLICT', message);
  }
}

// Never thrown by this module — kept in the taxonomy for a future HTTP
// layer that may want to render a replay distinguishably. See the design
// doc, Section 3.
export class IdempotentReplayError extends AssetServiceError {
  constructor(message) {
    super('IDEMPOTENT_REPLAY', message);
  }
}

export class ValidationFailedError extends AssetServiceError {
  constructor(message) {
    super('VALIDATION_FAILED', message);
  }
}

export class AuthorizationFailedError extends AssetServiceError {
  constructor(message) {
    super('AUTHORIZATION_FAILED', message);
  }
}
