#!/usr/bin/env node
// READ-ONLY Production inspection of the Old Man Logan #25 Gate B row (2026-10-20). `BEGIN READ ONLY ... ROLLBACK` via assertAdminDbTarget; prints no secret and no photo bytes.
// Reads the Production URL from the gitignored .env.production-secrets.local in the main checkout, blind (same method as scripts/title-integrity-production-census in 09aba86).
// Usage: node scripts/oml-gate-b-production-readonly.mjs schema | row | facets | graph
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const root = process.env.COMIC_VAULT_MAIN_REPO || 'C:/Users/matam/OneDrive/Desktop/comic-vault';
for (const v of ['GRAILKEY_CATALOG_DATABASE_URL', 'GRAILKEY_CATALOG_DATABASE_URL_UNPOOLED', 'GRAILKEY_CATALOG_ENVIRONMENT']) {
  const m = readFileSync(`${root}/.env.production-secrets.local`, 'utf8').match(new RegExp(`^${v}=(.+)$`, 'm'));
  if (m) process.env[v] = m[1].trim().replace(/^["']|["']$/g, '');
}
if (process.env.GRAILKEY_CATALOG_ENVIRONMENT !== 'production') { console.log('ABORT: environment marker is not production'); process.exit(1); }
const { assertAdminDbTarget } = await import(pathToFileURL(`${root}/scripts/db-admin-preflight.mjs`));
const client = await assertAdminDbTarget({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL_UNPOOLED || process.env.GRAILKEY_CATALOG_DATABASE_URL, label: 'READ-ONLY OML gate-b' });
const ASSET = '01a0bb24-c806-7a63-aa86-ce26fe8eed83', ROW = 'cv_1790809927798_txjz5n';
const mode = process.argv[2];
try {
  await client.query('BEGIN READ ONLY');
  await client.query('SET LOCAL search_path TO data1_dev');
  const ro = (await client.query('SHOW transaction_read_only')).rows[0].transaction_read_only;
  console.log('transaction_read_only =', ro);
  if (ro !== 'on') throw new Error('not read-only');
  if (mode === 'schema') {
    const t = await client.query(`SELECT table_name, string_agg(column_name, ',' ORDER BY ordinal_position) cols FROM information_schema.columns WHERE table_schema='data1_dev' AND table_name = ANY($1) GROUP BY 1 ORDER BY 1`,
      [['collection_item', 'collection_item_link', 'gk_asset', 'media', 'inventory_current_state', 'inventory_event', 'valuation_event', 'decision_event', 'operator_action_event', 'outcome_event', 'mint_event', 'entity_mint_basis', 'domain_event', 'physical_copy_decision_event', 'ownership_event', 'current_owner', 'marketplace_connection']]);
    for (const r of t.rows) console.log(r.table_name, '::', r.cols);
    const all = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='data1_dev' ORDER BY 1`);
    console.log('ALL TABLES:', all.rows.map((r) => r.table_name).join(','));
  } else if (mode === 'row') {
    const r = await client.query('SELECT * FROM collection_item WHERE id = $1', [ROW]);
    console.log('collection_item rows:', r.rows.length);
    const row = r.rows[0] || {};
    const { attributes, ...cols } = row;
    console.log('COLUMNS', JSON.stringify(cols));
    const a = attributes || {};
    const size = (v) => (v == null ? 'null' : typeof v === 'string' ? `str(${v.length})` : Array.isArray(v) ? `arr(${v.length})` : typeof v === 'object' ? `obj(${Object.keys(v).length})` : String(v));
    console.log('ATTRIBUTE KEYS', Object.keys(a).sort().map((k) => `${k}:${size(a[k])}`).join(' '));
  } else if (mode === 'facets') {
    const a = ((await client.query('SELECT attributes FROM collection_item WHERE id = $1', [ROW])).rows[0] || {}).attributes || {};
    const keys = (process.argv[3] || '').split(',').filter(Boolean);
    const cut = (v, n) => { const t = JSON.stringify(v); return t == null ? 'undefined' : t.length > n ? t.slice(0, n) + '…(' + t.length + ')' : t; };
    if (!keys.length) console.log('ALL KEYS', Object.keys(a).sort().join(' '));
    for (const k of keys) console.log(k, '=', cut(a[k], Number(process.argv[4]) || 900));
  } else if (mode === 'corrections') {
    const q = async (label, sql, params) => { await client.query('SAVEPOINT q'); try { const r = await client.query(sql, params); console.log('--', label, '(' + r.rows.length + ')'); for (const x of r.rows) console.log(JSON.stringify(x).slice(0, 900)); await client.query('RELEASE SAVEPOINT q'); } catch (e) { await client.query('ROLLBACK TO SAVEPOINT q'); console.log('--', label, 'QUERY FAILED:', e.message); } };
    await q('tables like correction/authority/receipt', "SELECT table_name FROM information_schema.tables WHERE table_schema='data1_dev' AND (table_name LIKE '%correction%' OR table_name LIKE '%receipt%' OR table_name LIKE '%grade_%' OR table_name LIKE '%prediction%')");
    await q('operator_correction_event columns', "SELECT string_agg(column_name, ',' ORDER BY ordinal_position) AS cols FROM information_schema.columns WHERE table_schema='data1_dev' AND table_name='operator_correction_event'");
    await q('operator_correction_event for OML row/asset', 'SELECT * FROM operator_correction_event WHERE collection_item_id = $1 OR gk_asset_id = $2 ORDER BY 1', [ROW, ASSET]);
  } else if (mode === 'evidence') {
    const { computeEvidenceVersion } = await import('../src/lib/authorityReceipt.js');
    const hs = (await client.query('SELECT content_hash FROM media WHERE asset_id = $1', [ASSET])).rows.map((r) => r.content_hash);
    console.log('media rows:', hs.length, 'distinct hashes:', new Set(hs).size, 'evidenceVersion (receipt binding input):', computeEvidenceVersion(hs));
    const t = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='data1_dev' AND (table_name LIKE '%attempt%' OR table_name LIKE '%manual%' OR table_name LIKE '%operator%')");
    console.log('0040-family tables present in Production:', t.rows.map((r) => r.table_name).join(',') || '(none)');
  } else if (mode === 'graph') {
    const q = async (label, sql, params) => {   // each query runs under a savepoint so one failing statement cannot abort the read-only transaction
      await client.query('SAVEPOINT q');
      try { const r = await client.query(sql, params); console.log('--', label, '(' + r.rows.length + ')'); for (const x of r.rows) console.log(JSON.stringify(x).slice(0, 900)); await client.query('RELEASE SAVEPOINT q'); }
      catch (e) { await client.query('ROLLBACK TO SAVEPOINT q'); console.log('--', label, 'QUERY FAILED:', e.message); }
    };
    await q('collection_item_link', 'SELECT * FROM collection_item_link WHERE gk_asset_id = $1 OR collection_item_id = $2', [ASSET, ROW]);
    await q('gk_asset', 'SELECT * FROM gk_asset WHERE id = $1', [ASSET]);
    await q('current_owner', 'SELECT * FROM current_owner WHERE asset_id = $1', [ASSET]);
    await q('inventory_current_state', 'SELECT * FROM inventory_current_state WHERE gk_asset_id = $1', [ASSET]);
    await q('inventory_transition_event', 'SELECT * FROM inventory_transition_event WHERE gk_asset_id = $1', [ASSET]).catch((e) => console.log('inventory_transition_event query failed:', e.message));
    await q('media', 'SELECT id, media_type, capture_view, content_type, left(content_hash, 12) AS hash12, recorded_at, occurred_at FROM media WHERE asset_id = $1 ORDER BY recorded_at', [ASSET]);
    await q('valuation_event', 'SELECT id, value_amount, value_currency, method, grade_assumption, build_sha, recorded_at, left(provenance::text, 300) AS prov FROM valuation_event WHERE asset_id = $1 ORDER BY recorded_at', [ASSET]);
    await q('decision_event', 'SELECT id, recommendation, reason_codes, valuation_event_id, recorded_at FROM decision_event WHERE asset_id = $1 ORDER BY recorded_at', [ASSET]);
    await q('operator_action_event', 'SELECT * FROM operator_action_event WHERE gk_asset_id = $1 ORDER BY recorded_at', [ASSET]);
    await q('outcome_event', 'SELECT id, outcome_type, channel, external_listing_id, ask_amount, occurred_at FROM outcome_event WHERE gk_asset_id = $1 ORDER BY recorded_at', [ASSET]);
    await q('domain_event (subject mentions asset or row)', "SELECT event_type, recorded_at, actor, left(payload::text, 260) AS payload FROM domain_event WHERE subject::text LIKE $1 OR payload::text LIKE $1 OR payload::text LIKE $2 ORDER BY recorded_at", ['%' + ASSET + '%', '%' + ROW + '%']);
    await q('physical_copy_decision_event', 'SELECT id, choice, incoming_collection_item_id, selected_gk_asset_id, canonical_collection_item_id, incoming_retired, decided_at FROM physical_copy_decision_event WHERE $1 = ANY(candidate_gk_asset_ids::text[]) OR selected_gk_asset_id::text = $1 OR canonical_collection_item_id = $2 OR incoming_collection_item_id = $2', [ASSET, ROW]).catch((e) => console.log('pcd query failed:', e.message));
    await q('marketplace_connection (no credential columns)', 'SELECT id, provider, connection_status, granted_scopes, connected_at, updated_at, last_error FROM marketplace_connection WHERE principal_id = (SELECT principal_id FROM collection_item WHERE id = $1)', [ROW]);
  }
} finally { try { await client.query('ROLLBACK'); } catch { /* none */ } await client.end(); }
