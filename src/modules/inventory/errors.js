// src/modules/inventory/errors.js — mirrors src/modules/assets/errors.js's
// typed error taxonomy exactly.

export class InventoryModuleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
  }
}

export class NotFoundError extends InventoryModuleError {
  constructor(message) { super('NOT_FOUND', message); }
}

export class ValidationFailedError extends InventoryModuleError {
  constructor(message) { super('VALIDATION_FAILED', message); }
}

export class AuthorizationFailedError extends InventoryModuleError {
  constructor(message) { super('AUTHORIZATION_FAILED', message); }
}

// The atomic-reservation-lost / illegal-transition case — a real
// business-rule conflict (e.g. "not currently AVAILABLE"), distinct
// from IdempotencyConflictError below (a replay-mechanism mismatch).
export class ConflictError extends InventoryModuleError {
  constructor(message) { super('CONFLICT', message); }
}

// GK-163 class-wide law — the same idempotencyKey was reused for a
// request whose semantic payload doesn't match the original call.
export class IdempotencyConflictError extends InventoryModuleError {
  constructor(message) { super('IDEMPOTENCY_CONFLICT', message); }
}
