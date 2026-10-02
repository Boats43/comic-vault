#!/usr/bin/env node
/**
 * register-corpus-exclusion -- GK-278B. THE explicit method for marking learning events
 * produced by certification/test activity so organic corpus projections exclude them.
 * The events themselves are NEVER modified or deleted; this appends rows to the append-only
 * learning_corpus_exclusion registry (0036). Exclusion is by registered event id only.
 *
 * Usage:
 *   node scripts/register-corpus-exclusion.mjs <development|production> \
 *        --ticket GK-278 --reason-code CERTIFICATION_ARTIFACT --reason "<text>" --date YYYY-MM-DD \
 *        (--item <collection_item_id> | --result-id <uuid> | --event <table>:<uuid> ...) [--apply]
 *
 *   --item       registers every operator_correction_event for that collection_item_id AND every
 *                model_prediction_event sharing a result_id with a prediction those corrections reference
 *   --result-id  registers every model_prediction_event with that result_id
 *   --event      registers one named event (repeatable)
 * Without --apply it only LISTS what would be registered (dry run). EVERY certification run that
 * creates learning events must run this immediately afterwards (see docs/LEARNING-SPINE-LAWS.md).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const argv = process.argv.slice(2);
const target = argv[0];
if (target !== 'development' && target !== 'production') { console.error('first arg must be development|production'); process.exit(2); }
const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const all = (name) => argv.flatMap((a, i) => (a === name ? [argv[i + 1]] : []));
const ticket = arg('--ticket'), reasonCode = arg('--reason-code') || 'CERTIFICATION_ARTIFACT', reason = arg('--reason'), date = arg('--date');
const item = arg('--item'), resultId = arg('--result-id'), events = all('--event');
const apply = argv.includes('--apply');
if (!ticket || !reason || !(item || resultId || events.length)) { console.error('required: --ticket, --reason, and one of --item/--result-id/--event'); process.exit(2); }

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = {};
for (const line of readFileSync(path.join(repoRoot, target === 'production' ? '.env.production-secrets.local' : '.env.development.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["'](.*)["']$/, '$1');
}
process.env.GRAILKEY_CATALOG_ENVIRONMENT = target;
const { assertAdminDbTarget } = await import(pathToFileURL(path.join(repoRoot, 'scripts', 'db-admin-preflight.mjs')).href);
const client = await assertAdminDbTarget({ connectionString: env.GRAILKEY_CATALOG_DATABASE_URL, label: `register corpus exclusion in ${target}` });

try {
  const rows = new Map(); // key table:id
  const add = (table, id, src) => rows.set(`${table}:${id}`, { table, id, src });
  if (item) {
    const corr = (await client.query('SELECT id, principal_id, related_prediction_event_id FROM data1_dev.operator_correction_event WHERE collection_item_id = $1', [item])).rows;
    for (const c of corr) {
      add('operator_correction_event', c.id, item);
      if (c.related_prediction_event_id) {
        const rid = (await client.query('SELECT result_id FROM data1_dev.model_prediction_event WHERE id = $1', [c.related_prediction_event_id])).rows[0]?.result_id;
        if (rid) for (const p of (await client.query('SELECT id FROM data1_dev.model_prediction_event WHERE principal_id = $1 AND result_id = $2', [c.principal_id, rid])).rows) add('model_prediction_event', p.id, item);
      }
    }
  }
  if (resultId) for (const p of (await client.query('SELECT id FROM data1_dev.model_prediction_event WHERE result_id = $1', [resultId])).rows) add('model_prediction_event', p.id, item || null);
  for (const e of events) {
    const [table, id] = e.split(':');
    if (!['model_prediction_event', 'operator_correction_event'].includes(table)) throw new Error(`bad table in --event ${e}`);
    const exists = (await client.query(`SELECT 1 FROM data1_dev.${table} WHERE id = $1`, [id])).rowCount;
    if (!exists) throw new Error(`event ${e} does not exist in ${target}`);
    add(table, id, item || null);
  }
  // The date is NEVER hand-typed by default: it comes from the database as an explicit UTC calendar
  // date string (a JS Date here would be shifted by the local timezone -- see GK-278C).
  const dbUtcDate = (await client.query(`SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d`)).rows[0].d;
  const effectiveDate = date || dbUtcDate;
  console.log(`${apply ? 'REGISTERING' : 'DRY RUN (add --apply)'} ${rows.size} event(s) in ${target} (certification_date ${effectiveDate} UTC):`);
  for (const r of rows.values()) console.log(`  ${r.table}  ${r.id}`);
  if (apply) {
    let n = 0;
    for (const r of rows.values()) {
      const res = await client.query(
        `INSERT INTO data1_dev.learning_corpus_exclusion (event_table, event_id, reason_code, reason, ticket, certification_date, source_collection_item_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (event_table, event_id) DO NOTHING`,
        [r.table, r.id, reasonCode, reason, ticket, effectiveDate, r.src]
      );
      n += res.rowCount;
    }
    console.log(`registered ${n} new exclusion row(s) (existing registrations are left as they are)`);
  }
} finally {
  await client.end();
}
