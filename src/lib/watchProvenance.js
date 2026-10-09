// WATCH provenance association. The grade a WATCH scan returns is produced by exactly one pass of
// watchPipeline; the model metadata recorded against it must be THAT pass's own call metadata.
//
// WATCH PROVENANCE INVARIANT (docs/GRADING-CAMPAIGN.md): current escalation returns the LAST attempted pass as
// the accepted result, so acceptedPassIndex === attemptedPassCount at every return today. This module does NOT rely
// on that: it carries the accepted pass's index and every attempt's metadata, and requires the metadata attached to
// the result to be the very object recorded for that pass index. Any change to escalation or pass selection
// requires renewed provenance-attribution certification.
//
// Fails toward UNKNOWN (null metadata), never toward a guess, and never throws or changes the scan.

/**
 * @param {{meta?: object|null, acceptedPassIndex?: number, attemptedPassCount?: number, attemptMetas?: Array<object|null>}} wp  watchPipeline's return value
 * @returns {{ok: true, meta: object, acceptedPassIndex: number, attemptedPassCount: number} | {ok: false, meta: null, reason: string}}
 */
export function selectAcceptedPassMeta(wp) {
  const { meta = null, acceptedPassIndex, attemptedPassCount, attemptMetas } = wp || {};
  const bad = (reason) => ({ ok: false, meta: null, reason });
  if (!Number.isInteger(acceptedPassIndex) || !Number.isInteger(attemptedPassCount)) return bad('pass index/count missing');
  if (attemptedPassCount < 1 || acceptedPassIndex < 1 || acceptedPassIndex > attemptedPassCount) return bad('accepted pass index outside attempted range');
  if (!Array.isArray(attemptMetas) || attemptMetas.length !== attemptedPassCount) return bad('attempt metadata count does not match attempted pass count');
  if (!meta || typeof meta !== 'object' || typeof meta.requestedModel !== 'string' || !meta.requestedModel) return bad('accepted metadata absent');
  if (attemptMetas[acceptedPassIndex - 1] !== meta) return bad('metadata is not the accepted pass\'s own call metadata');
  return { ok: true, meta, acceptedPassIndex, attemptedPassCount };
}
