#!/usr/bin/env node
/**
 * gk270-relink-collection-projection -- GK-270. Repoint ONE collection_item_link routing edge
 * from a named stub collection_item to a named, already-existing rich collection_item for the
 * SAME physical asset. Nothing else changes: no attribute copy, no gkAssetId change, no economic /
 * ownership / inventory / media / learning mutation.
 *
 * PHYSICAL ASSET IDENTITY DOES NOT CHANGE. collection_item_link is a catalogue projection routing
 * edge (db/data0/0011_d3_2_event_time.sql:51).
 *
 * Pinned: exact gkAssetId + exact current stub id + exact target id. No wildcard, no title search,
 * no fuzzy matching, no "all duplicates". DRY RUN by default; --apply is required to commit.
 *
 * Usage:
 *   node scripts/gk270-relink-collection-projection.mjs <development|production> \
 *        --asset <gkAssetId> --from <stubCollectionItemId> --to <richCollectionItemId> [--apply]
 *
 * Exit codes: 0 = applied / already-applied / dry-run-ok;  3 = REFUSED (precondition mismatch);  1 = error.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const argv = process.argv.slice(2);
const target = argv[0];
if (target !== 'development' && target !== 'production') { console.error('first arg must be development|production'); process.exit(2); }
const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const assetId = arg('--asset'), fromId = arg('--from'), toId = arg('--to');
const apply = argv.includes('--apply');
if (!assetId || !fromId || !toId || fromId === toId) { console.error('required: --asset <gkAssetId> --from <stubId> --to <richId> (distinct ids)'); process.exit(2); }
if ([assetId, fromId, toId].some((v) => /[*%\s]/.test(v))) { console.error('wildcards / whitespace are not accepted'); process.exit(2); }

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = {};
for (const line of readFileSync(path.join(repoRoot, target === 'production' ? '.env.production-secrets.local' : '.env.development.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["'](.*)["']$/, '$1');
}
process.env.GRAILKEY_CATALOG_ENVIRONMENT = target;
const { assertAdminDbTarget } = await import(pathToFileURL(path.join(repoRoot, 'scripts', 'db-admin-preflight.mjs')).href);
const client = await assertAdminDbTarget({ connectionString: env.GRAILKEY_CATALOG_DATABASE_URL, label: `GK-270 relink (${target})` });

const canon = (v) => { if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null); if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']'; return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}'; };
const sha = (v) => createHash('sha256').update(canon(v)).digest('hex');
const q = async (s, p = []) => (await client.query(s, p)).rows;

class Refuse extends Error { constructor(code, msg) { super(msg); this.code = code; } }

async function snapshot() {
  const [stub] = await q('SELECT id, principal_id, asset_category, attributes FROM data1_dev.collection_item WHERE id=$1', [fromId]);
  const [rich] = await q('SELECT id, principal_id, asset_category, attributes FROM data1_dev.collection_item WHERE id=$1', [toId]);
  return {
    links: await q('SELECT collection_item_id, gk_asset_id, linked_at, linked_by_principal_id FROM data1_dev.collection_item_link WHERE gk_asset_id=$1 OR collection_item_id = ANY($2) ORDER BY collection_item_id', [assetId, [fromId, toId]]),
    stub: stub ? { id: stub.id, principal: stub.principal_id, category: stub.asset_category, attrKeys: Object.keys(stub.attributes).length, attrHash: sha(stub.attributes) } : null,
    rich: rich ? { id: rich.id, principal: rich.principal_id, category: rich.asset_category, attrKeys: Object.keys(rich.attributes).length, attrHash: sha(rich.attributes) } : null,
    history: {
      valuation_event: (await q('SELECT id FROM data1_dev.valuation_event WHERE asset_id=$1 ORDER BY id', [assetId])).map((r) => r.id),
      decision_event: (await q('SELECT id FROM data1_dev.decision_event WHERE asset_id=$1 ORDER BY id', [assetId])).map((r) => r.id),
      ownership_event: (await q('SELECT id FROM data1_dev.ownership_event WHERE asset_id=$1 ORDER BY id', [assetId])).map((r) => r.id),
      inventory_transitions: (await q('SELECT id FROM data1_dev.inventory_transition_event WHERE gk_asset_id=$1 ORDER BY id', [assetId])).map((r) => r.id),
      inventory_state: (await q('SELECT state FROM data1_dev.inventory_current_state WHERE gk_asset_id=$1', [assetId])).map((r) => r.state),
      media: (await q('SELECT id, object_uri FROM data1_dev.media WHERE asset_id=$1 ORDER BY id', [assetId])).map((r) => r.id),
      operator_action_event: (await q('SELECT id FROM data1_dev.operator_action_event WHERE gk_asset_id=$1 ORDER BY id', [assetId])).map((r) => r.id),
      outcome_event: (await q('SELECT id FROM data1_dev.outcome_event WHERE gk_asset_id=$1 ORDER BY id', [assetId])).map((r) => r.id),
      operator_correction_event: (await q('SELECT id FROM data1_dev.operator_correction_event WHERE gk_asset_id=$1 OR collection_item_id = ANY($2) ORDER BY id', [assetId, [fromId, toId]])).map((r) => r.id),
    },
  };
}

// Every schema column that could reference a collection_item id. If the schema ever grows a new one,
// the tool REFUSES rather than guessing it is irrelevant.
const KNOWN_REFERENCING = new Set([
  'collection_item_link.collection_item_id', 'operator_correction_event.collection_item_id', 'organic_operator_correction_event.collection_item_id',
  'learning_corpus_exclusion.source_collection_item_id',
]);

async function main() {
  const out = { mode: apply ? 'APPLY' : 'DRY-RUN', target, assetId, fromId, toId };
  await client.query('BEGIN');
  try {
    // lock the three rows in a fixed order
    const stub = (await q('SELECT id, principal_id, attributes FROM data1_dev.collection_item WHERE id=$1 FOR UPDATE', [fromId]))[0];
    const rich = (await q('SELECT id, principal_id, attributes FROM data1_dev.collection_item WHERE id=$1 FOR UPDATE', [toId]))[0];
    const linksForAsset = await q('SELECT collection_item_id, linked_by_principal_id FROM data1_dev.collection_item_link WHERE gk_asset_id=$1 FOR UPDATE', [assetId]);
    const linkOfTo = await q('SELECT collection_item_id, gk_asset_id FROM data1_dev.collection_item_link WHERE collection_item_id=$1 FOR UPDATE', [toId]);

    const asset = (await q('SELECT id FROM data1_dev.gk_asset WHERE id=$1', [assetId]))[0];
    if (!asset) throw new Refuse('ASSET_MISSING', 'gkAssetId does not exist');
    if (!stub) throw new Refuse('STUB_MISSING', `current stub ${fromId} does not exist`);
    if (!rich) throw new Refuse('TARGET_MISSING', `target ${toId} does not exist`);
    if (stub.principal_id !== rich.principal_id) throw new Refuse('PRINCIPAL_MISMATCH', 'stub and target belong to different principals');
    const owner = (await q('SELECT owner_principal_id FROM data1_dev.current_owner WHERE asset_id=$1', [assetId]))[0];
    if (!owner || owner.owner_principal_id !== stub.principal_id) throw new Refuse('OWNER_MISMATCH', 'the collection rows\' principal is not the asset\'s current owner');

    // schema-drift guard: no unexpected referencing column
    const cols = await q(`SELECT table_name||'.'||column_name AS c FROM information_schema.columns WHERE table_schema='data1_dev' AND column_name ILIKE '%collection_item%'`);
    const unknown = cols.map((r) => r.c).filter((c) => !KNOWN_REFERENCING.has(c));
    if (unknown.length) throw new Refuse('UNKNOWN_REFERENCING_COLUMN', `schema has unreviewed collection_item reference(s): ${unknown.join(', ')}`);

    // forbidden references
    const refs = {
      corrections: (await q('SELECT count(*)::int n FROM data1_dev.operator_correction_event WHERE collection_item_id = ANY($1)', [[fromId, toId]]))[0].n,
      exclusions: (await q('SELECT count(*)::int n FROM data1_dev.learning_corpus_exclusion WHERE source_collection_item_id = ANY($1)', [[fromId, toId]]))[0].n,
    };
    if (refs.corrections || refs.exclusions) throw new Refuse('FORBIDDEN_REFERENCE', `learning/governance rows reference these ids: ${JSON.stringify(refs)}`);

    const already = linksForAsset.length === 1 && linksForAsset[0].collection_item_id === toId;
    if (already) {
      out.result = 'ALREADY-APPLIED';
      await client.query('ROLLBACK'); // nothing to mutate
      out.snapshot = await snapshot();
      return out;
    }
    if (linksForAsset.length !== 1) throw new Refuse('LINK_COUNT', `expected exactly one link for the asset, found ${linksForAsset.length}`);
    if (linksForAsset[0].collection_item_id !== fromId) throw new Refuse('LINK_NOT_ON_EXPECTED_STUB', `asset is currently linked to ${linksForAsset[0].collection_item_id}, not ${fromId}`);
    if (linkOfTo.length) throw new Refuse('TARGET_ALREADY_LINKED', `target is already linked to ${linkOfTo[0].gk_asset_id}`);

    out.before = await snapshot();
    const stubHashBefore = sha(stub.attributes), richHashBefore = sha(rich.attributes);

    const upd = await client.query(
      'UPDATE data1_dev.collection_item_link SET collection_item_id=$1 WHERE collection_item_id=$2 AND gk_asset_id=$3',
      [toId, fromId, assetId]
    );
    if (upd.rowCount !== 1) throw new Refuse('UPDATE_ROWCOUNT', `link UPDATE affected ${upd.rowCount} rows, expected exactly 1`);

    // in-transaction verification
    const resolved = await q('SELECT collection_item_id FROM data1_dev.collection_item_link WHERE gk_asset_id=$1', [assetId]);
    if (resolved.length !== 1 || resolved[0].collection_item_id !== toId) throw new Refuse('POST_RESOLUTION', 'gkAssetId does not resolve to the target after the UPDATE');
    const after = await snapshot();
    if (JSON.stringify(after.history) !== JSON.stringify(out.before.history)) throw new Refuse('HISTORY_CHANGED', 'asset-level history changed inside the transaction');
    if (after.stub.attrHash !== stubHashBefore || after.rich.attrHash !== richHashBefore) throw new Refuse('ATTRIBUTES_CHANGED', 'a collection row\'s attributes changed inside the transaction');
    out.after = after;

    if (apply) { await client.query('COMMIT'); out.result = 'APPLIED'; }
    else { await client.query('ROLLBACK'); out.result = 'DRY-RUN-OK (rolled back; nothing changed)'; }
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    if (e instanceof Refuse) { out.result = 'REFUSED'; out.refusal = { code: e.code, message: e.message }; return out; }
    throw e;
  }
}

try {
  const r = await main();
  console.log(JSON.stringify(r, null, 2));
  process.exitCode = r.result === 'REFUSED' ? 3 : 0;
} catch (e) {
  console.error('ERROR:', e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
