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
