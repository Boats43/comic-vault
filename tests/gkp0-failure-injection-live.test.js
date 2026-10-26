// tests/gkp0-failure-injection-live.test.js
//
// GK-P0 PROVIDER IDEMPOTENCY -- failure injection against the REAL api/list-ebay.js handler and the REAL Development
// Postgres, with an eBay stand-in that enforces Item.UUID uniqueness exactly as eBay documents it (error 488 + the
// existing ItemID in structured ErrorParameters ParamID="1"). NO live eBay call is possible.
//
// The invariant under test: for ONE logical publication, the provider never ends up with more than one listing, a
// verifiable original is recovered, and anything unverifiable fails closed (AMBIGUOUS / refused) -- never a second listing.
//
//   node tests/gkp0-failure-injection-live.test.js

import { spawnSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bootstrap, repoRoot } from './helpers/gkp0Harness.mjs';

let passed = 0, failed = 0;
const failures = [];
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; failures.push(l); console.log(`  ✗ ${l}`); } };

const registryFile = path.join(os.tmpdir(), `gkp0-registry-${Date.now()}-${process.pid}.json`);
const h = await bootstrap({ registryFile });
const { controls, reg, A, mint, publish, ledger, outcomes, closeListing, idMod, NOT_READY_AUTHORITY: NOT_READY, READY_AUTHORITY: READY } = h;
const listingIds = () => Object.keys(reg().listings);
const bodies = () => reg().bodies;
const addCount = () => reg().calls.filter((c) => c === 'AddFixedPriceItem').length;
const skuListings = (sku) => Object.values(reg().listings).filter((l) => l.sku === sku);

console.log('\n=== GK-P0 failure injection: provider-side idempotency (real handler, real Development DB, UUID-enforcing eBay stand-in) ===\n');
const PA = await h.newPrincipal('gkp0-fi-a');
const PB = await h.newPrincipal('gkp0-fi-b');
const created = [];

try {
  // ═══ 1 + 3: provider succeeds, response is LOST; the retry carries the SAME UUID and recovers the original ═══
  console.log('-- 1/3/4: provider succeeds, response lost -> same-UUID retry -> 488 -> verified recovery --');
  {
    const a = await mint(PA, 'lost', READY);
    const expected = idMod.derivePublicationIdentity({ gkAssetId: a.gkAssetId, generation: 0 });
    controls.loseResponse = true;
    const r1 = await publish(PA, a, { ready: true });
    controls.loseResponse = false;
    ok(r1.statusCode >= 400, `the lost response surfaces as an error to the caller (${r1.statusCode})`);
    ok(listingIds().length === 1, 'the provider DID create exactly one listing');
    ok((await outcomes(a.gkAssetId)).length === 0, 'no LISTED outcome was persisted (the response never arrived)');
    const original = listingIds()[0];
    const r2 = await publish(PA, a, { ready: true });
    ok(r2.statusCode === 200 && r2.body?.recovered === true && r2.body?.listingId === original, `retry -> 200 recovered, the ORIGINAL listing id (${r2.statusCode} ${r2.body?.listingId} vs ${original})`);
    ok(listingIds().length === 1 && skuListings(expected.sku).length === 1, 'provider still holds exactly ONE listing for this publication');
    const bs = bodies().filter((b) => b.sku === expected.sku);
    ok(bs.length === 2 && bs[0].uuid === bs[1].uuid && bs[0].uuid === expected.uuid, `both AddFixedPriceItem requests carried the SAME deterministic UUID (${bs.map((b) => b.uuid).join(' / ')})`);
    ok(/^[0-9A-F]{32}$/.test(expected.uuid), 'UUID is exactly 32 hexadecimal characters (0-9, A-F)');
    const o = await outcomes(a.gkAssetId);
    ok(o.length === 1 && o[0].outcome_type === 'LISTED' && o[0].external_listing_id === original, 'the recovered original is persisted as the durable LISTED outcome');
    const before = reg().calls.length;
    const r3 = await publish(PA, a, { ready: true });
    ok(r3.statusCode === 409 && r3.body?.error === 'DUPLICATE_ACTIVE_LISTING' && reg().calls.length === before, 'a further retry is now a DUPLICATE_ACTIVE_LISTING with ZERO provider calls');
    created.push({ principalId: PA, gkAssetId: a.gkAssetId, listingId: original });
  }

  // ═══ 2: REAL process crash after the provider created the listing, before LISTED persistence ═══
  console.log('\n-- 2: process crash after the provider write, before LISTED persistence (real child process) --');
  {
    const a = await mint(PA, 'crash', READY);
    const expected = idMod.derivePublicationIdentity({ gkAssetId: a.gkAssetId, generation: 0 });
    const payloadFile = path.join(os.tmpdir(), `gkp0-payload-${Date.now()}.json`);
    writeFileSync(payloadFile, JSON.stringify({ principalId: PA, asset: a, ready: true }));
    const child = spawnSync(process.execPath, [path.join(repoRoot, 'tests', 'helpers', 'gkp0CrashChild.mjs'), registryFile, payloadFile], { env: process.env, timeout: 120000, encoding: 'utf8' });
    rmSync(payloadFile, { force: true });
    ok(child.status === 137, `the child really crashed mid-publication (exit ${child.status})`);
    ok(skuListings(expected.sku).length === 1, 'the provider created exactly one listing before the crash');
    ok((await outcomes(a.gkAssetId)).length === 0, 'nothing durable was written: no LISTED outcome after the crash');
    const m = await A.acquirePublicationMutex({ principalId: PA, gkAssetId: a.gkAssetId });
    ok(m.acquired === true, 'the crashed process\'s publication mutex was released by Postgres (no leaked lock)');
    await m.release();
    const original = skuListings(expected.sku)[0].itemId;
    const r = await publish(PA, a, { ready: true });
    ok(r.statusCode === 200 && r.body?.recovered === true && r.body?.listingId === original, `post-crash retry recovers the ORIGINAL listing (${r.statusCode} ${r.body?.listingId})`);
    ok(skuListings(expected.sku).length === 1, 'still exactly ONE provider listing for the logical publication');
    const bs = bodies().filter((b) => b.sku === expected.sku);
    ok(bs.length === 2 && bs[0].uuid === bs[1].uuid, 'the crashed attempt and the retry used the identical UUID');
    created.push({ principalId: PA, gkAssetId: a.gkAssetId, listingId: original });
  }

  // ═══ 4: Q41 path -- 488 with the existing ItemID is recovered through the attempt ledger ═══
  console.log('\n-- 4 (Q41): duplicate-UUID 488 on the OPERATOR_MANUAL path -> verified recovery, ledger LISTED_CONFIRMED --');
  {
    const a = await mint(PA, 'q41-488', NOT_READY);
    controls.simulateEarlierCreation = true; // an earlier, lost call already created the listing under this attempt's UUID
    const r = await publish(PA, a);
    ok(r.statusCode === 200 && r.body?.recovered === true, `Q41 488 recovered (${r.statusCode} ${r.body?.error || ''})`);
    ok(JSON.stringify(await ledger(a.gkAssetId)) === JSON.stringify(['AUTHORIZED', 'SUBMITTED', 'LISTED_CONFIRMED']), 'attempt ledger closes AUTHORIZED -> SUBMITTED -> LISTED_CONFIRMED');
    const o = await outcomes(a.gkAssetId);
    ok(o.length === 1 && o[0].outcome_type === 'LISTED' && o[0].external_listing_id === r.body?.listingId, 'recovered listing persisted as LISTED');
    created.push({ principalId: PA, gkAssetId: a.gkAssetId, listingId: r.body?.listingId });
  }

  console.log('\n-- 1 (Q41): response lost -> AMBIGUOUS in the ledger, retry BLOCKED, no second listing --');
  {
    const a = await mint(PA, 'q41-lost', NOT_READY);
    const n0 = listingIds().length;
    controls.loseResponse = true;
    const r1 = await publish(PA, a);
    controls.loseResponse = false;
    ok(r1.statusCode === 502 && r1.body?.error === 'LISTING_OUTCOME_UNKNOWN', `lost response on Q41 -> LISTING_OUTCOME_UNKNOWN (${r1.statusCode} ${r1.body?.error})`);
    ok((await ledger(a.gkAssetId)).includes('AMBIGUOUS'), 'ledger records AMBIGUOUS');
    const r2 = await publish(PA, a);
    ok(r2.statusCode === 409 && !/DUPLICATE_UUID/.test(r2.body?.error || ''), `retry is refused by the ledger guard (${r2.statusCode} ${r2.body?.error})`);
    ok(listingIds().length === n0 + 1, 'exactly one provider listing exists for the attempt');
  }

  // ═══ 5: unrelated / mismatched 488 -> fail closed, no second listing, no false LISTED ═══
  console.log('\n-- 5: unrelated or mismatched 488 -> AMBIGUOUS / refused, never a false success --');
  const modes = [['foreign-seller', 'seller-mismatch'], ['no-structured-id', 'no-structured-item-id'], ['sku-mismatch', 'sku-mismatch'], ['not-active', 'listing-not-active'], ['message-mismatch', 'structured-message-mismatch']];
  for (const [mode, expectedReason] of modes) {
    const a = await mint(PA, `unv-${mode}`, READY);
    controls.loseResponse = true;
    await publish(PA, a, { ready: true });
    controls.loseResponse = false;
    const n = listingIds().length;
    controls.duplicateMode = mode;
    const r = await publish(PA, a, { ready: true });
    controls.duplicateMode = 'honest';
    ok(r.statusCode === 502 && r.body?.code === 'DUPLICATE_UUID_UNVERIFIED' && r.body?.reason === expectedReason, `[${mode}] refused as unverified, reason ${r.body?.reason} (${r.statusCode})`);
    ok((await outcomes(a.gkAssetId)).length === 0 && listingIds().length === n, `[${mode}] no LISTED row persisted and NO new provider listing`);
  }
  {
    const a = await mint(PA, 'unv-q41', NOT_READY);
    controls.simulateEarlierCreation = true; controls.duplicateMode = 'foreign-seller';
    const r = await publish(PA, a);
    controls.duplicateMode = 'honest';
    ok(r.statusCode === 502 && r.body?.code === 'DUPLICATE_UUID_UNVERIFIED', `[Q41 foreign-seller] refused as unverified (${r.statusCode})`);
    const l = await ledger(a.gkAssetId);
    ok(l[l.length - 1] === 'AMBIGUOUS', `[Q41] the attempt is preserved AMBIGUOUS (${JSON.stringify(l)})`);
    const r2 = await publish(PA, a);
    ok(r2.statusCode === 409, `[Q41] a blind retry is blocked by the ledger (${r2.statusCode})`);
  }

  // ═══ 9: mutex expires before the provider call completes ═══
  console.log('\n-- 9: publication mutex times out while the provider call is still running --');
  {
    const a = await mint(PA, 'timeout', READY);
    const expected = idMod.derivePublicationIdentity({ gkAssetId: a.gkAssetId, generation: 0 });
    process.env.GK_PUBLICATION_MUTEX_MAX_HOLD_MS = '200';
    controls.addDelayMs = 1200;
    const first = publish(PA, a, { ready: true });
    await new Promise((r) => setTimeout(r, 600)); // the 200ms hold has expired; the first call is still in flight
    const second = publish(PA, a, { ready: true });
    const [r1, r2] = await Promise.all([first, second]);
    controls.addDelayMs = 0; delete process.env.GK_PUBLICATION_MUTEX_MAX_HOLD_MS;
    console.log(`  observed: ${r1.statusCode}/${r2.statusCode} recovered=${[r1.body?.recovered, r2.body?.recovered]} provider listings for this publication=${skuListings(expected.sku).length}`);
    ok(skuListings(expected.sku).length === 1, 'even with the mutex expired, the provider holds exactly ONE listing (the UUID is the real guard)');
    ok(r1.statusCode === 200 && r2.statusCode === 200 && r1.body?.listingId === r2.body?.listingId, 'both requests converge on the same listing id');
    ok(r2.body?.recovered === true || r1.body?.recovered === true, 'the second request was a verified 488 recovery, not a second publication');
    const o = await outcomes(a.gkAssetId);
    ok(o.length === 1 && o[0].outcome_type === 'LISTED', 'exactly one durable LISTED outcome');
    created.push({ principalId: PA, gkAssetId: a.gkAssetId, listingId: r1.body?.listingId });
  }

  // ═══ 10: a genuinely authorized later listing generation gets a NEW UUID ═══
  console.log('\n-- 10: new explicitly authorized listing generation after a terminal outcome -> NEW UUID, new listing --');
  {
    const a = await mint(PA, 'regen', READY);
    const id0 = idMod.derivePublicationIdentity({ gkAssetId: a.gkAssetId, generation: 0 });
    const id1 = idMod.derivePublicationIdentity({ gkAssetId: a.gkAssetId, generation: 1 });
    const p1 = await publish(PA, a, { ready: true });
    ok(p1.statusCode === 200 && !p1.body?.recovered, `first listing (${p1.statusCode})`);
    const blocked = await publish(PA, a, { ready: true });
    ok(blocked.statusCode === 409 && blocked.body?.error === 'DUPLICATE_ACTIVE_LISTING', 'while the first is active, a relist is refused');
    await closeListing(PA, a.gkAssetId, p1.body.listingId);
    const live = await A.getPublicationIdentity({ principalId: PA, gkAssetId: a.gkAssetId });
    ok(live.generation === 1 && live.uuid === id1.uuid && live.uuid !== id0.uuid, 'after the terminal outcome the generation is 1 and the UUID changed');
    const p2 = await publish(PA, a, { ready: true });
    ok(p2.statusCode === 200 && !p2.body?.recovered && p2.body?.listingId !== p1.body.listingId, `the authorized relisting creates a NEW listing (${p2.statusCode})`);
    const us = bodies().filter((b) => [id0.sku, id1.sku].includes(b.sku)).map((b) => b.uuid);
    ok(us.length === 2 && us[0] === id0.uuid && us[1] === id1.uuid, `request UUIDs were ${us.join(' then ')}`);
    created.push({ principalId: PA, gkAssetId: a.gkAssetId, listingId: p2.body?.listingId });
  }

  // ═══ isolation ═══
  console.log('\n-- principal isolation preserved --');
  {
    const a = await mint(PA, 'iso', READY);
    let err = null;
    try { await A.getPublicationIdentity({ principalId: PB, gkAssetId: a.gkAssetId }); } catch (e) { err = e; }
    ok(err && err.name === 'AuthorizationFailedError', `a principal that does not own the asset cannot derive its publication identity (${err?.name})`);
    const r = await publish(PB, a, { ready: true });
    ok(r.statusCode >= 400 && r.body?.recovered !== true, `a foreign principal cannot publish the asset (${r.statusCode})`);
  }
} finally {
  for (const c of created) {
    try {
      const has = await h.db.query(`SELECT 1 FROM data1_dev.outcome_event WHERE external_listing_id = $1 AND outcome_type = 'DELISTED'`, [c.listingId]);
      if (c.listingId && !has.rowCount) await closeListing(c.principalId, c.gkAssetId, c.listingId);
    } catch (e) { console.log('  (cleanup) close failed', c.listingId, e.message); }
  }
  rmSync(registryFile, { force: true });
  await h.db.end();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) { console.log('Failures:'); failures.forEach((f) => console.log(`  ✗ ${f}`)); process.exit(1); }
process.exit(0);
