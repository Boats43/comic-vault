// Title Hygiene — metadata token stripping pipeline (Ship #22f)
//
// Strips publisher names, artist names, signature markers, and ordinal-key
// phrases from titles BEFORE consensus extraction or identity assembly.
// Single normalize helper consumed by all identity layers.
//
// Ship #22f: Extracted from compHygiene.js Q55-D bigram strip + Q55-C
// single-word strip. Applied BEFORE extractConsensus to prevent publisher
// tokens ("kitchen sink") and creator tokens ("mark spears") from
// contaminating identity. E4/E5 class protection.

import { COMPOUND_TITLE_WHITELIST } from './identityCore.js';

// Publisher names — most specific first (multi-word before single-word)
const PUBLISHER_NAMES = [
  'kitchen sink', 'dark horse', 'image comics', 'dc comics', 'marvel comics',
  'idw publishing', 'boom studios', 'dynamite entertainment',
  'valiant entertainment', 'aftershock comics', 'scout comics',
  'vault comics', 'black mask studios', 'oni press', 'fantagraphics',
  // Single-word (after multi-word to avoid partial matches)
  'marvel', 'dc', 'image', 'dark', 'horse', 'idw', 'boom', 'dynamite',
  'valiant', 'aftershock', 'scout', 'vault', 'black', 'mask', 'oni',
];

// Artist bigrams — famous first+last pairs (Q55-D)
const ARTIST_BIGRAMS = [
  'stan lee', 'jack kirby', 'steve ditko', 'john byrne', 'frank miller',
  'jim lee', 'todd mcfarlane', 'alex ross', 'neal adams', 'george perez',
  'tyler kirkham', 'inhyuk lee', 'skottie young', 'frank cho',
  'windsor smith', 'jeehyung lee', 'kaare andrews', 'alan quah',
  'mico suayan', 'puppeteer lee', 'derrick chew', 'jonboy meyers',
  'kael ngu', 'natali sanders', 'kendrick lim', 'lucio parrillo',
];

// Artist single words (Q55-C) — last names from ARTIST_PATTERNS
const ARTIST_WORDS = [
  'skan', 'rapoza', 'quash', 'momoko', 'ross', 'adams',
  'kirkham', 'bean', 'andolfo', 'browne', 'forstner',
  'howard', 'corona', 'stegman', 'ottley',
  'jimenez', 'mcfarlane', 'campbell', 'artgerm', 'nakayama',
  'hughes', 'byrne', 'perez', 'kirby', 'ditko', 'mele',
  'albuquerque', 'hama', 'fabok', 'ejikure',
  'gleason', 'quah', 'parrillo', 'maer', 'lim', 'chew', 'ngu', 'sanders',
  'lee', 'young', 'cho', 'miller', 'smith', 'otto', 'dekal', 'andrews',
  'suayan', 'meyers', 'spears',
];

// Signature/condition markers
const SIGNATURE_MARKERS = [
  'signed', 'sig', 'auto', 'autographed', 'signature series',
  'yellow label', 'green label', 'remarked', 'coa',
];

// Ordinal/key phrases
const ORDINAL_KEY_PHRASES = [
  '1st appearance', '2nd appearance', 'first appearance', 'second appearance',
  'first issue', 'origin', 'death', 'intro', 'cameo', 'key', 'iconic', 'classic',
];

/**
 * Strip metadata tokens from title string.
 *
 * Ship #22f: Applied BEFORE consensus extraction to prevent publisher/creator
 * tokens from contaminating identity. E4 (crow kitchen sink) / E5 (green
 * hornet mark spears) protection.
 *
 * @param {string} title - Raw title string
 * @returns {string} - Cleaned title (metadata tokens stripped)
 */
export function stripMetadataTokens(title) {
  if (!title) return '';

  let clean = String(title).toLowerCase();

  // Q120 dispatch (2026-07-19, Captain Marvel #17 class) — mask a matched
  // COMPOUND_TITLE_WHITELIST phrase before the publisher-name strip below,
  // rather than skipping the whole strip step: a title can carry genuine
  // publisher noise alongside a protected compound ("Captain Marvel Comics
  // #17" needs "Comics" gone while "Captain Marvel" survives). This was a
  // sixth independently-drifted copy of the "publisher name may
  // legitimately be part of a series title" fact Q119 consolidated — this
  // one missed by that sweep because it lives under a different variable
  // name (PUBLISHER_NAMES, not PUBLISHER_IN_TITLE_SERIES/
  // COMPOUND_TITLE_WHITELIST) in a different file, a lesson worth
  // remembering: check for the underlying FACT being duplicated, not just
  // grep for known list names. Same masking pattern as identityCore.js's
  // extractSeriesName fix from the earlier Q119 consolidation. A stray
  // leftover "comics" (e.g. "Captain Marvel Comics" → "Captain Marvel" +
  // orphaned "Comics") doesn't need explicit handling here the way it did
  // in extractSeriesName — this function's only caller (tokenizeTitle)
  // already treats bare "comics" as a STOP_WORD regardless.
  let restoreToken = null;
  let restoreOriginal = null;
  for (const entry of COMPOUND_TITLE_WHITELIST) {
    const idx = clean.indexOf(entry);
    if (idx === -1) continue;
    restoreOriginal = clean.slice(idx, idx + entry.length);
    restoreToken = '__CVPROTECT__';
    clean = clean.slice(0, idx) + restoreToken + clean.slice(idx + entry.length);
    break; // protect the first match found — compound entries don't meaningfully overlap
  }

  // 1. Strip publisher names (FIRST — most specific, multi-word before single)
  for (const pub of PUBLISHER_NAMES) {
    const pattern = new RegExp(`\\b${pub}\\b`, 'gi');
    clean = clean.replace(pattern, ' ');
  }

  // 2. Strip artist bigrams (Q55-D — before single-word to avoid orphans)
  for (const artist of ARTIST_BIGRAMS) {
    const pattern = new RegExp(`\\b${artist}\\b`, 'gi');
    clean = clean.replace(pattern, ' ');
  }

  // 3. Strip signature markers
  for (const marker of SIGNATURE_MARKERS) {
    const pattern = new RegExp(`\\b${marker}\\b`, 'gi');
    clean = clean.replace(pattern, ' ');
  }

  // 4. Strip ordinal/key phrases
  for (const phrase of ORDINAL_KEY_PHRASES) {
    const pattern = new RegExp(`\\b${phrase}\\b`, 'gi');
    clean = clean.replace(pattern, ' ');
  }

  // 5. Collapse whitespace
  clean = clean.replace(/\s+/g, ' ').trim();

  if (restoreToken) {
    clean = clean.replace(restoreToken, restoreOriginal);
  }

  return clean;
}

/**
 * Strip artist single-word tokens from tokenized array.
 *
 * Applied AFTER tokenization (unlike bigrams which strip at string level).
 * Filters out last-name-only artist credits that survived bigram strip.
 *
 * @param {string[]} tokens - Tokenized title array
 * @returns {string[]} - Filtered tokens (artist words removed)
 */
export function stripArtistWords(tokens) {
  if (!Array.isArray(tokens)) return [];
  const artistSet = new Set(ARTIST_WORDS);
  return tokens.filter(t => !artistSet.has(t.toLowerCase()));
}
