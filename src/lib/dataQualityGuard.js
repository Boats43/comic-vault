/**
 * Data Quality Write-Back Guard
 * Principle 2: Better data never replaced by worse
 *
 * Prevents quality degradation when re-scanning books.
 * A verified_sold price ($13.18) should never be overwritten
 * by browse_api ($32) on refresh.
 */

const PRICE_RANK = {
  'verified_sold': 1,
  'verified_active': 2,
  'browse_api': 3,
  'pc_estimate': 4,
  'gocollect': 4,
  'web_search_fallback': 5,
  'ai_estimate': 6,
  'image_search_fallback': 7,
  'refused-no-data-sources': 8,
  'refused-reprint-thin-pool': 8,
  'refused-identity-conflict': 8,
  'refused-claude-gate': 8,
  'refused': 8,
  'identity-required': 9,
  null: 9,
  undefined: 9
};

const GRADE_RANK = {
  'high': 1,
  'HIGH': 1,
  'medium': 2,
  'MEDIUM': 2,
  'low': 3,
  'LOW': 3,
  null: 4,
  undefined: 4
};

// Shared presence check — a key PRESENT on enrich (even with value null) is
// a fresh, deliberate server signal; a key ABSENT means that call never
// attempted to resolve the field at all. Used by both applyProvisionalIdentity
// and mergeConfirmedIdentity below so the two don't drift into two
// independently-tuned copies of the same check (Q128's "drifted-duplicate-
// constant" lesson, applied to a predicate instead of a constant).
const hasKey = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);

/**
 * Choose between incoming and current price based on quality rank.
 * Lower rank = better quality. Preserves current if incoming is worse.
 *
 * @param {object} incoming - new data from enrich API
 * @param {object} current - existing data in catalogue
 * @returns {object} { price, pricingSource, preserved }
 */
export function chooseBetterPrice(incoming, current) {
  const inRank = PRICE_RANK[incoming?.pricingSource] ?? 9;
  const curRank = PRICE_RANK[current?.pricingSource] ?? 9;

  // Lower rank = better. Keep current if incoming is worse.
  if (inRank > curRank && current?.price != null) {
    console.log('[data-guard] PRESERVE', current.pricingSource,
      '$' + current.price, '— rejected', incoming?.pricingSource);
    return {
      price: current.price,
      priceLow: current.priceLow,
      priceHigh: current.priceHigh,
      pricingSource: current.pricingSource,
      priceNote: current.priceNote,
      preserved: true
    };
  }

  return {
    price: incoming?.price ?? current?.price,
    priceLow: incoming?.priceLow ?? current?.priceLow,
    priceHigh: incoming?.priceHigh ?? current?.priceHigh,
    pricingSource: incoming?.pricingSource ?? current?.pricingSource,
    priceNote: incoming?.priceNote ?? current?.priceNote,
    preserved: false
  };
}

/**
 * Choose between incoming and current grade based on confidence rank.
 * Lower rank = better confidence. Preserves current if incoming is worse.
 *
 * @param {object} incoming - new data from enrich API
 * @param {object} current - existing data in catalogue
 * @returns {object} { grade, gradeConfidence, preserved }
 */
export function chooseBetterGrade(incoming, current) {
  const inRank = GRADE_RANK[incoming?.confidenceLevel] ?? 4;
  const curRank = GRADE_RANK[current?.confidenceLevel] ?? 4;

  if (inRank > curRank && current?.grade) {
    console.log('[data-guard] PRESERVE grade', current.grade,
      current.confidenceLevel, '— rejected', incoming?.confidenceLevel);
    return {
      grade: current.grade,
      confidenceLevel: current.confidenceLevel,
      preserved: true
    };
  }

  return {
    grade: incoming?.grade ?? current?.grade,
    confidenceLevel: incoming?.confidenceLevel ?? current?.confidenceLevel,
    preserved: false
  };
}

/**
 * Q135 dispatch (2026-07-22, Lozano/Rachta Lin last-mile) — pool-provisional
 * identity (title-family-refused-provisional, Q131/Q134) means the server's
 * resolved title/issue/year/publisher/variant are honest signals — possibly
 * null when the pool doesn't corroborate a field — that must overwrite the
 * stored record. Every one of the 5 client merge sites in App.jsx builds its
 * updated record with `enrich.X || cur.X` (or omits identity fields from the
 * merge entirely for title/issue/publisher on 2 of the 5) — an OR-fallback
 * or an omission both treat an honest server-side null identically to "no
 * new data," silently keeping Vision's stale, already-rejected scan values
 * on the rendered card. That's true even when api/enrich.js correctly sends
 * `year: null` / `publisher: null` for a provisional card (confirmed via
 * unit test in Q134) — the fix never had a way to reach the screen.
 *
 * Single source of truth, spread into every merge site AFTER its own
 * existing field assignments so it wins on key collision (year/variant are
 * already keys in every merge object; this overrides them only when
 * provisional). Returns {} — a true no-op — for any non-provisional enrich
 * response, so every other card's merge stays byte-identical to before.
 *
 * Q144C dispatch (2026-07-22, Adventure Time #1→#5→#22→#5 drift) — `issue`
 * used bare `enrich.issue ?? null`, which collapses two genuinely different
 * server signals into the same outcome: an EXPLICIT `null` (server resolved
 * this round and honestly found no issue) and an OMITTED key (server never
 * attempted issue resolution this round at all) both nulled the field, with
 * no fallback to the prior stored value either way. On a repeatedly
 * rescanned provisional card, every fresh call's own transient issue guess
 * — never checked for actually being new information — overwrote the card
 * each time, which is what produced the observed drift. Presence-checked via
 * `hasOwnProperty` instead: key present (even if its value is null) is
 * trusted as a fresh, deliberate signal (a real value corrects the stale
 * one; an explicit null clears it) — key absent falls back to the prior
 * stored value instead of nulling it. title/year/publisher/variant are
 * unchanged (out of scope for this dispatch; enrich.js always sets those
 * keys on a provisional response, so no observed bug there).
 *
 * @param {object} enrich - enrich API response
 * @param {object} prior - the existing stored record (cur/s/item, depending on call site)
 * @returns {object} {} when not provisional, else honest title/issue/year/publisher/variant
 */
export function applyProvisionalIdentity(enrich, prior) {
  if (!enrich?.identityProvisional) return {};
  return {
    title: enrich.title ?? enrich.confirmedTitle ?? prior?.title,
    issue: hasKey(enrich, 'issue') ? enrich.issue : (prior?.issue ?? null),
    year: enrich.year ?? null,
    publisher: enrich.publisher ?? null,
    variant: enrich.variantNote ?? null,
  };
}

/**
 * Q144C dispatch, instance 7 (2026-07-22, Adventure Time weighted-consensus
 * class) — the CONFIRMED-identity counterpart to applyProvisionalIdentity.
 * That function only fires when enrich.identityProvisional is true; a
 * confirmed identity (weighted-consensus/top-rank-protection — no
 * provisional flag) never triggers it. Traced live via a pre/post-
 * finalizeResponse diagnostic (Jimmy's scan on 4ffe76b): server-side
 * out.issue="1" survived cleanly through response assembly and
 * serialization — the loss was 100% client-side, at this exact merge site
 * (App.jsx, scan-to-catalogue persistence for a saved item). That object's
 * own field list has never included `title`/`issue`/`publisher` at all
 * outside the applyProvisionalIdentity spread (Q135's own comment on this
 * site says so explicitly) — for a CONFIRMED identity, those three fields
 * only ever fall through the `...cur` spread, i.e. the record never
 * advances past whatever Vision guessed at grade-time, no matter what the
 * server later resolved. `year` had a narrow special-case (only trusted
 * enrich's value when `yearCorrected`/`polybagDetected` was explicitly
 * flagged) that missed the ordinary "server resolved a year, no special
 * flag" case; `variant` used `||`, which — like `??` — can't distinguish
 * an honest server null from "no new data."
 *
 * Same presence contract as applyProvisionalIdentity's issue fix, applied
 * to all five identity fields at once (fixing the site's semantics
 * wholesale, not field-by-field, since the audit found title/year/
 * publisher/variant sharing the exact same defect at this one site):
 * key present (real value or explicit null) -> trust the fresh signal; key
 * absent -> preserve the prior stored value. Always active, no provisional
 * gate — callers spread this BEFORE applyProvisionalIdentity so a
 * provisional response's own honest-null semantics (which additionally
 * force null even on an OMITTED key, since a provisional pool that didn't
 * corroborate a field is itself information) still win on key collision
 * when both apply to the same response.
 *
 * @param {object} enrich - enrich API response
 * @param {object} prior - the existing stored record (cur, at this call site)
 * @returns {object} title/issue/year/publisher/variant merged by presence
 */
export function mergeConfirmedIdentity(enrich, prior) {
  const authority = mergeIdentityAuthority(enrich, prior);
  // GK-85 (GrailKey Directive T, Task 3) — a facet locked OPERATOR_CONFIRMED
  // keeps the PRIOR value regardless of what this response's own presence
  // check would otherwise accept. This is the live-defect fix: before this,
  // mergeConfirmedIdentity had zero awareness of a manual correction ever
  // having happened, so the next routine automatic enrich (a plain rescan,
  // auto-refresh, bulk re-import — none of them "manual") silently
  // overwrote it. Per-field, not per-item (Directive T's own design
  // rationale): a locked title/issue does not block year from still being
  // filled by fresh catalog corroboration when year carries no lock.
  const pick = (field, enrichField) =>
    authority[field] === 'OPERATOR_CONFIRMED'
      ? prior?.[field]
      : (hasKey(enrich, enrichField) ? enrich[enrichField] : prior?.[field]);
  return {
    title: pick('title', 'title'),
    issue: pick('issue', 'issue'),
    year: pick('year', 'year'),
    publisher: pick('publisher', 'publisher'),
    variant: pick('variant', 'variantNote'),
    identityAuthority: authority,
  };
}

/**
 * GK-85 (GrailKey Directive T, Task 3) — the authority carrier's own
 * custody, governed by the SAME presence-aware discipline as the identity
 * values it protects (the governing invariant this dispatch exists to
 * enforce): a field ABSENT from `enrich.identityAuthority` preserves
 * whatever authority `prior.identityAuthority` already held for it; a
 * field PRESENT with a value (e.g. 'OPERATOR_CONFIRMED') replaces it;  a
 * field PRESENT with an explicit `null` CLEARS that facet's lock. Never
 * `||`/`??` at the whole-object level — that would either drop every
 * existing lock the moment ANY enrich response omits the key (a bare
 * `enrich.identityAuthority || prior.identityAuthority` fallback), or
 * make a lock impossible to ever explicitly revoke (a bare `??`). The
 * object itself can be entirely absent from `enrich` (the overwhelmingly
 * common case — only a valid manual-correction response sets it at all,
 * api/enrich.js's `manualCorrectionRequest?.valid` block) — that case
 * preserves `prior.identityAuthority` unchanged, field for field.
 *
 * @param {object} enrich - enrich API response
 * @param {object} prior - the existing stored record
 * @returns {object} facet -> 'OPERATOR_CONFIRMED' map, merged by presence
 */
export function mergeIdentityAuthority(enrich, prior) {
  const priorAuthority = (prior && typeof prior.identityAuthority === 'object' && prior.identityAuthority) || {};
  if (!hasKey(enrich, 'identityAuthority')) return { ...priorAuthority };
  const incoming = (enrich.identityAuthority && typeof enrich.identityAuthority === 'object') ? enrich.identityAuthority : {};
  const merged = { ...priorAuthority };
  for (const field of Object.keys(incoming)) {
    if (incoming[field] === null) {
      delete merged[field];
    } else {
      merged[field] = incoming[field];
    }
  }
  return merged;
}

/**
 * A6 dispatch (2026-07-26) — merges the server's response-embedded
 * pipelineAudit trace (src/lib/pipelineAudit.js) across a client merge.
 * Same site-parity concern as mergeConfirmedIdentity: every merge path
 * must propagate this field identically, not just the two sites a fresh
 * scan happens to use.
 *
 * Rules, in order:
 * 1. Key genuinely absent from the response (not just falsy) — nothing to
 *    merge, preserve whatever was already stored. Never actively clears
 *    evidence that was never re-sent.
 * 2. Present but falsy (null/undefined value) — same as absent. A real
 *    pipelineAudit is never null by construction server-side; treating an
 *    unexpected falsy value as "no new evidence" is the safe default
 *    rather than regressing a stored trace to nothing.
 * 3. Present and truthy — adopt it, UNLESS the currently stored trace has
 *    a strictly newer identityRevision (an older, slower async response
 *    arriving after a fresher one already landed must not overwrite it).
 *    Equal or newer incoming revision wins ties in favor of the response
 *    that just arrived.
 *
 * @param {object} enrich - enrich API response
 * @param {object} prior - the existing stored record (cur/s/item, at this call site)
 * @returns {object|null} the pipelineAudit trace to store
 */
export function mergePipelineAudit(enrich, prior) {
  const existing = prior?.pipelineAudit ?? null;
  if (!hasKey(enrich, 'pipelineAudit') || !enrich.pipelineAudit) return existing;
  const incoming = enrich.pipelineAudit;
  if (
    existing &&
    typeof existing.identityRevision === 'number' &&
    typeof incoming.identityRevision === 'number' &&
    existing.identityRevision > incoming.identityRevision
  ) {
    return existing;
  }
  return incoming;
}
