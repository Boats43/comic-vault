# GRAILKEY STRATEGY v2 — LOCKED 2026-08-22
## Evidence-Safe Claims · Market-Pinned Positioning · The 90-Day Domination Board

**Supersedes the 2026-08-21 strategy file and the campaign report's victory
language.** No prior strategy file exists in this repo's tracked history as
of this commit (checked — `docs/` had no `*strategy*` file before this one);
the supersession note is retained verbatim from the source dispatch as the
record of what this version corrects, not a pointer to a file that exists
here to edit. Engineering sequence unchanged — this corrects CLAIMS and
sharpens POSITION.

**One wording correction applied against this document's own claims policy
(§2) before commit:** the closing line below reads *"the scan-and-list race
is crowded; the evidence-backed asset→decision→outcome substrate is far
less mature and is where GrailKey differentiates"* — never "the substrate
race is empty" (OUTTA alone forbids that framing; see §5's own OUTTA row).

---

## AMENDMENT 2026-10-13 — owner-outcome north star and the immediate commercial test (ADOPTED; additive; sections below are NOT rewritten)

**North star (amends the metric framing under §7):** **GrailKey optimizes the asset owner's risk-adjusted economic outcome.** The customer-facing question is **"What should I do with this exact physical asset?"** — identify, value, and recommend a disposition (list, hold, pass, grade, sell raw, trade, consign, sell to a dealer), then measure what actually happened. The earlier "inventory dollars → evidence-backed action per operator hour" remains a *measurement* of that, not the goal.

**Customer hypothesis (NOT a validated market):** comic dealers. §6 ruling 3's DEALER tier is a hypothesis until interviews (GK-298) support it; no pricing-tier decision follows from it yet.

**The immediate commercial test — ONE SALE. THREE DEALERS. TWO MEASUREMENTS.**
* ONE governed sale (B1 supervised OPERATOR_MANUAL listing) and its eventual economic reconciliation — the first closed economic outcome (closed outcomes today: **0**).
* THREE real dealer workflow interviews, operator-owned, Phoenix area (GK-298).
* TWO measurements: full end-to-end scan COGS (GK-285; the $0.015/scan figure is UNMEASURED) and same-image grade repeatability without purchasing certified books (GK-297; $5 cap, provisional ≥90% same-bucket / σ ≤ 0.25 grade steps, subject to a bucket definition).

**Candidate wedges — banked, NOT implemented:** grading-versus-raw-sale decisions · MAX BUY · inventory disposition. Prioritization waits for customer and technical evidence. Known technical input: durable actions are only LIST/HOLD/PASS and there is no direct-sale/dealer outcome type (GK-299); the Buyer Decision Ledger records BUY/PASS and an optional purchase price tied to the decision, not to a physical asset (registry finding, 2026-10-13).

**§7 90-Day board status note:** the checklist below is a 2026-08-22 snapshot; "Cross-device asset", "Durable economics" and "eBay projection" have since moved in Development/Production but "Outcome loop" is still unchecked (0 closed outcomes). Re-stamp each box against `docs/MASTER-BOARD.md` before using it as a scoreboard. **§8 stands for the engineering sequence**, but its "next three things outrank everything" list is now subordinate to the commercial test above. The §6 ruling 4 NOT-YET list is unchanged, and gains: *no wedge build before customer or technical evidence.*

---

## AMENDMENT 2026-10-13 (b) — wedge status, evidence gate, settlement doctrine, active board (ADOPTED; additive; supersedes only the wording noted)

**A. The commercial wedge is NOT proven.** The candidates are (1) grading disposition ("should I grade this copy?"), (2) acquisition and MAX BUY, (3) broader owner-aligned asset decisions. **Actual dealer behavior decides which one wins** (GK-298 interviews); until then none is promoted, and the earlier amendment's list of candidate wedges is a list of hypotheses, not a plan. No wedge implementation is authorized.

**C. Economic settlement doctrine — UNKNOWN IS NOT ZERO.** A trusted closed outcome must keep these separate, each either a recorded value or an explicit UNKNOWN: gross proceeds · buyer-paid shipping · marketplace fees · actual shipping expense · packaging · refunds · other adjustments · acquisition basis · payout status (and payout date) · realized net · economic profit. A missing component is never silently treated as 0, and a net that depends on an UNKNOWN component is reported as provisional. Known gaps against this doctrine (census 2026-10-13, no schema work authorized): no storage for buyer-paid shipping, packaging, payout/payout date/time-to-cash; acquisition basis is an absent row; missing fee/shipping/refund/credit components read as 0 and can still be labelled KNOWN; `outcome_event` / `outcome_economics_component` have no database-level immutability triggers. **No settlement schema implementation is authorized.**

**D. Evidence gate for the next product decision.** The next product decision requires ALL of: (1) one trusted closed economic outcome; (2) three substantive dealer conversations (GK-298); (3) one measured scan COGS result (GK-285 — the `$0.015/scan` figure remains UNMEASURED); (4) one same-image repeatability result (GK-297, $5 cap, no certified-book purchase). **The older "ten closed outcomes" review is subordinate to this gate** (no text defining that review exists in this repository; it is carried here only as the superseded external reference).

**F. Active board versus strategic roadmap.** ACTIVE (execution): gate deployment and acceptance; Old Man Logan #25 physical verification; ONE supervised OPERATOR_MANUAL listing; reconciliation of that sale; GK-285; GK-297; GK-298. STRATEGIC ROADMAP (NOT active; nothing here may be promoted into implementation without a separate authorization and evidence): Shopify, Whatnot, Universal V2, Economic Router, Reserve Authority, additional asset categories, continuous asset intelligence, subscription metering, outside-user marketplace publishing (blocked on GK-283, GK-294, GK-295), proprietary ML.

---

## 1. THE DEFENSIBLE GRAILKEY (the one paragraph)

> **The evidence-backed operating system for physical inventory — where every physical copy has permanent identity and history, every recommendation is economically accountable, and every realized outcome makes the next recommendation better.**

Consumer: *Know what it is. Know what it's worth. Know what to do.*
Company: *From physical object to verified asset. From verified asset to economic action. From action to realized outcome.*
**Initial go-to-market (narrow, provable):** *Turn a long box into money. Know which books deserve your time.*
The universal "photograph anything" story is the platform vision — earned later, not launched first.

## 2. EVIDENCE-SAFE CLAIM LANGUAGE (binding for all docs/marketing)

```
"False-READY containment won; comic-runtime closeout active" — not "war won"
"Known false-READY mechanisms contained; insufficient authority abstains" — not "zero lies possible"
"1,116-row stratified sample: 100% referential, 96.86% SAME_COMIC, zero surviving
 DIFFERENT_COMIC after methodology correction" — sample-scoped, always
"2.6M-issue raw source spine reproducibly staged; canonical graph being built"
"First durable DATA-1 staging assets exist" — permanence claimed after auth + cross-device
"Crawl acquiring evidence for 163K linked candidates; minting after every gate"
Competitor claims: never "nobody has/rents/owns" — name the overlap, state our edge
```

## 3. THE MACHINE (what competitors can't cheaply copy)

```
PHYSICAL OBJECT → PERMANENT gkAssetId → CLAIMS+SOURCES+EVIDENCE → CANONICAL
IDENTITY → CONDITION+COST → MARKET+LIQUIDITY → EXPECTED NET ECONOMICS →
DECISION → CHANNEL/ACTION → REALIZED TRANSACTION → ACTUAL NET+TIME →
PREDICTION ERROR → LEARNING ↺
```

Photo→AI→price is commodity (Underpriced, Hero, HipComic prove it). The loop above is not.

## 4. FIVE LAYERS, PINNED TO REALITY

| Layer | Maturity | Pressure | What defends it |
|---|---|---|---|
| Canonical knowledge | staged source spine; mint pending | Med | evidence/provenance + reconciliation, not catalog size |
| Permanent asset | staging-proven; auth/cross-device pending | High | copy-level identity + correction + custody + history (cross-device alone is table stakes — CLZ syncs) |
| Evidence intelligence | strongest live differentiator | Med | claims/conflicts/authority/abstention vs. a confidence number |
| Decision engine | partial; market chasing fastest (Underpriced sells ROI + Flip/Pass today) | Very high | expected NET by channel incl. labor/time/risk → "which 25 items deserve my next hour" |
| Outcome graph | embryonic; **starts NOW** | Low today / highest moat | believed→did→sold→net→error→learning, per asset, compounding |

## 5. THREAT BOARD (weekly watch, GPT research pass)

```
OUTTA            narrative collision ("OS for physical assets", passports,
                 liquidity routing; waitlist-stage) → we go OPERATOR-deep,
                 not household-wide
UNDERPRICED      closest product overlap (photo→profit→crosslist→inventory,
                 ~$5/mo) → beat with evidence + permanence + variant
                 resolution + portfolio queues + outcome learning
HERO             API/MCP + agent-facing resale infrastructure → we expose an
                 API only AFTER proprietary state exists (asset/evidence/
                 decision/outcome) — infrastructure around generic listing
                 is replicable; around outcome-trained intelligence is not
VENDOO/LIST PERFECTLY  own crosslisting workflows → don't race channel
                 count; ASSET → LISTING PROJECTION → CHANNEL, eBay deep
                 first; STEAL WORKFLOWS BEFORE USERS (import their CSVs —
                 CLZ, eBay, Vendoo, LP, Whatnot, spreadsheets → instant
                 GrailKey assets)
HIPCOMIC/CLZ/COVRPRICE  scan/value/collect is cheap or free → do NOT
                 compete for "best comic collection app"; comics prove the
                 OPERATOR system
```

## 6. RULINGS ADOPTED

1. **OutcomeEvent starts NOW** — even primitive (asset, decision, listed_at, channel, ask, sold_at, gross, fees, shipping, net, days). The moat needs time to compound; it enters the DATA-1 schema this week, not month three. **Status as of this commit:** the schema clock started — `db/data0/0006_outcome_ledger.sql` (design draft) + `docs/adr/DATA-1-OUTCOME-LEDGER-DESIGN.md`, DATA-1C Addition 1. Real capture wiring is still gated behind DATA-1D per that design doc's own roadmap gate — the DATA clock has not started yet, only the schema clock.
2. **Vertical #2 UNFROZEN** — cards must earn the slot via scorecard (source availability, identity difficulty we uniquely solve, operator GMV, incumbent strength — Collectr/CollX/Ludex are dug in). Decision deferred to the scorecard, not assumed.
3. **Pricing: sell ROI, not scans** — FREE/ENTRY (identify, basic inventory) · SELLER (decision queue, net economics, projections, outcomes) · DEALER (bulk intake, acquisition analysis, portfolio, teams, API). Exact prices set at launch planning against the real market ($5/mo commodity scanners exist).
4. **Explicit NOT-YET list** (unchanged discipline): no generic "scan anything" launch, no native auctions/livestream, no ten adapters, no social, no card vertical yet, no microservices, no blockchain passports.

## 7. THE 90-DAY DOMINATION BOARD (the real scoreboard)

```
□ Runtime closeout        no known false-READY class unresolved (AWW card pending)
□ Cross-device asset      same real asset/photo/history on a second device
□ Durable economics       cost/condition/value/decision persisted as history
□ Outcome loop            real recommendations linked to realized net
□ DATA-0E-FULL            acquisition complete (or authorized export supersedes)
□ Canonical mint          full population through the contract, no extrapolation
□ 0F shadow               agreement/abstention/false-confidence measured
□ 0G cutover              earned by evidence, never by deadline
□ Long Box pilot          real operator: bulk intake → prioritized action queue
□ Acquisition pilot       max-buy price recommended on a real collection
□ eBay projection         asset→listing→sale→outcome linked end to end
□ Second channel          same asset projected, never channel-owned
□ Vertical #2 selection   scorecard + source census + adapter plan complete
```

Metric hierarchy under the north star (inventory dollars → evidence-backed action per operator hour): Picture-to-Action rate · assets/operator-hour · intervention rate · abstention rate · expected net/asset · expected-vs-realized error · days-to-sale error · realized profit/operator-hour · sell-through · channel-recommendation lift · acquisition ROI.

## 8. WHAT DOES NOT CHANGE

The engineering sequence — it already IS the strategy: **1C media → capture
wiring → 1D auth + cross-device → Long Box/economics → outcomes
compounding**, knowledge lane grinding in parallel to mint → shadow →
earned cutover. The next three things outrank everything: **cross-device
gkAssetId · Long Box operator economics · decision→outcome loops
accumulating from this week.**

The scan-and-list race is crowded; the evidence-backed asset→decision→outcome
substrate is far less mature and is where GrailKey differentiates.
