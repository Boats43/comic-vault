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
