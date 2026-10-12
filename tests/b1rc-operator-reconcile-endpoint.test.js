// tests/b1rc-operator-reconcile-endpoint.test.js
//
// B1-RC RC2 / RC3 -- the operator reconciliation interface (api/operator-reconcile.js): authorization, display, append-only
// writes, policy safety, and "never publishes". REAL handler, REAL Development Postgres (throwaway principals/assets minted per
// run). global.fetch is replaced by a function that THROWS: if the endpoint (or anything under it) ever tried to reach eBay -- a
// read or a write -- the test would fail. NO marketplace call is possible.
//   node tests/b1rc-operator-reconcile-endpoint.test.js

import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
for (const line of readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}
process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';
if (!process.env.GRAILKEY_SESSION_SECRET) process.env.GRAILKEY_SESSION_SECRET = randomBytes(32).toString('base64url');

let fetchCalls = 0;
global.fetch = async (url) => { fetchCalls++; throw new Error(`NO NETWORK ALLOWED: the reconciliation interface attempted a call to ${String(url).slice(0, 60)}`); };

let passed = 0, failed = 0;
const failures = [];
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; failures.push(l); console.log(`  ✗ ${l}`); } };
function mockRes() {
  const res = { statusCode: null, body: null, headers: {} };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

const { issueToken } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'auth', 'token.js')).href);
const A = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'assets', 'index.js')).href);
const { enrollAsset } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'inventory', 'index.js')).href);
const { createCollectionItem } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'collection', 'index.js')).href);
const { attemptCorrelation, REQUIRED_ABSENCE_SOURCES } = await import(pathToFileURL(path.join(repoRoot, 'src', 'lib', 'operatorAuthority.js')).href);
const handler = (await import(pathToFileURL(path.join(repoRoot, 'api', 'operator-reconcile.js')).href)).default;

const db = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const nonce = (l) => `b1rc-${l}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
async function newPrincipal(label, kind) {
  const id = (await db.query('SELECT uuidv7() AS id')).rows[0].id;
  await db.query(`INSERT INTO data1_dev.gk_principal (id, display_name, kind) VALUES ($1, $2, $3)`, [id, label, kind]);
  return id;
}
const OP = await newPrincipal('b1rc-operator', 'operator');
const OP2 = await newPrincipal('b1rc-operator-2', 'operator');
const USER = await newPrincipal('b1rc-ordinary-user', 'user');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
// An AMBIGUOUS attempt owned by `principalId`, submitted `hoursAgo` hours ago (the SUBMITTED / AMBIGUOUS rows are inserted with
// that recorded_at so the 60-minute policy delay can be exercised without waiting or faking a clock).
async function ambiguousAttempt(principalId, label, hoursAgo = 3) {
  const n = nonce(label);
  const { assetId: gkAssetId } = await A.createPhysicalAsset({ principalId, captureBasis: { test: true, n }, assetClass: 'comic', source: 'test-fixture', idempotencyKey: `${n}-mint` });
  await enrollAsset({ principalId, gkAssetId, idempotencyKey: `${n}-enroll` });
  const cid = `cv_${n}`;
  await createCollectionItem({ principalId, id: cid, assetCategory: 'comic', attributes: { title: 'B1RC Comic', publisher: 'T', year: '1990' } });
  await A.linkCollectionItem({ principalId, collectionItemId: cid, gkAssetId, idempotencyKey: `${n}-link` });
  const { decisionEventId } = await A.recordDecision({ principalId, gkAssetId, recommendation: 'RESEARCH', idempotencyKey: `${n}-decision` });
  await A.attachMedia({ principalId, gkAssetId, bytes: PNG, contentType: 'image/png', captureRole: 'capture-photo', idempotencyKey: `${n}-photo` });
  const { operatorActionEventId } = await A.recordOperatorAction({ principalId, gkAssetId, decisionEventId, actionCode: 'LIST', actionValueAmount: 25, source: 'test-fixture', idempotencyKey: `${n}-action` });
  const auth = await A.authorizeOperatorManualListing({ principalId, gkAssetId, decisionEventId, operatorActionEventId, outgoingAmount: 25, ackPayload: { priceOverridden: true, manualPrice: 25 } });
  const sub = new Date(Date.now() - hoursAgo * 3600e3);
  const row = (await db.query(`SELECT id, correlation_id FROM data1_dev.operator_authority_event WHERE attempt_id = $1 AND phase = 'AUTHORIZED'`, [auth.attemptId])).rows[0];
  for (const [phase, at, due] of [['SUBMITTED', sub, null], ['AMBIGUOUS', new Date(sub.getTime() + 1000), new Date(sub.getTime() + 48 * 3600e3)]]) {
    await db.query(
      `INSERT INTO data1_dev.operator_authority_event (id, authorized_event_id, attempt_id, phase, gk_asset_id, principal_id, operator_action_event_id, decision_event_id, channel, authority_type, review_due_at, correlation_id, recorded_at, detail)
       VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, $7, 'ebay', 'OPERATOR_MANUAL', $8, $9, $10, '{"reason":"test-fixture"}'::jsonb)`,
      [row.id, auth.attemptId, phase, gkAssetId, principalId, operatorActionEventId, decisionEventId, due, row.correlation_id, at]
    );
  }
  return { attemptId: auth.attemptId, gkAssetId, submittedAt: sub };
}
const tok = (pid) => issueToken({ principalId: pid }).token;
const call = async (method, pid, { body, query, headers } = {}) => {
  const res = mockRes();
  // each simulated call comes from its own client address: the endpoint's per-address rate limiter (30 / 10 min) is real and is left in force
  await handler({ method, headers: { 'x-forwarded-for': `10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, ...(pid ? { authorization: `Bearer ${tok(pid)}` } : {}), ...(headers || {}) }, body, query: query || {} }, res);
  return res;
};
const rowsOf = async (attemptId) => (await db.query(`SELECT phase, recon_verdict, new_publish_authorized, principal_id, reconciliation FROM data1_dev.operator_authority_event WHERE attempt_id = $1 ORDER BY recorded_at, id`, [attemptId])).rows;
const count = async (attemptId) => (await rowsOf(attemptId)).length;
const guardFor = (pid, aid) => A.getListingAttemptGuard({ principalId: pid, gkAssetId: aid });
const outcomeRows = async (aid) => (await db.query(`SELECT 1 FROM data1_dev.outcome_event WHERE gk_asset_id = $1`, [aid])).rows.length;
const ALL = [...REQUIRED_ABSENCE_SOURCES];
const createdListings = [];

console.log('\n=== B1-RC: operator reconciliation interface (real handler, real Development DB, NO network) ===\n');
try {
  const X = await ambiguousAttempt(OP, 'auth');
  const before = await count(X.attemptId);

  console.log('-- authentication and operator-only authorization --');
  let r = await call('GET', null, { query: { attemptId: X.attemptId } });
  ok(r.statusCode === 401, 'no session -> 401');
  const rBad = mockRes();
  await handler({ method: 'POST', headers: { 'x-forwarded-for': '10.9.9.9', authorization: 'Bearer not.a.token' }, body: { attemptId: X.attemptId, verdict: 'UNRESOLVED' }, query: {} }, rBad);
  ok(rBad.statusCode === 401, 'a forged / invalid token -> 401');
  r = await call('GET', USER, { query: { attemptId: X.attemptId } });
  ok(r.statusCode === 403 && r.body.error === 'OPERATOR_ONLY', 'an ordinary (non-operator) account is refused (403 OPERATOR_ONLY) even with a valid session');
  r = await call('POST', USER, { body: { attemptId: X.attemptId, verdict: 'UNRESOLVED' } });
  ok(r.statusCode === 403 && r.body.error === 'OPERATOR_ONLY', 'an ordinary account cannot write a reconciliation either');
  r = await call('GET', OP2, { query: { attemptId: X.attemptId } });
  ok(r.statusCode === 403 && r.body.error === 'FORBIDDEN', 'a DIFFERENT operator cannot read this attempt (principal-bound)');
  r = await call('POST', OP2, { body: { attemptId: X.attemptId, verdict: 'UNRESOLVED', principalId: OP, principal_id: OP } , headers: { 'x-principal-id': OP } });
  ok(r.statusCode === 403 && r.body.error === 'FORBIDDEN', 'a different operator cannot write, even naming the owner in the body or a header (the principal is taken only from the token)');
  ok(await count(X.attemptId) === before, 'none of the refused calls wrote anything');
  r = await call('PUT', OP);
  ok(r.statusCode === 405, 'unsupported method -> 405');
  {
    // the per-address limiter (30 / 10 min) sits in front of authentication: a client hammering the endpoint is throttled, not authenticated
    const same = '10.77.77.77'; let first429 = null;
    for (let i = 1; i <= 34; i++) {
      const rr = mockRes();
      await handler({ method: 'GET', headers: { 'x-forwarded-for': same }, body: undefined, query: {} }, rr);
      if (rr.statusCode === 429 && first429 === null) first429 = i;
      if (i === 1) ok(rr.statusCode === 401, 'an unauthenticated request from a fresh address is 401');
    }
    ok(first429 === 31, `the 31st request from one address inside the window is throttled (429 at request ${first429})`);
  }

  console.log('\n-- display: the exact attempt --');
  r = await call('GET', OP, { query: { attemptId: X.attemptId } });
  const v = r.body?.attempt;
  const corr = attemptCorrelation(X.attemptId);
  ok(r.statusCode === 200 && v.attemptId === X.attemptId && v.assetId === X.gkAssetId, 'shows the exact attempt id and asset id');
  ok(new Date(v.submittedAt).getTime() === X.submittedAt.getTime(), 'shows the submission time');
  ok(v.correlation.sku === corr.sku && v.correlation.uuid === corr.uuid, `shows the correlation label to look for in Seller Hub (${corr.sku})`);
  ok(v.state === 'AMBIGUOUS' && v.blocksNewPublish === true && v.approvedAmountCents === 2500 && v.engineRecommendation === 'RESEARCH', 'shows the current state (AMBIGUOUS, blocking), the approved cents and the engine recommendation');
  ok(v.review && v.review.status === 'WITHIN_WINDOW' && v.policy.requiredSources.length === 4 && v.policy.minimumDelayMinutes === 60, 'shows the review deadline and the policy the observation will be judged against');
  ok(!JSON.stringify(r.body).includes('ack_payload') && !JSON.stringify(r.body).includes('refresh') && !/Bearer|token/i.test(JSON.stringify(r.body)), 'the view carries no acknowledgment payload, credential or token');
  r = await call('GET', OP);
  ok(r.statusCode === 200 && r.body.queue.some((q) => q.attemptId === X.attemptId), 'the queue lists the caller\'s ambiguous attempt');
  const Y = await ambiguousAttempt(OP2, 'queue-other');
  r = await call('GET', OP);
  ok(!r.body.queue.some((q) => q.attemptId === Y.attemptId), 'the queue never lists another operator\'s attempts');
  r = await call('GET', OP, { query: { attemptId: 'not-a-uuid' } });
  ok(r.statusCode === 400, 'a malformed attempt id -> 400');

  console.log('\n-- input validation --');
  r = await call('POST', OP, { body: { attemptId: X.attemptId, verdict: 'MAYBE' } });
  ok(r.statusCode === 400 && await count(X.attemptId) === before, 'an unknown verdict -> 400, nothing written');
  r = await call('POST', OP, { body: { verdict: 'UNRESOLVED' } });
  ok(r.statusCode === 400, 'missing attempt id -> 400');
  r = await call('POST', OP, { body: { attemptId: X.attemptId, verdict: 'LISTING_FOUND' } });
  ok(r.statusCode === 400 && await count(X.attemptId) === before, 'LISTING_FOUND without a listing id -> 400, nothing written');

  console.log('\n-- RC3: uncertain / incomplete / conflicting observations can never authorize a listing --');
  const goodAt = new Date(X.submittedAt.getTime() + 2 * 3600e3).toISOString(); // 2 h after submission, well in the past
  const cases = [
    ['only the Active view checked', { checkedSources: ['SELLER_HUB_ACTIVE'], checkedAt: goodAt, evidenceRef: 'screenshot-1', requestNewPublish: true }],
    ['three of four views checked', { checkedSources: ALL.slice(0, 3), checkedAt: goodAt, evidenceRef: 'screenshot-1', requestNewPublish: true }],
    ['no sources listed', { checkedSources: [], checkedAt: goodAt, evidenceRef: 'screenshot-1', requestNewPublish: true }],
    ['no evidence reference', { checkedSources: ALL, checkedAt: goodAt, requestNewPublish: true }],
    ['blank evidence reference', { checkedSources: ALL, checkedAt: goodAt, evidenceRef: '  ', requestNewPublish: true }],
    ['observed only 10 minutes after submission', { checkedSources: ALL, checkedAt: new Date(X.submittedAt.getTime() + 600e3).toISOString(), evidenceRef: 'screenshot-1', requestNewPublish: true }],
    ['observed BEFORE the submission', { checkedSources: ALL, checkedAt: new Date(X.submittedAt.getTime() - 3600e3).toISOString(), evidenceRef: 'screenshot-1', requestNewPublish: true }],
    ['observation time in the future', { checkedSources: ALL, checkedAt: new Date(Date.now() + 3 * 3600e3).toISOString(), evidenceRef: 'screenshot-1', requestNewPublish: true }],
    ['no observation time', { checkedSources: ALL, evidenceRef: 'screenshot-1', requestNewPublish: true }],
    ['garbage observation time', { checkedSources: ALL, checkedAt: 'yesterday-ish', evidenceRef: 'screenshot-1', requestNewPublish: true }],
    ['client tries to supply a clock far in the future', { checkedSources: ALL, checkedAt: new Date(Date.now() + 3 * 3600e3).toISOString(), evidenceRef: 'screenshot-1', requestNewPublish: true, now: new Date(Date.now() + 99 * 3600e3).toISOString() }],
    ['client supplies an "empty lookup" result', { checkedSources: ['SELLER_HUB_ACTIVE'], checkedAt: goodAt, evidenceRef: 'screenshot-1', requestNewPublish: true, automatedLookup: { matches: [], scannedAllListsCompletely: true, absenceProven: true } }],
    ['sources given as a string, not a list', { checkedSources: 'SELLER_HUB_ACTIVE,SELLER_HUB_SCHEDULED,SELLER_HUB_SOLD,SELLER_HUB_UNSOLD', checkedAt: goodAt, evidenceRef: 'screenshot-1', requestNewPublish: true }],
    ['complete and timely but NO publish requested', { checkedSources: ALL, checkedAt: goodAt, evidenceRef: 'screenshot-1', requestNewPublish: false }],
    ['"requestNewPublish" sent as the string "true"', { checkedSources: ALL, checkedAt: goodAt, evidenceRef: 'screenshot-1', requestNewPublish: 'true' }],
  ];
  for (const [label, extra] of cases) {
    const rr = await call('POST', OP, { body: { attemptId: X.attemptId, verdict: 'NOT_FOUND', ...extra } });
    const g = await guardFor(OP, X.gkAssetId);
    ok(rr.statusCode === 200 && rr.body.newPublishAuthorized === false && g.allowed === false && rr.body.publishPerformed === false, `[${label}] -> newPublishAuthorized:false, the asset stays BLOCKED (${g.code}), nothing published`);
  }
  const downgraded = (await rowsOf(X.attemptId)).filter((x) => x.phase === 'OPERATOR_RECONCILED');
  ok(downgraded.length === cases.length && downgraded.every((x) => x.new_publish_authorized === false), `all ${cases.length} uncertain observations were recorded append-only and none authorized a publish`);
  ok(downgraded.filter((x) => x.recon_verdict === 'UNRESOLVED').length >= cases.length - 2, 'the downgraded ones are stored as UNRESOLVED with the operator\'s claim preserved');
  ok(downgraded.slice(0, 3).every((x) => x.reconciliation.claimedVerdict === 'NOT_FOUND' && x.reconciliation.downgradeReasons.length > 0), 'each downgrade records its reasons');
  const noPublishRequested = downgraded[13];
  ok(noPublishRequested.recon_verdict === 'NOT_FOUND' && noPublishRequested.new_publish_authorized === false, 'a convincing NOT_FOUND with no publish request is recorded as NOT_FOUND but authorizes nothing');
  ok(fetchCalls === 0, 'zero network calls across all of the above');

  console.log('\n-- the route that does not require guessing: a complete, timely, evidenced NOT_FOUND --');
  r = await call('POST', OP, { body: { attemptId: X.attemptId, verdict: 'NOT_FOUND', checkedSources: ALL, checkedAt: goodAt, evidenceRef: 'seller-hub-screenshots-2026-10-12', observations: 'Active, Scheduled, Sold, Unsold all checked for GK label; none', requestNewPublish: true } });
  ok(r.statusCode === 200 && r.body.recordedVerdict === 'NOT_FOUND' && r.body.newPublishAuthorized === true && r.body.resultingState === 'RECONCILED_NOT_LISTED', 'the policy-passing observation lifts THIS attempt\'s block');
  ok(r.body.publishPerformed === false && /separate explicit authorization/.test(r.body.notice), 'the response states that nothing was published and that a new listing needs its own separate authorization');
  ok((await guardFor(OP, X.gkAssetId)).allowed === true, 'the guard now allows a NEW attempt through the normal publish path (this endpoint does not make it)');
  ok(await outcomeRows(X.gkAssetId) === 0 && fetchCalls === 0, 'no outcome_event, no listing, and no network call exist');
  const last = (await rowsOf(X.attemptId)).filter((x) => x.phase === 'OPERATOR_RECONCILED').pop();
  ok(last.principal_id === OP && last.reconciliation.policyVersion === 'recon-v1', 'the authorizing event is owned by the operator and carries the policy version');

  console.log('\n-- LISTING_FOUND and UNRESOLVED --');
  const F = await ambiguousAttempt(OP, 'found');
  const listingId = `b1rc-found-${Date.now()}`;
  r = await call('POST', OP, { body: { attemptId: F.attemptId, verdict: 'LISTING_FOUND', externalListingId: listingId, evidenceRef: `ebay.com/itm/${listingId}`, observations: 'found in Active' } });
  createdListings.push(listingId);
  ok(r.statusCode === 200 && r.body.resultingState === 'LISTED' && r.body.newPublishAuthorized === false && r.body.publishPerformed === false, 'LISTING_FOUND reconciles to the existing listing; no publish');
  ok(r.body.outcomeRecorded && r.body.outcomeRecorded.ok === true && await outcomeRows(F.gkAssetId) === 1, 'the existing listing is recorded in the outcome ledger');
  ok((await guardFor(OP, F.gkAssetId)).allowed === false, 'the asset stays blocked (a live listing exists)');
  r = await call('POST', OP, { body: { attemptId: F.attemptId, verdict: 'UNRESOLVED' } });
  ok(r.statusCode === 409, 'a LISTED attempt cannot be reconciled again (409)');
  const U = await ambiguousAttempt(OP, 'unresolved');
  r = await call('POST', OP, { body: { attemptId: U.attemptId, verdict: 'UNRESOLVED', observations: 'Seller Hub down', evidenceRef: 'incident-1' } });
  ok(r.statusCode === 200 && r.body.resultingState === 'CLOSED_BLOCKED' && r.body.newPublishAuthorized === false, 'UNRESOLVED -> CLOSED_BLOCKED, block preserved');
  ok((await guardFor(OP, U.gkAssetId)).code === 'LISTING_ATTEMPT_CLOSED_BLOCKED', 'the guard reports LISTING_ATTEMPT_CLOSED_BLOCKED');
  r = await call('GET', OP);
  ok(!r.body.queue.some((q) => q.attemptId === U.attemptId), 'a closed-but-blocked attempt leaves the review queue (owned and closed, not pending)');
  r = await call('POST', OP, { body: { attemptId: U.attemptId, verdict: 'NOT_FOUND', checkedSources: ALL, checkedAt: new Date(U.submittedAt.getTime() + 2 * 3600e3).toISOString(), evidenceRef: 'later-evidence', requestNewPublish: true } });
  ok(r.statusCode === 200 && r.body.newPublishAuthorized === true, 'later evidence can reopen a closed-but-blocked attempt (the latest event governs)');

  console.log('\n-- append-only --');
  let rejected = false;
  try { await db.query(`UPDATE data1_dev.operator_authority_event SET recon_verdict = 'NOT_FOUND' WHERE attempt_id = $1`, [X.attemptId]); } catch (e) { rejected = /append-only/i.test(e.message); }
  ok(rejected, 'a reconciliation event cannot be updated');
  ok(fetchCalls === 0, `TOTAL network calls attempted by this entire suite: ${fetchCalls}`);
} finally {
  if (createdListings.length) await db.query(`DELETE FROM data1_dev.outcome_event WHERE external_listing_id = ANY($1)`, [createdListings]);
  await db.end();
}
let r2;
console.log(`\n${'='.repeat(60)}\nB1-RC RECONCILE ENDPOINT: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('\nFAILURES:'); failures.forEach((f) => console.log('  ✗ ' + f)); }
process.exit(failed > 0 ? 1 : 0);
