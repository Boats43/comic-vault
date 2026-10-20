// tests/helpers/d4RaceInvariants.js -- D4 B7a certification helpers (test-only; no production code is touched).
//
// evaluateRaceInvariants(): the five state invariants for ONE completed supersession race, as a PURE function over observations, so the negative controls
// (tests/d4-race-invariants-negative-controls.test.js) can feed it hostile observations and prove each invariant actually detects its violation.
//   1 exactly one successful call per pair      2 no unconverted raw 40P01 escaped      3 no duplicate rows (incl. duplicate supersession events)
//   4 no cycle                                  5 no duplicate evidence links
// Status is PASS | FAIL | VACUOUS | INCOMPLETE. VACUOUS (invariant 2 only) means "0 deadlocks observed and none escaped": it never certifies deadlock conversion.
// INCOMPLETE means the race could not be evaluated (missing rows / results); callers MUST treat it as a failure, never as a silent pass.
import { randomUUID } from 'node:crypto';

export const VACUOUS_RAW_40P01_MESSAGE = '0 deadlocks observed; 0 unconverted raw 40P01 errors escaped. Invariant vacuously satisfied.';
export const INVARIANT_IDS = ['one-success-per-pair', 'no-raw-40P01-escape', 'no-duplicate-rows', 'no-cycle', 'no-duplicate-evidence'];

export function evaluateRaceInvariants({ pairs, results, attemptLogs, rows, supersessionEvents = [], evidenceDupRows = [] }) {
  const mk = (id, status, detail) => ({ id, status, detail });
  const wellFormed = Array.isArray(pairs) && pairs.length > 0 && Array.isArray(results) && results.length === pairs.length * 2
    && Array.isArray(attemptLogs) && attemptLogs.length === pairs.length && Array.isArray(rows)
    && pairs.every((p) => rows.some((r) => r.id === p.a) && rows.some((r) => r.id === p.b));
  if (!wellFormed) return INVARIANT_IDS.map((id) => mk(id, 'INCOMPLETE', 'race observations are missing or malformed; the race cannot be evaluated'));
  const out = [];

  // 1 -- exactly one fulfilled call per pair
  const badPairs = pairs.map((_, i) => ({ i, fulfilled: [results[i * 2], results[i * 2 + 1]].filter((r) => r.status === 'fulfilled').length })).filter((x) => x.fulfilled !== 1);
  out.push(badPairs.length === 0 ? mk(INVARIANT_IDS[0], 'PASS', `exactly one successful call in each of ${pairs.length} pair(s)`)
    : mk(INVARIANT_IDS[0], 'FAIL', `pair(s) without exactly one success: ${badPairs.map((x) => `#${x.i}=${x.fulfilled}`).join(', ')}`));

  // 2 -- raw 40P01 must never be the FINAL outcome of a call
  const observed = attemptLogs.reduce((n, l) => n + l.a.filter((x) => x.code === '40P01').length + l.b.filter((x) => x.code === '40P01').length, 0);
  const escaped = results.filter((r) => r.status === 'rejected' && r.reason?.code === '40P01').length;
  out.push(escaped > 0 ? mk(INVARIANT_IDS[1], 'FAIL', `${escaped} call(s) ended with a raw 40P01 (unconverted); ${observed} deadlock(s) observed`)
    : observed === 0 ? mk(INVARIANT_IDS[1], 'VACUOUS', VACUOUS_RAW_40P01_MESSAGE)
    : mk(INVARIANT_IDS[1], 'PASS', `${observed} deadlock(s) observed; all converted (0 raw 40P01 escaped)`));

  out.push(...evaluateStateInvariants({ pairs, rows, supersessionEvents, evidenceDupRows }));
  return out;
}

/** Invariants 3-5 (state only; need no call results). Used by the race evaluator and by the single-call deterministic test. */
export function evaluateStateInvariants({ pairs, rows, supersessionEvents = [], evidenceDupRows = [] }) {
  const mk = (id, status, detail) => ({ id, status, detail });
  if (!Array.isArray(pairs) || !Array.isArray(rows) || !pairs.every((p) => rows.some((r) => r.id === p.a) && rows.some((r) => r.id === p.b))) return INVARIANT_IDS.slice(2).map((id) => mk(id, 'INCOMPLETE', 'durable rows are missing; the state cannot be evaluated'));
  const out = [];
  // 3 -- no duplicate rows, no duplicate durable supersession event
  const seen = new Map();
  for (const r of rows) seen.set(r.id, (seen.get(r.id) || 0) + 1);
  const dupRows = [...seen].filter(([, n]) => n > 1);
  const dupEvents = supersessionEvents.filter((e) => Number(e.n) > 1);
  out.push(dupRows.length === 0 && dupEvents.length === 0 ? mk(INVARIANT_IDS[2], 'PASS', `each of ${seen.size} assertion id(s) appears once; no supersession event recorded twice`)
    : mk(INVARIANT_IDS[2], 'FAIL', `duplicate rows: ${dupRows.length}, duplicate supersession events: ${dupEvents.length}`));

  // 4 -- no cycle (both sides of a pair superseded, or a 2-cycle)
  const byId = Object.fromEntries(rows.map((r) => [r.id, r.superseded_by ?? null]));
  const cyc = pairs.filter((p) => (byId[p.a] != null && byId[p.b] != null) || (byId[p.a] === p.b && byId[p.b] === p.a));
  out.push(cyc.length === 0 ? mk(INVARIANT_IDS[3], 'PASS', `no cycle in ${pairs.length} pair(s)`) : mk(INVARIANT_IDS[3], 'FAIL', `${cyc.length} pair(s) formed a cycle`));

  // 5 -- no duplicate evidence links
  out.push(evidenceDupRows.length === 0 ? mk(INVARIANT_IDS[4], 'PASS', 'no duplicate evidence-link rows') : mk(INVARIANT_IDS[4], 'FAIL', `${evidenceDupRows.length} duplicate evidence-link group(s)`));
  return out;
}

/** Reads the durable observations for a set of pairs from data1_dev (search_path must already be set on `q`). */
export async function collectRaceObservations(q, pairs) {
  const ids = pairs.flatMap((p) => [p.a, p.b]);
  const rows = (await q.query('SELECT id, superseded_by FROM asset_identifier_assertion WHERE id = ANY($1::uuid[])', [ids])).rows;
  const supersessionEvents = (await q.query(
    `SELECT payload->>'oldAssertionId' AS old_id, payload->>'newAssertionId' AS new_id, count(*)::int AS n FROM domain_event
     WHERE event_type='identifier-assertion.superseded' AND (payload->>'oldAssertionId') = ANY($1::text[]) GROUP BY 1,2`, [ids])).rows;
  const evidenceDupRows = (await q.query(
    `SELECT assertion_id, observation_id, count(*)::int AS n FROM asset_identifier_assertion_evidence WHERE assertion_id = ANY($1::uuid[]) GROUP BY 1,2 HAVING count(*) > 1`, [ids])).rows;
  return { rows, supersessionEvents, evidenceDupRows };
}

/** Deterministic conversion verdict for the real lock-cycle test. Pure; see the negative controls. */
export function evaluateDeterministicConversion({ victim, sAttemptLog, sFinal }) {
  const had40P01 = Array.isArray(sAttemptLog) && sAttemptLog.some((a) => a.code === '40P01');
  if (victim !== 'S' || !had40P01) return { ok: false, reason: `the service transaction S was not the deadlock victim (victim=${victim}, 40P01 recorded by retry layer=${had40P01})` };
  if (!sFinal || sFinal.ok !== true) return { ok: false, reason: `unconverted: S ended with ${sFinal?.errorCode ?? 'no result'} instead of a successful retry` };
  const first40 = sAttemptLog.findIndex((a) => a.code === '40P01');
  if (sFinal.attemptsUsed != null && sFinal.attemptsUsed < 2 && first40 >= 0) return { ok: false, reason: 'success without a retry after the 40P01' };
  return { ok: true, reason: 'real 40P01 reached the retry layer and the retried transaction committed' };
}

// ---- fresh fixtures -------------------------------------------------------------------------------------------------------------------------------------------------
const usedPairs = new Set();
/** Throws if this process has already issued this (a,b) pair: a reused deterministic fixture is a test defect, not a pass. */
export function registerFreshPair(a, b) {
  const key = [a, b].sort().join('|');
  if (usedPairs.has(key)) throw new Error(`fixture pair reused within this process: ${a} / ${b}`);
  usedPairs.add(key);
}

/** A pair is FRESH only if both rows exist, are live, are not referenced by any other row, and have no supersession event. */
export async function assertFreshPair(q, a, b) {
  const reasons = [];
  if (a === b) reasons.push('A and B are the same id');
  const rows = (await q.query('SELECT id, superseded_by FROM asset_identifier_assertion WHERE id = ANY($1::uuid[])', [[a, b]])).rows;
  if (rows.length !== 2) reasons.push(`expected 2 existing rows, found ${rows.length}`);
  if (rows.some((r) => r.superseded_by !== null)) reasons.push('a row is already superseded (consumed fixture)');
  const refs = (await q.query('SELECT count(*)::int AS n FROM asset_identifier_assertion WHERE superseded_by = ANY($1::uuid[])', [[a, b]])).rows[0].n;
  if (refs > 0) reasons.push(`${refs} row(s) already reference the pair as a supersession target`);
  const ev = (await q.query(`SELECT count(*)::int AS n FROM domain_event WHERE event_type='identifier-assertion.superseded' AND ((payload->>'oldAssertionId') = ANY($1::text[]) OR (payload->>'newAssertionId') = ANY($1::text[]))`, [[a, b]])).rows[0].n;
  if (ev > 0) reasons.push(`${ev} supersession event(s) already reference the pair`);
  return { fresh: reasons.length === 0, reasons };
}

const nonce = (label) => `${label}-${Date.now()}-${randomUUID()}`;
/** Mints a brand-new asset, identifier definition and two live assertions through the real service. Every call is unique across processes (UUID nonce). */
export async function mintFreshPair(assets, { principalId, marker }) {
  const asset = await assets.createPhysicalAsset({ principalId, captureBasis: { marker, nonce: nonce('basis') }, assetClass: 'generic', source: marker, idempotencyKey: nonce('mint') });
  const idf = await assets.recordIdentifierDefinition({ principalId, scheme: 'isbn', issuingAuthority: 'ISBN-agency', normalizedValue: nonce('isbn'), scope: 'PRODUCT_CLASS', idempotencyKey: nonce('idf') });
  const rec = (label) => assets.recordIdentifierAssertion({ principalId, gkAssetId: asset.assetId, identifierId: idf.identifierId, source: `${marker}:${label}`, resolutionAuthority: 'CORROBORATED', idempotencyKey: nonce(label) });
  const a = await rec('a'), b = await rec('b');
  return { assetId: asset.assetId, identifierId: idf.identifierId, a: a.assertionId, b: b.assertionId };
}
