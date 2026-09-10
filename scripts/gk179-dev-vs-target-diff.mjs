// scripts/gk179-dev-vs-target-diff.mjs
//
// GK-179 — full object-level structural comparison of live Development
// against an isolated target (Production or Preview). Compares tables,
// columns, constraints, indexes (definition-normalized, names reported
// separately), triggers, functions, views, sequences, types, and the
// environment_marker row value. Applies the closed, exhaustive GK-194
// proconfig whitelist (asset_identifier_assertion_guard,
// asset_identity_assignment_guard) — no other function delta is permitted.
//
// Usage:
//   node --env-file=.env.development.local scripts/gk179-dev-vs-target-diff.mjs production
//   node --env-file=.env.development.local scripts/gk179-dev-vs-target-diff.mjs preview

import { Client } from 'pg';

const TARGET_ENV_VARS = {
  production: 'GK179_PRODUCTION_DATABASE_URL',
  preview: 'GK179_PREVIEW_DATABASE_URL',
};

const target = process.argv[2];
if (!target || !TARGET_ENV_VARS[target]) {
  console.log('Usage: node scripts/gk179-dev-vs-target-diff.mjs <production|preview>');
  process.exit(2);
}

const devConnStr = process.env.GRAILKEY_CATALOG_DATABASE_URL_UNPOOLED;
const targetConnStr = process.env[TARGET_ENV_VARS[target]];
if (!devConnStr) { console.log('BLOCKED — VARIABLE NOT SET (GRAILKEY_CATALOG_DATABASE_URL_UNPOOLED)'); process.exit(2); }
if (!targetConnStr) { console.log(`BLOCKED — VARIABLE NOT SET (${TARGET_ENV_VARS[target]})`); process.exit(2); }

// The closed, exhaustive GK-194 whitelist. No other function delta passes.
const GK194_WHITELIST = new Set(['asset_identifier_assertion_guard()', 'asset_identity_assignment_guard()']);

async function snapshot(connectionString) {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const tables = (await client.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'data1_dev' ORDER BY table_name`
  )).rows.map(r => r.table_name);

  const columns = (await client.query(`
    SELECT table_name, column_name, ordinal_position, data_type, udt_name,
           is_nullable, column_default, character_maximum_length,
           numeric_precision, numeric_scale
    FROM information_schema.columns WHERE table_schema = 'data1_dev'
    ORDER BY table_name, ordinal_position
  `)).rows;

  const constraints = (await client.query(`
    SELECT rel.relname AS table_name, con.conname AS constraint_name,
           pg_get_constraintdef(con.oid) AS definition
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'data1_dev'
    ORDER BY rel.relname, con.conname
  `)).rows;

  const indexes = (await client.query(`
    SELECT tablename AS table_name, indexname, indexdef
    FROM pg_indexes WHERE schemaname = 'data1_dev'
    ORDER BY tablename, indexname
  `)).rows;

  const triggers = (await client.query(`
    SELECT c.relname AS table_name, t.tgname AS trigger_name, t.tgenabled AS enabled_state,
           p.proname AS bound_function, pg_get_triggerdef(t.oid) AS definition
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE ns.nspname = 'data1_dev' AND NOT t.tgisinternal
    ORDER BY c.relname, t.tgname
  `)).rows;

  const functions = (await client.query(`
    SELECT p.proname AS name, pg_get_function_identity_arguments(p.oid) AS args,
           l.lanname AS language, p.provolatile, p.prosecdef, p.proconfig, p.prosrc
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
    WHERE ns.nspname = 'data1_dev'
    ORDER BY p.proname
  `)).rows;

  const views = (await client.query(
    `SELECT table_name FROM information_schema.views WHERE table_schema = 'data1_dev' ORDER BY table_name`
  )).rows.map(r => r.table_name);
  const sequences = (await client.query(
    `SELECT sequencename FROM pg_sequences WHERE schemaname = 'data1_dev' ORDER BY sequencename`
  )).rows.map(r => r.sequencename);
  const types = (await client.query(`
    SELECT t.typname AS name FROM pg_type t JOIN pg_namespace ns ON ns.oid = t.typnamespace
    WHERE ns.nspname = 'data1_dev' AND t.typtype IN ('e','c','d') ORDER BY t.typname
  `)).rows.map(r => r.name);

  const markerRow = tables.includes('environment_marker')
    ? (await client.query('SELECT app_env FROM data1_dev.environment_marker')).rows
    : [];

  await client.end();
  return { tables, columns, constraints, indexes, triggers, functions, views, sequences, types, markerRow };
}

const dev = await snapshot(devConnStr);
const tgt = await snapshot(targetConnStr);

let anyFail = false;
const fail = (msg) => { anyFail = true; console.log('  ✗ ' + msg); };
const pass = (msg) => console.log('  ✓ ' + msg);

console.log(`\n=== 1. Table set — Development vs ${target}, bidirectional diff ===`);
const devSet = new Set(dev.tables), tgtSet = new Set(tgt.tables);
const devMinusTgt = dev.tables.filter(t => !tgtSet.has(t));
const tgtMinusDev = tgt.tables.filter(t => !devSet.has(t));
console.log(`  Development: ${dev.tables.length} | ${target}: ${tgt.tables.length}`);
if (devMinusTgt.length === 0) pass('Development minus target = empty'); else fail('Development minus target: ' + devMinusTgt.join(', '));
if (tgtMinusDev.length === 0) pass('target minus Development = empty'); else fail('target minus Development: ' + tgtMinusDev.join(', '));
for (const t of ['gk_organization', 'gk_membership', 'custody_event', 'condition_observation']) {
  if (tgt.tables.includes(t)) fail(`REJECTED TABLE PRESENT: ${t}`); else pass(`rejected table absent: ${t}`);
}
const sharedTables = dev.tables.filter(t => tgtSet.has(t));

console.log('\n=== 2. Columns (shared tables) ===');
const colKey = (r) => `${r.table_name}.${r.column_name}`;
const devCols = new Map(dev.columns.map(c => [colKey(c), c]));
const tgtCols = new Map(tgt.columns.map(c => [colKey(c), c]));
let colDiffs = 0;
for (const [key, dcol] of devCols) {
  if (!sharedTables.includes(dcol.table_name)) continue;
  const tcol = tgtCols.get(key);
  if (!tcol) { fail(`column missing in ${target}: ${key}`); colDiffs++; continue; }
  for (const f of ['ordinal_position','data_type','udt_name','is_nullable','column_default','character_maximum_length','numeric_precision','numeric_scale']) {
    if (String(dcol[f]) !== String(tcol[f])) { fail(`column ${key}.${f}: Dev=${dcol[f]} vs ${target}=${tcol[f]}`); colDiffs++; }
  }
}
for (const [key, tcol] of tgtCols) { if (sharedTables.includes(tcol.table_name) && !devCols.has(key)) { fail(`column extra in ${target}: ${key}`); colDiffs++; } }
if (colDiffs === 0) pass('0 column differences on any shared table');

console.log('\n=== 3. Constraints (shared tables, by definition) ===');
const normDef = (s) => s.replace(/\s+/g, ' ').trim();
const groupBy = (list) => { const m = new Map(); for (const c of list) { const k = `${c.table_name}::${normDef(c.definition)}`; (m.get(k) || m.set(k, []).get(k)).push(c); } return m; };
const devConDefs = groupBy(dev.constraints.filter(c => sharedTables.includes(c.table_name)));
const tgtConDefs = groupBy(tgt.constraints.filter(c => sharedTables.includes(c.table_name)));
let conDiffs = 0, conNameDiffs = 0;
for (const [k, list] of devConDefs) {
  const other = tgtConDefs.get(k);
  if (!other) { fail(`constraint missing in ${target}: ${k}`); conDiffs++; continue; }
  const a = list.map(c=>c.constraint_name).sort().join(','), b = other.map(c=>c.constraint_name).sort().join(',');
  if (a !== b) { console.log(`  (name-only) ${k} — Dev [${a}] vs ${target} [${b}]`); conNameDiffs++; }
}
for (const k of tgtConDefs.keys()) if (!devConDefs.has(k)) { fail(`constraint extra in ${target}: ${k}`); conDiffs++; }
if (conDiffs === 0) pass('0 structural constraint differences on any shared table');
if (conNameDiffs) console.log(`  (${conNameDiffs} naming-only constraint deltas, not counted as failures)`);

console.log('\n=== 4. Indexes (shared tables, definition-normalized) ===');
const normIdx = (i) => normDef(i.indexdef).replace(new RegExp(`INDEX\\s+${i.indexname}\\s+ON`), 'INDEX <name> ON');
const groupIdx = (list) => { const m = new Map(); for (const i of list) { const k = `${i.table_name}::${normIdx(i)}`; (m.get(k) || m.set(k, []).get(k)).push(i); } return m; };
const devIdxDefs = groupIdx(dev.indexes.filter(i => sharedTables.includes(i.table_name)));
const tgtIdxDefs = groupIdx(tgt.indexes.filter(i => sharedTables.includes(i.table_name)));
let idxDiffs = 0, idxNameDiffs = 0;
for (const [k, list] of devIdxDefs) {
  const other = tgtIdxDefs.get(k);
  if (!other) { fail(`index missing in ${target}: ${k}`); idxDiffs++; continue; }
  const a = list.map(i=>i.indexname).sort().join(','), b = other.map(i=>i.indexname).sort().join(',');
  if (a !== b) { console.log(`  (name-only) ${k} — Dev [${a}] vs ${target} [${b}]`); idxNameDiffs++; }
}
for (const k of tgtIdxDefs.keys()) if (!devIdxDefs.has(k)) { fail(`index extra in ${target}: ${k}`); idxDiffs++; }
if (idxDiffs === 0) pass('0 structural index differences on any shared table (net of naming)');
if (idxNameDiffs) console.log(`  (${idxNameDiffs} naming-only index deltas, not counted as failures)`);
for (const rejected of ["mint_event::CREATE INDEX <name> ON data1_dev.mint_event USING btree (outcome)", "domain_event::CREATE INDEX <name> ON data1_dev.domain_event USING btree (((subject ->> 'entity_id'::text)))"]) {
  if (tgtIdxDefs.has(rejected)) fail(`REJECTED INDEX STILL PRESENT in ${target}: ${rejected}`);
  else pass(`rejected index confirmed absent from ${target}: ${rejected.split('::')[0]}`);
}

console.log('\n=== 5. Triggers ===');
const trigKey = (t) => `${t.table_name}::${t.trigger_name}::${t.enabled_state}::${t.bound_function}::${normDef(t.definition)}`;
const devTrigSet = new Set(dev.triggers.map(trigKey)), tgtTrigSet = new Set(tgt.triggers.map(trigKey));
let trigDiffs = 0;
for (const t of dev.triggers) if (!tgtTrigSet.has(trigKey(t))) { fail(`trigger missing/altered in ${target}: ${trigKey(t)}`); trigDiffs++; }
for (const t of tgt.triggers) if (!devTrigSet.has(trigKey(t))) { fail(`trigger extra/altered in ${target}: ${trigKey(t)}`); trigDiffs++; }
console.log(`  Development: ${dev.triggers.length} | ${target}: ${tgt.triggers.length}`);
if (trigDiffs === 0) pass('triggers identical');

console.log('\n=== 6. Functions (GK-194 whitelist applied: proconfig only, 2 named functions) ===');
const fnKey = (f) => `${f.name}(${f.args})`;
const devFns = new Map(dev.functions.map(f => [fnKey(f), f])), tgtFns = new Map(tgt.functions.map(f => [fnKey(f), f]));
let fnDiffs = 0, whitelistedHits = 0;
for (const [k, df] of devFns) {
  const tf = tgtFns.get(k);
  if (!tf) { fail(`function missing in ${target}: ${k}`); fnDiffs++; continue; }
  for (const field of ['language','provolatile','prosecdef','prosrc']) {
    if (String(df[field]) !== String(tf[field])) { fail(`function ${k}.${field} differs (NOT whitelisted)`); fnDiffs++; }
  }
  const proconfigDiffers = JSON.stringify(df.proconfig) !== JSON.stringify(tf.proconfig);
  if (proconfigDiffers) {
    if (GK194_WHITELIST.has(k)) {
      const devVal = JSON.stringify(df.proconfig), tgtVal = JSON.stringify(tf.proconfig);
      const shapeOk = devVal === '["search_path=pg_catalog, data1_dev"]' && tgtVal === 'null';
      if (shapeOk) { console.log(`  (GK-194 whitelisted) ${k}.proconfig — Dev=${devVal} vs ${target}=${tgtVal}`); whitelistedHits++; }
      else { fail(`function ${k}.proconfig differs but NOT in the exact whitelisted shape: Dev=${devVal} vs ${target}=${tgtVal}`); fnDiffs++; }
    } else {
      fail(`function ${k}.proconfig differs (NOT on the GK-194 whitelist): Dev=${JSON.stringify(df.proconfig)} vs ${target}=${JSON.stringify(tf.proconfig)}`);
      fnDiffs++;
    }
  }
}
for (const k of tgtFns.keys()) if (!devFns.has(k)) { fail(`function extra in ${target}: ${k}`); fnDiffs++; }
console.log(`  Development: ${dev.functions.length} | ${target}: ${tgt.functions.length} | whitelisted proconfig hits: ${whitelistedHits}/${GK194_WHITELIST.size}`);
if (fnDiffs === 0) pass('0 unwhitelisted function differences');
if (whitelistedHits !== GK194_WHITELIST.size) fail(`expected exactly ${GK194_WHITELIST.size} GK-194 whitelist hits, got ${whitelistedHits}`);

console.log('\n=== 7. Views / Sequences / Types ===');
const eq = (a,b) => JSON.stringify(a) === JSON.stringify(b);
if (eq(dev.views, tgt.views)) pass(`views identical (${dev.views.length})`); else fail(`views differ: Dev=${JSON.stringify(dev.views)} vs ${target}=${JSON.stringify(tgt.views)}`);
if (eq(dev.sequences, tgt.sequences)) pass(`sequences identical (${dev.sequences.length})`); else fail(`sequences differ`);
if (eq(dev.types, tgt.types)) pass(`types identical (${dev.types.length})`); else fail(`types differ`);

console.log('\n=== 8. environment_marker row value (allowed difference) ===');
const devVal = dev.markerRow[0]?.app_env, tgtVal = tgt.markerRow[0]?.app_env;
console.log(`  Development=${devVal} | ${target}=${tgtVal}`);
if (devVal === 'development' && tgtVal === target) pass('row-value difference is exactly the expected/allowed one');
else fail(`unexpected marker row values: Development=${devVal}, ${target}=${tgtVal}`);

console.log('\n=== FINAL ===');
console.log(anyFail
  ? `RESULT: STRUCTURAL DIFFERENCES FOUND beyond the GK-194 whitelist (see ✗ lines above)`
  : `RESULT: PARITY PROVEN — zero differences except the exact whitelisted GK-194 proconfig deltas and the expected marker row value`);
