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
