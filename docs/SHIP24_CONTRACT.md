# SHIP #24 — RESPONSE CONTRACT + INVARIANT VALIDATOR [P0, LARGE]

**Status:** DESIGN — awaiting greenlight. No code changes yet.
**Prepared:** 2026-07-11
**Baseline commit:** 2e9ce15 (XMEN1-RULING)

---

## 0. Why this ship exists (evidence from code audit, 2026-07-11)

A full write-map of `api/enrich.js` (5,587 lines) and the App.jsx consumption
paths was taken before writing this doc. Findings:

### Server side — no single writer
- **17 live `out.price =` writers** (ship note said 21 — figure was stale; two
  writers were removed: standalone PC base write and the sanity-fallback write.
  `sanityFired` is now a **dead flag** — declared at 3640, never set true).
- **12 `out.pricingSource` writers**, **16 `out.priceLow/High` writers each**,
  **9 `out.confidenceLevel` writers**, **4 `out.decision` writers** (3 pre-seeds
  at 3566/4272/4317 + final `computeDecision` at 5557).
- **Two parallel response objects:** main `out` (sent at 5577) and a
  separately-assembled `refusedOut` (built 2738–2762, sent at 2763) that
  bypasses the entire pricing pipeline AND `computeDecision`. A third early
  return at 3578 (merchandise) sends `out` before pricing runs.
- **Type incoherence:** most price writers emit `fmtUsd()` strings (`"$12.34"`),
  the visual-pool writer (4716–4718) emits raw numbers, refuse paths emit null.

### Client side — four price authorities on one screen
The same conceptual "recommended price" is computed from **four divergent
sources** simultaneously:
1. Decision panel hero number (App.jsx 3349–3356): `item.decision.price`
2. Stats bar (3670) + Recommended row (5011–5013): `getDisplayPrice` → `priceBands.market`
3. listPrice / eBay button (2677, 6023): `getAuthorityPrice` → can return a
   THIRD number (`soldCompDiagnostics.soldAvg`) when floor-mismatch fires (552)
4. Confidence chip (ResultCard 1306–1313; CollectionDetail 4574–4587):
   recomputed inline from comp counts + pricingSource — agrees with neither
   `decision.confidence` nor `matchConfidence.tier`

One book can render three different dollar amounts and a confidence chip that
matches none of them. This is the B3/P3-A item explicitly deferred to Ship #24.

### Orphaned server fields (X-Men ruling gap)
All six fields added by 2e9ce15 (`floorContaminationSuspect`,
`floorContaminationReason`, `floorBandLow`, `floorBandHigh`,
`listingHardLocked`, `listingHardLockReason`) have **zero reads in src/** — the
frontend never consumes them, none of the 5 merge paths plumb them, and the
List button lock (6012–6013) still keys off `matchConfidence.tier`. The X-Men
#1 "locked ON CARD" exhibit is currently impossible to render.

### Merge-path drift
The 5 client merge paths plumb pricing/decision fields inconsistently:
path 1 (auto-refresh) skips `pricingSource` in its main branch; path 5 (legacy
inline re-enrich, 10557–10560) drops `decision`, `priceBands`,
`soldCompDiagnostics`, `matchConfidence`, and all mega-key fields entirely.

---

## 1. SHIP 24a — SINGLE WRITER: canonical `contract` block

### 1.1 Schema

One block, assembled ONCE at response end, attached as `out.contract`:

```js
out.contract = {
  version: 1,

  // WHAT STATE IS THIS CARD IN — single enum, no flag soup
  state: 'PRICED' | 'ESTIMATED' | 'REFUSED' | 'LOCKED' | 'ID_REQUIRED' | 'INCOMPLETE',

  // THE price. One number (raw, not "$X.XX" string). null when REFUSED/ID_REQUIRED.
  price: 123.45 | null,

  // Where the price came from (existing pricingSource vocabulary, one value)
  source: 'verified_sold_recency' | 'sold_active_blend_30' | 'verified_sold'
        | 'verified_sold_stale' | 'active_ask_derived' | 'verified_active'
        | 'verified_sold_active_blend' | 'ebay-polybag-active'
        | 'visual_pool_fallback' | 'pc_estimate' | 'web_search_fallback'
        | 'ai_estimate' | 'refused' | null,

  // Price-bands tier (1 | 2 | 2.5 | 3 | 4 | null)
  tier: 2,

  // THE verified count — from soldCompDiagnostics.verifiedCount, nowhere else
  verifiedCount: 7,

  // Bands as numbers. null when price is null.
  bands: { quick: 98.00, market: 123.45, stretch: 142.00 } | null,

  // Snapshot of the FINAL decision (post-computeDecision, never a pre-seed)
  decision: {
    action: 'LIST_NOW' | 'LIST_LOW' | 'RESEARCH' | 'GRADE_CANDIDATE'
          | 'HOLD_FOR_CGC' | 'DO_NOT_LIST' | 'ID_REQUIRED',
    confidence: 'HIGH' | 'MEDIUM' | 'LOW',
    blockers: [...], warnings: [...], nextStep: '...',
  },

  bestChannel: 'cash_sale' | 'bundle' | 'grade' | 'barter' | 'research' | 'blocked',

  // Single boolean the List button obeys. Derived, never hand-set:
  // listable = locks.length === 0 && (state === 'PRICED' || state === 'ESTIMATED')
  //            && decision.action starts with 'LIST'
  listable: true,

  // Every reason listing is locked, machine-readable. Empty = no locks.
  locks: [
    { code: 'mega-key-floor-contamination', reason: '...', hard: true },
    // codes: 'manual-review' | 'grade-exceeds-map' | 'mega-key-floor-contamination'
    //      | 'tier0-convergence' | 'refused' | 'id-required'
    //      | 'claude-check-blocker' | 'low-tier-thin-pool' | 'contract-violation'
  ],

  // 24b output (empty when clean)
  violations: [],
}
```

### 1.2 State enum resolution (precedence order, first match wins)

| Precedence | State | Condition |
|---|---|---|
| 1 | `ID_REQUIRED` | `identityConfident === false` OR identity-conflict early return OR decision.action === ID_REQUIRED |
| 2 | `REFUSED` | `refusedToPrice === true` (reprint thin-pool, tier-bypass, no-data-sources, zero-verified-comps, identity-conflict) |
| 3 | `LOCKED` | any hard lock present (`listingHardLocked`, `tier0Locked`, `manualReviewRequired`, `gradeExceedsMap`, merchandise DO_NOT_LIST) — price MAY still be non-null and displayed (X-Men ruling: estimate stays visible) |
| 4 | `PRICED` | price present AND source is comp-backed: tiers 1/2/2.5/3, polybag-active, mega-key floor |
| 5 | `ESTIMATED` | price present AND source is estimate-class: `pc_estimate` (tier 4), `visual_pool_fallback`, `web_search_fallback`, `ai_estimate` |
| 6 | `INCOMPLETE` | assembled but a 24b invariant failed, OR enrich response lacks pricing entirely (Q73 class) |

LOCKED vs REFUSED: REFUSED means *we would not produce a price* → price null,
render $0/blank everywhere (Q68 rule). LOCKED means *we have a price but
listing is forbidden* → price renders, button hard-locked.

### 1.3 Assembly — where and how

**New file: `src/lib/responseContract.js`** (src/lib, NOT api/ — function cap
stays 12/12; Vercel bundles transitively via `../src/lib/` import, same as
pricingEngine.js).

Exports:
- `assembleContract(out)` — pure. Reads the final `out` (post-computeDecision),
  derives the block. Normalizes price to a number (strips `fmtUsd` strings).
- `validateContract(contract, out)` — 24b (below).
- `finalizeResponse(out)` — convenience: assemble → validate → attach → return out.

**enrich.js changes:**
- All THREE substantive response exits call `finalizeResponse(out)` immediately
  before `res.json`:
  1. Identity-conflict early return (2763) — `refusedOut` is retired as a
     separate shape; that path builds a minimal `out` and goes through the same
     finalizer (state=REFUSED or ID_REQUIRED, price null, locks=['refused']).
  2. Merchandise early return (3578) — state=LOCKED, decision DO_NOT_LIST.
  3. Main path (5577) — the normal case.
- **Nothing writes price/decision/source fields after `finalizeResponse`.**
  Currently nothing does (last price write is 5130; 5480–5570 is metadata) —
  the finalizer call sits after `out.priceUpdatedAt` and this ordering becomes
  the enforced convention.
- The 17 existing price writers are NOT rewritten in this ship. They keep
  feeding `out.price` etc. exactly as today; the contract block is derived
  from their net result. (Collapsing writers into a pricingResult pipeline is
  a future ship — this ship makes the OUTPUT single-writer, which is what the
  card renders. Lower risk, same customer-grade guarantee.)

### 1.4 Client — card + collection render ONLY from the block

**App.jsx changes:**
- `getDisplayPrice(item)` → reads `item.contract.price` first; existing chain
  becomes the legacy fallback for pre-Ship-24 catalogue entries (IndexedDB
  items enriched before this deploy have no `contract`).
- `getAuthorityPrice(item)` → `item.contract.price` when contract present.
  The v0-H soldAvg-override branch (552) is retired for contract-bearing items
  — that arbitration now happens server-side in assembly (see 24c).
- Decision panel hero number (3349–3356), stats bar (3670), Recommended row
  (5011–5013), List button price (6023): all four render `contract.price`.
  **One number, four places, definitionally equal.** (Closes B3 P3-A.)
- Confidence chip: renders `contract.decision.confidence` +
  `matchConfidence.tier`; the two inline recomputations (ResultCard 1306–1313,
  CollectionDetail 4574–4587) are deleted for contract-bearing items.
- Verified count chip: `contract.verifiedCount` only.
- List button: `disabled = !contract.listable`; lock banner text from
  `contract.locks[0].reason`. This finally wires the X-Men ruling's
  `listingHardLocked` to the card (via `locks[]`) — "locked ON CARD".
- REFUSED render rule (Q68): `state === 'REFUSED'` → zero bands + single
  REFUSED banner; no phantom prices anywhere.
- **Merge paths:** all 5 paths add ONE line: `contract: enrich.contract ?? cur.contract ?? null`.
  Legacy fields keep flowing during transition (see §4). Path 5's missing
  fields become harmless once render reads the contract.

---

## 2. SHIP 24b — INVARIANT VALIDATOR at the API boundary

`validateContract(contract, out)` runs inside `finalizeResponse`, after
assembly, before send. **Never throws, never 500s.** On violation:
`contract.state = 'INCOMPLETE'`, `contract.listable = false`, push
`{code:'contract-violation', reason}` to `locks`, append to
`contract.violations[]`, and `console.log('[contract-violation] ...')` with the
invariant ID + values (Vercel-log greppable).

### Invariants (v1)

| ID | Invariant |
|---|---|
| I1 | `state === 'REFUSED'` → `price === null` AND `listable === false` AND `bands === null` |
| I2 | `state === 'ID_REQUIRED'` → same as I1 |
| I3 | `locks.length > 0` → `listable === false` |
| I4 | `state === 'LOCKED'` → `locks.length > 0` |
| I5 | `price !== null` → `bands !== null` AND `bands.quick ≤ price ≤ bands.stretch` (±$0.01 rounding tolerance) |
| I6 | `verifiedCount === out.soldCompDiagnostics?.verifiedCount ?? 0` — exactly one source |
| I7 | Recommended == header == grade-row: `contract.decision` is set FROM `out.decision` and `out.decision.price` is OVERWRITTEN to `contract.price` during assembly, so all render sites are definitionally equal. Validator asserts `out.decision.price === contract.price` post-assembly (catches future regressions that write decision.price later). |
| I8 | `price !== null` → `source !== null` and `source !== 'refused'`; `state === 'ESTIMATED'` ↔ source ∈ estimate-class |
| I9 | Customer-grade drift rule: engine self-flagged >100% drift over own pool avg → `decision.action ∉ {LIST_NOW, LIST_LOW}` (must be RESEARCH or stronger) |
| I10 | `decision.action ∈ {DO_NOT_LIST, ID_REQUIRED}` OR `decision.blockers.length > 0` → `listable === false` |

Result: **no self-contradicting card can ship** — worst case the card says
INCOMPLETE with a locked button and we get a greppable log line, instead of a
$300 book with 2 comps averaging $18.

---

## 3. SHIP 24c — Anchor-direction rule (inside assembly)

**⚠️ This is Layer B pricing math** — included in this doc precisely so the
greenlight covers it explicitly.

**Rule:** when sold-active mismatch is EXTREME, the contract price anchors to
the VERIFIED SOLDS side, never to actives.

- **Extreme mismatch test** (reuses the existing `isActiveContaminated`
  threshold from priceBands.js:304): `soldMedian > activeMedian × 3`, with
  verified solds ≥ 3. Symmetric guard NOT included (actives >> solds is the
  normal stale-solds case already handled by tier 2.5 discounting).
- **Behavior when it fires, during assembly:**
  - If the net `out.price` landed on the actives side (< soldMedian × 0.5),
    re-anchor `contract.price` and bands to the sold-side band
    (tier-2.5-style: `staleAvg × 0.85` when all stale, else sold market band).
  - `contract.decision.action` forced to `RESEARCH` (mismatch this extreme is
    never LIST-clean), warning appended:
    `"Sold/active mismatch extreme — anchored to verified solds"`.
  - Log: `[24c] anchor-direction: sold=$X active=$Y → anchored sold-side`.
- **Exhibit (Action #33):** 15 stale solds $300–565 vs 2 junk actives $13–23.
  Q69 FIX 2 already stops the tier-4 cap when soldPrices ≥ 5; 24c generalizes
  the principle to the final assembled number regardless of which of the 17
  writers produced it. Expected: $291-class sold-side price, RESEARCH stays.
- Skip flags: `isMegaKey` contamination path (X-Men ruling already handles
  mega-key mismatch its own way — floor contamination logic wins there).

---

## 4. Migration & compatibility

- **Legacy fields keep emitting** (`out.price`, `priceLow/High`, `priceBands`,
  `pricingSource`, `decision`, all state flags) — unchanged, for old clients
  and old IndexedDB entries. The contract is additive in v1.
- Old catalogue items without `contract`: render helpers fall back to today's
  chains. Auto-refresh naturally back-fills contracts within one cycle.
- `refusedOut` shape retired; its consumers (client treats it as a normal
  enrich response) see the same fields plus `contract`.
- Dead code flagged by the audit (`sanityFired`, legacy ask-floor 3882,
  tier-bypass refuse 3735) is **NOT removed in this ship** — noted for a
  cleanup ship. Ship #24 adds the boundary; it does not refactor the pipeline.

---

## 5. Regression gates (evidence exhibits — all must PASS before ship closes)

| Exhibit | Expected contract |
|---|---|
| **GSX facsimile** | `price ≈ $6` (reprint-comp priced), never $1,412; state PRICED/ESTIMATED; if reprint pool <3 → state REFUSED, price null |
| **B&B Loot Crate** | ONE price ≤ $9 rendered identically in header, Recommended row, stats bar, and List button (I7) |
| **Action #33** | price ≈ $291 sold-side (24c), decision RESEARCH, `[24c]` log line present |
| **Atlas AA #5 + Sweethearts** | state REFUSED → price null, $0/blank card, `listable:false`, button locked (I1) |
| **X-Men #1** | state LOCKED, decision RESEARCH, contamination banner rendered, lock visible ON CARD via `locks:['mega-key-floor-contamination']`, estimate still displayed, `listable:false` |
| **Controls** (Punisher #1, Amazing Adventures #3) | state PRICED, LIST_NOW/LIST_LOW, prices within prior bands, zero `[contract-violation]` logs |

Gate vocabulary applies: these are TARGETS until phone-validated on production
scans; no ✅ until scanned.

---

## 6. Build plan (post-greenlight, commit sequence)

| Step | Commit | Scope |
|---|---|---|
| 24a-1 | `src/lib/responseContract.js` + unit tests | assembleContract + finalizeResponse, state machine, locks derivation, fmtUsd→number normalization |
| 24a-2 | enrich.js: 3 exits → finalizeResponse | refusedOut retirement; no writer changes |
| 24b | validator + I1–I10 + tests | `[contract-violation]` logging |
| 24a-3 | App.jsx render from contract | 4 price sites, confidence chip, verified chip, List button on `listable`/`locks`, REFUSED render, 5 merge paths +1 line |
| 24c | anchor-direction in assembly | **pricing math — covered by this greenlight** |
| 24-gate | HOLD | phone validation sweep on all 6 exhibits |

Each step: `npm run build` clean + ESM-parse on touched `api/*.js` /
`src/lib/*.js`, diff shown before commit.

---

## 7. Decisions embedded in this design (flag now if you disagree)

1. **Block name `out.contract`** (matches ship name; alternative: `out.card`).
2. **Writers not collapsed** — contract derives from net `out` state; the 17
   writers become an internal concern. Full pipeline refactor is a later ship.
3. **`visual_pool_fallback`, `web_search_fallback`, `ai_estimate`, `pc_estimate`
   → state ESTIMATED** (renders with "Estimated comps"-class labeling per P3).
4. **24c threshold = existing ×3 `isActiveContaminated`**, verified solds ≥3,
   one-directional (solds win), mega-key contamination path excluded.
5. **REFUSED renders null-price** (Q68 "render nothing" option, not $0-everywhere)
   — contract.price null, UI shows the single REFUSED banner.
6. **Validator demotes, never blocks the response** — INCOMPLETE + locked
   button beats a 500.
