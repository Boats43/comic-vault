// src/lib/visionConsistency.js
//
// Q118 dispatch (2026-07-18) — internal consistency checker. Almost every
// bug fixed tonight (Q112-Q117) had the same shape: Vision's own free-text
// reasoning (the condition-report `reason` field) said one thing, and
// Vision's own STRUCTURED fields from the SAME model call said something
// different or impossible — and a human had to notice by reading the card
// carefully. This module runs that comparison automatically, on every scan.
//
// Scope, per explicit ruling: Tier 1 only — Vision SELF-consistency, i.e.
// reason text vs Vision's own raw structured fields (title/issue/year/
// isGraded), not the pipeline's post-resolution confirmed fields and not
// the final computed price (that's Tier 2, deliberately out of scope here
// — it needs the final price, which doesn't exist until after api/enrich.js
// finishes pricing, an architecturally separate concern).
//
// Flag-only (Layer A, no pricing-math greenlight needed per CLAUDE.md) —
// when reason and a structured field disagree, both came from the SAME
// Vision call. This module can tell you something is wrong; it cannot tell
// you which of the two disagreeing fields is right. Auto-correction would
// need a THIRD, independently-sourced signal to arbitrate (e.g. eBay's
// image-search consensus) — that's future work, not this pass.
//
// Mirrors the existing detectEditionWarning (api/grade.js) precedent:
// scan free text, cross-check structured fields, return a flag, no side
// effects, no network calls.

// ═══════════════════════════════════════════════════════════════════════
// Check 1 — title/issue mentioned in reason vs structured title/issue
// ═══════════════════════════════════════════════════════════════════════
//
// Deliberately does NOT reuse compHygiene's tokenizeTitle/STOP_WORDS (the
// pipeline's usual title tokenizer) for the title-vs-title comparison
// itself: that tokenizer strips publisher
// words (marvel/dc/image/...) because it was built for eBay-listing
// similarity matching, where sellers inconsistently include/omit them.
// For THIS check, publisher-adjacent words are often exactly the missing
// piece of a truncation bug ("Captain" vs "Captain Marvel") — stripping
// "marvel" from both sides would make them look identical and silently
// mask the bug this check exists to catch. Uses a lighter, grammar-only
// stopword list instead (this/the/a/an/of/copy/issue/comic/book).

const ISSUE_MENTION_RE = /#\s*(\d{1,4})\b/g;
const TITLE_WINDOW_CHARS = 55;
const LIGHT_STOPWORDS = new Set([
  'this', 'that', 'the', 'a', 'an', 'of', 'copy', 'issue', 'issues', 'comic', 'comics', 'book',
]);

const lightTokenize = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0 && !LIGHT_STOPWORDS.has(w) && !/^\d+$/.test(w));

/**
 * @param {{reason?: string, title?: string, issue?: string}} params
 * @returns {{id: string, message: string}|null}
 */
export const checkTitleConsistency = ({ reason, title, issue }) => {
  if (!reason || !title) return null;
  const text = String(reason);
  const structuredTokens = lightTokenize(title);
  if (structuredTokens.length === 0) return null;

  for (const m of text.matchAll(ISSUE_MENTION_RE)) {
    const mentionedIssue = m[1];
    const windowStart = Math.max(0, m.index - TITLE_WINDOW_CHARS);
    const window = text.slice(windowStart, m.index);
    const windowTokens = lightTokenize(window);
    if (windowTokens.length === 0) continue; // no title-like text before this "#N" — skip (guards against staple/corner "#N" mentions unrelated to issue number)

    // Issue-number disagreement is unambiguous — no fuzzy matching needed.
    if (issue && mentionedIssue !== String(issue).trim()) {
      return {
        id: 'title-issue-text-mismatch',
        message: `condition report mentions "#${mentionedIssue}" but structured issue is "#${issue}"`,
      };
    }

    const overlapCount = structuredTokens.filter((t) => windowTokens.includes(t)).length;
    const hasAnyOverlap = overlapCount > 0;
    const structuredIsSubsetOfWindow =
      overlapCount === structuredTokens.length && windowTokens.length > structuredTokens.length;

    if (!hasAnyOverlap) {
      return {
        id: 'title-issue-text-mismatch',
        message: `condition report says "${window.trim()} #${mentionedIssue}" but structured title is "${title}" — no shared words`,
      };
    }
    if (structuredIsSubsetOfWindow) {
      return {
        id: 'title-issue-text-mismatch',
        message: `condition report says "${window.trim()} #${mentionedIssue}" but structured title "${title}" appears truncated`,
      };
    }
  }
  return null;
};

// ═══════════════════════════════════════════════════════════════════════
// Check 2 — grading-status affirmative claims in reason vs isGraded=false
// ═══════════════════════════════════════════════════════════════════════
//
// Deliberately NOT a keyword scan. "CGC"/"certification"/"slab" appearing
// in reason does not mean Vision believes the book is graded — it very
// commonly appears in the OPPOSITE explanation ("this is a raw copy, not
// CGC certified"). Two independent guards against that false-positive
// class:
//   1. Each pattern requires an AFFIRMING verb (is/shows/appears to be/
//      looks like) DIRECTLY adjacent to the CGC/CBCS/PGX mention — only an
//      optional article ("a"/"an") is allowed between them. "is NOT CGC
//      certified" already fails to match at the pattern level, since "not"
//      doesn't fit the optional-article slot — no negation-window check
//      even needed for the single most common phrasing.
//   2. For matches that DO fire, a window around the match is still
//      checked for negation words (no/not/isn't/without/raw copy/etc.) to
//      catch less-adjacent negation ("...is CGC graded — actually, no
//      cert number visible, so it's raw").
// Net effect deliberately trades some false negatives (a genuine
// affirmative claim phrased in a way these patterns don't recognize) for
// close to zero false positives on the "raw, not graded" explanation —
// the right tradeoff for a flag-only check that interrupts a human when it
// fires.

const AFFIRMATIVE_GRADING_PATTERNS = [
  /\b(?:is|shows?|appears?\s+to\s+be|looks?\s+like)\s+(?:an?\s+)?(?:cgc|cbcs|pgx)[\s-]?(?:graded|certified|slabbed?)\b/i,
  /\bcertification\s+number\s+(?:is\s+)?(?:visible|shown|present|readable)\b/i,
  /\b(?:cgc|cbcs|pgx)\s+(?:label|slab)\s+(?:shows?|reads?|indicates?|is\s+visible)\b/i,
  /\bslabbed\s+(?:in|with)\s+(?:an?\s+)?(?:cgc|cbcs|pgx)\b/i,
  /\b(?:this|the)\s+(?:book|copy|comic)\s+is\s+(?:cgc|cbcs|pgx)[\s-]?(?:graded|certified)\b/i,
];

const NEGATION_RE = /\b(?:not|no|isn'?t|wasn'?t|n't|without|never|neither|nor|un-?graded|raw\s+(?:copy|book))\b/i;
const NEGATION_WINDOW_CHARS = 40;

/**
 * @param {{reason?: string, isGraded?: boolean}} params
 * @returns {{id: string, message: string}|null}
 */
export const checkGradingStatusConsistency = ({ reason, isGraded }) => {
  if (!reason || isGraded) return null; // only relevant when structured says NOT graded
  const text = String(reason);

  for (const pattern of AFFIRMATIVE_GRADING_PATTERNS) {
    const m = text.match(pattern);
    if (!m) continue;
    const windowStart = Math.max(0, m.index - NEGATION_WINDOW_CHARS);
    const windowEnd = Math.min(text.length, m.index + m[0].length + NEGATION_WINDOW_CHARS);
    const window = text.slice(windowStart, windowEnd);
    if (NEGATION_RE.test(window)) continue; // negated nearby — do not flag

    return {
      id: 'grading-status-text-mismatch',
      message: `condition report says "${m[0]}" but structured isGraded is false`,
    };
  }
  return null;
};

// ═══════════════════════════════════════════════════════════════════════
// Check 3 — character/era mentions in reason vs structured year
// ═══════════════════════════════════════════════════════════════════════
//
// Small, hand-maintained registry — same shape/precedent as
// premiumCreators.js (80 entries) and pedigreeRegistry.js (22 entries).
// Deliberately NOT exhaustive and NOT a live ComicVine per-character
// lookup: ComicVine's character_credits/first_appearance_characters
// (already fetched elsewhere in the pipeline) describe characters IN the
// matched issue, not a character's global debut year, so answering "could
// this character exist yet" would need an EXTRA per-character API call —
// wrong tradeoff for a check meant to be free and synchronous. Only
// characters whose debut year is unambiguous and well-known enough that a
// mention before that year is high-confidence signal, not a name collision
// risk (no single common first names, no words that double as ordinary
// English).

export const ERA_ANCHOR_CHARACTERS = [
  { name: 'Kamala Khan', aliases: ['kamala khan'], debutYear: 2013 },
  { name: 'Miles Morales', aliases: ['miles morales'], debutYear: 2011 },
  { name: 'Venom', aliases: ['venom', 'eddie brock'], debutYear: 1988 },
  { name: 'Carnage', aliases: ['carnage'], debutYear: 1992 },
  { name: 'Deadpool', aliases: ['deadpool'], debutYear: 1991 },
  { name: 'Cable', aliases: ['cable'], debutYear: 1990 },
  { name: 'X-23', aliases: ['x-23', 'x23', 'laura kinney'], debutYear: 2004 },
  { name: 'Spawn', aliases: ['spawn'], debutYear: 1992 },
  { name: 'Gwenpool', aliases: ['gwenpool'], debutYear: 2014 },
  { name: 'Wolverine', aliases: ['wolverine'], debutYear: 1974 },
  { name: 'Rocket Raccoon', aliases: ['rocket raccoon'], debutYear: 1976 },
  { name: 'Moon Knight', aliases: ['moon knight'], debutYear: 1975 },
  { name: 'Blade', aliases: ['blade the vampire hunter', 'blade'], debutYear: 1973 },
  { name: 'Elektra', aliases: ['elektra'], debutYear: 1981 },
  { name: 'She-Hulk', aliases: ['she-hulk', 'she hulk'], debutYear: 1980 },
];

const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @param {{reason?: string, year?: string|number}} params
 * @returns {{id: string, message: string}|null}
 */
export const checkEraAnachronismConsistency = ({ reason, year }) => {
  if (!reason || !year) return null;
  const y = parseInt(year, 10);
  if (!Number.isFinite(y)) return null;
  const text = String(reason);

  for (const char of ERA_ANCHOR_CHARACTERS) {
    if (y >= char.debutYear) continue;
    for (const alias of char.aliases) {
      const re = new RegExp(`\\b${escapeRegExp(alias)}\\b`, 'i');
      if (re.test(text)) {
        return {
          id: 'era-anachronism',
          message: `condition report mentions "${char.name}" (introduced ${char.debutYear}) but structured year is ${year}`,
        };
      }
    }
  }
  return null;
};

// ═══════════════════════════════════════════════════════════════════════
// Orchestrator
// ═══════════════════════════════════════════════════════════════════════

/**
 * @param {{reason?: string, title?: string, issue?: string, year?: string|number, isGraded?: boolean}} vision
 * @returns {{flags: Array<{id: string, message: string}>, hasInconsistency: boolean}}
 */
export const checkVisionConsistency = ({ reason, title, issue, year, isGraded }) => {
  const flags = [
    checkTitleConsistency({ reason, title, issue }),
    checkGradingStatusConsistency({ reason, isGraded }),
    checkEraAnachronismConsistency({ reason, year }),
  ].filter(Boolean);
  return { flags, hasInconsistency: flags.length > 0 };
};
