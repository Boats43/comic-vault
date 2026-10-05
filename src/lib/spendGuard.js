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

import { researchStore, hasResearchStoreOverride, createMemoryResearchStore, ResearchStoreUnavailableError } from './researchStore.js';

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
});

const DAY_TTL_SECONDS = 2 * 24 * 3600;
const clean = (s) => String(s).replace(/[^A-Za-z0-9._:-]/g, '_');
const utcDay = (d) => d.toISOString().slice(0, 10);
export const principalDayKey = (principalId, d = new Date()) => `sg:v1:p:${clean(principalId)}:${utcDay(d)}`;
export const globalDayKey = (d = new Date()) => `sg:v1:g:${utcDay(d)}`;

const intEnv = (env, name, dflt) => {
  const n = Number.parseInt(env[name] ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
};

export function resolveSpendConfig(env = process.env) {
  const ops = String(env.SPEND_GUARD_OPERATOR_PRINCIPAL_IDS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  return {
    principalDaily: intEnv(env, 'SPEND_GUARD_PRINCIPAL_DAILY_UNITS', SPEND_DEFAULTS.PRINCIPAL_DAILY_UNITS),
    operatorDaily: intEnv(env, 'SPEND_GUARD_OPERATOR_DAILY_UNITS', SPEND_DEFAULTS.OPERATOR_DAILY_UNITS),
    globalDaily: intEnv(env, 'SPEND_GUARD_GLOBAL_DAILY_UNITS', SPEND_DEFAULTS.GLOBAL_DAILY_UNITS),
    operatorPrincipalIds: new Set(ops),
  };
}

// TEST-HARNESS STORE (disclosed, narrow). ~190 pre-existing test files invoke
// the guarded handlers directly with no Upstash configured; a fail-closed guard
// would make every one of them 503. In a process that is literally a
// `tests/*.test.js` script, and never on Vercel (VERCEL set) nor with
// NODE_ENV=production, the guard uses a process-local in-memory store with the
// identical contract. In every other process — i.e. every real deployment —
// the durable Upstash store is the only store and its absence FAILS CLOSED.
//
// U1 BOUNDARY HARDENING (2026-10-05) — PERMANENT INVARIANT: PRODUCTION MUST
// HAVE NO PATH THAT SILENTLY DISABLES DURABLE SPEND AUTHORITY. The fallback
// engages ONLY when ALL are true: (1) process.argv[1] is a
// `tests/<name>.test.js` script; (2) NO hosted-runtime marker is present —
// any real Vercel/Lambda runtime variable (explicit list below); (3) NODE_ENV !== 'production'; (4)
// GRAILKEY_CATALOG_ENVIRONMENT !== 'production'. Any marker REFUSES the
// fallback (the durable Upstash store, or a fail-closed 503, is then the only
// outcome). Pinned by tests/spend-guard-env-boundary.test.js.
const HARNESS_ARGV = /[\\/]tests[\\/][^\\/]+\.test\.js$/;
// EXPLICIT list of real hosted-runtime variables (not a `VERCEL*` prefix: dev
// machines carry `VERCEL_OIDC_TOKEN` from `vercel env pull` and the Claude Code
// Vercel plugin injects `VERCEL_PLUGIN_*`, neither of which is a runtime
// marker). `VERCEL=1` is set by the hosted runtime on every invocation and is
// by itself sufficient; the rest are belt-and-braces.
const HOSTED_RUNTIME_EXACT = new Set([
  'VERCEL', 'VERCEL_ENV', 'VERCEL_URL', 'VERCEL_REGION', 'VERCEL_DEPLOYMENT_ID', 'VERCEL_TARGET_ENV',
  'VERCEL_BRANCH_URL', 'VERCEL_PROJECT_PRODUCTION_URL', 'NOW_REGION', 'AWS_EXECUTION_ENV',
]);
const HOSTED_RUNTIME_PREFIX = /^(VERCEL_GIT_|AWS_LAMBDA_|LAMBDA_)/;
let harnessStore = null;
export function hostedRuntimeMarkers(env = process.env) {
  const hits = Object.keys(env).filter((k) => (HOSTED_RUNTIME_EXACT.has(k) || HOSTED_RUNTIME_PREFIX.test(k)) && env[k] !== undefined && env[k] !== '');
  if (env.NODE_ENV === 'production') hits.push('NODE_ENV=production');
  if (env.GRAILKEY_CATALOG_ENVIRONMENT === 'production') hits.push('GRAILKEY_CATALOG_ENVIRONMENT=production');
  return hits;
}
export function isTestHarnessProcess(argv1 = process.argv[1], env = process.env) {
  if (hostedRuntimeMarkers(env).length > 0) return false; // refuse on ANY marker
  return HARNESS_ARGV.test(String(argv1 || ''));
}
export function defaultSpendStore(argv1 = process.argv[1], env = process.env) {
  if (hasResearchStoreOverride()) return researchStore(); // explicit test injection always wins
  if (isTestHarnessProcess(argv1, env)) {
    harnessStore = harnessStore || createMemoryResearchStore();
    return harnessStore;
  }
  return researchStore();
}

const nextUtcMidnightMs = (now) => Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
const secondsUntilUtcMidnight = (now) => Math.max(1, Math.ceil((nextUtcMidnightMs(now) - now.getTime()) / 1000));

// Reserve `endpoint`'s units for `principalId` BEFORE the paid call.
//   ok:true  -> { ok, units, principalUsed, principalCap, globalUsed, globalCap }
//   ok:false -> { ok:false, status, code, error, retryAfterSeconds, resetAt }
// codes: SPEND_PRINCIPAL_DAILY_CAP | SPEND_GLOBAL_DAILY_CAP | SPEND_GUARD_UNAVAILABLE
export async function reserveSpend({ principalId, endpoint, store, now = new Date(), config } = {}) {
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
  const st = store || defaultSpendStore();
  const pKey = principalDayKey(principalId, now);
  const gKey = globalDayKey(now);
  const principalCap = cfg.operatorPrincipalIds.has(principalId) ? cfg.operatorDaily : cfg.principalDaily;

  let pTaken = false;
  let gTaken = false;
  const refund = async () => {
    try { if (pTaken) await st.decrBy(pKey, units); } catch { /* counter self-expires with its day */ }
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

// Writes the stable refusal response. Never includes provider detail.
export function sendSpendRefusal(res, refusal) {
  res.setHeader('retry-after', String(refusal.retryAfterSeconds));
  return res.status(refusal.status).json({
    error: refusal.code,
    message: refusal.error,
    retryAfter: refusal.retryAfterSeconds,
    resetAt: refusal.resetAt,
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
