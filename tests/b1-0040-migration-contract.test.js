// tests/b1-0040-migration-contract.test.js
//
// Dispatch B1 + B1-FINAL A1/A2 -- real, isolated scratch-schema proof of db/data0/0040_operator_manual_authority.sql
// (operator_authority_event: durable OPERATOR_MANUAL authority + immutable approved-value snapshot + marketplace attempt
// ledger + append-only operator reconciliation). data1_dev is never touched. The four referenced parent tables are
// minimal PK-only stand-ins; economic_ledger_immutable() is a stand-in with the same contract as 0034's.
//
// Invoke: node tests/b1-0040-migration-contract.test.js

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
for (const line of readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}

let passed = 0, failed = 0;
const failures = [];
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; failures.push(l); console.log(`  ✗ ${l}`); } };
const rejects = async (fn, label, frag) => {
  try { await fn(); failed++; failures.push(label); console.log(`  ✗ ${label} (did NOT reject)`); }
  catch (e) {
    if (!frag || String(e.message).toLowerCase().includes(frag.toLowerCase())) { passed++; console.log(`  ✓ ${label} (rejected: ${e.message.slice(0, 90)})`); }
    else { failed++; failures.push(label); console.log(`  ✗ ${label} (wrong reason: ${e.message})`); }
  }
};
const succeeds = async (fn, label) => { try { await fn(); passed++; console.log(`  ✓ ${label}`); } catch (e) { failed++; failures.push(label); console.log(`  ✗ ${label} (${e.message})`); } };

console.log('\n=== B1 / GK-284 -- 0040 operator_authority_event migration contract (real scratch-schema proof) ===\n');

const { assertScratchSchemaTarget } = await import(pathToFileURL(path.join(repoRoot, 'scripts', 'db-admin-preflight.mjs')).href);
const { client, sessionPid } = await assertScratchSchemaTarget({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, label: 'b1-0040-migration-contract' });
const SCHEMA = `b1_0040_scratch_${Date.now()}`;
const read = (f) => readFileSync(path.join(repoRoot, 'db', 'data0', f), 'utf8');
const qualify = (raw) => raw.replace(/SET search_path TO data1_dev;/g, `SET search_path TO ${SCHEMA};`);
const guard = async () => {
  const r = await client.query('SELECT current_schema() s, pg_backend_pid() pid');
  if (r.rows[0].pid !== sessionPid || r.rows[0].s !== SCHEMA || r.rows[0].s === 'data1_dev') throw new Error('SAFETY ABORT: not in the scratch schema');
};
const id = () => crypto.randomUUID();

try {
  await client.query(`CREATE SCHEMA ${SCHEMA}`);
  await client.query(`SET search_path TO ${SCHEMA}`);
  await guard();
  for (const t of ['gk_asset', 'gk_principal', 'decision_event', 'operator_action_event']) await client.query(`CREATE TABLE ${t} (id UUID PRIMARY KEY)`);

  await rejects(() => client.query(qualify(read('0040_operator_manual_authority.sql'))), 'refuses to apply when economic_ledger_immutable() (0034) is absent', '0034');
  await client.query(`CREATE FUNCTION economic_ledger_immutable() RETURNS TRIGGER AS $$ BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation'; END; $$ LANGUAGE plpgsql`);
  await succeeds(() => client.query(qualify(read('0040_operator_manual_authority.sql'))), 'applies cleanly');
  await succeeds(() => client.query(qualify(read('0040_operator_manual_authority.sql'))), 're-applies cleanly (idempotent)');

  const A = id(), P = id(), D = id(), OA = id();
  await client.query('INSERT INTO gk_asset (id) VALUES ($1)', [A]);
  await client.query('INSERT INTO gk_principal (id) VALUES ($1)', [P]);
  await client.query('INSERT INTO decision_event (id) VALUES ($1)', [D]);
  await client.query('INSERT INTO operator_action_event (id) VALUES ($1)', [OA]);

  const COLS = ['id', 'authorized_event_id', 'attempt_id', 'phase', 'gk_asset_id', 'principal_id', 'operator_action_event_id', 'decision_event_id', 'channel', 'authority_type',
    'approved_amount', 'approved_amount_cents', 'approved_currency', 'approved_at', 'engine_recommendation', 'governing_grade', 'evidence_class', 'verified_sold_count',
    'ack_payload', 'ack_warnings', 'evidence', 'provider_correlation', 'external_listing_id', 'detail', 'review_due_at', 'recon_verdict', 'new_publish_authorized', 'reconciliation', 'correlation_id'];
  const J = (v) => (v === null || v === undefined ? null : JSON.stringify(v));
  const ins = (o) => {
    const r = { id: id(), attempt_id: id(), phase: 'AUTHORIZED', gk_asset_id: A, principal_id: P, operator_action_event_id: OA, decision_event_id: D, channel: 'ebay', authority_type: 'OPERATOR_MANUAL',
      approved_amount: '263.80', approved_amount_cents: 26380, approved_currency: 'USD', approved_at: new Date(), engine_recommendation: 'RESEARCH',
      governing_grade: { source: 'MODEL_PREDICTED', uncertainty: 'MODEL_PREDICTED_NOT_OPERATOR_CONFIRMED' }, evidence_class: 'SOLD_CANDIDATES_UNVERIFIED', verified_sold_count: 0,
      ack_payload: { priceOverridden: true }, ack_warnings: {}, evidence: {}, provider_correlation: { uuid: 'a'.repeat(32), sku: 'GK-' + 'a'.repeat(32) },
      external_listing_id: null, detail: null, review_due_at: null, recon_verdict: null, new_publish_authorized: null, reconciliation: null, correlation_id: id(), ...o };
    r.authorized_event_id = o.authorized_event_id || r.id;
    const jsonCols = new Set(['governing_grade', 'ack_payload', 'ack_warnings', 'evidence', 'provider_correlation', 'detail', 'reconciliation']);
    const vals = COLS.map((c) => (jsonCols.has(c) ? J(r[c]) : r[c]));
    return client.query(`INSERT INTO operator_authority_event (${COLS.join(',')}) VALUES (${COLS.map((_, i) => `$${i + 1}`).join(',')})`, vals).then(() => r);
  };
  const NULLS = { approved_amount: null, approved_amount_cents: null, approved_currency: null, approved_at: null, engine_recommendation: null, governing_grade: null, evidence_class: null, verified_sold_count: null, ack_payload: null, ack_warnings: null, evidence: null, provider_correlation: null };
  const child = (auth, phase, extra = {}) => ins({ id: id(), attempt_id: auth.attempt_id, phase, authorized_event_id: auth.id, ...NULLS, ...extra });

  console.log('-- positive path --');
  let auth;
  await succeeds(async () => { auth = await ins({}); }, 'AUTHORIZED row with the complete immutable snapshot inserts');
  await succeeds(() => child(auth, 'SUBMITTED'), 'SUBMITTED chains to its AUTHORIZED row');
  await succeeds(() => child(auth, 'LISTED_CONFIRMED', { external_listing_id: 'ITEM-1' }), 'LISTED_CONFIRMED with a listing id inserts');
  const auth2 = await ins({});
  await succeeds(() => child(auth2, 'SUBMITTED'), 'second attempt: SUBMITTED');
  await succeeds(() => child(auth2, 'AMBIGUOUS', { review_due_at: new Date(Date.now() + 48 * 3600e3), detail: { reason: 'network-error' } }), 'second attempt: AMBIGUOUS (carries a review deadline)');
  await succeeds(() => child(auth2, 'OPERATOR_RECONCILED', { recon_verdict: 'UNRESOLVED', new_publish_authorized: false, reconciliation: { claimedVerdict: 'NOT_FOUND' } }), 'second attempt: OPERATOR_RECONCILED UNRESOLVED (closed-but-blocked)');
  await succeeds(() => child(auth2, 'OPERATOR_RECONCILED', { recon_verdict: 'NOT_FOUND', new_publish_authorized: true, reconciliation: { evidenceRef: 'seller-hub-screenshot-1' } }), 'a LATER operator reconciliation may be appended (new evidence; the latest governs)');
  const auth3 = await ins({});
  await succeeds(() => child(auth3, 'SUBMITTED'), 'third attempt: SUBMITTED');
  await succeeds(() => child(auth3, 'AMBIGUOUS', { review_due_at: new Date() }), 'third attempt: AMBIGUOUS');
  await succeeds(() => child(auth3, 'OPERATOR_RECONCILED', { recon_verdict: 'LISTING_FOUND', new_publish_authorized: false, external_listing_id: 'ITEM-2', reconciliation: { evidenceRef: 'ebay-item-ITEM-2' } }), 'third attempt: OPERATOR_RECONCILED LISTING_FOUND with the listing id');

  console.log('\n-- negative proofs: the AUTHORIZED snapshot must be complete and self-consistent --');
  await rejects(() => ins({ approved_amount: null }), 'AUTHORIZED without approved_amount is rejected', 'authorized_complete');
  await rejects(() => ins({ approved_amount: '0', approved_amount_cents: 0 }), 'AUTHORIZED with a zero approved amount is rejected', 'authorized_complete');
  await rejects(() => ins({ approved_amount_cents: null }), 'AUTHORIZED without integer cents is rejected', 'authorized_complete');
  await rejects(() => ins({ approved_amount_cents: 26381 }), 'AUTHORIZED whose cents do not equal the decimal amount is rejected', 'authorized_complete');
  await rejects(() => ins({ engine_recommendation: null }), 'AUTHORIZED without the engine recommendation is rejected', 'authorized_complete');
  await rejects(() => ins({ governing_grade: null }), 'AUTHORIZED without the governing-grade reference / uncertainty is rejected', 'authorized_complete');
  await rejects(() => ins({ evidence_class: null }), 'AUTHORIZED without the evidence classification is rejected', 'authorized_complete');
  await rejects(() => ins({ ack_payload: null }), 'AUTHORIZED without the acknowledgment payload is rejected', 'authorized_complete');
  await rejects(() => ins({ ack_warnings: null }), 'AUTHORIZED without the warnings is rejected', 'authorized_complete');
  await rejects(() => ins({ evidence: null }), 'AUTHORIZED without evidence is rejected', 'authorized_complete');
  await rejects(() => ins({ provider_correlation: null }), 'AUTHORIZED without the provider correlation ids is rejected', 'authorized_complete');
  await rejects(() => ins({ approved_at: null }), 'AUTHORIZED without the approval timestamp is rejected', 'authorized_complete');
  await succeeds(() => ins({ verified_sold_count: null }), 'verified_sold_count may be NULL (= unknown) but evidence_class is mandatory');

  console.log('\n-- negative proofs: vocabulary and shape --');
  await rejects(() => ins({ authority_type: 'ENGINE_READY' }), 'authority_type other than OPERATOR_MANUAL is rejected', 'authority_type');
  await rejects(() => ins({ channel: 'etsy' }), 'channel other than ebay is rejected', 'channel');
  await rejects(() => ins({ phase: 'EXECUTED' }), 'an unknown phase is rejected', 'phase');
  await rejects(() => ins({ phase: 'RECONCILED_NOT_LISTED' }), 'the retired RECONCILED_* phases no longer exist', 'phase');
  await rejects(() => ins({ ack_payload: [1, 2] }), 'a JSON array ack_payload is rejected', 'json_objects');
  await rejects(() => ins({ governing_grade: [1] }), 'a JSON array governing_grade is rejected', 'json_objects');
  const authX = await ins({});
  await rejects(() => child(authX, 'LISTED_CONFIRMED', { external_listing_id: '' }), 'LISTED_CONFIRMED with an empty listing id is rejected', 'listing_id');
  await rejects(() => child(authX, 'AMBIGUOUS', { review_due_at: null }), 'AMBIGUOUS without a review deadline is rejected (no unowned permanent pending state)', 'ambiguous_review');

  console.log('\n-- negative proofs: operator reconciliation shape --');
  await rejects(() => child(authX, 'OPERATOR_RECONCILED', { recon_verdict: null, new_publish_authorized: false, reconciliation: {} }), 'a reconciliation without a verdict is rejected', 'reconciled_complete');
  await rejects(() => child(authX, 'OPERATOR_RECONCILED', { recon_verdict: 'NOT_FOUND', new_publish_authorized: null, reconciliation: {} }), 'a reconciliation that does not state whether a new publish is authorized is rejected', 'reconciled_complete');
  await rejects(() => child(authX, 'OPERATOR_RECONCILED', { recon_verdict: 'NOT_FOUND', new_publish_authorized: false, reconciliation: null }), 'a reconciliation without its observations record is rejected', 'reconciled_complete');
  await rejects(() => child(authX, 'OPERATOR_RECONCILED', { recon_verdict: 'LISTING_FOUND', new_publish_authorized: false, reconciliation: {} }), 'LISTING_FOUND without the listing id is rejected', 'reconciled_complete');
  await rejects(() => child(authX, 'OPERATOR_RECONCILED', { recon_verdict: 'LISTING_FOUND', new_publish_authorized: true, external_listing_id: 'X', reconciliation: {} }), 'a new publish can never be authorized when a listing was FOUND', 'reconciled_complete');
  await rejects(() => child(authX, 'OPERATOR_RECONCILED', { recon_verdict: 'UNRESOLVED', new_publish_authorized: true, reconciliation: {} }), 'a new publish can never be authorized by an UNRESOLVED verdict', 'reconciled_complete');
  await rejects(() => child(authX, 'SUBMITTED', { recon_verdict: 'NOT_FOUND' }), 'reconciliation columns on a non-reconciliation row are rejected', 'recon_only');

  console.log('\n-- negative proofs: chain integrity (declarative) --');
  await rejects(() => child(auth, 'SUBMITTED'), 'the same non-reconciliation phase twice for one attempt is rejected', 'attempt_phase_uniq');
  const otherAsset = id(); await client.query('INSERT INTO gk_asset (id) VALUES ($1)', [otherAsset]);
  await rejects(() => child(authX, 'SUBMITTED', { gk_asset_id: otherAsset }), 'a phase row on a DIFFERENT asset than its AUTHORIZED row is rejected', 'chain_fk');
  const otherPrincipal = id(); await client.query('INSERT INTO gk_principal (id) VALUES ($1)', [otherPrincipal]);
  await rejects(() => child(authX, 'SUBMITTED', { principal_id: otherPrincipal }), 'a phase row under a DIFFERENT principal than its AUTHORIZED row is rejected', 'chain_fk');
  const otherAction = id(); await client.query('INSERT INTO operator_action_event (id) VALUES ($1)', [otherAction]);
  await rejects(() => child(authX, 'SUBMITTED', { operator_action_event_id: otherAction }), 'a phase row bound to a DIFFERENT operator action is rejected', 'chain_fk');
  await rejects(() => child(authX, 'SUBMITTED', { authorized_event_id: id() }), 'a phase row pointing at a non-existent AUTHORIZED row is rejected', 'chain_fk');
  await rejects(() => child(authX, 'SUBMITTED', { attempt_id: id() }), 'a phase row under a different attempt id than its AUTHORIZED row is rejected', 'chain_fk');
  await rejects(() => ins({ authorized_event_id: id() }), 'an AUTHORIZED row whose authorized_event_id is not itself is rejected', 'self_ref');

  console.log('\n-- the snapshot survives a change to the referenced rows --');
  {
    // operator_action_event stands in for the live table, which has NO append-only trigger: prove that a change to the
    // referenced row cannot alter what the immutable authority row says was approved.
    await client.query(`ALTER TABLE operator_action_event ADD COLUMN action_value_amount NUMERIC(12,2)`);
    await client.query(`UPDATE operator_action_event SET action_value_amount = 263.80 WHERE id = $1`, [OA]);
    const before = (await client.query(`SELECT approved_amount, approved_amount_cents FROM operator_authority_event WHERE id = $1`, [auth.id])).rows[0];
    await client.query(`UPDATE operator_action_event SET action_value_amount = 1.00 WHERE id = $1`, [OA]);
    const after = (await client.query(`SELECT approved_amount, approved_amount_cents FROM operator_authority_event WHERE id = $1`, [auth.id])).rows[0];
    ok(JSON.stringify(before) === JSON.stringify(after) && Number(after.approved_amount_cents) === 26380, 'changing the referenced operator_action_event price does not change the authority snapshot (still 26380 cents)');
  }

  console.log('\n-- append-only (DB-enforced) --');
  await rejects(() => client.query(`UPDATE operator_authority_event SET approved_amount = 1, approved_amount_cents = 100 WHERE id = $1`, [auth.id]), 'UPDATE is rejected', 'append-only');
  await rejects(() => client.query(`DELETE FROM operator_authority_event WHERE id = $1`, [auth.id]), 'DELETE is rejected', 'append-only');
  await rejects(() => client.query(`TRUNCATE operator_authority_event`), 'TRUNCATE is rejected', 'append-only');

  console.log('\n-- rollback --');
  await succeeds(() => client.query(qualify(read('0040_operator_manual_authority_rollback.sql'))), 'rollback applies');
  const gone = await client.query(`SELECT to_regclass($1) AS t`, [`${SCHEMA}.operator_authority_event`]);
  ok(gone.rows[0].t === null, 'rollback removed the table');
  const fnStill = await client.query(`SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = $1 AND p.proname = 'economic_ledger_immutable'`, [SCHEMA]);
  ok(fnStill.rows.length === 1, 'rollback left 0034\'s economic_ledger_immutable() in place');
} finally {
  try { await client.query('SET search_path TO public'); await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`); } catch (e) { console.log('cleanup note:', e.message); }
  await client.end();
}

console.log(`\n${'='.repeat(60)}\nB1 0040 MIGRATION CONTRACT: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('\nFAILURES:'); failures.forEach((f) => console.log('  ✗ ' + f)); }
process.exit(failed > 0 ? 1 : 0);
