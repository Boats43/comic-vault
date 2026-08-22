// src/modules/media/errors.js
//
// Typed error taxonomy for the Media Storage Adapter (DATA-1C). Mirrors
// src/modules/assets/errors.js's shape (a common base with a stable
// `.code`) — same discipline, a different module.
//
// See docs/adr/DATA-1C-MEDIA-DESIGN.md, Task 2, for the rationale behind
// each class.

export class MediaStorageError extends Error {
  constructor(code, message) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
  }
}

// The caller's declared sha256 does not match the sha256 actually
// computed from the received bytes. Nothing is stored when this throws
// (Task 2b / C5).
export class HashMismatchError extends MediaStorageError {
  constructor(message) {
    super('HASH_MISMATCH', message);
  }
}

// The adapter detected an attempt to write different bytes under a key
// that already holds different content — structurally should never
// happen under correct content-addressing (the key IS the hash of the
// bytes), so this only fires on a real hash collision or a driver bug.
// Never thrown for "same bytes, same key" — that path is the documented
// idempotent no-op (Task 2b), not an error.
export class ImmutabilityViolationError extends MediaStorageError {
  constructor(message) {
    super('IMMUTABILITY_VIOLATION', message);
  }
}

export class MediaNotFoundError extends MediaStorageError {
  constructor(message) {
    super('MEDIA_NOT_FOUND', message);
  }
}

// The selected driver cannot actually run right now — e.g. the
// vercel-blob driver was selected but no store/token is provisioned
// (Task 1 / C7). Distinct from a bug: this is a real, disclosed
// environment gap, not a defect in the adapter's own logic.
export class NotProvisionedError extends MediaStorageError {
  constructor(message) {
    super('NOT_PROVISIONED', message);
  }
}
