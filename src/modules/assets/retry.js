// src/modules/assets/retry.js — PRIVATE. Only service.js imports this.
//
// B7 (D4 Phase B) — a narrow, generic bounded-retry helper for exactly
// one recognized transient failure class: PostgreSQL SQLSTATE 40P01
// (deadlock detected). Extracted as its own small, dependency-free
// function specifically so the retry ALGORITHM itself (attempt counting,
// which errors are retryable, what gets thrown on exhaustion) can be
// unit-tested deterministically, in isolation from any real database
// connection — see tests/d4-identifier-fabric-retry-unit.test.js. The
// live, real-database proof that a genuine Postgres-generated 40P01
// actually reaches this code path is a SEPARATE, live-only proof
// (tests/d4-identifier-fabric-live-concurrency.test.js) — neither proof
// substitutes for the other (B7a).
//
// Deliberately narrow: only 40P01 is retried. Every other error —
// constraint violations, CHECK violations, immutable-history rejections,
// the "already superseded"/"target already superseded" semantic
// rejections (plpgsql RAISE EXCEPTION with no explicit SQLSTATE defaults
// to P0001, never 40P01) — propagates on the FIRST attempt, unretried.
// Retrying a genuine integrity/validation rejection would never succeed
// and would misrepresent a real defect as a transient one.
export const RETRYABLE_SQLSTATES = Object.freeze(['40P01']);

// onAttemptError -- OPTIONAL, test/observability only. Real callers
// never pass this. It exists so a live concurrency proof can observe
// the actual internal (attempt, error.code) sequence a genuine
// Postgres-generated failure produces, rather than inferring it from
// the call's final outward result alone (tests/d4-identifier-fabric-
// live-concurrency.test.js, B7a) -- it changes no retry behavior.
export async function withRetryOn40P01(fn, { maxAttempts = 3, onAttemptError } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      lastError = e;
      onAttemptError?.(attempt, e);
      if (!RETRYABLE_SQLSTATES.includes(e?.code)) throw e;
      // retryable — fall through to the next attempt.
    }
  }
  throw lastError;
}
