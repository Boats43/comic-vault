// src/modules/collection/errors.js — typed error taxonomy, same shape as
// src/modules/assets/errors.js: every error extends CollectionModuleError
// with a stable `.code`, so api/collection.js can map to an HTTP status
// without string-matching `.message`.

export class CollectionModuleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
  }
}

export class ValidationFailedError extends CollectionModuleError {
  constructor(message) {
    super('VALIDATION_FAILED', message);
  }
}

// U1 — category is IMMUTABLE once a row exists: ordinary writes (refresh, re-push,
// stale clients) can never change it, and there is no reclassification feature.
export class CategoryImmutableError extends CollectionModuleError {
  constructor(message) {
    super('ASSET_CATEGORY_IMMUTABLE', message);
  }
}

export class AuthorizationFailedError extends CollectionModuleError {
  constructor(message) {
    super('AUTHORIZATION_FAILED', message);
  }
}

// Same "indistinguishable from not-found to an unauthorized caller"
// convention every other DATA-1 module uses — never leaks whether a
// given id belongs to someone else.
export class NotFoundError extends CollectionModuleError {
  constructor(message) {
    super('NOT_FOUND', message);
  }
}
