# DATA-1 Readiness — Asset-Management Interrogation

**Report-only artifact from the GrailKey Dispatch 2026-08-21
"Asset-Management Readiness Interrogation."** Nothing built, nothing
pushed, no Neon connection, no external calls — a read-only audit of the
current repo against the locked product decision:

> GrailKey is an asset management system: take a picture → know what it
> is → know its actual value → manage it as an asset. We are building
> this system first. Everything else is downstream.

This document is the readiness baseline DATA-1's design will start from,
together with DATA-0B-2's canonical-catalog load (separately blocked on
a local Docker install) and the real scan telemetry GK-145/GK-146
(GrailKey Dispatch 2026-08-21, `src/lib/scanLog.js`) begin accumulating
going forward. See this document's own closing note — DATA-1's
architecture is a joint session once all three inputs are in, not
designed unilaterally here.

**Correction folded into this same commit:** an earlier version of this
interrogation's own D1 answer implied `docs/DATA-0-ARCHITECTURE.md`
already had a "gkAssetId boundary section" to check the runtime against.
It didn't — confirmed by a zero-hit grep at investigation time. Rather
than silently patching the citation, `docs/DATA-0-ARCHITECTURE.md` now
has a real §10 written for this purpose (added in the same commit as
this file); the "does the runtime conflict with the boundary" question
below is answered against that real section, not a hypothetical one.

---

## A — What the scan already captures (the picture → asset record gap)

### A1. Field inventory

| FIELD | WHERE IT LIVES NOW | PERSISTED / EPHEMERAL | KEYED BY |
|---|---|---|---|
| Identity facets + authority states | `api/enrich.js` `out.*` (`titleAuthority` :3060, `yearAuthority` :5018, `variantApplicability` :7974) | **Ephemeral** — collapses to flat `title`/`issue`/`year`/`publisher`/`variant` on IndexedDB write; the CONTESTED/CORROBORATED distinction itself is dropped except `identityAuthority` (see A5) | not durably keyed |
| Condition/grade fields (`grade`, `isGraded`, `numericGrade`, `cgcPenaltyFlags`, `certNumber`, `labelType`, `defectPenalty`) | `api/grade.js` response → catalogue item | **Persisted**, IndexedDB `comics` store; survives identity corrections via `manualCorrection.js`'s `IDENTITY_INDEPENDENT_FIELDS_TO_PRESERVE` (:508-521) | `item.id` |
| Photos (`images[]`) | base64 strings, capped at 3 most recent (`App.jsx:12902`) | **Persisted** in the same record, no separate blob store, no resize/retention policy, no per-photo metadata | `item.id` (array position only) |
| Price + derivation (`out.price`/`priceLow`/`priceHigh`, `out.priceDerivationTrace` :7437) | HTTP response → catalogue item's flat fields | **Mostly ephemeral** — final numbers persist; `priceDerivationTrace` (the richest diagnostic) never reaches IndexedDB (confirms the pre-existing Pattern Library "GrailKey Dispatch 42" finding) | `item.id` for what survives |
| Comp pool snapshot (`out.comps`/`rawComps`/`soldComps`) | HTTP response only | **Ephemeral** — absent from the IndexedDB schema and the correction preserve-list | not persisted |
| Decision + reason codes (`out.decision`/`out.contract`) | HTTP response → `item.decision` | **Persisted** but wiped on every manual correction (`manualCorrection.js:447-458`), no history retained | `item.id`, single current value |
| Timestamps | `item.timestamp` | **Persisted**, IndexedDB `timestamp` index (`db.js:22`) | `item.id` |
| Request/correlation IDs | scanLog record (`scanLog.js:154`) via `api/kv-cache.js`, `scanlog:v1:<ts>:<id>` | **Persisted**, but in a separate KV store, 90-day TTL, never cross-referenced by `item.id` — closed by GK-145, see below | scanLog's own `ts:id` key |

### A2. Collection record

Stored in browser IndexedDB only (`src/db.js`, store `comics`, `keyPath:
"id"`, plus a `timestamp` index) — no server-side mirror of the
catalogue. `putComic` (`db.js:61-65`) is a plain upsert; roughly 20 call
sites across `App.jsx` (scan save, bulk import, auto-refresh, manual
correction, listing sync, etc.). **On identity correction: updates in
place, does not re-key.** `buildCorrectedCatalogueItem`
(`manualCorrection.js:541-597`) pins `id = oldItem.id` (:595) and does a
deliberate clear-list/preserve-list merge — identity-dependent fields
wiped, ownership/photo/grade fields preserved verbatim — then
`replaceCatalogueItemById` swaps it in-array by matching `id`. No
orphaning, no versioning: the corrected record overwrites the prior one,
and nothing preserves the pre-correction snapshot after the response
returns beyond the transient `priorIdentity` sent in the correction
request body itself.

### A3. Photos

Base64 JPEG strings stored directly in the IndexedDB record's `images`
array, hard-capped at the 3 most recent (`App.jsx:12902`). No dedicated
photo store, no compression/resize pipeline, no retention policy beyond
"IndexedDB has this item until deleted," no external object storage
anywhere in the codebase. Linkage to the scan record is implicit and
durable only because the photos live in the same row — there is no
independent photo ID, hash, or per-image timestamp.

### A4. Cost basis

`purchasePrice` — persisted, flat field on the IndexedDB catalogue
record (`App.jsx:3687, 5360-5361, 10865`). Queryable client-side only
(portfolio-level cost-basis/ROI math, `App.jsx:8808-8823`); no server
endpoint reads or aggregates it; a single current value, overwritten on
edit, no history.

### A5. Corrections log

Real, structured, but **ephemeral at the storage layer — the "first-party
data asset" framing overstates current reality.** `buildManualCorrectionProvenance`
(`manualCorrection.js:626-669`) constructs a full before/after/reason
object per request (`newValue`/`priorValue`/`priorSource`/`provenanceTrust`)
and includes it in the `/api/enrich` response — but `manualCorrection`
itself is not in `IDENTITY_INDEPENDENT_FIELDS_TO_PRESERVE`, so it is not
written to the IndexedDB record afterward. What *does* persist per-field
is `identityAuthority` (GK-85's per-field `OPERATOR_CONFIRMED` lock map) —
a lock-state flag, not the accumulating history. **Each correction
overwrites; it doesn't append.**

---

## B — Valuation as a durable fact (not a moment)

### B1. Valuation event gap

**Missing.** `buildScanLogRecord` (`scanLog.js:76-205`, pre-GK-146)
captures book identity, issue authority, family weight, pool sizes,
latency, cost, identity route, barcode, and build SHA
(`evidence.promptVersion = GIT_SHA`) — the one field of a full valuation
event it already had. It did not capture price, comp pool, decision, or
`gradeMultiplier` anywhere, confirmed field-by-field against the write
call site (`api/enrich.js`, pre-GK-146). `out.priceDerivationTrace` is
computed mid-request and consumed in-request, never referenced at the
scanLog build block, and a repo-wide grep of `App.jsx` for
`priceDerivationTrace` returns zero matches. **GK-146 (this same
dispatch) closes part of this gap — see "What changed" below — but does
NOT make this a reconstructable valuation event.** A true valuation
event still needs a comp-pool snapshot and `priceDerivationTrace` itself,
neither of which GK-146 captures.

### B2. Same-copy linkage

**Confirmed: nothing linked two scans of the same physical book, prior
to this dispatch.** `scanLog` had no `itemId`/`assetId` field at all. One
partial exception existed: `refreshMarketData` (`App.jsx:12182-12244`)
reused `item.id` client-side for its own bookkeeping, but `item.id` was
never sent in the POST body to `/api/enrich` — so the server-side
scanLog write still had no way to tie the request back to the collection
record. **Cheapest honest linkage, identified and now wired (GK-145,
this same dispatch):** thread the Collection's existing IndexedDB
`item.id` into the `/api/enrich` POST body and into `buildScanLogRecord`
as `collectionItemId` — zero new ID scheme, an ID that already existed
but stopped at the client. See "What changed" below for exact scope and
the explicit non-claims this wiring makes.

### B3. Provenance reconstruction

Traced `refreshMarketData` → `POST /api/enrich` → `buildScanLogRecord`
write. One month later, from persisted data alone (scanLog + KV cache;
IndexedDB is client-only and out of scope for a server-side trace):
**recoverable** — identity, `issueAuthority.status`/`reasons`, family
weight/decision, pool sizes, which external sources fired and their
latency, `identityRoute`/`authorityPath`, verification cost, and the
exact build SHA that produced the result. **Not recoverable, even after
GK-146** — the comp rows that fed the number, the full pricing rationale,
and `priceDerivationTrace` itself (computed at request time, discarded
after the response is sent). scanLog answered "what identity path did
this scan take and how much did it cost to run" before this dispatch;
after GK-146 it additionally answers "what did it decide and via which
pricing source" — it still does not answer "why did it say $X." The
entire pricing derivation remains ephemeral.

---

## C — The storage question for asset records

### C1. KV inventory + verdict

| Prefix | Purpose | TTL |
|---|---|---|
| `cv:` | ComicVine | 24h |
| `pc:` | PriceCharting | 24h |
| `gc:` | GoCollect | 24h (dormant, never called) |
| `ac:` | active comps | 1h |
| `bc:` | browse comps | 6h |
| `ph:` | PriceCharting HTML | 7d |
| `oauth:` | eBay client-credential tokens | ad hoc |
| `scanlog:` + `scanlog:index:v1` | per-scan audit record + sorted-set time index | 90d |

**Verdict: no — Upstash KV is not a sane home for durable asset records.**
Every write path (`api/kv-cache.js:86`, `client.set(key, value, { ex:
ttlSeconds })`) requires a TTL; there is no no-expiry write primitive at
all, and `kvGet`/`kvSet`/`kvDel` fail silently by design — the file's own
stated "best-effort cache, never blocks a scan" contract. A
valuation/cost-basis/condition-history ledger needs the opposite
guarantee: never silently expire, and a write failure must be visible,
not swallowed. **DATA-1's asset tables belong in Neon alongside the
canonical catalog.** `scanlog:` is the closest existing analogue to a
durable asset event, and even it expires at 90 days — an audit trail by
its own design, not a ledger.

### C2. Neon fit

Using `db/data0/0002_comic_projection.sql`'s comparable typed rows as a
basis, a physical-copy record is roughly 300-500 bytes; a valuation
event 500B-2KB depending on whether comp snapshots are referenced or
inlined; correction-history rows a few hundred bytes each. With a modest
event history (~12 valuations + 2 corrections over an asset's lifetime),
call it 5-15KB fully loaded per asset. Against Neon's 0.5GB free tier,
that's very roughly **30,000-100,000 assets** — an order-of-magnitude
estimate only, and it shares the same 0.5GB budget as DATA-0B-2's
canonical-catalog subset (`docs/DATA-0-ARCHITECTURE.md` §8) — real
numbers need both sides measured together once 0B-2's exact counts land.

### C3. Photo storage options

**Nothing is persisted server-side today.** No blob/object-storage
dependency in `package.json` at all. `api/grade.js` receives the scan
photo as base64, resizes it in-memory via `jimp`, sends it to Vision,
and discards it — never written anywhere server-side. Client-side, the
base64 string rides along inside the same IndexedDB record as
everything else — no dedicated photo field or table. Realistic options,
inventory only: **Vercel Blob** (same project, no new infra to
provision, but `@vercel/blob` is not installed — net-new dependency) or
an **external S3-compatible store** (more setup, zero existing wiring).
Neither exists today; both are net-new work, not a rewire of something
already present.

---

## D — Schema contract alignment

### D1. Boundary conflicts

`docs/DATA-0-ARCHITECTURE.md` §10 (added in the same commit as this
document — see the correction note at the top of this file) now states
the law explicitly: **a physical copy references canonical identity, it
never IS it.** Checked against today's runtime: the collection record
can't yet violate that law because **it was never split in the first
place** — one flat object where all record classes coexist as
undifferentiated siblings. The five-way split:

1. **Catalog identity** — `title`, `issue`, `year`, `publisher`,
   `variant`, `keyIssue`, `editionType`, `isReprint`. Maps toward
   `comic_series`/`comic_issue`/`comic_publisher`/`comic_variant`/
   `comic_printing` (`0002_comic_projection.sql`).
2. **`identityAuthority`** (per-field `OPERATOR_CONFIRMED` lock map) —
   the one field that needed its own flag: this shares a name with
   `0002`'s per-facet `*_authority` columns but answers a *different*
   question (operator lock vs. evidence corroboration). Named explicitly
   in `docs/DATA-0-ARCHITECTURE.md` §10 as `operator_lock` vs.
   `authority` — DATA-1's tables must keep these axes distinct.
3. **Physical-copy state** — `grade`, `isGraded`, `numericGrade`,
   `cgcPenaltyFlags`, `pop`, `images`. No landing table exists anywhere
   in `0001`/`0002` — this is the literal gap DATA-1 fills, not a
   conflict to repair.
4. **Valuation event** — `price`, `pricingSource`, `comps`, `rawComps`,
   `soldComps`, `priceChart`, `priceBands`. Same — no event table exists
   yet.
5. **Decision (advisory)** — `decision`, `claudeCheck`, `demandSignals`,
   `actionAuthority`, `contract`.
6. **Ownership economics** (new ground, not catalog and not a derived
   valuation) — `purchasePrice`, `userFmv98`. Operator-entered, no
   representation in `0001`/`0002` at all.
7. **Raw external payload** (out of scope for the five-way split proper,
   noted for completeness) — `comicVine`, `goCollect`: shaped like a
   future `external_map`-adjacent dump, not yet mapped to `0001`'s
   `external_map` table.

**DATA-1's job is the split itself, not a repair of a wrongly-split
record.**

### D2. Comic-assumptions (domain-leakage audit)

Confirmed leakage even inside modules CLAUDE.md documents as
already-universal (AssetCore) — logged as GK-147, no fixes this pass:

- `src/lib/decisionEngine.js:137` — comment admits it: *"Blocker:
  Identity incomplete (comic-specific: issue + publisher required),"*
  hard-gated on `issue`/`publisher` (:138, 149-151).
- `src/lib/pricingEngine.js:126` — live TODO: *"comic-specific — revisit
  in ComicAdapter Step 5,"* not yet moved.
- `src/lib/pricingEngine.js:7-8` — header claims the module is
  domain-agnostic; contradicted by the line-126 TODO — the boundary is
  declared, not fully enforced.
- `src/lib/pricingEngine.js:46, 183` — `isMegaKey` param/gating exposes
  a comic-specific concept as if it were a universal pricing primitive.
- `src/lib/pricingEngine.js:111` — the 1956 Silver Age boundary is
  hardcoded inside a module claiming to be domain-agnostic.

`App.jsx`/`api/enrich.js`/`api/grade.js` are expected to be comic-specific
by design (top-level app + ComicAdapter caller) — not itemized as
violations. See GK-147 in `docs/TICKET-REGISTRY.md` — the ticket exists
so DATA-1's generic asset layer does not inherit this list by accident.

---

## E — What breaks the promise today

### E1. Promise denominator

| Outcome class | Trigger | Root-cause type | Frequency |
|---|---|---|---|
| ID_REQUIRED | `decisionEngine.js:271-282`, genuinely missing identity | identity | **Unknown — no log export available** |
| DO_NOT_LIST | `decisionEngine.js:268-288`, hard blockers | mixed identity/market-data | **Unknown — no log export available** |
| RESEARCH | `decisionEngine.js:~580-939`, thin market/conflicts | mostly market-data, some identity | **Unknown — no log export available** |
| LOCKED (`listingHardLocked`) | `TITLE_CONTESTED`/`YEAR_CONTESTED` etc., set in `api/enrich.js`/`actionAuthority.js` | identity (facet-authority contest) | **Unknown — no log export available** |
| tier-4 NO DATA (GK-141/142 class) | `pricingSource:'refused-no-data-sources'` despite `comps.js` finding real survivors internally | plumbing | **Unknown — no log export available** |

**No genuine frequency data exists anywhere in this repo for any of
these classes.** Checked and ruled out as sources: pre-GK-146 `scanLog`
had no `decision.action`/`pricingSource` field at all (its only
`decision`-named field was the unrelated `familyWeight.decision`); the
Dispatch-32 47-scan batch review measures an unrelated statistic
(coherent-content-token-lane hit rate); the Metron 510-sample/population
census measures GCD/CV crosswalk coverage, an unrelated dataset. **What
would answer this for real:** exactly the fields GK-146 (this same
dispatch) now adds to `scanLog` — `decision.action`, `pricingSource`,
`price`, `gradeMultiplier` — plus a query script in the shape of
`scripts/query-scanlog.mjs`, run over real accumulated time. Neither the
field nor meaningful accumulated volume existed before this dispatch;
GK-146 makes the *measurement* possible going forward, it does not
retroactively produce a percentage today.

### E2. Ticket impact

- **GK-141** (PC lookup never fires + comps.js's post-filter survivors
  never reach `out.rawComps`) — **yes**, moves the percentage directly: a
  scan with real comp data available still ships `rawComps:0`/
  `refused-no-data-sources`/DO_NOT_LIST. Magnitude unknown (single-fixture
  evidence only, no production count).
- **GK-142** (retained variant/cover-class descriptors over-narrow
  PC/CV/comps queries) — **yes**: the cited production case shows the
  same physical book pricing normally with a clean query vs.
  `soldPool=0/RESEARCH` with the descriptor-polluted one — a real
  before/after on one book, not a corpus-wide rate.
- **GK-143** (Unicode/creator corruption between reconcile-title and
  confirmed-identity write) — **likely no direct E1 movement**: corrupts
  the display/creator string, not `rawComps`/pricing inputs; nothing in
  its evidence shows it altering `decision.action` or the comp pool — a
  data-integrity/display defect, not a promise-denominator one.
- **GK-144** (scanlog write on the synchronous response path) — **no**:
  explicitly a latency/plumbing concern, already non-fatal via
  try/catch; moving it off the response path changes latency, not
  whether any scan produces an actionable value.

---

## What changed in this same dispatch (GK-145, GK-146)

Two small, additive, measurement-only wiring changes landed alongside
this report — named here so this document stays a single accurate
snapshot rather than describing a "before" state that the same commit
already moved past:

- **GK-145** — `collectionItemId` now threads from the Collection's
  existing IndexedDB `item.id` through every collection-originated
  `/api/enrich` request into `buildScanLogRecord`. **This is temporary
  correlation evidence only — it is NOT `gkAssetId` and NOT proof of
  physical-copy identity.** New/free-standing scans (Watch Mode preview,
  barcode identify, an unsaved buyer-mode preview) legitimately carry
  `collectionItemId = null`. No new ID scheme was invented.
- **GK-146** — `scanLog` records now snapshot `out.decision.action`,
  `out.pricingSource`, `out.price`, and `out.gradeMultiplier` at write
  time, under a new `outcome` field. This makes the E1 promise
  denominator measurable from real production data going forward. **It
  explicitly does NOT capture the comp-pool snapshot, `priceDerivationTrace`,
  or the full pricing rationale — "why did it say $X" remains
  unanswerable from persisted data alone, per B3 above.** That gap is
  DATA-1's problem, not something GK-146 closes.

Neither change alters decision, pricing, or identity-authority logic —
both are pure snapshot/pass-through additions, verified against the full
regression suite (see the dispatch's own return-format report for exact
numbers).

---

## Bottom line

The gap between "shows a price" and "manages an asset" was total, not
partial, going into this dispatch: no persisted event linked two scans
of the same book, no persisted event explained *why* a price was what it
was a month later, no server-side storage existed for photos at all, and
the corrections log was a single overwritten lock-state, not an
accumulating history. GK-145/GK-146 close the cheapest, purely-additive
slice of that gap (same-scan correlation, outcome-class measurability)
without touching decision/pricing/identity logic. **DATA-1 still builds
the entire event/ledger layer, the physical-asset table, and photo
storage from zero — this dispatch narrows what "from zero" means, it
does not shrink the remaining work to something smaller than a real
design effort.**

DATA-1's architecture is a joint session, once DATA-0B-2 (the canonical
catalog load, separately blocked on a local Docker install) and enough
real GK-145/GK-146 telemetry have both landed — not designed
unilaterally in this document or its predecessor interrogation.
