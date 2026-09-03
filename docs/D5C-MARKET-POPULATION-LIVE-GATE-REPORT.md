# D5C Live-Migration Gate

**Design/scratch commit:** `7750005`. **This dispatch:** N1 → N2 → N3 → live compatibility census → recovery anchor → live apply → MP-PA1–MP-PA18.

## N1 — GK-192 declarative closure: TESTED AND ADOPTED

**N1 PASS — DECLARATIVE CLOSURE ADOPTED.**

**N1-A:** neither `market_population` nor `applicability` exposed the needed candidate key before this pass — both columns already existed (`market_population.valuation_question_id`, `applicability.question_id`), just not as a `UNIQUE` pair.

**N1-B/N1-C:** `market_population_member` now carries its own `valuation_question_id` column. It is not independently meaningful or writable in practice: once `market_population_id` and `applicability_id` are set, two composite FKs constrain the SAME column simultaneously —

```
FK1  (market_population_id, valuation_question_id) -> market_population (id, valuation_question_id)
FK2  (applicability_id, observation_id, valuation_question_id) -> applicability (id, observation_id, question_id)
```

— a pure integrity discriminator, exactly N1-C's PASS condition. `applicability`'s prior 2-column `UNIQUE(id, observation_id)` was replaced with a single 3-column `UNIQUE(id, observation_id, question_id)`, closing both the observation-level (MP-NP3) and question-level (N1) requirements with one constraint and one FK instead of two.

**N1-D — negative proof, real (`tests/d5c-market-population-migration-contract.test.js`, MP-NP3b/N1, 2/2):**
1. A population belonging to Q1 citing a judgment that actually belongs to Q2 (same observation, wrong question) — **REJECTED** by FK2.
2. A member row that also lies about its own `valuation_question_id` (claims Q2 while its `market_population_id` still points at the Q1 population) — **REJECTED** by FK1.

Both proven independently, isolating each FK direction. Legitimate same-question membership continues to succeed (all prior MP-NP1–MP-NP12 proofs, 36/36 total after the redesign). No trigger. No lock/retry machinery. No mutable synchronization.

**GK-192 CLOSED** (`docs/TICKET-REGISTRY.md`) — the schema itself now proves what was previously delegated to a future D5D writer's own discipline.

## N2 — GK-191 recorder defect: FIXED, VERIFIED

**N2-A PASS — GK-191 FIXED, RECORDER VERIFIED.** Root cause confirmed: `clock_timestamp() AT TIME ZONE 'UTC'` converts a `timestamptz` to a `timestamp without time zone`, which `node-postgres` parses using local session time before `.toISOString()` re-applies a UTC conversion, producing the ~7-hour Phoenix offset. Fix: drop `AT TIME ZONE 'UTC'` entirely — `SELECT clock_timestamp() AS recovery_anchor` returns a genuine `timestamptz`, which the driver serializes correctly. Verified directly, harmless read-only query, this dispatch:

```
client UTC before: 2026-09-03T05:07:14.290Z
DB recovery_anchor (no AT TIME ZONE): 2026-09-03T05:07:25.889Z
client UTC after:  2026-09-03T05:07:14.373Z
delta: ~11.6s (real script startup/connect latency, NOT a ~7-hour timezone bug)
```

`live-apply-0017.mjs` uses the corrected form throughout — no fallback quarantine needed.

## N3 — fourth restore-window volume finding, full contract

```
PostgreSQL environment:      Neon (real isolated scratch schema, same instance data1_dev lives in)
Measurement method:          pg_current_wal_lsn() / pg_wal_lsn_diff()
Sample sizes:                N=20 per sample, 3 samples per object type, after 20-row priming
Objects measured separately: market_population (header) -- yes
                              market_population_member -- yes
Observed WAL range:          header ~757-1168 B/row (MEASURED, 3 independent runs across this
                                dispatch chain); member ~768-830 B/row (MEASURED, but an UPPER
                                BOUND -- each sample's window includes its own freshly-created
                                market_observation+applicability FK-target rows, disclosed, not
                                an isolated marginal cost)
Membership cardinality:      HYPOTHESIS -- no real production corpus exists to measure against
                                (GK-180 confirms zero production writes anywhere in this
                                substrate); illustrative-only projection at 1/2/5 reevaluations
                                per question, ~50 members/population (docs/D5C-MARKET-
                                POPULATION-DESIGN-REPORT.md, Deliverable H)
Reevaluation behavior:       MEASURED for the analogous Applicability case (A3: 300 new rows,
                                0 deduped under a rule-version bump) -- NOT separately
                                re-measured for MarketPopulation this pass, PROJECTED by
                                analogy (same dedup-via-content-hash mechanism, MP-NP4/MP-NP6/
                                MP-NP7 proven live)
```

Classification: header WAL range = **MEASURED**. Member WAL range = **MEASURED (upper bound)**. Membership cardinality/per-scan multipliers = **HYPOTHESIS**. Reevaluation row-multiplication behavior = **PROJECTED** (mechanism proven live, magnitude not independently re-measured for this table).

Banked into `docs/MASTER-BOARD.md`'s restore-window gate (already present from the design pass; this section is the full contract behind that summary, per N3's explicit format requirement — not merely "MarketPopulation measured").

## Pre-apply live compatibility census (real, read-only, `data1_dev`)

```
gk_asset:            131
market_observation:  23
valuation_question:  0
applicability:       0
comp_snapshot:       4
valuation_event:     78
market_population:            absent
market_population_member:     absent
public.market_population:         absent
public.market_population_member:  absent
```

**No D5C objects currently exist.** Confirmed directly, not assumed.

## Migration artifact traceability

```
design commit:     7750005
this commit:       (see git log — committed immediately before live apply, exact SHA below)
0017 forward:      db/data0/0017_d5c_market_population.sql
0017 rollback:     db/data0/0017_d5c_market_population_rollback.sql
apply script:      live-apply-0017.mjs
```

Exact SHA-256 hashes recorded in the commit that binds this artifact (see repo history immediately preceding the live-apply attempt) — no uncommitted executable modifies `data1_dev`.

## Migration/rollback isolation

`0017` is independently reversible from D1/D5A/D5B/`comp_snapshot`/`valuation_event` — proven live in the design pass (`tests/d5c-market-population-migration-contract.test.js`: forward → verify → rollback → verify baseline restoration → reapply → verify, 36/36 including the N1 redesign). The rollback removes only `market_population`, `market_population_member`, their triggers/functions, and the two `ALTER TABLE ... ADD CONSTRAINT` statements this migration itself adds (`applicability_id_observation_question_uk`, `market_population_id_question_uk`) — nothing else. `comp_snapshot`/`valuation_event`/D1/D5A/D5B objects are never touched by either direction.

## M1 projection boundary — live check

Confirmed by direct inspection of `0017`'s own text: zero FK from `comp_snapshot` to `MarketPopulation`; zero writer; zero trigger populating `comp_snapshot`; zero historical snapshot rewritten; zero assumption that existing snapshots correspond to future populations. `comp_snapshot` materialization remains future work behind a later writer/projection boundary, exactly as M1-A ruled.

## Live apply

See the accompanying live-apply transcript (this dispatch) for the actual execution result, recovery record, and post-apply MP-PA1–MP-PA18 verification.
