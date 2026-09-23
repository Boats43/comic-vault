// src/lib/megaKeyRegistryAudit.js
//
// Pricing Trust — Commit C3 (2026-09-23). Deterministic, SOURCE-LEVEL
// duplicate-key detection for api/mega-keys.js's MEGA_KEYS_FLOOR object
// literal.
//
// Why source-level, not "parse the live imported object": a live JS
// object literal with two identical string keys silently collapses to
// one entry at parse time (the second wins, the first is dead code) —
// by the time MEGA_KEYS_FLOOR exists as a runtime object, the duplicate
// is already gone and unobservable. The only way to catch this class of
// defect is to read the raw source TEXT and count occurrences of each
// `"normalized key": {` before JS ever collapses them. This is exactly
// how the real 7-collision defect (GK ticket: Pricing Trust dispatch,
// 2026-09-23 — "x men|1"/"brave and the bold|28" originally reported,
// audit found 5 more: "fantastic four|1", "tales of suspense|39",
// "journey into mystery|83", "strange tales|110", "avengers|1") was
// found — a bulk-append commit (cb90ae6c, 2026-07-05) re-added 7 titles
// already present from the original curation commits (34f1cc9a/8393a91e,
// 2026-04-21/22) without checking for collisions.
//
// This module is pure text parsing — it never imports mega-keys.js as a
// module (that would already have lost the duplicates) — it reads the
// file's own source string.

/**
 * Parse api/mega-keys.js's MEGA_KEYS_FLOOR object literal from its raw
 * source text and return every top-level "key": { ... } definition,
 * brace-depth-aware (so a volatilityNote/source string's own text can
 * never be mistaken for a nested object boundary).
 *
 * @param {string} src - raw source text of api/mega-keys.js
 * @returns {{key: string, startLine: number, endLine: number}[]}
 */
export function parseMegaKeyDefinitions(src) {
  const objMarker = 'export const MEGA_KEYS_FLOOR';
  const objStart = src.indexOf(objMarker);
  if (objStart === -1) {
    throw new Error('parseMegaKeyDefinitions: "export const MEGA_KEYS_FLOOR" not found in source');
  }
  const braceStart = src.indexOf('{', objStart);
  let depth = 0;
  let objEnd = -1;
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) { objEnd = i; break; }
    }
  }
  if (objEnd === -1) {
    throw new Error('parseMegaKeyDefinitions: could not find matching closing brace for MEGA_KEYS_FLOOR');
  }

  const keyRe = /^\s{2}"([^"]+)":\s*\{/gm;
  const definitions = [];
  let m;
  while ((m = keyRe.exec(src)) !== null) {
    if (m.index < braceStart || m.index > objEnd) continue;
    const entryBraceStart = src.indexOf('{', m.index);
    let d = 0;
    let entryEnd = -1;
    for (let i = entryBraceStart; i < src.length; i++) {
      if (src[i] === '{') d++;
      else if (src[i] === '}') {
        d--;
        if (d === 0) { entryEnd = i; break; }
      }
    }
    definitions.push({
      key: m[1],
      startLine: src.slice(0, m.index).split('\n').length,
      endLine: src.slice(0, entryEnd).split('\n').length,
    });
  }
  return definitions;
}

/**
 * Return every normalized key that appears more than once, with all of
 * its source-line occurrences, sorted by first occurrence.
 *
 * @param {string} src - raw source text of api/mega-keys.js
 * @returns {{key: string, occurrences: {startLine: number, endLine: number}[]}[]}
 */
export function findDuplicateMegaKeyDefinitions(src) {
  const definitions = parseMegaKeyDefinitions(src);
  const byKey = new Map();
  for (const def of definitions) {
    if (!byKey.has(def.key)) byKey.set(def.key, []);
    byKey.get(def.key).push({ startLine: def.startLine, endLine: def.endLine });
  }
  const duplicates = [];
  for (const [key, occurrences] of byKey) {
    if (occurrences.length > 1) duplicates.push({ key, occurrences });
  }
  return duplicates;
}
