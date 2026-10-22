# GrailKey — Collection Integrity Audit (2026-10-22)

**Mode:** READ-ONLY. No deploy, no push, no commit, no Production write, no valuation refresh, no catalogue repair. Q41 / publish authorization / Gate B baseline untouched.
**Reference build:** `6bc07c5` (Gate B, on `integration/gate-b-2026-10-21`; NOT an ancestor of checked-out `97c0397`). Line references below are `@6bc07c5` (read with `git show`). Every cited defect was confirmed present in both trees; only line numbers differ (~+37 in `6bc07c5`).
**Data source:** one READ ONLY transaction against Production `data1_dev.collection_item` (292 rows, 1 principal) plus the kernel tables, through `scripts/db-admin-preflight.mjs::assertAdminDbTarget` (environment marker = production confirmed). Credentials were read in-process from `.env.production-secrets.local` and never printed. Working copies: `<scratchpad>/items.json` + analysis scripts (`lib.mjs`, `a*.mjs`, `b*.mjs`, `c*.mjs`) — contain the whole collection, not committed.
**Method note:** the dashboard was **replayed** (real `getDisplayPrice`, ported `getReadinessStatus` / `getChannelMetrics`) over the server rows. It reproduces every reported figure exactly, which is the evidence the server rows are what the phone renders (see F-1).

---

## 1. Collection reconciliation table (Section A)

| Reported | Reproduced | Origin |
|---|---|---|
| 290 comics | **292 server rows** = 290 phone-visible + **2 id-less stub rows** | F-1 |
| 100 PHOTOS / 188 REVIEW / 2 BLOCKED = 290 | 100 / 188 / 2 (exact, stubs excluded) | `getReadinessStatus` |
| 96 LIST / 192 RESEARCH / 1 BLOCKED = **289** | 96 / 192 / 1 (exact) → **1 record has no channel** | F-2 |
| Status value $31,488 | $31,488.22 | `getCollectionMetrics` sums every item (`@652`, `+= price` @685) |
| Channel value $31,463 | $31,463.12 | `getChannelMetrics` gates value on `price>0 && item.price != null` (`@783`) |
| Liquid value $6,808 | $6,808.15 | = PHOTOS bucket value (READY is 0) |
| 96 LIST, 0 READY | 96 `cash_sale`, all `LIST_NOW/LIST_LOW`, `aa=READY`, **all with exactly 1 photo** | F-4 |

**Discrepancy traces (query / filter / ids / calc):**

- **F-1 — 292 vs 290 vs 289.** Query: `SELECT … FROM collection_item` (principal `95b42d2e…`): 290 `comic` + 2 `book`. Within comics, two rows have **no `attributes.id`** and only `{year,issue,title}`: `cv_1789846119473_xmrj3x` (old man logan mike deodato #25) and `cv_1789944517333_703w7v` (the new mutants #98). They are the pre-relink *stub* rows; `scripts/gk270-relink-collection-projection.mjs` repointed the asset links to the rich rows (`cv_1790809927798_txjz5n`, `cv_1789945847230_9chq1h`) and deliberately left the stubs. Their `title` strings equal the **mint-basis** titles of assets `01a0bb24…` and `01a0c104…`. Excluding them reproduces 100/188/2 and 96/192/1 exactly; including them gives 102/188/2 and three unrouted. *VERIFIED arithmetic; the client mechanism that hides them was not located this pass (INFERRED).* (The 2 `book` rows are in the 188/192 — Tagore, Tales from the Crypt.)
- **F-2 — 289 routed.** `src/App.jsx@771 if (!channel) continue;` silently drops any item with neither `contract.bestChannel` nor `decision.bestChannel`. The 290th is **`classic comics #13`** (`cv_1790494983802_fk2koy`): no `contract`, no `decision`, `marketPending=true`, year/publisher empty — an un-enriched partial that status counts (NEEDS REVIEW, $0; the first draft of this audit said PHOTOS NEEDED - corrected) but routing cannot.
- **F-3 — $25.** Amazing Spider-Man #148 (`cv_1792643843355_hl3cvu`): `item.price=null`, `contract.price=25.10`. `getDisplayPrice` reads the contract → status counts $25.10; `getChannelMetrics` requires `item.price != null` (`@783`) → excluded. The two functions apply different value predicates (`@685` vs `@783`).
- **F-4 — Liquid $6,808, 96 LIST, 0 READY.** `getReadinessStatus` (`@586`) returns PHOTOS NEEDED when `decisionSafe=pass` and any of back/spine/pages is missing (`@614`). READY needs **4 photos**; photo count comes from `getComicPhotos` (`@945`) = catalogue-layer images, and **every one of the 290 rows has `remoteImages.length == 1`** → READY is unreachable. So `liquidValue = READY + PHOTOS NEEDED` (`@692/@696`) is simply "decision-safe, photo-incomplete" value. `LIST` (channel) is `contract.bestChannel`, a *recommendation*; READY is a *photo-completeness* state. They answer different questions and are never reconciled.
- **Population differences are by design:** status counts all items; channel skips unrouted; value rules differ (F-3). They are not the same population and no label says so.
- **Estimate ≠ net proceeds.** $31,488 is Σ `getDisplayPrice` (contract price = comp-derived estimate; no fees, shipping, supplies, sell-through, or discount for ASK-only evidence). $6,808 is not a proceeds figure either. Pricing-source mix of the $31.5k: `sold_active_blend_30` $13.8k (106), `active_ask_derived` $5.5k (82 — **asks, not sales**), `verified_sold_recency` $5.4k (51), `verified_sold_stale` $4.9k (10), `pc_estimate` $1.3k (13).

**A2 (ruled — not a bug):** Liquid Value = Ready + Photos Needed. Proposal: rename tile → **"Listable value (photo-gated)"**, and add a separate **"Total estimated value" = $31,488** tile and a **"Verified-sold-backed value"** tile. Also see F-5 (4 rows inflate it).

**F-5 — 4 non-listable rows counted as liquid ($138.69).** `decisionSafe` is computed from `contract.actionAuthority.state==='READY'` alone (`@545`); these rows have `aa=READY` but `decision.action=RESEARCH`, `contract.state=INCOMPLETE`, `contract.listable=false`, `bestChannel=research`: ASM #136 $32.02, Adventure Comics #271 $60.36, The Spectre #1 $27.27, Weird Mystery Tales #2 $19.04. Same row set where READY authority, RESEARCH decision and `listable:false` disagree.

## 2. Critical identity conflicts (Section B / A3 / A4)

Confidence: **H** = fixed by the record's own neighbours or its own stored evidence; **M** = from public knowledge, verify against GCD/ComicVine before any repair. *Nothing was repaired.*

| Row (last 6) | Record | Defect | Conf. |
|---|---|---|---|
| `6q7j0u` | X-Men #101 (**2023**) | neighbours #39=1967, #132=1980 → 1976. `pc_estimate $12`. | H |
| `d2gdy3` | Detective #275 (**1964**) | #294 is 1961 → **1960**; keyIssue "Zebra Batman" matches 1960. | H |
| `l21s0x` | Flash #109 (**1964**) | #118=1961 → **1959**; $78.09. | H |
| `avj298` | Batman 80 Page Giant #176 (**1957**) | #143=1961 → **1965**; format words in `title`; REFUSED. | H |
| `wixbzh` | Batman #152 (**1966**) | **not in your list** — #151=1962, #143=1961 → ~1963. $61.24, `aa=REVIEW`. | H |
| `muz8ic` | Batman Vengeance of Bane #1 (**2023**) | Vengeance of Bane #1 is Jan **1993**; `pc_estimate $99.95`, floor-enforced, 0 verified. | M |
| `rzbgr1` | Origin II #1 (**1972**, publisher null) | Origin II is Marvel 2014; variant "1:100 Kubert Sketch"; LOCKED, price null. | M |
| `b3qd77` | Witching Hour #62 (1972) | sequence says ≥1974 (#48=1974). | M |
| `x67d3p` | **Origin Forme Palkia V #1 (1968)** | **A4 refined:** title is contaminated by a Pokémon-TCG card name from image search, but the record's own AI condition report reads **"Silver Surfer #1"** (decision.reason: "condition report says 'Silver Surfer #1' but structured title is 'Silversufer #1 5.0 Origin Of The Silversufer!'"). Probably a real Marvel *Silver Surfer #1 (1968)* mis-titled — an identity correction, not a delete. Contract REFUSED / `listable:false` (display $0, correctly blocked) **but stale `item.price="$625.00"` still stored**, `assetType='comic'`, `assetTypeConfident=true`. | H (contamination) / M (true identity) |
| `ggbndw` | Tagore "India" | `asset_category=book`, issue null, REFUSED, price null — correctly blocked from valuation. Routed `research`, still counted in the research bucket. | H |
| `56ezqc` | Tales from the Crypt (book) | `asset_category=book`, issue null, REFUSED. | H |
| `p5465e` | "Archie#258 , , ”Spin The Bottle Covers” … #271" | two issue numbers + punctuation in `title`; BLOCKED. | H |
| `mphyy3` | BATMAN SIX BIZARRE AVENTURES … G-24 #182 (1966) | **A7 applied:** year consistent with #181=1966; this is display normalization only (ALL-CAPS, "AVENTURES", format words in title). Owned asset `01a13cad…`; REFUSED `refused-tier-bypass-detected`. | H |
| `nq0r71` | ASM "11" #36 (2001) | **Not a defect** — ASM v2 #36 (9/11 issue). Distinct from `q9mz18` ASM Looter #36 (1966). Title digit `11` is the only issue. | M |
| `w9j0g9` / `f04ohb` | DKR #1 vs "batman the knight returns #1" | fuzzy duplicate pair (J=0.75); different grade/price. | candidate |
| `fk2koy` / `iget0u` | classic comics #13 vs Classics Illustrated #13 (1949) | name candidate only; different series numbering. `fk2koy` is un-enriched. | candidate |
| `3mkqnb`/`8tl5yq` | Star Wars Droids #1 (1986) / Star Wars #1 (1977) | NOT duplicates (J=0.6 false positive). | — |

**Invincible Returns #1 / Atom Eve Mike Mayhew #1 (both 2026), publisher null:** year not independently verifiable here → flagged *verify*.
**Publisher/year impossibility check (Image<1992, Dark Horse<1986, IDW<1999, BOOM<2005, Dynamite<2004, Valiant<1991, Warren<1964, Marvel<1939, DC<1934, year outside 1930–2026):** **zero hits.** Not clean — **49/290 rows have `publisher=null`** and 4 have no year, which this check cannot see.
**Variant field pollution:** 32 rows carry a `variant`; ≥10 are creator names/dates/series words, not variants ("John Broome", "Bernie Wrightson", "Ditko", "howard" ×2, "06/05", "9/11", "Klaus Janson", "Neil Gaiman" on Batman #457). Only the 4 `newsstand` values carry a multiplier (0.6/0.6/0.6/1.2); `Star Wars #1 (1977)` carries `variant="reprint"` yet `editionType=original`, `isReprint=false`, priced **$199.60** (`aa=REVIEW`) — a first-print/reprint class risk.
**Original vs reprint date:** only `Creepy #1` (`cv_1789788076290_f7u766`) is flagged (`polybag`, `editionType=reprint`, LOCKED, price null); no row carries `originalYear`/`printingYear` that conflicts with `year` beyond that.
**Key labels (22 distinct):** **every `keyIssue` is `keyIssueSource=claude`; none is ComicVine/GCD-verified.** Spot checks: *Flash #147 "First appearance of Reverse-Flash"* contradicts the public record (debut is Flash #139) — **M**; *"journey into mystery 1st thor #92"* — title claims "1st Thor" on #92 (Thor debuted #83) — **H** (self-contradictory); *Flash #118 "First appearance Pied Piper"* — Pied Piper debuted earlier — **M**. Others spot-checked consistent (ASM #24 Mysterio, Hulk #104 Rhino, FF #9, FF #21, Mister Miracle #2, Batman #666, Detective #275).
**Raw vs CGC grade conflicts (24 `isGraded` rows):**
- `grade` ≠ `numericGrade`: **Flash #120** (`tbv80g`, grade "VG 4.0", label 5.5) and **Terry-Toons #57** (`826ul0`, "GD+ 2.5" vs 5.5).
- **6 rows' `certNumber` holds prose, not a cert:** "visible on label" ×4, "visible on label but not fully legible in image", "not fully legible" (Conan #1, ASM #41, X-Men Annual #14, ASM #194, Witching Hour: Mordred #1, Amazing Adventures #1).
- **10 `isGraded=true` rows have no cert at all**; **0/24 `cgcVerified`** (CGC lookup is dormant by design).
- Out of the Shadows #12 / Tales to Astonish #67: `isGraded=true` but `governingIsGraded=false`, `gradeResolutionStatus=unresolved-grade-missing`.
**Duplicate candidate groups (exact normalized title + issue). Report only — distinct assets, NOT merged:**

| Group | Rows (`cv_…`) | Distinguishing facts |
|---|---|---|
| Creepy #1 | `…g4g1o0` · `…f7u766` | GD 2.0 original, price null, REVIEW · reprint/polybag, LOCKED. Different editions. |
| Marvel Spotlight #28 | `…5r83s6` · `…syvmbr` | VF 8.0 / VG 4.0, both 1976. Stored `item.price` identical $53.50, but `5r83s6` contract price is **$80.93** (stale string). |
| Brave & Bold #93 | `…bdyuem` · `…w2qzl2` | **year 1971 vs 1970** (one is wrong); VG 4.0 / GD 2.0. |
| Flash #120 | `…tbv80g` · `…b2i6e1` | CGC 5.5 slab (no cert) vs raw GD 2.0 — different physical copies; CGC row priced as raw (§5). |
| ASM Mary Jane #59 | `…q5er8g` · `…r3nmu2` | one `isGraded` cert 2170559 (price null), one raw `refused-tier-bypass-detected`. Both FN 6.0. |
| Batman: The Dark Knight #3 | `…8cbm3j` · `…pko7c5` | publisher "DC Comics"/"DC"; both LOCKED, no grade/price. |
| Howard the Duck #1 | `…1ppnhc` · `…gojwlq` | VG 4.0 (`variant="howard"` junk) vs VG+ 4.5; same price $27.92 (grade not differentiating). |
| + fuzzy | DKR #1 / "knight returns" #1; Giant-Size Super-Villain Team-Up #1 (`…h1d133`) / "…Doom #1" (`…n0a4c6`, J=0.86) | candidates only |
| **Not in a group but your list:** Classics #13 (above) | | |

**Owned physical-asset identifiers (B-8):** `collection_item_link` has **5 rows; only 3 resolve to a catalogue row** — OML #25, New Mutants #98, Batman G-24 #182. **2 links are orphans** (`20ee43bd…`, `6907420f…` → `generic` assets `01a0d075…`, `01a0d0e5…`; **0 matching `collection_item` rows**). **285/290 comics have no physical-asset id** (by design, pre-capture) — so the 96 LIST chips cannot publish today (§4). Kernel media: OML has **8 rows (FRONT/BACK/SPINE/PAGES/DETAIL role-tagged)** while its catalogue row has **1** image → catalogue readiness cannot see the durable photos (F-4). `inventory_current_state`: only OML + NM98 enrolled (AVAILABLE); Batman G-24 asset unenrolled.

## 3. Top-value records requiring manual confirmation (Section C)

Active asking evidence is shown separately and never treated as a sale. "newest" = days since newest *verified* sale.

| # | Record (row) | Display $ | Grade / authority | Slab cert | Sold evidence (verified / newest) | Asking evidence | Source | Specific missing evidence |
|---|---|---|---|---|---|---|---|---|
| 1 | The X-Men #1 1963 (`dboif8`) | 4,856.46 | GD 2.0 / model | – | **1 of 30** / n.s. | 3 asks, avg 11,288, hi 20,000 | `sold_active_blend_30` | ≥3 same-grade verified sales; edition (reprint/Golden Record) confirmation; grade confirmation. 0.6×1 sale + 0.4×3 asks. |
| 2 | Crime SuspenStories #22 (`wsf5ry`) | 4,691.11 | CGC 5.0 / model | **none** | 5 / **974 days** | 1 ask, 11,399.99 | `verified_sold_stale` | cert; sale <180d; **decision=LIST_LOW** on a 2.7-year-old sale (aa REVIEW) |
| 3 | Giant-Size X-Men #1 (`r18y0v`) | 2,500.00 | CGC 4.0 | 1688693 (unverified) | 14 / 3d | 15 asks avg 1,860 | `verified_sold_recency` **+ mega-key floor** | publisher null. **Floor origin (A6):** `priceBands.source=mega-key-floor`, `preFloorPrice=$1,329.50` from the 14 verified sales; floor from `api/mega-keys.js` (Heritage archive note) lifted it **+88%**. Pricing-math entry — **do not alter without per-entry greenlight**; confirm floor applies to CGC 4.0. |
| 4 | Ghost Rider #1 (`ut28pn`) | 1,084.26 | CGC 8.5 | 1610015 (unverified) | **0 / 0** | 23 asks, avg 1,276 | `active_ask_derived` | any completed sale |
| 5 | ASM #129 punisher (`vetcet`) | 927.80 | VG 4.0 | – | 1 / 50d | 6 asks | `sold_active_blend_30` | **contract LOCKED but value is counted**; title has "punisher" (mixed field) |
| 6 | Something Is Killing the Children #1 (`k46k16`) | 640.74 | CGC 9.6 | **none** | 8 / 2d | 7 asks | `verified_sold_recency` | cert only (best-evidenced record) |
| 7 | ASM #41 Rhino (`x3eog2`) | 575.77 | CGC 6.0 | **"visible on label but not fully legible"** | 16 / 33d | 12 asks | `sold_active_blend_30` | cert; **LIST_NOW / `cash_sale` with a placeholder cert** |
| 8 | ASM #11 (`e1zpfg`) | 556.75 | CGC 3.5 | 2199394063 | **0 / 0** | 4 asks | `active_ask_derived` | **READY / LIST_NOW / `cash_sale` with ZERO sold candidates** — the GK-238 class; sold evidence required. Either the GK-238 hotfix is not in the stored contract or not deployed in `6bc07c5`. |
| 9 | Incredible Hulk #180 (`th0r1m`) | 495.24 | CGC 4.0 | 4200112506 | 11 / n.s. | 12 asks | `sold_active_blend_30` | publisher null |
| 10 | The Silver Surfer #4 1969 (`gxekq6`) | 458.90 | GD 2.0 | – | 2 / 56d | 5 asks | `sold_active_blend_30` | thin sold |

Valuation computation = `pricingSource` + `priceNote` as stored (no pricing math re-run, no refresh). Confidence per row is the record's own `confidence`/`aa.state`; 9 of the top 10 are `aa=REVIEW/LOCKED` or sourced from asks/stale sales.
**A6 — identical $99.99:** not a default. `grep 99\.99 api/enrich.js src/lib/*.js` → no constant. Two unrelated rows: *Our Army at War #258* (`gd2jey`) priced `visual_pool_fallback` 99.99 (20 visually-similar *active* listings, bands 66.99 / 99.99 / 164.99, 0 comps); *Ghosts Nick Cardy #97* (`vpi16c`) `pc_estimate` $99.99 = a *single* active ask used as the "floor enforced" value (1 comp, 0 verified). Both are common eBay price points feeding a 0–1-listing source. Plus $99.95 (Vengeance of Bane, same 1-comp floor) and $99.51 (FF #16).
**A6 — raw comps on CGC records (7 rows):** Flash #120, Terry-Toons #57, Our Army at War #258 (`visual_pool_fallback`: raw/visually-similar active pool, no CGC awareness); Superman #38, ASM "11" #36, Hercules Unbound #2, Ghosts #97 (`pc_estimate`, 0–1 asks). **Flash #120 (CGC 5.5):** $60 vs the record's *own* `priceLadder` (CGC 5.0 $134, 6.0 $170, raw $37.46) — matches neither raw nor slab. **Hercules Unbound #2 (CGC 9.8):** `item.price="$92.13"` vs `contract.price=$11.50` (8× disagreement; tier-4 `pc_estimate`; `gradeMultiplier 1.375`); the dashboard counts $11.50. Multiplier tables are calibrated — flagged, not touched.

## 4. Publication safety (Section E) — `api/list-ebay.js@6bc07c5`

A LIST chip grants **no** publishing authority: the server never reads `bestChannel`. A single-item publish requires, in order, before any eBay call:
authenticated bearer (`@942` `validateOutcomeAttachment`: complete `gkAssetId`+`decisionEventId`+`operatorActionEventId` → real LIST action on an owned asset) · inventory/duplicate preflight (`@982` `assertListingAuthorized`) · server-side authority re-derivation (`@1110`, `ACTION_AUTHORITY_NOT_READY` @1124) · Q41 exact price binding (`@1231`) · last-mile hosted-photo validation (`@1162–1181`, `@1322–1345`, `PUBLISH_BLOCKED_NO_PHOTO`) · per-principal seller token · `GetUser` account check. Idempotency/reconciliation: outcome write + reconciler as documented (GK-203/221).
**Gaps (none exploited by current data):**
1. **~~Evidence is client-sent~~ — SUPERSEDED at `6bc07c5` (see Addendum).** This audit first read the checked-out `97c0397` tree. In the Production build (`6bc07c5`) authority evidence is server-sourced from the signed `authorityReceipt` (`src/lib/listingAuthorityEvidence.js`) and absent diagnostics fail closed; forged/omitted request evidence cannot reach READY.
2. **Photo sufficiency is "≥1 valid hosted photo"**, not "≥N durable role-tagged kernel photos". The dashboard's "PHOTOS NEEDED" is advisory only; nothing at the endpoint requires FRONT/BACK/SPINE/PAGES (GK-227 `physicalMediaChecklist` is not consulted).
3. **No identity/edition confirmation gate beyond `aa` state** — `editionConfirmed=false` on all 290 reviewed rows; edition is not a publish precondition.
4. **No server check that grade authority is confirmed** (`gradeAuthority`/`gradeLocked`); only OML has `OPERATOR_CONFIRMED`.
5. **Condition provenance for slabs:** placeholder certs (`"visible on label"`) pass; there is no cert-format check.
6. Bundle path disabled in Production only (`@741`); Development unaffected.
7. **Today 285/290 records are structurally unpublishable** (no linkage), so the 96 LIST chips overstate actionable inventory; of the 5 linked assets, 3 are catalogue-resolved, 0 are READY.

## 5. Grade / price / decision projection conflicts (Section D + F-5)

**Old Man Logan #25** (`cv_1790809927798_txjz5n`, asset `01a0bb24…`) — three grade sources, all preserved and distinct:

| Field | Value | Meaning |
|---|---|---|
| `grade` | **VF 8.0** | current automated estimate — **by design never overwritten** (`src/lib/gradeAuthority.js` `setOperatorGrade`: "never touches grade/isGraded/numericGrade") |
| `modelPredictedGrade` (+`At`, confidence high) | NM 9.2 @ 2026-10-01 | original AI prediction; `currentGradePrediction.via=GRADE_PROOF`, history `[]` |
| `operatorGrade` / `governing*` / `gradeAuthority` | **9.2**, `OPERATOR_CONFIRMED`, set 2026-10-16T03:55:49Z, `gradeLocked=true` | the authority |
| `priceNote` | "9.2 · 6 active asks (not sold-verified)" | **price is computed at the governing 9.2** |

**Verdict:** the card is a **stale display binding**, not a wrong pricing state. `$15.42` is current (`priceUpdatedAt` 2026-10-22T19:17:17Z, receipt `issuedAt` +1s, binds `collectionItemId`+`gkAssetId 01a0bb24…`+evidence version) and is the 9.2 price; **RESEARCH is a genuinely different, correct decision state** (`NO_SOLD_EVIDENCE`: 1 sold comp rejected, 0 verified; 6 asks; `contract.listable=false`). The card's grade chip reads `item.grade` (`@4107 gradeTxt`) rather than `resolveGoverningGrade(item)`; only the detail panel shows "Pricing uses 9.2" (`@8108`-region). Same binding is used at ~4 other render sites. Nothing is reset; no Q41/publish change.
**Latent receipt risk (memory: receipt-binding P0):** the stub `cv_1789846119473_xmrj3x` still exists under the mint-basis title "old man logan mike deodato"; the receipt binds the *rich* row, which is correct, but any consumer keying on mint-basis title would hit the stub.
**Other projection conflicts:** `item.price` ≠ `contract.price` on 2 rows (Marvel Spotlight `5r83s6` 53.50 vs 80.93; Hercules 92.13 vs 11.50); stale `item.price` on 1 REFUSED row (Palkia $625 vs display $0); `decision.action=LIST_LOW/LIST_NOW` while `aa=REVIEW` (Crime SuspenStories, Giant-Size X-Men #1, Hulk #180 → routed `research`, so decision and channel disagree on the card); F-5 rows; ASM #11 READY with 0 sold.

## 6. Root causes — file : line (`@6bc07c5` unless noted)

| # | Cause | Location |
|---|---|---|
| R1 | Unrouted items silently skipped | `src/App.jsx:771` (`if (!channel) continue`) in `getChannelMetrics` (`:747`) |
| R2 | Channel value predicate ≠ status value predicate | `:783` (`price > 0 && item.price != null`) vs `:685/:692/:696` |
| R3 | Channel router ignores `decision.action`/blockers (status BLOCKED ≠ channel `blocked`) | `getAuthoritativeChannel` `:733-744`; status uses `decision.action`/blockers in `getReadinessStatus` `:586` |
| R4 | Photo readiness reads catalogue images only | `getComicPhotos :945`, `:614`; kernel media ignored |
| R5 | `decisionSafe` = `aa.state==='READY'` only; ignores `contract.listable`/`state` | `:545` |
| R6 | "Liquid Value" label = Ready+Photos; no total / verified tile | `:3849-3851`, `:15334` |
| R7 | Card shows `item.grade`, not governing grade | `:4107` |
| R8 | Stub rows retained after relink; orphan links to deleted catalogue ids | `scripts/gk270-relink-collection-projection.mjs`; `collection_item_link` rows 1,2 |
| R9 | `certNumber` accepts free text | Vision/enrich merge (`certNumber: enrich.certNumber \|\| cur.certNumber`) |
| R10 | `visual_pool_fallback`/`pc_estimate` price graded copies from raw/ask pools | `api/enrich.js` pricing tiers (math — greenlight) |
| R11 | Stored `item.price` outlives a REFUSED/contract-superseding state | merge sites (`price: enrich.price \|\| cur.price`) |

## 7. Minimal proposed patches (NOT applied; code/data changes need your approval)

1. **R1:** `const channel = getAuthoritativeChannel(item) || 'unrouted'` + an `unrouted` metrics bucket and chip. Invariant: Σ routing = total.
2. **R2:** one shared `valueOf(item)` used by both metric functions.
3. **R3:** in `getAuthoritativeChannel`, `if (decision.action in {DO_NOT_LIST, ID_REQUIRED} || decision.blockers?.length) return 'blocked'` **before** the contract branch → `Archie #271` moves research→blocked (2 = 2). Defense-in-depth for a future DO_NOT_LIST+`cash_sale`.
4. **R5:** `decisionSafe = pass` only if `contract.listable !== false` (removes the 4 rows / $138.69).
5. **R6:** rename tile "Listable value (photo-gated)"; add "Total estimated value" and "Verified-sold-backed value".
6. **R7:** card chip = `resolveGoverningGrade(item).grade` + provenance badge; `grade` untouched.
7. **R4:** when `gkAssetId` linked, count photos from `physicalMediaChecklist` over kernel media (design first).
8. **R9:** validate `certNumber` as `^\d{6,10}$`; otherwise store `certNumberStatus:'unreadable'` and clear it.
9. **Data corrections (operator-confirmed only, one at a time, via the existing correction path — not scripted bulk):** years for `6q7j0u`, `d2gdy3`, `l21s0x`, `avj298`, `wixbzh`, `muz8ic`, `rzbgr1`, `b3qd77`; Palkia → verify Silver Surfer #1; delete/retire nothing without a ruling on the 2 stubs and 2 orphan links.

## 8. Regression tests required

- **A8 (proposed; needs R1 + a pure extraction of the metric functions into `src/lib/collectionMetrics.js` first — App.jsx is not importable):** for the real exported rows (and a synthetic set), every item has **exactly one** status and **exactly one** routing state, `Σ status == Σ routing == total`, and `Σ statusValue == Σ routingValue`. Currently **fails** (290 vs 289; $31,488 vs $31,463) — do not add to `tests/` until R1/R2 land (would red the stamped baseline).
- Router: a record with `DO_NOT_LIST` + `contract.bestChannel='cash_sale'` must route `blocked`.
- `decisionSafe` false for `aa=READY` + `listable:false`.
- Card grade chip equals `resolveGoverningGrade` for OPERATOR_CONFIRMED rows (OML fixture).
- `certNumber` placeholder rejected; graded row without cert is never `LIST_NOW`.
- Year-vs-issue monotonic check per series family as a *data-quality* lint (not a gate).
- Server list guard: placeholder cert / zero verified sold → `ACTION_AUTHORITY_NOT_READY` (extends GK-238/240 coverage).

## 9. GO / NO-GO

**NO-GO** for presenting any collection-level dashboard figure (Liquid $6,808, Total $31,488, 96 LIST) as actionable or financial truth, and **NO-GO** for widening publication beyond individually certified assets. **GO** to continue the five-gate sequence on the Gate B baseline: the single-asset publish path is fail-closed and was not weakened; OML #25's RESEARCH is correct; no Production data changed. Blockers to lift first: R1–R3 and R5–R7 (display/routing truthfulness), the 8 year corrections, ASM #11 (READY with zero sold), and the placeholder-cert LIST rows.

**Open / not verified:** client mechanism hiding the 2 stubs (inferred); phone-side photo counts (server shows 1 each); years marked **M**; true identity of Palkia/Origin II; GK-238 deployment state in `6bc07c5`.

## 10. Next Actions

1. **Router ignores `decision.action` and blocker state (latent, not a current LIST leak).**
   - *Reproduction:* Archie #258/#271 (`cv_1791861497562_p5465e`) is status **BLOCKED** (`decision.action=DO_NOT_LIST`, blockers `no-data-sources`) but is routed to **RESEARCH** in Channel Routing (so status BLOCKED = 2, routing blocked = 1).
   - *Root cause:* `getAuthoritativeChannel` (`src/App.jsx`, `@6bc07c5:733-744`) decides only from `contract.state` / `contract.listable` / `contract.bestChannel` (REFUSED/LOCKED → `research`); it never reads `decision.action` or `decision.blockers`, which `getReadinessStatus` (`:586`) does use. The two functions therefore define "blocked" differently.
   - *Why not a LIST leak today:* none of the 96 `cash_sale` rows has a blocker or a DO_NOT_LIST/ID_REQUIRED decision, and publishing never consults the channel (server re-derives authority).
   - *Proposed future regression invariant:* for every record, `status === BLOCKED  ⇒  routing ∈ {blocked}`, and no record with `DO_NOT_LIST`, `ID_REQUIRED`, or non-empty blockers may route to `cash_sale`/`bundle`/`grade`/`barter`. Fix (future, separately authorized): force `blocked` on those conditions before the contract branch.
   - *Status:* **deliberately NOT changed** in the collection-metrics patch (router logic is out of scope).

## 11. Addendum — dispatch pre-flight findings (2026-10-22)

- **Baseline topology.** Production = `6bc07c5` (= `origin/main`; Vercel `dpl_4DYMtVxhfezZHHEVYLyyUCppgzRK`, READY, created 2026-10-22T19:04Z). The checked-out local `main` (`97c0397`) is **diverged**: 4 local-only commits, 77 commits behind `origin/main`, merge-base `11f9481`. This audit's data came from Production; its code line numbers are `@6bc07c5`. The code patch was built on a branch off `6bc07c5`, not on `97c0397`.
- **GK-238.** `836f264` is an ancestor of `6bc07c5` (DEPLOYED). The protection is active: `deriveMarketStanding` still returns `NO_SOLD_EVIDENCE` for zero/zero-verified sold diagnostics; later commits (`56b2448` GK-240, `3170f37`, `062672a`, `5b97cc1`) strengthened rather than reverted it. `gk238-authority-truthfulness-hotfix` 48/48, `v1-gk240-listing-authority-fail-closed` 12/12, `v1-enrich-authority-receipt` 20/20, `gate-b-pricing-coherence-pure` 60/60 pass against a `6bc07c5` snapshot.
- **ASM #11 (`cv_1789951426949_e1zpfg`): SAFE (display misleading, no authority bypass).** The stored `READY/EXACT_CURRENT/LIST_NOW` was written 2026-09-21T00:43Z, ~21 h before GK-238 (2026-09-21 15:11 PDT) and never re-enriched. Re-deriving with `6bc07c5` code gives `REVIEW / NO_SOLD_EVIDENCE` for both the honest and a forged request. It has no `collection_item_link` and no operator action, so `validateOutcomeAttachment` (`list-ebay.js@6bc07c5:942`) rejects it before any provider call, and `ACTION_AUTHORITY_NOT_READY` (`:1124`) would follow. Exposure is exactly this one row (the only `cash_sale` row with zero verified sold comps).
- **OML #25 binding: PASS.** Canonical row `cv_1790809927798_txjz5n` ⇄ `gkAssetId 01a0bb24-c806-7a63-aa86-ce26fe8eed83` (sole link row). Receipt `evidenceVersion 08c87b24…` equals the SHA-256 of the asset's 8 current media hashes. The LIST action ($15.42), decision and valuation $15.42 (build `6bc07c5`) all carry this `gkAssetId`; `outcome_event` = 0 rows (nothing published). Stub rows are referenced only in append-only history (original link idempotency snapshots, `collection-item.linked` domain events, and the GK-226 valuation's `comp_snapshot_ref` string), never in the live link table; every guard resolves by `gkAssetId` / the link table. Residual (disclosed): the receipt HMAC signature was not verifiable (session secret not available locally); `valuation_event` 01a16505 has `grade_assumption=NULL` (the 9.2 lives on the canonical row and receipt); replaying the original capture's `:link` idempotency key would return the stub id (not used by any publication path).
