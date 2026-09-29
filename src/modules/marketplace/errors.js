// src/modules/marketplace/errors.js — mirrors src/modules/assets/errors.js
// and src/modules/inventory/errors.js's typed error taxonomy exactly.

export class MarketplaceModuleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
  }
}

export class NotFoundError extends MarketplaceModuleError {
  constructor(message) { super('NOT_FOUND', message); }
}

export class ValidationFailedError extends MarketplaceModuleError {
  constructor(message) { super('VALIDATION_FAILED', message); }
}

export class AuthorizationFailedError extends MarketplaceModuleError {
  constructor(message) { super('AUTHORIZATION_FAILED', message); }
}

export class ConflictError extends MarketplaceModuleError {
  constructor(message) { super('CONFLICT', message); }
}

// Governing dispatch, Section 6 — a DIFFERENT principal already holds an
// active connection for the exact same (provider, providerUserId) pair.
// Distinct from the generic ConflictError so a future caller can react
// specifically ("this account is connected elsewhere") instead of
// treating it like an ordinary state-transition conflict. Fail-closed:
// never overwrites, never reassigns ownership.
export class ProviderIdentityConflictError extends MarketplaceModuleError {
  constructor(message) { super('PROVIDER_IDENTITY_CONFLICT', message); }
}
