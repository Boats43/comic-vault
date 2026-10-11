// Client-only: turn a spend-guard refusal body into text a person can read.
//
// The server's refusal body is { error: <STABLE_CODE>, message: <human sentence>, retryAfter, resetAt, reason? }
// (src/lib/spendGuard.js). Callers used to throw `data.error`, which surfaced the raw code ("SPEND_PRINCIPAL_DAILY_CAP") to the
// user. This prefers a human message ONLY for spend-guard codes; every other error keeps its existing text. Display only: no
// caps, accounting, retries, session handling or server behavior change.
//
// GK-L1A v4 - REFUSAL SCREEN CORRECTION. Two classes of refusal:
//   RETRYABLE       (SPEND_GUARD_UNAVAILABLE, transient store trouble, anything unknown): a "Try again" control is right.
//   NOT RETRYABLE   daily capacity (SPEND_PRINCIPAL_DAILY_CAP, SPEND_NONOPERATOR_DAILY_CAP, SPEND_GLOBAL_DAILY_CAP) and the
//                   configuration failure (SPEND_GUARD_MISCONFIGURED): retrying cannot succeed, so the screen must not offer it.
// A daily-capacity refusal names its reset time in the VIEWER'S OWN timezone (from the server's ISO `resetAt`), not "00:00 UTC".
// A configuration failure NEVER implies it fixes itself at midnight: it is an operator problem, not a limit that resets.
export const SPEND_REFUSAL_CODE_RE = /^SPEND_/;

export const DAILY_CAPACITY_CODES = Object.freeze(['SPEND_PRINCIPAL_DAILY_CAP', 'SPEND_NONOPERATOR_DAILY_CAP', 'SPEND_GLOBAL_DAILY_CAP']);
export const CONFIGURATION_CODES = Object.freeze(['SPEND_GUARD_MISCONFIGURED']);
export const NON_RETRYABLE_SPEND_CODES = Object.freeze([...DAILY_CAPACITY_CODES, ...CONFIGURATION_CODES]);

export const isNonRetryableSpendRefusal = (body) => typeof body?.error === 'string' && NON_RETRYABLE_SPEND_CODES.includes(body.error);

/** "Mon, 5:00 PM PDT" in the viewer's timezone from an ISO instant; null when it is missing or invalid. */
export function formatLocalResetTime(resetAt, { locale, timeZone } = {}) {
  if (typeof resetAt !== 'string' || !resetAt) return null;
  const t = Date.parse(resetAt);
  if (!Number.isFinite(t)) return null;
  try {
    return new Intl.DateTimeFormat(locale, { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short', ...(timeZone ? { timeZone } : {}) }).format(new Date(t));
  } catch { return null; }
}

const CAPACITY_TEXT = {
  SPEND_PRINCIPAL_DAILY_CAP: (when) => `You've used today's allowance for this account. It resets at ${when}.`,
  SPEND_NONOPERATOR_DAILY_CAP: (when) => `GrailKey's shared capacity for today is used up. It resets at ${when}.`,
  SPEND_GLOBAL_DAILY_CAP: (when) => `GrailKey is at its daily capacity. It resets at ${when}.`,
};
export const CONFIGURATION_TEXT = 'Paid features are paused while GrailKey is being set up. Nothing was charged. This will not clear on its own - please contact the operator.';

export const spendRefusalText = (body, fallback = null, opts = {}) => {
  const code = typeof body?.error === 'string' ? body.error : null;
  const message = typeof body?.message === 'string' && body.message.trim() ? body.message.trim() : null;
  if (code && CONFIGURATION_CODES.includes(code)) return CONFIGURATION_TEXT; // never implies a reset time
  if (code && DAILY_CAPACITY_CODES.includes(code)) {
    const when = formatLocalResetTime(body?.resetAt, opts);
    if (when) return CAPACITY_TEXT[code](when);
    if (message) return message; // no usable reset instant: the server's own sentence is the honest fallback
  }
  if (code && SPEND_REFUSAL_CODE_RE.test(code) && message) return message;
  // GK-281: the grade-attempt refusals also carry a plain-language server message; show it, never the raw code.
  if (code && /^GRADE_ATTEMPT_/.test(code) && message) return message;
  return code || fallback;
};

/** An Error whose message is the display text and whose `nonRetryable` flag tells the screen not to offer "Try again". */
export function spendRefusalError(body, fallback = null, opts = {}) {
  const e = new Error(spendRefusalText(body, fallback, opts));
  e.nonRetryable = isNonRetryableSpendRefusal(body);
  if (typeof body?.error === 'string') e.spendCode = body.error;
  return e;
}
