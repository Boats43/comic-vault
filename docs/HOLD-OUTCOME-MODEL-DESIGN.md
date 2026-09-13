# HOLD Outcome Model — Design Only (not implemented, not scheduled)

**Status: DESIGN DRAFT, same status as `db/data0/0006_outcome_ledger.sql` — no
migration, no writer, no schema change.** Triggered by the first real
OperatorAction (Creepy #1, `01a09767-3179-7f93-ad0e-8d251f3a80ba`, HOLD against
`decision_event 01a0895e-f93b-708d-9530-3a58555bf75c`'s `LIST_LOW`
recommendation) — a `HOLD` produces no marketplace transaction on its own, so
it cannot be scored from sale proceeds the way a `LIST`→sold chain eventually
will be. This document exists so that gap is named and designed before more
HOLD actions accumulate with no way to ever learn from them.

## 1. The learning question, stated precisely

Not: *"did the price go up?"* — that's unfalsifiable noise (prices move for
reasons unrelated to the decision) and doesn't tell us anything about whether
HOLD was the right call.

The actual question: **was HOLD better than the best actionable sell
alternative available at the moment the decision was made?**

```
hold_value_delta = expected_net_at_closure − expected_sell_now_net_at_T0
```

`expected_net_at_closure` comes from whichever of two closing events happens
first (Section 4). `expected_sell_now_net_at_T0` is a *frozen* counterfactual
computed once, at T0, never recomputed (Section 3).

## 2. Where the re-evaluation horizon belongs, semantically

**Not on `operator_action_event`.** That table is, by design (GK-200's own
`§3` audit), the smallest possible immutable record of "what the authenticated
human chose" — `gk_asset_id` + `decision_event_id` + `principal_id` +
`action_code` + `occurred_at`, nothing else. A re-evaluation horizon is a
*plan about the future*, not a fact about what happened — it can legitimately
be extended, cancelled, or duplicated (Section 5, multiple horizons), which an
immutable action record must never be able to do to itself.

**Proposed new concept: `hold_evaluation_plan`** — a separate, append-only
table, one row per (operator action, chosen horizon) pair:

```
hold_evaluation_plan
  id                              UUID PRIMARY KEY
  operator_action_event_id        UUID NOT NULL REFERENCES operator_action_event(id)
  gk_asset_id                     UUID NOT NULL REFERENCES gk_asset(id)     -- denormalized read convenience, matches operator_action_event's own asset
  baseline_valuation_event_id     UUID NOT NULL REFERENCES valuation_event(id)   -- the T0 valuation the HOLD responded to
  baseline_decision_event_id      UUID NOT NULL REFERENCES decision_event(id)    -- the T0 recommendation the HOLD overrode/followed
  expected_sell_now_net_at_t0     NUMERIC(12,2) NOT NULL   -- FROZEN, Section 3
  cost_model_note                 TEXT NOT NULL            -- which fee/shipping assumptions produced the number above, human-readable, so a future reader never has to guess what was subtracted
  horizon_days                    INT NOT NULL             -- e.g. 30 / 90 / 180
  scheduled_close_at              TIMESTAMPTZ NOT NULL     -- T0 + horizon_days, computed once at insert
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
```

This mirrors the D5B `ValuationQuestion` precedent exactly: the *question we
intend to ask later* is its own durable row, created at decision time,
answered by a separate row later — never a mutable field that gets filled in
after the fact.

## 3. What immutable baseline must be preserved at T0

Three pieces already exist and need no new mechanism:
`valuation_event.id` (grade + value), `decision_event.id` (the recommendation
HOLD was compared against), `operator_action_event.id` (the HOLD itself).

One piece does **not** exist yet and is the actual new baseline this design
introduces: `expected_sell_now_net_at_t0` — a *net-of-costs* figure, not the
raw `valuation_event.value_amount`. Today's valuation is a gross market-value
estimate; "the best actionable sell alternative" has to subtract marketplace
fees (and, optionally, shipping/grading/carrying costs — Section 6) to be
comparable to a real realized-sale net later. This number is computed **once**
from whatever cost-model constants are live at T0 and then **frozen into the
plan row verbatim** — it must never be recomputed later using a changed fee
schedule, or the T0 baseline silently drifts out from under a HOLD that was
already made. `cost_model_note` exists so a future reader can always see
*what* was subtracted without needing the cost-model code to still exist in
its T0 form.

## 4. What future event closes the HOLD evaluation

Two closing paths, mutually exclusive per plan row, whichever occurs first:

**(a) Realized sale before the horizon.** This dispatch does not invent a new
table for this — `db/data0/0006_outcome_ledger.sql`'s existing (design-draft,
not-yet-applied) `outcome_event` already models exactly this fact
(`outcome_type='REALIZED_OUTCOME'`, `net_amount`, `days_to_sale`,
`decision_event_id` FK). A HOLD's plan closes by referencing that asset's own
`REALIZED_OUTCOME` row when one exists with `occurred_at` before
`scheduled_close_at`. A real transaction is *always* stronger evidence than a
mark-to-market estimate — this path wins over (b) whenever both could apply.

**(b) Horizon reached, still held.** A fresh `valuation_event` is recorded at
T1 through the normal, already-live Chain #2 mechanism (`recordValuation`,
engine-computed, exactly like every T0 valuation) — no new writer needed. The
plan closes against *that* valuation.

**Closure itself is a new row, never a mutation of the plan row:**

```
hold_outcome_score
  id                        UUID PRIMARY KEY
  hold_evaluation_plan_id    UUID NOT NULL REFERENCES hold_evaluation_plan(id)
  closing_kind               TEXT NOT NULL CHECK (closing_kind IN ('realized_sale','horizon_valuation'))
  closing_outcome_event_id   UUID REFERENCES outcome_event(event_id)      -- set iff closing_kind='realized_sale'
  closing_valuation_event_id UUID REFERENCES valuation_event(id)          -- set iff closing_kind='horizon_valuation'
  closing_net_amount         NUMERIC(12,2) NOT NULL   -- the realized net, or the T1 valuation net-of-costs, per closing_kind
  hold_value_delta           NUMERIC(12,2) NOT NULL   -- closing_net_amount - hold_evaluation_plan.expected_sell_now_net_at_t0, computed once
  classification              TEXT NOT NULL CHECK (classification IN ('POSITIVE','NEGATIVE','INDETERMINATE'))
  occurred_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
```

A plan with no `hold_outcome_score` row yet is, correctly, still open — see
Section 5 for how that reads as `INDETERMINATE` without needing a sentinel
row.

## 5. How HOLD becomes POSITIVE / NEGATIVE / INDETERMINATE

- **INDETERMINATE**: no `hold_outcome_score` row exists yet for the plan
  (horizon not reached, no sale yet). This is not a missing feature — it is
  the epistemically honest state; the question genuinely cannot be answered
  yet. **This is where Creepy's real HOLD would sit today, if a plan existed
  for it** (Section 8).
- **POSITIVE**: `hold_value_delta > epsilon`.
- **NEGATIVE**: `hold_value_delta < −epsilon`.
- **Open ratification question, deliberately not decided here**: whether a
  `|hold_value_delta| ≤ epsilon` band should fold into NEGATIVE (conservative:
  "holding gained nothing, treat as a loss of opportunity cost"), fold into
  POSITIVE (lenient: "no worse off"), or become a fourth explicit `NEUTRAL`
  value the user did not ask for. Disclosed as open rather than silently
  choosing one, matching this repo's existing "DISCLOSED GAP, not invented
  silently" convention. `epsilon` itself (a fixed dollar amount vs. a
  percentage of `expected_sell_now_net_at_t0`) is the same kind of open,
  unratified question.

## 6. Optional cost adjustments (fields present, not required for a first cut)

`expected_sell_now_net_at_t0` and `closing_net_amount` should both be able to
subtract: marketplace fees (always), shipping cost estimate (always, since
`outcome_event.shipping_amount` already exists for the realized-sale side),
and — nullable, defaulting to zero — a per-day carrying/storage cost rate
frozen onto the plan row at creation time and multiplied by elapsed days at
closure. For a single comic book this is likely immaterial, but the field
should exist from day one so a later, materially-different asset class (or a
storage-fee-bearing consignment model) doesn't need a schema change to use it.
Grading cost (if a raw book is graded during the hold period) is the same
shape — an optional, frozen-at-relevant-time cost component, not built here.

## 7. Multiple horizons, without mutating history

Because `hold_evaluation_plan` is its own table keyed by its own `id` (not a
column bolted onto `operator_action_event`), **nothing prevents multiple plan
rows referencing the same `operator_action_event_id`** — a 30-day, a 90-day,
and a 180-day plan can all exist simultaneously for one HOLD, each closing
independently via its own `hold_outcome_score` row whenever ITS horizon
arrives (or the shared realized-sale event closes all open plans for that
asset at once, since a sale is a single fact that answers every outstanding
"was holding worth it" question for that asset simultaneously). No plan row
is ever edited to add a horizon after the fact — a new horizon is always a
new row.

## 8. Is HOLD scoreable under this model?

**Yes — conditionally, and only from the moment a plan row is created.**
HOLD becomes scoreable the instant either closing path (Section 4) occurs;
until then it is correctly `INDETERMINATE`, which is itself a real, useful,
durable answer (distinct from "no data exists at all").

**This model is NOT retroactive.** Creepy's real HOLD
(`01a09767-3179-7f93-ad0e-8d251f3a80ba`) predates this design — no plan row
exists for it, and none is created by writing this document. Whether to
retroactively attach a plan (and with what horizon, chosen well after the
fact rather than at decision time, which weakens the counterfactual's
honesty) is an explicit, disclosed decision for a human to make later, not
something this design performs silently. Per this dispatch's own instruction:
no retroactive backfill.

## Not built, not scheduled

No migration file, no writer function, no API endpoint, no UI. This document
is the design artifact only — the next step, if and when authorized, is a
migration draft (mirroring `0006_outcome_ledger.sql`'s own "design draft, not
applied" posture) plus real scratch-schema proof, following the same sequence
D5A→D5B→D5C→D5D already used for every other durable-evidence layer in this
project.
