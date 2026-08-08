// GrailKey Dispatch 21/22 (2026-08-07) — structured per-scan KV logging.
//
// Two frequency questions in one session (the GK-34 stale-comp-threshold
// measurement, the commit-p rank-slot investigation) both ended
// unanswerable for the identical reason: the Vercel runtime-log tool
// reliably answers COUNT queries over wide time ranges but times out on
// full-content pulls past roughly a 12-hour window. A direct Redis query
// against pre-structured records is not subject to that timeout at all —
// it reads data, not verbose console output.
//
// Record shape is versioned (`v: 1`) from day one, matching this
// project's own PC_FILTER_VERSION/CV_FILTER_VERSION convention
// (api/kv-cache.js) — a schema change must bump the version rather than
// silently reshape historical records out from under a query written
// against the old shape.
//
// Scope decision (2026-08-07): every scan gets a record, not just the
// "interesting" ones — a narrowly-scoped log recreates this exact
// problem the next time a different filter is needed, as it did twice
// in one session for two different filters. Volume at current scale
// (~60 scans/week heavy testing, ~500-byte records) is not a real
// constraint; revisit if usage changes by an order of magnitude.

export const SCAN_LOG_VERSION = 1;
export const SCAN_LOG_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days
export const SCAN_LOG_KEY_PREFIX = 'scanlog';
export const SCAN_LOG_INDEX_KEY = `${SCAN_LOG_KEY_PREFIX}:index:v${SCAN_LOG_VERSION}`;

/**
 * Builds the record key for one scan. Time-prefixed so keys sort
 * lexicographically in time order even without the sorted-set index
 * (a defense-in-depth property, not the primary query path — the
 * sorted-set index, keyed by the same `ts`, is what makes range queries
 * fast; this key shape just means a raw KEYS/SCAN over the prefix would
 * also come back roughly time-ordered, for free).
 *
 * @param {number} ts - Date.now() at record-build time
 * @param {string} id - unique per-request identifier (Vercel's own x-vercel-id when available, generated fallback otherwise)
 * @returns {string}
 */
export const buildScanLogKey = (ts, id) => `${SCAN_LOG_KEY_PREFIX}:v${SCAN_LOG_VERSION}:${ts}:${id}`;

/**
 * Pure record builder — no I/O, fully unit-testable. Every field is
 * optional and defaults to null rather than being omitted, so a
 * consumer querying many records can rely on a stable key set without
 * per-record presence checks.
 *
 * `terminalReason` is one of 'commit-p' | 'commit4-terminal' |
 * 'commit4.1-terminal' | null (null = neither branch fired, a normal
 * confident scan where issueAuthority was never provisional/conflicted
 * — reported honestly as null, not synthesized into a "clean" label at
 * build time; that mapping belongs to whoever queries the data, not to
 * the record itself).
 *
 * @param {object} fields
 * @param {number} fields.ts
 * @param {string} fields.id
 * @param {{title?: string|null, issue?: string|null, year?: string|null}|null} fields.book
 * @param {{status?: string|null, reasons?: string[], highConfidenceMarketplaceConsensus?: boolean|null, supportRatio?: number|null}|null} fields.issueAuthority
 * @param {{weightSum?: number|null, count?: number|null, overlapRatio?: number|null, decision?: string|null}|null} fields.familyWeight
 * @param {string|null} fields.terminalReason
 * @param {{raw?: number|null, eligible?: number|null, familyMembers?: number|null}|null} fields.poolSizes
 * @param {{evaluated?: boolean, fired?: boolean, blockedBy?: string[]}|null} fields.assetTypeOverride
 * @param {{convergenceTier?: string|null, coherentFamilyCount?: number|null, pcProductIdPresent?: boolean|null, catalogCorroborated?: boolean|null, activePoolCount?: number|null, soldPoolCount?: number|null, fired?: boolean|null}|null} fields.visionLowButCorroborated
 * @returns {object}
 */
export const buildScanLogRecord = ({
  ts,
  id,
  book = null,
  issueAuthority = null,
  familyWeight = null,
  terminalReason = null,
  poolSizes = null,
  assetTypeOverride = null,
  visionLowButCorroborated = null,
} = {}) => ({
  v: SCAN_LOG_VERSION,
  ts,
  id,
  book: book
    ? { title: book.title ?? null, issue: book.issue ?? null, year: book.year ?? null }
    : null,
  issueAuthority: issueAuthority
    ? {
        status: issueAuthority.status ?? null,
        reasons: Array.isArray(issueAuthority.reasons) ? issueAuthority.reasons : [],
        highConfidenceMarketplaceConsensus: issueAuthority.highConfidenceMarketplaceConsensus ?? null,
        supportRatio: issueAuthority.supportRatio ?? null,
      }
    : null,
  familyWeight: familyWeight
    ? {
        weightSum: familyWeight.weightSum ?? null,
        count: familyWeight.count ?? null,
        overlapRatio: familyWeight.overlapRatio ?? null,
        decision: familyWeight.decision ?? null,
      }
    : null,
  terminalReason,
  poolSizes: poolSizes
    ? {
        raw: poolSizes.raw ?? null,
        eligible: poolSizes.eligible ?? null,
        familyMembers: poolSizes.familyMembers ?? null,
      }
    : null,
  assetTypeOverride: assetTypeOverride
    ? {
        evaluated: assetTypeOverride.evaluated ?? false,
        fired: assetTypeOverride.fired ?? false,
        blockedBy: Array.isArray(assetTypeOverride.blockedBy) ? assetTypeOverride.blockedBy : [],
      }
    : null,
  // GrailKey Dispatch 32, Fix 32-C — additive field, no version bump.
  // Captures visionLowButCorroborated's inputs on both the fire and
  // decline paths (see api/enrich.js's out.visionLowButCorroboratedDiag),
  // so its fire rate and which arm (family vs. catalog) fired is
  // queryable post-hoc instead of dying on the same "no captured field"
  // gap that blocked the Fix 3b investigation (GrailKey Dispatch 32).
  visionLowButCorroborated: visionLowButCorroborated
    ? {
        convergenceTier: visionLowButCorroborated.convergenceTier ?? null,
        coherentFamilyCount: visionLowButCorroborated.coherentFamilyCount ?? null,
        pcProductIdPresent: visionLowButCorroborated.pcProductIdPresent ?? null,
        catalogCorroborated: visionLowButCorroborated.catalogCorroborated ?? null,
        activePoolCount: visionLowButCorroborated.activePoolCount ?? null,
        soldPoolCount: visionLowButCorroborated.soldPoolCount ?? null,
        fired: visionLowButCorroborated.fired ?? null,
      }
    : null,
});
