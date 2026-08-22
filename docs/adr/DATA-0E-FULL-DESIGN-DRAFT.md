# DATA-0E-FULL — Design Draft (Task C, Summit Phase 1)

**This is a design draft only. Not executed in this dispatch — the summit's own dispatch text is explicit: "No DATA-0E-FULL... in this dispatch." Nothing here is a green light to run; it is the plan the future execution dispatch will run against, plus the evidence (amendment A6) and migration-discovery findings (amendment A5) that plan depends on.**

---

## Mint ledger design (Rulings 3–5, A3, A4)

Full DDL: `db/data0/0003_uuidv7_identity_and_mint_ledger.sql` (design-only, additive, `0001_`/`0002_` untouched per A5, **catalog permanent identity only — `gk_asset`/`asset_identity_assignment` removed to the DATA-1 Foundation dispatch, per the correction pass's C1 ruling**).

- **`entity_mint_basis` + `mint_event`** (Ruling 3 + A3, **redesigned in review twice — C2-v1 then C2-v2, the Phase-1 final micro-correction**): the mint-idempotency primitive is a first-party `entity_mint_basis` table with `UNIQUE (basis_namespace, basis_key)` **only** — no version component. NOT `external_map`'s own index (C2-v1's fix — using an external provider's own uniqueness as the permanent-identity idempotency mechanism would place that provider underneath GrailKey's first-party identity, breaking for a synthesized-consensus entity, a manual entity, a future vertical with no GCD-analog, or a corrected provider mapping). NOT a three-column `(namespace, key, version)` tuple either (C2-v2's fix — an earlier draft of this design included `version` in the uniqueness check; found wrong before any row existed, because a routine policy/schema update would then silently mint a SECOND entity for the same real-world basis). `basis_schema_version` and `mint_policy_version` are now pure provenance/interpretation metadata columns on the basis row, never part of the uniqueness check. **Basis-key stability clause**: `basis_key` must identify a durable mint basis and may never be recomputed from ordinary mutable canonical attributes (title, year, publisher spelling, condition, grade, value, reconciliation output). For 0E-FULL, `namespace='comic:gcd-issue'`, `key='<GCD issue ID>'` is one legitimate source-backed basis type — this does not make the external ID GrailKey's own entity ID; future basis types requiring no external provider at all (`operator:manual-canonical-mint`, `claim-cluster:<strategy>`) are equally valid. External identifiers may still participate as VALUE content within a basis key for the use cases that have them, but the constraint itself is always first-party, always on this two-column tuple. **A future schema change that genuinely alters what a `(namespace, key)` means is handled by an explicit `basis_supersession` edge resolving through one stable basis identity — never by widening the tuple.** Transactional contract: basis-row insertion and entity creation happen in one transaction — a UNIQUE-constraint conflict on the basis row means no new entity is created (resolves to the existing one); if entity/typed-row creation fails after a successful basis claim, the whole transaction rolls back, so no orphan basis row or unclaimed entity can ever exist in a committed state. Same mint basis, concurrent or repeated, or reviewed under a newer basis/policy version, always resolves to exactly one entity. Full detail and the binding invariant statement (`entity ID ≠ mint basis ≠ basis/rule version ≠ reconciliation version`): `docs/adr/ADR-ID-001-permanent-identity.md` Ruling 2; DDL: `db/data0/0003_uuidv7_identity_and_mint_ledger.sql`.

**Required proof table** (C2-v2) — the corrected `(basis_namespace, basis_key)`-only invariant against the five cases it must handle:

| # | Scenario | Outcome |
|---|---|---|
| 1 | Same namespace+key, same version | Same entity, zero new rows |
| 2 | Same namespace+key, newer policy/schema version | Same entity, zero new rows, new interpretation metadata only |
| 3 | Different namespace, same key | Independent basis — may mint |
| 4 | Concurrent same-basis race | `UNIQUE` gate → exactly one entity, zero orphan basis or entity rows |
| 5 | Mint ledger destroyed | Backup/restore event, never remint |
- **`entity_resolution_event` + `entity_resolution_member`** (Ruling 4, A4): member-row shape (not a fixed old-id/new-id column pair) handles 2→1, 1→N, and genuine N→M without redesign — a resolution event's own `source`/`target` member rows describe any shape uniformly.
- **`catalog_entity` revision** (Ruling 5): `id BIGSERIAL` → `id UUID`, no `DEFAULT` — generation is always explicit, post-idempotency-check (ADR-ID-001).

## UUIDv7 mechanism, chosen from evidence (A6)

Restated from `docs/adr/ADR-ID-001-permanent-identity.md`, which is where this was actually ratified — summarized here since Task C's own scope references it:

- Real Neon Postgres instance confirmed live (`GRAILKEY_CATALOG_DATABASE_URL`, discovered in `.env.development.local`, never previously connected to by any prior dispatch): **PostgreSQL 18.6**.
- Native `uuidv7()` confirmed working via direct query: `01a027e8-881d-7884-8628-4d28bf61c39e`. Zero extensions installed or needed (`pg_extension` carries only `plpgsql`).
- Node.js v22.14.0 has no native v7 support (`crypto.randomUUID({version:7})` silently ignores the option, still emits v4).
- **Decision: native generation, invoked explicitly by the mint script at the moment a new mint is confirmed — never a passive column default.** Installs nothing (A6's own requirement), avoids reimplementing RFC 9562 in JS, avoids cross-instance clock/entropy concerns.
- Target database has zero existing tables — confirmed live, not assumed (A5).

## DATA-0E-FULL execution plan (A7)

### Acquisition gate (checked FIRST, before the crawl plan below is authorized to start)

Before any crawl begins, two things are checked, in order:

1. **Is an authorized Metron bulk/export/elevated-quota path available today?** Jimmy's bootstrap-export request to the Metron project is already sent and, as of this correction pass, unanswered — recorded here as the standing open alternative, not assumed resolved either way. **Expected result today: no bulk path yet** (the email is pending, not granted) — under that expectation, the conservative per-item crawl below is what starts, not a hypothetical bulk import.
2. **Can any durably-held response artifact be reused instead of re-fetching?** DATA-0E-PILOT's own 1,116-issue stratified sample already holds real, previously-fetched detail responses for that subset of candidates — the crawl should check for and skip any candidate already present in a durably-held artifact before spending a live request on it. (The pilot's sample was stratified by representative year, not a uniform random subset of the full 162,775, so the overlap is real but partial — exact dedup accounting is crawl-implementation work, not resolved in this design draft.)

**Standing override, binding on whichever path is active:** if an authorized Metron bulk/export path is granted AFTER the crawl has already started, the crawl aborts cleanly at its next checkpoint boundary and the bulk path supersedes it — same referential/semantic gates, same contract, no extrapolation on either path. A granted export is never treated as a reason to relax the AUTO-MINT criteria or accept a lower evidence bar than the crawl path would have required; it changes ACQUISITION mechanics only, never the canonical contract.

**Authorization:** if the gate above resolves to "no bulk path exists today" (the expected outcome), the checkpointed 3,500/day crawl described below is authorized to start — but only after this correction pass is itself approved and pushed, and not within this dispatch (per the summit's own "No DATA-0E-FULL... in this dispatch" instruction, which this correction pass does not lift).

### Candidate population

**162,775** — Metron's real, freshly-counted `missing_gcd_id=false` total (`docs/DATA-0D-CROSSWALK-VALIDATION.md` Task 4's own exact figure, re-queried live during that dispatch, not the earlier ~176,199-population census estimate). This is the full AUTO-MINT/REVIEW/RESIDUAL candidate population DATA-0E-FULL would process — not DATA-0E-PILOT's 1,116-issue stratified sample.

### What paginated/bulk payloads already carry vs. what needs a detail call

Confirmed directly during DATA-0D (not assumed): Metron's `/api/issue/` LIST endpoint carries `id`, `series{id,name,volume,year_began}`, `number`, `cover_date`, `store_date` — **but not `gcd_id`/`cv_id`**, which exist only on the per-issue DETAIL endpoint (`/api/issue/{id}/`). Every one of the 162,775 candidates therefore needs its own individual detail fetch — there is no bulk/paginated shortcut for the field this entire pipeline depends on (referential validity, Task 2's own mechanism).

### Requests/candidate, total requests

- List pages to enumerate all 162,775 candidate IDs: `ceil(162,775 / 100) = 1,628` pages.
- Detail fetches: 162,775 (one per candidate — no batching endpoint exists).
- **Total: 164,403 requests.** ~1.01 requests/candidate (detail dominates; list overhead amortizes to near-zero per candidate).

### The 5,000/day constraint — the real, binding limit

At this session's own established safe pacing (3.5s/request, ~17/min, comfortably under the 20/min burst limit — the same pacing every DATA-0D/0E-PILOT Metron script used), a FULL day of continuous requests would allow ~24,686 requests — but the 5,000/day cap is reached in just **5,000 × 3.5s ≈ 4.86 hours**, meaning the script runs for well under a fifth of each day and then must sit idle until the daily quota resets, not run continuously.

| Daily budget used | Days to complete 164,403 requests |
|---|---:|
| 5,000/day (the literal cap, no margin) | **33 days** |
| 4,000/day (80% of cap, real margin) | **42 days** |
| 3,500/day (matching this session's own "far inside 5K/day" discipline) | **47 days** |

**Recommendation: 3,500/day.** Matches the conservative discipline every Metron script this session actually used, leaves real margin for any other concurrent Metron API usage (this project's own other tooling, or manual investigation during the campaign), and avoids the risk of a daily-reset boundary miscalculation pushing a run over the hard cap.

### Minimum wall-clock

**~47 calendar days at the recommended 3,500/day budget** (33 days minimum at the literal cap, with zero margin — not recommended). This is a genuinely multi-week, likely multi-month-with-real-world-interruptions undertaking, not a single dispatch's work — stated plainly, not minimized, per A7's own "no extrapolated minting, no contract relaxation to raise yield" instruction. No sampling shortcut, no partial-population substitute is proposed as equivalent to this — DATA-0E-PILOT's 1,116-issue sample already proved the MECHANISM; DATA-0E-FULL's own value is coverage, and coverage at this population size costs real calendar time under the real rate limit.

### Checkpoint/resume

Same pattern DATA-0E-PILOT's own sampler already proved (`C:\grailkey-data\data-0d-sample.mjs`'s checkpointing, and the same detached-process launch technique that survived the harness's own background-task duration limit): a JSON checkpoint file, written after every N fetches, recording which candidate IDs have been processed and their results. On restart (whether from an intentional daily-budget pause or an unplanned interruption), the script loads the checkpoint and skips everything already done — no work is ever re-fetched, no partial progress is ever lost.

### Retry/backoff

Transient failures (network errors, HTTP 5xx, unexpected 429 despite pacing) get bounded exponential backoff (e.g. 3 attempts, doubling delay) before the candidate is marked `residual-no-mint` with a recorded failure reason — never silently dropped, never blocking the rest of the run.

### Cache policy

Every successful detail-fetch response is persisted to the checkpoint immediately (not batched, not held in memory only) — a crash or forced stop loses at most the one in-flight request, matching the exact discipline that made DATA-0E-PILOT's own sampler resilient to the harness's background-task kill.

### Budget protection

The script tracks its own daily request count against the recommended 3,500/day ceiling (not the literal 5,000 cap) and stops itself BEFORE exceeding it, persisting a "resume tomorrow" checkpoint state — never relies on the API itself rejecting the 3,501st request as the enforcement mechanism.

### Restart artifacts

- The checkpoint JSON (candidate list, per-candidate outcome, running request counts).
- A daily log of requests-used-vs-budget, so a mid-campaign audit can confirm the pacing discipline was actually followed, not just intended.

### Absent-evidence handling

- A candidate whose detail fetch permanently fails (after retries) is recorded as `residual-no-mint` with the failure reason preserved — never assumed to be any particular tier.
- A candidate whose `gcd_id` fails Task 2's own referential-validity check (does not resolve to a real `gcd_issue` row) is recorded and excluded from minting — DATA-0E-PILOT's own sample found 100% referential validity, but DATA-0E-FULL must re-verify this for the full population, not assume the pilot's rate holds — **no extrapolated minting** (A7's own explicit instruction). Every one of the 162,775 candidates gets its own real referential check against the loaded GCD spine, not a projected pass-rate.
- Semantic-agreement tier classification (SAME_COMIC / SAME_SERIES_DIFFERENT_ISSUE / DIFFERENT_COMIC) is likewise computed per-candidate, for real, using DATA-0D's own two-tier comparison (`compactTitleKey` + `hasSufficientTitleOverlap`, `normalizePublisherKey`, the three issue-number tiers) — the pilot's own 96.86%/3.14%/0% rates are a planning EXPECTATION only, stated as such, never treated as a promise or substituted for the real computation.
- **No contract relaxation to raise yield**: if the real full-population semantic-agreement rate turns out materially lower than the pilot's sample suggested, the AUTO-MINT tier's own agreement criteria (ADR-ID-001, DATA-0D's Task 3 rules) are not loosened to compensate — a lower real yield is reported honestly, not manufactured away.

## What this draft does not do

- Does not execute against the real Neon instance.
- Does not apply `0003_uuidv7_identity_and_mint_ledger.sql` anywhere.
- Does not begin the 162,775-candidate Metron pull.
- Does not decide the canonical-subset question DATA-0E-PILOT's own Task 5 draft already scoped as options (A/B/C) — that remains a summit decision, informed by whatever DATA-0E-FULL's real mint counts turn out to be once it eventually runs.
- Does not resolve the acquisition-gate question above — Jimmy's Metron bootstrap-export request stays pending and unanswered as of this correction pass; this draft states what happens under either outcome, it does not itself check for or wait on a reply.
