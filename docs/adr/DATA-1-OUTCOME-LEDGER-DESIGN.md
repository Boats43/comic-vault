# The Outcome Ledger — Design (DATA-1C, Addition 1)

**GrailKey Dispatch 2026-08-23, DATA-1C Addition 1.** Design only. No schema
applied to any database — `db/data0/0006_outcome_ledger.sql` is a DRAFT
migration, the same status `0004_data1_foundation.sql` carried before
DATA-1A's bounded slice applied 13 of its 17 tables. Governing ADR:
`docs/adr/ADR-EVENT-001-event-model.md`, Ruling 22 — "the outcome ledger is
first-class, not instrumentation... the exact durability mechanism... is
DATA-1 implementation scope, not ratified there — this ruling states that
it MUST become durable, not where." This document is the "where."

## The binding law

**History appends; current state derives.** `outcome_event` is immutable —
one row per real-world economic fact, never edited once written. A current
realized-outcome view (`asset_outcome_current`) is a materialized
projection rebuilt FROM the ledger on every insert, matching the exact
convention `current_owner` already established for `ownership_event` in
`0004_data1_foundation.sql`. This is the same hybrid-event law
`ADR-EVENT-001` already ratifies for `domain_event`/`outbox` — applied here
to a second, economics-specific ledger rather than overloading
`domain_event`'s generic payload for numbers the metric hierarchy needs to
query directly and repeatedly as typed columns.

## Why not one mutable row

The rejected alternative — a single `asset_economics` row that gradually
acquires `listed_at`, then `sold_at`, then `fees_amount`, then `net_amount`
as each becomes known — was considered and rejected for the same reason
`ADR-EVENT-001` rejected conflating audit and trace: it would be a second,
weaker state-tracking mechanism competing with the append-only discipline
every other DATA-1 table already follows (`ownership_event` +
`current_owner`, `asset_identity_assignment`'s `superseded_by` chain). A
mutable row also cannot answer "what did we believe about this asset's
outcome at time T" — a real question the 90-day board's
expected-vs-realized error metric depends on.

## Schema (see `db/data0/0006_outcome_ledger.sql` for the full DDL)

- `outcome_event` — append-only. `outcome_type` ∈ `LISTED · SOLD ·
  FEES_FINALIZED · FULFILLMENT_FINALIZED · REALIZED_OUTCOME`. Typed
  economic columns (`ask_amount`, `gross_amount`, `fees_amount`,
  `shipping_amount`, `net_amount`, `days_to_sale`), all nullable — which
  are populated depends on `outcome_type`. First-party idempotency via
  `UNIQUE (idempotency_namespace, idempotency_key)`, per `ADR-ID-001` —
  applied inline on the row itself rather than through
  `src/modules/assets/idempotency.js`'s generalized table, because outcome
  events are expected to originate from redeliverable webhook/callback
  sources (a marketplace's own "item sold" notification), not a single
  interactive service call.
- `asset_outcome_current` — one row per asset, rebuilt on every
  `outcome_event` insert, never an independent write path.
- `domain_event_id` links each `outcome_event` row back to its
  `ADR-EVENT-001` envelope (`event_type: 'outcome.recorded'`) when one
  exists — nullable, because a backfilled historical outcome (a sale that
  happened before this table existed) may never get a corresponding live
  `domain_event`.

Target economics preserved per Addition 1: ask, gross, fees, shipping,
net, and days-to-sale must ultimately be reconstructable per asset and per
recommendation (`decision_event_id`, nullable — an outcome can occur
without a prior recorded recommendation).

## The honest clock

This draft starts the **schema** clock, not the **data** clock. No capture
wiring exists yet for any `outcome_event` write path — that's explicitly
out of scope for this dispatch (MODE: bounded build, no
production/scanner wiring, per the DATA-1C dispatch's own constraints).

**Roadmap gate, recorded here so it isn't silently slipped:** minimal real
`OutcomeEvent` capture ships **after** DATA-1D (durable auth/cross-device)
and **before** the Long Box pilot — bootstrapped from the existing
eBay/listing workflow (`api/list-ebay.js`/`api/delist-ebay.js`), where real
transactions can already be linked, rather than waiting for a
purpose-built capture UI. This is deliberately as early as the standing
`GK-151` hard gate (authenticated principal → authorized asset →
authorized marketplace account → authorized mutation) allows — the moat
named in `docs/GRAILKEY-STRATEGY.md` §6 Ruling 1 compounds from real data
over time, not from the schema's existence, so the gap between "schema
exists" and "first real row lands" should stay as narrow as GK-151
permits, not slip to whenever it's convenient.

## Open items, named not solved (see the SQL file's own trailing comment)

- Whether `REALIZED_OUTCOME`'s `days_to_sale`/`net` computation is derived
  server-side from an asset's own prior `LISTED`/`SOLD` rows at write time,
  or always caller-supplied — a DATA-1D-or-later implementation decision,
  not a schema question.
- No FK from `outcome_event` to a listing/marketplace-account table — none
  exists yet (`GK-151` territory); `channel` stays free-text until that
  model exists.

## Migration governance

`db/data0/0006_outcome_ledger.sql` — new, additive, DESIGN DRAFT (not
applied). Zero lines touched in `0001`–`0005`, per the standing "never
modify historical migrations" rule (Summit Phase 1 amendment A5).
Historical migration history is evidence, restated here as it is in every
prior migration file's own header.
