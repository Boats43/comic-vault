// src/lib/gradeAttempt.js — GK-281: PAID GRADING WORKFLOW IDEMPOTENCY.
//
// GOVERNING INVARIANT: ONE LOGICAL SCAN ATTEMPT -> AT MOST ONE PAID GRADING WORKFLOW.
//
// A "workflow" may legitimately invoke several provider calls (Watch Mode: Haiku, Haiku, Opus; a book or
// voice-context scan: two Sonnet calls). What is prohibited is starting a SECOND workflow for the same
// logical attempt. The attempt, not the image, is the unit: identity = (principal, attemptId) bound to a
// canonical input fingerprint (all images + workflow parameters). An image hash alone is NEVER the identity —
// a deliberate re-grade of identical bytes is a NEW attempt with a new attemptId.
//
// DURABLE STATE (Upstash, via the same fail-closed store the spend guard uses; a process-local mutex or an
// image-hash cache would not survive a second serverless instance). One KEY PER GENERATION, claimed with the
// atomic SET-NX primitive that already exists on the store, so there is NO compare-and-swap and NO automatic
// takeover: after the SET-NX claim only the owner ever writes that key.
//
//   PENDING                  claimed; no provider call has begun (written first, before the spend guard)
//   IN_PROGRESS              written IMMEDIATELY BEFORE the first provider call; from here a billed call may exist
//   COMPLETED                result + proof durably recorded; replayable with zero provider calls / zero spend
//   FAILED_BEFORE_INVOCATION safely retryable: the provider provably did not complete a call for this attempt
//   UNCERTAIN                a provider call may have been billed and no completed result is established.
//                            DERIVED, never written by a reader: IN_PROGRESS whose lease has expired, or an explicit
//                            failure after invocation with no definitive provider rejection.
//
// WHY A LEASE EXPIRY IS SAFE: api/grade.js runs under maxDuration 60 s (vercel.json), so the owner is provably dead
// 60 s after the request began. LEASE_MS = 60 s + a 30 s clock-skew margin. A stale PENDING (owner died before the
// IN_PROGRESS write, so no provider call ever started) is therefore provably unbilled and the next generation may
// proceed. A stale IN_PROGRESS is NEVER promoted to a new paid workflow: it is UNCERTAIN, and the only paid way out
// is an operator-authorized NEW attemptId.
//
// RECOVERY WITHOUT A PAID CALL: before the durable prediction events are written, the finished result (and the exact
// context needed to rebuild the events) is checkpointed into the attempt record. The prediction events use a
// DETERMINISTIC resultId derived from (principal, attemptId), and recordModelPrediction is idempotent on
// (principal, surface, resultId), so a resume after a crash between "events written" and "COMPLETED recorded" re-runs
// the same writes as a no-op and returns the original result. A crash BEFORE the checkpoint (provider billed, nothing
// durable) cannot be recovered: that is the one window this design cannot make exactly-once, and it is reported, never
// silently re-billed.

import { createHash } from 'node:crypto';
import { ResearchStoreUnavailableError } from './researchStore.js';
import { defaultSpendStore } from './spendGuard.js';
import { counterKey } from './gradeProvenanceObservability.js';

// Attempt outcomes are counted in the SAME daily counter family as the grade-provenance counters (so one query reads
// them all), but logged under their OWN tag: `[grade-provenance]` means "a prediction/receipt was attempted" and tests
// (and operators) rely on that meaning, so a claim/replay/bypass must never emit it. Never throws, never blocks > 800 ms.
export async function observeAttempt({ outcome, branch = 'standard', store = null, now = new Date() } = {}) {
  try { console.log(`[grade-attempt] ${JSON.stringify({ outcome, branch })}`); } catch { /* logging must never affect a scan */ }
  try {
    const st = store || defaultSpendStore();
    const key = counterKey({ day: now.toISOString().slice(0, 10), kind: 'attempt', outcome, branch, model: null, buildSha: null, predictionKind: null });
    let timer;
    await Promise.race([st.incr(key, 35 * 24 * 60 * 60), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('attempt counter timeout')), 800); })]).finally(() => clearTimeout(timer));
  } catch { /* observability only */ }
}

export const ATTEMPT_STATES = Object.freeze({
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  FAILED_BEFORE_INVOCATION: 'FAILED_BEFORE_INVOCATION',
  UNCERTAIN: 'UNCERTAIN',
});

export const ATTEMPT_RECORD_VERSION = 1;
// Mirrors vercel.json functions["api/grade.js"].maxDuration (pinned by a static test).
export const GRADE_FUNCTION_MAX_DURATION_MS = 60_000;
export const LEASE_SKEW_MARGIN_MS = 30_000;
export const LEASE_MS = GRADE_FUNCTION_MAX_DURATION_MS + LEASE_SKEW_MARGIN_MS;
// Outlives the 30-day grade proof so a held copy can still replay its original result.
export const ATTEMPT_TTL_SECONDS = 30 * 24 * 60 * 60;
export const MAX_GENERATIONS = 6;
export const IN_FLIGHT_RETRY_AFTER_SECONDS = 3;

export class AttemptStoreUnavailableError extends Error {
  constructor(msg = 'grade attempt store unavailable') { super(msg); this.name = 'AttemptStoreUnavailableError'; }
}

const ATTEMPT_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
export const isValidAttemptId = (v) => typeof v === 'string' && ATTEMPT_ID_RE.test(v);

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const clean = (s) => String(s).replace(/[^A-Za-z0-9._:-]/g, '_');
const clone = (o) => JSON.parse(JSON.stringify(o));

export const attemptKey = (principalId, attemptId, gen = 0) => `ga:v1:${clean(principalId)}:${clean(attemptId)}:g${gen}`;

// A deterministic, uuid-shaped result id: the SAME attempt always maps to the SAME prediction-event identity,
// which is what makes a resume idempotent. Domain-separated; it carries no input.
export function deriveResultId(principalId, attemptId) {
  const h = sha256(`gk281-result-id-v1|${principalId}|${attemptId}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// CANONICAL INPUT IDENTITY: every image (not just the first) plus every parameter that changes which paid
// workflow runs. scanId (a per-request ownership token) and any authority-looking legacy field are excluded.
export function computeAttemptFingerprint({ workflow, images, voiceContext = null, targetItemId = null, predictionKind = null, imageViews = null } = {}) {
  const imgs = Array.isArray(images) ? images.map((i) => (typeof i === 'string' ? sha256(i) : 'non-string')) : [];
  const canon = JSON.stringify({
    v: 1,
    w: workflow === 'watch' ? 'watch' : 'standard',
    imgs,
    vc: typeof voiceContext === 'string' && voiceContext ? voiceContext : null,
    tgt: typeof targetItemId === 'string' && targetItemId ? targetItemId : null,
    pk: typeof predictionKind === 'string' ? predictionKind : null,
    iv: Array.isArray(imageViews) ? imageViews.map((x) => (x == null ? null : String(x))) : null,
  });
  return `sha256:${sha256(canon)}`;
}

// A provider "definitive rejection": the provider returned an HTTP error status, so no completed (billed) call exists.
// Timeouts, resets and a parse failure AFTER a successful response are NOT definitive (a billed call may exist).
export const isDefinitiveProviderRejection = (err) => Number.isInteger(err?.status) && err.status >= 400 && err.status <= 599;

const wrapStore = async (fn) => {
  try { return await fn(); } catch (e) {
    if (e instanceof AttemptStoreUnavailableError) throw e;
    if (e instanceof ResearchStoreUnavailableError) throw new AttemptStoreUnavailableError(e.message);
    throw new AttemptStoreUnavailableError(e?.message || 'grade attempt store error');
  }
};

const leaseLive = (rec, now) => Number.isFinite(rec?.leaseUntil) && now < rec.leaseUntil;

/** The state a READER should act on (never written back as UNCERTAIN by a reader). */
export function effectiveState(rec, now = Date.now()) {
  switch (rec?.state) {
    case ATTEMPT_STATES.COMPLETED: return ATTEMPT_STATES.COMPLETED;
    case ATTEMPT_STATES.FAILED_BEFORE_INVOCATION: return ATTEMPT_STATES.FAILED_BEFORE_INVOCATION;
    case ATTEMPT_STATES.UNCERTAIN: return ATTEMPT_STATES.UNCERTAIN;
    case ATTEMPT_STATES.PENDING: return leaseLive(rec, now) ? ATTEMPT_STATES.PENDING : ATTEMPT_STATES.FAILED_BEFORE_INVOCATION; // provably never invoked
    case ATTEMPT_STATES.IN_PROGRESS: return leaseLive(rec, now) ? ATTEMPT_STATES.IN_PROGRESS : ATTEMPT_STATES.UNCERTAIN;
    default: return ATTEMPT_STATES.UNCERTAIN; // unknown shape: never assume it is safe to bill again
  }
}

function makeHandle({ store, principalId, attemptId, fingerprint, workflow, gen, record, now }) {
  const key = attemptKey(principalId, attemptId, gen);
  const resultId = deriveResultId(principalId, attemptId);
  let rec = record;
  let invoked = false;
  let providerCompletedCalls = 0;
  let lastError = null;

  const write = async (patch) => {
    rec = { ...rec, ...patch, updatedAt: now() };
    await wrapStore(() => store.set(key, clone(rec), ATTEMPT_TTL_SECONDS));
  };

  return {
    attempted: true,
    attemptId, principalId, gen, resultId, key,
    get state() { return rec.state; },
    get invocationStarted() { return invoked; },
    get providerCompletedCalls() { return providerCompletedCalls; },
    // PENDING -> IN_PROGRESS, IMMEDIATELY before the first provider call. Idempotent. If this write fails the call is
    // never made (the error propagates and the attempt is failed-before-invocation).
    async beginInvocation() {
      if (invoked) return;
      await write({ state: ATTEMPT_STATES.IN_PROGRESS, invokedAt: now(), leaseUntil: now() + LEASE_MS });
      invoked = true;
    },
    noteProviderSuccess() { providerCompletedCalls += 1; },
    noteProviderError(err) { lastError = err; },
    // The finished result + exact context needed to rebuild the durable events, BEFORE any event is written.
    async checkpoint(snapshot) {
      await write({ checkpoint: clone(snapshot) });
    },
    async complete(finalResult) {
      const { checkpoint: _drop, ...rest } = rec;
      rec = rest;
      await write({ state: ATTEMPT_STATES.COMPLETED, completedAt: now(), result: clone(finalResult), leaseUntil: null });
    },
    // Decide from what actually happened. Never throws (best-effort marker; absence is read as UNCERTAIN/lease expiry).
    async failFromError(err = lastError) {
      try {
        if (rec.state === ATTEMPT_STATES.COMPLETED) return rec.state;
        const noBilledCall = !invoked || (providerCompletedCalls === 0 && isDefinitiveProviderRejection(err));
        if (noBilledCall) {
          await write({ state: ATTEMPT_STATES.FAILED_BEFORE_INVOCATION, failure: !invoked ? 'PRE_INVOCATION' : 'PROVIDER_REJECTED', leaseUntil: null });
        } else {
          await write({ state: ATTEMPT_STATES.UNCERTAIN, failure: providerCompletedCalls > 0 ? 'AFTER_PROVIDER_SUCCESS_NO_RESULT' : 'PROVIDER_OUTCOME_UNKNOWN' });
        }
        return rec.state;
      } catch { return rec.state; }
    },
    async failBeforeInvocation(reason = 'PRE_INVOCATION') {
      try {
        if (invoked) return this.failFromError();
        await write({ state: ATTEMPT_STATES.FAILED_BEFORE_INVOCATION, failure: reason, leaseUntil: null });
      } catch { /* a stale PENDING reads as failed-before-invocation after the lease anyway */ }
      return rec.state;
    },
    snapshotRecord: () => clone(rec),
    fingerprint, workflow,
  };
}

/**
 * Atomically claim (or classify) an attempt. Never makes a provider call and never reserves spend.
 *
 *   { kind:'OWNER', handle }
 *   { kind:'REPLAY', result, record }
 *   { kind:'IN_FLIGHT', retryAfterSeconds }
 *   { kind:'UNCERTAIN', record, hasCheckpoint }   — the caller may complete from the checkpoint with no paid call
 *   { kind:'MISMATCH' } | { kind:'EXHAUSTED' }
 * Throws AttemptStoreUnavailableError when the store cannot be used (the handler fails closed BEFORE any paid call).
 */
export async function claimAttempt({ principalId, attemptId, fingerprint, workflow = 'standard', store = null, now = () => Date.now() } = {}) {
  if (!principalId || !isValidAttemptId(attemptId) || typeof fingerprint !== 'string') {
    throw new Error('claimAttempt requires principalId, a valid attemptId and a fingerprint');
  }
  const st = store || defaultSpendStore();
  for (let gen = 0; gen < MAX_GENERATIONS; gen += 1) {
    const key = attemptKey(principalId, attemptId, gen);
    let rec = await wrapStore(() => st.get(key));
    if (!rec) {
      const fresh = {
        v: ATTEMPT_RECORD_VERSION, principalId, attemptId, gen, fingerprint, workflow,
        state: ATTEMPT_STATES.PENDING, claimedAt: now(), leaseUntil: now() + LEASE_MS, updatedAt: now(),
      };
      const won = await wrapStore(() => st.setNx(key, clone(fresh), ATTEMPT_TTL_SECONDS));
      if (won) return { kind: 'OWNER', handle: makeHandle({ store: st, principalId, attemptId, fingerprint, workflow, gen, record: fresh, now }) };
      // Lost the race: another request claimed this generation between our read and our SET-NX. Re-read it.
      rec = await wrapStore(() => st.get(key));
      if (!rec) { gen -= 1; continue; }
    }
    if (rec.principalId !== principalId || rec.attemptId !== attemptId) return { kind: 'MISMATCH' }; // defense in depth: key is already scoped
    if (rec.fingerprint !== fingerprint) return { kind: 'MISMATCH' };
    const eff = effectiveState(rec, now());
    if (eff === ATTEMPT_STATES.COMPLETED) {
      if (rec.result) return { kind: 'REPLAY', result: clone(rec.result), record: rec };
      return { kind: 'UNCERTAIN', record: rec, hasCheckpoint: false }; // COMPLETED with no stored result: never a licence to bill again
    }
    if (eff === ATTEMPT_STATES.PENDING || eff === ATTEMPT_STATES.IN_PROGRESS) return { kind: 'IN_FLIGHT', retryAfterSeconds: IN_FLIGHT_RETRY_AFTER_SECONDS };
    if (eff === ATTEMPT_STATES.UNCERTAIN) return { kind: 'UNCERTAIN', record: rec, hasCheckpoint: !!(rec.checkpoint && rec.checkpoint.result) };
    // FAILED_BEFORE_INVOCATION (explicit, or a stale PENDING): provably unbilled -> try the next generation.
    if (rec.state === ATTEMPT_STATES.PENDING) {
      // Record the fact for observability; harmless if two readers write the same marker (the owner is provably dead).
      try { await st.set(key, clone({ ...rec, state: ATTEMPT_STATES.FAILED_BEFORE_INVOCATION, failure: 'LEASE_EXPIRED_PENDING', leaseUntil: null, updatedAt: now() }), ATTEMPT_TTL_SECONDS); } catch { /* best effort */ }
    }
  }
  return { kind: 'EXHAUSTED' };
}

/**
 * Write COMPLETED for an UNCERTAIN record that holds a checkpoint, after the caller has (idempotently) re-run the
 * durable event writes. Safe to run from several resumers concurrently: identical content, no paid call.
 */
export async function completeRecovered({ record, finalResult, store = null, now = () => Date.now() } = {}) {
  const st = store || defaultSpendStore();
  const key = attemptKey(record.principalId, record.attemptId, record.gen);
  const { checkpoint: _drop, ...rest } = record;
  const next = { ...rest, state: ATTEMPT_STATES.COMPLETED, completedAt: now(), result: clone(finalResult), leaseUntil: null, recovered: true, updatedAt: now() };
  await wrapStore(() => st.set(key, clone(next), ATTEMPT_TTL_SECONDS));
  return next;
}

/** A no-op stand-in for a request that carries no attemptId (legacy client). It enforces NOTHING; the handler counts it as a bypass. */
export const LEGACY_NO_ATTEMPT = Object.freeze({
  attempted: false,
  resultId: undefined,
  invocationStarted: false,
  async beginInvocation() {},
  noteProviderSuccess() {},
  noteProviderError() {},
  async checkpoint() {},
  async complete() {},
  async failFromError() {},
  async failBeforeInvocation() {},
});

/** 'required' | 'optional' (default). Flipping to required is a rollout step, not a code change. */
export const attemptEnforcement = (env = process.env) => (String(env.GRADE_ATTEMPT_ENFORCEMENT || '').toLowerCase() === 'required' ? 'required' : 'optional');
