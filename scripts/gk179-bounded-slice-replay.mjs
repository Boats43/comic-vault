// scripts/gk179-bounded-slice-replay.mjs
//
// GK-179 — the canonical, durable, re-executable bounded-slice replay
// recipe for reconstructing data1_dev on an isolated Production/Preview
// Neon branch. This is the THIRD derivation of this recipe (the first
// two runs against Production surfaced real gaps — see below) — this
// file exists so a fourth derivation is never needed by hand again.
// Preview must run this exact file, unmodified, with only its own
// branch config selected.
//
// Usage:
//   node --env-file=.env.development.local scripts/gk179-bounded-slice-replay.mjs production
//   node --env-file=.env.development.local scripts/gk179-bounded-slice-replay.mjs preview
//
// A13 (standing): consumes GK179_PRODUCTION_DATABASE_URL /
// GK179_PREVIEW_DATABASE_URL blind via process.env, populated only via
// --env-file. Never reads, greps, cuts, or sources .env.development.local
// itself, never prints a connection-string value.
//
// ===========================================================================
// PROVENANCE — every extraction, strip, and omission, with exact source
// file:line citations. This section is the whole point of this file: a
// future reader (or Preview) should never need to re-derive any of this.
// ===========================================================================
//
// SKIPPED WHOLESALE (never applied to Development, confirmed live+static):
//   - db/data0/0001_generic_substrate.sql       (abandoned design lineage)
//   - db/data0/0002_comic_projection.sql        (abandoned design lineage)
//   - db/data0/0006_outcome_ledger.sql          (self-declared "DESIGN
//     DRAFT, NOT APPLIED"; zero DDL dependency from 0007-0018, confirmed
//     by grep)
//
// EXTRACTED, NOT APPLIED WHOLESALE:
//   - db/data0/0003_uuidv7_identity_and_mint_ledger.sql
//       KEPT:    lines 237-276 (entity_mint_basis table + its 2 indexes)
//                lines 309-321 (mint_event table + 2 of its 3 indexes:
//                  mint_basis_id, entity_id)
//       STRIPPED: line 239  `entity_id UUID NOT NULL REFERENCES catalog_entity(id),`
//                            -> `entity_id UUID NOT NULL,`
//                            (catalog_entity never exists in this chain)
//                 line 317  `entity_id UUID REFERENCES catalog_entity(id),`
//                            -> `entity_id UUID,`
//                            (same reason)
//                 line 322  `CREATE INDEX ON mint_event (outcome);`
//                            OMITTED ENTIRELY — this is Postgres's own
//                            auto-named `mint_event_outcome_idx`, confirmed
//                            present in committed 0003 text but ABSENT from
//                            live Development (GK-196 finding, independently
//                            reconfirmed by a live Dev-vs-Prod diff on
//                            2026-09-09 — Production's first rebuild had it,
//                            Development does not).
//       EXCLUDED:  lines 285-348 (basis_supersession, entity_resolution_event,
//                  entity_resolution_member) — never applied historically,
//                  zero dependents anywhere in the retained chain.
//
//   - db/data0/0004_data1_foundation.sql
//       STRIPPED: line 142  `catalog_entity_id UUID REFERENCES catalog_entity(id),`
//                            -> `catalog_entity_id UUID,`
//                            (catalog_entity never exists in this chain;
//                            matches GK-176's independently-confirmed live
//                            shape)
//                 lines 39-43   CREATE TABLE gk_organization -- OMITTED
//                 lines 45-53   CREATE TABLE gk_membership + its 2 indexes
//                               -- OMITTED
//                 lines 102-110 CREATE TABLE custody_event + its index
//                               -- OMITTED
//                 lines 166-176 CREATE TABLE condition_observation + its
//                               index -- OMITTED
//                 line 219      `CREATE INDEX ON domain_event ((subject->>'entity_id'));`
//                               OMITTED ENTIRELY — present in committed 0004
//                               text, absent from live Development (same
//                               class of finding as the outcome index above,
//                               same 2026-09-09 live diff).
//       DEPENDENCY CHECK (2026-09-09, GK-179 dispatch): grepped the entire
//       corrected-replay surface (0003 fragment, 0004, 0005, 0007-0018, plus
//       src/modules/assets/{service,repository}.js) for gk_organization,
//       gk_membership, custody_event, condition_observation. Zero executable
//       dependents found anywhere -- every other hit is a descriptive
//       comment or a historical-record JSON snapshot
//       (db/data0/snapshots/data-1-foundation-slice-summary.json's own
//       `tables_deliberately_not_built_this_slice` field independently names
//       these same 4 tables). Removal is pure subtraction; nothing else
//       needs to change to compensate.
//
// APPLIED UNMODIFIED, IN ORDER:
//   0005_data1b_idempotency.sql, 0007_capture_integration_linkage.sql,
//   0008_principal_credential.sql, 0009_media_content_type.sql,
//   0010_idempotency_request_fingerprint.sql, 0011_d3_2_event_time.sql,
//   0012_d3_3_comp_snapshot.sql, 0013_d4_identifier_fabric.sql,
//   0014_d5a_market_observation.sql, 0015_d1_identity_assignment_immutability.sql,
//   0016_d5b_valuation_question_applicability.sql, 0017_d5c_market_population.sql,
//   0018_gk179_environment_identity.sql
//
// EXPECTED RESULT (per branch): 28 data1_dev tables (27 kernel + environment_marker),
// byte-identical to live Development on every table/column/constraint/trigger/
// view/sequence/type, index-identical net of pure auto-vs-explicit naming,
// function-identical EXCEPT the two whitelisted GK-194 proconfig deltas
// (asset_identifier_assertion_guard, asset_identity_assignment_guard --
// Development already has `search_path=pg_catalog, data1_dev` live,
// pre-isolation targets intentionally do not; GK-194/0019 closes this gap
// later, after V1-V5, under its own commit -- NOT this script's job).
// `public` schema must be byte-identical before and after this script runs.
//
// ===========================================================================

import { Client } from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const read = (f) => readFileSync(path.join(repoRoot, 'db', 'data0', f), 'utf8');

const CREEPY_ID = '01a02d23-1acb-72e8-aae3-8f851308e9cf';

const BRANCH_CONFIGS = {
  production: {
    envVar: 'GK179_PRODUCTION_DATABASE_URL',
    appEnv: 'production',
    expected: {
      projectId: 'polished-frog-12911134',
      branchId: 'br-sweet-resonance-afiami9z',
      endpointId: 'ep-divine-sunset-afe153ur',
    },
  },
  preview: {
    envVar: 'GK179_PREVIEW_DATABASE_URL',
    appEnv: 'preview',
    expected: {
      projectId: 'polished-frog-12911134',
      branchId: 'br-quiet-cell-afsatdve',
      endpointId: 'ep-hidden-frost-afsr6ovm',
    },
  },
};

const target = process.argv[2];
if (!target || !BRANCH_CONFIGS[target]) {
  console.log('Usage: node scripts/gk179-bounded-slice-replay.mjs <production|preview>');
  process.exit(2);
}
const cfg = BRANCH_CONFIGS[target];

const connectionString = process.env[cfg.envVar];
if (!connectionString) {
  console.log(`BLOCKED — VARIABLE NOT SET (${cfg.envVar})`);
  process.exit(2);
}

const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();
const { rows: [{ pid: sessionPid }] } = await client.query('SELECT pg_backend_pid() AS pid');
console.log(`=== GK-179 bounded-slice replay: ${target} — backend PID ${sessionPid} ===`);

// ---------------------------------------------------------------------------
// Pre-DROP guard — full 3-identifier match, PRIMARY. Creepy absence, SECONDARY.
// ---------------------------------------------------------------------------
console.log('\n--- Pre-DROP guard ---');
const idRows = await client.query(
  `SELECT name, setting FROM pg_settings WHERE name IN ('neon.branch_id','neon.project_id','neon.endpoint_id')`
);
const ids = {};
for (const r of idRows.rows) ids[r.name] = r.setting;
const projectOk = ids['neon.project_id'] === cfg.expected.projectId;
const branchOk = ids['neon.branch_id'] === cfg.expected.branchId;
const endpointOk = ids['neon.endpoint_id'] === cfg.expected.endpointId;
console.log('  neon.project_id :', ids['neon.project_id'], '-> match:', projectOk);
console.log('  neon.branch_id  :', ids['neon.branch_id'], '-> match:', branchOk);
console.log('  neon.endpoint_id:', ids['neon.endpoint_id'], '-> match:', endpointOk);

if (!projectOk || !branchOk || !endpointOk) {
  console.log('\nGK-179 BLOCKED — DROP TARGET MISIDENTIFIED (identity mismatch). No DROP executed.');
  await client.end();
  process.exit(3);
}

const creepy = await client.query(`SELECT id FROM data1_dev.gk_asset WHERE id = $1`, [CREEPY_ID]);
if (creepy.rowCount !== 0) {
  console.log('\nGK-179 BLOCKED — DROP TARGET MISIDENTIFIED (Creepy asset present). No DROP executed.');
  await client.end();
  process.exit(3);
}
console.log('  Creepy asset absent (secondary): true');
console.log('  GUARD PASSED.');

const prePublic = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`);

// ---------------------------------------------------------------------------
// DROP + rebuild
// ---------------------------------------------------------------------------
console.log('\n--- DROP SCHEMA data1_dev CASCADE ---');
await client.query('DROP SCHEMA data1_dev CASCADE');
await client.query('CREATE SCHEMA data1_dev');
await client.query('SET search_path TO data1_dev');
console.log('  dropped + recreated empty.');

console.log('\n--- Applying bounded-slice chain ---');

// 0003 fragment: entity_mint_basis + mint_event only, catalog_entity FK
// stripped, mint_event_outcome_idx (line 322) omitted entirely.
const fragment0003 = `
CREATE TABLE entity_mint_basis (
  id                    UUID PRIMARY KEY,
  entity_id             UUID NOT NULL,
  basis_namespace       TEXT NOT NULL,
  basis_key             TEXT NOT NULL,
  basis_schema_version  TEXT NOT NULL,
  mint_policy_version   TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX entity_mint_basis_unique ON entity_mint_basis (basis_namespace, basis_key);
CREATE INDEX ON entity_mint_basis (entity_id);

CREATE TABLE mint_event (
  id                     UUID PRIMARY KEY,
  occurred_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  contract_version       TEXT NOT NULL,
  candidate_snapshot     JSONB NOT NULL,
  mint_basis_id          UUID REFERENCES entity_mint_basis(id),
  derivation_key         TEXT,
  outcome                TEXT NOT NULL CHECK (outcome IN ('minted-new', 'resolved-existing', 'queued-review', 'residual-no-mint')),
  entity_id              UUID,
  review_convention_class TEXT
);
CREATE INDEX ON mint_event (mint_basis_id);
CREATE INDEX ON mint_event (entity_id);
-- mint_event_outcome_idx (CREATE INDEX ON mint_event (outcome)) deliberately
-- OMITTED -- see PROVENANCE header, 0003:322.
`;
await client.query(fragment0003);
console.log('  [1/16] 0003 fragment (entity_mint_basis, mint_event; outcome index omitted) — OK');

let sql0004 = read('0004_data1_foundation.sql');

const beforeFkStrip = sql0004;
sql0004 = sql0004.replace(
  /catalog_entity_id(\s+)UUID REFERENCES catalog_entity\(id\)/,
  'catalog_entity_id$1UUID'
);
if (sql0004 === beforeFkStrip) throw new Error('SAFETY ABORT: catalog_entity_id FK-strip regex did not match.');

const blocksToStrip = [
  `CREATE TABLE gk_organization (
  id            UUID PRIMARY KEY,
  display_name  TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

`,
  `CREATE TABLE gk_membership (
  id                UUID PRIMARY KEY,
  organization_id   UUID NOT NULL REFERENCES gk_organization(id),
  principal_id      UUID NOT NULL REFERENCES gk_principal(id),
  role              TEXT NOT NULL,
  joined_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON gk_membership (organization_id);
CREATE INDEX ON gk_membership (principal_id);

`,
  `CREATE TABLE custody_event (
  id                        UUID PRIMARY KEY,
  asset_id                  UUID NOT NULL REFERENCES gk_asset(id),
  custodian_principal_id    UUID NOT NULL REFERENCES gk_principal(id),
  reason                    TEXT NOT NULL,
  occurred_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_by_principal_id  UUID NOT NULL REFERENCES gk_principal(id)
);
CREATE INDEX ON custody_event (asset_id, occurred_at);

`,
  `CREATE TABLE condition_observation (
  id                         UUID PRIMARY KEY,
  asset_id                   UUID NOT NULL REFERENCES gk_asset(id),
  grade_scale                 TEXT NOT NULL CHECK (grade_scale IN ('CGC', 'raw-estimate')),
  grade_value                  NUMERIC(3,1) NOT NULL,
  defect_flags                  JSONB,          -- matches the existing cgcPenaltyFlags shape
  observed_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  media_id                       UUID REFERENCES media(id),  -- nullable
  recorded_by_principal_id       UUID NOT NULL REFERENCES gk_principal(id)
);
CREATE INDEX ON condition_observation (asset_id, observed_at);

`,
];
for (const [i, block] of blocksToStrip.entries()) {
  const before = sql0004;
  sql0004 = sql0004.replace(block, '');
  if (sql0004 === before) {
    throw new Error(`SAFETY ABORT: bounded-slice strip block #${i + 1} did not match verbatim — refusing to guess.`);
  }
}

// Omit the domain_event JSONB expression index (0004:219).
const beforeIdxStrip = sql0004;
sql0004 = sql0004.replace(
  /CREATE INDEX ON domain_event \(\(subject->>'entity_id'\)\);\n?/,
  ''
);
if (sql0004 === beforeIdxStrip) {
  throw new Error('SAFETY ABORT: domain_event expression-index strip did not match verbatim.');
}

for (const name of ['gk_organization', 'gk_membership', 'custody_event', 'condition_observation']) {
  if (sql0004.includes(name)) {
    throw new Error(`SAFETY ABORT: "${name}" still present in the bounded-slice 0004 text after stripping.`);
  }
}
if (/subject->>'entity_id'/.test(sql0004)) {
  throw new Error('SAFETY ABORT: domain_event expression index still present after stripping.');
}
console.log('  bounded-slice strips verified: 4 table blocks + 1 FK clause + 1 expression index, all matched verbatim.');

await client.query(sql0004);
console.log('  [2/16] 0004_data1_foundation.sql (bounded slice + expression-index omission) — OK');

const unmodifiedFiles = [
  '0005_data1b_idempotency.sql',
  '0007_capture_integration_linkage.sql',
  '0008_principal_credential.sql',
  '0009_media_content_type.sql',
  '0010_idempotency_request_fingerprint.sql',
  '0011_d3_2_event_time.sql',
  '0012_d3_3_comp_snapshot.sql',
  '0013_d4_identifier_fabric.sql',
  '0014_d5a_market_observation.sql',
  '0015_d1_identity_assignment_immutability.sql',
  '0016_d5b_valuation_question_applicability.sql',
  '0017_d5c_market_population.sql',
  '0018_gk179_environment_identity.sql',
];
let step = 3;
for (const f of unmodifiedFiles) {
  await client.query(read(f));
  console.log(`  [${step}/16] ${f} (unmodified) — OK`);
  step++;
}

await client.query(`INSERT INTO environment_marker (app_env) VALUES ($1)`, [cfg.appEnv]);
console.log(`\n  inserted app_env = '${cfg.appEnv}'`);

const postPublic = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`);
const publicUnchanged = JSON.stringify(prePublic.rows) === JSON.stringify(postPublic.rows);
console.log('  public schema untouched by this drop/rebuild:', publicUnchanged, `(${prePublic.rowCount} -> ${postPublic.rowCount})`);

const finalTables = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'data1_dev' ORDER BY table_name`);
console.log('  data1_dev table count:', finalTables.rowCount, '(expected 28)');

await client.end();
console.log(`\n=== ${target} bounded-slice replay complete. ===`);
