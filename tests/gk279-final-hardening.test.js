// tests/gk279-final-hardening.test.js
//
// GK-279 FINAL DEVELOPMENT HARDENING — real handlers (api/collection.js,
// api/physical-copy.js, api/capture-scan.js), real Development Postgres,
// throwaway principals.
//   * SERVER-OWNED candidate standing at the durable write (POST /api/collection):
//     zero candidates -> save; candidates -> 409, ZERO write; check failure ->
//     503 PHYSICAL_COPY_CANDIDATE_CHECK_UNAVAILABLE, ZERO write (fail-closed).
//   * priorCollectionItemId can never bypass the guard unless SERVER-PROVEN.
//   * Backstop retirement refusals; ANOTHER_COPY consumption by the explicit Capture.
//
// Invoke: node tests/gk279-final-hardening.test.js

import { readFileSync } from 'node:fs';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const line of readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}
process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';
if (!process.env.GRAILKEY_SESSION_SECRET) process.env.GRAILKEY_SESSION_SECRET = randomBytes(32).toString('base64url');
delete process.env.MILESTONE_TEN_H8_PASS;

let passed = 0, failed = 0;
const assertTrue = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
const U = (rel) => pathToFileURL(path.join(repoRoot, rel)).href;

const captureRoute = (await import(U('api/capture-scan.js'))).default;
const collectionRoute = (await import(U('api/collection.js'))).default;
const physRoute = (await import(U('api/physical-copy.js'))).default;
const captureMod = await import(U('src/modules/capture/index.js'));
const { closePool: closeAssets } = await import(U('src/modules/assets/index.js'));
const { createCollectionItem, closePool: closeCollection } = await import(U('src/modules/collection/index.js'));
const { closePool: closeAuth } = await import(U('src/modules/auth/index.js'));

const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
function mockRes() {
  const res = { statusCode: null, body: null, headers: {} };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
function tokenFor(principalId) {
  const now = Date.now();
  const p = Buffer.from(JSON.stringify({ principalId, iat: now, exp: now + 3600000, epoch: process.env.GRAILKEY_SESSION_EPOCH || '1' })).toString('base64url');
  return `${p}.${createHmac('sha256', process.env.GRAILKEY_SESSION_SECRET).update(p).digest('base64url')}`;
}
const hdr = (pid) => ({ authorization: `Bearer ${tokenFor(pid)}`, 'x-forwarded-for': ip() });

const RUN = `h${Date.now().toString(36)}`;
const BOOK = { title: `Hardening ${RUN} Annual`, issue: '7', year: 1971 };
const db = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const count = async (sql, args = []) => (await db.query(sql, args)).rows[0].n;
const cards = (pid) => count(`SELECT COUNT(*)::int n FROM data1_dev.collection_item WHERE principal_id=$1`, [pid]);
const assets = (pid) => count(`SELECT COUNT(*)::int n FROM data1_dev.current_owner WHERE owner_principal_id=$1`, [pid]);
const decisions = (pid) => count(`SELECT COUNT(*)::int n FROM data1_dev.physical_copy_decision_event WHERE principal_id=$1`, [pid]);
const media = (a) => count(`SELECT COUNT(*)::int n FROM data1_dev.media WHERE asset_id=$1`, [a]);
const rowExists = (id) => count(`SELECT COUNT(*)::int n FROM data1_dev.collection_item WHERE id=$1`, [id]);

const principals = [];
async function principal(label) {
  const id = randomUUID();
  await db.query(`INSERT INTO data1_dev.gk_principal (id, display_name, kind) VALUES ($1,$2,'user')`, [id, `${RUN}-${label}`]);
  principals.push(id);
  return id;
}
const itemIds = [];
async function seedRow(pid, id, attrs) { itemIds.push(id); await createCollectionItem({ principalId: pid, id, assetCategory: 'comic', attributes: attrs }); }
async function save(pid, id, attributes, extraBody = {}, images) {
  const res = mockRes();
  itemIds.push(id);
  await collectionRoute({ method: 'POST', headers: hdr(pid), query: {}, body: { id, assetCategory: 'comic', attributes, ...(images ? { images } : {}), ...extraBody } }, res);
  return res;
}
async function phys(pid, body) { const res = mockRes(); await physRoute({ method: 'POST', headers: hdr(pid), body }, res); return res; }
async function capture(pid, { collectionItemId, key, disposition, prior, photo = 'p' }) {
  const res = mockRes();
  await captureRoute({
    method: 'POST', headers: hdr(pid),
    body: { assetClass: 'comic',
      scanPayload: { correlationId: key, collectionItemId, book: { title: BOOK.title }, ...(prior ? { priorCollectionItemId: prior } : {}) },
      photos: [{ bytes: Buffer.from(`${RUN}-${photo}-${key}`).toString('base64'), contentType: 'image/jpeg', captureRole: 'capture-photo' }],
      idempotencyKey: key, ...(disposition ? { copyDisposition: disposition } : {}),
    },
  }, res);
  return res;
}

console.log(`\n=== GK-279 final hardening (run ${RUN}) ===`);
try {
  const P = await principal('owner');
  const Q = await principal('other');

  // Fixture: P owns a real physical asset A (novel title -> normal mint, no prompt).
  const aItem = `${RUN}-a-item`;
  const s0 = await save(P, aItem, { ...BOOK });
  assertTrue(s0.statusCode === 200, '1. ZERO candidates (server-determined): the save succeeds');
  const capA = await capture(P, { collectionItemId: aItem, key: randomUUID() });
  assertTrue(capA.statusCode === 200 && capA.body.mintOutcome === 'minted-new', 'fixture: asset A minted via explicit Capture');
  const assetA = capA.body.gkAssetId;

  console.log('\n--- candidate-required save: ZERO write ---');
  const c0 = { cards: await cards(P), assets: await assets(P), dec: await decisions(P) };
  const dupId = `${RUN}-dup`;
  const sDup = await save(P, dupId, { ...BOOK }, {}, ['data:image/jpeg;base64,/9j/AAAA']);
  assertTrue(sDup.statusCode === 409 && sDup.body.error === 'PHYSICAL_COPY_DECISION_REQUIRED' && sDup.body.candidates?.length >= 1, '2. candidates exist, no decision -> 409 PHYSICAL_COPY_DECISION_REQUIRED');
  assertTrue(await rowExists(dupId) === 0 && await cards(P) === c0.cards, 'zero collection write');
  assertTrue(await assets(P) === c0.assets && await decisions(P) === c0.dec, 'zero physical-asset write, zero decision write');

  console.log('\n--- D/E: direct save and false standing cannot bypass ---');
  const sFalse = await save(P, `${RUN}-false-zero`, { ...BOOK }, { candidateStanding: 'ZERO_CANDIDATES', candidates: [], physicalCopyDecision: 'ANOTHER_COPY', candidateCheckId: 'cc_forged', copyDisposition: { choice: 'ANOTHER_COPY' } });
  assertTrue(sFalse.statusCode === 409 && await rowExists(`${RUN}-false-zero`) === 0, '4/5. a client-asserted "zero candidates"/decision/standing is ignored — server standing wins, no row');
  const appSrc = readFileSync(path.join(repoRoot, 'api', 'collection.js'), 'utf8');
  assertTrue(appSrc.indexOf('assertPhysicalCopySaveAllowed({') > -1 && appSrc.indexOf('assertPhysicalCopySaveAllowed({') < appSrc.indexOf('await withResolvedImages(attributes, images)'), '19. PHOTO ORDERING (structural): the standing check runs BEFORE any photo upload (withResolvedImages/mediaPut) — a refusal leaves no orphan object');

  console.log('\n--- C: candidate check failure is LOUD and FAIL-CLOSED ---');
  captureMod.__setCandidateCheckFaultForTests('simulated candidate-store outage');
  const logs = [];
  const origErr = console.error; console.error = (...a) => { logs.push(a.join(' ')); };
  const cf = { cards: await cards(P), assets: await assets(P), dec: await decisions(P) };
  const failId = `${RUN}-fail`;
  const sFail = await save(P, failId, { ...BOOK });
  const pFail = await phys(P, { action: 'candidates', book: BOOK });
  const novelFail = await save(P, `${RUN}-novel-during-outage`, { title: `Totally ${RUN} Different`, issue: '1', year: 1999 });
  console.error = origErr;
  captureMod.__setCandidateCheckFaultForTests(null);
  assertTrue(sFail.statusCode === 503 && sFail.body.error === 'PHYSICAL_COPY_CANDIDATE_CHECK_UNAVAILABLE' && sFail.body.retryable === true, '3. check failure -> 503 PHYSICAL_COPY_CANDIDATE_CHECK_UNAVAILABLE (distinct, retryable)');
  assertTrue(pFail.statusCode === 503 && pFail.body.error === 'PHYSICAL_COPY_CANDIDATE_CHECK_UNAVAILABLE', 'the preflight endpoint reports the same stable code');
  assertTrue(novelFail.statusCode === 503, 'fail-closed even for an apparently novel book — "check failed" is never "zero candidates"');
  assertTrue(await rowExists(failId) === 0 && await cards(P) === cf.cards && await assets(P) === cf.assets && await decisions(P) === cf.dec, 'zero collection / asset / decision writes during the outage');
  const line = logs.find((l) => l.includes('CANDIDATE_CHECK_UNAVAILABLE')) || '';
  console.log('    log signature:', line);
  assertTrue(/^\[physical-copy\] CANDIDATE_CHECK_UNAVAILABLE principal=[0-9a-f-]{36} handler=collection-create requestId=\S+ category=\S+ build=\S+$/.test(line), 'exact, greppable log signature with principal/handler/requestId/category/build');
  assertTrue(!line.includes('Bearer') && !line.includes(tokenFor(P).slice(0, 20)) && !line.includes(BOOK.title), 'log carries no token and no payload');
  const sRecover = await save(P, `${RUN}-novel-after`, { title: `Totally ${RUN} Different`, issue: '1', year: 1999 });
  assertTrue(sRecover.statusCode === 200, 'after the outage a retry succeeds (no stuck state)');

  console.log('\n--- existing-row updates are not a duplicate-creation event; ANOTHER decision lets the new row save ---');
  const sUpd = await save(P, aItem, { ...BOOK, grade: 'VF 8.0' });
  assertTrue(sUpd.statusCode === 200, 'updating an EXISTING row is never blocked');
  const anId = `${RUN}-another`;
  const keyAn = randomUUID();
  const anRec = await phys(P, { action: 'another', book: BOOK, collectionItemId: anId, idempotencyKey: keyAn });
  assertTrue(anRec.statusCode === 200, 'ANOTHER_COPY recorded server-side BEFORE the row exists');
  const sAn = await save(P, anId, { ...BOOK });
  assertTrue(sAn.statusCode === 200 && await rowExists(anId) === 1, '13. after the decision, the new row saves (cards +1)');
  const anRow = (await db.query(`SELECT surface, choice, resulting_gk_asset_id FROM data1_dev.physical_copy_decision_event WHERE principal_id=$1 AND capture_idempotency_key=$2`, [P, keyAn])).rows;
  assertTrue(anRow.length === 1 && anRow[0].surface === 'SAVE' && anRow[0].choice === 'ANOTHER_COPY' && anRow[0].resulting_gk_asset_id === null, 'durable SAVE-surface ANOTHER_COPY row, resulting asset intentionally NULL (nothing minted yet)');
  let upd = false; try { await db.query(`UPDATE data1_dev.physical_copy_decision_event SET resulting_gk_asset_id=$2 WHERE id=(SELECT id FROM data1_dev.physical_copy_decision_event WHERE principal_id=$1 AND capture_idempotency_key=$3)`, [P, assetA, keyAn]); } catch { upd = true; }
  assertTrue(upd, '27. the decision row is immutable — a later Capture cannot rewrite it');
  const assetsBefore = await assets(P);
  const capKey = randomUUID();
  const capAn = await capture(P, { collectionItemId: anId, key: capKey });
  assertTrue(capAn.statusCode === 200 && capAn.body.mintOutcome === 'minted-new' && capAn.body.gkAssetId !== assetA, '14/28. the explicit Capture consumes the decision (NO second prompt) and mints exactly one new asset');
  assertTrue(await assets(P) === assetsBefore + 1, 'asset +1');
  const capRow = (await db.query(`SELECT surface, choice, resulting_gk_asset_id FROM data1_dev.physical_copy_decision_event WHERE principal_id=$1 AND incoming_collection_item_id=$2 AND surface='CAPTURE'`, [P, anId])).rows;
  const lnk = (await db.query(`SELECT gk_asset_id FROM data1_dev.collection_item_link WHERE collection_item_id=$1`, [anId])).rows;
  assertTrue(capRow.length === 1 && capRow[0].resulting_gk_asset_id === capAn.body.gkAssetId && lnk[0]?.gk_asset_id === capAn.body.gkAssetId, '29. final gkAsset reconstructable from durable state: SAVE decision + CAPTURE row + canonical link agree');
  const cap2 = await capture(P, { collectionItemId: anId, key: capKey });
  assertTrue(cap2.statusCode === 200 && cap2.body.gkAssetId === capAn.body.gkAssetId && await assets(P) === assetsBefore + 1, '15/30. Capture retry mints no second asset');

  console.log('\n--- F: foreign principal standing ---');
  const qItem = `${RUN}-q-item`;
  await save(Q, qItem, { ...BOOK });
  const qCap = await capture(Q, { collectionItemId: qItem, key: randomUUID() });
  assertTrue(qCap.statusCode === 200, "fixture: Q owns its own asset of a look-alike book (P's assets are invisible to Q)");
  const qSameId = `${RUN}-q-dup`;
  const pDecidedId = `${RUN}-p-decided`;
  await phys(P, { action: 'another', book: BOOK, collectionItemId: pDecidedId, idempotencyKey: randomUUID() });
  const qUsesP = await save(Q, pDecidedId, { ...BOOK });
  assertTrue(qUsesP.statusCode === 409, "F. P's ANOTHER_COPY decision for an id grants Q nothing — Q still gets the decision-required refusal");
  const qSame = await phys(Q, { action: 'same', book: BOOK, selectedGkAssetId: assetA, idempotencyKey: randomUUID() });
  assertTrue(qSame.statusCode === 400, "Q cannot name P's asset as a SAME_COPY candidate");

  console.log('\n--- continuity bypass (priorCollectionItemId) must be SERVER-PROVEN ---');
  const bookZ = { title: BOOK.title };
  const oItem = `${RUN}-o`; await seedRow(P, oItem, { ...BOOK });
  const bef = { a: await assets(P), c: await cards(P) };
  const oRes = await capture(P, { collectionItemId: oItem, key: randomUUID(), prior: `${RUN}-does-not-exist` });
  assertTrue(oRes.statusCode === 400 && await assets(P) === bef.a, 'O. forged nonexistent priorCollectionItemId -> refused, nothing minted');
  const pRes = await capture(P, { collectionItemId: oItem, key: randomUUID(), prior: qItem });
  assertTrue(pRes.statusCode === 400 && pRes.body.error.replace(qItem, 'X') === oRes.body.error.replace(`${RUN}-does-not-exist`, 'X'), "P. another principal's row as prior -> the IDENTICAL refusal as a nonexistent id (no information leak), nothing minted");
  const qRes = await capture(P, { collectionItemId: oItem, key: randomUUID(), prior: aItem });
  assertTrue(qRes.statusCode === 409 && qRes.body.error === 'PHYSICAL_COPY_DECISION_REQUIRED' && await assets(P) === bef.a, "Q. P's real but NON-predecessor row as prior does NOT bypass: the candidate check is still enforced, nothing minted/aliased");
  const novelPrior = `${RUN}-novelprior`; await seedRow(P, novelPrior, { title: `Unrelated ${RUN} Title`, issue: '2', year: 1988 });
  const qNovel = await capture(P, { collectionItemId: novelPrior, key: randomUUID(), prior: aItem });
  assertTrue(qNovel.statusCode === 200 && qNovel.body.mintOutcome === 'minted-new' && qNovel.body.gkAssetId !== assetA, 'an unproven prior never aliases the row onto the prior asset (a distinct asset is minted for a distinct book)');

  // R: server-proven predecessor — a durable SAME_COPY decision naming this incoming row.
  const rItem = `${RUN}-r`;
  await seedRow(P, rItem, { ...BOOK });
  const keyR = randomUUID();
  const rSame = await capture(P, { collectionItemId: rItem, key: keyR, disposition: { choice: 'SAME_COPY', selectedGkAssetId: assetA } });
  assertTrue(rSame.statusCode === 200 && rSame.body.copyDecision?.retired === true && await rowExists(rItem) === 0, 'fixture: backstop SAME_COPY retired the transient row (decision names it)');
  await seedRow(P, rItem, { ...BOOK }); // the same local id is pushed again (stale device resync)
  const rCont = await capture(P, { collectionItemId: rItem, key: randomUUID(), prior: aItem });
  assertTrue(rCont.statusCode === 200 && rCont.body.mintOutcome === 'attached-existing-via-continuity-alias' && rCont.body.gkAssetId === assetA, 'R. SERVER-PROVEN continuity (durable SAME_COPY decision) still takes the intended alias path to the same asset');

  console.log('\n--- backstop retirement REFUSALS: nothing weakened, nothing written ---');
  const refuse = async (label, id, setup) => {
    await seedRow(P, id, { ...BOOK });
    await setup(id);
    const before = { a: await assets(P), m: await media(assetA), d: await decisions(P), c: await cards(P) };
    const r = await capture(P, { collectionItemId: id, key: randomUUID(), disposition: { choice: 'SAME_COPY', selectedGkAssetId: assetA } });
    assertTrue(r.statusCode === 409 && /SAME_COPY_UNAVAILABLE/.test(r.body.error), `${label}: SAME_COPY retirement refused (409 SAME_COPY_UNAVAILABLE)`);
    assertTrue(await rowExists(id) === 1 && await assets(P) === before.a && await media(assetA) === before.m && await decisions(P) === before.d && await cards(P) === before.c, `${label}: row remains, no asset/media/decision/card change`);
  };
  const corrId = `${RUN}-corr`;
  await refuse('17. operator_correction_event history', corrId, async (id) => {
    await db.query(`INSERT INTO data1_dev.operator_correction_event (principal_id, collection_item_id, surface, action, before_value, after_value, authority_before, authority_after, idempotency_key)
                    VALUES ($1,$2,'IDENTITY','CORRECT','{}','{}','{}','{}',$3)`, [P, id, `${RUN}-corr-${randomUUID()}`]);
  });
  assertTrue(await count(`SELECT COUNT(*)::int n FROM data1_dev.operator_correction_event WHERE collection_item_id=$1`, [corrId]) === 1, '24. the correction history REMAINS');
  const exclId = `${RUN}-excl`;
  await refuse('18. learning-corpus exclusion reference', exclId, async (id) => {
    await db.query(`INSERT INTO data1_dev.learning_corpus_exclusion (event_table, event_id, reason_code, reason, ticket, source_collection_item_id) VALUES ('model_prediction_event',$1,'TEST_ARTIFACT','gk279 hardening fixture','GK-279',$2)`, [randomUUID(), id]);
  });
  await refuse('multi-photo evidence', `${RUN}-multi`, async (id) => {
    await db.query(`UPDATE data1_dev.collection_item SET attributes = attributes || '{"remoteImages":["/a","/b"]}'::jsonb WHERE id=$1`, [id]);
  });
  const trg = await db.query(`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('data1_dev.operator_correction_event'::regclass,'data1_dev.learning_corpus_exclusion'::regclass,'data1_dev.physical_copy_decision_event'::regclass)`);
  assertTrue(['operator_correction_event_no_update', 'operator_correction_event_no_delete', 'operator_correction_event_guard_ins', 'learning_corpus_exclusion_no_update', 'physical_copy_decision_event_no_delete'].every((n) => trg.rows.some((r) => r.tgname === n)), '26. every append-only / guard trigger is still installed (none weakened)');
  const foreignRetire = await capture(Q, { collectionItemId: corrId, key: randomUUID(), disposition: { choice: 'SAME_COPY', selectedGkAssetId: assetA } });
  assertTrue(foreignRetire.statusCode === 400 && await rowExists(corrId) === 1, "foreign principal can neither retire nor reference P's row");

  console.log('\n--- unauthenticated ---');
  const un = mockRes(); await collectionRoute({ method: 'POST', headers: { 'x-forwarded-for': ip() }, query: {}, body: { assetCategory: 'comic', id: `${RUN}-unauth`, attributes: { ...BOOK } } }, un);
  assertTrue(un.statusCode === 401, 'unauthenticated save -> 401 (guard is behind auth)');
} catch (e) {
  failed++; console.log('  ✗ UNEXPECTED ERROR', e?.stack || e);
} finally {
  try { await db.query(`DELETE FROM data1_dev.collection_item_link WHERE collection_item_id = ANY($1)`, [itemIds]); } catch (e) { console.log('cleanup link:', e.message); }
  try { await db.query(`DELETE FROM data1_dev.collection_item WHERE id = ANY($1)`, [itemIds]); } catch (e) { console.log('cleanup items:', e.message); }
  await db.end();
  await closeAssets(); await closeCollection(); await closeAuth();
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
