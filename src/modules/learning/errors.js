// src/modules/learning/errors.js
export class LearningModuleError extends Error {
  constructor(message) { super(message); this.name = this.constructor.name; }
}
export class ValidationFailedError extends LearningModuleError {}
export class IdempotencyConflictError extends LearningModuleError {}
