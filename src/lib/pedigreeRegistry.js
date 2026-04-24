// Ship #18 — pedigree registry for CGC penalty-aware Vision.
//
// 22 canonical recognized pedigrees with alias support. Vision claims
// "pedigreeName" on the cgcPenaltyFlags response; api/grade.js
// post-parse runs lookupPedigree() to (a) normalize alias → canonical
// and (b) flag unrecognized claims so users can verify manually.
//
// Strict match policy (Q3 Option A):
//   - Exact canonical match (case-insensitive after trim)
//   - Exact alias match (case-insensitive after trim)
//   - NO Levenshtein / fuzzy matching
//   - Unknown pedigrees → recognized: false
//
// Rationale: pedigree claims drive listing premiums. False positive
// (claiming Mile High on a non-Mile High book) is a listing-fraud risk.
// False negative (missing a real Mile High alias) is recoverable via
// re-scan or manual override. Strict matching protects user trust.
//
// Era field categorizes pedigrees by typical era association:
//   golden  — primarily Golden Age books (1938–1956)
//   silver  — primarily Silver/Bronze Age (1956–1985)
// Used by Phase 6 decision engine for era-aware premium calibration.
//
// Location note: lives under src/lib/ (not api/) per Ship #15
// architectural learning — every api/*.js file becomes its own
// serverless function (Vercel Hobby plan limit: 12). Imported by
// api/grade.js via ../src/lib/pedigreeRegistry.js — Vercel bundles
// transitively, no new function endpoint added.

export const PEDIGREE_REGISTRY = [
  { canonical: 'Mile High Collection', aliases: ['mile high', 'edgar church', 'church'], era: 'golden' },
  { canonical: 'Pacific Coast',        aliases: ['pacific coast'],                       era: 'golden' },
  { canonical: 'White Mountain',       aliases: ['white mountain'],                      era: 'silver' },
  { canonical: 'Promise Collection',   aliases: ['promise', 'promise collection'],       era: 'silver' },
  { canonical: 'Massachusetts',        aliases: ['massachusetts'],                       era: 'silver' },
  { canonical: 'San Francisco',        aliases: ['san francisco'],                       era: 'silver' },
  { canonical: 'Boston',               aliases: ['boston'],                              era: 'silver' },
  { canonical: 'Allentown',            aliases: ['allentown'],                           era: 'golden' },
  { canonical: 'Bethlehem',            aliases: ['bethlehem'],                           era: 'silver' },
  { canonical: 'Big Apple',            aliases: ['big apple'],                           era: 'silver' },
  { canonical: 'Crowley Copy',         aliases: ['crowley', 'crowley copy'],             era: 'golden' },
  { canonical: 'Davis Crippen',        aliases: ['davis crippen', 'd copy', '"d" copy'], era: 'golden' },
  { canonical: 'Circle 8',             aliases: ['circle 8', 'circle eight'],            era: 'silver' },
  { canonical: 'Northford',            aliases: ['northford'],                           era: 'silver' },
  { canonical: 'Rockford',             aliases: ['rockford'],                            era: 'silver' },
  { canonical: 'Twin Cities',          aliases: ['twin cities'],                         era: 'silver' },
  { canonical: 'Vancouver',            aliases: ['vancouver'],                           era: 'silver' },
  { canonical: 'Winnipeg',             aliases: ['winnipeg'],                            era: 'silver' },
  { canonical: 'Curator',              aliases: ['curator'],                             era: 'silver' },
  { canonical: 'Larson',               aliases: ['larson'],                              era: 'silver' },
  { canonical: 'Long Beach',           aliases: ['long beach'],                          era: 'silver' },
  { canonical: 'Oakland',              aliases: ['oakland'],                             era: 'silver' },
];

// Build a flat lookup map at module load. Each entry contributes the
// lowercased canonical AND each alias as keys, all pointing back to
// the same { canonical, era } record. O(1) match instead of O(N×M).
const LOOKUP_MAP = (() => {
  const m = new Map();
  for (const entry of PEDIGREE_REGISTRY) {
    const value = { recognized: true, canonical: entry.canonical, era: entry.era };
    m.set(entry.canonical.toLowerCase(), value);
    for (const alias of entry.aliases) {
      m.set(alias.toLowerCase(), value);
    }
  }
  return m;
})();

// Strict pedigree lookup. Returns { recognized: bool, canonical: string|null,
// era: string|null }. Always returns an object (never null) so callers can
// destructure without optional chaining. recognized=false signals an
// unrecognized claim — UI shows a "verify manually" warning.
export const lookupPedigree = (name) => {
  if (!name || typeof name !== 'string') {
    return { recognized: false, canonical: null, era: null };
  }
  const target = name.toLowerCase().trim();
  if (target.length === 0) {
    return { recognized: false, canonical: null, era: null };
  }
  const hit = LOOKUP_MAP.get(target);
  if (hit) return hit;
  return { recognized: false, canonical: null, era: null };
};
