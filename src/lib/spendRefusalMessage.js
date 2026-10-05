// Client-only: turn a spend-guard refusal body into text a person can read.
//
// The server's 429 body is { error: <STABLE_CODE>, message: <human sentence>, retryAfter, resetAt }
// (src/lib/spendGuard.js). Callers used to throw `data.error`, which surfaced the raw code
// ("SPEND_PRINCIPAL_DAILY_CAP") to the user. This prefers the human `message` ONLY for spend-guard
// codes; every other error keeps its existing text. Display only: no caps, accounting, retries,
// session handling or server behavior change.
export const SPEND_REFUSAL_CODE_RE = /^SPEND_/;

export const spendRefusalText = (body, fallback = null) => {
  const code = typeof body?.error === 'string' ? body.error : null;
  const message = typeof body?.message === 'string' && body.message.trim() ? body.message.trim() : null;
  if (code && SPEND_REFUSAL_CODE_RE.test(code) && message) return message;
  return code || fallback;
};
