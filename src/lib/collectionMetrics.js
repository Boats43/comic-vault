/**
 * collectionMetrics.js
 *
 * GrailKey Commit C (2026-08-02, collection-header defect) — extracted
 * for testability (App.jsx contains JSX and cannot be imported by this
 * repo's plain-Node test runner; matches the established pattern of
 * pulling pure, non-UI logic into src/lib/*.js — issueAuthority.js,
 * dataQualityGuard.js, etc.).
 *
 * One shared aggregate-status derivation, computed ONLY from
 * getCollectionMetrics' own output (App.jsx, unchanged) — never
 * independently re-derived from raw catalogue state — so a header
 * rendering this value and a bucket grid rendering the same metrics
 * object can never disagree with each other.
 */

/**
 * @param {{
 *   totalComics: number,
 *   blocked: {count: number},
 *   needsReview: {count: number},
 *   photosNeeded: {count: number},
 *   ready: {count: number},
 * }} metrics - output of App.jsx's getCollectionMetrics(catalogue)
 * @returns {'BLOCKED'|'REVIEW'|'PHOTOS'|'READY'|'EMPTY'}
 */
export const getAggregateCollectionStatus = (metrics) => {
  if (!metrics || metrics.totalComics === 0) return 'EMPTY';
  if (metrics.blocked.count > 0) return 'BLOCKED';
  if (metrics.needsReview.count > 0) return 'REVIEW';
  if (metrics.photosNeeded.count > 0) return 'PHOTOS';
  if (metrics.ready.count > 0 && metrics.ready.count === metrics.totalComics) return 'READY';
  // Defensive: unreachable given getCollectionMetrics' own four-bucket
  // partition (every item falls into exactly one of blocked/needsReview/
  // photosNeeded/ready), but never silently mislabel an uncovered shape
  // as READY.
  return 'EMPTY';
};
