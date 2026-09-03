// src/modules/valuation/errors.js — PUBLIC (re-exported via index.js).
// Mirrors src/modules/assets/errors.js's own taxonomy exactly, own
// class instances (not shared/imported) so this module's errors are
// never confused with the assets module's own error identity via
// instanceof checks.

export class ValuationServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
  }
}

export class NotFoundError extends ValuationServiceError {
  constructor(message) { super('NOT_FOUND', message); }
}

export class ValidationFailedError extends ValuationServiceError {
  constructor(message) { super('VALIDATION_FAILED', message); }
}

export class AuthorizationFailedError extends ValuationServiceError {
  constructor(message) { super('AUTHORIZATION_FAILED', message); }
}

// GK-163 pattern, own copy (see idempotency.js header for why this is
// a deliberate duplication, not a shared import from assets/).
export class IdempotencyConflictError extends ValuationServiceError {
  constructor(message) { super('IDEMPOTENCY_CONFLICT', message); }
}

// W2 -- not thrown. evaluateMarketPopulation returns a typed skip
// result (never an exception) when the request lacks a durable
// subject -- Section 1's own required outcomes ("No exception reaches
// the pricing response"). Named here so a future real-handler
// integration (not this dispatch) can recognize the shape by a stable
// string, not by parsing prose.
export const SKIP_REASONS = Object.freeze({
  NO_DURABLE_SUBJECT: 'SKIP_NO_DURABLE_SUBJECT',
  UNLINKED_SUBJECT: 'SKIP_UNLINKED_SUBJECT',
});
