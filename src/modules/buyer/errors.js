// src/modules/buyer/errors.js — mirrors src/modules/assets/errors.js's
// typed error taxonomy exactly (stable `.code` for a future HTTP layer
// to map without string-matching `.message`).

export class BuyerModuleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
  }
}

export class NotFoundError extends BuyerModuleError {
  constructor(message) {
    super('NOT_FOUND', message);
  }
}

export class ValidationFailedError extends BuyerModuleError {
  constructor(message) {
    super('VALIDATION_FAILED', message);
  }
}

export class AuthorizationFailedError extends BuyerModuleError {
  constructor(message) {
    super('AUTHORIZATION_FAILED', message);
  }
}

// GK-163 class-wide law — the same idempotencyKey was reused for a
// request whose semantic payload doesn't match the original call.
export class IdempotencyConflictError extends BuyerModuleError {
  constructor(message) {
    super('IDEMPOTENCY_CONFLICT', message);
  }
}
