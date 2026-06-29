// BUILD 1 — Auto Key Detection from ComicVine character_credits
//
// Detects key issues deterministically from ComicVine metadata (zero AI cost).
// Uses first_appearance_characters + character_credits to identify debuts.
//
// Why it matters:
// - No competitor auto-detects keys from character credits
// - Free signal (already fetched in enrich pipeline)
// - Beats manual key lists (covers new/indie characters)
//
// Pattern:
//   const { isKey, keyReason, keyCharacters } = detectAutoKey(comicVine);
//   if (isKey) {
//     badge: 🔑 KEY
//     decision: lean toward CGC/HOLD paths
//   }

/**
 * Detect if book is a key issue based on ComicVine character metadata.
 *
 * Key signals:
 * 1. first_appearance_characters[] non-empty → debut issue
 * 2. character_credits[] + cross-reference known debuts
 *
 * @param {Object} comicVine - ComicVine response from lookupComicVine()
 * @returns {Object} { isKey: boolean, keyReason: string, keyCharacters: string[] }
 */
export const detectAutoKey = (comicVine) => {
  if (!comicVine) {
    return { isKey: false, keyReason: null, keyCharacters: [] };
  }

  const firstAppChars = Array.isArray(comicVine.firstAppearanceCharacters)
    ? comicVine.firstAppearanceCharacters.filter(Boolean)
    : [];

  const characterCredits = Array.isArray(comicVine.characterCredits)
    ? comicVine.characterCredits.filter(Boolean)
    : [];

  // Signal 1: ComicVine explicitly marks first appearances
  if (firstAppChars.length > 0) {
    const chars = firstAppChars.slice(0, 3).join(', ');
    const keyReason = firstAppChars.length === 1
      ? `1st appearance: ${chars}`
      : `1st appearances: ${chars}`;

    return {
      isKey: true,
      keyReason,
      keyCharacters: firstAppChars,
      keySource: 'comicvine_first_appearance',
    };
  }

  // Signal 2: Cross-reference character credits against known major debuts
  // (Future: could check character popularity scores, team rosters, etc.)
  // For now: first_appearance_characters is authoritative

  return { isKey: false, keyReason: null, keyCharacters: [] };
};

/**
 * Enhance existing keyIssue field with auto-detected key status.
 * Merges Vision/manual keyIssue with ComicVine auto-detection.
 *
 * Priority:
 * 1. Manual override (user corrected)
 * 2. Vision keyIssue (from cover text)
 * 3. Auto-detected (ComicVine metadata)
 *
 * @param {string} existingKey - Current keyIssue field (from Vision/manual)
 * @param {Object} comicVine - ComicVine response
 * @returns {Object} { keyIssue: string, autoDetected: boolean, keyCharacters: string[] }
 */
export const enhanceKeyIssue = (existingKey, comicVine) => {
  const autoKey = detectAutoKey(comicVine);

  // Existing key takes priority (Vision saw it on cover, or user entered it)
  if (existingKey && existingKey.trim().length > 0) {
    return {
      keyIssue: existingKey,
      autoDetected: false,
      keyCharacters: autoKey.keyCharacters, // Still surface characters for display
    };
  }

  // No existing key → use auto-detected
  if (autoKey.isKey) {
    return {
      keyIssue: autoKey.keyReason,
      autoDetected: true,
      keyCharacters: autoKey.keyCharacters,
      keySource: autoKey.keySource,
    };
  }

  // No key detected
  return {
    keyIssue: null,
    autoDetected: false,
    keyCharacters: [],
  };
};
