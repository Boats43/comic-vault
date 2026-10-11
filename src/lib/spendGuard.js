// src/lib/spendGuard.js — DURABLE SPEND GUARD (LIVE EXPOSURE CLOSURE,
// 2026-10-04). Abuse / provider-spend protection only: no billing, no plans,
// no dashboard.
//
// WHY THIS EXISTS: api/rate-limit.js is an in-memory Map, PER SERVERLESS
// INSTANCE — it cannot coordinate across Vercel instances and resets on every
// cold start, so it is a burst limiter, NOT a spend control. With open Google
// signup, nothing durable bounded Anthropic/eBay/PriceCharting spend per
// account or in total. This guard is that bound.
//
// MECHANISM: atomic Upstash Redis INCRBY on two UTC-day-keyed counters,
// via the SAME fail-closed store api/research-market.js already trusts
// (src/lib/researchStore.js): one per principal, one global. Reserve-then-
// check on the exact post-increment value, so concurrent callers each see a
// distinct count and cannot jointly exceed a cap; a refused call refunds its
// own units, so refusals never burn budget. The reservation happens BEFORE
// the first paid provider call. If the store is unavailable the call is
// REFUSED (503 SPEND_GUARD_UNAVAILABLE) — it never fails open and has no
// bypass flag.
//
// UNITS (cost classes, not dollars): grade 3 (vision model), watch-frame 1,
// enrich 2 (comps + PriceCharting, conditional model verify), comps 1,
// chat 1, manage 1. A normal scan = grade + enrich = 5 units.
//
// DEFAULTS (env-overridable): principal 300 units/day (~60 scans), operator
// 5000, global 6000. Operator principals are named explicitly in
// SPEND_GUARD_OPERATOR_PRINCIPAL_IDS (comma-separated principal ids) — never
// inferred from a request field. research-market keeps its own separate
// durable cap and is NOT double-counted here.
//
// GK-L1A - NON-OPERATOR AGGREGATE SUB-CEILING. Operator and ordinary units used
// to share ONE global counter, so enough ordinary accounts could exhaust the day
// and lock the operator out (operator remaining = min(5000, 6000 - ordinary use)).
// A THIRD counter now bounds the SUM of all non-operator reservations
// (SPEND_GUARD_NONOPERATOR_DAILY_UNITS, default 1000). Reservation order for an
// ordinary principal: principal cap -> non-operator aggregate -> global, each an
// atomic INCRBY checked on its own post-increment value, and any refusal (or store
// error) refunds EVERY counter it took, so a refused call burns nothing.
// GUARANTEE: ordinary reservations are bounded by the aggregate BEFORE they ever
// touch the global counter, so ordinary usage occupies at most
// min(aggregate, global) units of the global budget and the operator keeps
// min(operatorCap, global - aggregate) = 5000 with the shipped 6000/1000/5000.
// The effective aggregate is additionally CLAMPED to max(0, global - operatorDaily),
// so a misconfiguration can never let ordinary use reach into the operator reserve.
// The sub-ceiling applies ONLY when at least one operator principal is configured:
// with none, nobody is protected, so a pooled limit would throttle the real operator
// (everyone is "ordinary"); the pre-L1A behaviour is kept in that case.
//
// GK-L1A (v3/v4 amendment) - MISSING CONFIGURATION MUST NEVER SILENTLY DISABLE A SPEND INVARIANT, IN ANY ENVIRONMENT.
// A spend-consuming request is REFUSED with SPEND_GUARD_MISCONFIGURED (503, nothing charged, no counter touched) when
// SPEND_GUARD_OPERATOR_PRINCIPAL_IDS is absent, empty, malformed (any entry is not a UUID), or unrecognized (it names no
// real operator-kind principal). There is NO runtime exception for tests, for a tests/*.test.js argv, or for any
// environment: production code contains no test sniffing at all. Tests supply their own valid configuration through
// tests/helpers/spendGuardTestSetup.js (an explicit env value + the two explicit injection seams below).
// Only spend-consuming calls are affected: authentication, Collection reads and the public pages never reach the guard.
//
// OPERATOR CLASSIFICATION is purely: (the principal id taken from the VERIFIED session token by the handler) is a member
// of the configured set. No request field can grant it. An operator request performs NO database lookup. "Unrecognized"
// configuration (well-formed ids that name no operator principal) is detected by a cached principal-table lookup that
// runs only for ORDINARY principals; if that lookup cannot be made (database outage) the request proceeds - the aggregate
// ceiling still applies and a validation outage must not take paid features down - and the outage is logged and cached
// briefly so a down database is not hammered.

import { researchStore, ResearchStoreUnavailableError } from './researchStore.js';

export const SPEND_UNITS = Object.freeze({
  grade: 3,
  'grade-watch': 1,
  enrich: 2,
  comps: 1,
  chat: 1,
  manage: 1,
});

export const SPEND_DEFAULTS = Object.freeze({
  PRINCIPAL_DAILY_UNITS: 300,
  OPERATOR_DAILY_UNITS: 5000,
  GLOBAL_DAILY_UNITS: 6000,
  NONOPERATOR_DAILY_UNITS: 1000,
});

const DAY_TTL_SECONDS = 2 * 24 * 3600;
const clean = (s) => String(s).replace(/[^A-Za-z0-9._:-]/g, '_');
const utcDay = (d) => d.toISOString().slice(0, 10);
export const principalDayKey = (principalId, d = new Date()) => `sg:v1:p:${clean(principalId)}:${utcDay(d)}`;
export const globalDayKey = (d = new Date()) => `sg:v1:g:${utcDay(d)}`;
export const nonOperatorDayKey = (d = new Date()) => `sg:v1:n:${utcDay(d)}`;

const intEnv = (env, name, dflt) => {
  const n = Number.parseInt(env[name] ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
};

const PRINCIPAL_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** @returns {{status:'ok'|'absent'|'empty'|'malformed', ids:string[]}} */
export function parseOperatorIds(raw) {
  if (raw === undefined || raw === null) return { status: 'absent', ids: [] };
  const parts = String(raw).split(',').map((x) => x.trim()).filter(Boolean);
  if (parts.length === 0) return { status: 'empty', ids: [] };
  if (!parts.every((x) => PRINCIPAL_ID_RE.test(x))) return { status: 'malformed', ids: [] };
  return { status: 'ok', ids: parts };
}

export function resolveSpendConfig(env = process.env) {
  const parsed = parseOperatorIds(env.SPEND_GUARD_OPERATOR_PRINCIPAL_IDS);
  const ops = parsed.status === 'ok' ? parsed.ids : String(env.SPEND_GUARD_OPERATOR_PRINCIPAL_IDS || '').split(',').map((x) => x.trim()).filter(Boolean);
  return {
    operatorConfigStatus: parsed.status,
    principalDaily: intEnv(env, 'SPEND_GUARD_PRINCIPAL_DAILY_UNITS', SPEND_DEFAULTS.PRINCIPAL_DAILY_UNITS),
    operatorDaily: intEnv(env, 'SPEND_GUARD_OPERATOR_DAILY_UNITS', SPEND_DEFAULTS.OPERATOR_DAILY_UNITS),
    globalDaily: intEnv(env, 'SPEND_GUARD_GLOBAL_DAILY_UNITS', SPEND_DEFAULTS.GLOBAL_DAILY_UNITS),
    nonOperatorDaily: intEnv(env, 'SPEND_GUARD_NONOPERATOR_DAILY_UNITS', SPEND_DEFAULTS.NONOPERATOR_DAILY_UNITS),
    operatorPrincipalIds: new Set(ops),
  };
}

// STORE: the durable Upstash store (src/lib/researchStore.js) is the ONLY store; its absence FAILS CLOSED (503). A test that
// needs a store injects one explicitly with setResearchStoreForTests(); production code never inspects argv or the
// environment to decide that a spend counter may live in process memory.
export function defaultSpendStore() {
  return researchStore();
}

const nextUtcMidnightMs = (now) => Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
const secondsUntilUtcMidnight = (now) => Math.max(1, Math.ceil((nextUtcMidnightMs(now) - now.getTime()) / 1000));

// Reserve `endpoint`'s units for `principalId` BEFORE the paid call.
//   ok:true  -> { ok, units, principalUsed, principalCap, globalUsed, globalCap }
//   ok:false -> { ok:false, status, code, error, retryAfterSeconds, resetAt }
// codes: SPEND_PRINCIPAL_DAILY_CAP | SPEND_NONOPERATOR_DAILY_CAP | SPEND_GLOBAL_DAILY_CAP | SPEND_GUARD_UNAVAILABLE |
//        SPEND_GUARD_MISCONFIGURED
export async function reserveSpend({ principalId, endpoint, store, now = new Date(), config, operatorRecognizer } = {}) {
  const units = SPEND_UNITS[endpoint];
  const retryAfterSeconds = secondsUntilUtcMidnight(now);
  const resetAt = new Date(nextUtcMidnightMs(now)).toISOString();
  const unavailable = () => ({
    ok: false, status: 503, code: 'SPEND_GUARD_UNAVAILABLE',
    error: 'Usage accounting is temporarily unavailable — please try again shortly.',
    retryAfterSeconds: 30, resetAt: null,
  });
  // Unknown endpoint or missing principal: fail closed, never charge nothing.
  if (!units || !principalId) return unavailable();

  const cfg = config || resolveSpendConfig();
  // GK-L1A (v3): a real runtime with missing/invalid operator classification REFUSES (nothing charged, no counter touched).
  const gate = await checkOperatorConfig(cfg, { principalId, operatorRecognizer });
  if (!gate.ok) return misconfigured(gate.reason);
  const st = store || defaultSpendStore();
  const pKey = principalDayKey(principalId, now);
  const gKey = globalDayKey(now);
  const isOperator = cfg.operatorPrincipalIds.has(principalId);
  const principalCap = isOperator ? cfg.operatorDaily : cfg.principalDaily;
  // GK-L1A: the aggregate applies only to ordinary principals and only when an operator is configured.
  const nonOperatorCeiling = effectiveNonOperatorCeiling(cfg);
  const useNonOperatorPool = !isOperator && nonOperatorCeiling !== null;
  const nKey = nonOperatorDayKey(now);

  let pTaken = false;
  let nTaken = false;
  let gTaken = false;
  const refund = async () => {
    try { if (pTaken) await st.decrBy(pKey, units); } catch { /* counter self-expires with its day */ }
    try { if (nTaken) await st.decrBy(nKey, units); } catch { /* counter self-expires with its day */ }
    try { if (gTaken) await st.decrBy(gKey, units); } catch { /* counter self-expires with its day */ }
  };
  try {
    const pUsed = await st.incrBy(pKey, units, DAY_TTL_SECONDS);
    pTaken = true;
    if (pUsed > principalCap) {
      await refund();
      return {
        ok: false, status: 429, code: 'SPEND_PRINCIPAL_DAILY_CAP',
        error: 'Daily usage limit reached for this account. It resets at 00:00 UTC.',
        retryAfterSeconds, resetAt,
      };
    }
    if (useNonOperatorPool) {
      const nUsed = await st.incrBy(nKey, units, DAY_TTL_SECONDS);
      nTaken = true;
      if (nUsed > nonOperatorCeiling) {
        await refund();
        return {
          ok: false, status: 429, code: 'SPEND_NONOPERATOR_DAILY_CAP',
          error: 'GrailKey is at its daily capacity for shared accounts. Please try again after 00:00 UTC.',
          retryAfterSeconds, resetAt,
        };
      }
    }
    const gUsed = await st.incrBy(gKey, units, DAY_TTL_SECONDS);
    gTaken = true;
    if (gUsed > cfg.globalDaily) {
      await refund();
      return {
        ok: false, status: 429, code: 'SPEND_GLOBAL_DAILY_CAP',
        error: 'GrailKey is at its daily capacity. Please try again after 00:00 UTC.',
        retryAfterSeconds, resetAt,
      };
    }
    return { ok: true, units, principalUsed: pUsed, principalCap, globalUsed: gUsed, globalCap: cfg.globalDaily };
  } catch (e) {
    await refund();
    if (e instanceof ResearchStoreUnavailableError) {
      console.error('[spend-guard] store unavailable — failing closed:', e.message);
    } else {
      console.error('[spend-guard] unexpected error — failing closed:', e?.message || e);
    }
    return unavailable();
  }
}

// GK-L1A: the aggregate ceiling actually enforced, or null when no operator is configured (see header).
// Clamped so ordinary use can never exceed (global - operator reserve).
export function effectiveNonOperatorCeiling(cfg) {
  if (!cfg || !cfg.operatorPrincipalIds || cfg.operatorPrincipalIds.size === 0) return null;
  return Math.min(cfg.nonOperatorDaily, Math.max(0, cfg.globalDaily - cfg.operatorDaily));
}

const misconfigured = (reason) => ({
  ok: false, status: 503, code: 'SPEND_GUARD_MISCONFIGURED', reason,
  error: 'Paid features are paused: usage accounting is not configured correctly on this deployment. Nothing was charged. The operator must fix the spend-guard operator configuration.',
  retryAfterSeconds: 300, resetAt: null,
});

let lastMisconfigLog = 0;
const OPERATOR_RECOGNITION_TTL_MS = 10 * 60 * 1000;
const OPERATOR_UNRECOGNIZED_TTL_MS = 60 * 1000;
let recognitionCache = { key: null, until: 0, ok: false };
export const resetOperatorRecognitionCache = () => { recognitionCache = { key: null, until: 0, ok: false }; lastMisconfigLog = 0; };

// Default recognizer: lazily imports the auth module so a process that never reaches it loads no database code.
async function defaultOperatorRecognizer(id) {
  const { isOperatorPrincipal } = await import('../modules/auth/index.js');
  return isOperatorPrincipal({ principalId: id });
}
let recognizerOverride = null;
/** Explicit TEST seam (like setResearchStoreForTests): replaces the principal-table lookup. Pass null to restore. */
export const setOperatorRecognizerForTests = (fn) => { recognizerOverride = typeof fn === 'function' ? fn : null; resetOperatorRecognitionCache(); };

const OUTAGE_TTL_MS = 30 * 1000;

/**
 * @returns {Promise<{ok:true} | {ok:false, reason:'absent'|'empty'|'malformed'|'unrecognized'}>}
 * Never throws. Always applies (no environment or test exception).
 */
export async function checkOperatorConfig(cfg, { principalId, operatorRecognizer } = {}) {
  const status = cfg?.operatorConfigStatus ?? (cfg?.operatorPrincipalIds?.size ? 'ok' : 'absent');
  const fail = (reason) => {
    const now = Date.now();
    if (now - lastMisconfigLog > 60_000) { lastMisconfigLog = now; console.error(`[spend-guard] operator configuration ${reason} - REFUSING spend-consuming requests (set SPEND_GUARD_OPERATOR_PRINCIPAL_IDS to the operator principal UUID)`); }
    return { ok: false, reason };
  };
  if (status !== 'ok') return fail(status);
  // An authenticated principal that IS in the configured set proves the configuration names a real principal: no lookup.
  if (principalId && cfg.operatorPrincipalIds.has(principalId)) return { ok: true };
  const ids = [...cfg.operatorPrincipalIds];
  const key = ids.slice().sort().join(',');
  const now = Date.now();
  if (recognitionCache.key === key && now < recognitionCache.until) return recognitionCache.ok ? { ok: true } : fail('unrecognized');
  const recognize = operatorRecognizer || recognizerOverride || defaultOperatorRecognizer;
  let any = false;
  try {
    for (const id of ids) { if (await recognize(id)) { any = true; break; } }
  } catch (e) {
    console.error('[spend-guard] operator recognition unavailable (database) - proceeding; aggregate ceiling still enforced:', e?.message || e);
    recognitionCache = { key, ok: true, until: now + OUTAGE_TTL_MS }; // do not hammer a database that is down
    return { ok: true };
  }
  recognitionCache = { key, ok: any, until: now + (any ? OPERATOR_RECOGNITION_TTL_MS : OPERATOR_UNRECOGNIZED_TTL_MS) };
  return any ? { ok: true } : fail('unrecognized');
}

// Writes the stable refusal response. Never includes provider detail.
export function sendSpendRefusal(res, refusal) {
  res.setHeader('retry-after', String(refusal.retryAfterSeconds));
  return res.status(refusal.status).json({
    error: refusal.code,
    message: refusal.error,
    retryAfter: refusal.retryAfterSeconds,
    resetAt: refusal.resetAt,
    ...(refusal.reason ? { reason: refusal.reason } : {}),
  });
}

// One-line handler wiring: returns true when the call was refused (response
// already sent), false when the caller may proceed to its paid call.
export async function enforceSpendGuard(res, { principalId, endpoint }) {
  const r = await reserveSpend({ principalId, endpoint });
  if (r.ok) return false;
  sendSpendRefusal(res, r);
  return true;
}
