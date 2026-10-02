// src/lib/duplicateCopyDetection.js — GK-270.
//
// PHYSICAL IDENTITY ≠ CATALOGUE SIMILARITY. This module answers ONLY
// "do these two titles look like the same book" (a similarity SIGNAL).
// It never decides SAME PHYSICAL ASSET on its own — that requires either
// a durable gkAssetId match (server-enforceable, see
// src/modules/assets/service.js's linkCollectionItem) or an explicit
// operator decision (see the SAME COPY / ANOTHER COPY gate in App.jsx's
// save-interrupt flow). This file supplies the similarity evidence that
// triggers that gate — nothing more.
//
// Deliberately NOT reusing src/lib/compHygiene.js's hasSufficientTitleOverlap/
// tokenizeTitle: those are tuned for eBay-listing comp matching (artist-
// strip sets, stop-word lists calibrated for pricing accuracy) — a
// different problem with different failure costs. A false negative here
// (missing a real duplicate) risks a confusing blocked-listing experience;
// a false positive (two genuinely different books) risks the Case C gate
// firing unnecessarily, which is a one-tap dismissal, not a safety
// failure. A small, purpose-built, conservative token-overlap check is
// more honest than borrowing a tokenizer calibrated for a different risk
// profile.

const STOP_WORDS = new Set(['the', 'a', 'an', 'of', 'and', 'vol', 'volume']);
const MIN_TOKEN_LEN = 2;

function tokenize(title) {
  if (!title || typeof title !== 'string') return [];
  return title
    .toLowerCase()
    .replace(/#\s*\d+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= MIN_TOKEN_LEN && !STOP_WORDS.has(w));
}

// titlesLikelySameBook — token-overlap similarity, NOT an identity
// decision. Returns true when the SMALLER token set is at least
// `threshold` covered by the other (asymmetric-tolerant: "old man logan
// deodato" vs "old man logan mike deodato" overlaps fully on the smaller
// set despite the extra "mike" token on one side).
export function titlesLikelySameBook(titleA, titleB, threshold = 0.6) {
  const tokensA = new Set(tokenize(titleA));
  const tokensB = new Set(tokenize(titleB));
  if (tokensA.size === 0 || tokensB.size === 0) return false;

  const [smaller, larger] = tokensA.size <= tokensB.size ? [tokensA, tokensB] : [tokensB, tokensA];
  let overlap = 0;
  for (const t of smaller) {
    if (larger.has(t)) overlap++;
  }
  return overlap / smaller.size >= threshold;
}

// ─────────────────────────────────────────────────────────────────────
// GK-279 — capture-time physical-copy candidate matching.
//
// A candidate means "this MIGHT be a physical asset you already own" —
// never "this IS the same physical copy". Deliberately the smallest
// deterministic signal set (title token overlap + issue + year); no
// embeddings, no image fingerprinting. Publisher/variant/grade are
// CONTEXT shown to the operator, never exclusion criteria: a false
// positive costs one tap, a false negative silently mints a duplicate.
// ─────────────────────────────────────────────────────────────────────
function normIssue(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim().replace(/^#\s*/, '').toLowerCase();
}

export function issuesCompatible(a, b) {
  const x = normIssue(a), y = normIssue(b);
  if (!x || !y) return true; // unknown on either side cannot exclude
  return x === y;
}

export function yearsCompatible(a, b) {
  const x = parseInt(a, 10), y = parseInt(b, 10);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return true;
  return Math.abs(x - y) <= 1; // cover-date vs publication-date drift
}

export function isPlausiblePhysicalCopyCandidate(incoming, existing) {
  if (!incoming || !existing) return false;
  return titlesLikelySameBook(incoming.title, existing.title)
    && issuesCompatible(incoming.issue, existing.issue)
    && yearsCompatible(incoming.year, existing.year);
}
