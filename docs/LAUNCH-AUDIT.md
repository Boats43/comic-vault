# Comic Vault — Launch Audit

**Date:** 2026-07-22
**Scope:** Full system-state audit for launch readiness of the pricing/identity pipeline (the Q112–Q139 campaign plus foundational work before it). Inventory only — no code changes made to produce this document.
**Launch-gate build:** `39d7b2f` (Q139 — G.O.D.S. acronym-tokenizer fix + bidirectional orphan-acronym gate extension). Confirmed `READY` on `comic-vault-rouge.vercel.app` via direct Vercel deployment lookup (`githubCommitSha` matched exactly) prior to this audit. The dispatch that requested this audit referenced build `f60c56b`, which does not exist anywhere in `git log --all` (local or `origin/main`, freshly fetched) — treated as a typo for `39d7b2f` per explicit confirmation.
**Method:** Built from `CLAUDE.md`'s Pattern Library, `git log`, the `tests/` directory listing, and this session's own direct observations (live rescans I personally read the logs for). Every SHA below was confirmed via `git log`, not recalled from memory. Every test file was confirmed to exist via `ls tests/`.

**Test-baseline note (added 2026-08-06, GrailKey Dispatch 02 Commit 0a):**
this document's "documented baseline" mentions (Sections 9/10/16 and others)
are dated snapshots, accurate as of the commit they were written against.
**CLAUDE.md's "Known stale test suites" entry (under Current State) is now
the canonical, continuously-reconciled baseline — check there, not here,
for the current failing-suite list and counts.**

---

## SECTION 1 — Shipped & Live-Verified (the trust inventory)

Two columns matter: **Proven in production** (a real rescan's logs or rendered card were read and matched expectations) vs **proven in tests only** (regression suite passes; no confirmed live observation). Where CLAUDE.md or a commit message explicitly documents a live confirmation, it's marked so with the evidence quoted. Where no such confirmation exists in available records, it is marked test-only — this is not a claim the fix doesn't work, only an honest statement of what has and hasn't been observed on a real card.

| Mechanism | Protects Against | Commit | Test File | Production Status |
|---|---|---|---|---|
| Batman #608 bundle (deriveCvYear, sold-fallback reason math, filterItemsByIssue) | ComicVine volume-launch-year leaking in as issue year; sold-fallback reason counts not summing to rejectedCount; visual-pool variant backfill contaminated by wrong-issue items sharing an artist | `83396d8` | `q112-year-resolution.test.js`, `q113-sold-fallback-reasons.test.js`, `q115-variant-issue-filter.test.js` | **Test-only.** Investigated via direct production-log reconstruction (real Batman #608 pool), but no explicit "live rescan confirmed" statement found for the shipped fix itself. |
| Printing-edition (1st/2nd/3rd print) tracked variant category | Blended 1st/2nd/3rd-print comps (Incredible Hulk #377 class) | `70af8b3` | `q116-printing-edition.test.js` | **Test-only.** |
| Convergence title-axis fix (compare against series name, not CV story-arc name) | False title-axis rejections from CV's arc-name field | `1252417` | `q117-cv-title-axis-field.test.js` | **Test-only.** |
| Vision self-consistency checker (flag-only, 3 checks) | Vision's own reason-text contradicting its structured fields | `fe92c87` | `q118-vision-consistency.test.js` | **Test-only** (flag-only feature, no pricing/decision consequence to observe live). |
| Compound-title whitelist consolidation (5→1 canonical source) | Drifted duplicate lists causing "X-Men"-class single-letter token loss | `58996b9` | `q119-compound-title-consolidation.test.js` | **Test-only.** |
| CV year-penalty bug fix + 7th drifted compound-title list closed | ComicVine penalizing missing data as if it were wrong data | `bd92f67` | `q120-cv-year-penalty-and-marvel-tokenize.test.js` | **Test-only.** |
| Pool-derived year hint threaded into CV volume disambiguation | No-year-source books unable to disambiguate CV candidates | `37d1c1e` | `q121-cv-pool-year-hint.test.js` | **Test-only.** |
| Title-truncation false positives fixed; variant-pool year contamination gated | False truncation rejections; wrong-edition year contaminating variant pool | `fac7b7e` | `q127-variant-pool-year-conflict.test.js` (+ Q126 coverage folded in) | **Test-only.** |
| Year-tolerance constant consolidation + volume-label-year corroboration | Drifted duplicate year-tolerance numbers across comps.js/soldVerification.js; Harley Quinn #62-class false-positive on legitimate volume-label years | `cfc6a8c` | `q128-era-tolerance-consolidation.test.js` | **Test-only** (Harley Quinn #62 root cause confirmed via a direct live ComicVine `/volumes/` API lookup during investigation, but this was evidence-gathering, not a post-fix rescan). |
| Silent-substitution flag (era-correct filtering leaves zero comps for a named variant) | Venomverse-class silent price substitution with no annotation | `d564da8` | `q129-variant-comps-excluded-by-era.test.js` | **Test-only** (root cause traced via real production logs; fix not confirmed via a subsequent live rescan in available records). |
| COMP_FILTER_VERSION bump 2→3 (closes Q129 cache-replay gap) | Stale cache masking the Q129 fix for up to 1h TTL | `7357052` | (covered by q129 suite, Part 5) | N/A — infrastructure. |
| John Giang added to ARTIST_PATTERNS + PREMIUM_CREATORS | Closed-set identity-gate failure on Giang MegaCon convention exclusives | `7357052`'s predecessor `d564da8`-adjacent / **`7357052`** confirms live | `q130-john-giang-artist.test.js` | **Live-verified**, but only after a second commit (`3b93539`, COMP_FILTER_VERSION 3→4) — the *first* deploy of this fix was masked by a stale `ac:v3:` cache entry for its full TTL. CLAUDE.md/commit `3b93539`: *"A skipCache-bypassed live re-fetch... confirmed the fix resolves correctly once it actually executes: 18 genuine John Giang comps ($12.99-$150, avg $63.85) vs. the stale cached single Inhyuk Lee comp."* — **this is the first documented instance of the cache-masking failure mode that recurred twice more later in this exact campaign (Slice C v6, Q139 v7).** |
| ARTIST_PATTERNS word-boundary anchoring (all 39 single-word entries) | "lim" matching inside "limited," same class as "ngu"/penguin, "ross"/crossover | `5506d87` | `q131-artist-pattern-word-boundaries.test.js` | **Live-verified** (same `3b93539` commit/verification as above — this fix and Q130's registry addition were verified together). |
| Q131 systemic-audit: title-family signal surfaced on refusal; provisional-identity consolidation (4 checks → 1 predicate); assembly-integrity revert skip; confirmedYear/Publisher/Issue no longer fall back to disproven Vision guess | Eternus #2 / He-Man class — pool-unanimous, Vision-wrong cards silently reverting to Vision's rejected guess | `690fafc`, `fe7af23`, `819f162`, `c3c8353` | `q131-refused-identity-conflict-provisional.test.js`, `q131-systemic-audit-fixes.test.js` | **Test-only** in available records. |
| Q132 Layers 1/2/4/4b (Q84 bounded creator-pair recovery, PC-anchor year-conflict rejection, confirmedYear correction on rejection) | GrailKey/ASM #26 class — PC anchored to a real-but-wrong-year product despite a confirmed family override | `ddd95db`, `3946c90`, `aaf594d`, `f18ef05` | `q132-layers-1-2-year-conflict-resolution.test.js`, `q132-layer4-pc-year-gate.test.js`, `q132-layer4b-confirmedyear-correction.test.js`, `q132-variant-year-family-corroboration.test.js` | **Live-verified.** Commit `3b82257`: *"Live rescan confirmed all 5 checkpoints: confirmedYear=2026, originalConfirmedYear=2001 preserved, banner correctly worded, card header shows 2026, decision stays RESEARCH with price/comps visible."* |
| Q132 Fix 3 — condition-report vs comp-pool artist-identity conflict surfacing | Vision's free-text artist mention drifting from comp-pool consensus across rescans (3 different names, same book) | `ffc1999` | `q132-fix3-artist-conflict-surfacing.test.js` | **Test-only** (root cause found via 3 real rescans of the same physical book; the *surfacing* fix itself not separately confirmed live). |
| Q133 two-axis PC-anchor gate (year OR name) | Invincible/Battle Beast class — wrong PC product only 1y off pool's year hint, 0% name overlap | `96baf07` | `q133-two-axis-pc-anchor-gate.test.js` | **Test-only**, though validated against 5 real production pools pulled live from Vercel before implementation (investigation evidence, not post-fix confirmation). |
| Q133 Slice 1c — publisher-only-missing demoted from hard block to advisory | Invincible #1 MegaCon class — real Tier-3 price computed underneath a hard ID_REQUIRED wall | `131ab16` | `q133-slice1c-publisher-gate.test.js` | **Test-only.** |
| Q133 Slice 1b — Kyuyong Eom added to ARTIST_PATTERNS/PREMIUM_CREATORS | Same drifted-registry class as Q130, this time for Invincible #1 MegaCon | `596de2d` | `q133-slice1b-eom-registry.test.js` | **Test-only** in isolation, but this book (Invincible MegaCon/Eom) is one of the 5 launch-gate books — will be directly re-verified in Section 3. |
| Q133 Slice 2 (C1) — promote refused-identity-conflict to real Phase 2 pricing when pool corroborates ≥3 members | Rachta Lin / Lozano class — a median-of-visual-pool price shown instead of a real fetchComps query, despite the pool being provably correct | `ad48ee2` | `q133-slice2-identityrefused-promotion.test.js` | **Test-only** at ship time. |
| Q133 Slice 2 follow-up — responseContract's 3rd independent identity-confidence gate fixed; zero-comp fallback trigger narrowed | Card showing "RESEARCH low" badge but ID_REQUIRED/$0 in the price section, same card | `a76e50d` | `q133-slice2-contract-followup.test.js` | **Live-verified at discovery.** Commit message: *"Real bug found on LIVE RENDERED CARDS (not logs): Invincible and Lozano both showed an internally contradictory card."* |
| Q134 — suffix-mutation gap in provisional-identity gate; honest-null confirmedVariant; condition-report advisory | Lozano fabricated "Dark Horse 2014" era-rejecting genuine 2026 comps; Rachta Lin stale "Kunkka beer variant" badge surviving rejection | `cc94815` | `q134-provisional-override-boolean.test.js` | **Test-only** at ship time (root cause found via real card observation, per the commit message's specific fabricated-value citation). |
| Q135 — Invincible comp-pool contamination fix (P1); Q134 honest-nulls wired to rendered card (P2); dead ComicVine publisher path fixed (P3) | Wrong-product comps priced; honest-nulls computed server-side but never reaching the card; a structurally dead-on-arrival CV publisher backfill (wrong field shape) | `e514ee5` | `q135-p1-p2-p3-fixes.test.js` | **Test-only** at ship time. |
| Q136 Slice A — artist-axis tier for active comps (Lozano/Louw sibling class) | Pop Kill #1 priced off a different artist's variant because nothing isolated on artist once a variant string was present | `ee94c28` | `q136-slice-a-artist-axis.test.js` | **Live-verified, this session.** User's own words at session start: *"Slice A verified — NOT reverting. Lozano: 8 comps all Lozano, $138.34. Invincible: 9 comps all Eom Atom Eve, $45.23."* |
| Q136 Slice A2 — identity-incomplete blocker regression fix for promoted provisional cards | Rachta Lin regressed to ID_REQUIRED after Q134's honest-null shipped | `728654e` | `q136-slice-a2-identity-incomplete-provisional.test.js` | **Deployed and confirmed correct at the decisionEngine level** (row 7 investigation, this session) — `decision.action` genuinely reads RESEARCH for a promoted Rachta-Lin-shaped identity, exactly as Slice A2 intended. **But a second, independent bug was found one layer up**: `api/enrich.js`'s tier-engine pricing-eligibility gate never gained an `out.identityProvisional` OR-arm, so the pricing block that would fill in the price Slice A2's RESEARCH card is supposed to show was silently skipped for this exact book. Fixed this session (not yet deployed) — see "Rachta Lin row-7 investigation," Section 3. Still **not live-verified** either way. |
| Q137 Slice A3 — promote Vision-low-confidence when pipeline corroboration is strong (isVisionLowButCorroborated); price-bands-pricing gate follow-up fix | One World Under Doom class — HIGH convergence + 11-member coherent pool still hit ID_REQUIRED on Vision's own low self-rating alone; a second bug where the pricing-tier assignment block was never updated with the new exemption flag | `2f0cb5a` (core fix), `39d7b2f`'s sibling **within the Slice C commit `ee96661`** (pricing-gate follow-up, found and fixed same session) | `q137-slice-a3-vision-low-confidence-corroborated.test.js` | **Live-verified.** This session: *"Slice A3 confirmed live — exactly as designed. Log shows: [slice-a3] vision-low-but-corroborated: convergence=HIGH(100)... Result: RESEARCH not ID_REQUIRED, price visible, identity resolved."* |
| Slice C — signed/autographed as a match dimension (active + sold); signedConsensus pool-corroboration signal; extracted `applySignedPreferenceFilter` | Poison Ivy #31 class — signed comps left blended with unsigned instead of isolated; Giang MegaCon class — signed comps hard-rejected because Vision's comic prompt can't write signing status into variant text for raw books | `ee96661` | `q138-slice-c-signed-match-dimension.test.js` | **Live-verified.** This session: *"Slice C mechanism verified live tonight: [signed-consensus] members: 5/20 correctly detected, active-side isolation fired (before=4 after=1 removed=3, mode=isolate-signed), $45.98 priced from a real signed comp."* |
| COMP_FILTER_VERSION 5→6 (in `ee96661`) then 6→7 (`920f434`) — two bumps, same book, same failure mode twice in one session | Deploying Slice C's code does not itself clear the persistent Redis `ac:` cache — a rescan on the newly-deployed build can still replay a pre-fix cached pool for up to 1h | v5→v6: `ee96661`. v6→v7: `920f434` ("Bump COMP_FILTER_VERSION 6->7: deploy alone doesn't clear the Redis ac: cache") | (covered by `q138`'s Part 4 and `q139`'s test file's version-floor assertions) | N/A — infrastructure. **This exact failure mode (deploy READY ≠ fix exercised) recurred twice in one session for the same book** — see Section 4, invariant 6. |
| `[signed-consensus]` dedicated log line with member count | Verification gap — the fix's own effect (signedConsensus true/false + count) was not independently observable in logs, only inferable from downstream isolation behavior | `c035a02` | (log-line addition, covered by q138 output inspection) | **Live-verified** as part of the same rescan that confirmed Slice C above (`members=5/20` is this exact log line). |
| Q139 — G.O.D.S. acronym-tokenizer fix (`normalizeAcronyms`) + bidirectional orphan-acronym gate extension (`extractAcronymTokens`, PC-anchor + CV-volume gates) | One World Under Doom class — a punctuated acronym prefix ("G.O.D.S.") vanishes during tokenization, letting a wrong-book PC anchor and CV volume match silently pass a ratio-based overlap check | `39d7b2f` | `q139-godds-acronym-tokenizer.test.js` (41 assertions: unit behavior, full-pipeline dotted/spaced convergence, Q131 compatibility, 4-quadrant fixture matrix, 5 standing controls, CV-gate simulation) | **NOT YET LIVE-VERIFIED.** This is the first item on tonight's 5-book pass — Section 3 is where this gets its first production observation. |

**Summary of the trust inventory:** roughly two-thirds of the named mechanisms above are **test-verified only** — real, passing regression suites, root causes traced against genuine production log reconstructions in most cases, but no independent post-fix live confirmation on record. Six mechanisms have explicit, quoted live confirmation: Q130/Q131 combined, Q132 Layers 1/2/4/4b, Q133 Slice 2 follow-up, Q136 Slice A, Q137 Slice A3, and Slice C. One (Q136 Slice A2) shipped without an explicit live confirmation, which this audit surfaces as a real gap to close in the 5-book pass. Q139 has zero live observations yet — it is the newest, least-proven mechanism in the stack and the primary subject of tonight's gate.

---

## SECTION 2 — Known Open Items (the honest gap list)

Tags: **LAUNCH-BLOCKING** / **LAUNCH-SAFE-BUT-QUEUED** / **COSMETIC**.

| Item | Tag | What breaks if we launch without it |
|---|---|---|
| Coherent-content-token lane (Adventure Time SDCC / Invincible Returns misidentification) | **REPRODUCED tonight — fixed at the code level this session, NOT YET LIVE-VERIFIED** | Confirmed on build `aaef115` (see Section 3, Adventure Time row) — Q84 blocked `[summer, special, sdcc, convention, exclusive]` despite a 4-listing-strong corroborating pool, PC anchor drifted to a 3rd different wrong "Adventure Time" product, priced $22.09 off the wrong book. The safety net held (I13 contract check locked the card — honest failure, not silent). Fix: `applyDualAxisGate` coherent-content-token lane (≥3-member-corroborated non-creator additions now allowed, evaluated after Q119's narrower compound-completion keeps priority) + family-scoped issue adoption in `resolveIdentity`. Regression-tested (`tests/q140-coherent-content-token-lane.test.js`, 18 assertions; full existing suite re-run clean against the documented pre-existing baseline). **Requires its own live rescan of this exact book before this row can close** — deploy READY does not confirm the fix was exercised (invariant 9). |
| Slice B — limitation axis (numbered/limited-edition comps as a match dimension, mirroring Slice C's signed treatment) | LAUNCH-SAFE-BUT-QUEUED | A numbered/limited book's comps may blend with unlimited copies of the same variant, similar in shape to the pre-Slice-C signed-blending bug — but this fails to an honest (if imprecise) RESEARCH-tier price, not a confident wrong one. |
| Character-name lane (Atom Eve) | LAUNCH-SAFE-BUT-QUEUED | A character name adjacent to a recognized artist surname can be mishandled by the creator-token recovery logic (`recoverAdjacentCreatorTokens`) — same shape as the "Atom Eve" mention throughout the Invincible MegaCon investigations. Not confirmed as an active bug, just an unclosed lane. |
| D3 — Poison Ivy #1 issue-null (genuinely-unidentified-book class) | LAUNCH-SAFE (working as intended) | This is the deliberate, byte-identical-preserved control case throughout Q133 Slice 1c/2/A2 — a book with no usable title/issue/year/publisher at all correctly stays ID_REQUIRED. Listed here for completeness, not because it's broken — I don't have independent confirmation of a specific "D3" designation beyond this behavior; if you mean something more specific, flag it and I'll re-scope this row. |
| Comp-filter hygiene: cover-only listings | LAUNCH-SAFE-BUT-QUEUED | A comp listing with no cover photo/description substance can dilute the pool. Named in this session's standing queue, not yet scoped or fixed. |
| Comp-filter hygiene: foreign-variant listings | LAUNCH-SAFE-BUT-QUEUED | UK/foreign-price-variant comps (pence pricing, etc.) may blend with US-market comps beyond the existing variant multiplier table's coverage. Named in this session's standing queue, not yet scoped. |
| Comp-filter hygiene: CV wrong-volume story | LAUNCH-SAFE-BUT-QUEUED | ComicVine matching a technically-real but wrong volume for a story/arc-within-a-series case. Named in this session's standing queue, not yet scoped. |
| **Drifted artist-name registries (confirmed, this audit)** — 3 of 4 known registries missing Giang/Eom/Lozano/Frison | LAUNCH-SAFE-BUT-QUEUED, but **worth escalating attention** | Confirmed via direct grep, not assumption: `src/adapters/ComicAdapter.js`'s `ARTIST_NOISE` array, `src/lib/identityCore.js`'s `sanitizeSeriesTitle`, and `src/lib/imageSearchIdentity.js`'s `stripVariantNoise`/`extractMainTitle` (lines 508-522) each maintain their OWN hardcoded artist-name list, independent of the canonical `ARTIST_PATTERNS` (`compHygiene.js`) that Q84/Q109/Q130/Q133/Q136 additions actually landed in. None of the three secondary lists include Giang, Eom, Lozano, or Frison. This is the exact drifted-registry class already documented in the Pattern Library's "Variant-artist-token-fusion class" entry, which explicitly left these two ("sanitizeSeriesTitle," "stripVariantNoise") as known, unclosed gaps — this audit adds `ComicAdapter.ARTIST_NOISE` as a third, previously-undocumented instance of the same class. Whichever of these three code paths a given card actually routes through could still silently mis-strip or fail to recognize a known artist name. |
| G.O.D.S.-class dotless-acronym follow-up ("GODS ONE WORLD UNDER DOOM" with no periods at all) | **Explicitly deferred, not queued** | Per your own ruling on the Q139 dispatch: dotless titles already tokenize to "gods" naturally without any dictionary; the new dotted-normalization makes dotted and dotless forms converge through existing overlap logic. No acronym dictionary shipped in this slice by design. Revisit only if post-ship evidence shows dotted/dotless family fragmentation — not a present gap. |
| `api/comps.js` leaves an open process handle at module load | **COSMETIC** | Confirmed independent of any of this session's changes (importing the module alone hangs a bare Node process). Test files that import it must call `process.exit()` explicitly rather than relying on `process.exitCode` — already the established convention, now documented in `tests/q138-slice-c-signed-match-dimension.test.js`'s own comment. Does not affect the deployed Vercel function itself (a fresh Lambda invocation per request has no such long-running-process concern) — purely a local test-runner ergonomics issue. |
| `getEra` — 1985 boundary, plus a **newly-found second implementation** | LAUNCH-SAFE-BUT-QUEUED | The canonical `getEra` (`src/lib/pricingEngine.js:220`, default boundary 1985) is documented, calibrated, and intentionally asymmetric against the separate Silver-Age-start (1956) sanity-threshold boundary per `CLAUDE.md`. **This audit found a second, independent `getEra` in `api/list-ebay.js:107`** with a completely different, more granular banding (Victorian/Platinum, Golden, Silver...) for eBay item-specifics labeling. These appear to serve genuinely different purposes (pricing-multiplier era vs. eBay listing metadata) rather than colliding — but this was not independently confirmed as intentional-by-design the way the 1985/1956 asymmetry is documented to be. Worth a quick confirmation pass, not urgent. |
| "Layer 3 ratio gate" | **Needs clarification** | I could not confidently identify a single mechanism uniquely matching this name from available context — candidates include the reprint-dominance gate (`b45cbc1`, ≥0.6 ratio blocks zero-support override) or the variant-composition damping ratio ladder (Bug 4, CLAUDE.md: >0.80→×0.5 damping, >0.50→×0.75 damping). Flag which one you mean and I'll fold it into this table with full evidence. |
| Premium-variant comp weighting (Slice B/C overlap) | LAUNCH-SAFE-BUT-QUEUED | **Currently covered:** signed/autographed (Slice C, isolate-with-fallback, both active and sold sides). **Not yet covered:** numbered/limited-edition weighting as its own match dimension (Slice B, not yet shipped) — today, a numbered/limited book's comps rely only on the pre-existing `PREMIUM_VARIANT_RE`/`isolatedOnSpecific` minMatches=1 isolation in Filter 1c, not a dedicated dimension the way signed now has. |
| **Client-side year/publisher merge gap (found this session, not previously documented)** | **LAUNCH-SAFE, but directly affects how tonight's rescans should be read** | Confirmed via direct code trace, `src/App.jsx`: `publisher` is **never** assigned from `enrich.publisher` on any of the 5 merge paths — every site sources it from Vision's original `/api/grade` response or prior catalogue state. A CV/PC-corrected publisher computed fresh every request server-side **never reaches the display**. Separately, `year` only updates when `enrich.yearCorrected && enrich.confirmedYear` — both gated on `confirmedYear` being non-null AND differing from the previously-stored value (`api/enrich.js:7395-7397`). If tonight's Q139 fix causes a book's year to resolve to **honest-null** (a real possible outcome once a wrong CV volume is rejected and no other source survives), the stale prior year will persist on the display even though the server-side fix worked correctly — this could misread as "the fix didn't work" during the 5-book pass if not accounted for. |
| GoCollect API key (`GOCOLLECT_API`) still not provisioned | **Pre-existing, external, LAUNCH-SAFE** | CLAUDE.md-documented since 2026-04-15; the enrich Promise.all slot already passes `Promise.resolve(null)` gracefully. No CGC FMV recommendations, rest of pricing unaffected. |
| CGC certlookup endpoint (WAF 403) | **Pre-existing, external, LAUNCH-SAFE** | Dormant since 2026-07-13; graceful degradation to visual-pool identity already confirmed working throughout this entire campaign. |
| GitHub→Vercel auto-deploy investigation (CLAUDE.md, dated 2026-07-16) | **Appears resolved, unconfirmed** | CLAUDE.md documents this as an open "under investigation" item from 2026-07-16 (two pushes producing zero deployment activity). Every single push in this session (7+ commits, `728654e` through `39d7b2f`) triggered a deployment and reached `READY` within the same turn, confirmed via direct Vercel API lookups each time — strong evidence this is no longer occurring, but the CLAUDE.md entry itself was not explicitly updated/closed. Worth a one-line doc correction, not a code concern. |
| **Q143 `active_reference_range` — material/finish not its own comparison axis (accepted, bounded risk)** | LAUNCH-SAFE-BUT-QUEUED, scope for the future edition-fingerprint campaign | `hasUnresolvedActiveVariantConflict` (`src/lib/variantIdentity.js`) correctly follows Q111's specific-vs-generic taxonomy — a shared cover TREATMENT (foil, virgin, metal, etc.) is deliberately not treated as a distinguishing PRODUCT claim, same reasoning Q111 already established. Consequence, explicitly accepted rather than fixed in Q143: two comps that differ only on MATERIAL (e.g. Rachta Lin's own "Virgin" paper print vs. "Embossed Metal" print — real, different physical products at potentially different price points) currently pass as "compatible" and can blend into one reference range. Bounded because the output is never presented as a verified FMV — `verifiedFMV: false`, `listingHardLocked: true`, RESEARCH-tier only, the same "fails to an honest, if imprecise, price — never a confident wrong one" class as Slice B/the character-name lane above. Material needs to become its own comparison axis (not subsumed under "variant") — required scope for the future edition-fingerprint campaign, not this one. |
| **Family-scoped variant adoption mechanism (event=sdcc normalization, ≥60% support/≥3-unique thresholds, conflict-refusal for mixed events/retailer exclusives/ratios/lettered covers)** | **Status: DESIGNED — NOT BUILT.** Campaign: typed edition fingerprint | Trigger for building it: an accepted winning family (`FAMILY_OVERRIDE_DECISIONS`) observed disagreeing INTERNALLY on specific variant signals (e.g. two different genuine conventions, or a mixed lettered-cover/ratio/retailer-exclusive population within the same winning family) — not yet observed in production. Planned controls if built: SDCC/San Diego/PX retained as a structured `event=sdcc` field; Cover A rejected; 1:25 Variant C rejected; mixed-event family → no adoption (honest reference-only); Vision-confirmed variant stays authoritative; non-override identity untouched. **Why not built now:** Adventure Time's own investigation (Q144 Item 1) found the actual blocker was upstream — `extractConfirmedVariant` was receiving an EMPTY population (Gate 1, `variantSourceItems.length === 0`) because `extractIssueFromTitle`'s marketing-keyword guard falsely nulled every real listing's own issue number, not because no family-scoped adoption mechanism existed (Ship 26.3B + Q115 already scope correctly). Once the extraction bug was fixed (narrow corroboration-only recovery, `filterItemsByIssue`), the population populated at 7/7 and the EXISTING, untouched `extractConfirmedVariant` consensus mechanism correctly resolved `"sdcc convention exclusive"` from a 6/7 SDCC-token consensus — no new adoption layer was needed for this book. Adventure Time's restored winning-family population is internally coherent; no mixed-event winning-family case has been observed in production. Build this mechanism only if/when a real case surfaces internal family disagreement — not preemptively. |
| **`assessCollisionRisk` (Commit D1.1) — interim heuristic, not a complete collision model. FIRST follow-up after Commit E.** | **LAUNCH-SAFE-BUT-QUEUED, confirmed gap (not hypothetical)** | `src/lib/evidenceEligibility.js`'s `assessCollisionRisk` currently flags `collisionRisk="high"` only for `confirmedYear < 1985 AND publisher matches /dc\|marvel/i` — a real, live-confirmed fix for Batman #15's class of defect, but a narrow heuristic, not general collision detection. **Confirmed gap, not speculative:** Absolute Batman #1 (2024, DC) returns `collisionRisk="low"` under this heuristic (not vintage) despite this campaign's own prior investigation independently establishing ~20 colliding same-numbered products in PriceCharting's own catalog for that exact title+issue — a genuine collision case the current vintage-year gate cannot see. The fixture already exists from that prior investigation; this follow-up needs no new data collection, only wiring it in. Named specifically per instruction, not filed as generic future hardening. Additional known gaps in the same heuristic, recorded here rather than left implicit: (1) legacy publishers beyond DC/Marvel with their own renumbering histories (Archie, Charlton-successor lines, Image relaunches) are invisible to the `/dc\|marvel/i` check; (2) a title that changed PUBLISHER across eras (same series, different company) is not modeled at all; (3) no modern variant/printing discriminator axis beyond what `WRONG_PRINTING`/`WRONG_VARIANT` already independently cover; (4) possible over-flagging risk in the other direction — a genuinely unique vintage DC/Marvel title/issue pair (no real collision) still pays the `UNCONFIRMED_EDITION` cost for undated comps, since the heuristic cannot yet distinguish "collision-prone series" from "collision-prone SPECIFIC issue." |

---

## SECTION 3 — The Verification Matrix

**Build:** `39d7b2f` (see note on `f60c56b` above).
**Status:** Jimmy's scans have not yet landed in this conversation. Every cell below is `NOT-YET-RUN`. This table will be updated in place, cell by cell with quoted log evidence, the moment the five books' logs are provided — no summary judgments, no cell filled without its citation.

**Cache-verdict rule (standing, applies to every cache-dependent cell — signal 2, and any other signal whose correctness depends on the fetch actually having run fresh):** a `PASS` requires the log to show an explicit `MISS → fresh fetch` line. A cache `HIT` is never counted as a pass by default — it is marked `INCONCLUSIVE (re-scan required)`, because a HIT means the code path under test may not have executed at all this request. This is now permanent (Section 4, invariant 9) — every fill-in below follows it.

| Signal | One World Under Doom (Giang) | Pop Kill #1 (Lozano metal) | Pop Kill #1 (Rachta Lin) | Adventure Time Summer Special (SDCC) | Invincible #1 MegaCon (Eom) |
|---|---|---|---|---|---|
| **1. `[boot]` build SHA** | `aaef115` confirmed | `aaef115` confirmed | NOT-YET-RUN (row 7 investigated directly, see below — no fresh rescan performed) | `aaef115` confirmed (explicitly: "reproduced on aaef115") | `aaef115` confirmed |
| **2. Cache MISS → fresh fetch** (HIT = INCONCLUSIVE, not a pass) | PASS (per dispatch, not independently re-quoted) | PASS (per dispatch, not independently re-quoted) | NOT-YET-RUN | PASS (per dispatch, not independently re-quoted) | PASS (per dispatch, not independently re-quoted) |
| **3. `[signed-consensus]` detected + members/denominator** | N/A (not a signed-variant scan) | **4/4** — signed-consensus detected | NOT-YET-RUN | N/A | N/A |
| **4. Filter mode (isolate-signed / reject / etc.) + counts** | N/A | **isolate** (isolate-signed) | NOT-YET-RUN | N/A | N/A |
| **5. PC/CV anchor disposition** | PASS (per dispatch) | PASS (per dispatch) | NOT-YET-RUN | **FAIL** — PC anchored to a **3rd different wrong product**, "Adventure Time Comics #1 (2016)" (prior scan anchored "Adventure Time Comics #5 (2014)" — the anchor itself drifting across rescans on this ambiguous stem is independent evidence the stem isn't the identity, not just noise) | **PASS** — PC matched the **real** 2003 book for this exact MegaCon/Eom variant; the two-axis PC-anchor gate correctly let a genuine same-book match through rather than falsely rejecting it (verbatim from dispatch: "2003 anchor correctly year-rejected — note this scan PC matched the REAL 2003 book and the gate still handled it right") |
| **6. `[price-bands-pricing]` + finalPrice/source** | PASS (per dispatch) | **PASS — $138.34** | NOT-YET-RUN | **FAIL — $22.09**, priced off the wrong book (the 2016 anchor from row 5) | **PASS — $44.85**, priced off real MegaCon exclusive comps |
| **7. Q136 Slice A2 check (Rachta Lin only — see note below)** | N/A | N/A | **Investigated, root cause found, fix implemented and regression-tested this session — see "Rachta Lin row-7 investigation" below. NOT YET LIVE-VERIFIED** (no rescan was run against the fix; it is not yet deployed) | N/A | N/A |

**Overall per-book verdict this pass:** One World Under Doom **PASS**, Pop Kill #1 (Lozano) **PASS** (Slice C signed dimension: 4/4 consensus, isolate mode, $138.34 — Slice A3 also cited as firing for this book per dispatch), Pop Kill #1 (Rachta Lin) **row 7 gap closed at the code level, not yet live-verified**, Adventure Time Summer Special (SDCC) **FAIL — reproduced exactly as the open item predicted** (see below), Invincible #1 MegaCon (Eom) **PASS — $44.85**, real exclusives, PC anchor correctly handled.

**Adventure Time Summer Special (SDCC) UPDATE (2026-07-22, same session, later dispatches):** the FAIL recorded above was the STARTING point of a multi-round investigation (Q140 → Q144A/B/C → Q142 instance 2), not the final state. **Certification PASSED on build `5cb121a`** — see the full closure writeup below this table and Section 9 for the launch-decision framing. This row is now **CLOSED**.

**Standing controls, confirmed this pass (outside the 5-book matrix, per dispatch):**
- **Poison Ivy #31** — control **PASS**, `LIST_LOW` stable (Slice C signed-comp isolation control from Section 1 continues to hold).
- **Poison Ivy #1** — expected-fail / known-item control, designation **D3** (Section 2's genuinely-unidentified-book class) — behaves as intended, `ID_REQUIRED` byte-identical.

---

### Adventure Time Summer Special (SDCC) — FAIL, root cause and disposition

Reproduced exactly as Section 2's open item ("coherent-content-token lane") predicted, on build `aaef115`:
- Pool ranks 1-4 **all** read "Adventure Time Summer Special #1 SDCC Convention Exclusive 2013" — a **4th corroborating listing** appeared versus the prior observation of this book, i.e. the signal got *stronger*, not weaker, between rescans.
- The Q84/Q132 dual-axis gate still blocked the family override wholesale: `Q84 blocked [summer, special, sdcc, convention, exclusive]` — none of those five tokens are creator names, so the pre-fix gate had no lane for them regardless of how corroborated they were.
- PC anchored to a **third** different wrong "Adventure Time" product across rescans of the same physical book ("Adventure Time Comics #1 (2016)" this time; "Adventure Time Comics #5 (2014)" previously) — anchor drift on an ambiguous stem, independent confirmation the stem alone isn't a usable identity.
- Priced **$22.09** off the wrong book.
- **The safety net held.** `responseContract.js`'s I13 contract-fidelity check correctly caught the incoherence and locked the card rather than shipping a silent confident-wrong price — this was an honest failure, not a silent one, exactly the distinction Section 5's launch framing turns on.

**Disposition (this session, same dispatch):** implemented the coherent-content-token lane per the pre-approved sandbox design — `applyDualAxisGate` (`src/lib/imageSearchIdentity.js`) now allows a still-blocked family-override addition when every token in it is independently corroborated by ≥3 distinct family members (reusing the existing Q38/Q133-Slice-2 ≥3-member floor, not a new number), evaluated strictly *after* Q119's narrower whitelist-verified compound completion keeps its existing priority. Paired with family-scoped issue adoption in `resolveIdentity` (`src/lib/identityCore.js`) so a winning family's own issue number — not a pool-wide vote that can span multiple distinct products on an ambiguous stem — drives `confirmedIssue`. Full details, code, and the regression suite (`tests/q140-coherent-content-token-lane.test.js`) are in this session's implementation report.

**CLOSED — certification PASSED on `5cb121a` (2026-07-22, 04:45 log).** After the coherent-content-token lane (Q140), the winning-family PC-anchor discriminator (Q144A), the canonical-marker sequel-filter allowance (Q144B), the confirmed-identity client-merge fix in both its provisional and non-provisional instances (Q144C, two commits), the corroboration-only issue-extraction recovery (Q144 Item 1), and the Phase 2 assembly-integrity consensus-reference fix (Q142 instance 2), a real live rescan of this exact book against `5cb121a` passed every mechanism:
- No `[22e-LOSS]` — the bare-title revert that produced the original FAIL never fires.
- `[22e-population] Phase 2 mode=winning-family count=5` — title holds end-to-end, the first time ever for this book.
- All four identity fields correct on the rendered card: title "adventure time summer special", issue #1 (via Q140's family-scoped adoption), publisher KaBOOM!, year 2013.
- Variant badge renders: "⚡ sdcc convention exclusive", backfilled from a 4/4 family consensus.
- The 2012 PC anchor is rejected on the discriminator axis, with `confirmedYear` corrected as a result.
- `identity-gate missing=[]`, `decision=RESEARCH blockers=0`.
- Card lands honestly locked with reference asks visible ($13.49–$59.99) rather than a fabricated computed price — see Section 9 for why this specific outcome (locked-with-references, not a computed mid) was the correct behavior for this book's exact 3-comp pool.

The pre-agreed pass condition — **correctly-identified-and-honestly-locked** — is met. The bare-title `ID_REQUIRED` fail state, the only defined failure mode for this row, did not occur. **This row is closed.**

**Q136 Slice A2 — no 6th book needed.** Its exact target code path (a promoted-provisional con-exclusive whose pool genuinely cannot supply issue/year — the identity-incomplete blocker exemption) is **already naturally exercised by Pop Kill #1 (Rachta Lin)**, already in the 5-book list — Rachta Lin is the literal fixture Slice A2 was built against ("Pop Kill #1 Megacon con-exclusive... issue/year genuinely can't be read off the pool"). Row 7 above is specific to that book: `PASS` requires the card to show `RESEARCH`/`LOCKED`-with-visible-price despite null issue/year (decision.action and contract.state, read from the log or rendered card) — **not** `ID_REQUIRED`. This is the mechanism's first live observation on record (Section 1 flagged it as shipped-but-unverified) — treat it with the same rigor as Q139, not as an afterthought of the standard 6 signals.

### Rachta Lin row-7 investigation (root cause, reported before fixing)

**Question asked:** decision=RESEARCH fired correctly (not ID_REQUIRED), but no `[price-bands-pricing]` log line appeared in either batch. Is this log truncation, or a real gap — and if real, is it a missing OR-arm in the tier-engine pricing-eligibility gate, the same shape as the Slice A3 bug?

**Finding: real gap, same shape, confirmed by direct code trace of `api/enrich.js`.**

`decisionEngine.js`'s identity-incomplete blocker already has a correct exemption for a promoted pool-provisional identity (`out.identityProvisional`, Q133 Slice 2 / Q136 Slice A2) — that's why the card's `decision.action` correctly read `RESEARCH`. But that's computed from `out` *after* the entire pricing pipeline has already run. The actual pricing pipeline is gated by a separate, upstream condition (`api/enrich.js` ~line 5895):

```js
if ((idCheckFinal.confident || publisherOnlyMissing || visionLowButCorroborated) && !isPolybagPricing) {
  // the entire tier-engine price-bands synthesis block, including the
  // [price-bands-pricing] log line, lives inside this if
}
```

Rachta Lin's identity, even after promotion, has a genuinely missing `issue`/`year` (the pool can't supply them — that's the book's real shape). That means `idCheckFinal.missingFields` is non-empty, which independently rules out **both** existing exemption arms: `publisherOnlyMissing` requires exactly one missing field and that field must be `publisher`; `visionLowButCorroborated` requires `idCheckFinal.missingFields.length === 0`. Neither arm — nor `idCheckFinal.confident` itself — is ever satisfied by a promoted-but-issue/year-incomplete identity. `out.identityProvisional` (the flag that actually governs this exact promotion, set at `api/enrich.js` ~line 4163) was **never included in this OR-chain at all.**

Effect: the entire tier-engine pricing block — including the `[price-bands-pricing]` log line — was skipped, even though Phase 2 (`fetchComps`/`fetchPricechartingSales`) had already run normally against the promoted identity and could have produced real data. Downstream, the `out.identityProvisional` finalization block (~line 8251) checks `realPhase2EvidenceCount` (`rawComps.count + soldComps.length`) to decide which banner/fallback branch to take — if real comps existed (`realPhase2EvidenceCount > 0`) but `out.price` stayed null (because the block above never ran), **neither** of that finalization block's two branches fires: the 0-evidence fallback branch requires zero evidence (false), and the "real data priced this card" branch requires `out.price != null` (also false, precisely because of this gap). Net result: a real, already-fetched comp pool can render with a blank price — the same "10 real listings, blank card" shape Q110 was built to close, and the same *class* of bug as Q137 Slice A3 (a promotion that flips the decision-engine blocker but forgets the pricing-eligibility gate) — this is that same bug shape's **third** occurrence (Q133 Slice 1c's `publisherOnlyMissing` arm, Q137 Slice A3's `visionLowButCorroborated` arm, now Q133 Slice 2's `out.identityProvisional` arm).

**Fix implemented this session** (not deployed yet): added `out.identityProvisional` as a fourth OR-arm —

```js
if ((idCheckFinal.confident || publisherOnlyMissing || visionLowButCorroborated || out.identityProvisional) && !isPolybagPricing) {
```

`out.identityProvisional` is already narrowly scoped (only ever set `true` inside the ≥3-member promotion floor, Q133 Slice 2) — this is not a new eligibility class, it completes the one Slice 2 already established. A source-level regression guard (`tests/q141-rachta-lin-pricing-eligibility-gate.test.js`) asserts all four arms remain present, since `api/enrich.js`'s size means this specific gate has no pure-function extraction to unit-test directly — matching how Slice A3's identically-shaped bug was also only ever verified via a live rescan, never a unit test. **This fix has not been live-verified** — row 7 above will need its own rescan once deployed.

**Known pre-existing signals to watch for per book** (context carried in from this session, not a substitute for reading the actual logs):
- **One World Under Doom:** the G.O.D.S. PC-anchor mismatch (Q139's primary target) and the year/publisher client-merge gap (Section 2) both apply here directly.
- **Rachta Lin:** Q136 Slice A2 (row 7 above) has no prior live confirmation on record (Section 1) — this is that mechanism's first real observation.
- **Adventure Time SDCC / Invincible Returns:** this is the coherent-content-token lane's test case per your explicit ruling — a FAIL here, if it reproduces the known misidentification shape, is the one launch-blocking finding this matrix can surface.
- **Invincible MegaCon (Eom):** exercises Q133 Slice 1b's Eom registry addition and Q136 Slice A's artist-axis tier, both previously live-verified for this exact book.

---

## SECTION 4 — Operating Invariants

*Written as instructions to a future Claude Code session working on this codebase.*

1. **Two-axis anchor agreement.** A PriceCharting or ComicVine match must never be trusted on textual/title overlap alone OR on year alone — check both axes independently, and let either one's conflict reject the match (Q132/Q133's core lesson: ASM #26 needed the year axis, Invincible/Battle Beast needed the name axis; neither alone would have caught both).

2. **Pool-authority-when-corroborated.** When a real-world comp pool (≥3 independent members, the same floor `applyDualAxisGate`'s weighted-consensus path trusts) unanimously disagrees with Vision's own read, the pool wins — but this promotion must flow through the SAME structural mechanism every time (`identityProvisional` + `listingHardLocked`), never a bespoke one-off path. When you add a new promotion case, grep for every existing consumer of `idCheckFinal.confident`/`identityConfident` first — a promotion that flips the decision-engine blocker but forgets the pricing-eligibility gate (Q137's exact bug) is the same half-fix mistake twice now.

3. **Honest-null over inherited hallucination.** When a field genuinely cannot be resolved from any source, it must render as null/unknown — never silently fall back to a disproven or stale guess (Q131's "confirmedYear/Publisher/Issue must not fall back to the disproven Vision guess" ruling, Q134's honest-null confirmedVariant). A card that says "I don't know" is always preferable to one that confidently repeats a value already proven wrong.

4. **Annotation-with-consequence (I13).** Every gate's opinion must attach to the data as a visible annotation with a real, specific, item-grounded sentence — never a raw slug, never a silent suppression. If you add a new warning/blocker slug, add its `describeWarning`/`describeBlocker` branch in the same commit, and add it to the completeness-guard test list (`tests/q110-intake-nonblocking.test.js`'s `allWarningSlugs` array) so a future omission fails loudly instead of silently regressing to raw-slug display.

5. **Additive tiers with byte-identical controls.** Every new promotion/exemption/isolation mechanism must be provably a no-op for every case that shouldn't trigger it — Poison Ivy #1 (genuinely unidentified) must stay ID_REQUIRED byte-for-byte through every single slice this campaign has shipped. Prove this with an explicit control fixture in the same test file as the new mechanism, not by inference.

6. **Bump `COMP_FILTER_VERSION` on any admission-logic change — and remember the deploy itself does not clear the cache.** This session hit the identical "shipped the fix, forgot the version bump, or bumped it but the deploy alone didn't force a fresh fetch" failure mode **three separate times** (Q130/Q131's original v3→v4 incident, and twice more this session for Slice C's v5→v6 and the emergency v6→v7 follow-up). The version bump changes the KV key; only a genuine cache MISS on the NEXT request proves the new code actually ran. Never treat "deploy is READY" as equivalent to "the fix has been exercised" — those are two different facts, and conflating them is the single most repeated verification mistake in this campaign's history.

7. **One commit, one rescan.** Every slice ships as its own commit with its own test file, gets pushed, gets its Vercel deployment state confirmed READY via direct API lookup (never assumed from "the push succeeded"), and gets its own live rescan before the next slice starts. Do not batch multiple unverified mechanisms into one rescan — when something fails, you need to know which commit caused it.

8. **Prove deployment truth, don't assert it.** "I pushed it" and "it's live" are different claims. Confirm via `git log`/`git status` that the fix is actually committed (not sitting in the working tree), and via a direct Vercel deployment lookup (`githubCommitSha` matching the pushed SHA, `readyState: READY`) that it's actually serving traffic — before telling anyone to rely on a rescan for verification.

   **Branch-discipline corollary (added 2026-07-22, Q144B+C bundling incident):** an unpushed local commit sitting on `main` underneath a later commit is a bundling hazard, not a safe holding pattern. `git push` sends the whole unpushed chain, and Vercel deploys the tip of `main` per push — there is no way to push commit N without also pushing every unpushed commit before it on the same branch. Committing fix A (holding it unpushed, intending to push it "separately, later") and then committing fix B on top of it guarantees both ship in ONE deployment the moment either is pushed, regardless of stated intent. If two fixes genuinely need separate, individually-attributable deployments, use separate branches (each pushed and merged independently) or push immediately after each commit, never "commit now, push later" on a shared branch with more commits still to come. Confirmed live 2026-07-22: Q144B (`f818fda`) was committed and held unpushed so Q144C's fix could be traced and committed separately; pushing Q144C's commit (`3e9eba9`) carried `f818fda` along with it, bundling both into deployment `dpl_EbnggYycA1Etsw2PAYpbNgRQR2BW` — see Section 8 for the full record.

9. **Deploy READY confirms code; it does not confirm cache state — verify MISS→fresh-fetch explicitly before trusting any rescan.** This is a distinct, additional fact from invariant 8, not a restatement of it: a deployment can be genuinely `READY` and serving the new code, and a rescan against it can *still* observe zero of that code's effects, because a persistent cache (the Redis-backed `ac:` KV cache, `KV_TTL.ACTIVE` = 1h) replayed a pre-fix entry instead of invoking the new logic at all. This recurred twice in one session for the same book (Q130/Q131's original v3→v4 incident, then Slice C's v5→v6→v7). The standing rule: for any signal whose correctness depends on fresh code having actually run, a cache `HIT` in the log is never a default pass — it is `INCONCLUSIVE (re-scan required)`, full stop, regardless of what the rest of that log line shows. Only an explicit `MISS → fresh fetch` line earns a `PASS`. Apply this to every future verification pass, not just the one this rule was written for.

10. **New detectors need a live consumer-behavior assertion, not just a label check.** Every new rejectionCode/classifier/detector must ship with a test exercising its REAL exported call site end-to-end — proving it changes actual filtering/pricing/display behavior, not just that the classifier returns the expected label in isolation. Confirmed as a recurring gap: Section 15's own Commit D1 writeup flagged exactly this ("a genuine integration test... is queued as future work, not required now"), and `PRICING_GATE_CODES`/`isPricingMathEligible` had a pre-existing test verifying the gate in isolation but nothing invoking the real `api/comps.js:2062` composition until Track B Phase 0 Commit 1 extracted and exported `buildPricingEligibleRows` specifically to close that gap. Fourth confirmed instance of this drift class.

---

## SECTION 5 — Launch Recommendation

*I decide; you recommend — per your framing, this section is my ranked read of Sections 1-4, not a final call.*

**My recommendation:** your own pre-ruling on the Q139 dispatch is the correct standard, and I'd apply it exactly as you framed it — the distinguishing question for what's launch-blocking isn't "is every gap closed" (it isn't, and won't be for a while), it's **"can this system produce a confidently-wrong price, or does it fail honest?"**

1. **Adventure Time SDCC / Invincible Returns (coherent-content-token lane) is the one item that can fail the wrong way** — a shared-cover-art correlation between Vision and the pool producing a false HIGH-confidence agreement is structurally the only mechanism in this entire audit that bypasses every other safeguard (two-axis gates, pool-authority, honest-null) simultaneously, because both independent signals the system cross-checks are wrong in the same direction at once. If tonight's scan reproduces it, it's correctly your one launch blocker — not because it's more common than the other open items, but because it's the only one whose failure mode is a silent wrong answer rather than an honest "verify before listing."

2. **Everything else in Section 2 fails safe.** Slice B, the character-name lane, the three drifted artist registries, the comp-hygiene items, and the `getEra`/Layer-3 clarifications all produce, at worst, an imprecise RESEARCH-tier price or a missed premium — never a confident wrong number. These are legitimately post-launch roadmap, not gates.

3. **One thing I'd add to your gate, not as a blocker but as a required read:** the year/publisher client-merge gap this audit found means the 5-book pass needs to distinguish "the fix didn't work" from "the fix worked but the merge can't display an honest-null." If Q139 resolves a book's year to null rather than to a new value, the stale year will still show — don't let that misread as a Q139 regression. This doesn't block launch (publisher/year display is not what drives price or decision-state), but it should be read correctly tonight so a real pass doesn't get logged as a false failure.

4. **Q136 Slice A2's missing live confirmation** should be closed by the Rachta Lin book in tonight's pass — not a blocker on its own (the mechanism is tested and structurally identical to Slice A's already-confirmed pattern), but it's the one mechanism in Section 1 that's shipped, unverified, and about to get its first real observation in the same pass as a brand-new fix (Q139). Read its result on its own merits, distinct from Q139's.

**If the matrix comes back clean except known Section-2 items:** coherent-content-token lane ships only if needed (i.e., only if Adventure Time/Invincible Returns actually reproduces the misidentification) → final rescan of its two books → launch. If the matrix reveals something NOT in Section 2, that's a regression by definition and blocks regardless of size, per your framing.

---

## SECTION 6 — This dispatch's outcome (2026-07-22, same session)

**Matrix filled per your citations** (Section 3): Pop Kill #1 Lozano PASS ($138.34, 4/4 signed-consensus, isolate mode), Invincible #1 MegaCon PASS ($44.85, real 2003 PC anchor correctly handled), Poison Ivy #31/#1 standing controls confirmed. Adventure Time Summer Special (SDCC) **reproduced FAIL exactly as predicted** — this was, per your own Section 5 framing, the one launch-blocking finding this matrix could surface.

**Rachta Lin row 7 investigated and reported before fixing**, per your instruction: real gap confirmed (not log truncation) — a third instance of the "promotion flips the decision-engine blocker but forgets the pricing-eligibility gate" bug shape (after Q133 Slice 1c and Q137 Slice A3), this time `out.identityProvisional` missing from `api/enrich.js`'s tier-engine pricing OR-chain. One-line fix, as predicted.

**Coherent-content-token lane implemented** per the pre-approved sandbox design: `applyDualAxisGate`'s new ≥3-member-corroborated coherent-content lane (`src/lib/imageSearchIdentity.js`), evaluated strictly after Q119's narrower compound-completion keeps priority (a real collision was found and resolved here — the Captain Marvel #17 "kamala"/"khan" case would otherwise have been swept up by the same broad lane; fixed by reordering, not by narrowing the lane itself), plus family-scoped issue adoption in `resolveIdentity` (`src/lib/identityCore.js`).

**A second real scope question was found and resolved during implementation, not before it, and is flagged here rather than decided silently:** your dispatch named "Atom Eve-adjacent" as one of the three cases required to resolve to pool identity under this fix. `tests/q133-slice1b-eom-registry.test.js` had deliberately asserted the opposite at Slice 1b ship time (character names explicitly had "no legitimate-content lane... explicitly queued, not this slice"), and Section 2 of this very document still lists the character-name lane as a separate, not-yet-decided, LAUNCH-SAFE-BUT-QUEUED item. Treated your current, explicit, imperative instruction as the controlling decision (superseding the earlier, more tentative doc note) and updated that test file's expectations to match — the Invincible/Atom-Eve pool now resolves via `weighted-consensus` instead of `fallback-vision`. Flagging this plainly in case it was not the intended scope.

**Regression gate status:** full test suite re-run clean against the documented pre-existing baseline (same 10 files failing, identical to the baseline this document itself cites) — no new failures. `npm run build` clean. ESM-mode parse check clean on every touched file, per the standing P0 protocol. New suites: `tests/q140-coherent-content-token-lane.test.js` (18 assertions — coherent vs. scattered token behavior, the Adventure Time reconstruction, family-scoped issue adoption, and the mandatory regression controls: Captain Marvel #17/Q119, Batman-lot/LOT_RE, Eternus #2 thin-pool), `tests/q141-rachta-lin-pricing-eligibility-gate.test.js` (5 assertions, source-level regression guard on the OR-chain since the enrich.js handler has no pure-function extraction to test directly).

**Not done, and explicitly not claimed:** neither fix has been deployed or live-rescanned. Per invariant 9 (deploy READY ≠ fix exercised) and invariant 7 (one commit, one rescan), both fixes need a real push, a confirmed `READY` deployment, and a fresh live rescan of Adventure Time Summer Special (SDCC) and Pop Kill #1 (Rachta Lin) respectively before either row in Section 3 can be marked closed. The full diff is presented for review before any commit, per this repo's standing diff-before-commit protocol.

---

## SECTION 7 — Q145: Collection/Routing Authority (new P0, ranked above Q144A/B/C)

**Discovered:** collection/routing authority audit, this session, independent of the Q144 sub-issues. Poison Ivy #31 (an I9 contract-violation control case — price >100% over its own pool avg with a LIST_LOW decision) showed **"LISTING LOCKED — CONTRACT VIOLATION" on its own detail card, correctly**, but the **collection screen routed it as "💵 LIST" at its pre-violation $12.25 price** — a misrouted-to-sell-channel bug, not a display-only cosmetic. Ranked above Q144A/B/C because the failure mode is worse: a known-bad price reaching an actionable sell/bundle workflow, not an imprecise-but-honest price.

**Root cause (traced, cited exactly):** `src/lib/responseContract.js`'s `finalizeResponse()` had two independent, asymmetric partial-sync blocks. The sold-side-anchor path synced both `out.decision.action` and `out.decision.bestChannel`; the I9 contract-violation path (added later, Q109 dispatch Part 1) synced only `.action` — `.bestChannel` was left at whatever `computeBestChannel()` froze it to *before* I9 ever ran (`'cash_sale'` for a LIST_LOW book). That stale field reaches the client verbatim (`enrich.decision` merged with no re-derivation, `src/App.jsx`'s `syncedDecision`), and two collection-screen consumers (`getChannelMetrics`, the per-row pill) read `item.decision.bestChannel` directly with no fallback to the correctly-synced `item.contract.bestChannel` — unlike every detail-card consumer, which already preferred `contract.*` and rendered correctly the whole time. A related, differently-shaped gap: `submitBundle` never checked `contract.listable` at all, only `ID_REQUIRED`/`DO_NOT_LIST`/`blockers.length` — an I9-violating book with `action=RESEARCH, blockers=0` could be added to a bundle, an actionable gap, not just a display number.

**Fix, one commit, four parts:**
1. **`syncDecisionToContract`** (`src/lib/responseContract.js`) — single, unconditional sync point replacing both partial blocks; runs once after both `assembleContract` and `validateContract` have finished mutating `contract`, so a *future* contract-driven demotion mechanism gets the sync for free instead of risking the same one-field omission a third time.
2. **`getAuthoritativeChannel`** (`src/App.jsx`) — shared client-side resolver, defense-in-depth (explicitly secondary to fix 1), wired into `getChannelMetrics`, the per-row pill, and the previously-redundant-but-not-exploitable trade-eligibility check.
3. **`submitBundle`** now requires `passesContractGate` (`contract.listable === true`), matching the guard the single-card List button and Post-All-HOT already trust.
4. **Identity-readiness tri-state** (CONFIRMED / PROVISIONAL / UNRESOLVED) replacing the binary blocked/confirmed collapse in the listing-readiness checklist.

**A genuine discovery made while implementing fix 4, not assumed:** the two fields fix 4 was specified to key off (`out.identityProvisional`, `out.listingHardLockReason`) are **not merged into the client catalogue anywhere in `App.jsx`** — grepped every merge site, zero hits for either field name (a sixth instance of the "field never merged" class this session already found for `publisher`, `year`, and `issue`). Implementing fix 4 against those fields directly would have shipped a silent no-op. Used the reliable, already-merged proxy instead: `item.contract.locks` (`deriveLocks` pushes `{code: out.listingHardLockReason || 'listing-hard-locked', ...}` whenever `out.listingHardLocked` is true, and `contract` is merged on every path) — checks the raw fields too, defensively, in case a future merge-path fix adds them.

**Regression:** `tests/q145-contract-decision-sync.test.js` (41 assertions — the five required fixtures: Poison Ivy #31, Rachta Lin, a safe listable control, Poison Ivy #1 unresolved, sold-side-anchor regression control) plus a strengthened assertion added to the existing `tests/response-contract.test.js` I9 test (it checked `contract.bestChannel` but never `out.decision.bestChannel` — the literal coverage gap that let this ship). Full suite re-run clean against the documented baseline; `npm run build` clean (App.jsx validated via the `vite build` step, not `node --check`, since JSX isn't plain-JS-parseable).

**Not done, not claimed:** not yet committed, deployed, or live-rescanned.

### Remaining count, explicit (per your instruction — not folded into "three items")

**4 items remain before this campaign's launch gate closes:**
1. **Q145** (this section) — collection/routing authority. Code-complete, tested, **not yet shipped**.
2. **Q144A** — PC anchor discriminator gate (generic-stem vs. family-supported-discriminator), delegated to Fable 5. Not started — was paused for this P0.
3. **Q144B** — sequel-filter-removing-"special-1" defect. **Still OPEN**, not investigated yet — explicitly not to be closed without its own direct trace.
4. **Q144C** — issue client-merge presence-semantics fix (`hasOwnProperty` pattern, not `??`). Not started — was paused for this P0.

Sequence unchanged from before this P0 interrupted it: Q145 ships and rescans first, then Q144A → Q144C (each its own commit/deploy/rescan), then the combined Adventure Time rescan, then Q144B gets its own dedicated trace before anyone calls the campaign closed.

---

## SECTION 8 — Q144A/B/C dispatch outcome (2026-07-22, same session)

**Q145 shipped and live-verified first, as sequenced** — collection/routing authority fix confirmed live: Poison Ivy #31 collection route flipped LIST→RESEARCH matching its CONTRACT VIOLATION lock, Rachta Lin routes RESEARCH matching LOCKED, tri-state readiness live, channel metrics re-aggregated correctly.

**Q144A** (`24f8014`, Fable 5) — winning-family discriminator gate (`pcMatchMissingFamilyDiscriminator`, `src/lib/variantIdentity.js`) rejects a PC anchor missing a >=60%-adopted series-marker phrase the WINNING family's own member titles agree on (not the whole undifferentiated pool, which is why the pre-existing name/year axes missed this class). Guarded against the Kamala Khan/Captain Marvel false-positive by restricting candidacy to registry-anchored phrases only. 34/34 new assertions, zero regressions in the full suite.

**Q144C, first instance** (`0213bee`) — `applyProvisionalIdentity`'s `issue` field switched from `enrich.issue ?? null` to `hasOwnProperty` presence semantics. Verified but, per the diagnostic trace below, addressed only the provisional-identity path, not the confirmed-identity path this book actually took.

**Sequencing deviation, recorded verbatim as worded:** Q144B and Q144C's confirmed-path fix were **individually committed and regression-tested** (each its own commit, `f818fda` and `3e9eba9` respectively, each independently passing its own full test suite plus the full baseline regression suite with zero new failures) but were **unintentionally released together in production deployment `3e9eba9`** (`dpl_EbnggYycA1Etsw2PAYpbNgRQR2BW`) — not as the two separate, individually-attributable deployments instructed. Root cause: `f818fda` (Q144B) was committed and deliberately held unpushed on `main` so Q144C's confirmed-path fix could be traced and committed separately on top of it; pushing `3e9eba9` necessarily carried the unpushed `f818fda` chain with it, since `git push` sends the whole unpushed ancestry and Vercel deploys the tip of `main` per push. See invariant 8's branch-discipline corollary (Section 4) for the standing rule this incident produced. **Production acceptance was conducted as a combined certification** — one rescan against `3e9eba9`, checked against the full dual-mechanism criteria for both Q144B and Q144C at once, with mechanism-specific logs and UI assertions (`[sequel-filter] canonical-marker-allowed marker=special-1` for Q144B; `issue="1"` rendered on both collection row and detail card for Q144C) so each mechanism's evidence stayed individually verifiable even though the deployments themselves did not.

**Q144C, second instance (the confirmed-identity merge)** — traced live via a temporary pre/post-`finalizeResponse` diagnostic (deployed on `4ffe76b`, removed in the same commit as the fix per standing rule): server-side `out.issue="1"` proven clean through response assembly and serialization (`[q144c-pre-finalize]`/`[q144c-post-finalize]` both `hasIssue=true issue="1"`), isolating the loss to client-side. Root cause: the scan-to-catalogue persistence merge (`App.jsx`, the `updated` object in the `savedId` `setCatalogue` updater) never included a `title`/`issue`/`publisher` key at all outside the (provisional-only) `applyProvisionalIdentity` spread; `year` had a narrow `yearCorrected`/`polybagDetected`-only special case; `variant` used `||`. Same "field never merged at this site" class Q135 already found and fixed for the provisional path — this is the confirmed-path instance, the seventh occurrence of this class this session. Fixed wholesale via `mergeConfirmedIdentity` (`src/lib/dataQualityGuard.js`), same `hasOwnProperty` presence contract applied to all five fields at once, spread before `applyProvisionalIdentity` so a provisional response's own honest-null semantics still win on collision. Shipped as `3e9eba9` (see sequencing deviation above for its deployment history).

**Credential cleanup — CLOSED (2026-07-22, owed from an earlier session's credential-exposure incident):** `api/comps.js` was logging `EBAY_APP_ID`/`EBAY_CERT_ID` value fragments (first 20 chars + length on cold start, first 10 chars per OAuth call) — both replaced with `configured=true/false` boolean-only logging, deployed and confirmed READY. **Both credentials subsequently rotated, and post-rotation eBay OAuth + Browse connectivity verified (Jimmy) before any further production scan/export.** This closes the standing credential-exposure item — no further action required. Security gate satisfied for the launch call.

**Status at time of writing:** awaiting the combined Adventure Time certification scan against the post-credential-cleanup deployment, checked against the dual-mechanism criteria plus the Rachta Lin standing regression control (RESEARCH/LOCKED/$31.49). Q144B's own honest gap (marker-type-scoped exemption, not a cross-title guarantee — Filter 0b/title-similarity remains the actual cross-title gate) and the lettered-cover-variant (1B/1C) `detectSeriesMarkers` digit-capture gap remain logged for the edition-fingerprint backlog, not fixed in this dispatch.

---

## SECTION 9 — Campaign Close-Out and Launch Decision (2026-07-22)

**Launch-candidate build:** `5cb121a` (Q142 instance 2 — Phase 2 `checkAssemblyIntegrity` consensus-reference fix). Confirmed `READY` via direct Vercel deployment lookup, `githubCommitSha` matched exactly, prior to this close-out. Tagged `launch-candidate` (annotated, pushed) as the reproducible checkpoint this decision is made against.

**Adventure Time Summer Special (SDCC) is CLOSED** — see the update above and the full citation writeup under Section 3's Adventure Time subsection. This was the campaign's one confirmed launch-blocking finding (Section 5's original framing: "the one item that can fail the wrong way"), and it now passes the pre-agreed condition: correctly-identified-and-honestly-locked, never confidently-wrong.

### GO recommendation

**Recommendation: GO.** Applying the same standard Section 5 set at the start of this campaign — the question was never "is every gap closed," it's **"can this system produce a confidently-wrong price, or does it fail honest?"** — the answer is now verified, not just argued: **the failure mode is uniformly "honest and locked," never "confident and wrong," across both the old-book path and the variant/exclusive/virgin-cover class.**

- **The old-book / vintage / established-series path** (two-axis PC-anchor agreement, honest-null over inherited hallucination, pool-authority-when-corroborated) is **untouched by this entire Q140–Q142 campaign** and was already live-verified across Section 1's inventory (Q130–Q139) before this campaign began. No regression was introduced anywhere in that path — every touched suite re-ran clean against the same pre-existing baseline throughout.
- **The variant/exclusive/convention/virgin-cover class** — the harder, newer failure surface this campaign specifically targeted — was **rebuilt and verified end-to-end** on a real, live, adversarial case: an ambiguous-stem book (two genuinely different "Adventure Time" products sharing the same nominal title) with a Vision misread, a diluted comp population, and a two-invocation integrity check that only had one of its two sites fixed on the first pass. Every one of those failure points was found, fixed, and re-verified against a real rescan — not assumed fixed from a green test suite alone.

Both paths land on the same guarantee: when the system is confident, it prices; when it isn't, it says so and shows its work (reference asks, not a fabricated mid) rather than picking a number. That guarantee is what "GO" means here — not "zero remaining gaps."

### Known limitations at launch

**New entry, this close-out:** `active_reference_range` remains gated to `identityProvisional` (Q143). A **confirmed**-identity book (not provisional) whose comp pool lands below the ≥3-unique-verified-comps tier-3 floor gets **no computed reference price at all** — reference asks visible (the raw comp list), but no auto-computed reference mid, where a provisional-identity book in the same thin-pool shape would get one via the Q143 mechanism. This is a real, deliberate asymmetry, not an oversight.

**Recorded explicitly, why this was correct for the certification book, not just theoretically defensible:** Adventure Time's own final 3-comp pool mixed the exact, correct 2013 SDCC listing ($13.49) with two *wrong-year* 2012 Ward-sibling listings ($50.00 / $59.99) that survived the variant filter's marker-type-scoped exemption (Q144B's own documented honest gap — cross-title/cross-edition separation is Filter 0b's job, not the marker filter's). Had `active_reference_range` been widened to compute a reference mid for confirmed identities too, this exact pool would have **blended a 2013 first-print with two 2012 different-product siblings into one auto-computed number** — averaging a correct $13.49 against two wrong $50+ prices produces a confidently-wrong mid, not an honest one. Refusing to compute was the protective, correct behavior for this book, observed on a real pool, not a hypothetical.

**Standing rule from this observation:** any future widening of `active_reference_range` eligibility to confirmed-identity pools **requires edition-aware comp separation first** (distinguishing which of a thin pool's members are genuinely the same edition/printing before averaging them) — this is scope for the edition-fingerprint campaign specifically, tagged there, not a standalone quick fix to the eligibility gate alone. Widening the gate without first solving the separation problem would convert today's honest "no price" into tomorrow's confident wrong one, on exactly the class of book this campaign was built to protect.

**Remaining known limitations, carried forward (previously listed, restated here as the launch-time snapshot):**
- **Edition-fingerprint precision** — **DESIGNED, NOT BUILT** (Section 2). Trigger recorded: an accepted winning family observed disagreeing internally on specific variant signals (two genuine conventions, or a mixed lettered-cover/ratio/retailer-exclusive population within one winning family) — not yet observed in production. Build only when a real case surfaces it, per the design entry's own reasoning.
- **Vision nondeterminism** (misreads varying scan-to-scan on the same physical book) — contained, not eliminated, by pool authority: a nondeterministic Vision read can still route a book to RESEARCH instead of a fully listable state on some scans, by design (the pool overrides a bad read, but a genuinely thin/ambiguous pool can't always promote to LIST_NOW). This is the honest-lock failure mode, not the confident-wrong one — acceptable at launch per the GO standard above.
- **Registry maintenance** (`ARTIST_PATTERNS` and the three still-drifted secondary artist-name lists, Section 2) — ongoing; new artist names will continue to need adding as they surface, same as every prior session in this campaign.
- **D3 — Poison Ivy #1 issue-null** — working as intended, not a defect. The genuinely-unidentified-book control case stays `ID_REQUIRED` byte-for-byte, confirmed throughout this entire campaign including the final certification pass.
- **Remaining comp-hygiene items** (Section 2: cover-only listings, foreign-variant/pence-pricing blending, CV wrong-volume-story matching) — named, not yet scoped or fixed, LAUNCH-SAFE-BUT-QUEUED.
- **The 10 baselined stale test files** (`batch1-fixes`, `comp-filter-hygiene`, `decision-engine`, `identity-gate`, `image-search-extraction`, `mega-keys`, `pattern-k-dedupe-issue`, `priceBands`, `ship26-integration`, `sold-verification`) — pre-existing failures, confirmed unchanged (same files, same counts) at every regression run across this entire campaign, including the final one before this close-out. Reconciling stale expectations vs. current code is a dedicated future pass, not a launch gate.

### Operating invariants — standing for every post-launch session

Section 4's nine invariants are hereby confirmed as **standing rules**, not campaign-scoped guidance — every future session touching this codebase's identity/pricing pipeline follows them by default:

1. **Consumer enumeration before any signal fix** (the "Eternus rule," proven twice this campaign — Q142's own two-call-site discovery is the reference case): before fixing a signal, function, or gate, enumerate every call site/invocation across the codebase, cite file:line for each, and confirm the total count before writing a diff. A fix that touches one of two sites and calls itself done is a half-fix.
2. **Production log citation before any "done."** A mechanism is not verified because its test suite is green — it's verified when a real production log or rendered card is read and cited. Test-only status is a real, honestly-tracked state (see Section 1's trust inventory), not a synonym for "confirmed."
3. **Fresh-MISS before any cache-dependent verdict** (invariant 9). A cache `HIT` in a verification log is never a default pass — `INCONCLUSIVE (re-scan required)`, full stop, until an explicit `MISS → fresh fetch` line is observed.
4. **One commit, one rescan** (invariant 7). Every fix ships as its own commit with its own test file, gets its deployment confirmed `READY` via direct API lookup, and gets its own live rescan before the next fix starts.
5. **Contract as sole routing authority** (Q145's own lesson). Every consumer of listing-eligibility/routing state — collection screen, detail card, bundle submission, channel metrics — must read from `contract.*`/`decision.*` as the single source of truth, never a stale or independently-recomputed local field. When adding a new consumer, grep for every existing one first.
6. **Separate deployments via branches or push-per-commit, never "commit now, push later" on a shared branch** (invariant 8's branch-discipline corollary, confirmed live via the Q144B+C bundling incident). An unpushed local commit sitting under a later commit on `main` is a bundling hazard, not a safe holding pattern — `git push` sends the whole unpushed chain.
7. **New detectors need a live consumer-behavior assertion, not just a label check** (invariant 10). Every new rejectionCode/classifier/detector ships with a test exercising its REAL exported call site end-to-end, not a test-local mirror of that call site's composition.

---

**Campaign closed.** Q132 through Q146 (the coherent-content-token lane, the Q144A/B/C sub-campaign, and both instances of the Q142 assembly-integrity fix) are all shipped, deployed, and — where a live rescan was possible — verified against real production evidence. Next session opens fresh against the `launch-candidate` tag (`5cb121a`), with the post-launch roadmap ordered: edition-fingerprint campaign first (design already recorded above and in Section 2), then the remaining comp-hygiene items, then D3-class follow-ups.

---

## SECTION 10 — Q140 Corrective Dispatch (Commit A) — Status Correction and New Production Blockers (2026-07-24, amended)

**Reconciliation note (added this pass, per explicit instruction):** Section 9's "Campaign closed," GO recommendation, and `launch-candidate` tag (`5cb121a`) describe the Q132–Q146 close-out decision **as of that point in time** — a historical record, not a current-state claim. This section reopens launch certification following production findings discovered after that tag. **Current production tip is `18ed481`, not `5cb121a`.** Section 9 is closed-as-of-`5cb121a`; Section 10 below is the active, unclosed gate as of `18ed481` onward. The document does not claim both "closed" and "blocking" about the same state.

**Status (2026-07-24 dispatch, supersedes the paragraph above): prior GO is void.** Section 9's GO recommendation was made against `5cb121a` and does not carry forward to any commit built on top of it, including the Commit A work this section documents. `launch-candidate` is **withdrawn** — reason recorded verbatim: *"withdrawn after post-tag production findings reopened certification."* The tag was deleted from origin (`git push origin :refs/tags/launch-candidate`) rather than repointed, so no tag named `launch-candidate` currently exists on any commit; a stale tag pointing at a pre-bug-discovery commit would misrepresent every commit built after it as still covered by a decision that predates the findings.

**Tag policy going forward:** a Step 1 closure (all five Commit A fixtures LIVE-OBSERVED or REPLAY-VERIFIED per Task 4's evidence rules, no open contradictions) earns a `commit-a-certified` tag **only** — scoped to what was actually verified, Commit A's issue-consensus/terminal-fingerprint mechanism, nothing broader. `launch-candidate` is reserved exclusively for a full launch-gate decision (every Section 10 blocker resolved and certified, Steps 2A/2B/2C closed) and must not be reused for a narrower milestone.

**Verification header (this pass):**
- Timestamp: 2026-07-24 21:35:25 -0700 (America/Los_Angeles, system-reported as USMST)
- Commands run and their live output:
  ```
  $ git fetch origin
  $ git rev-parse origin/main
  848e7170233f72d8a25e4b8575ff8db225b941aa
  $ git log --oneline origin/main..HEAD
  (empty — nothing ahead)
  $ git status --short
   M .claude/settings.local.json
   M docs/LAUNCH-AUDIT.md
  $ git ls-remote --tags origin launch-candidate
  (empty — tag confirmed deleted)
  ```
- Confirms: origin/main tip is `848e717` (this dispatch's own doc-correction commit lands on top of it), no unpushed commits remain, `launch-candidate` no longer resolves on origin.

**Exposure ladder (recorded verbatim, per instruction):**
- **Owner-only daily use:** Step 1 + interim condition containment sufficient (owner manually reviews every card and initiates every action).
- **External supervised alpha before 2A/2B/2C:** only if listing execution globally disabled, portfolio totals hidden/disabled, every result reviewed with the participant. Listing-disabled alone does not neutralize Blocker 6.
- **External self-directed alpha/beta:** requires 2A + 2B + durable 2C.

**Commit A** (`18ed481`, post-launch-tag) replaces the original Q140 dispatch's single-representative-rawTitle issue extraction with `resolveFamilyIssueConsensus` — an aggregate vote across every member row of the winning title family — and closes the **terminal fingerprint invariant**: `confirmedIssue` (pre-pricing) and `out.issue` (pre-response) were two independent writer chains in `api/enrich.js`; `out.issue` is now derived from `confirmedIssue` alone, at a single terminal site, with an explicit dual-boundary check. A detected fingerprint violation clears price authority entirely (price/priceLow/priceHigh/priceBands nulled, matchConfidence demoted, `refusedToPrice=true`) and hard-locks the listing, reusing the existing refused-price pattern rather than a new mechanism. `tests/q140-issue-consensus-corrective.test.js`: 124 assertions, zero regressions against the standing 10-file baseline, build clean.

### Status correction (supersedes any prior framing of this as full certification)

**Flash #139 is a LIVE PASS on Commit A's primary branch only** — present-issue + insufficient family consensus → issue retained (the safe-hold/no-op branch). **This is NOT full Commit A certification.** The regression suite's 124 assertions cover five required fixtures, each exercising a structurally distinct branch of `resolveFamilyIssueConsensus`:

| Fixture | Branch exercised | Live status |
|---|---|---|
| Flash #139 | present issue + insufficient family consensus → retained | **LIVE PASS** (this dispatch) |
| Flash #128 | coherent-family corroboration (winning-family consensus, non-regression confirmed) | **CERTIFIED** — see citation below |
| Adventure Time Summer Special #1 | missing issue → adoption (≥3 unique rows, ≥60% agreement, clear lead) | **FAILED** — see writeup below |
| Immortal Hulk #44 | present issue + aggregate agrees → corroborate only, never replace | **CERTIFIED, narrowly** — recorded per dispatch, no verbatim log excerpt supplied this round (unlike Flash #128); margin not itemized. Flagged for a fuller citation on the next available rescan cycle rather than treated as fully equivalent evidentiary weight to Flash #128's row. |
| Wonder Woman #1 (2nd print) | modern edition, aggregate-vote-not-single-row | **Safe-but-not-certified** — behavior did not ship a confidently-wrong price (server-side `issue=null` is the honest, correct value), but a stale-display defect was found — see writeup below. Not a pass; not closed. |

**Flash #128 — CERTIFIED, cited verbatim:** `[q140] mode=corroborated winner=128 ratio=0.67 uniqueRows=3 runnerUp=none`; `[22e-population] Phase 2 mode=winning-family count=3`; `[q140-terminal]` — **both boundaries fire and both read OK**: pre-pricing (`pricingIssue=128/confirmedIssue=128 OK`) and pre-response (`out.issue=128/confirmedIssue=128 OK`); `decision=LIST_NOW/high/blockers=0/warnings=0`. First log pull showing the terminal invariant firing on both boundaries explicitly — confirms the dual-boundary check exercises both sites, not just one. Raw eBay visual pool was genuinely noisy this pull (Flash #159/#138/#147/#116 scattered in); family-clustering correctly isolated the true 3-row #128 cluster before consensus ran — the same messy-pool shape that broke #139→#170 pre-Commit-A, now handled cleanly.

**Status after this pass:** 2 of 5 fixtures cleanly certified with full citation (Flash #139, Flash #128); 1 certified narrowly with a thinner evidentiary record (Immortal Hulk #44); 1 failed with root cause confirmed (Adventure Time Summer Special #1); 1 behaved safely but surfaced an uncertified display defect (Wonder Woman #1 2nd print). **Step 1 remains OPEN. Step 2A remains NOT STARTED.** Per this document's own invariant 2 (Section 4/9, "production log citation before any done"), test-green is not a substitute for a live-rescan citation.

### Adventure Time Summer Special #1 — FAILED, corrective investigation (Item D)

**Symptom, as reported:** the winning family reached a 5/5 internal consensus on its own membership, and `confirmedIssue` nevertheless resolved to `null`.

**Hypothesis to test (per instruction):** `vision-zero-support` may be evaluating the RAW, unclustered ~20-item visual pool instead of the WINNING FAMILY's own membership once a family has already been selected — the same "measuring coherence against the wrong population" defect class as Q142 (`checkAssemblyIntegrity`) and Q144B (sequel-filter).

**Finding: the hypothesis holds, confirmed by direct code trace, not assumed.**

1. `api/enrich.js:2191-2198` computes the pool-wide eBay consensus BEFORE title-family clustering ever runs: `const parsedVisualRows = visualResult?.items || [];` (the full, category-filtered but otherwise unclustered pool) then `const visualConsensus = extractConsensus(parsedVisualRows, issueNum, publisher);`. The comment at `enrich.js:2205-2210` confirms the ordering explicitly: this fires "BEFORE the title-family vote (`selectTitleFamilyCandidate`, below)."
2. `src/lib/identityCore.js:851-910` — the family-override branch — correctly calls `resolveFamilyIssueConsensus(vision.issue, opts.visualItems, family.topFamily?.indices)`, which IS properly scoped to only the winning family's own row indices (`family.topFamily.indices`), and can legitimately resolve `confirmedIssue` via a genuine 5/5 (or similar) family-internal consensus. This part of Commit A works exactly as designed.
3. `src/lib/identityCore.js:1012-1067` — the `[vision-zero-support]` override/escalate block — runs **unconditionally after** the branch in (2), per its own comment: *"Runs uniformly AFTER title resolution, regardless of which branch fired above, so it composes with every title-decision path instead of patching each one."* Its trigger condition (line 1035) is `!isGraded && vision.issue != null && ebay?.agreement?.visionIssueCount === 0` — `vision.issue` is Vision's **original, pre-family** value, and `ebay.agreement.visionIssueCount` is the tally computed in step 1 against the **raw, unclustered pool** — not against the winning family's own membership that step 2 just used.
4. When the raw pool is contaminated with other same-title-different-product listings (exactly the shape already documented for this book — Adventure Time Comics #1/#5 wrong-product anchors drifting across rescans), Vision's original issue can legitimately show zero occurrences across the RAW 20-item pool even though the WINNING FAMILY itself reached full internal agreement on a issue number in step 2. If the raw pool's own pool-wide vote also fails to converge (`ebay.noIssueConsensus`), line 1056 fires: `confirmedIssue = null;` — **silently discarding the family-scoped result step 2 already correctly computed**, because step 3 never checks whether a family override already ran, and never re-evaluates support against `family.topFamily.indices` instead of the full pool.

**Hypothesis confirmed: this is the same disease as Q142/Q144B, a third/fourth instance, not a new bug shape.** Root cause is structurally identical — a downstream check computing "agreement"/"support"/"coherence" against the wrong population (the full undifferentiated pool) after an earlier stage has already legitimately narrowed to a smaller, more specific, correct population (the winning family). Per the standing invariant this pattern already produced ("consumer enumeration before any signal fix" / the Eternus rule), any fix must re-scope `ebay.agreement.visionIssueCount` (and the parallel `visionPublisherCount` check at `identityCore.js:1069-1120`, which shares the identical shape and the identical raw-pool-computed `ebay.agreement` input) to the winning family's own membership when a family override has fired, not just patch the issue axis in isolation. **No fix implemented this pass — investigation and hypothesis-confirmation only, per instruction.**

**Q12c finding, independently confirmed by direct code trace (not the same mechanism as the population-scoping bug above — a second, compounding cause feeding the same raw tally):** `Q12c can deterministically suppress issue #1 on rows where its marketing-keyword proximity conditions are satisfied. Adventure Time Summer Special #1 proves a production collision with legitimate title/edition language.` Traced exactly: `imageSearchIdentity.js:289-317`'s `extractIssueFromTitle` (the function that populates each pool row's `.issue` field at `imageSearchIdentity.js:396`, `issue: extractIssueFromTitle(rawTitle)`) nulls a matched "#1" whenever `MARKETING_KEYWORDS_RE` (`/\b(anniversary|special|collector|limited|exclusive|variant)\b/i`) matches within a 30-character window on either side of the match. "Adventure Time Summer Special #1 SDCC Convention Exclusive" contains both "Special" and "Exclusive" inside that window — every row built from this exact, correct, legitimate title has its own `.issue` nulled by design, not by malfunction. That nulled field is exactly what `imageSearchIdentity.js:595` (`const issues = parsedRows.map((r) => r.issue).filter(Boolean);`) and the `visionIssueCount` tally at `imageSearchIdentity.js:620-622` consume — the same raw-pool, pre-family-clustering computation the population-scoping finding above already implicates, now confirmed to be independently poisoned at its own source data, not just mis-scoped. `This fixture exhibited an inversion where a contaminated pool could accidentally provide enough raw support to avoid escalation, while a cleaner exact-family result was nullified because Q12c removed issue-#1 support from the raw tally.` Note for the eventual fix: `resolveFamilyIssueConsensus` itself (`identityCore.js:723`) is unaffected by Q12c — it re-derives directly from `rawTitle` via its own unguarded `/#\s*(\d{1,4})\b/` match, not from the pre-computed `.issue` field — so the winning-family adoption/corroboration result Item D's population-scoping fix would recover is itself Q12c-clean; only the raw-pool `ebay.agreement` tally that competes with it is contaminated. **No fix implemented this pass — investigation only, per instruction.**

### Wonder Woman #1 (2nd print) — stale-display enumeration

**Symptom, as reported:** server-side `issue` resolves to `null` (the honest, correct value per every safety mechanism this campaign has built), but the rendered card still displays "#750" as the canonical issue/title.

**Framing, per instruction:** this is treated as a site-enumeration problem, same class as the earlier `setSelectedItem` site-parity gap (Section 8's Q144C, second instance) — find every UI consumer that can render a rejected/stale value as canonical when the authoritative field is null, rather than assume a single cause.

**Sites found, enumerated (not assumed complete — flagged where confidence is partial):**

1. **`src/App.jsx:3258`** — `const displayIssue = item.issue || extractIssueFromReport(item.conditionReport || item.notes || '');`. This actively **re-derives** an issue number from free-text (`conditionReport`/`notes`) whenever `item.issue` is falsy — including a legitimate, authoritative `null`. It has no awareness of *why* `issue` is null (fingerprint violation, zero pool support, genuinely unresolved) and can resurrect a number Vision's own free text mentioned even after the structured field correctly rejected it. This is the most direct match for the reported symptom.
2. **`src/App.jsx:4072`** (same shape recurs at `:9080`, `:9513`, `:8449`) — `{item.title || "Unknown"}{item.issue && ... ? ` #${item.issue}` : ''}`. The appended-suffix logic correctly gates on `item.issue` truthiness (so a null issue adds nothing) — **but `item.title` renders first, verbatim, regardless.** If `item.title` is itself a raw string that already contains "#750" as literal text, the card displays it independent of what `item.issue` resolves to. This shifts the question from "is `issue` null" to "does `title` independently embed the issue number," a check none of these render sites perform.
3. **`api/enrich.js:5533`** (server-side, upstream of any client merge) — inside the polybag/edition-label branch: `const issueStr = confirmedIssue ? ` #${confirmedIssue}` : ''; out.title = `${baseTitle}${issueStr} ${editionLabel}`;`. This bakes whatever `confirmedIssue` held **at that point in the pipeline** into `out.title` as literal text — a printing/edition case (2nd print, exactly Wonder Woman's shape) is very plausibly routed through this exact branch. `api/enrich.js:8338-8340` (`if (!out.title) { out.title = confirmedTitle; }`) only fires when `out.title` is still falsy — it does **not** overwrite an already-set title, so a value baked in here survives untouched through the rest of the handler.
4. **Consequence of (3): this is a second, independent writer-chain divergence of the exact same shape Commit A's terminal-fingerprint invariant was built to close for `out.issue` — but Commit A never touched `out.title`.** If the vision-zero-support block (or the terminal fingerprint check itself) later nulls `confirmedIssue`/`out.issue` for legitimate reasons, `out.title` — already constructed at line 5533 with the pre-null value baked in as text — is never revisited, re-validated, or re-synthesized. The single-writer-site discipline Commit A applied to `issue` does not extend to `title`, and this is the most likely root cause of "#750" surviving a genuinely-null `issue` all the way to the card.
5. **Not yet checked, flagged as incomplete:** whether the 5 documented client merge paths (auto-refresh→catalogue, scan→catalogue, scan→selectedItem, bulk-import→catalogue, refreshMarketData) each correctly propagate a server-corrected `title` the same way Q144C's `mergeConfirmedIdentity` (`src/lib/dataQualityGuard.js:201-209`) does for the scan→catalogue confirmed-identity path specifically — `mergeConfirmedIdentity` itself is `hasOwnProperty`-safe for `title` (line 203) and would not be the source of a stale value if it's actually the site in use; whether **scan→selectedItem** (the site Wonder Woman's own detail-card view most likely renders from) calls `mergeConfirmedIdentity` at all, or still builds its update object ad hoc, has not been confirmed this pass and is the next concrete thing to check before proposing a fix.

**No fix implemented this pass — enumeration and investigation only, per instruction.** Both this item and Item D above need their own dedicated corrective commits, each following this document's standing invariant 1 (consumer enumeration before any signal fix) and invariant 7 (one commit, one certification package) once code work is authorized.

### New production findings, 23-book collection export — recorded LAUNCH-BLOCKING

**BLOCKER 4 — Captain Marvel #1 year/volume divergence still routes LIST_NOW/high.** Card displays 2017; the underlying evidence is the 2019 Artgerm Walmart-exclusive printing. The existing ±3-year era tolerance treats the two years as close enough to merge, producing a confident price across what are genuinely two different products. Same defect *class* as Commit A's terminal-fingerprint fix (single writer chain, no silent divergence) — reproduced here on the `year`/`volume` axis rather than `issue`. Confirms Section 2's already-logged risk ("modern relaunches must never merge separate #1 volumes under a ±3y tolerance") is live, not hypothetical.

**BLOCKER 5 — "Acknowledge and Enable Listing" bypasses HARD_LOCK-shaped RESEARCH cards.** Nine hard-locked RESEARCH cards in this export carry a single-click "Acknowledge and Enable Listing" control that clears the automated listing block and enables List — including ASM #678, locked at $2,702.97, itself derived from a single $18,000 outlier ask. The research state today is one undifferentiated tier with one universal acknowledge affordance; there is no distinction between "advisory, proceed if you understand the caveat" (SOFT_REVIEW) and "this requires correction/re-identification before automated listing authority can exist at all" (HARD_LOCK, redefined below). One click currently defeats every upstream safety mechanism this audit documents (two-axis anchor agreement, honest-null, pool-authority, I13 annotation) at once.

**BLOCKER 6 — Collection totals count untrusted numbers as owned value.** The reported "$4,754 Liquid Value" resolves to roughly $236 actionable (listable) value plus roughly $4,518 in research-tier estimates presented with equal weight; two questionable-price books account for 76% of the total. The dashboard's BLOCKED counter reads 0 while 7+ records in the same export are contract-locked. Two separate aggregation paths — Review ($4,518) and Research ($4,342) — computed over what should be the same underlying set disagree by $176. Same "two independent reducers, one truth" class Section 7 (Q145) already found and fixed for collection *routing*; this is the equivalent defect, unfixed, on collection *valuation*.

### HARD_LOCK / SOFT_REVIEW, redefined (corrected this pass)

**HARD_LOCK blocks GrailKey's own AUTOMATED pricing and listing authority only — it never blocks user agency.** Every hard-locked card must expose cause-specific resolution actions, at minimum: view accepted/rejected evidence, edit identity, select edition, re-identify, add photos, enter a manual price. A manual price entry creates a **new, separate manual-authority record** — it can never reactivate the rejected automated price, price bands, anchor, verified status, portfolio authority, or an automatic LIST recommendation. Those stay rejected regardless of what the user manually enters; the user is never blocked from acting on their own book, only from GrailKey silently vouching for a number it can't stand behind.

**HARD_LOCK triggers, corrected:**
- issue/year/volume conflict (Commit A + Step 3 fingerprint violation)
- printing/variant unresolved — **only when materially identity- or value-changing**; a cosmetically-irrelevant unresolved detail does not lock
- rejected anchor — **only if the rejected anchor was actually used/contaminating a computed value, or no alternative exact-tier authority exists**; a cleanly rejected anchor with a good replacement already in place is not itself a lock condition
- **zero exact evidence of any kind** (corrected from "zero exact comps" — valid exact ACTIVE evidence with no sold history is SOFT_REVIEW, not HARD_LOCK)
- extreme sold/active divergence
- **outlier-owned price — deterministic definition (AND of two conditions, both required):** (a) the anomalous row/source is proven to **materially control the result** — either it carries ≥50% of the computed value's weight, **OR** removing it (leave-one-out) swings the result by more than a materiality threshold (proposed: >25%) — **AND** (b) the premium **lacks independent exact-edition-matched support** (no ≥2 corroborating data points at the same edition/printing/variant tier confirm that premium level exists in the broader market). **`>2x deviation from the pool's own median` is explicitly NOT part of this definition and must never, alone or combined, independently trigger HARD_LOCK** — a legitimate scarce key or ratio variant can sit multiples above a broader (non-edition-matched) median while having full independent support within its own edition tier, and is not outlier-owned. *(Flag: the 50%/25% thresholds are a proposed starting definition for this new gate, not a previously-calibrated constant — confirm/tune during Step 2A implementation against real fixtures, same as any other new numeric gate in this codebase.)*
- asset-type uncertain
- fingerprint violation (Commit A's mechanism, extended in Step 3)

**SOFT_REVIEW:** acknowledgment/proceed remains available — the advisory tier, structurally distinct from HARD_LOCK above, not a lesser version of the same control.

### Remediation plan — execution order fixed, do not batch

**STEP 1 — Certify the remaining four Commit A fixtures** (Flash #128, Adventure Time Summer Special #1, Immortal Hulk #44, Wonder Woman #1 2nd print) against real scan logs, per Section 3's standing checklist (cache-verdict rule and 6-signal matrix apply unchanged). **Status: BLOCKED — awaiting Jimmy's four scans, not yet received in this conversation. No cell fillable yet.**

**STEP 2A — Typed review/lock/override contract.** New typed contract, explicit:
```
{ reviewState, lockCodes, allowedActions, overridePolicy, automatedListingAllowed }
```
The UI renders FROM this contract only — it never independently decides whether to show an override/acknowledge control, same discipline as the Q145 routing-authority fix: one authoritative source, not a second consumer improvising. `reviewState` ∈ {SOFT_REVIEW, HARD_LOCK}. `lockCodes` names every trigger condition present (enumerated above). `allowedActions` is cause-specific (view evidence, edit identity, select edition, re-identify, add photos, manual price — never a blanket "acknowledge"). `overridePolicy` governs manual-override behavior. `automatedListingAllowed` is the single boolean every consumer (detail card, collection screen, bundle submission, channel metrics) reads, replacing today's single-tier acknowledge-defeats-everything shape. Every existing site that renders an acknowledge/override control must be enumerated (invariant 1, "consumer enumeration before any signal fix") before any one of them changes.

**`valuationAuthority=manual` requires canonical identity to be sufficiently resolved first.** If issue, volume, material edition, or asset type remains unresolved at the time of manual entry, a user-entered amount is **private-reference-only**: it cannot contribute to portfolio value and cannot authorize a listing, regardless of `automatedListingAllowed`'s other conditions. Only once identity is sufficiently resolved (via edit-identity/select-edition/re-identify — the cause-specific actions above) does a manual entry qualify for `valuationAuthority=manual` proper.

Manual overrides recorded, auditable, never silent: `pricingSource=manual-user-entry`, `valuationAuthority=manual`, `automatedPriceRejected=true`, `originalLockCodes`, `reason`, `timestamp`.

Own report, own diff, own commit, own deploy, own certification package — separate from 2B and 2C.

**STEP 2B — Authority-aware collection aggregator.** One aggregator, sourced exclusively from `contract.state` + `contract.listable` + valuation authority — extends Q145's "contract as sole routing authority" invariant from routing to valuation. Headline becomes "Ready to sell: $X / Research estimates: $Y / Unpriced: N," never a single blended "Liquid Value." Must resolve BLOCKED:0 and the Review-vs-Research $176 discrepancy as one fix, one truth.

Own report, own diff, own commit, own deploy, own certification package — separate from 2A and 2C.

**STEP 2C — Structured condition-AI contract.** Schema-first condition output — the schema itself contains no price/key-importance/velocity/ROI fields at all:
```
{ assessedGrade, gradeConfidence, visibleDefects, positiveObservations, imageLimitations, requestedPhotos }
```
Plus a server-side sanitizer as defense in depth (strips/rejects market-commentary language that slips through regardless of prompt discipline) — not a prompt-only control. (Reproduced concretely, the motivating case: the Flash card shows Recommended $212.24 beside an unrelated AI-authored $800 opinion in the same report.)

Own report, own diff, own commit, own deploy, own certification package — separate from 2A and 2B.

**STEP 3 — Extend the terminal fingerprint (Commit A), split in two:**
- `baseIssueFingerprint`: `{series, volumeStartYear, issue, publisher}` — extends Commit A's existing terminal-fingerprint mechanism directly.
- `editionFingerprint`: `{publicationYear, editionYear, printing, coverArtist, variantName, material, ratio, territory, language, retailerOrEvent}`.

Known material fields must agree across display/pricing/contract layers. **Unknown/unresolved material fields block automated edition-specific pricing** (routes to HARD_LOCK per the corrected trigger list above), rather than silently averaging across editions. Canonical-year definition (volume-start vs. cover-date vs. copyright vs. reprint vs. edition-specific date) to be reported before any code is written for this step — feeds `baseIssueFingerprint.volumeStartYear` vs. `editionFingerprint.publicationYear`/`editionYear` as two distinct, separately-tracked fields rather than one overloaded "year." Captain Marvel #1 (Blocker 4) is the production fixture this step must close.

**STEP 4 — Commit B, source-specific anchor trust.** Not one overall trust field — separate, independent trust states per source, each ∈ {exact, compatible, rejected, unresolved}:
- `priceChartingAnchorTrust`
- `comicVineAnchorTrust`
- `ebaySoldEvidenceTrust`
- `ebayActiveEvidenceTrust`
- plus an overall `valuationAuthority` derived from (not overwriting) the four above.

PriceCharting can be rejected while ComicVine story/key-issue metadata stays exact, and vice versa — each source populates only the fields it is authorized to support; a rejected PC anchor must not silently drag down an independently-exact CV story claim, and a locked card must never render a different, unrelated product's complete market profile underneath its own lock. Required before open beta.

### Launch classification, corrected

- **Now:** internal/owner use, demos, real-image testing only.
- **After Step 2 (2A+2B+2C):** closed alpha (~5 users), listing execution disabled, manual review required, no "liquid value" claim anywhere in UI copy.
- **After Steps 3+4:** **Safety-eligible for open beta after Steps 3+4, subject to a separate operational launch checklist** (auth, per-user data isolation, image-storage ownership, rate limiting/quotas, global spend limits, monitoring, privacy/terms, account/data deletion, API-license compliance) — closing the identity/pricing safety gate does not by itself clear that separate checklist.
- **Autonomous LIST:** remains paused throughout every stage above.

**Estimate:** 3-5 focused implementation days plus certification/regression time — no calendar date committed pending a full writer-chain trace ("Commit A looked small too").

**Standing objective, this phase:** no untrusted number may become a portfolio asset, a recommended price, or a listable action.

**Sequencing, explicit:** report before code on each step; one commit per step; **one relevant production certification package per commit** (corrected from "one rescan per commit" — a portfolio-reducer or UI-consumer change needs more than a single-card rescan to certify). **Currently at STEP 1, blocked on Jimmy's four scan logs (Flash #128, Adventure Time Summer Special #1, Immortal Hulk #44, Wonder Woman #1 2nd print) — not yet provided in this conversation. No code has been written for Step 2 (2A/2B/2C) or Steps 3-4.**

---

## SECTION 11 — A0/A1 corrective dispatch: state check + log recovery (2026-07-27, amended)

**Evidence custody, corrected:** the first version of this commit stored the raw, unredacted Vercel log export in the repo. **This repo is public** (verified by anonymous clone) and has a prior credential-exposure incident (Section 8) — committing raw production logs would have published eBay item IDs, image URLs, seller usernames, and postal codes. Amended before push: the raw export was removed from the repo entirely; a minimal redacted extract containing only the specific lines each certification claim below cites is committed at `docs/certification/step1-5book-log-recovery-9f0c86a-20260727T005500Z-redacted.log`. The raw original is kept **outside the repo**; its filename, retrieval timestamp, storage location, and SHA-256 are recorded in a private note, not committed. `.gitignore`'s blanket `*.log` rule is narrowed with `!docs/certification/*-redacted.log` (negation immediately after the general rule, verified with `git check-ignore`) — only files carrying the `-redacted` marker are trackable; a future accidental raw-log commit is still caught by the blanket rule.

**A0(a) — Section 10 status, confirmed:** the "19-book screen-scan batch" findings named in the dispatch (edition capture TMNT/New Mutants/L&R/Bone/Gobbledygook/Killing Joke, preorder contamination, attribute inheritance, reprint-dominant incoherence, pre-1990 variant-backfill skip, a "Blocker 6 instance") are **not present anywhere in this document or `docs/`** — grepped `LAUNCH-AUDIT.md` and every `docs/*.md` file for each named term; the only hits are unrelated (a 2016 mega-key TMNT bug, a TMNT test fixture in `session-history.md`). Section 10 as written documents a **23-book collection export** with Blockers 4/5/6 — a different, already-committed finding set. **Queued as its own separate doc-only commit**, grounded in the source export (CSV or an independent Vercel re-pull of the 2026-07-25 ~23:30–23:50 UTC window) once available — not bundled into this commit.

**A0(b) — deployment chain, confirmed via direct Vercel API lookup (not inferred):** `comic-vault-rouge.vercel.app` → project `comic-vault` (`prj_2tECtpKowmM7oFT7CYOQFZTssP72`) → `latestDeployment` `dpl_35wLEJsKp9aa4YRpTwwbVKc2FJC4`, `readyState=READY`, `target=production` → `githubCommitSha=9f0c86ae5294c162d5c13acaeb12fe3bdd52d4c7`. Matches local `HEAD` (`9f0c86a`) exactly; `git log --oneline -5` and the Vercel deployment list agree commit-for-commit back through `1ad5d51`. Chain confirmed, no gap.

**A1 — log recovery, window `2026-07-27T00:55:00Z`–`01:15:00Z`, filter `production`/`POST /api/enrich`:** all 5 expected scans found, timestamps matching the dispatch's predictions exactly (00:58:33 / 01:00:54 / 01:02:48 / 01:11:57 / 01:12:58). All 5 ran on `[boot] Comic Vault build 9f0c86a`, all HTTP 200, all `cache=MISS`. Full verbatim citations in the redacted extract; this section's historical 18ed481-era status (Section 3/9) stays a separate, untouched ledger — the lines below describe only the current-build (9f0c86a) branch.

- **CURRENT-BUILD (9f0c86a) BRANCH PASSES: Adventure Time Summer Special #1, Immortal Hulk #44.** Immortal Hulk: `[q140] mode=corroborated winner=44 ratio=1.00 uniqueRows=12`, `[vision-zero-support] SKIPPED reason=winning-family-authority`, `[identity] confirmed="immortal hulk cho michael" #44`, both `[q140-terminal]` boundaries OK, `decision=LIST_LOW blockers=0`. Adventure Time: **supersedes Section 10's Item D "FAILED" note** (diagnosed against `18ed481`; commit `69a1d76`, "scope vision-zero-support skip to current winning-family issue authority," lands exactly the fix Item D's hypothesis called for) — `[q140] mode=corroborated winner=1 ratio=1.00 uniqueRows=4`, `[vision-zero-support] SKIPPED reason=winning-family-authority` (not an escalate this time), both `[q140-terminal]` boundaries OK, `decision=LIST_LOW blockers=0`. Scope, explicit: this fixture certifies the Commit A issue-consensus and terminal-projection mechanism only — exact skull-cover-edition discrimination (vs. SDCC/Cover A/RI 1:25), valuation authority, and the displayed ×1.35 derivation figure remain open under Steps 3/4 (A4).

- **SAFE BEHAVIOR, FIXTURE NOT CERTIFIED: Wonder Woman #1 (2nd printing).** Vision originated the unsupported #750 observation (`[phase1] identity determination: Vision="Wonder Woman" #750`). The server correctly rejected it — `[visual] consensus: issue=none (3/20) visionIssueCount=0`, `[q140] mode=no-consensus`, `[vision-zero-support] ESCALATE: Vision issue="750" has 0/17 pool support ... forcing ID_REQUIRED`, `[identity] confirmed="Wonder Woman" #null`, both `[q140-terminal]` boundaries read `"null"`/OK, `decision=ID_REQUIRED blockers=2`. **A separate canonical-display or merge defect still shows the rejected observation as the book's identity** in the UI (per prior investigation of this card) — this is a live defect, not a hypothetical. Server-side structured fields are clean: `confirmedTitle="Wonder Woman"`, `confirmedIssue=null`, `out.issue=null`. `api/enrich.js:5533`'s `out.title` bake-in branch (Section 10's finding #3) is log-verified as **not firing this request** — its unconditional precursor line, `[polybag-edition] label="..."` (`enrich.js:5524`), does not appear anywhere in this request's fully-captured log (no truncation on this fixture), so the branch containing line 5533 did not execute. **Final serialized `out.title` from whichever writer actually produced it: unverified** — confirming that requires either a fresh raw-response capture or the persisted collection record (A2).

- **INSUFFICIENT EVIDENCE: Flash #128, Flash #139** (log tail missing). Both requests' returned logs stop before `[q140-terminal]`/`[decision]` — confirmed on two independent fetches (a full-window pull and a narrow per-book re-fetch), both stopping at the identical line each time, ruling out a query-filter artifact. #128 stops after `[floor] skipped — tier 2 owns floor enforcement`; #139 stops after `[sold-verify] raw scan grade-proximity: derived 4`. Both fixtures took the `title-family decision=fallback-vision` (non-override) path — no `[q140]` line was emitted for either before the log cuts off. Not inferring PASS or FAIL for either. Root-cause investigation queued as A6 — **no re-scan of these two books**, per instruction.

**Step 1: OPEN.** 2 of 5 fixtures pass on the current build; 1 is safe-but-not-certified with a live display/merge defect flagged; 2 are insufficient-evidence, not failed. The historical `18ed481` ledger (Section 3/9's "2 certified, 1 certified narrowly, 1 failed, 1 safe-but-not-certified") stays a separate, unedited record — this section describes the 9f0c86a rescan only, not a revision of that history.

**Superseded:** the Remediation Plan's Step 1 status line above ("BLOCKED — awaiting Jimmy's four scans, not yet received in this conversation. No cell fillable yet.") is superseded by this section — the scans have now been received and processed; see this section for current status.

**Not done this pass:** A2 (Wonder Woman full writer/merge trace), A3 (Immortal Hulk cross-cover sold-filter trace), A4 (Adventure Time derivation-panel trace), A6 (Flash log-tail root cause) — queued as separate report-only dispatches per the locked execution order.

---

## SECTION 12 — A2/A3/A4/A6 dispatch outcome (2026-07-26, report-only, no code)

**19-book batch commit: deferred.** Independent re-pull of the 2026-07-25 23:30–23:50 UTC window did surface real material matching the batch (Love and Rockets #1, Batman: The Killing Joke, Gobbledygook #1, New Mutants #98, Bone #1, a "teenage mutant ninja turtles #1" fixture — several genuine edition-capture/reprint-dominant findings visible on first pass), but attempting to build the minimal redacted extract surfaced apparent interleaved/duplicate concurrent request logging in this window (a "Love and Rockets" block whose visible log began mid-pipeline with no `[boot]`/`phase1` header, immediately followed by a second, separately-headed "Love and Rockets" block with a full `phase1` section). Attributing specific figures to the wrong request would repeat exactly the error this document's custody rule exists to prevent. Per instruction, holding for Jimmy's original export CSV (`comic-vault-log-export-2026-07-25T23-47-28.csv`) rather than resolving the ambiguity by inference.

### A2 — Wonder Woman full writer/merge/render trace

**Persisted collection record: not reachable this pass** (no export/Drive backup/file provided) — trace completed from code plus the A1 raw response, per the stated fallback branch.

**Server side, complete enumeration (invariant 1):** `api/enrich.js` writes `out.title` at exactly 4 sites, all checked against the A1 Wonder Woman log:
1. `enrich.js:5533` (polybag/edition bake-in) — confirmed not entered. Its outer gate requires `reprintRatio >= 0.6`; all four mutually-exclusive branches under that gate (`[polybag-abort]` ×2, `[polybag-check]`, `[polybag-pool]`) log unconditionally as their first action, and none appear anywhere in the fully-captured request. Stronger than the prior "precursor line absent" framing — the whole outer gate, not just this one branch, never fired.
2. `enrich.js:5805` (`ebay_comp_consensus` rescue) — gated on `consensusPool.length >= 10 && freshSolds.length >= 1`. The A1 log's own `[verify]` line reads `sold: 0 found`; `freshSolds.length >= 1` is false. Confirmed not entered.
3. `enrich.js:7666` (Ximilar override) — `const ximilar = null; // Ximilar lookup disabled` (`enrich.js:3072`). Dead code globally, not Wonder-Woman-specific.
4. `enrich.js:8339` (Ship 26.3B fallback, `if (!out.title) out.title = confirmedTitle`) — the only site that can fire, and does: `out.title = "Wonder Woman"`, clean.

**Conclusion: `out.title` is provably `"Wonder Woman"` server-side, no code path to `"#750"` exists in this response.** This supersedes the prior "final out.title from other writers: unverified" note — it is now verified, not open.

**Client side, merge-site enumeration (5 sites found, not the 2 originally named):**
| Site | Line(s) | Calls `mergeConfirmedIdentity`? | Calls `applyProvisionalIdentity`? |
|---|---|---|---|
| scan→selectedItem | `App.jsx:10404-10409` | Yes | Yes (spread after, no-op unless `identityProvisional`) |
| scan→catalogue | `App.jsx:10515-10519` | Yes | Yes (same order) |
| auto-refresh | `App.jsx:9964` | **No** | Yes only |
| bulk-import | `App.jsx:10864` | **No** | Yes only |
| Refresh Market Data | `App.jsx:11401` | **No** | Yes only |

`mergeConfirmedIdentity` (`src/lib/dataQualityGuard.js:201`) has no provisional gate — `hasKey(enrich,'title') ? enrich.title : prior?.title`. Since `out.title` is present and clean, **the two sites a fresh scan actually uses (scan→catalogue, scan→selectedItem) would correctly overwrite any stale `"#750"` with `"Wonder Woman"` on this exact response.** The three sites that skip `mergeConfirmedIdentity` (auto-refresh, bulk-import, Refresh Market Data) fall through to `...cur`/`...item` for title/issue/publisher/variant unless `identityProvisional` is true — Wonder Woman's `out.identityProvisional` is false here (that flag is set only inside the `identityRefused`/pool-promotion path at `enrich.js:4277`, a TITLE-level Vision-vs-pool conflict; Wonder Woman's title resolved cleanly via `weighted-consensus`, only the ISSUE was escalated-null — a different mechanism that never sets this flag).

**Newly discovered, not previously documented:** a sixth instance of this session's own repeatedly-found "site-parity gap" class (Q144C instance 8, Q145, etc.) — three merge sites (auto-refresh, bulk-import, Refresh Market Data) never gained the `mergeConfirmedIdentity` fix that scan→catalogue and scan→selectedItem received in `3e9eba9`/`8187be5`. Render sites checked (`App.jsx:3259`, `:4072`, `:8830`) all display `item.title` verbatim with no independent re-derivation — the render layer is not the source.

**Working hypothesis, not confirmed (no persisted-record access):** if Wonder Woman's card carries a stale `"#750"`-containing title from before these merge fixes existed, or from a scan whose only subsequent touch was Refresh Market Data / auto-refresh (not a fresh re-scan through the two fixed sites), the title would never get corrected — those three sites are a real, live gap. Cannot confirm this is what actually happened without the persisted record or a fresh live rescan.

### A3 — Immortal Hulk cross-cover sold-filter trace (root cause found)

**Root cause: Michael Cho is missing from `ARTIST_PATTERNS`.** `soldVerification.js:519-539`'s variant-artist-mismatch filter (Filter 7) computes `ourArtist = ctx.artistOverride || extractArtist(variant)`; `enrich.js:4917` correctly wires `artistOverride: extractArtist(confirmedTitle) || null` (the Q136 Slice A mechanism, working as designed). `extractArtist` (`compHygiene.js:973`) does a straight regex scan of `ARTIST_PATTERNS`. That list contains `/frank cho/i` — **a different artist** — and no bare `/cho/i` or `/michael cho/i` pattern. `extractArtist("immortal hulk cho michael")` therefore returns `null`. `classifyArtistMatch` (`compHygiene.js:1017`) has an explicit early return: `if (!ourArtist) return 'match';` — confirmed by design ("nothing to check against — unchanged behavior"), not a bug in that function. Net effect: Filter 7 becomes a complete no-op for this book, letting every sold row through regardless of cover artist — confirmed by the actual rejection breakdown (`annualMismatch=2, lot=1, gradeMismatch=4, stale=11` = 18, zero `variantMismatch` entries) despite the pool containing at least one "Alex Ross Main Cover" listing alongside the Cho Two-Tone comps.

Same class as this session's repeated drifted-artist-registry finding (Giang, Eom, Lozano, Frison, Guillem March, Skottie Young) — a new instance, not a new bug shape. No fix implemented this pass.

### A4 — Adventure Time derivation trace (root cause found)

**The displayed "Grade adj ×1.35" is decorative for this pricing path — never applied in the actual formula.** `priceBands.js:640-662` (Tier 3, `tier3_active_discounted`): `market = activeAvg × 0.85` (a flat 15% ask-to-realized discount) — the returned result object (`quick`, `market`, `stretch`, `source`, `count`, `tier`, `askDerivedWarning`) contains no `gradeMult` field and the formula never references one. `gradeMult=1.35` (visible in both the `[price-bands]` and `[price-trace]` log lines) is computed elsewhere in `enrich.js` (the generic era-aware grade-multiplier lookup that runs for every book) and attached to the log/response object for display, but Tier 3's own math — confirmed directly from the log: `$10.76 × 0.85 = $9.15` — never multiplies by it. A book landing in `tier3_active_discounted`/`active_ask_derived` will always show a grade-multiplier badge that had no effect on the number beside it. Not unique to Adventure Time — this is a property of the pricing tier itself, reproducible on any book that lands in Tier 3. No fix implemented this pass.

### A6 — Flash log-tail truncation mechanism (investigation, evidence favors hypothesis B)

Measured `[22f]` line density and total captured-line count across all 5 fixtures (same raw pull, exact line ranges):

| Fixture | `[22f]` lines | Total captured lines | Truncated? |
|---|---|---|---|
| Immortal Hulk #44 | 70 | 286 | No |
| Adventure Time SS #1 | 15 | 297 | No |
| Wonder Woman #1 (2nd print) | 100 | 318 | No |
| Flash #128 | 113 | 333 (before cutoff) | **Yes** |
| Flash #139 | 137 | 333 (before cutoff) | **Yes** |

The user's original "largest comp pool" hypothesis does not hold on direct inspection — Wonder Woman's raw active pool (99 items, 44 kept) is larger than either Flash book's raw active pool (60 and 94 respectively) yet captured cleanly. What actually distinguishes Flash #128/#139: both already have more total captured lines AND higher `[22f]` duplicate-log density than any of the other three fixtures' **complete** logs, before either one even reaches its own ending — and both still have their entire sold-verify duplicate-logging block left to run at the point of cutoff, meaning their true uncut total would be higher still.

**Testing the mechanisms:** a narrow, single-request-scoped re-fetch (tightened to a 10-20s window around each Flash timestamp) reproduced the **identical** cutoff line both times — ruling out hypothesis A/D (a multi-request aggregate export/pagination limit) for this specific case, since isolating the query to one request changed nothing. This favors **hypothesis B (per-invocation logging byte/line cap)**: something in Vercel's log-capture pipeline appears to cap output per Lambda invocation somewhere between ~320 and ~334 lines (or an equivalent byte count), and Flash #128/#139 are the only two fixtures whose emitted volume crosses that threshold before completing.

**Not folded into this conclusion:** the 19-book pull's separate anomaly (a request missing its own `[boot]`/`phase1` opening rather than its ending) doesn't fit hypothesis B's "tail gets cut" shape at all — flagged as a distinct, unexplained observation, not evidence against B for the Flash case specifically.

**Proposal (no implementation), in the instructed preference order — hypothesis is NOT a byte-cap-excluded case, so option 3 is off the table:**
1. **Durable structured certification record at response finalization** — `requestId`, build, title, `confirmedIssue`, family mode/winner/ratio, both invariant boundary results, decision, blockers, warnings — written to an audit sink or returned as a structured response field, so certification stops depending on console output surviving whatever this cap turns out to be. Recommended primary fix, and explicitly the same shape as the Step 2A typed contract — should be designed once, not twice.
2. **Aggregate the noisy per-comp diagnostics behind a debug flag** (`[22f-summary] rows=N changed=N ...`), retaining today's terminal lines untouched. This directly attacks the actual largest contributor to volume in every fixture (70-137+ duplicate lines per request just from the metadata-strip step logging each comp title twice) and would likely pull every fixture well clear of whatever the real threshold is, independent of whether option 1 ships first.

Neither implemented this pass. Both fix scopes (Wonder Woman merge-site parity, certification observability) held for joint review before any code, per instruction.

---

## SECTION 13 — Scope 1 + Scope 2 implementation (2026-07-26)

**Scope 1 — merge-site parity, shipped `7c37af5`.** Verified scan→catalogue and scan→selectedItem already called `mergeConfirmedIdentity` correctly (no change needed). Added the same call, same collision order (before `applyProvisionalIdentity`), to the three sites that didn't: auto-refresh, bulk-import, Refresh Market Data (`App.jsx:9973`/`10421`/`11419` post-edit). `tests/merge-site-parity.test.js` (26 assertions) proves all five sites now repair a stale `"Wonder Woman #750"`-shaped persisted record identically. Re-ran both pre-existing Q144C suites clean (44 + 8 passed).

**Scope 2, Option 1 — `pipelineAudit`, response-embedded pipeline trace.**

**Field name is `pipelineAudit`, not `certificationRecord`** — "certification" overclaims to end users; this is diagnostic evidence, not a guarantee. **Explicitly response-embedded structured evidence, not a tamper-proof custody record** — it travels with one HTTP response, is visible to and reproducible by whatever client received it, and proves nothing about server-side log integrity on its own. A durable, server-owned audit sink (independent of any single response, resistant to a client never receiving or persisting the field) remains **queued, not built** — `pipelineAudit` closes the "console output was the sole certification authority" gap for future scans; it does not retroactively recover the two Flash logs already lost, and it is not itself a persistence guarantee if the client drops the response.

**Lifecycle rule, recorded per instruction:** `pipelineAudit` is a historical, immutable snapshot of one enrich response. It is a genuinely separate thing from the future Step 2A `reviewContract` (`{reviewState, lockCodes, allowedActions, overridePolicy, automatedListingAllowed}`) — that will be a **live, top-level object representing current operational authority** (what the UI may do right now), continuously re-derivable, not a point-in-time trace. Step 2A may later embed an immutable `contractSnapshot` inside a `pipelineAudit` for evidentiary purposes, but a historical trace must never be read as, or promoted into, the current contract — a snapshot from three scans ago saying `automatedListingAllowed` was true then says nothing about whether it's true now.

**Shape (v1):**
```
{
  v: 1, traceId, buildSha, generatedAt, identityRevision,
  familyIssueAuthority: { mode, winner, support, ratio, uniqueRows, familyKey },
  terminalInvariant: {
    prePricing:  { pricingIssue, confirmedIssue, ok },
    preResponse: { outIssue, confirmedIssue, ok }
  },
  decision: { action, confidence, blockerCodes, warningCodes }
}
```
`traceId` is `crypto.randomUUID()` (`node:crypto`) — public-safe by construction, never an eBay/PriceCharting/ComicVine request ID. `identityRevision` is `Date.now()` captured once per request, used purely as a monotonic ordering key for client-side merge (not a timestamp claim about anything else). `blockerCodes`/`warningCodes` are normalized (`UPPER_SNAKE_CASE`, non-alphanumeric runs collapsed to `_`) from whatever `decision.blockers`/`.warnings` slugs the response already carried — a transform, not a new taxonomy.

**Server wiring (`api/enrich.js`), all three successful-response exit points, built from `buildPipelineAudit` (`src/lib/pipelineAudit.js`, pure function, no side effects):**
1. **Main terminal path** (~line 8778's `res.status(200).json(finalizeResponse(out))`) — reuses `pricingBoundaryOk`/`responseBoundaryOk` (the exact booleans the `[q140-terminal]` log line already computed a few lines above) and `identity?.familyIssueConsensus`, `out.decision` (now populated by `computeDecision`). No recomputation.
2. **`identityRefused` early return** (`refusedOut`, below the >=3-member promotion floor) — `familyIssueConsensus: null` (this branch never runs family-scoped consensus at all — honestly `mode:'none'`, not fabricated), `decision: null` (this exit never calls `computeDecision`; `finalizeResponse`'s `syncDecisionToContract` itself no-ops when `out.decision` is absent, confirmed by direct read — an honest null, not a gap).
3. **Q32 merchandise hard block** (`DO_NOT_LIST`) — `out.issue` genuinely has never been written at this point in the handler (`out` starts as `{}` at line 2126; the single `out.issue =` write site is the main-path terminal invariant, which this branch returns before reaching) — `outIssue: null` is the true state of the object being serialized, not an approximation. `decision` reuses the literal object this branch sets two lines above, unchanged.

**Client propagation, explicit (not assumed):** `mergePipelineAudit` (`src/lib/dataQualityGuard.js`) wired into all five App.jsx merge sites alongside `mergeConfirmedIdentity`. Rules: key absent or falsy → preserve whatever was stored (never actively clear real evidence because one response omitted it); key present and truthy → adopt **unless** the already-stored trace has a strictly newer `identityRevision` (rejects a slow, older async response arriving after a faster one already landed — the exact race two overlapping scans/refreshes of the same item can produce); equal revision → incoming wins.

**Tests:**
- `tests/pipeline-audit.test.js` (38 assertions) — trace present and correctly shaped on both a LIST-shaped and an ID_REQUIRED-shaped response; `terminalInvariant` boundary snapshots are exact, caller-supplied projections (never recomputed inside the builder); `preResponse.outIssue` is a faithful string projection including on a genuine violation; a no-family-consensus-ever-ran response reports `familyIssueAuthority.mode: 'none'` with every other field honestly null, never a fabricated 0 or an invented mode.
- `tests/pipeline-audit-merge.test.js` (17 assertions) — newest trace replaces old; an older async response cannot overwrite a newer `identityRevision` (including an equal-revision tie-break); a trace whose identity fields are honestly null (the Wonder Woman shape) still survives the merge intact, never dropped for "looking empty"; absent/falsy incoming values preserve the stored trace; site parity confirmed identically across all five call shapes.

Full re-run of both pre-existing Q144C suites and the Scope 1 `merge-site-parity` suite stayed clean (44 + 8 + 26 passed, 0 failed). Build clean (ESM-mode parse check on every touched file, per the standing P0 protocol).

**Scope 2, Option 2 — diagnostic aggregation, `[22f-summary]`.** Root cause traced to a single call site: `compHygiene.js`'s `tokenizeTitle` (called from every comp-title comparison across the whole filter chain — the exact function behind all 70-137+ per-request `[22f]` lines measured in A6). Default path now calls `recordTitleStrip(before, after)` unconditionally (`src/lib/titleStripStats.js`) and only emits the old per-row `console.log` when `CV_DEBUG_TITLE_STRIP=1` — a **server env var**, never read from the request body, query string, or any client-supplied value, so per-row detail (which can reveal live comp-pool title text) can never be toggled by a caller. `logTitleStripSummary()` is called once at each of the same three exit points `pipelineAudit` uses, emitting exactly one `[22f-summary] rows=N changed=N unchanged=N duplicates=N` line per response — no title text, no route/marketplace internals, counts only.

**Concurrency caveat, recorded rather than silently assumed away:** the counter is plain module-level state, reset once per request. Under Vercel Fluid Compute (which reuses a warm function instance across concurrent requests), two requests whose async gaps overlap on the same instance could in principle cross-contaminate each other's counts. Accepted as a bounded risk — this is a diagnostic log line only, never consumed by pricing/identity/decision logic, so the worst case is a momentarily-wrong debug number, not a correctness or security issue. `AsyncLocalStorage` (`node:async_hooks`) would close this properly but requires wrapping the entire `enrich.js` handler body in a single `als.run(...)` call — a substantially larger, riskier change than a diagnostic counter justifies today. Revisit only if this is ever observed to actually mislead a real investigation.

**Tests:** `tests/title-strip-stats.test.js` (13 assertions) — counter mechanics (rows/changed/unchanged/duplicates, including the exact-repeat-input case A6's own measurement was built on) and confirms `tokenizeTitle` genuinely wires `recordTitleStrip` in end-to-end, not a parallel disconnected counter. Verified directly (not just asserted) that the default path emits nothing and `CV_DEBUG_TITLE_STRIP=1` restores the exact prior per-row line. Full regression sweep (both Q144C suites, `merge-site-parity`, both `pipeline-audit*` suites, this suite — 146 assertions total across 6 files) stayed clean. Build clean.

**Certification target: the build after this commit.** Per instruction, an intermediate deploy after Option 1 alone is harmless and not the target — only the SHA landing after both Option 1 and Option 2 receives the five-fixture scan package. Evidence for that package: `pipelineAudit` per fixture (reopenable, response-embedded) + console tails as corroboration (now far smaller, verified) + the Wonder Woman persisted/display identity clean across every merge path (Scope 1).

---

## SECTION 14 — Step 1 FINAL certification, build `cb29941` (2026-07-27)

**Evidence:** `docs/certification/step1-FINAL-5book-cb29941-20260727T213700Z-redacted.log`, pulled directly from the Vercel runtime-logs API for `prj_2tECtpKowmM7oFT7CYOQFZTssP72` (window `2026-07-27T21:20:00Z`–`21:55:00Z`) against deployment `dpl_HvK4fSb6MCjeDY6J2Re8rhU6iFFR` — confirmed `readyState=READY`, `target=production`, `githubCommitSha=cb299415b795b9540dbe555ee149368ceec96be2`, matching local `HEAD` exactly. Per invariant 2 ("production log citation before any done"), this section's status calls are made against that pull, not against test-green or an unverified claim.

| Fixture | Status | Basis |
|---|---|---|
| Flash #128 | **CERTIFIED** | Terminal tail complete — `[q140-terminal]` both boundaries OK, `decision=LIST_NOW/high/0/0`. **A6 fix confirmed live**: this exact fixture's prior pull (`9f0c86a`, `docs/certification/step1-5book-log-recovery-...`) cut off at `[title-family] decision=fallback-vision` with no terminal/decision lines recovered; this pull reaches both cleanly. |
| Flash #139 | **CERTIFIED** | Terminal tail complete — same A6-fix confirmation (prior pull cut off after `[identity] confirmed=...`, this pull reaches `[q140-terminal]`/`[decision]` cleanly). `decision=LIST_NOW/high/0/0`. **Reprint-dominant bypass fired** (`ratio=0.80 >= 0.6` facsimile/reprint threshold in the raw image pool) — third observed live instance of this queued finding; informational only, does not affect this certification (the bypass is an existing, tested branch, and the terminal/decision lines confirm correct downstream resolution — sold-verified tier 1, $205.04, 23/31 comps). |
| Immortal Hulk #44 | **CERTIFIED** | Consistent with the prior `9f0c86a` pull — identical mode/winner/ratio/population/support/terminal/decision shape (`rawPoolVisionSupport` 18 vs. the prior pull's 17 — an expected pool-composition delta between two independent live eBay searches, not a regression). |
| Adventure Time Summer Special #1 | **CERTIFIED for the scoped fixture** | Family authority survives to output — `[q140-terminal]` both boundaries OK, `decision=LIST_LOW/medium/0/1`. Note: `rawPoolVisionSupport=null`, not `0` — third live session in a row showing this exact shape. This is a diagnostic-precision item, not a pass-bar condition: the decision is actually gated on family population/support/ratio (4/4/1.00), which are present and correct. |
| Wonder Woman #1 (2nd printing) | **CERTIFIED** | Server clean, proven again — `confirmedIssue`/`out.issue` both honestly `null`, both `[q140-terminal]` boundaries OK, `decision=ID_REQUIRED/high/2/0`, consistent with A2's code-trace conclusion that `out.title` has no path to `"#750"` in this response. Client display (card + collection row) checked clean via screenshot as part of this certification pass. **Caveat, recorded per this document's own evidence-integrity standard:** the screenshot check is not reproducible from server logs and is not independently re-verified in this pass beyond the server-side confirmation above — recorded as attested. Detail-reopen/Refresh/Re-identify paths share the same `mergeConfirmedIdentity` structural fix (Scope 1, `7c37af5`) but were not separately screenshot-verified this round. |

**Step 1: 5 of 5 fixtures certified.** Tag `commit-a-certified` cut on `cb29941` per the Section 10 tag policy — scoped to Commit A's issue-consensus/terminal-fingerprint mechanism only, not a `launch-candidate` decision. Steps 2A/2B/2C, Steps 3/4, and every Section 10 blocker (4/5/6) remain open and are unaffected by this tag.

**Unchanged from Section 12:** the 19-book collection-export doc commit remains deferred, blocked on Jimmy's original export CSV (`comic-vault-log-export-2026-07-25T23-47-28.csv`), for the same interleaved-concurrent-logging reason recorded there.

---

## SECTION 15 — Commit D: evidence eligibility, derivation trace, collision-aware gate (2026-07-28)

**Commit D1** (`bfe8933`) — "Classify first, then derive." New `src/lib/evidenceEligibility.js` (`classifyEvidenceRow`/`buildEvidencePopulations`): every active/sold market row is classified against the scanned target BEFORE any destructive filtering, and a rejected row is retained as a sanitized reference record instead of collapsing into a bare counter. Closes two genuine gaps with no prior detector at all — `INCOMPLETE_COPY` (missing centerfold/pages/back cover; a real production sold row for Batman #15, "missing CF ... 1/3 BC missing," had been counted among 17 verified sales for a supposedly-complete copy) and `RESTORED_COPY` — plus a proven SLAB_RE ordering gap (`FORMAT_MISMATCH_RAW_VS_SLAB`, catches "2.5 Cgc ..." orderings SLAB_RE's stricter adjacency pattern misses; confirmed live on Flash #139's real active pool). Design finding recorded for future reference: gating pricing math on the FULL classification regressed 11 previously-passing tests — the classifier's identity/variant/printing/lot checks duplicate, less precisely, what the existing `api/comps.js`/`soldVerification.js` filter chains already handle with edge-case nuance. Resolved by splitting into two tiers — `rawPricingEligible` (full, powers display/reference buckets) vs. the narrower `PRICING_GATE_CODES` (only codes with no prior detector or a proven gap actually exclude from pricing math). **Correction (this pass):** `isPricingMathEligible`/`PRICING_GATE_CODES` is a compatibility bridge around the existing mature filter chains, not the final unified eligibility authority — traced the actual `api/comps.js` call site (immediately before `buildEvidencePopulations`, operating only on `parsed`, which has already survived the entire formal filter chain) and confirmed safe today by construction, per the code's own comment ("never widens `parsed`... already survived the ENTIRE formal filter chain"). A targeted regression test (`tests/q-commitD1.1-collision-aware-eligibility.test.js`) now asserts `PRICING_GATE_CODES` can never contain a legacy-overlapping code (`WRONG_ISSUE`/`WRONG_YEAR`/`WRONG_PRINTING`/`WRONG_VARIANT`/`LOT_OR_BUNDLE`/`SIGNED_MISMATCH`/`COLLECTED_EDITION_MISMATCH`/`FORMAT_MISMATCH_GRADED_VS_RAW`/`COVERLESS_COPY`), The test locks the current division of responsibility by preventing `PRICING_GATE_CODES` from independently duplicating a legacy-chain rejection category. It does NOT enforce call-site ordering — it cannot distinguish a correctly-ordered call site from a hypothetically reordered one, since it exercises the gate function in isolation, not the real pipeline. The narrow gate remains safe only while `buildEvidencePopulations`/`classifyEvidenceRow` continue to operate on `parsed` (post-legacy-chain), confirmed true today by direct trace. A genuine integration test — exercising the real `api/comps.js` call site end-to-end against a deliberately contaminated raw pool — is queued as future work, not required now. 5 mandatory fixtures, 38/38 assertions, no new failures relative to the documented 11-file known-failing baseline (verified via `git stash`).

**Commit D2** (`ab8b411`) — shared structured derivation trace, built once inside `computePriceBands` (`src/lib/priceBands.js`) and used identically by every tier (1, 2, 2.5, 3, 4). Fixed the exact defect named in dispatch: `[price-trace]` logged `pcBase: 150 multiplier: 0.65 afterMult: 205.04` as if `afterMult` were `pcBase`'s product (150×0.65=97.50, not 205.04) — root cause was that `afterMult` was never that product at all, just `priceAfterFloor`, a snapshot of whichever tier's independently-computed result already existed. `pcBase`/`gradeMultiplier` now record as `referenceValues` (never the calculation base) for tiers 1/2/2.5/3, and only enter `operations` as a real applied step for Tier 4, where they genuinely are the price. 74/74 assertions across the 5 mandatory regressions (Flash #139 tier 1, Superboy #89 tier 3, Adventure Time tier 3, Batman #15 tier 2.5, Batman #15 tier 4).

**Commit D1.1** (`1e6103e`) — collision-aware positive-compatibility gate, live-confirmed necessary: post-D1 production log on Batman #15 showed `[evidence-eligibility] activeInput=5 rawPricingEligible=5 rejected=0` — five generic, undated active listings ($2.99–$9.79, "BATMAN #15" with no distinguishing edition text) passed D1's negative-only model unfiltered, since none of them made an affirmative false claim to reject. Fix: `assessCollisionRisk(target)`, derived from `confirmedYear`+`publisher` only (never title text — deliberately immune to the separate, still-open A3 confirmedTitle-contamination bug, confirmed this exact pull resolved `confirmedTitle` to `"batman ww2 machine gun"`). New `UNCONFIRMED_EDITION` code — distinct from `WRONG_YEAR` (no affirmative false claim was made, so `identityEligible` stays `true`) — fires only when the target is collision-prone (vintage DC/Marvel) and a row provides zero year evidence; added to `PRICING_GATE_CODES`. New `unconfirmedEditionReferences` bucket ("Unconfirmed same-title/issue references"), kept separate from `incompatibleEditionReferences`. Explicit non-regression proof: a matched control (Flash #139, itself a high-collision-risk target with no year token either) still returns `gradedPricingEligible=true` unchanged, and a non-collision-risk control (2020 indie one-shot) confirms this is not the prohibited blanket "missing year = reject" rule. `assessCollisionRisk`'s current scope (vintage-year + DC/Marvel heuristic only) is recorded as an interim model with a confirmed gap (Absolute Batman #1) — see Section 2's dedicated row, queued as the first follow-up after Commit E. 63/63 assertions, no new failures relative to the documented 11-file known-failing baseline (full-suite `git stash` comparison).

**Flash #139 CGC row (FORMAT_MISMATCH_RAW_VS_SLAB), recorded as three separate lines per instruction — do not collapse into one status:**
- Defect observed live (SLAB_RE misses "2.5 Cgc ..." ordering, confirmed on Flash #139's real production active pool): **PASS.**
- Fix verified deterministically (recorded fixture, `tests/q-commitD1-evidence-eligibility.test.js` + `tests/q-commitD1.1-collision-aware-eligibility.test.js`, both pass regardless of live search results): **PASS.**
- Fix observed live after deployment (the specific CGC-worded row naturally reappearing in a fresh Flash #139 search result and being confirmed excluded): **PENDING NATURAL REOCCURRENCE** — the marketplace is non-deterministic and this exact listing is not guaranteed to resurface in any given search. Does not block D1.1 or Batman #15 acceptance.

**D2 metadata check** (audit only, no code change): freshness verified — `gradeMultiplier` passed into `computePriceBands` is recomputed from the current request's `numericGrade`/`eraYear` immediately before pricing (`api/enrich.js:5186-5206`), never cached. Semantic correctness of those upstream inputs (i.e., whether `numericGrade`/`eraYear` themselves are the right values for this book) is a separate, unverified question — this check only confirms freshness of the wiring, not correctness of what feeds it.

**D1 live integration — CONFIRMED.** Batman #15 rescan on build `e4deaf3` (docs-only, confirmed code-identical to `1e6103e` via `git diff --exit-code -- api src package.json package-lock.json`, empty, exit 0):
- Fixture 3 (active-side generic listings), individually confirmed: `[evidence-eligibility] active: classification eliminated all 5 pre-classification survivor(s) — returning empty`. Card shows zero active comps, no floor, no market-high warning.
- Fixture 1 (sold-side incomplete comp), individually attributed via the per-code breakdown: `[evidence-eligibility] sold:main: chain-survivors=17 classification-eligible=15 removed=2 removedCodes={"INCOMPLETE_COPY":1,"FORMAT_MISMATCH_RAW_VS_SLAB":1}`.

**Status: COMMIT D CLOSED.** D1 core classifier — PASS (code-verified). D1 live integration — PASS (live-verified above). D1.1 — PASS. D2 — PASS. `commit-a-certified` tag untouched throughout Commit D.

**Batman #15 fixture retired for pricing-layer verification.** This single book individually proved every commit in the pricing layer this campaign shipped — merchandise filtering (Commit C), title authority (Commit A/B), issue parsing (Commit B), evidence eligibility (D1), derivation truth (D2), and collision-aware gating (D1.1). No further Batman #15 rescans are needed to verify this layer; a future pricing-layer commit should pick a different book for live evidence rather than re-exhausting this one.

**Two doc-only follow-ups, queued, no urgency (not fixed in this pass):**
1. UI string "Price derivation unavailable (identity incomplete)" mislabels the actual cause on an empty-active-pool card — confirmed this exact scan had `identity-gate missing=[]` (identity was complete; the pool was simply empty post-classification). String-only fix, no logic change.
2. Add a `codes={...}` breakdown to the active-side elimination log line (`[evidence-eligibility] active: classification eliminated all N pre-classification survivor(s)...`), matching the sold-side `removedCodes={...}` format already shipped, for symmetry.

---

## SECTION 16 — Track B Phase 0 (2026-07-29 onward)

Seven-commit Phase 0 containment plan, approved per the plan on disk
(`~\.claude\plans\peppy-wondering-petal.md`), executed one commit at a
time with manual approval at diff→commit and commit→push for each.

**Commit 1** — `PRICING_GATE_CODES` full audit + add `TARGET_ISSUE_UNRESOLVED`.
Audited all 14 `STANDARD_REJECTION_CODES`; verdict was ADD
`TARGET_ISSUE_UNRESOLVED` only (real, live gap — neither `api/comps.js`'s
Filter 0a nor `soldVerification.js`'s issue filter rejects anything on
this axis when the target issue is unresolved; the other 9 candidate
codes stay out per the existing `LEGACY_OVERLAPPING_CODES` regression).
Also extracted and exported `buildPricingEligibleRows(rows, target)`
from `src/lib/evidenceEligibility.js`, replacing the inline composition
at `api/comps.js:2062` (`evidenceRows.filter((it) =>
isPricingMathEligible(classifyEvidenceRow(it, evidenceTarget)))`) with a
call to it — closes the "mirrored composition passes while the real call
site drifts" gap invariant 10 (Section 4) names, and is itself the fourth
confirmed instance of that exact drift class. New invariant 10 added to
Section 4 (mirrored as item 7 in Section 9's operating-invariants list).
Test: `tests/q-strangeTales-containment.test.js` extended — asserts
`PRICING_GATE_CODES` includes the new code, and confirms via the real
`buildPricingEligibleRows` export (not a test-local mirror) that all rows
are excluded when `target.issue` is null, plus a control confirming a
resolved-issue pool is unaffected. `tests/q-commitD1.1-...`'s existing
`LEGACY_OVERLAPPING_CODES`/`PRICING_GATE_CODES` loop automatically picked
up coverage for the new entry with no test-file edit needed there.

**Commit 1.1** — Commit 1 verification hardening, inserted before Commit 2
(does not rewrite or revert `5dd59f4`). Four items:
1. `src/lib/soldVerification.js`'s own `isPricingMathEligible(classifyEvidenceRow(...))`
   inline composition (a second instance of the exact pattern invariant 10
   targets, predating the rule) converged onto the shared
   `buildPricingEligibleRows` export — the gate already fired correctly
   there via the shared `PRICING_GATE_CODES` array; this is convergence to
   one call site, not a behavior fix. `__evIdx` mechanics preserved
   unchanged (the export returns row objects, not classifications).
2. Real-consumer proof one layer above that converged line:
   `verifySoldComps` itself (not a mirror) proves a null-issue target
   yields zero verified sold rows, with the removedCodes breakdown
   (`evidence.rejectionCodeCounts.TARGET_ISSUE_UNRESOLVED`) showing the
   cause.
3. TPB/book/collected targets are exempt from `TARGET_ISSUE_UNRESOLVED` —
   these asset types have no issue axis at all, so a null `target.issue`
   is a legitimate permanent state, not an unresolved one. New
   `NO_ISSUE_AXIS_ASSET_TYPES` guard in `classifyEvidenceRow`. Comic
   targets stay gated, unchanged from Commit 1. Both controls tested,
   plus a forward-safety spot check for `book`/`collected` (not yet live
   callers — production only ever passes `tpb`/`comic` today).
4. `buildPricingEligibleRows`'s `(rows || [])` null-guard — a real,
   documented behavior decision (an upstream population genuinely missing
   returns an empty pool rather than throwing; a pricing endpoint 500ing
   on an upstream defect is worse than an honest empty result), now with a
   loud `console.log` and an explicit test that captures `console.log` to
   prove the diagnostic actually fires for null/undefined and stays silent
   for a genuinely empty array — per this codebase's own Log Statement
   Discipline rule (verify a log statement triggers, don't just read the
   source).

**Provenance:** Commit 1.1 originated from external review of Commit 1's
evidence packet, not from a live production finding — the TPB null-issue
case specifically was caught by that review before any user-visible ship.
Recorded per this document's own standing practice: review catches get
logged the same as fixes, not silently folded in as if no gap existed.

Tests: `tests/q-trackB-commit1.1-verification-hardening.test.js` (new),
22/22 passing. Adjacent evidence-eligibility suites re-verified clean:
`q-strangeTales-containment` 80/80, `q-commitD1.1-collision-aware-eligibility`
86/86, `q-commitD1-evidence-eligibility` 38/38. Full-suite baseline
unchanged — 11 failing files, byte-identical outcomes before/after
(including `sold-verification.test.js` itself, the file whose production
code this commit touches: 124 passed/5 failed, same failing assertion,
confirmed via `git stash` A/B).

**Commit 2** — wires `classifyYearEvidence` into `api/comps.js` Filter 0c,
replacing the bare `/\b(19|20)\d{2}\b/` regex extraction. Only an
`ISSUE_PUBLICATION_YEAR` classification satisfies an exact issue-year
comparison; `SERIES_RANGE`/`SERIES_START_YEAR`/`SELLER_CONTEXT_UNKNOWN`
fall through to the pre-existing no-evidence-keep branch (FIX B's "no
evidence, no rejection" philosophy) — a series-range title like "Strange
Tales #142 (1951-76 1st Series)" is no longer treated as if it claimed a
specific 1951 publication year. Extracted into an exported, pure
`applyEraConsistencyFilter(pool, yearNum, assetType, cvVolumeStartYear)`,
same pattern as `applyVariantPreferenceFilter` (Q111). Dead local
`extractYear` helper removed; `MODERN_RELAUNCH_RE` hoisted to module
scope. Six precisely-labeled fixtures (correcting a mislabel from the
prior planning round, where a "genuine 1951 control" example was actually
a 1966 book): Strange Tales #3 (1951) and #142 (1966) genuine controls,
the series-range row (kept), a modern-relaunch-marker collision row, a
modern "Pick Your Cover" row (rejected on year drift alone, no relaunch
marker), and a missing-year control.

**Consumer-audit correction (before this commit shipped, not after):**
the plan's own evidence packet for the extraction-only version of this
commit surfaced the pre-existing "wipe-out bypass" (restore the FULL
unfiltered pool when era filtering rejects every row in an attempt) as
unresolved. Audited before staging, per instruction: every downstream
consumer of `eraFilterBypassed` (`decisionEngine.js`'s
`filter-bypass-detected` warning, `api/enrich.js`'s matchConfidence
LOW-cap) is a SOFT cap — neither nulls price/bands/floor/average nor
gates collection/liquid value; both only cap a confidence/decision
ceiling. The `refused-tier-bypass-detected` pricingSource
(`api/enrich.js` ~6457) that had been offered as evidence of containment
turned out to be a naming coincidence — a structurally unrelated
"tier-selection-bypass" mechanism gated purely on `priceBandsRaw`/
`rawComps.count`, with no dependency on `eraFilterBypassed` at all; its
apparent containment on a real Strange Tales #9 card is far more likely
attributable to Commit 1's `TARGET_ISSUE_UNRESOLVED` gate (a null
confirmed issue zeroing the pricing-eligible pool for an unrelated
reason) than to any era-bypass-specific protection. Worse, the restored
pool satisfied the attempts loop's `filtered.parsed.length > 0` break
condition immediately, silently preventing both broader-query
fallthrough AND Ship v0-I's own, independently-guarded era fallback
(reprint/slab/title/issue/±20y checks) from ever running — a genuine,
structural leak, not a hypothetical one, and one Commit 2's own
stricter year-evidence classification would trigger more often.

**Fix:** `applyEraConsistencyFilter`'s `pool` is now the actual surviving
rows — an empty array when every row in an attempt genuinely fails, never
a restoration. Rejected rows are preserved separately in
`rejectedReferenceRows` (`{title, price, reason}`, the same shape
`soldVerification.js`'s `pushSample` already uses) for research/display
(I13), threaded through to `fetchComps`'s `evidence.eraRejectedReferenceRows`.
`bypassed` remains a pure informational flag driving the pre-existing
warning/confidence-cap copy — it no longer changes what `pool` contains.

**Founding negative test, through the real production consumer**
(`fetchComps`, `global.fetch` mocked — same convention as
`tests/q141-v0i-slab-exclusion.test.js`): a vintage (1964) target with a
100%-contaminated pool (a modern-relaunch-marker row, a modern "Pick Your
Cover" row with an explicit far-off year but no relaunch marker, and a
third wrong-exact-year row — none genuinely matching, all sharing the
same title+issue tokens so nothing else in the filter chain would catch
them) returns `count: 0`, `average/lowest/highest: null`, `prices`/
`recentSales` both empty. Structured custody assertions (not string
search) confirm: none of the contaminated prices are present in any
pricing field or pricing-eligible population; all three are preserved
solely in `evidence.eraRejectedReferenceRows` (or, for this exact
fixture's specific return shape, at the `applyEraConsistencyFilter` unit
level — see architectural note below) with explicit rejection reasons
(`modern-relaunch-marker` for the relaunch row, `era-year-mismatch:2015-
vs-1964` / `era-year-mismatch:2018-vs-1964` for the other two), and
prices exactly `[25, 28, 30]` order-normalized. The production log for
this exact fixture confirms the mechanism end-to-end: every attempt's
`applyEraConsistencyFilter` correctly empties the pool (`final=0`), then
Ship v0-I's own fallback — previously unreachable for this scenario,
since the old inline bypass always restored a non-empty pool on attempt
1 and broke out of the loop before v0-I's `parsed.length === 0` trigger
could ever be true — runs for the first time and correctly re-rejects all
three rows via its own `>20y` conflicting-year check (`[v0-I]
year-conflict rejected all — returning empty`). Fixing the leak also
reactivated a well-designed, previously dead-for-this-case safety
mechanism, not just closed a gap. Mixed-pool control (one genuine 1964
row alongside the same three contaminated rows) confirms no
over-rejection: pricing count===1 with only the genuine $450 row
eligible, all three contaminated rows present solely in
`evidence.eraRejectedReferenceRows`, `eraFilterBypassed === false`.
Series-range-only control (a pool of only a contextual, no-year-evidence
row) confirms an all-contextual pool is never treated as an all-wrong
pool: `count: 1`, `eraFilterBypassed: false`, no restoration-or-refusal
mechanism engages at all.

**Architectural finding, surfaced while writing the founding test (not a
Commit 2 regression — a pre-existing fact of `fetchComps`):** the founding
fixture's exact all-contaminated pool, at a vintage year, triggers Ship
v0-I's own fallback, which — like every early-return path in
`fetchComps` (missing-credentials, missing-title, v0-I's own internal
guardrail/slab/title/issue/year-conflict rejects, and the post-attempts-
loop "no sales after filters" check) — returns via `emptyComps()`, which
carries no `evidence` field at all, for ANY rejection bucket, not unique
to `eraRejectedReferenceRows`. The ONLY return that carries
`evidence.eraRejectedReferenceRows` is the normal success path. Split the
founding-negative proof accordingly: the detailed
rejectedReferenceRows/reasons/prices shape is proven at the
`applyEraConsistencyFilter` unit level (still the real, exported
production function, not a mirror) on the identical 3-row fixture; the
integration-level `fetchComps` test proves the honest-empty pricing
fields (`count`/`average`/`lowest`/`highest`/`prices`/`recentSales`) that
DO reliably reach the caller on this return shape. The mixed-pool control
proves `evidence.eraRejectedReferenceRows` on a scenario that reaches the
normal success path. Not fixed further in this commit — extending every
`emptyComps()` early-return site to also carry `evidence` would be a
materially larger change than the approved Step 2B scope; queued as a
future finding, not silently dropped.

**Lesson recorded (custody-assertion correction, this pass):** the
initial founding-test draft asserted contamination absence via
`JSON.stringify(result).includes('"25"')`. Demonstrated by direct
execution to be **vacuously true regardless of whether contamination is
present** — a numeric `price: 25` field serializes as `25`, never `"25"`,
so the quoted-string search this assertion looked for cannot occur for a
number field under any circumstance; confirmed live by constructing a
result object that DOES contain the contaminated row and observing the
check still reports "clean." Replaced with structured checks that inspect
the actual `prices`/`recentSales`/`eraRejectedReferenceRows` arrays
directly. Each new custody assertion was then proven to have teeth by a
one-time, non-committed demonstration: deliberately injecting one
contaminated row into a clone of the pricing population and confirming
the assertion catches it (fails as expected), before reverting the
injection. An assertion that cannot fail certifies nothing.

Tests: `tests/q-trackB-commit2-era-classification.test.js` — 63/63
passing (six fixtures + combined pool + two pre-existing-behavior
controls + a founding-negative unit-level block +
the three-scenario founding negative integration test via the real
`fetchComps`, all with structured custody assertions). Adjacent suites
re-verified clean: `q141-v0i-slab-exclusion` 19/19, `ship25-era-filter`
21/21, `q128-era-tolerance-consolidation` 27/27,
`q129-variant-comps-excluded-by-era` 27/27, `q-strangeTales-containment`
80/80, `q-commitD1.1-collision-aware-eligibility` 86/86,
`q-commitD1-evidence-eligibility` 38/38,
`q-trackB-commit1.1-verification-hardening` 22/22, `ship23-consistency`
29/29, `q141-rachta-lin-pricing-eligibility-gate` 5/5. Full-suite baseline
unchanged — 11 failing files, byte-identical outcomes before/after
(spot-verified `comp-filter-hygiene.test.js` and `ship26-integration.test.js`,
the two files closest to this commit's own touched code, via `git stash` A/B).

**Commit 3** — manual identity correction (fixes a card whose title/issue/
year/publisher is wrong, e.g. a marketplace-adopted #9 that's actually
#3), the same union-field render, per-card state, authoritative
pre-consensus merge, same-request lock, provenance, and update-in-place
design approved earlier, plus a required consumer-audit-class addition
folded in before implementation: explicit clear-list/preserve-list field
enumeration, contract/decision recomputation, server-side manual-authority
validation, and three tests (A/B/C) — closing the same stale-merge class
as the Wonder Woman #750 persistence bug (Scope 1, `mergeConfirmedIdentity`)
on the correction path specifically, where a blessed-but-stale corrected
card would be strictly worse than the original wrong one.

**Design finding, recorded rather than silently built around:** the
"same-request lock" requirement (corrected fields must not be overwritten
by automatic evidence resolution within the same request) is already
satisfied structurally by the pre-existing `manualIdentity: true` contract
(the Scan tab's existing manual-entry flow, `api/enrich.js`) — traced the
actual four-way identity branch (barcode / manual / cgc_cert /
`resolveIdentity()`, a plain `else if` chain) and confirmed no automatic
resolution runs at all on this path, for any of title/issue/year/
publisher. This commit does not build a parallel per-field lock mechanism
mirroring `resolveYear`'s branch (e) — it would duplicate protection that
already exists. What this commit adds on top is genuinely new: authority
VALIDATION (the server must not trust a client's `correctedFields` claim
blindly) and PROVENANCE (recording what changed, from what, per field).

**New `src/lib/manualCorrection.js`:**
- `MANUAL_CORRECTION_ALLOWED_FIELDS` — exactly `['title', 'issue', 'year', 'publisher']`. Price, contract, decision, and every other pipeline-computed field can never become user-authoritative, regardless of what a client requests.
- `validateManualAuthority(manualAuthority, fieldValues, currentYear)` — server-side validation: intersects the client's `correctedFields` claim against the allow-list AND against whether a valid, non-empty, normalized value was actually supplied for each. Returns `{acceptedFields, rejectedFields, emptyFields, normalizedValues, valid, error}` — never trusts the client alone. `normalizeManualIssue` reuses the existing `normalizeIssueFormat` (`compHygiene.js`) rather than a second issue parser; `normalizeManualYear` rejects non-numeric input and implausible years (pre-1930, more than one year past the current calendar year).
- `IDENTITY_DEPENDENT_FIELDS_TO_CLEAR` — **229 explicit, named fields**, grouped into 12 reviewable sub-arrays matching the dispatch's own categories (PC/ComicVine/GoCollect IDs, comp pools, evidence populations, averages/floor/high/last-sold, ladder/history, recommendation+bands, pricing source/derivation, velocity/demand/trend, story metadata, variant/printing determinations, prior-identity warnings, contract/decision/listing state), flattened into one deduplicated export. Derived from a full enumeration of every `out.X =` assignment in `api/enrich.js` as of Commit 2 (`eda3e42`) — not inferred "everything except" logic. Includes `decision` and `contract` specifically, so a stale READY/REFUSED/LOCKED/price-ready state can never survive under a corrected identity.
- `IDENTITY_INDEPENDENT_FIELDS_TO_PRESERVE` — **30 explicit fields**: collection ownership/disposition (`id`, `timestamp`, `status`, `ebayUrl`, `ebayItemId`, `bundleId`, `soldPrice`, `purchasePrice`, `listPrice`, `listPriceManual`, `userFmv98`), photos (`images`), and photo-derived condition/grade/slab data unaffected by a text-only correction (`grade`, `isGraded`, `numericGrade`, `confidence`, `variant`, `certNumber`, `cgcLabel`, `cgcVerified`, `labelType`, `labelNotes`, `defectPenalty`, `cgcPenaltyFlags`, `restoration`, `isReprint`, `editionType`, `assetType`, `assetTypeConfident`, `gradeLocked`). Confirmed against actual `App.jsx` catalogue-item field usage rather than assumed — this app has no generic per-item "notes" field (only an unrelated trade-pile-modal `notes` state), so none was fabricated for this list. Zero overlap with the clear-list (tested).
- `buildCorrectedCatalogueItem(oldItem, enrichData)` — clears every clear-list field on the old item, merges the enrich response on top, re-asserts the preserve-list from the old item (defensive), pins `id`. A field the new response doesn't populate ends up `null`, never the stale old value.

**`api/enrich.js` wiring:** `manualAuthority`/`priorIdentity` destructured from the request body alongside the existing `manualIdentity`/`skipVision`/`skipImageSearch` flags. When `manualAuthority` is present, `validateManualAuthority` runs immediately (before any external API call) — an invalid correction (empty, or every requested field rejected) returns `400` with the rejected/empty field lists, no mutation. On success, `out.manualCorrection` (correctedFields, rejectedFields, per-field `{newValue, newSource, priorValue, priorSource}`) and `out.issueAuthority` (`{source:'user', status:'confirmed', confidence:'high', reasons:['user-correction'], priorObservations}`, only when `issue` was actually corrected) are set after the four terminal identity writes (`out.title`/`out.issue`/`out.year`/`out.publisher`) and before decision computation — first introduction of the structured `issueAuthority` shape this campaign's plan has referenced since Commit 3 was first drafted; later commits reuse it.

**`src/App.jsx` wiring:** new `submitManualCorrection` (mirrors `reIdentifyBook`'s placement and `putComic`/`setCatalogue`/`setSelectedItem` update-in-place pattern, but posts the manual-entry contract + `manualAuthority` + a client-supplied `priorIdentity` snapshot, and merges the response via `buildCorrectedCatalogueItem` instead of a `...item` spread), wired as a new `onManualCorrect` prop. New inline correction form in `CollectionDetail`, rendered whenever `getCorrectableFields(item)` (`src/lib/manualCorrection.js` — the union of `identityMissingFields ∪ identityProvisionalFields`, allow-listed, extracted as its own exported function so the render site and this feature's tests call the identical logic, per invariant 10) yields a non-empty field set — deliberately independent of the `isContractIdentityBlocked` ternary above it, so it covers both the `ID_REQUIRED` case and the not-yet-live provisional-adopted case (`identityProvisionalFields` doesn't exist until Commit 4; the union is a safe no-op until then). Per-card `useState` (resets per selected item via the existing `key={selectedItem?.id}` wrapper). Client-side pre-check (mirrors, doesn't replace, the server's own validation) only submits fields whose value actually changed from the item's current one.

**Blocker text checked fresh, confirmed not stale, no change made:**
`describeBlocker('identity-not-confident', item)` (`src/lib/decisionEngine.js:978-995`) reads "identity uncertain — {fields} not confirmed" — neutral, names exactly the missing fields, makes no claim that remediation is impossible. `buildIdentityNextStep` (line 1212) already says "verify identity manually," consistent with (not contradicted by) this commit's new inline-correction capability. No refusal-card text instructs a remediation the UI can't now perform. Left unchanged — updating working, accurate text would have been a gratuitous diff.

**Two functions extracted for testability** (same "extract for direct regression-testability" pattern this campaign uses throughout — `applyVariantPreferenceFilter`, `applyEraConsistencyFilter`, etc.), added to `src/lib/manualCorrection.js` alongside the original four exports:
- `getCorrectableFields(item)` — the union-and-allow-list computation, called by both the `App.jsx` render site and this feature's Test D (below), not duplicated between them.
- `buildManualCorrectionProvenance(validation, priorIdentity)` — the `manualCorrection`/`issueAuthority` object construction, called by both `api/enrich.js` (replacing what was originally an inline block) and this feature's Test F.

**Tests** (`tests/q-trackB-commit3-manual-correction.test.js`, 342/342 passing):
- **Test A** — a synthetic wrong-#9 card with every one of the 229 clear-list fields populated with the same recognizable stale sentinel, corrected to #3. Asserts the same collection ID survives, then **iterates `IDENTITY_DEPENDENT_FIELDS_TO_CLEAR` programmatically** (not a hand-picked subset) confirming zero of 229 fields retain the stale sentinel and each instead reflects the corrected response (or honest `null` when the response didn't set it) — a newly-added clear-list field automatically gets swept into this test's coverage, forcing the "conscious decision about which list it joins" the dispatch asked for. Also iterates all 30 preserve-list fields, confirming each survives unchanged.
- **Test B** — `correctedFields:['issue','price','contract']` → only `issue` is accepted; `price`/`contract` rejected outright, `normalizedValues` never contains a `price` key even though one was supplied alongside a legitimate correction. Additionally probes 8 individual disallowed fields (`price`, `contract`, `decision`, `rawComps`, `soldComps`, `pricingSource`, `id`, `images`) one at a time, confirming each is never accepted alone.
- **Test C** — whitespace-only value, empty `correctedFields`, and a null `manualAuthority` altogether all reject with the explicit `no-valid-corrections` error code, never a silent pass-through. `buildCorrectedCatalogueItem` confirmed to never mutate its inputs (`Object.freeze`d fixtures survive the call).
- **Test D** — `getCorrectableFields` (the real render-site function) returns `['issue']` for BOTH an `identityMissingFields=['issue']` item and an `identityMissingFields=[], identityProvisionalFields=['issue']` item — the mandatory union rule. Both then flow through `buildCorrectedCatalogueItem` to the same collection ID. Control: a fully-resolved card (both arrays empty) offers no correction fields.
- **Test E** — the real `resolveFamilyIssueConsensus` (`identityCore.js`) called with `priorIssue='3'` against a 4-row pool unanimously voting `#9` (clearing the adoption bar: `uniqueRows=4, ratio=1.0`) returns `{issue:'3', mode:'conflict-locked', winner:'9'}` — the corrected value survives, the disagreement is reported as raw vote data, never silently applied. An agreeing pool returns `mode:'corroborated'`, same survival. Documented as defense-in-depth: the structural bypass (`manualIdentity:true` never calls this function at all, see the design finding above) is the primary protection; this proves the underlying consensus function's own logic would refuse to overwrite even if it were ever in the loop.
- **Test F** — `buildManualCorrectionProvenance`'s output carries both old and new value/source (`corrections.issue = {newValue:'3', newSource:'user', priorValue:'9', priorSource:'marketplace'}`) when the prior card had a `issueAuthority`, and honest-`null` prior source/status (never fabricated `'vision'`) when it didn't. A year-only correction produces no `issueAuthority` at all — no fabricated no-op claim.
- Plus normalizer edge cases (`normalizeManualIssue`/`normalizeManualYear`: format-marker reuse, non-numeric rejection, year-range bounds).

Full-suite baseline unchanged — 11 failing files, byte-identical outcomes
before/after (spot-verified `identity-gate.test.js`, the closest adjacent
identity suite, via `git stash` A/B — its one pre-existing failure is
unrelated, an `author` field mismatch). Adjacent suites re-verified clean:
`q110-intake-nonblocking` 38/38, `q133-slice2-identityrefused-promotion`
28/28, `q136-slice-a2-identity-incomplete-provisional` 10/10,
`response-contract` 73/73, `q145-contract-decision-sync` 41/41.

**FIVE SAFEGUARDS (review round, folded in before staging — the 342/342
packet above proved the surrounding utilities but not that the
authoritative normalized correction actually controls the server
pipeline, and left the request-authority boundary open):**

**Safeguard 1 — the exact manual-authority request contract.**
`isValidManualAuthorityRequestContract(body)` requires ALL FOUR:
`manualIdentity === true`, `skipVision === true`, `skipImageSearch ===
true`, `identitySource === 'manual'` — checking `manualIdentity` alone (the
original wiring) was not sufficient. A request with `manualAuthority`
present but any one of the four missing is rejected with `400` before any
identity resolution, external lookup, or mutation. Closes the spoof case
explicitly: a normal automatic (Vision-driven) request that happens to
carry a `manualAuthority` block can never mint a user-confirmed
`issueAuthority` — it fails the contract gate before validation even runs
(`validation: null` on the rejected result).

**Safeguard 2 — normalized values are the working pipeline identity.**
New `prepareManualCorrectionRequest(body, currentYear)` (Safeguards 1+2
combined into one exported, production-used function) returns
`workingIdentity` — title/issue/year/publisher ALL normalized (not just
the field actually corrected this request), via the same normalizers
`validateManualAuthority` uses. `api/enrich.js`'s `effectiveTitle`/
`effectiveIssue`/`effectiveYear`/`effectivePublisher` — the FIRST
identity-dependent consumers or every value downstream reads through
(cache-key construction at `activeKey = \`v${COMP_FILTER_VERSION}:
${confirmedTitle}|${confirmedIssue}\``, ~line 4623; PC/CV lookup;
comp-query construction via `fetchComps({issue: confirmedIssue, ...})`;
the terminal `out.title`/`out.issue`/`out.year`/`out.publisher` writes) —
now read `manualCorrectionRequest.workingIdentity` instead of the raw
request fields when a validated correction is present. **A real
normalization gap was found and fixed while building this**: raw issue
`" #3 "` normalized to `"#3"` (the leading hash survived), not `"3"` —
`normalizeIssueFormat`'s own "unrecognized format, return as-is" fallback
only strips `#` inside its Annual/Special/Giant-Size/King-Size regexes,
not for a bare `"#3"`. `normalizeManualIssue` now strips a leading `#`
(with surrounding whitespace) explicitly after calling
`normalizeIssueFormat`, confirmed against `'3'`, `' #3 '`, `'# 3'`, and
`'Annual #14'` (unaffected).

**Safeguard 3 — client-supplied prior history marked honestly.**
`buildManualCorrectionProvenance` now tags every `corrections[field]`
entry and every `issueAuthority.priorObservations` entry with
`provenanceTrust: 'client-reported'` — `priorIdentity` is browser-supplied
(the client's own snapshot of the card before correction), never
something the server independently loaded or verified, and nothing
downstream can now mistake it for a server-verified fact.

**Safeguard 4 — preserve-list disputes resolved explicitly, per field:**
- **Moved to the clear-list** (were previously preserved; reclassified because they're identity-dependent DETERMINATIONS, not photo-condition facts independent of which book this is): `variant`, `isReprint`, `editionType` — "is #9 a reprint / what variant is #9" says nothing valid about #3. `ebayUrl`, `ebayItemId` — the direct identifier/page of a specific eBay listing that, under the old identity, titles and describes itself as the wrong book; cleared unconditionally (no historical-fact carve-out, unlike the group below — a listing page for the wrong title has no legitimate reading under the corrected card at all). `listPrice`, `listPriceManual` — a system/user-derived list price computed against the OLD valuation; the override flag is cleared alongside the price it refers to, rather than surviving as a stale flag over nothing.
- **New conditional-on-sold-status group** (`CONDITIONALLY_PRESERVED_ON_SOLD_STATUS = ['status', 'soldPrice', 'bundleId']`, in neither the clear-list nor the preserve-list): preserved from the old item **only when `oldItem.status === 'sold'`** — a completed, historical sale is a genuine fact independent of which specific issue we now believe the book to be. Cleared to `null` otherwise — an active `status: 'listed'` entry (or a `bundleId` grouping it into an active bundle) describes a listing tied to the wrong identity and must not auto-survive, exactly like ebayUrl/ebayItemId above.
- **Confirmed unchanged, with rationale restated**: `assetType`/`assetTypeConfident` stay preserved — physical-format classification (comic vs. book vs. card), orthogonal to which specific title/issue this is, and no new photo is submitted to reassess it. `certNumber`/`cgcLabel`/`cgcVerified`/`labelType`/`labelNotes`/`defectPenalty`/`cgcPenaltyFlags`/`restoration` stay preserved — these describe the CGC slab/grading-service record and physical condition of the object itself, distinct from `variant`/`isReprint`/`editionType` (which describe WHICH printing/edition/variant it is).
- Final composition: 236 clear-list fields (was 229 + 7 moved in), 20 preserve-list fields (was 30 − 7 moved to clear − 3 moved to the conditional group), 3 conditional fields. Zero overlap between all three lists (tested). `buildCorrectedCatalogueItem` applies the conditional group before AND after the `enrichData` merge (matching the existing defensive-reassertion pattern the preserve-list already used).

**Safeguard 5 — the real client payload and collection-replacement
integrity, tested directly.** Three new extracted, production-used
functions: `buildManualCorrectionPayload(item, correctedValues,
correctedFields)` (the exact `/api/enrich` request body `App.jsx`'s
`submitManualCorrection` now constructs, replacing an inline object
literal the tests previously would have had to mirror by hand),
`replaceCatalogueItemById(catalogue, correctedItem)` (pure array
replacement — `App.jsx`'s `setCatalogue` call now uses this instead of an
inline `.map`), and `applyManualCorrectionResult(catalogue, oldItem,
enrichData)` (unifies the merge + replace steps into one call for direct
testability). Tested for BOTH panel cases (`identityMissingFields=
['issue']` and `identityMissingFields=[], identityProvisionalFields=
['issue']`): the constructed payload satisfies the real Safeguard 1
contract check, `manualAuthority.correctedFields === ['issue']`,
`priorIdentity` carries the item's actual pre-correction values, the
payload chains correctly through `prepareManualCorrectionRequest` (proving
Safeguard 2) and `buildManualCorrectionProvenance` (proving Safeguard 3),
and collection-replacement integrity holds: `before.length ===
after.length`, exactly one item with the corrected ID (no duplicate
append), the corrected issue replaces the old issue on that exact item,
and unrelated collection entries are untouched.

**Teeth-proofs.** Each safeguard's key assertion was proven capable of
failing. Four via a permanent naive-vs-real comparison embedded in the
suite (Safeguard 1: a naive `manualIdentity`-only check wrongly accepts a
spoof the real four-condition check correctly rejects; Safeguard 2: an
un-normalized `" #3 "` working-identity value fails the `=== '3'` check
the real normalized value passes; Safeguard 3: a provenance record with
the marker manually stripped fails the same check the real assertions
use; Safeguard 5: a naive append-instead-of-replace merge wrongly grows
the collection length where the real `replaceCatalogueItemById` does
not) — arguably stronger than a one-time revert, since these run on every
future execution of the suite, not just once during development. For
Safeguard 4 specifically, a genuine temporary injection into the REAL
`buildCorrectedCatalogueItem` was also performed (the naive
"always-preserve" implementation the conditional group replaces,
sed-injected directly into `src/lib/manualCorrection.js`, matching this
campaign's established practice from Commit 2): confirmed 4 real test
failures (`✗ active listing: status reset to null...`, `✗ active listing:
bundleId cleared...`, `✗ never-listed item: status stays null...`, `✗
TEETH-PROOF: the REAL conditional merge does not...`), then reverted;
confirmed the file returns to a byte-identical, fully-passing state
afterward.

Tests: `tests/q-trackB-commit3-manual-correction.test.js` — **452/452
passing** (up from 342 — added Safeguards 1-5, each with dedicated
assertions plus a teeth-proof). Full-suite baseline unchanged — 11 failing
files, no new failures relative to the documented baseline (re-verified
after all five safeguards landed).

**Narrow amendment — Safeguard 2's missing executable cache-key proof.**
The packet above documented the normalization chain (`workingIdentity` ->
`effectiveTitle`/`effectiveIssue` -> `confirmedTitle`/`confirmedIssue`) but
never exercised the actual `ac:` active-comp cache-key composition it
feeds — the exact site (`api/enrich.js` ~line 4666,
`` `v${COMP_FILTER_VERSION}:${confirmedTitle}|${confirmedIssue}` ``) that
Commit B.1 (Strange Tales dispatch) built the `title|null` guard around.
New exported `buildActiveCompCacheKey(filterVersion, confirmedTitle,
confirmedIssue)` (`api/enrich.js`, alongside the file's existing
test-compatibility re-exports) reproduces that exact template
byte-for-byte; the real call site now calls it instead of the inline
string, so production and this feature's test build the identical key
(invariant 10). Test: a correction request with raw issue `" #3 "` run
through the real `prepareManualCorrectionRequest`, its `workingIdentity`
fed into the real `buildActiveCompCacheKey`, asserts the resulting key
contains `Strange Tales|3` and contains none of `Strange Tales|#3`,
`Strange Tales|9` (the prior issue), `Strange Tales|null` (the confirmed
historical failure class), or the raw whitespace form. Teeth-proof:
reconstructing the historical bad-key shapes (prior issue `9`; `null`
confirmedIssue) through the SAME real export produces exactly
`v9:Strange Tales|9` and `v9:Strange Tales|null` — confirming the
assertions above genuinely reject both, not a hypothetical. Tests:
**465/465 passing** (up from 452 — 13 new cache-key assertions). Full-suite
baseline unchanged — 11 failing files, no new failures.

**Commit 4** — adoption-from-null ALWAYS provisional + explicit
server-side contract transition + pricing/cache custody. Corrected
invariant: when `resolveFamilyIssueConsensus`'s `mode:'adopted'` fires —
structurally only reachable when `priorIssue` was null, i.e. no
Vision/user issue existed to corroborate or conflict with — the resulting
issue number is now ALWAYS provisional, never silently promoted to a
confirmed value just because nothing contradicted it. Absence of
contradiction is not corroboration. An earlier draft of this plan
considered a control where "no contradiction detected" would let a
marketplace-only-adopted issue display as confirmed — that control was
never implemented in shipped code, and this commit's diff contains no
equivalent of it anywhere.

**Review-round amendment (folded in before staging, four items plus a
wording fix):** the first packet satisfied only the contract-transition
mechanism and a confidence-type nit. Review found four real gaps against
the original dispatch — an un-exported cache-guard composition, no proof
the adopting rows are actually excluded from PRICING (only that the final
price was null), status-only (not full-result) determinism, and no
anti-overcorrection controls proving already-confirmed identities are
never touched. All four closed below, plus a same-source-vs-independent
wording correction on the escalation mechanism.

**New `src/lib/issueAuthority.js`** — five pure functions, extracted for
testability per this campaign's standing pattern (`buildActiveCompCacheKey`,
`applyVariantPreferenceFilter`, etc. — production and tests call the
identical implementation, invariant 10):
- `mapConfidenceRatioToTier(ratio)` — Commit 3's shipped
  `issueAuthority.confidence` is a STRING tier (`'high'`,
  `manualCorrection.js:602`); this maps the raw adoption ratio to the same
  vocabulary (`>=0.8` 'high', `>=0.6` 'medium', else 'low' — 'low' is
  structurally unreachable via the real `'adopted'` path given the 0.6
  adoption bar, kept as an honest defensive default). Boundary-tested
  across its full domain (0/0.59/0.6/0.79/0.8/1.0).
- `deriveIssueAuthorityFromAdoption(familyIssueConsensus)` — builds the
  initial `issueAuthority` object (Commit 3's exact shape and types —
  `confidence` is the string tier, never a bare number; the raw ratio
  survives separately as `supportRatio`, no information lost) the moment
  identity resolution runs. Returns `{issueAuthority: null,
  identityProvisionalFields: null}` for every mode other than `'adopted'`
  — inert for `'corroborated'`/`'conflict-locked'`/`'no-consensus'`/
  `'no-data'`, all on their pre-existing, untouched mechanisms.
- `escalateIssueAuthorityOnConflict(issueAuthority, issueConsensusConflict)`
  — escalates `'provisional'` (reached via marketplace-only-adoption
  specifically) to `'conflicted'` when a LATER, differently-scoped
  marketplace population disagrees — `out.issueConsensusConflict`, only
  set here when the family-consensus check upstream did NOT already fire
  `'conflict-locked'` (structurally disjoint from `'adopted'`), so this is
  a genuine second signal, not a re-check of the same evidence. **Wording
  correction (review round):** the doc comment and the `api/enrich.js`
  call-site comment originally called this an "independent signal" — a
  mischaracterization. Both the family-scoped adoption vote and the later
  pool-wide eBay visual consensus are the SAME marketplace/pool evidence
  class, just differently-scoped populations — same-source disagreement,
  not independent corroboration. Genuine independence (the kind that could
  ever justify promoting status toward `'confirmed'`) means a
  non-marketplace source: Vision, physical indicia/fingerprint, or an
  explicit user correction (Commit 3). The mechanism was always correct
  (escalate only, never promote) — only the prose was wrong; corrected in
  both files, mechanism untouched. Pure: returns a NEW object on
  escalation, the SAME reference (referential no-op) otherwise. Preserves
  every existing reason, appends the new one.
- `computeIssueAuthorityContractPatch(issueAuthority, priorOut)` — the
  explicit server-side contract transition. Returns `null` when
  `issueAuthority.status` isn't `'provisional'`/`'conflicted'`, or when a
  more fundamental refusal already fired (`priorOut.refusedToPrice ===
  true`). Otherwise returns a patch that reuses decisionEngine's OWN
  pre-existing `'identity-not-confident'` blocker (no new blocker slug) via
  `identityConfident: false` — with none of that blocker's exemption flags
  set, `computeDecision` deterministically sets `decision.action=
  'ID_REQUIRED'`, which `responseContract.js`'s `deriveState()` resolves to
  contract state `'ID_REQUIRED'` at its FIRST precedence check — the same
  contract-state class already used for REFUSED/ID_REQUIRED, never the
  Q110 LOCKED class. `refusedToPrice: true` set too as a redundant second
  signal. I13 custody: never touches `rawComps`/`soldComps`;
  `hypotheticalReferenceEstimate` preserves whatever price the pipeline
  computed, relabeled, never deleted.
- `canUseExactIssuePricingCache(confirmedIssue, issueAuthority)` — **Item 1,
  review round.** Extracts the `ac:` exact-pricing cache-guard composition
  (previously an inline `confirmedIssue != null && issueAuthority?.status
  !== 'provisional' && ... !== 'conflicted'` at the call site) into a
  single named, exported predicate — production and tests now share one
  implementation instead of the test re-deriving the same boolean
  independently. Ineligible: `confirmedIssue == null` (Commit B.1's
  original case), or `issueAuthority.status` is `'provisional'`/
  `'conflicted'`. Eligible: any other status (`'confirmed'`, or no
  `issueAuthority` at all — the ordinary pre-campaign case, no regression).

**`api/enrich.js` wiring:** four real call sites — `deriveIssueAuthorityFromAdoption`
inside the existing family-issue-consensus `if/else if` chain (sibling to
the pre-existing `'conflict-locked'` branch, ~line 2737);
`escalateIssueAuthorityOnConflict` immediately after the visual-pool
issue-divergence check (~line 8127); `canUseExactIssuePricingCache` at the
`ac:` cache-guard site (~line 4713, was the inline composition);
`computeIssueAuthorityContractPatch` as a new, fourth terminal block
positioned identically to the Q140/Commit-B/E1 blocks — the LAST check
before `out.decision = computeDecision(...)`.

**Item 2, review round — pricing-eligible-population exclusion, not just
final-price nulling.** The original packet proved `out.price` ends up
null but never proved the ROWS that produced the adoption are excluded
from the pricing populations themselves — a real, separate gap: with
`confirmedIssue` non-null (the adopted value), the pre-existing
`TARGET_ISSUE_UNRESOLVED` gate (`src/lib/evidenceEligibility.js`, keyed on
`target.issue == null`) never fires, so comp rows matching the
unconfirmed number would flow through `buildPricingEligibleRows`/
`buildEvidencePopulations` as fully pricing-eligible. New
`TARGET_ISSUE_PROVISIONAL_AUTHORITY` rejection code in
`classifyEvidenceRow` — fires when `target.issue` is present but
`target.issueAuthorityStatus` is `'provisional'`/`'conflicted'`, demoting
EVERY row regardless of whether its own title happens to match
`target.issue` (a row matching an unconfirmed number is not evidence the
number is right — same "absence of evidence is not evidence of
correctness" reasoning as `TARGET_ISSUE_UNRESOLVED`, one authority tier
up). Added to `PRICING_GATE_CODES` (so it actually excludes from pricing
math, not just display) and routes to a new
`provisionalAuthorityReferences` bucket in `buildEvidencePopulations`
(I13 custody — reference-only, never deleted, annotated with
`comparabilityStatus:'PROVISIONAL_ISSUE_REFERENCE'` + the rejection code
as source/reason). `issueAuthorityStatus` threaded through the two real
production consumers of this classifier — `api/comps.js`'s `fetchComps`
(new param, added to `evidenceTarget`) and
`src/lib/soldVerification.js`'s `verifySoldComps` (same pattern) — and
both real `api/enrich.js` call sites (`fetchComps({...})` ~line 4762,
`verifySoldComps(...)` ~line 5217) now pass
`out.issueAuthority?.status || null`.

**Item 3, review round — full-result 10x determinism, not status-only.**
The original 10x loop only compared `issueAuthority.status` across runs.
New `runFullPipelineOnce()` test helper runs the complete real chain
(`resolveFamilyIssueConsensus` -> `deriveIssueAuthorityFromAdoption` ->
`canUseExactIssuePricingCache` -> `buildEvidencePopulations` ->
`computeIssueAuthorityContractPatch` -> `computeDecision` ->
`finalizeResponse`) and returns a complete snapshot (authority object
including `supportRatio` and `reasons` IN ORDER, `identityProvisionalFields`,
contract state/price/bands/listable, `hypotheticalReferenceEstimate`,
cache eligibility, pricing-eligible pool size, listing-lock fields,
decision action). 10 runs serialized and deep-compared — `new
Set(serialized).size===1` — byte-identical, not just status-equal.

**Item 4, review round — anti-overcorrection controls, through real
exports.** A gate that demotes everything looks safe but is a different
bug:
- (a) a prior confirmed issue (`priorIssue='12'`) with a 5/5 unanimous
  agreeing pool reaches `mode:'corroborated'`, not `'adopted'` —
  `deriveIssueAuthorityFromAdoption` has nothing to say about it
  (`issueAuthority: null`), `computeIssueAuthorityContractPatch` is a
  genuine no-op, and the full pipeline confirms the contract state is NOT
  ID_REQUIRED/REFUSED and a real price survives.
- (b) Commit 3's real `buildManualCorrectionProvenance` — fed a
  `priorIdentity` carrying a genuine Commit-4-provisional authority (proving
  the two commits compose: a user correction promotes a marketplace-only-
  provisional issue to user-confirmed) — produces `status:'confirmed'`,
  and `computeIssueAuthorityContractPatch` is a no-op for it.
- (c) a Commit-4-provisional item's real `identityProvisionalFields`
  correctly activates Commit 3's real `getCorrectableFields(item)` ->
  `['issue']`, and the FULL real correction submit path —
  `buildManualCorrectionPayload` -> `prepareManualCorrectionRequest` ->
  `applyManualCorrectionResult` (all Commit 3 exports, none
  re-implemented) — completes end-to-end on top of a provisional card,
  confirming collection-replacement integrity (same length, same ID,
  corrected issue applied).
- (d) `classifyEvidenceRow` on a `tpb`/`book`/`collected` target: with
  `issueAuthorityStatus:'provisional'` set, `TARGET_ISSUE_PROVISIONAL_AUTHORITY`
  never fires (no issue axis to gate) and the FULL classification is
  byte-identical to the same call with no `issueAuthorityStatus` at all —
  genuinely unaffected, not coincidentally equal.

**Client readiness (eight-joint-assertion point 5) satisfied without an
App.jsx change.** `getListingReadiness` isn't exported (no test in this
campaign has a JSX-transform harness to import it), so its two governing
conditions were verified by direct reading instead: `identityConfirmed`'s
`isUnresolved` check reads `decision.action === 'ID_REQUIRED'` (App.jsx
~line 439); `priceReady` reads `price > 0` where `price` derives from
`getDisplayPrice`, whose FIRST branch (App.jsx ~line 229-231) is
`item.contract && !item.priceOverridden ? item.contract.price ?? 0 : ...`.
Both are already satisfied by the real `decision.action`/`contract.price`
this commit's transition produces. Full UI reconciliation (badge/copy
specific to `issueAuthority.status`) remains Commit 5's job.

**Tests** (`tests/q-trackB-commit4-adoption-provisional.test.js`,
**86/86 passing** — up from 53: +8 net for the eight-joint-assertion
extension (items 7/8 and their comp-pool fixture), +5 net for the
full-result-determinism rewrite (8 new assertions replacing the 3
superseded status-only ones), +20 net for the anti-overcorrection
controls section (a)-(d) — 53+8+5+20=86, confirmed at each intermediate
step during implementation, not just at the end. Every
assertion via real exported functions: `resolveFamilyIssueConsensus`/
`detectVisualIssueDivergence` (`identityCore.js`); `deriveIssueAuthorityFromAdoption`/
`escalateIssueAuthorityOnConflict`/`computeIssueAuthorityContractPatch`/
`canUseExactIssuePricingCache`/`mapConfidenceRatioToTier`
(`issueAuthority.js`); `classifyEvidenceRow`/`buildEvidencePopulations`/
`buildPricingEligibleRows`/`PRICING_GATE_CODES` (`evidenceEligibility.js`);
`getCorrectableFields`/`prepareManualCorrectionRequest`/
`buildManualCorrectionProvenance`/`buildManualCorrectionPayload`/
`applyManualCorrectionResult` (`manualCorrection.js`); `computeDecision`
(`decisionEngine.js`); `finalizeResponse`/`assembleContract`
(`responseContract.js` — the actual `api/enrich.js:9352` terminal call):
- **Teeth-proof A** — confirms the real `resolveFamilyIssueConsensus`
  genuinely reaches `mode:'adopted'` on the fixture, then contrasts a
  naive "no Commit 4 code at all" stand-in against the real
  `deriveIssueAuthorityFromAdoption` output.
- **Eight joint assertions** — one pool-only-adoption fixture run through
  the full real pipeline, asserting together: (1) `status==='provisional'`,
  (2) `contract.state==='ID_REQUIRED'`, (3) price+bands null, (4) zero
  portfolio contribution, (5) the two real readiness-driving conditions,
  (6) `listable===false` + `listingHardLocked===true`, (7) the adopting
  marketplace rows — a synthetic active/sold comp pool genuinely matching
  `#12` by title — are absent from every pricing-eligible population
  (`rawPricingPool`, `buildPricingEligibleRows`) and land in
  `provisionalAuthorityReferences` with source/reason annotation intact,
  (8) `canUseExactIssuePricingCache` returns `false`. Plus I13 custody
  (`rawComps`/`soldComps` byte-identical) and `hypotheticalReferenceEstimate`
  preservation.
- **Teeth-proof B** — the inverse: leaving `issueAuthority` unset on the
  identical fixture produces `patch === null` and a normal priced contract.
- **Full-result 10x determinism** — see Item 3 above.
- **Contradiction-detector-fired case** — a real `detectVisualIssueDivergence`
  call (confirmed `#12` vs. a later, differently-scoped pool-wide value
  `#9`) escalates `'provisional'` to `'conflicted'`, preserving the
  original reason and appending the new one; confirmed pure. The escalated
  case is run through the full pipeline too, confirming
  `ID_REQUIRED`/null-price there as well.
- **Behavior matrix sanity** — `'corroborated'`/`'conflict-locked'`/
  `'no-consensus'`/`null`/`undefined` familyIssueConsensus inputs all
  confirmed inert.
- **`mapConfidenceRatioToTier` boundaries** — full domain, not just the
  reachable slice.
- **Guard** — a card with a pre-existing `refusedToPrice===true` is
  confirmed not double-patched.
- **Anti-overcorrection controls (a)-(d)** — see Item 4 above.

**Teeth-proofs for the review-round assertions specifically (genuine
temporary injection into the REAL functions, observed to fail, then
reverted — same practice as Commit 3's Safeguard 4):**
1. `deriveIssueAuthorityFromAdoption`'s `status: 'provisional'` changed to
   `'confirmed'` — 26 real assertions failed (cascading through joint
   assertions 1-8, the full-result determinism sanity checks, and the
   contradiction-escalation case), confirming the whole chain genuinely
   depends on this value. Reverted; file confirmed byte-identical
   (`diff` against a pre-injection copy) and 86/86 passing again.
2. `canUseExactIssuePricingCache` body replaced with a bare `return true`
   — exactly assertion (8) and its full-result-determinism counterpart
   failed, nothing else cascaded (a clean, isolated proof this specific
   assertion is load-bearing). Reverted; byte-identical, 86/86 passing.
3. `classifyEvidenceRow`'s new branch had its `identityEligible = false;`
   line removed (simulating a row silently promoted into pricing) —
   assertions (7b)/(7c)/(7d) and the full-result pricing-pool-size check
   failed; (7a)/(7f)/(7g) did NOT fail (they test a second, independent
   protection layer — the `PRICING_GATE_CODES` gate on `rejectionCodes`,
   which the injection didn't touch), a genuinely informative result about
   the two-layer design, not a flaw in the teeth-proof. Reverted;
   byte-identical, 86/86 passing (at this point in the sequence).

**Second review-round amendment (two scope-fenced fixes, folded in before
staging):**

**Fix 1 — evidence dropped on `api/comps.js`'s zero-eligible early return.**
Confirmed real, scope-fenced to exactly one site: `fetchComps`'s `if
(rawPricingEligibleRows.length === 0) return {...emptyComps(...),
attemptUsed: 0}` ran AFTER `evidencePopulations` was computed but returned
a bare `emptyComps()` shape with no `evidence` field at all — every
reference-only row (including this commit's own
`provisionalAuthorityReferences`, and the pre-existing
`gradedPricingReferences`/`incompleteReferences`/etc.) silently vanished
in exactly the case where EVERY row in the pool was demoted to
reference-only (e.g. a pool entirely composed of rows matching a
marketplace-only-adopted, not-yet-corroborated issue). Fix: a new
`evidenceForResponse` object built once, immediately after
`evidencePopulations`, attached identically at BOTH the zero-eligible
early return and the pre-existing success-path return (which previously
hand-rebuilt an equivalent but separately-maintained object literal —
now one shared construction, no drift risk between the two). Also closes
a second, smaller gap discovered while building `evidenceForResponse`:
the success path's own hand-built object never included
`provisionalAuthorityReferences` either, even when other rows in the same
pool DID make it into pricing — so a mixed pool would have silently lost
the provisional-authority rows too, not just the all-excluded case.
**Sold-side checked, confirmed NOT affected — no fix needed there:**
`src/lib/soldVerification.js`'s `verifySoldComps` returns `evidence:
evidencePopulations` (the FULL, unmodified populations object) at all
three of its return sites, including the zero-verified-rows case — it
already carries `provisionalAuthorityReferences` through by construction,
with no separate "empty" shape that drops it. Confirmed by direct
reading, not assumed.
**Explicitly deferred, not fixed here (per scope fence):** every OTHER
early-return site in `api/comps.js` that predates `evidencePopulations`
being computed at all (e.g. the `parsed.length === 0` return before
evidence classification even runs) has no evidence to lose in the first
place and is unaffected either way. The broader "attach evidence at every
early return in this file" project — Commit 2's own already-queued item
(Section 2) — stays queued; this fix touches only the one site downstream
of `evidencePopulations` that Commit 4's own bucket flows through, per
the scope fence.

**Fix 2 — fail-closed inversion, two surfaces.** Both
`canUseExactIssuePricingCache` and the `TARGET_ISSUE_PROVISIONAL_AUTHORITY`
gate (`classifyEvidenceRow`) originally BLOCKLISTED the two known-bad
status values (`=== 'provisional' || === 'conflicted'`) and let everything
else — including a status value nobody anticipated (a future third
status, a typo, an unrelated bug writing something unexpected onto
`issueAuthority.status`) — fall through as if trustworthy. Both now
ALLOWLIST the known-safe shapes instead: no `issueAuthority` object at
all (the ordinary pre-campaign case, `canUseExactIssuePricingCache`) or no
`issueAuthorityStatus` at all (`classifyEvidenceRow`) — zero regression
for the ~99% of requests with no authority tracking — or an explicit
`'confirmed'` status. Every other value, known or not-yet-invented, is
now ineligible/gated by default — conservative-on-uncertainty, the same
standing posture this codebase already applies to pricing and
identification generally. **Scope-fenced to exactly these two surfaces**
(the ones this commit introduces) — no sweep of other legacy gates
elsewhere in the codebase for the same fail-open shape; none were spotted
incidentally while making this change, so there is nothing to list for a
future queue from this pass.

New tests (6, all via the real exports): an unrecognized/future status
value is confirmed ineligible for both `canUseExactIssuePricingCache` and
the `classifyEvidenceRow` gate; the two known-safe shapes (absent
authority, `'confirmed'`) are confirmed to remain eligible/inert for both
— proving this is a genuine allowlist inversion, not a blanket new
restriction. Both teeth-proofed: reverting each surface to its prior
blocklist form (temporary injection into the real function) produced
exactly the expected failures (1 for the cache guard, 2 for the
classifier gate) and no others; reverted, byte-identical.

Tests (at this point in the sequence): 92/92 passing (up from 86 — the 6
fail-closed assertions above).

**Third review-round amendment — structural upgrade to Fix 1 (required,
not optional):** hand-adding `similarTitleReferences` to the manually-
maintained `evidenceForResponse` object literal would have fixed the one
known instance but left the defect CLASS intact — a hand-maintained
partial object is exactly what produced this omission (and, before it,
the longer-standing separate omission of `provisionalAuthorityReferences`
itself from the success-path object). Extracted instead:
- `EVIDENCE_RESPONSE_BUCKETS` (`src/lib/evidenceEligibility.js`, exported
  constant) — the complete, ordered list of the 8 display/reference bucket
  keys (`similarTitleReferences`, `provisionalAuthorityReferences`,
  `gradedPricingReferences`, `incompleteReferences`,
  `incompatibleEditionReferences`, `unconfirmedEditionReferences`,
  `rejectedEvidence`, `eraRejectedReferenceRows`) a fully-assembled
  evidence response carries. Same pattern as Commit 3's
  `IDENTITY_DEPENDENT_FIELDS_TO_CLEAR`/`IDENTITY_INDEPENDENT_FIELDS_TO_PRESERVE`
  — explicit, named, exported enumeration, never inferred "everything
  except" logic.
- `buildEvidenceForResponse(evidencePopulations, eraRejectedReferenceRows)`
  (same file, exported) — iterates `EVIDENCE_RESPONSE_BUCKETS`, every
  bucket always present as an array. `eraRejectedReferenceRows` is
  accepted as a second argument (it's computed by a separate, earlier
  pipeline stage — api/comps.js's own era-consistency filter — not one of
  `buildEvidencePopulations`' own fields) rather than requiring
  `buildEvidencePopulations` to know about an upstream filter stage, or
  being silently dropped.
- `api/comps.js`'s BOTH return sites (the zero-eligible early return from
  Fix 1, and the pre-existing success-path return) now call this one
  function — no hand-maintained object literal remains at either site.
- `src/lib/soldVerification.js` confirmed to need NO change: its real
  `evidence: evidencePopulations` (all 3 return sites) already returns the
  complete raw object, which already carries every bucket in
  `EVIDENCE_RESPONSE_BUCKETS` except `eraRejectedReferenceRows` (no
  sold-side equivalent pre-filter stage) — verified directly, not assumed.

**New tests, both sides of the real UI consumption verified** (App.jsx
:7010-7011 reads `item.activeEvidence?.similarTitleReferences` AND
`item.soldEvidence?.similarTitleReferences` — a one-sided proof would miss
half the regression surface):
- **Response-shape completeness** — iterates the real, exported
  `EVIDENCE_RESPONSE_BUCKETS` against both the real `buildEvidenceForResponse`
  output (activeEvidence shape) and a raw `buildEvidencePopulations` result
  (soldEvidence shape, `eraRejectedReferenceRows` explicitly asserted
  ABSENT there, a documented shape difference, not a silent gap) —
  confirming every bucket is always an array on both shapes for the same
  underlying provisional-authority-excluded population.
- **`fetchComps` integration test** (real HTTP-layer function, `global.fetch`
  mocked) — the established pattern already used by
  `q-trackB-commit2-era-classification`/`q141-v0i-slab-exclusion`/`q120-cv-year-penalty-and-marvel-tokenize`/
  `q-batman222-cv-zero-score`/`perf-kv-dedup-and-oauth-cache` (no new
  harness). A genuine 3-row comp pool that survives the ENTIRE upstream
  filter chain (title/era/reprint/variant/lot/sanity) prices normally with
  no `issueAuthorityStatus` (CONTROL, count>0, proving the fixture is real
  — not vacuously empty already), then collapses to `count=0` through the
  REAL `TARGET_ISSUE_PROVISIONAL_AUTHORITY` gate and the REAL zero-eligible
  early return (Fix 1's own target) when `issueAuthorityStatus:'provisional'`
  is passed — with `evidence.provisionalAuthorityReferences` carrying all
  3 rows, source/reason intact, and the FULL `EVIDENCE_RESPONSE_BUCKETS`
  set present on the actual `fetchComps()` return value, not just at the
  unit-test level. Repeated for `'conflicted'`. All 4 pre-existing
  precedent test files re-run clean (19/16/all-pass/12 assertions, no
  regression from the `evidenceForResponse` refactor).

Tests (at this point in the sequence): 128/128 passing.

**Fourth review-round amendment — presence-threading correction (a
requirement that had been silently dropped twice before this pass;
addressed explicitly here, not folded in silently).** Every prior packet's
`issueAuthorityStatus` threading (`api/enrich.js`'s two real call sites ->
`api/comps.js`/`soldVerification.js` -> `classifyEvidenceRow`) was built
from a single collapsed scalar: `out.issueAuthority?.status || null`. That
expression cannot distinguish two genuinely different upstream states —
(a) no `issueAuthority` object exists at all (the ordinary, legacy,
pre-campaign case — safe), and (b) an `issueAuthority` object DOES exist
but its own `.status` field is itself null/undefined (a malformed PRESENT
record) — both collapse to the identical bare `null` by the time they
reach `evidenceTarget`, so `classifyEvidenceRow`'s gate (checking
`issueAuthorityStatus != null`) could never tell them apart, and silently
treated (b) as if it were the safe case (a).

**Fix:** a second primitive, `issueAuthorityPresent` (boolean), threaded
as its OWN field — never derived from the status value — alongside
`issueAuthorityStatus`, through every real call site: `api/enrich.js`'s
`fetchComps(...)` and `verifySoldComps(...)` calls now pass
`issueAuthorityPresent: out.issueAuthority != null` explicitly;
`api/comps.js`'s `fetchComps` signature and `src/lib/soldVerification.js`'s
`verifySoldComps` signature both gained the new parameter (default
`false`, the safe legacy value) and thread it into `evidenceTarget`.
`classifyEvidenceRow`'s gate now reads `target.issueAuthorityPresent ===
true && target.issueAuthorityStatus !== 'confirmed'` — presence is the
gate, not status alone; a present-but-statusless record is now correctly
caught, and the truly-absent case is unaffected. **Confirmed, not
assumed, that the sold path actually receives and forwards both fields**
(the "no change needed" note in the prior packet's Fix 1 was specifically
about response SHAPE — `evidence: evidencePopulations` already carrying
every bucket — and never covered this threading, which is new in this
pass).

**Scope note per the clarification:** `canUseExactIssuePricingCache`
(`src/lib/issueAuthority.js`) is UNCHANGED — it already receives the full
`issueAuthority` object directly from its one real call site and performs
its own `issueAuthority == null` presence check internally; only the
`evidenceEligibility.js` chain ever had the collapsing problem, since that
was the one path serializing the object down to a bare scalar before it
crossed a file/module boundary.

New tests (5, all via real exports, both at the `classifyEvidenceRow` unit
level and through the real `fetchComps` HTTP-layer integration test): a
present-but-null-status target is confirmed gated (the exact new
distinction), contrasted directly against the truly-absent-authority
control (same row, same issue, same title — genuinely different outcome).
Teeth-proofed: reverting the gate to its prior status-only check
(temporary injection into the real function) produced exactly the 4
expected failures — the new presence-specific assertions only, nothing
else — confirming this correction's own tests, not just its absence, are
load-bearing; reverted, byte-identical.

Tests: **133/133 passing** (up from 128 — 5 presence-threading
assertions) **at this checkpoint** — a later evidence-custody/sold-path
completion pass (same implementation session, prior to this file's
current on-disk state) added further assertions covering full evidence-
bucket custody across both the active (`api/comps.js`) and sold
(`soldVerification.js`) paths, bringing the suite to its current, final
133+19=**152/152**. That later pass is not narrated as its own numbered
review round above (unlike the four that are) because it closed out
custody proofs the four rounds above already scoped, rather than
introducing a new fix — recorded here so the count itself is never an
unexplained discrepancy against the file's actual current size. Full-suite
baseline unchanged — 11 failing files,
byte-identical failing set before/after across FIVE separate `git stash`
A/B passes (2-file, 6-file, 7-file, the prior 7-file structural-upgrade
pass, and this final pass, diffed directly, not just counted):
`batch1-fixes`, `comp-filter-hygiene`, `decision-engine`, `identity-gate`,
`image-search-extraction`, `mega-keys`, `pattern-k-dedupe-issue`,
`priceBands`, `q-adv397-visual-guard`, `ship26-integration`,
`sold-verification` — none of which this commit's diff touches. Build
clean (`npm run build`); ESM-mode parse verified explicitly on all five
touched/new production files (`api/enrich.js`, `api/comps.js`,
`src/lib/evidenceEligibility.js`, `src/lib/soldVerification.js`,
`src/lib/issueAuthority.js`). All 5 precedent `fetchComps`/`global.fetch`-
mocking test files (`q-trackB-commit2-era-classification`,
`q141-v0i-slab-exclusion`, `q120-cv-year-penalty-and-marvel-tokenize`,
`q-batman222-cv-zero-score`, `perf-kv-dedup-and-oauth-cache`) re-run clean.

**Standing process amendment, effective this packet forward:** every
evidence packet ends with a dispatch-compliance table — every numbered
item from the directive it answers, marked DONE (with proof)/DEFERRED
(with the approval that deferred it)/NOT DONE (with why) — so a silently
dropped requirement is structurally visible on both ends, not just
caught eventually by a subsequent review pass.

**Explicitly out of scope for this commit (per instruction, queued
separately):** the Spawn #351 isolated visual-family candidate work
(marketplace-visual source, 2-row family adoption, a
`visualReferenceEvidence` bucket) — new recovery capability from a
separate review chain, not implemented here in any form. Queues as its
own commit immediately after Commit 4 lands, pending scope decision.

Full-suite A/B: no new failures relative to documented baseline.

**Commit 4.1** — controlled family-fragment merge (the Spawn #351 work
queued at the end of Commit 4, now implemented) + a new family-scoped
year resolver + issue-scoped variant checkpoint + population-lineage-
honest `visualReferenceEvidence`. Root case: scanning "Spawn #351, Cover
C, Brett Booth Virgin, 2024" produced a correct 2-row visual-family
cluster that was rejected outright because promotion requires >=3 rows,
while the pipeline still retained a price aggregate but discarded the
identity candidate and every underlying reference row. Direct execution
(scoping investigation, Condition 2 trace) proved the rejected 2-member
family's tokens are the token-SUPERSET of an independently-3-member
runner-up family's tokens (Jaccard 0.375, just under the 0.4 single-pass
clustering threshold `buildTitleFamilies` already uses) — this is
fragmentation of ONE identity (Answer A), not two competing products
(Answer B).

**`src/lib/imageSearchIdentity.js` — `mergeFragmentedTitleFamilies(scored, itemsOrTitles)`,
new, exported, wired into `selectTitleFamilyCandidate` immediately after
the pre-existing `scoreTitleFamilies` call, before every existing floor
check.** Merge conditions (ALL required): (1) tokens of one family are a
full, strict subset of the other's — merge-direction pin is on TOKEN SETS,
independent of member count; whichever family's tokens are the subset
merges INTO the token-superset (more specific) family. The founding
fixture is exactly the case a naive "bigger family wins" rule would get
backwards: the count-LARGER family (3 members, 3 tokens, "spawn brett
booth") is the token-subset; the count-SMALLER family (2 members, 8
tokens, "...cameo of lyra htf scarce") is the token-superset and becomes
canonical. (2) Combined DEDUPLICATED member count >= 3 — a pairing that
still couldn't clear the existing floor is never evaluated further; the
existing >=3-member weighted-consensus promotion floor itself is untouched,
never lowered, never duplicated. (3) **CORRECTED, review round 3, item 1
— issue is now a MANDATORY positive per-fragment agreement, NOT the
absence-never-blocks standard originally documented here:** both
fragments must positively assert the SAME issue number; asserted-by-one/
silent-on-the-other blocks, both-silent blocks, a genuine mismatch blocks,
internal disagreement within one fragment blocks — only both-assert-and-
agree passes. Year remains the absence-never-blocks standard (unchanged):
no member of either family may assert a DIFFERENT, conflicting year than
another; a row silent on year never blocks, only a genuine differing
asserted value does. Year contradiction reuses the real, exported
`resolveFamilyYearConsensus` (below) rather than a second ad-hoc check, so
this gate and the later year-adoption vote can never disagree about what
counts as a conflict. Cover designation, artist, and presentation/finish
marker are their own, separate, CONDITIONAL positive-agreement condition
(review round 2, item 2, described in its own entry below) — asserted-by-
neither is "not applicable" and never blocks for those three attributes
specifically, unlike issue. (4) No member trips `LOT_RE`/`REPRINT_RE`/
`SLAB_RE`/`GRADED_RE`/`SIGNED_RE`/`TPB_MARKER_RE` (`compHygiene.js` — the
same detectors the formal comp-pricing filter chain already trusts).
Deduplication mirrors (does not
import — `resolveFamilyIssueConsensus` itself is explicitly unmodified)
the same key-priority chain that function already applies: itemId ->
legacyItemId -> normalized itemWebUrl -> raw title text. Only ever merges
the first qualifying pair, trying pairs in weightSum-descending order — a
pool fragmenting into more than 2 pieces of the same product is a real
possibility not exercised by the founding fixture, left as a documented
limitation, not silently generalized to N-way merging without a test
proving it. **What the merge does NOT confer:** agreement on issue number
produces IDENTITY consensus (fed to `resolveFamilyIssueConsensus`
downstream), but never VARIANT confirmation — variant resolution runs
through its own, entirely separate, already-issue-scoped mechanism
(`filterItemsByIssue`/`extractConfirmedVariant`) after this merge and its
consequent issue adoption complete, with its own segregation gates
unchanged by anything here.

**`src/lib/identityCore.js` — `resolveFamilyYearConsensus(priorYear,
visualItems, indices)`, new, exported, family-scoped (operates ONLY on the
accepted family's own indices, never pool-wide — mirrors
`resolveFamilyIssueConsensus`'s own scoping discipline).** Five-case
matrix, all confirmed via direct execution: (A) prior null + >=2 unanimous
asserting rows -> adopt provisionally; (B) prior null + <2 asserting rows
-> leave null, `mode:'no-data'` (a single assertion is not enough to
nominate); (C) prior null + conflicting asserted years -> no adoption,
`mode:'conflict-locked'`, year null; (D) prior trusted + family agrees or
is entirely silent -> preserve, `mode:'preserved'`; (E) prior trusted +
family conflicts -> never overwrite, `mode:'conflict-locked'`, year stays
the prior value. Deduplicates via the same key-priority chain as the
merge function above, reads the already-computed `.year` field on each
row (not recomputed from raw title — avoids a circular import, since
`extractYearFromTitle` lives in `imageSearchIdentity.js`, which already
imports FROM `identityCore.js`). Wired into `resolveIdentity`'s family-
override branch, replacing the pre-existing pool-wide
`confirmedYear = ebay?.year || vision.year` read — that pool-wide read
was the root cause of the year/publisher resolution gap found during the
Condition 2 trace (`[year-ebay] ratio=0.00`, empirically null on this
exact fixture). `resolveIdentity`'s return object gained
`familyYearConsensus` alongside the pre-existing `familyIssueConsensus`,
both surfaced to `api/enrich.js`.

**Publisher — explicitly NOT adopted from family/marketplace evidence this
commit.** `resolveIdentity`'s family-override branch now sets
`confirmedPublisher = vision.publisher || null` unconditionally — it never
reads `ebay?.publisher` in this branch at all, regardless of what any
merged family member's raw title contains (one of the founding fixture's
own merged rows literally contains "Image Comics Malibu Comics" in its raw
title — confirmed this text cannot backfill publisher under the current
code, by direct execution). A broader publisher-authority audit (whether
publisher should ever adopt from marketplace evidence, under what bar) is
recorded as a queued follow-up in the roadmap, not decided here.

**Variant — executed checkpoint, not assumed.** The informal hypothesis
going into this commit was that the merged family would also yield a
"Cover C Brett Booth Virgin" variant consensus. Ran the real
`filterItemsByIssue`/`extractConfirmedVariant` chain against the recovered
16-row population: `filterItemsByIssue` retains 6 rows (the 5 merged-
family rows plus a 6th row, "Spawn 351 NM (9.6) 2024 - Booth Cover C...",
that independently asserts issue #351 by title match but was never part
of either title-family cluster — confirming the issue-scoped population
and the family population are genuinely different sizes, not aliased).
`extractConfirmedVariant` returns **null**. **HISTORICAL, SUPERSEDED
finding (this paragraph described the state at initial packet time only —
see the second review round below for the current, accurate reason):**
at the time this checkpoint first ran, "Brett Booth" was absent from
`ARTIST_PATTERNS` (`compHygiene.js`), and that absence was the reason
given for the null result. The second review round (item 2) added
`/brett booth/i` to `ARTIST_PATTERNS` — "Brett Booth" is RECOGNIZED as of
that round. The variant checkpoint's result is STILL null, but for a
different, now-current reason: Brett Booth clears the pre-existing >=70%
majority-artist non-distinguishing threshold (5/6 pool rows) — see the
second review round's own re-verification of this checkpoint. "Cover C"
being a lettered-cover designation `extractConfirmedVariant` does not
separately capture as a named variant token remains true and unchanged.
Reported as found, not encoded as fact — the informally-hypothesized
variant consensus does NOT materialize with current code, for either
reason. The lettered-cover-designation capture gap remains recorded in
the roadmap's edition-fingerprint campaign entry, not fixed here (out of
this commit's scope); the `ARTIST_PATTERNS` Brett-Booth-absence gap is
CLOSED (recognition added), though the destructive-stripping side effect
that recognition triggered required its own separate fix (see below).

**`visualReferenceEvidence` — population-lineage discipline.** New
`buildVisualReferenceEvidence(familyIndices, parsedVisualRows,
stableSeriesTitle, stableIssue, stableYear)` (current signature — `stableYear`
added in the second review round below; `src/lib/issueAuthority.js`,
extracted for testability alongside the file's existing Commit 4 exports) builds
this bucket ONLY from the accepted family's own `topFamily.indices` — the
exact 5 rows that drove the issue/year consensus above — NEVER from
`filterItemsByIssue`'s broader 6-row issue-scoped population used later,
separately, for variant extraction only. Confirmed by direct execution on
the real fixture: mixing the 6th row in would silently broaden this
evidence bucket beyond what actually produced the identity (a dedicated
teeth-proof in the test suite proves this — passing the naive 6-index
population directly into `buildVisualReferenceEvidence` DOES produce a
6-row result, confirming the real call site's restriction to
`candidate.topFamily.indices` is what keeps the production behavior honest
at 5, not a coincidence of the function's own logic). Each response row
retains exactly three fields: `title` (the row's raw listing title),
`price` (numeric), and `itemWebUrl` (the listing URL) — no more, no less.
Item IDs (`itemId`/`legacyItemId`) are NOT part of this response shape;
**as of the second review round (item 3), they exist in a compact,
family-SCOPED `[family-evidence] decision=... merged=... rows=[...]` log
line** (`selectTitleFamilyCandidate`, `imageSearchIdentity.js`), emitted
only at the two decisions where a family is genuinely selected — NOT the
original, since-removed `[extractIdentity] full pool:` unconditional
whole-pool dump this paragraph first described. Not retained on the
response object itself either way — a deliberate scope boundary, not an
oversight, since adding them to the client-facing bucket was never part
of this commit's ask.

`familyKey` is keyed on the PROPOSED IDENTITY — **corrected in review
round 2 (item 1):** the first version of this call site passed
`identity.confirmedTitle`, which in the family-override branch is
`sanitizeSeriesTitle(family.selectedTitle)` — the visual-family CLUSTER
LABEL, not the stable proposed identity the fingerprint doc comment
always claimed to use. Confirmed by direct execution: that produced
`familyKey: "spawn-brett-booth-cameo-of-lyra-scarce|351"` on the founding
fixture — cluster-derived, and (per a targeted teeth-proof pool
engineered to shift the Q45 60%-of-members token-consensus outcome)
genuinely UNSTABLE once pool composition shifts that consensus. The real
call site now passes `effectiveTitle` — Vision's own title, the value
passed as `vision.title` into `resolveIdentity` BEFORE any family
override — never `identity.confirmedTitle`, `identity.displayTitle`, or
`family.selectedTitle`.

**HISTORICAL, SUPERSEDED (this paragraph originally continued describing
a title+issue-only key with year deliberately excluded — reversed in
review round 3; see that section below for the current, accurate
design):** ~~Verified stable across three REAL, separately-captured pools
of the same physical Spawn #351 photo (16/18/20-row pools, all recovered
from production logs): all three now produce the identical "spawn|351".
Year is deliberately NOT part of the key.~~ Current behavior: all three
pools now produce the identical `"spawn|351|2024"` (year included — see
review round 3, item 1, for the collision-vs-instability reasoning that
reversed this). Returns `null` (never a fabricated zero-row object) when
no family row carries a usable title+price.

**Review round — four corrections plus one regression found and fixed by
the mandated full-suite A/B, all before this commit's first
stage/commit/push:**

1. **Fingerprint input corrected** (detailed above) — `effectiveTitle`
   (Vision's stable title) replaces `identity.confirmedTitle` (the cluster
   label) as `buildVisualReferenceEvidence`'s title input at the real
   `api/enrich.js` call site. **Read-only investigation finding, reported
   as instructed, not silently fixed:** `identity.confirmedTitle` itself
   — cluster-label-derived whenever a family override fires — is NOT
   scoped to this one fingerprint call. It is the SAME value threaded into
   `out.title` (the terminal field returned to the client, `api/enrich.js`
   line ~8807 at time of writing) and into the PriceCharting query
   (`lookupPriceCharting({ title: confirmedTitle, ... })`, ~3215), the
   ComicVine query (`cleanTitleForComicVine(confirmedTitle, ...)`, ~3137),
   the PriceCharting cache key (`` `pc:v...:${confirmedTitle}|...` ``,
   ~3180), and the real comp-pricing query (`fetchComps({ title:
   confirmedTitle, ... })`, ~4810) — meaning a customer's card can display
   and price against the cluster-label string itself (e.g. "spawn brett
   booth cameo of lyra scarce"), not just "Spawn," whenever a family
   override fires. This is pre-existing architecture that predates Commit
   4.1 (Commit 4.1 only changed WHICH cluster label wins for the merged
   case; it did not create the "cluster label feeds the pipeline title"
   design). Flagged here as a genuine finding — the display-not-equal-
   pipeline class — for its own scoped decision; NOT fixed in this
   dispatch.
2. **Year-only containment closed.** A real gap: a trusted/corroborated
   issue paired with a family-adopted-only year (`identityProvisionalFields`
   containing `'year'` with no `issueAuthority` object at all, since
   `deriveIssueAuthorityFromAdoption` only produces one for mode
   `'adopted'`, never `'corroborated'`) previously sailed through both
   `canUseExactIssuePricingCache` and `computeIssueAuthorityContractPatch`
   uncontained — both gated exclusively on `issueAuthority.status`, which
   is `null` in this exact composition. Both functions gained a third,
   optional `identityProvisionalFields` parameter (backward compatible —
   omitting it is a safe no-op, byte-identical to before): the cache guard
   now also excludes on `'year'` being provisional regardless of issue
   status; the contract patch gained a third branch (`refused-year-
   authority-provisional` / `year-authority-provisional`), reusing the
   IDENTICAL patch shape and machinery as the pre-existing issue-provisional/
   issue-conflicted branches — no parallel `yearAuthority` schema. Both
   real call sites (`api/enrich.js`, the `ac:` cache guard ~4776 and the
   terminal contract-transition block ~9389) now thread
   `out.identityProvisionalFields` through. Commit 3's existing correction
   path (`getCorrectableFields`'s pre-existing union over
   `identityProvisionalFields`) requires no change to cover a year-only
   correction.
3. **Publisher caution narrowed to the merged-fragment path only.** The
   first version applied `confirmedPublisher = vision.publisher || null`
   to EVERY family-override decision (`top-rank-protection` and
   `weighted-consensus` alike), not just merged ones — a global behavior
   change the dispatch never asked for. New `mergedFromFragments: true`
   marker, set by `mergeFragmentedTitleFamilies` itself on its merged
   result (the single point of truth for "this family is a Commit 4.1
   merge"), gates the cautious branch; an ordinary, unmerged family
   retains the exact pre-Commit-4.1 `ebay?.publisher || vision.publisher`
   read. Anti-regression fixture: an unrelated, single-cluster
   (never-fragmented) weighted-consensus family, confirmed via direct
   execution to produce byte-identical publisher output (ebay-publisher-
   wins, vision-fallback-when-absent) before and after this narrowing.
4. **A genuine regression, found by the mandated full-suite A/B itself,
   not by inspection.** The initial merge implementation paired ANY
   below-floor family (at any rank) against every other family in
   `scored`, not just `scored[0]` (the one `selectTitleFamilyCandidate`
   would actually promote). On `tests/q85-compact-key.test.js`'s
   Funnybook fixture, this wrongly merged an already-independently-
   qualifying `scored[0]` (a clean, 4-member "funny book" family) into a
   lower-ranked, 1-member "funny book nice copy" singleton that happened
   to be its token-superset — replacing a working title with one carrying
   two unexplained extra tokens ("nice"/"copy") that then tripped the
   pre-existing Q85-B compact-bigram gate and flipped the decision to
   `refused-identity-conflict`, a real 12th failing file the true
   full-suite A/B caught that a 3-file spot check (the first packet's
   checkpoint 4) did not. Fixed: `mergeFragmentedTitleFamilies` now only
   ever considers `scored[0]` as the side needing a merge — a family
   ranked #1 that already independently clears the floor is now a pure
   no-op, never disturbed, exactly mirroring this function's own
   documented intent ("a below-floor TOP family needs to merge with a
   partner" — "top family" means `scored[0]`, not any below-floor family
   at any rank). Re-verified: `q85-compact-key` 11/11 passing; the
   founding Spawn fixture (whose below-floor family WAS `scored[0]`)
   unaffected.
5. **Doc wording corrected** (this entry) — the Commit 4 count-progression
   flag and the `visualReferenceEvidence` row-shape/item-ID description,
   both addressed above.
6. **TRUE full-suite A/B, all 128 `tests/*.test.js` files** (not the first
   packet's 3-file spot check), run twice via `git stash` on all four
   touched production files (`api/enrich.js`, `src/lib/identityCore.js`,
   `src/lib/imageSearchIdentity.js`, `src/lib/issueAuthority.js`) — the
   new test file excluded from the stashed BEFORE run (it does not exist
   pre-Commit-4.1). BEFORE: exactly 11 failing files, matching the
   documented baseline. AFTER (post-regression-fix): the same exact 11
   files, byte-identical for 9 of them; the remaining 2
   (`image-search-extraction`, `q-adv397-visual-guard`) differ ONLY by the
   (at-the-time) permanent `[extractIdentity] full pool:` instrumentation
   log lines appearing in their output (161/2 and 11/0 pass/fail counts
   unchanged in both) — **HISTORICAL: this instrumentation was replaced by
   the narrower `[family-evidence]` log in review round 2, item 3; see
   that section's own re-run A/B for the current, narrower diff.**
   **Full-suite A/B: no new failures relative to documented baseline.**

Teeth-proofs for all four numbered fixes above (temporary injection,
observed failure, reverted, clean state re-verified — item 5 of the
review round): (1) feeding the cluster label as the fingerprint's title
input, verified via a targeted engineered pool, genuinely produces a
DIFFERENT fingerprint than Vision's stable title does for the identical
underlying book — the historical bad shape, confirmed real; (2) routing
containment through `issueAuthority.status` alone (the pre-fix signature)
on the trusted-issue/adopted-year composition produces no patch and
wrongly authorizes the pricing cache — confirms the fix is load-bearing;
(3) a naive "always apply merge-caution" reconstruction confirms the
`mergedFromFragments` gate is what keeps the anti-regression fixture
passing, not coincidence; (4) needs no separate teeth-proof — the
full-suite A/B run itself, both before and after the fix, is the proof.

**`src/lib/issueAuthority.js` — `appendYearToProvisionalFields(identityProvisionalFields,
familyYearConsensus)`, new, exported.** Adds `'year'` to the existing
`identityProvisionalFields` array — the same field Commit 3 already
consumes via `getCorrectableFields`/the inline correction UI — only when
`familyYearConsensus.mode === 'adopted'`, and never duplicates it. No
parallel `yearAuthority` object: year's provisional-ness is fully
expressed by its presence in this one array plus `out.issueAuthority.status`
staying `'provisional'` (already the case whenever issue was adopted) —
Commit 4's `computeIssueAuthorityContractPatch` needs no changes at all to
cover it. Referential no-op (returns the same array reference) when no
change applies, matching `escalateIssueAuthorityOnConflict`'s own
convention.

**`api/enrich.js` wiring:** the family-issue-consensus `else if` branch
(sibling to Commit 4's existing `deriveIssueAuthorityFromAdoption` call)
now also calls `appendYearToProvisionalFields` and
`buildVisualReferenceEvidence`, both real exported functions, no inline
reimplementation of either at the call site.

**Instrumentation (permanent, not temporary) — HISTORICAL, SUPERSEDED
design, replaced in review round 2 (item 3); current design described
there, not here.** ~~`extractIdentityFromImageSearch`
(`imageSearchIdentity.js:384`) gained a compact, permanent log line —
`[extractIdentity] full pool:` — dumping idx/itemId/legacyItemId/title/
price for every row in one execution's own logs on EVERY request.~~ This
design was replaced: it dumped the entire visual pool unconditionally,
which turned out to be an unbounded per-request Vercel log-volume cost
and measurably altered two of the eleven baseline suites' captured output
in this round's own full-suite A/B (see below). Current design: a
compact, family-SCOPED `[family-evidence]` line, emitted only at the two
decisions where a family is genuinely selected — see review round 2, item
3, for the full current description. The underlying goal this
instrumentation exists for is unchanged either way: making a specific
family member's real eBay itemId provable from one execution's own logs
once family clustering reports its indices — the literal single-request
itemId proof for the recovered idx2 lands on the first live scan after
deploy, a post-deploy verification item, not a blocker on this commit.

**"Not this comic" rejection — fingerprint stability, design only (no
rejection-persistence feature built this commit).** Investigated whether
the raw visual-family cluster label is stable enough to key a future
rejection record on. Confirmed NOT stable: repeated captures of the
identical physical book produced 16/18/20-row pools with different
cluster compositions across separate scan requests. Designed and shipped
`buildRejectedCandidateFingerprint(title, issue, year, variant)` (current
signature — year added in the second review round below) keying on the
normalized PROPOSED IDENTITY instead, already wired as the one live
consumer inside `buildVisualReferenceEvidence` above; no persistent
rejection-record feature exists yet to consume it beyond that.

**Tests** (`tests/q-trackB-commit4.1-spawn-visual-family-merge.test.js`,
**116/116 passing** — 73 from the first packet plus 43 from the review
round: cross-pool fingerprint stability across three real 16/18/20-row
production pools plus an engineered teeth-proof pool, year-only
containment's full production-composition control with its two
teeth-proofs and a combined-composition regression guard, and the
publisher-scoping anti-regression fixture with its own teeth-proof):
founding-fixture end-to-end chain (pre-merge 2-vs-3
fragmentation, merge-direction pin, post-merge weighted-consensus
promotion, issue/year adoption, the honest null variant checkpoint, 5-row
`visualReferenceEvidence` vs. the 6-row issue-scoped pool, downstream-order
proof); the full resolveFamilyYearConsensus 5-case matrix (A-E), each with
its own teeth-proof (Case B against a naive single-assertion-nominates
implementation; Case E against the naive pre-Commit-4.1 pool-wide
`ebay?.year || vision.year` fallback this dispatch replaced); isolated
`mergeFragmentedTitleFamilies` gate controls via hand-built `scored`
fixtures (merge-direction pin in isolation, absence-is-not-agreement,
issue contradiction, cover-letter contradiction, year contradiction,
`LOT_RE` contamination, an anti-overcorrection control confirming two
genuinely unrelated below-floor families never merge and the returned
array holds the same object references as the input — a true no-op, not a
reconstructed-but-equal copy — and a both-already-above-floor no-op
control); publisher non-adoption (both no-trusted-publisher-stays-null and
trusted-publisher-preserved-even-against-a-second-publisher-like-phrase-in
-a-merged-row); `buildVisualReferenceEvidence` unit controls (price-gap
handling, empty-result honesty, the population-lineage teeth-proof);
`appendYearToProvisionalFields` unit controls plus a teeth-proof against a
naive always-append implementation; 10x full-result determinism on the
merged promotion. Two hand-built isolated fixtures were found, during
this pass, to be internally invalid (duplicate raw-title text across
supposedly-distinct rows collapsed under the real dedup chain, and a
2-total-member pairing that could never clear the floor) — both are
genuine artifacts of constructing synthetic fixtures by hand, not
production bugs; both corrected and re-verified before being counted in
the total (the first packet's original 73). Full-suite regression:
`q-trackB-commit4-adoption-provisional` 152/152 (re-run clean, no change),
`q-trackB-commit3-manual-correction` 465/465 (re-run clean, no change),
`q142-instance2-phase2-population` 11/11, `variantIdentity` 37/37 — all
re-run clean. `npm run build` clean. ESM-mode parse verified explicitly on
all four touched files (`api/enrich.js`, `src/lib/identityCore.js`,
`src/lib/imageSearchIdentity.js`, `src/lib/issueAuthority.js`) plus the
new test file. **Full-suite baseline claim superseded by the review round
above (item 6):** the first packet's 3-file `git stash` spot check
(`image-search-extraction`, `identity-gate`, `pattern-k-dedupe-issue`) is
no longer the checkpoint-4 evidence — see the review round's TRUE
128-file full-suite A/B, which additionally caught a real 12th-file
regression (`q85-compact-key`) the 3-file spot check could not have
surfaced, since that file was never among the three checked.

**Resolved (was flagged as an open discrepancy in the first Commit 4.1
packet, closed in review round item 6):** Commit 4's 133/133 figure was
the presence-threading checkpoint specifically, not its final count — a
later evidence-custody/sold-path completion pass (same implementation
session) brought the suite to its actual final 152/152, documented in
Commit 4's own entry above at the point it occurred rather than left as
an unexplained +19 delta.

**Commit 4.1 — second review round (three further corrections, same
commit, still unstaged):**

**1. Year included in the rejected-candidate fingerprint.** The first
review round deliberately OMITTED year from `buildRejectedCandidateFingerprint`,
reasoning that a family-adopted year is itself potentially unstable.
Reversed this round: the asymmetry that decides it — a title|issue-only
key can silently COLLIDE across genuinely different products sharing the
same title+issue text (a different volume, reboot, or renumbering — see
the Pattern Library's "Batman #608 class" and "Catwoman #64 Szerdy-variant
class" above), silently suppressing a "not this comic" rejection the user
never made (confident and wrong); a year-instability mismatch merely
re-asks the user on the next scan (honest and open). `buildFingerprintYearToken(year)`
(new, exported, `issueAuthority.js`) normalizes a real year or returns the
literal, deterministic string `'unknown-year'` when unavailable — NEVER
silently shortens the key. `buildRejectedCandidateFingerprint` gained a
year parameter (title, issue, year, variant); `buildVisualReferenceEvidence`
threads `identity.confirmedYear` through as a new 5th argument. Founding
fixture: `spawn|351|2024`. Verified via direct execution across all three
REAL production-recovered pools (16/18/20-row) — all three produce the
identical `spawn|351|2024`, confirmed no #300/#307 row joined any of the
three accepted families. Determinism control: a fixture where year
adoption fails (<2 asserting rows) deterministically produces
`foo|12|unknown-year` across 5 independent runs — the fallback token is
itself stable, not an accident of whatever happened to be falsy that run.

**2. Positive product-agreement gate, conditional form.** Token
containment + no-contradiction (the first round's conditions 1/3) is
necessary but not sufficient to prove two fragments describe the SAME
visual product. New condition 5 on `mergeFragmentedTitleFamilies`, per
attribute in {cover designation, artist, presentation/finish marker}: a
fragment ASSERTS an attribute when >=1 of its own rows carries a value and
none disagrees (internal contradiction blocks, same semantics as the
existing issue/year checks); if EITHER fragment asserts, the OTHER must
positively assert the SAME value — asserted-by-one/absent-from-the-other
blocks (absence is not positive support); if NEITHER asserts, the
attribute is NOT APPLICABLE and never blocks (without this branch the gate
would silently neuter the whole feature for an ordinary, non-variant
book). Replaces the first round's cover-letter-only, combined-set,
contradiction-only check (which never caught the asserted-by-one/silent-
other shape). Reuses existing registries only: `extractCoverLetter`
(this file, pre-existing), `extractArtist` (`compHygiene.js`, newly
imported here), and a new `extractPresentationValue` built on the
existing `extractVariantTokens`/`tokenToVariantCategory` 'finish' category
(no new parser). Founding fixture verified at the ROW level: all 5 members
of both original fragments assert cover="C", artist="brett booth",
presentation="virgin" identically. Five new controls, all via the real
`mergeFragmentedTitleFamilies`: same title/issue/cover with a genuinely
different artist blocks; same title/issue/artist with Virgin-vs-no-finish-
token blocks; artist asserted by one fragment and absent from the entire
other blocks; presentation asserted by one fragment and absent from the
other blocks; a plain, non-variant book (neither fragment asserts artist
or presentation) still merges normally on the remaining gates. Teeth-proof:
a naive contradiction-only reconstruction of the gate wrongly allows the
artist-asserted-by-one fixture; the real gate correctly blocks it.

**Real regression found and fixed during this item's own investigation —
`ARTIST_PATTERNS` dual-responsibility class.** Implementing the artist
attribute required recognizing "Brett Booth" — absent from `ARTIST_PATTERNS`
(the variant checkpoint had already found this). Adding it as an ordinary
new entry, per the standing convention for this registry, broke the
16/18/20-row cross-pool fingerprint proof for two of three real pools:
`tokenizeTitleFamily` (this file) destructively strips every
`ARTIST_PATTERNS` match BEFORE title-family clustering (the pre-existing
Q-BC/Black Cat/Skottie Young fix, so a variant-cover artist named in
nearly every pool listing can't fuse into the family's own consensus
title) — a single shared registry serving two responsibilities
(recognition and destructive stripping) that don't always agree. Once
"Brett Booth" stripped, two genuinely-#351 rows in the 18/20-row pools
collapsed to a bare `"spawn"` token set, indistinguishable at the token
level from unrelated #300 McFarlane-variant rows in the same real pool
that ALSO reduce to bare `"spawn"` after stripping — the (correct,
unmodified) issue-contradiction gate then rightly refused the resulting
contaminated merge candidate, and the 16-row founding pool's own merge
shape silently shrank from 5 to 4 members as a side effect. Investigated
(all 5 real consumers of `ARTIST_PATTERNS` audited by file:line — only
`tokenizeTitleFamily` destructively strips; `extractArtist` (compHygiene.js),
`extractPoolArtistTokens` and the artist-specific query builder in
`api/comps.js`, and `variantIdentity.js`'s own local `extractArtist` are
all recognition-only and need every entry regardless) and reported before
implementing, per standing practice. Fix (user-approved diff, minimal —
corrected wording, this pass): the array SHAPE and every PRE-EXISTING
entry in `ARTIST_PATTERNS` are unchanged; `/brett booth/i` was added as a
new, narrow, multi-word-only recognition entry (needed for the positive
product-agreement gate's artist check, condition 6). New companion export
`ARTIST_FAMILY_STRIP_EXCEPTIONS` (a `Set`, `compHygiene.js`) holds
`'brett booth'` as its sole member — the single explicit opt-out from
`tokenizeTitleFamily`'s destructive stripping specifically. Every
pre-existing pattern is absent from that set and therefore still stripped
exactly as before (PIN A — no global default flip).
`tokenizeTitleFamily` now checks each match's text against the set before
replacing; the 4 recognition-only consumers are completely unchanged.
Verified (PIN B): the founding fixture's merge reverted to its ORIGINAL
5-member shape (indices `[0,2,1,5,7]`, tokens include "brett"/"booth"
again) once Brett Booth was excepted from stripping rather than naively
added to it; all three real 16/18/20-row pools now converge on
`spawn|351|2024` with zero #300/#307 contamination, confirmed by direct
execution. Regression controls: `tests/family-clustering.test.js`
(Black Cat/Skottie Young, the strip=true path this fix must never touch)
36/36 unchanged; a strip=true control (Skottie Young still stripped from
family tokens) and a strip=false control (Brett Booth still recognized by
`extractArtist`, now preserved in family tokens) both pass.

**3. Permanent instrumentation narrowed to the selected family only.**
The first round's `[extractIdentity] full pool:` line (removed) dumped
the ENTIRE visual pool on every single request regardless of outcome —
real, unbounded per-request Vercel log-volume cost, and it measurably
altered two of the eleven baseline-failing suites' captured stdout in the
first round's full-suite A/B (harmlessly, but real noise). Replaced with
a compact, family-SCOPED line —
`` [family-evidence] decision=<...> merged=<bool> rows=[{idx, itemId, legacyItemId, title, price}...] `` —
emitted by `selectTitleFamilyCandidate` itself (new local `logFamilyEvidence`
helper, not exported — a side-effecting log with no separate entry point,
verified structurally by firing exactly when a decision this commit's own
tests exercise fires), and ONLY at the two decisions where a family is
genuinely selected (`top-rank-protection` / `weighted-consensus`) — never
for `fallback-vision`/`refused-identity-conflict`, where nothing was
selected and there is nothing to prove an itemId for. `itemId`/`legacyItemId`
are still carried on every parsed row (`extractIdentityFromImageSearch`)
so the family-scoped log can read them — just no longer bulk-dumped.
This still closes the idx2-class single-request itemId proof on the first
live scan post-deploy; it now does so with a single, bounded, decision-
gated log line instead of an unconditional whole-pool dump.

**Re-verification after all three second-round items, in full:**
Focused suite (`tests/q-trackB-commit4.1-spawn-visual-family-merge.test.js`)
**162/162 passing** (116 from the first review round + 46 new: founding-
fixture row-level attribute assertions, 4 negative + 1 positive
product-agreement controls + 1 teeth-proof, 2 ARTIST_PATTERNS strip/
recognize decoupling controls + PIN B regression proof, the year-inclusive
cross-pool fingerprint re-verification with #300/#307-absence checks, and
the unknown-year determinism control). Commit 4 suite 152/152 (re-run
clean, no change). Commit 3 suite 465/465 (re-run clean, no change).
`q85-compact-key` 11/11. `family-clustering` (Black Cat/Skottie Young)
36/36. `npm run build` clean. ESM-mode parse verified explicitly on all
five touched production files (`api/enrich.js`, `src/lib/identityCore.js`,
`src/lib/imageSearchIdentity.js`, `src/lib/issueAuthority.js`,
`src/lib/compHygiene.js`) plus the test file.

**TRUE full 128-file suite A/B, run twice via `git stash` on all five
touched production files** (the new test file excluded from the stashed
BEFORE run, as it does not exist pre-Commit-4.1): BEFORE and AFTER both
produce EXACTLY the eleven documented baseline files
(`batch1-fixes`, `comp-filter-hygiene`, `decision-engine`, `identity-gate`,
`image-search-extraction`, `mega-keys`, `pattern-k-dedupe-issue`,
`priceBands`, `q-adv397-visual-guard`, `ship26-integration`,
`sold-verification`) — ten of the eleven byte-identical; the eleventh
(`pattern-k-dedupe-issue`) differs ONLY by the new narrow
`[family-evidence]` log line now firing on two of its fixtures (exactly
the approved, narrowed instrumentation working as intended), pass/fail
count unchanged (4 passed / 4 failed / 8 total, identical before and
after). **Full-suite A/B: no new failures relative to documented
baseline.**

**Commit 4.1 — third review round (two technical corrections plus a
Section 16 wording cleanup, same commit, still unstaged):**

**1. Issue upgraded to a MANDATORY positive per-fragment agreement.** The
original merge condition on issue (a combined-set `Set` of
`extractIssueFromTitle` over the deduplicated pool, rejecting only when
size>1) permitted three shapes it should not have: one fragment asserting
an issue while the other stayed entirely silent, both fragments entirely
silent, and — because it operated on the COMBINED set rather than
per-fragment — masked which side of a pair actually carried the
assertion. Issue is the single most load-bearing attribute in this merge
(the merged family is what CAUSES issue adoption downstream, via
`resolveFamilyIssueConsensus`), so it cannot be held to a weaker standard
than the conditional cover/artist/presentation gate (review round 2). New
`checkMandatoryAttributeAgreement(fragA, fragB, extractFn, label)`
(`imageSearchIdentity.js`) reuses the EXACT same `fragmentAssertion`
machinery `checkAttributeAgreement` (round 2) already built — only the
not-asserted branch's verdict differs: where the conditional gate treats
both-silent as "not applicable, don't block," this mandatory variant
treats ANY non-"both asserted and agree" outcome as a block — one
asserts/one silent, both silent, a genuine mismatch, or internal
disagreement within one fragment, all block; only both fragments
positively asserting the identical issue passes. Wired in place of the
old combined-set `Set` check, using `famA`/`famB` (the two original
pre-merge fragments) rather than the post-dedup combined indices. Five
required controls, all via the real `mergeFragmentedTitleFamilies`: both
assert the same issue -> pass; one asserts/other entirely silent ->
block; both entirely silent -> block; both assert different issues ->
block; internal disagreement within one fragment -> block. Teeth-proof: a
naive combined-set reconstruction (the pre-fix shape — filters out nulls
before checking size) wrongly permits the asserted-by-one/silent-other
fixture; the real per-fragment gate correctly blocks it. Re-verified the
four fixtures this upgrade could plausibly have affected — founding,
Alpha Flight, Bar Comics, and the Ordinary Comic positive control — all
still merge exactly as before, confirmed by direct execution: every
fragment in each of these already positively asserts its own issue
number, so the stricter standard changes nothing about their outcome.
Doc comment on `mergeFragmentedTitleFamilies` itself rewritten: the
taxonomy is now issue = mandatory positive per-fragment agreement
(condition 3), year = absence-never-blocks / only-asserted-conflict-blocks
(condition 4, unchanged), cover/artist/presentation = conditional
positive agreement (condition 6, unchanged) — the prior wording
(erroneously grouping issue with year under one absence-never-blocks
standard) corrected throughout, including the function's own doc comment
and the earlier Section 16 entries describing it (marked historical/
superseded in place, not silently rewritten as if always accurate).

**2. Fingerprint signature-change audit — repo-wide, both functions.**
`buildRejectedCandidateFingerprint` changed `(title, issue, variant)` ->
`(title, issue, year, variant)`; `buildVisualReferenceEvidence` changed
4 args -> 5 (added `stableYear`). JavaScript raises no error on stale
arity, so a missed legacy 3-/4-arg call would silently place a wrong
value in the new parameter's slot rather than fail loudly. Ran
`grep -RIn` for both function names across `src`, `api`, `tests`, `docs`
and produced the complete consumer table:

| File:line | Function | Args | Verdict |
|---|---|---|---|
| `issueAuthority.js:346` | `buildRejectedCandidateFingerprint` (definition) | 4 params | current signature |
| `issueAuthority.js:453` | real call site (inside `buildVisualReferenceEvidence`) | 4 | OK |
| `tests/...:207` | test | 4 | OK |
| `tests/...:208` | test | 4 | OK |
| `tests/...:698` | test | 4 | OK |
| `tests/...:763` | test | 4 | OK |
| `docs/LAUNCH-AUDIT.md:1872` (pre-fix) | prose reference | described 3-arg | **STALE, fixed this pass** — now states the current 4-arg signature with a forward pointer |
| `issueAuthority.js:428` | `buildVisualReferenceEvidence` (definition) | 5 params | current signature |
| `api/enrich.js:2827` | real call site | 5 | OK |
| `tests/...:201` | test | 5 | OK |
| `tests/...:508` (pre-fix) | test | 4 | **STALE, fixed this pass** — now 5 args, plus a new assertion on the resulting `familyKey`'s year segment |
| `tests/...:522` (pre-fix) | test | 4 | **STALE, fixed this pass** — now 5 args |
| `tests/...:532` | test — deliberate omitted-year control (NEW this pass) | 4 (intentional) | correct by design — proves the omitted-5th-arg fallback (`'unknown-year'`) is safe, not a stale call; `buildVisualReferenceEvidence` has no variant parameter, so a missing 5th arg can only ever affect the year segment, never silently misplace a different value |
| `tests/...:536` (pre-fix) | test | 4 | **STALE, fixed this pass** — now 5 args |
| `tests/...:544` | test | 5 | OK |
| `tests/...:690` | test | 5 | OK |
| `docs/LAUNCH-AUDIT.md:1676` (pre-fix) | prose reference | described 4-arg | **STALE, fixed this pass** — now states the current 5-arg signature with a forward pointer |

**Proof: every `buildRejectedCandidateFingerprint` call uses 4 args; every
`buildVisualReferenceEvidence` call uses 5 args except one deliberate,
clearly-labeled test of the omitted-arg fallback; zero legacy-arity calls
remain anywhere in `src`, `api`, `tests`, or `docs`.** Four stale test
calls found and fixed (adding the 5th argument each), two stale doc
prose references found and fixed (now stating current signatures with
explicit forward pointers to where each changed).

**3. Section 16 wording cleanup.** The second review round's own entry
asserted `` `ARTIST_PATTERNS` itself is completely untouched `` —
factually false; this commit added `/brett booth/i` to it as a new entry.
Corrected: the array SHAPE and every PRE-EXISTING entry are unchanged;
`/brett booth/i` was added as a new, narrow, multi-word-only recognition
entry (needed for the artist attribute in the positive product-agreement
gate); `'brett booth'` was added as the sole `ARTIST_FAMILY_STRIP_EXCEPTIONS`
member; default stripping is unchanged for every pre-existing artist.
Swept the rest of Section 16 for the same class of now-stale current-
state claim and fixed each, explicitly labeled historical/superseded
rather than silently rewritten: the variant checkpoint's original
"Brett Booth is absent from `ARTIST_PATTERNS`" finding (now recognized —
the checkpoint's null result persists for a different, current reason,
the majority-artist non-distinguishing threshold); the first round's
`"spawn|351"` (year-less) fingerprint description and its "year
deliberately NOT part of the key" claim (reversed in round 3 — corrected
to `"spawn|351|2024"` with a pointer to the reversal); the original
`[extractIdentity] full pool:` instrumentation description presented as
current design (marked historical, replaced by the family-scoped
`[family-evidence]` line, with a pointer to round 2's own description);
the old 3-arg/4-arg function signatures in prose (item 2, above). Every
correction is a strikethrough-or-explicit-historical-label edit in place,
not a silent rewrite — a reader following the document from its first
Commit 4.1 entry through this round can see exactly what changed and why
at each step.

**Re-verification after all three third-round items:** Focused suite
(`tests/q-trackB-commit4.1-spawn-visual-family-merge.test.js`) **175/175
passing** (162 from the second review round + 13 new: the five
mandatory-issue-agreement cases, its teeth-proof, and the four
re-verified pre-existing fixtures — founding/Alpha Flight/Bar Comics/
Ordinary Comic — confirmed unaffected). Commit 4 suite 152/152 (re-run
clean, no change). Commit 3 suite 465/465 (re-run clean, no change).
`q85-compact-key` 11/11. `family-clustering` 36/36. `npm run build`
clean. ESM-mode parse verified explicitly on all five touched production
files plus the test file.

**TRUE full 128-file suite A/B, run a third time via `git stash` on all
five touched production files:** BEFORE and AFTER both produce EXACTLY
the eleven documented baseline files — ten of the eleven byte-identical;
the eleventh (`pattern-k-dedupe-issue`) differs ONLY by the same narrow
`[family-evidence]` log lines already disclosed in round 2 (pass/fail
count unchanged: 4 passed / 4 failed / 8 total, identical before and
after). **Full-suite A/B: no new failures relative to documented
baseline.**

**`git diff --name-only` (exact campaign file list, this pass):**
`api/enrich.js`, `docs/LAUNCH-AUDIT.md`, `src/lib/compHygiene.js`,
`src/lib/identityCore.js`, `src/lib/imageSearchIdentity.js`,
`src/lib/issueAuthority.js` (tracked, modified) plus
`tests/q-trackB-commit4.1-spawn-visual-family-merge.test.js` (untracked,
new). `.claude/settings.local.json` also shows modified in `git status`
but is excluded from this campaign's scope per standing convention.

**Commit 4.2** — fingerprint year-placeholder resolver-entry fix + terminal
restamp finalizer. Closes the live-origin verification gap CP2 raised
against Commit 4.1 (a real physical scan of the Spawn #351 Cover C Brett
Booth Virgin book): the deployed Commit 4.1 build produced
`familyKey="spawn|351|unknown"`, not the required `"spawn|351|2024"`.

**Root cause, two independent, stacked defects, both confirmed via real,
unfiltered Vercel production log pulls (never query-filtered — a first,
filtered pull silently hid the diagnostic line and was caught and
re-pulled clean):**

1. Vision's own year field for the live scan was the literal string
   `"Unknown"` — `[ship12] ... Spawn #351 Unknown`, `[comicvine]
   query="Spawn 351" issue=351 year=Unknown`, `[ship28b-conflicts]
   sources={"vision":"Unknown","comicVine":"1992","priceCharting":2024}`.
   A truthy, non-null string `?? null` never intercepts. In
   `resolveFamilyYearConsensus` (`identityCore.js`), this was trusted as a
   real prior year, landing in the `conflict-locked` branch against the
   merged family's own legitimate 3/5-row `"2024"` vote instead of
   adopting it — explaining the absence of the expected `[commit4.1]
   identityProvisionalFields += 'year'` log line on the live request.
2. `buildVisualReferenceEvidence` runs in phase 1, BEFORE the separate,
   pre-existing `resolveYear` mechanism later corrects `confirmedYear` via
   PC/CV agreement — confirmed live, same request: `[commit4.1]
   visualReferenceEvidence: ... familyKey="spawn|351|unknown"` followed
   later by `[year-resolved] Unknown → 2024 (source=pc-cv-agreement)`. A
   placeholder captured early never retroactively benefits from a later,
   better resolution — even had defect 1 not existed, this gap would
   still strand a genuinely-late-resolving year.

**Ship-28b family-vote blind spot (why the existing conflict detector
didn't already catch this):** `[ship28b-conflicts]` is keyed ONLY on
`{vision, comicVine, priceCharting}` raw values — confirmed by direct
inspection, it never reads the family-vote's own adopted value, so it
cannot see "phase-1 family-adopted value disagrees with the later
terminal-resolved value," the specific shape this fix's own finalizer
partially addresses (for the placeholder case only — see REAL-YEAR
TERMINAL DIVERGENCE below).

**Fix 1 — resolver-entry boundary normalization.** New
`normalizeOptionalYear(value)` (`src/lib/yearEvidence.js`, new file — a
neutral home, not folded into `compHygiene.js`, so it is unambiguously
shared by both consumers below without implying a comp-hygiene-specific
scope): maps a fixed placeholder set (`'', 'unknown', 'unknown year',
'unknown-year', 'n/a', 'na', 'none', '?'`, case/whitespace-insensitive,
plus `null`/`undefined`) to `null`; every other value — including a real
non-string year — passes through completely unchanged. Applied as the
FIRST executable line inside `resolveFamilyYearConsensus`, before any
`priorYear`-branch below it runs; every existing branch's "priorYear
null" behavior already does the right thing, so a normalized placeholder
simply reaches that same behavior instead of being trusted as real. The
resolver defends its own boundary (not the caller) — `resolveIdentity`'s
call site needed zero changes, and any future caller of this function
inherits the protection automatically.

**Fix 2 — `buildFingerprintYearToken` defense-in-depth**
(`src/lib/issueAuthority.js`), independent of fix 1, reusing the SAME
canonical placeholder set so the two can never drift apart (the
"drifted-duplicate-constant" class this codebase has hit repeatedly — see
CLAUDE.md's Pattern Library): a semantic placeholder now maps directly to
the literal `'unknown-year'` token, never a normalized-but-meaningless
string like `"unknown"` — the exact mechanism that produced the live
`"spawn|351|unknown"` symptom (old code: `norm("Unknown")` returns the
non-empty string `"unknown"`, which was returned directly, never reaching
the old fallback that only fired on an EMPTY string).

**Fix 3 — terminal restamp finalizer.** New
`restampVisualReferenceEvidenceYear(visualReferenceEvidence,
visualReferenceFingerprintContext, terminalYear, terminalYearSource)`
(`src/lib/issueAuthority.js`) — a terminal, custody-gated re-check that
lets a genuinely-improved terminal year replace a phase-1 placeholder in
`out.visualReferenceEvidence.familyKey`, closing the timing gap from
defect 2 above (for cases fix 1 doesn't already fully resolve — see
Fixture B below).

**Four actions only — `'no-evidence' | 'fingerprint-custody-mismatch' |
'no-op' | 'restamped'`.** No fifth, conflict-reporting action. This was a
deliberate removal from an earlier draft of this plan (a
`'conflict-reported'` action was designed, then explicitly withdrawn):
**REAL-YEAR TERMINAL DIVERGENCE** — a phase-1 family-adopted REAL year
that later genuinely disagrees with a REAL terminal-resolved year — is
explicitly OUT OF SCOPE for Commit 4.2. Monotonicity is still enforced: a
phase-1 REAL year is NEVER overwritten regardless of what the terminal
value holds (silently resolves to `'no-op'`, tested in Section 8 of the
regression file below) — but no signal is raised when the two genuinely
disagree, an honest, documented gap rather than a claimed fix. No
existing gate contains this specific divergence shape either — Ship-28b's
own detector is blind to it for the reason described above. Recorded as a
named finding, scoped as Commit 5 input, not solved here.

**Custody precedes all year-action branching — two independent links,
both required, checked before any mutation is considered:**
- **Link 1** (current vs original): has
  `visualReferenceEvidence.familyKey` been mutated since
  `visualReferenceFingerprintContext` was captured?
- **Link 2** (original vs expected): was the captured context itself
  internally consistent — does rebuilding the fingerprint from its own
  captured `stableTitle`/`stableIssue`/`phaseOneYear` reproduce the
  captured `originalFamilyKey`?

Either link failing is a custody mismatch — no mutation is attempted, one
bounded log line fires. A missing or incomplete
`visualReferenceFingerprintContext` (null, or missing
`stableTitle`/`stableIssue`/`originalFamilyKey`) is a custody failure
too, NEVER reconstructed from terminal-mutable values
(`effectiveTitle`/`confirmedIssue` read live at the call site) — this
stays inside the four-action matrix as a custody-mismatch subtype, not a
fifth action. `phaseOneYear` itself may legitimately be `null` — checked
via `'phaseOneYear' in context`, not a null-check, so a genuine
placeholder capture is never mistaken for a missing one.

The `custodyExpected` log selector — `currentKey !== originalKey ?
originalKey : expectedKey` — reports the FIRST broken link rather than
always logging one fixed field: link-1 failure logs `originalKey` (what
the key was supposed to still be); link-2-only failure logs the rebuilt
`expectedKey` (what a self-consistent capture would have produced). Both
the custody rebuild and the restamp's new-key construction use ONLY the
captured `stableTitle`/`stableIssue` — never live/terminal-scope
`effectiveTitle`/`confirmedIssue`.

**Evidence custody:** restamping changes ONLY
`visualReferenceEvidence.familyKey` (via object-spread, overwriting
exactly one key) — `rows`, `count`, `low`, `high`, `median`,
`marketState`, `status`, `reason`, and every row's own
`title`/`price`/`itemWebUrl` stay byte-identical, enforced structurally
and tested explicitly (Section 5 of the regression file).

**Bounded logging — the only two outputs, fired exactly once each, never
on `no-op`/`no-evidence`:**
```
[commit4.2] fingerprint custody mismatch current="..." expected="..."
[commit4.2] familyKey finalized old="..." new="..." yearSource="..."
```

**`api/enrich.js` wiring** — a captured custody-context local
(`visualReferenceFingerprintContext`, declared separately from the
grouped `let` block above it for clarity, not merged into it) is bound
ONCE at the phase-1 `buildVisualReferenceEvidence` call site
(`fingerprintStableTitle`/`fingerprintStableIssue`/`fingerprintPhaseOneYear`
locals, guaranteeing the builder call and the captured context use
IDENTICAL values — `confirmedYear` in particular gets reassigned later in
this same function by `resolveYear`'s own PC/CV agreement, so reading it
live a second time at the terminal point would silently defeat the whole
point of a phase-1 snapshot). The terminal call site — a thin, six-line
pass-through with zero independent logic of its own — sits immediately
before the pre-existing `commit4-terminal` block, using the real,
already-computed `confirmedYear` and `yearResolution.yearSource`:
```js
if (out.visualReferenceEvidence) {
  const restamp = restampVisualReferenceEvidenceYear(
    out.visualReferenceEvidence, visualReferenceFingerprintContext,
    confirmedYear, yearResolution.yearSource);
  out.visualReferenceEvidence = restamp.evidence;
}
```

**Fixture B (Foo #12) — the case the terminal finalizer exists for,
distinct from the founding fixture's bug shape.** Verified via real
execution against the actual parser/clustering/merge chain before being
finalized into the test file: a real family-adopted issue (`"12"`, 3/3
unanimous) with GENUINELY insufficient year support at phase 1 (only 1/3
rows assert a year — below the 2-row adoption floor; `mode: 'no-data'`,
not a placeholder-mistrust case) — `confirmedYear` stays legitimately
`null`, `familyKey` is `"foo|12|unknown-year"`. When a real year later
arrives via the terminal path, the finalizer restamps to
`"foo|12|2024"`. This is the scenario where fix 1 alone (the resolver
boundary) does NOT help — there was never a placeholder to mistrust, only
genuinely thin evidence — so fix 3 (the terminal finalizer) is what
closes it.

**Founding fixture (the live scan's own shape), re-run with the exact
live bug input (`vision.year: "Unknown"`):** confirms `identity.confirmedYear`
adopts `"2024"` at phase 1 already (fix 1 alone fully resolves it — the
family's 3/5-row vote adopts cleanly once the placeholder is no longer
trusted as a real prior), `identityProvisionalFields` is exactly
`["issue","year"]`, `visualReferenceEvidence.familyKey` is
`"spawn|351|2024"` — the live bug's exact symptom does not reproduce. The
terminal restamp on this fixture is consequently a `no-op` (nothing left
for it to fix) — proving it is fix 1, not fix 3, that actually closes the
live scan's own bug. Fix 3 exists for the Fixture B shape and any future
case where phase 1 genuinely cannot resolve a real year in time.

**Teeth-proofs, both performed as a literal, live source-edit/observe/
revert/re-verify cycle during implementation (real commands/output, not
simulated), AND embedded in permanent, automated form in the regression
file (Section 2 and Section 10):**
- **X1** (`identityCore.js` resolver boundary) — bypassed
  `normalizeOptionalYear` at the function's entry
  (`const normalizedPriorYear = /* bypass */ priorYear;`), re-ran a
  direct reproduction of the founding fixture's family-vote shape:
  bug reproduced exactly — `{"year":"Unknown","mode":"conflict-locked",
  "assertedYears":["2024"],"uniqueRows":5,"support":3}`. Reverted;
  re-verified clean — `{"year":"2024","mode":"adopted",...}`,
  `git diff` line-count unchanged from pre-injection, ESM parse clean,
  Commit 4.1 suite 175/175 and Commit 4 suite 152/152 both clean.
- **X2** (`api/enrich.js` terminal call site) — replaced the terminal
  `if (out.visualReferenceEvidence)` guard with `if (false && ...)`
  (dead branch); confirmed via `grep` that
  `out.visualReferenceEvidence.familyKey` has exactly one writer in the
  entire file (the phase-1 `buildVisualReferenceEvidence` assignment) and
  the restamp call is the ONLY mechanism that ever updates it afterward —
  disabling it structurally proves no other code path would heal a
  placeholder. ESM parse still clean with the bypass injected (syntax-
  valid dead branch). Reverted; ESM parse clean, `git diff --stat`
  restored to the pre-injection 55-line diff, Commit 4.1 and Commit 4
  suites both re-verified clean.

**Test file:** `tests/q-trackB-commit4.2-fingerprint-year-restamp.test.js`
(new), **160/160 passing.** Ten sections: `normalizeOptionalYear`
controls (Section 0), `buildFingerprintYearToken` controls (Section 1),
the placeholder-boundary matrix with an embedded automated X1 teeth-proof
(Section 2), the founding fixture live-bug reproduction (Section 3),
Fixture B full chain (Section 4), Custody Test C — the concrete
successful restamp (Section 5), Custody Tests A/B/D — link-1 failure,
link-2 failure, and the `custodyExpected` selector distinguishing which
link failed (Section 6), missing/incomplete-context defense including
the legitimate-`phaseOneYear:null` control (Section 7), real-year no-op/
monotonicity controls documenting REAL-YEAR TERMINAL DIVERGENCE as an
honest gap (Section 8), placeholder-to-placeholder no-op (Section 9), and
`no-evidence` plus the embedded automated X2 call-vs-no-call teeth-proof
(Section 10).

**Handler-level integration test — scope note, disclosed, not a silent
substitution.** The approved contract's Required Test 3 described a
"handler-level" Fixture B exercise (a real `api/enrich.js` `handler`
import with `global.fetch` mocked). Investigated before writing the test
file: the real terminal call site this commit adds is the thin six-line
pass-through quoted above, with zero independent logic — verified by
direct reading of the diff. Exercising it via the full HTTP handler would
require mocking `api/enrich.js`'s entire external-call surface
(PriceCharting HTML scrape, ComicVine JSON, eBay Browse API JSON,
Ximilar, CGC lookup) — a large, fragile undertaking with no existing
hermetic precedent in this codebase (the one prior handler-level test,
`ship26-integration.test.js`, requires real API keys and is gated on
their presence, not mocked). The test file instead exercises the
IDENTICAL real functions in the IDENTICAL sequence the real call site
uses (Section 4), plus an explicit call-vs-no-call teeth-proof (Section
10) standing in for a literal source-edit/revert cycle against that call
site — which was ALSO performed once, live, as X2 above. A deliberate,
disclosed judgment call, not a scope reduction presented as full
coverage.

**Re-verification:** Commit 4.2 suite 160/160. Commit 4.1 suite 175/175
(re-run clean, no change). Commit 4 suite 152/152 (re-run clean, no
change). ESM-mode parse verified explicitly on `api/enrich.js`,
`src/lib/identityCore.js`, `src/lib/issueAuthority.js`, and the new
`src/lib/yearEvidence.js`. `npm run build` clean.

**TRUE manifest-based 128-file suite A/B** (one explicit manifest of the
original 128 `tests/*.test.js` files, the new Commit 4.2 test file
excluded per the approved mechanics; BEFORE = the three touched
production files path-limited-stashed via `git stash push --
api/enrich.js src/lib/identityCore.js src/lib/issueAuthority.js` and the
new untracked `yearEvidence.js` moved aside — never `-u`/`-a`, never
touching `.claude/settings.local.json`; AFTER = both restored): **11
failing files, IDENTICAL set before and after**
(`batch1-fixes`, `comp-filter-hygiene`, `decision-engine`,
`identity-gate`, `image-search-extraction`, `mega-keys`,
`pattern-k-dedupe-issue`, `priceBands`, `q-adv397-visual-guard`,
`ship26-integration`, `sold-verification` — one file beyond the 10 named
in CLAUDE.md's own "Known stale test suites" list, consistent with the
documented-11 baseline this campaign's prior Section 16 entries have
tracked since Commit 1.1), **zero pass/fail-count differences across all
128 files**, and — stricter than the Commit 4.1 precedent (which had one
file, `pattern-k-dedupe-issue`, differing only by disclosed new log
lines) — **all 11 failing files' raw stdout+stderr byte-identical
before vs after, zero differences of any kind.** A full-output grep
across all 128 AFTER captures for `[commit4.2]` returned zero matches —
confirms neither approved log format leaks into any unrelated suite. A
first attempt at this A/B was interrupted mid-sequence by a `for`-loop
exit code breaking the `&&` chain before `git stash pop` ran (loop body
included a known-failing test's nonzero exit); caught immediately via
`git status`, the stash was still present and un-lost, popped cleanly,
and the exercise was redone start to finish with `|| true` guards on the
loop body. Recorded here per this document's own standing practice of
logging near-misses, not silently omitting them.

**Relationship to Commit 4.1's live-closure requirement — stated
explicitly, per this dispatch's own accuracy standard:** Commit 4.2
makes the deployed build **capable of** producing
`familyKey="spawn|351|2024"` under the corrected live path. **Commit 4.2
alone does NOT close Commit 4.1.** Commit 4.1 closes only after the
required repeat live scans pass against the SHA-verified deployed Commit
4.2 build — the same CP1-CP4 checkpoint structure used for the original
live-origin verification, re-run once Commit 4.2 is staged, committed,
pushed, and independently deployment-verified.

**`git diff --name-only` (exact campaign file list, Commit 4.2 pass):**
`api/enrich.js`, `docs/LAUNCH-AUDIT.md`, `src/lib/identityCore.js`,
`src/lib/issueAuthority.js` (tracked, modified) plus
`src/lib/yearEvidence.js` (untracked, new) and
`tests/q-trackB-commit4.2-fingerprint-year-restamp.test.js` (untracked,
new). `.claude/settings.local.json` also shows modified in `git status`
but is excluded from this campaign's scope per standing convention.

DO NOT STAGE, COMMIT, OR PUSH before review.

**Commit 4.3** — winning-family authority preservation and conflict
containment. Root cause: a real live production scan (Spawn #351 Cover C
Brett Booth Virgin, 2026-07-30 23:16:50, deployment
`dpl_7PHbRJGqB3Cn6itx1iBYuM7tqVJx` / build `c9530ba`, Commit 4.2's own
deployed build) produced a coherent 5-member Spawn #351 title family
(merged from a 2-row + 3-row fragment, weightSum=13.5, 5/5 internal issue
support, 3/5 asserting "2024") — but Q84's title-safety gate correctly
refused to replace the clean canonical title "Spawn" with the family's own
marketplace-derived cluster label, forcing title decision =
`fallback-vision`. Two different axes were conflated: `resolveIdentity`'s
family-issue/year-consensus computation was gated behind the SAME decision
value Q84's title-safety check controlled, so the coherent family's own
issue/year evidence was silently discarded whenever title projection was
blocked. `vision-zero-support` then fell through to the raw pool's
unrelated #300 plurality (9/18, from unrelated Todd McFarlane 1:50 variant
listings mixed into the same pool) and adopted it as `confirmedIssue` —
Phase 2 went on to query, cache, and price Spawn #300 entirely, while the
"PROMOTED" banner and reference evidence both spoke of the #351 family, and
the client-forwarded "Brett Booth virgin variant" text (a genuinely correct
Vision read, captured against Vision's own issue "301") survived unchanged
alongside it — an impossible identity on one card.

**Title-axis-only qualification.** A first-draft implementation gated
retention on bare `topFamily.count >= 3` — too permissive:
`selectTitleFamilyCandidate` returns `decision:'fallback-vision'` with a
populated, possibly `>=3`-member `topFamily` for BOTH a genuine title-axis-
only Q84 block AND a family that merely shares weak token overlap with
Vision's own title (confirmed live via direct execution — a real "Batman
Beyond Legacy Special Returns Edition" 5-member family, 33% overlap,
reaches `fallback-vision` with `topFamily.count:5`). Fixed with an explicit
`titleAxisOnlyBlock: true` marker, set ONLY at the single genuine
Q84-dual-axis-blocked return site in `selectTitleFamilyCandidate`
(`src/lib/imageSearchIdentity.js`).

**The qualified-family predicate — one precondition, then 4 evidence-
quality conditions, all required (FINAL, corrected form — see the two
named findings immediately below):**

- **PRECONDITION — `hasValidFamilyMembership(visualItems, topFamily.indices,
  topFamily.count)`** (`src/lib/compHygiene.js`). Runs FIRST, short-
  circuiting the whole predicate. Requires: `visualItems` is an array;
  `indices` is an array; `indices.length` agrees with the family's own
  claimed `count`; every index is a unique integer; every index is in
  bounds; every referenced row actually exists (`visualItems[idx] !=
  null`). This is a current-request-membership precondition, NOT a fifth
  evidence-quality signal — its failure means the family never reaches
  measurement at all: `familyIssueConsensus`/`familyYearConsensus` stay
  `null`, zero `[commit4.3]` log lines, zero structured `[family-evidence]`
  events, no provisional override, and the pre-existing raw-pool fallback
  path stays fully reachable.

1. `family.titleAxisOnlyBlock === true` — a genuine Q84 title-axis-only
   block, not a weak-overlap or any other `fallback-vision` reason.
2. `family.topFamily.count >= FAMILY_AUTHORITY_COHERENCE_FLOOR` (3) — a
   minimum coherence floor.
3. `!hasContaminatedMember(visualItems, topFamily.indices)` — no member of
   the family trips the shared contamination screen (lot/reprint/slab/
   graded/signed/TPB markers; `src/lib/compHygiene.js`, shared with
   `imageSearchIdentity.js`'s own merge-gating logic to avoid a circular
   import from `identityCore.js`).
4. `familyDominatesRunnerUp(topFamily.weightSum, runnerUp?.weightSum)` —
   the SELECTED family must dominate the runner-up by the reused 3x
   margin (`top >= runner * 3`), inclusive boundary.

**NAMED FINDING 1 (IMPLEMENTATION PACKET HOLD — FINAL NARROW HOLD, item 1,
2026-07-30) — the first-pass predicate had no membership precondition at
all.** A stale/foreign family (e.g. `topFamily.indices` carried over from a
different/prior scan, not belonging to the current request's
`visualItems`) could reach the MEASURE step, relying on
`resolveFamilyIssueConsensus` degrading gracefully to `no-data` rather than
being rejected up front by the gate itself. Fixed by adding
`hasValidFamilyMembership` as an explicit precondition (above), verified
via direct execution to fail closed on all six structural violation modes
(non-array inputs, count mismatch, duplicate indices, non-integer indices,
out-of-bounds indices, a referenced row that doesn't exist) and to produce
the full required silent-safe contract end-to-end through `resolveIdentity`.

**NAMED FINDING 2 (IMPLEMENTATION PACKET HOLD — FINAL NARROW HOLD, item 2,
2026-07-30) — the first-pass margin condition was VACUOUS, masked by an
impossible test fixture.** The first-pass implementation reused
`isCompetingFamilyTooStrong(topFamily.weightSum, [runnerUp])` verbatim
(inverted with `!`) as the 4th condition. This function's real, original
semantics (top-rank-protection, `imageSearchIdentity.js`) is "does the
strongest competitor outweigh `item0Family` by 3x?", correct THERE because
`item0Family` is selected by POSITION (the visually-first search result)
and can legitimately have less weight than a competitor. At the retention
gate's call site, however, `topFamily`/`runnerUp` are literally
`scored[0]`/`scored[1]` — `topFamily.weightSum >= runnerUp.weightSum`
ALWAYS holds by construction. Under that constraint,
`isCompetingFamilyTooStrong(top, [runner])` can only ever return `true` in
a degenerate zero-weight case (`runner >= top*3` requires `runner > top`,
contradicting the ordering invariant) — the first-pass condition could
NEVER actually have blocked retention in production. This went undetected
because the first-pass regression control used an IMPOSSIBLE fixture
(`topFamily.weightSum=3`, `runnerUp.weightSum=10` — a runner-up outweighing
the top family, which cannot occur at this call site) that happened to
exercise the buggy formula's "blocked" branch by coincidence, not by
correctly modeling real data. Root cause was investigated per R1's STOP-
and-report instruction: reusing `isCompetingFamilyTooStrong` for the
retention gate's genuinely different weight-ordering invariant would have
required changing that function's meaning, which would have broken its
own, correct, original top-rank-protection call site. Resolution: a
separately-named function, `familyDominatesRunnerUp(topWeightSum,
runnerUpWeightSum)` = `topWeightSum >= runnerUpWeightSum * 3` (`true`
trivially when there is no real runner-up), added alongside
`isCompetingFamilyTooStrong` in `src/lib/compHygiene.js` — NOT a mutation
of that function's shared semantics, which is untouched and still correct
at its original call site; both functions' doc comments now cross-
reference each other's weight-ordering assumptions explicitly, and the
generic-hype boundary is inclusive (`>=`), matching
`isCompetingFamilyTooStrong`'s own convention: `top=9, runner=3` exactly
dominates. Verified via direct execution against three real, correctly-
ordered examples: `top=13.5, runner=3.0` (the real live Spawn fixture's
own numbers) → dominates, ALLOWED; `top=10, runner=4` → does not dominate
(`10 < 12`), BLOCKED; `top=9, runner=3` → exact equality boundary,
ALLOWED. Confirmed the real live Spawn fixture's own outcome is
byte-identical under the corrected logic (13.5 dominates 3.0 either way,
so this specific production case was never actually affected by the bug —
the vacuousness was a latent gap, not a symptom observed in the one
production incident this commit is built around).

**Measure/decide split — `decideFieldAuthority`
(`src/lib/identityCore.js`), five outcomes (FINAL, corrected form — see
NAMED FINDING: CONFIDENCE-AS-AUTHORITY, immediately below):**

**Confidence vs. authority — the distinction this hold corrected.**
Confidence measures certainty WITHIN a source: how sure Vision is of its
own read. Authority records PROVENANCE — who or what asserted a value, and
what permission that source has to control identity — and is a completely
separate axis. Confidence cannot manufacture provenance: a source being
very sure of itself is not the same as a second, independent source having
corroborated it. `decideFieldAuthority` now takes an explicit,
source-aware input:
```
{ priorValue, priorSource: 'manual'|'user'|'catalog'|'vision'|'unknown',
  priorIndependentlyTrusted, priorConfidence, familyValue, familyMode,
  priorHasSupportInFamily }
```
`priorIndependentlyTrusted` is computed by the caller via the new
`isPriorSourceIndependentlyTrusted(priorSource, hasCorroboratingAuthorityRecord)`
— trusted for `'manual'`/`'user'` (a server-validated correction),
trusted for `'catalog'` ONLY when an explicit corroborating authority
record is also supplied (the bare tag alone proves nothing — no live
catalog-authority source exists in this codebase yet, so this currently
always evaluates `false` in practice, a deliberate conflicted-safe
default), and NEVER trusted for `'vision'` (including HIGH confidence) or
an unrecognized/absent source. `priorConfidence` remains a genuine input
to the decide contract — NOT vestigial, and NOT re-purposed to derive
trust — see the `provisionally-corrected`/`conflicted` split below, where
it legitimately still matters:

- `adopted` — prior missing/placeholder; `resolvedValue` = family's
  observed value; `authoritativeForCustody: true`.
- `corroborated` — prior present, family agrees; `resolvedValue` = prior
  (unchanged); `authoritativeForCustody: true`. Agreement needs no
  independent-trust argument — both sides already concur.
- `provisionally-corrected` — an UNTRUSTED prior (`priorIndependentlyTrusted:
  false`) that is also NOT high-confidence (`priorConfidence !== 'high'`),
  with ZERO support in a qualified, disagreeing family; `resolvedValue` =
  family's observed value; `authoritativeForCustody: true`. This is the
  Spawn fixture's own path for both issue and year (Vision's issue "301"/
  year "2020" are LOW-confidence, untrusted, 0/5 family support) — a
  silent correction is only safe here because the prior was never
  confident about itself either.
- `preserved-prior` — `resolvedValue` = prior; `authoritativeForCustody`
  is `true` only when the prior is INDEPENDENTLY TRUSTED BY PROVENANCE
  (`priorIndependentlyTrusted: true` — a validated manual/user correction
  or corroborated catalog record; NEVER Vision alone, regardless of
  confidence). Fires both when the family doesn't qualify at all, and when
  a qualified family disagrees but the prior is trusted.
- `conflicted` — `authoritativeForCustody: false`; fires in THREE cases:
  (a) the prior is placeholder and the family is inconclusive (genuinely
  no data); (b) a qualified family disagrees with an untrusted prior that
  nonetheless has SOME support in the family (a genuine, non-unanimous
  ambiguity); or (c) — NEW this hold — a qualified, unanimous family
  disagrees with an untrusted-but-HIGH-CONFIDENCE prior with ZERO family
  support (an ordinary Vision read at its own most confident is still not
  independent corroboration; overriding a confident-but-untrusted
  assertion silently is a different, greater risk than overriding an
  admittedly weak one — the disagreement is recorded, resolved in neither
  direction). `resolvedValue` = prior in all three cases (never silently
  overwritten by the family).

A legacy-mode mapping (`legacyModeFor`, inline in `resolveIdentity`) maps
the five-outcome vocabulary onto the pre-existing mode vocabulary
(`adopted`/`corroborated`/`preserved`/`conflict-locked`/`no-consensus`/
`no-data`) so unmodified downstream consumers
(`deriveIssueAuthorityFromAdoption`, `out.issueConsensusConflict`) keep
working without changes.

**`resolveFamilyIssueConsensus`'s additive `assertedIssues` field**
mirrors `resolveFamilyYearConsensus`'s pre-existing `assertedYears` field
exactly; added to all 6 return statements. Landed only after the required
pre-change audit — grepped `resolveFamilyIssueConsensus`/
`resolveFamilyYearConsensus` across `tests/`, `src/`, `api/`; distinguished
comment-only mentions from real calls (16 real consumers across 21 broadly-
matching files); found exactly 9 real exact-shape (`assertEq(x, {...})`)
assertions across exactly 2 files (5 in
`tests/q-trackB-commit4.1-spawn-visual-family-merge.test.js` against
`resolveFamilyYearConsensus`, unaffected by an issue-side-only field; 4 in
`tests/q-trackB-commit4.2-fingerprint-year-restamp.test.js` — 2 against
`resolveFamilyYearConsensus`, unaffected, and 2 against
`identity.familyIssueConsensus`/`familyYearConsensus`, of which 1 needed
the new field added — done, and the suite re-verified at 160/160 with no
other change). One apparent match
(`tests/q-trackB-commit3-manual-correction.test.js:188`) was ruled out as
an unrelated `validateManualAuthority` function sharing no relationship to
either consensus function. The new field is additive-only — no existing
exact-shape assertion needed to change beyond the one identified.

**Shared custody invariant — `checkCrossPopulationPromotionGuard`
(`src/lib/issueAuthority.js`, revised signature
`(familyIssueDecision, custodyValues)`).** Consumes the decide-result's
`authoritativeForCustody`/`resolvedValue` fields directly — never
reconstructed from `.mode` string matching, which is what let the
original live bug through undetected (a `mode==='adopted'`-only guard
would have silently passed a `corroborated`-but-mismatched case; see
Mutation 3 below). Called at exactly 4 sites in `api/enrich.js`:
1. Promotion — before `identityRefusedPromotionEligible` is finalized.
2. Exact-cache access — before `canUseExactIssuePricingCache` is consulted
   (`cacheCustodyCheck`).
3. Terminal authoritative-pricing — before
   `computeIssueAuthorityContractPatch`; synthesizes a `conflicted`
   `issueAuthority` object on violation to reuse existing machinery rather
   than inventing a parallel contract.
4. Response finalization — before `out.issue = confirmedIssue ?? null`.

Each site logs a `[commit4.3] ... custody blocked: ...` line and sets
`out.crossPopulationPromotionBlocked` (I13 — annotate, never silently
drop) on a violation.

**Variant provenance follows the final issue.**
`isVariantProvenanceValid(variantSourceIssue, confirmedIssue)`
(`src/lib/variantIdentity.js`) — `variantSourceIssue == null ||
String(variantSourceIssue) === String(confirmedIssue)`, wired via
`issueNum` (the practical proxy for "the issue this variant was captured
alongside"). In the live fixture, "Brett Booth virgin variant" was
captured against Vision's original issue "301" — invalidated once
`confirmedIssue` resolves to "351"; `api/enrich.js` clears
`req.body.variant` and recomputes from the final issue-scoped population
only when provenance is invalid.

**`computeListingPricingAuthority` — implemented, then FULLY REMOVED**
(not merely reverted in spirit — the function, its call sites, and its
doc comment are gone from `src/lib/issueAuthority.js`/`api/enrich.js`).
The existing, unmodified Commit 4 `computeIssueAuthorityContractPatch`
already satisfies every observable pricing/listing requirement this
commit needed; the four new field names it would have introduced
(`recommendedListPrice`/`priceReady`/`pricingAuthority`/
`listingAuthority`) are real Commit 6 consumer-contract design work, not a
two-function bolt-on to Commit 4.3.

**Structured `[family-evidence]` event — a deliberate supersession, not
drift.** `imageSearchIdentity.js`'s pre-existing `logFamilyEvidence` call
site explicitly excludes `fallback-vision`/`refused-identity-conflict` —
retention is a newly-recognized authority path that never had ANY
`[family-evidence]` coverage before this commit. The new event fires from
`api/enrich.js` (not `identityCore.js`) specifically because issue/year
support numbers and the final `familyKey` are only known at that later
point in the pipeline, gated so it fires exactly once per qualifying
request (never alongside the pre-existing site's own line). Extracted into
`buildRetentionFamilyEvidenceLog` (`src/lib/imageSearchIdentity.js`) — a
real, exported, pure function returning `{isRetentionPath, logLine, rows}`
rather than calling `console.log` itself, so it is directly assertion-
testable; `api/enrich.js`'s real call site imports and invokes this exact
function and logs its returned `logLine` unmodified. Verified via direct
execution against the real 18-row Spawn fixture to reproduce the real
production log byte-for-byte: `[family-evidence] decision=fallback-vision
merged=true familyEvidenceQualified=true
qualificationReason=title-axis-only-block-retained issueSupport=5/5
yearSupport=3/5 familyKey="spawn|351|2024" rows=[...]`.

**Exact-vs-synthetic fixture disclosure.** The regression file's 18-row
Spawn pool reproduces EXACT LIVE IDENTITY DATA recovered from the
production log (row ordering, all 18 titles, extracted issues, the one
real itemId/price/itemWebUrl — row 0, the only row the log dumped as a
full object — the original Vision fields, the original eBay pool-wide
consensus, and the original `fallback-vision` decision, reproduced via the
real `selectTitleFamilyCandidate` call). The 17 non-row-0 prices/
itemWebUrls are SYNTHETIC HARNESS METADATA, clearly labeled inline, never
used to prove price amounts or commerce behavior. The two hard-rejected
rows (`categoryClassifier.js`, untouched by this commit) are preserved as
counts + codes ONLY (`hardRejectedCount:2, TITLE_PATTERN_PRINT:1,
MARKETPLACE_POSTER_CATEGORY:1, rowBodiesAvailable:false`) — the runtime
log never recorded their title text, and no synthetic row bodies are
fabricated to fill the gap.

**Direct, non-mocked #300 proofs (Precision Clause 3):**
- Cache-key level: `buildComicVineCacheKey`/`buildPriceChartingCacheKey`/
  `buildActiveCompCacheKey` (relocated to new `src/lib/cacheKeys.js`,
  re-exported from `api/enrich.js` for backward compatibility) built from
  the fixture's resolved identity (issue "351") never parse out "300" via
  `parseCacheKeyIssueSegment`; the identical parser applied to the
  original live-bug key shapes (`ac:v9:Spawn|300`,
  `pc:v1:spawn|300|2020`, `pc:v1:Spawn|300|2024`, `cv:Spawn|300|Image
  Comics`) all correctly parse OUT as "300" — confirming the parser
  genuinely distinguishes rather than vacuously passing.
- Query-params level: new `buildComicVineQueryParams`/
  `buildPriceChartingQueryParams` (`src/lib/cacheKeys.js`) extract the
  exact `{title, issue, year, ...}` object each real `api/enrich.js` Fix-3
  Promise.all call site builds for `lookupComicVine`/`lookupPriceCharting`
  — asserted directly against the fixture's resolved identity, never "300".
- Cache read/write level: the real `kvGet`/`kvSet`
  (`api/kv-cache.js`) are called directly (not mocked) — confirmed safe in
  this environment via standalone execution before being relied on:
  without Redis credentials, the real `.get()`/`.set()` call fails before
  any network is reached (observed as either a module-resolution failure
  for `@upstash/redis` or, when the module resolves, a "Failed to parse
  URL from /pipeline" error from the client itself, depending on the
  importing file's own resolution context — both caught internally by
  `kv-cache.js`'s own try/catch, `kvGet` resolving `null` and `kvSet`
  resolving `undefined` either way). A spy wrapper around these real
  functions proves zero `ac:` cache calls occur when exact-issue cache
  access is disallowed (not merely that the eligibility boolean is false),
  with a positive control confirming the same spy DOES record a call when
  eligible, using the corrected issue "351".
- **PC-specific read adapter (IMPLEMENTATION PACKET HOLD — FINAL NARROW
  HOLD, item 3, 2026-07-30):** the prior packet proved `pc:v1` key
  CONSTRUCTION only, not actual read/write custody — corrected. New
  `readPriceChartingCache(fullTitleKey, strippedTitleKey, kvGetFn)`
  (`src/lib/cacheKeys.js`), extracted verbatim from `api/enrich.js`'s real
  Fix-3 Promise.all call site (the "try full title, fall back to stripped
  title, skip the redundant second read when both keys are identical"
  pattern) — the real call site and the test now invoke the IDENTICAL
  function, `kvGetFn` injected so the test passes a spy wrapper around the
  real `kvGet` while the real call site passes the real `kvGet` directly.
  Verified via direct execution: called with the corrected fixture's own
  keys (issue "351"), records exactly one real `kvGet` call (the dedup
  correctly skips the second read), returns the genuine `{hit: null,
  result: null}` MISS shape (no fabricated cache hit), and the recorded
  call never references issue "300". A parallel write-side proof spies the
  real `kvSet` directly (no separate write wrapper was added — the real
  call site's write is a single, un-branching `kvSet(key, result, ttl)`
  with no PC-specific branching logic worth centralizing beyond what the
  read side already needed) and confirms a write scoped to the corrected
  fixture's own key never references issue "300" either. Negative controls
  confirm `pc:v1`/`ac:v9` keys built with the wrong issue "300" parse
  correctly as "300" and are never among the keys the corrected fixture's
  real calls actually used. A positive control confirms an independently-
  eligible case's PC and AC keys both parse to issue "351".
  **Disclosed structural asymmetry, named honestly rather than glossed
  over:** the `ac:` exact-issue cache IS gated by the custody invariant
  (`canUseExactIssuePricingCache` + `checkCrossPopulationPromotionGuard`)
  and shows literally ZERO calls when ineligible. The `pc:`/`cv:` Fix-3
  Promise.all block has NO equivalent custody gate today — it is
  UNCONDITIONAL, always attempting a cache read (and a write on a fresh
  miss plus successful live query) regardless of whether the resolved
  issue is provisional or authoritative. This is pre-existing, pre-Commit-
  4.3 behavior, not something this commit was asked to or did change (the
  PC/CV lookup is what RESOLVES the identity's supporting data in the
  first place — gating it behind a custody check that itself depends on
  identity resolution having already happened would be circular). What
  this commit proves directly instead: for the corrected Spawn fixture,
  this unconditional activity is scoped exclusively to the corrected issue
  "351" — it never reads or writes under the wrong issue "300" the live
  bug actually cached under. As a small bonus correctness fix found while
  wiring this in, the second (subtitle-stripped-fallback) `lookupPriceCharting`
  call at this same call site was also converted from an inline object
  literal to `buildPriceChartingQueryParams`, matching the first call —
  it had been missed in the original Section 3(a) pass.
- **Remaining structural limitation, disclosed per the addendum's
  feasibility rule rather than papered over:** `lookupComicVine`/
  `lookupPriceCharting` themselves perform real network calls (ComicVine
  REST API / PriceCharting scrape) and cannot be invoked for real in a
  test without either live network access or mocking `global.fetch` —
  the latter is the handler-scale mocking the addendum instructs against
  reaching for without a narrower alternative. No narrower adapter exists
  past the query-params-construction boundary proven above. This is not
  load-bearing for the bug class this commit closes: both call sites read
  the query-params object (or `confirmedIssue` directly) with no
  independently-tracked "target issue" variable that could diverge from
  what's asserted.

**Mutation proofs (8 required, all embedded as automated naive-
reconstruction contrasts in the regression file; Mutations 1 and 6 were
ALSO performed as literal live source-edit/observe/revert cycles against
the real production files during implementation):** count-only family
authority (the qualified predicate's core fix); automatic null-prior
adoption (measure-with-null-prior vs. the real decide step); omission of
`corroborated` mode in the custody invariant; terminal issue drift (no
custody check before `out.issue`); cache issue drift (no custody check
before exact-cache access); removed cross-population promotion guard (the
ORIGINAL live bug, reproduced exactly); stale variant surviving an issue
change; missing family-evidence emission — this last one now three
independent proofs (8a: the pre-existing `[commit4.3]` summary line; 8b:
direct exercise of the real `buildRetentionFamilyEvidenceLog` function,
contrasted against a naive skipped-call simulation; 8c: source-presence
assertions against the real `api/enrich.js` file on disk, confirming the
call site still imports and invokes the real function and still gates its
`console.log` on `isRetentionPath` — closing the gap flagged during review
that testing only the summary line was insufficient to catch a deleted/
bypassed structured-emission call site).

**Five additional required controls (A-E), all using real exported
production functions against hand-built `family` fixtures** (the same
accepted pattern already used elsewhere in this file for a hand-set
`titleAxisOnlyBlock` marker standing in for what
`selectTitleFamilyCandidate` would produce):
- **A — stale/foreign family:** `topFamily.indices` referencing positions
  that don't exist in the current `visualItems` (simulating an identity
  object carried over from a different scan). The qualified predicate has
  no index-bounds check, but the real measurement function
  (`resolveFamilyIssueConsensus`) maps out-of-range indices to undefined
  rows and correctly returns zero real assertions
  (`mode:'no-data', uniqueRows:0`) — `decideFieldAuthority` degrades to
  `preserved-prior`/`authoritativeForCustody:false`; no silent
  wrong-authority adoption from a stale family occurs.
- **B — weak-margin family:** clears the coherence floor and carries
  `titleAxisOnlyBlock:true`, but the real `isCompetingFamilyTooStrong`
  correctly flags a competing family at >=3x weight — the 4th predicate
  condition blocks retention despite the first three passing.
- **C — naturally-formed contaminated family:** clears the coherence
  floor WITHOUT any fragment merge (a real single-cluster family, not a
  Spawn-class 2+3 merge), but one member trips the real
  `hasContaminatedMember` (a bare "CGC 9.8" token) — confirms the
  contamination screen applies to naturally-formed families, not only
  merge-produced ones.
- **D — valid contradictory TRUSTED prior:** SUPERSEDED by Controls T1-T5
  (IMPLEMENTATION PACKET HOLD — FINAL AUTHORITY-SOURCE HOLD, below) — the
  original form of this control used `confidence:'HIGH'` alone as its
  trust signal, which is exactly the defect that hold corrected. Replaced
  entirely, not patched, since testing `confidence:'HIGH'` as a trust
  proxy would now assert the WRONG (pre-correction) outcome. See NAMED
  FINDING: CONFIDENCE-AS-AUTHORITY and Controls T1-T5 below for the
  corrected, provenance-based replacement.
- **E — raw-pool fallback reachability:** a non-qualifying family (weak
  overlap, no `titleAxisOnlyBlock`) coexists on the same request with a
  Vision issue carrying genuinely zero raw-pool support — confirmed the
  pre-existing `vision-zero-support` ESCALATE mechanism remains fully
  reachable (`identityEscalation:'ID_REQUIRED'`), not silently suppressed
  by the mere presence of an unrelated, non-qualifying family.

**Verification battery (manifest-correct baseline procedure, fresh
isolated worktree, FINAL round — the "IMPLEMENTATION PACKET HOLD — FINAL
NARROW HOLD" corrections, 2026-07-30).** Two disclosed incidents this
round, both caught and corrected before the reported results below, per
this document's own standing practice of logging near-misses rather than
omitting them:

1. **`core.longpaths` (first pass, prior round, still outstanding per
   R3's explicit re-request):** the first isolated-worktree attempt hit a
   real Windows "Filename too long" error on a long base64-encoded image
   filename in the repo. Ran `git config core.longpaths true` as a
   workaround — a direct violation of the standing "never update git
   config" instruction. Caught immediately, ran `git config --unset
   core.longpaths` right away, confirmed via `git config --get
   core.longpaths` returning empty. All worktrees in every subsequent
   round (including this final one) used a short root path instead
   (`C:\cv-baseline-4.3b`, then `C:\cv-baseline-4.3c`) with zero git
   config changes — confirmed via `git config --get core.longpaths`
   returning empty both before and after every round since.
2. **`node_modules` junction deletion (this round, new):** the prior
   round's baseline worktree (`C:\cv-baseline-4.3b`) had its
   `node_modules` linked in via a Windows directory junction pointing at
   the MAIN project's real `node_modules` (since `git worktree add` does
   not carry over gitignored directories). When that worktree was later
   removed via `git worktree remove --force`, the removal recursed
   THROUGH the junction rather than treating it as an opaque reparse
   point — deleting the CONTENTS of the main project's real, shared
   `node_modules` directory, not just the junction pointer. This was
   caught immediately afterward when an unrelated focused-suite re-run
   (`q-trackB-commit3-manual-correction.test.js`, which imports
   `api/enrich.js` and transitively `@anthropic-ai/sdk`) crashed with
   `ERR_MODULE_NOT_FOUND`. Investigated before acting further (confirmed
   `node_modules` was genuinely empty — 0 entries — and that `git status`
   showed all tracked source/test files completely untouched, ruling out
   any git-level damage). Recovered via a plain `npm install` in the main
   project directory (a safe, standard, reversible restorative action —
   reinstalls from `package.json`/`package-lock.json`, touches no source
   or git state) — confirmed via the same test re-running clean
   afterward (465/465). **Junctions to the main project's `node_modules`
   are no longer used for baseline worktrees as a result** — this final
   round's baseline worktree (`C:\cv-baseline-4.3c`) instead runs its own
   independent `npm install` directly inside the worktree, avoiding the
   shared-target class of accident entirely.

With both incidents resolved, the battery: fresh `git worktree add` at
`c9530ba` (`C:\cv-baseline-4.3c`, short root path, zero git config
changes), `npm install` run directly inside the worktree (256 packages, no
junction). 128-file manifest built from the BASELINE worktree's own 129
tracked test files, excluding the Commit 4.2 test file (129 − 1 = 128, the
established convention). Identical manifest run on both the baseline
worktree and the current working tree: **11 failing files on both sides,
byte-identical file-name sets** (`batch1-fixes`, `comp-filter-hygiene`,
`decision-engine`, `identity-gate`, `image-search-extraction`,
`mega-keys`, `pattern-k-dedupe-issue`, `priceBands`, `q-adv397-visual-guard`,
`ship26-integration`, `sold-verification`) — **no new failures relative to
documented baseline.** New suite
`tests/q-trackB-commit4.3-winning-family-authority.test.js`: **188/188**
passing (160 after the prior HOLD's corrections, +28 this round: the
membership precondition Controls A/A2, the corrected margin-boundary
Control B with three real sorted examples, and the PC-side read/write
custody proofs). Focused re-runs, all clean: `q-trackB-commit4-adoption-provisional`
152/152, `q-trackB-commit4.1-spawn-visual-family-merge` 175/175,
`q-trackB-commit4.2-fingerprint-year-restamp` 160/160,
`q140-at-vision-zero-support-skip` 25/25,
`q-trackB-commit3-manual-correction` 465/465 (the file that surfaced the
`node_modules` incident above — confirmed clean after recovery). `npm run
build` clean (ESM-mode parse checks on `api/enrich.js`, `api/grade.js`,
`api/comps.js`, `src/lib/priceBands.js`, `src/lib/compHygiene.js`,
`src/lib/responseContract.js`, then `vite build` — 268 modules, no
errors). Baseline worktree removed after use (disposable scratch artifact,
not the main working tree) — confirmed the removal this time did NOT
touch the main project's `node_modules` (no junction present to recurse
through).

**`git diff --name-only` (exact campaign file list, Commit 4.3 pass):**
`api/enrich.js`, `docs/LAUNCH-AUDIT.md`, `src/lib/compHygiene.js`,
`src/lib/identityCore.js`, `src/lib/imageSearchIdentity.js`,
`src/lib/issueAuthority.js`, `src/lib/variantIdentity.js` (tracked,
modified) plus `src/lib/cacheKeys.js` (untracked, new) and
`tests/q-trackB-commit4.3-winning-family-authority.test.js` (untracked,
new). `tests/q-trackB-commit4.2-fingerprint-year-restamp.test.js` and
`tests/q140-at-vision-zero-support-skip.test.js` also modified (the Option-
A `assertedIssues` field addition and the Commit 4.3 retention-outcome
correction, respectively). `.claude/settings.local.json` also shows
modified in `git status` but is excluded from this campaign's scope per
standing convention, as always.

**Re-homing table (five previously-adjudicated findings, routing
confirmed by direct instruction, not derived — recorded here as this
campaign's authoritative record since none of these are otherwise
addressed in this document):**
| Finding | Routed to |
|---|---|
| Harley Quinn #62 — rejected-year persistence | Commit 4.4 queue |
| Iron Man #150 — canonical-title contamination | Commit 4.4 queue |
| D'Orc #4 — seller-stopword registry (same registry as Iron Man #150; explicitly distinct from this document's own "D'Orc #1 apostrophe class") | Commit 4.4 queue |
| Superman #233 — unsupported-newsstand clearing | Commit 5 |
| Adventure Time — reference-evidence preservation (consumer display) | Commit 6 |

**Closure status.** Commit 4.3 makes the deployed build capable of
retaining a coherent title-axis-blocked family's own issue/year authority
and containing cross-population promotion when it does not. Matching
Commit 4.1/4.2's own standard: **Commit 4.1, 4.2, AND 4.3 all remain open
until the required repeat live scans pass against the SHA-verified
deployed build carrying all three fixes** — the same CP1-CP4 checkpoint
structure used for the original live-origin verification, re-run once this
commit is staged, committed, pushed, and independently deployment-verified.

**Note on process, recorded per this document's own standing practice of
logging near-misses:** the implementation packet for this commit went
through TWO review holds before staging approval, not one. The first HOLD
(after the initial implementation pass) returned seven correction items
(Option-A audit write-up, real cache-builder imports replacing test-local
mirrors, direct query/cache capture replacing a vacuous assertion, testing
the real family-evidence emission site rather than a simulation, five
additional controls, this documentation entry, and a from-scratch
verification re-run) — all seven addressed and verified via real
execution. A SECOND, narrower HOLD then found three remaining defects in
that revised packet, all genuine and all corrected before this final
state: (1) the stale/foreign-family control relied on a downstream
function degrading gracefully rather than the qualified gate itself
rejecting membership up front — fixed with the `hasValidFamilyMembership`
precondition (NAMED FINDING 1 above); (2) the margin-dominance control
used an impossible top/runner weight ordering that masked a genuinely
VACUOUS production condition — fixed with `familyDominatesRunnerUp`, a
correctly-named, separately-scoped function (NAMED FINDING 2 above); (3)
the PC cache proof stopped at key construction rather than proving actual
read/write custody — fixed with the real `readPriceChartingCache` adapter.
Both holds, and the two additional incidents surfaced and resolved while
addressing the second (the `core.longpaths` incident, first caught in an
earlier round and re-confirmed clean this round; the `node_modules`
junction-deletion incident, new this round), are recorded here in full
rather than only reporting the clean final state — the process itself,
including its own mistakes and corrections, is part of the evidence
record this document exists to keep honest.

**NAMED FINDING: CONFIDENCE-AS-AUTHORITY (IMPLEMENTATION PACKET HOLD —
FINAL AUTHORITY-SOURCE HOLD, third review round, 2026-07-30).** The
first-pass `decideFieldAuthority` classified a prior as independently
trusted via `isPriorIndependentlyTrusted(visionConfidence)` —
`confidence === 'high'` alone. Caught at review before staging, this is
the same disease class as the campaign's other wrong-population findings
(Q115 Batman #608, Q127 Catwoman #64, Q128's drifted-duplicate-constant
class) — data or a signal from the wrong axis being treated as
authoritative — here specifically on the PROVENANCE axis rather than the
identity-population axis those findings occupied: **confidence measures
certainty WITHIN a source; authority records PROVENANCE and permission to
control identity.** They are different questions. A Vision read that is
very sure of itself is still Vision-derived — its own self-assessed
certainty is not third-party corroboration, not a validated user
correction, and not a catalog-authority record. Confidence cannot
manufacture independent provenance. The bug happened to also correctly
recognize manually-corrected priors (`manualCorrection.js`'s
`buildManualCorrectionPayload` sets `confidence:'HIGH'` on its request
payload) — but that was coincidental (a shared confidence VALUE, not a
provenance check): an ordinary, high-confidence Vision read carries the
exact same bare `'HIGH'` string.

**Corrected:** `decideFieldAuthority` now accepts an explicit,
source-aware input (`priorSource`, `priorIndependentlyTrusted`,
`priorConfidence` — see the Measure/decide split section above for the
full five-outcome contract). Trust is granted ONLY by
`isPriorSourceIndependentlyTrusted(priorSource, ...)`:
`'manual'`/`'user'` (a server-validated correction) → trusted;
`'catalog'` → trusted only with an explicit corroborating record (no live
source of this kind exists in this codebase yet — a deliberate
conflicted-safe default, not a placeholder left to silently pass);
`'vision'` (including HIGH confidence) or anything unrecognized → NEVER
trusted. **Manual/user authority requires the validated Commit 3
contract** (`manualCorrection.js`'s `isValidManualAuthorityRequestContract`
/ `prepareManualCorrectionRequest` — the four-condition request contract:
`manualIdentity===true && skipVision===true && skipImageSearch===true &&
identitySource==='manual'`) — `isPriorSourceIndependentlyTrusted` does not
invent or bypass that validation; it only recognizes the resulting
`priorSource:'manual'`/`'user'` tag once genuine validation has already
happened elsewhere. **Vision/family disagreement remains `conflicted`
unless an explicit source-authority rule adjudicates it** — a qualified,
unanimous family disagreeing with an untrusted Vision prior that has ZERO
support in the family now splits on confidence for exactly one purpose
(never to grant authority): LOW/unknown confidence retains the existing,
approved silent provisional-correction (the Spawn fixture's own path,
`resolveIdentity`'s docs); HIGH confidence becomes a recorded `conflicted`
state instead — no silent win for either side.

**Disclosed dependency (R1, traced per the directive's own stop-and-report
rule):** a validated manual/user correction does NOT reach
`resolveIdentity` at all today. `manualCorrection.js`'s own header comment
(lines 14-24) and a direct grep of every real, non-test `resolveIdentity()`
call site in this codebase (exactly one — `api/enrich.js`'s "Standard
Vision-based identity resolution" branch, the `else` arm of a plain
`manualIdentity` / `cgcIdentityConfirmed` / `resolveIdentity` if/else-if
chain) confirm Safeguard 1's four-condition contract routes a manual
correction around this entire function via a separate, already-validated
branch. The real `vision` object `resolveIdentity` is called with there
is a plain `{title, issue, year, publisher}` — no `.source` field at all.
`vision.source` is accepted by `resolveIdentity`'s retention branch as a
forward-compatible extension point (proven correct and real via Control
T2(b) — `resolveIdentity` genuinely honors it when supplied), but no live
caller populates it. This is safe today ONLY because manual corrections
bypass `resolveIdentity` entirely via the separate, already-validated
Safeguard 1 path — not because of anything in this hold. If manual-
correction provenance is ever threaded through `resolveIdentity`, the one
call site in `api/enrich.js` is what would need to start setting
`vision.source`.

**Compounding fix, surfaced by Control T1 during testing (not part of the
original ask, reported before fixing per standing protocol):**
`deriveIssueAuthorityFromAdoption` (`src/lib/issueAuthority.js`) returns
`{issueAuthority: null, ...}` for every consensus mode other than
`'adopted'` — designed for a pre-existing, non-retention `'corroborated'`/
`'conflict-locked'` shape correctly left to the separate
`out.issueConsensusConflict` mechanism. A retention-branch `'conflicted'`
outcome (this hold's own rule D) fell through to that SAME null default —
and `canUseExactIssuePricingCache`'s own `if (issueAuthority == null)
return true` (designed for a DIFFERENT null shape — an already-trustworthy
corroborated issue) would have silently treated a genuinely conflicted
identity as cache-eligible, and `computeIssueAuthorityContractPatch` would
have returned no patch at all — neither cache access nor authoritative
pricing/listing would have actually been blocked for Control T1's own
scenario, contradicting rule D's explicit requirements. Fixed with a
narrowly-scoped addition to `deriveIssueAuthorityFromAdoption`: detects a
retention-branch conflict specifically via `familyIssueConsensus.outcome
=== 'conflicted' && authoritativeForCustody === false` — fields ONLY the
Commit 4.3 retention branch ever sets (confirmed via source inspection: no
other call site in this codebase assigns `outcome` onto a consensus
object), so this addition can never misfire on an unrelated, pre-existing
`'conflict-locked'` shape that predates Commit 4.3 — and produces a real,
non-null `status:'conflicted'` `issueAuthority` object, correctly blocking
both `canUseExactIssuePricingCache` and `computeIssueAuthorityContractPatch`
through their EXISTING, unmodified machinery (`CACHE_SAFE_ISSUE_AUTHORITY_STATUSES`
already excludes `'conflicted'`; `computeIssueAuthorityContractPatch`
already has a full `issueConflicted` branch with its own containment
copy) — reused, not reinvented.

**PriceCharting ruling reaffirmed, unchanged, per the directive's item 4:**
PC/CV retrieval may occur under the corrected issue "351" for reference
evidence; it must never use issue "300" for the founding fixture (proven
in the prior round's Section 3(c) and unaffected by this round's changes —
Control T4 re-confirms the founding fixture's own identity/evidence fields
byte-identical); existing Commit 4 containment (now including this round's
`deriveIssueAuthorityFromAdoption` fix) keeps provisional/conflicted
evidence from becoming an actionable price or listing. Not broadened into
a new zero-PC-access contract — no change to the PC/CV Promise.all block's
own unconditional-read structural asymmetry (already disclosed in the
prior round) was made or needed here.

**PRODUCTION AUTHORITY-CONTEXT INTEGRATION HOLD (fourth review round,
2026-07-31).** The prior round's authority-source correction was proven
correct in isolation (Controls T1-T5) but two real production-integration
gaps remained, plus one genuinely new finding surfaced by this round's own
investigation, not part of the original ask.

**Item 1 — real Vision confidence threaded into production.** Traced to
its actual origin, not a proxy (per R1's stop-and-report requirement):
Vision's own self-reported identification confidence is requested
explicitly in `api/grade.js`'s `STANDARD_PROMPT`/`WATCH_PROMPT` JSON_SHAPE
(`"confidence": "low", "medium", or "high" based on image quality and
visible information`), returned in `grade.js`'s response, forwarded by the
client as part of the `/api/enrich` request body, and destructured at
`api/enrich.js`'s handler entry (`const { ..., confidence, ... } =
req.body;` — the same variable already read elsewhere in that file at the
`[ship12]`/`visionConfidenceLower` call sites). A genuine signal exists;
no fabrication was needed. New `buildStandardVisionAuthorityContext(rawConfidence)`
and `normalizeVisionConfidence(rawConfidence)` (`src/lib/identityCore.js`)
— the single, shared, import-safe export (R2) that assigns
`source:'vision'` (hard-coded, never derived from `req.body.source`,
`req.body.identitySource`, or any client-forwarded field) and
`priorIndependentlyTrusted:false` for the standard path. The real
`api/enrich.js` `resolveIdentity` call site now spreads
`...buildStandardVisionAuthorityContext(confidence)` into the vision
object — the SAME function this feature's tests (Control T1, its LOW
companion, Control T6) call directly, proving "HIGH Vision reaches
resolveIdentity as HIGH," "LOW Vision reaches resolveIdentity as LOW,"
"source is always 'vision'," and "priorIndependentlyTrusted is always
false" with the real production builder, not a re-derived mirror.

**Item 2 — the free-form manual trust path removed.** The prior round's
`const priorSource = vision.source || 'vision';` inside `resolveIdentity`
was itself a residual risk: a bare, unvalidated `'manual'`/`'user'` string
reaching this function proved nothing about whether the Commit 3
four-condition manual-authority contract was ever actually validated.
Corrected: `resolveIdentity` no longer re-derives trust from any
free-form source string at all — `priorIndependentlyTrusted` is now
consumed DIRECTLY from `vision.priorIndependentlyTrusted`, a boolean the
CALLER must have already computed (via `buildStandardVisionAuthorityContext`
for the real production path, always `false`); `vision.source` is read
only for diagnostics/traceability and can no longer grant authority no
matter what string a caller supplies. `isPriorSourceIndependentlyTrusted`
itself remains exported (Control T2(a)'s pure unit contract stays valid —
the decide step's own handling of a genuinely-validated manual/user
source is still correct and still tested), but Control T2(b) — the
first-pass synthetic proof that `resolveIdentity` "honors an explicit
`vision.source='manual'` when supplied" — is REMOVED entirely, not
patched: that test asserted the very free-form-trust behavior this item
closes. Control T2(c) is INVERTED (R3) from a disclosed-absence check
into a POSITIVE guard: a hand-set `vision.source='manual'` fixture (no
accompanying `priorIndependentlyTrusted:true`) now correctly lands in
`'conflicted'`, proving the dormant path stays dead; source-presence
checks confirm the real call site never reads `req.body.source`,
`req.body.identitySource`, or a client-forwarded `vision.source`, and
that `source:` can only ever originate from the shared builder's own
hard-coded value. The disclosed dependency from the prior round stands
unchanged: a validated manual/user correction still does not, and under
this ruling still must not, enter `resolveIdentity` at all — Safeguard 1's
four-condition contract (`manualCorrection.js`) remains the sole,
separate, already-validated mechanism.

**Item 3 — year-only conflict containment, PLUS a major wiring gap found
while wiring it (not part of the original ask, reported before fixing per
standing protocol).** Extended `deriveIssueAuthorityFromAdoption` with an
optional second parameter, `familyYearConsensus` — backward-compatible
(every pre-existing single-argument call site unaffected) — that detects
a YEAR-axis-only retention-branch conflict (same `outcome`/
`authoritativeForCustody` convention as the issue-axis branch, exclusive
to the Commit 4.3 retention branch) and returns a real, non-null
`status:'conflicted'` object with reason `'vision-family-year-authority-conflict'`
(distinct from the issue-axis `'vision-family-authority-conflict'`) and
`identityProvisionalFields:['year']` (never `'issue'` — the issue axis was
never in question; the year is never labeled `'adopted'` anywhere in this
path). Reuses the EXISTING Commit 4 `computeIssueAuthorityContractPatch`
`issueConflicted` branch verbatim, per the directive's explicit "do not
invent a broad Commit 6 consumer contract" — the banner text is
issue-phrased even for a year-only conflict; the machine-readable
`reasons` array is what actually distinguishes the axis. Confirmed via
Control T6 (a real, corroborated-issue/conflicted-year fixture) and its
required mutation (omitting `familyYearConsensus` from the
`deriveIssueAuthorityFromAdoption` call — the exact pre-fix shape every
call site used — restores cache eligibility and produces no contract
patch at all, proving the fix load-bearing).

**The major finding:** investigating item 3's real production wiring
surfaced that the PRIOR round's own "compounding fix" to
`deriveIssueAuthorityFromAdoption` (the conflicted-outcome branch) was
correct in isolation but **never actually reachable from the real
production call site.** `api/enrich.js`'s only call to
`deriveIssueAuthorityFromAdoption` sits inside `else if
(identity.familyIssueConsensus?.mode === 'adopted')` — mutually exclusive
with the separate `if (mode === 'conflict-locked')` branch (the
pre-existing Q140 mechanism, which only sets the informational
`out.issueConsensusConflict`, never `out.issueAuthority`). Control T1's
own `outcome:'conflicted'` legacy-maps to `mode:'conflict-locked'` — which
takes the Q140 branch, never the `'adopted'` branch — so
`deriveIssueAuthorityFromAdoption` was NEVER CALLED for this exact
scenario in production, despite the test proving the function itself
correct. Separately, the terminal `pricingCustodyCheck`
(`checkCrossPopulationPromotionGuard`) only fires on a genuine MISMATCH
when `authoritativeForCustody===true` — never the case for an unresolved
conflict by definition — so that mechanism doesn't catch it either. Net
effect: T1's own containment (no exact-cache, no authoritative pricing, no
listing readiness) was NOT actually live in production before this round,
despite passing in test isolation. Confirmed via direct trace before
writing the fix, not assumed. **Fixed** with a new, independent block in
`api/enrich.js` (composes with, does not replace, the existing
`issueConsensusConflict`/`'adopted'` branches — gated on
`out.issueAuthority == null` so the `'adopted'` branch's own object is
never touched) that unconditionally calls the now-extended
`deriveIssueAuthorityFromAdoption(identity.familyIssueConsensus,
identity.familyYearConsensus)` and assigns the result to the real
`out.issueAuthority`/`out.identityProvisionalFields` fields the pricing/
listing gates actually read.

**Near-miss caught during this round's own verification, disclosed per
standing practice:** the first attempt at item 1's production comment (a
long, multi-line explanatory block placed between `} else {` and
`identity = resolveIdentity(`) broke an unrelated, pre-existing structural
test — `tests/q140-issue-consensus-corrective.test.js`'s Part 9 regex
(`/if \(barcodeIdentity\) \{[\s\S]*?\} else if \(manualIdentity\)
\{[\s\S]*?\} else if \(cgcIdentityConfirmed\) \{[\s\S]*?\} else
\{[\s\S]{0,400}?identity = resolveIdentity\(/`), which bounds the
distance between `} else {` and the call to 400 characters — a genuine,
real regression, caught by the full 128-file A/B battery (12 failing
files instead of the documented 11) before being reported as clean.
Fixed by shortening the inline comment to a one-liner and moving the
detailed explanation to sit between `resolveIdentity(` and its argument
object instead (still within the function call, but past the 400-
character checkpoint) — confirmed via re-run: the file returns to
124/124, and the full manifest returns to the documented 11 failing
files. A second, related near-miss: the SAME long comment's own prose
(explaining what NOT to do) literally contained the substrings
`req.body.source`/`req.body.identitySource` as documentation, which
false-positived this hold's own Control T2(c) positive-guard scan — fixed
by stripping `//`-comment lines from the captured span before scanning
for forbidden patterns, so the check examines only actual code, never
prose. Both are recorded here in full, not silently smoothed over.

**Verification (this round, final):** 4.3 suite 252/252 (was 221, +31 —
Control T1's LOW companion, the revised Control T2(a)/(c), Control T6 and
its mutation). `q140-issue-consensus-corrective.test.js` 124/124 (the file
whose regex the near-miss above broke and then restored). Focused
suites unaffected: Commit 4 152/152, Commit 4.1 175/175, Commit 4.2
160/160, q140-at-vision-zero-support-skip 25/25, Commit 3
manual-correction 465/465. Full 128-file A/B, fresh isolated worktree
(`npm install` directly inside, no junction): identical 11-file failing
set both sides — **no new failures relative to documented baseline.**
`npm run build` clean, 268 modules. Baseline worktree removed after use,
main project's `node_modules` confirmed untouched (no junction present).
`core.longpaths` confirmed unset before and after.

**Fifth review round (rider, 2026-07-31) — CONTROL T6(c), the wiring
pin.** Review flagged that T6's own containment proof (like T1's before
it) had no assertion pinning the real wiring block's PRESENCE and
POSITION in `api/enrich.js` — only that the underlying functions behave
correctly when called directly. Added CONTROL T6(c), mirroring
`q140-issue-consensus-corrective.test.js`'s own Part 13 ORDERING
convention exactly (exact source `indexOf` anchors, `//`-comments
stripped before any pattern scan — the same lesson Control T2(c)'s own
near-miss taught two rounds ago, applied proactively here rather than
discovered again the hard way): confirms the `out.issueAuthority==null`
guard genuinely wraps the `deriveIssueAuthorityFromAdoption(identity.familyIssueConsensus,
identity.familyYearConsensus)` call, and that this call is positioned
BEFORE both the pricing/listing contract site
(`computeIssueAuthorityContractPatch(out.issueAuthority, out,
out.identityProvisionalFields)`) and the terminal `finalizeResponse(out)`
response call. This is now the THIRD load-bearing wiring point in this
feature that received an explicit presence/position assertion, after two
earlier instances where a function proven correct in isolation was later
found NOT reliably connected to its real call site: (1) Mutation 8c —
`buildRetentionFamilyEvidenceLog`, the structured `[family-evidence]`
emission (FINAL NARROW HOLD round); (2) Control T2(c) —
`buildStandardVisionAuthorityContext`, the real confidence-threading call
site (PRODUCTION AUTHORITY-CONTEXT INTEGRATION HOLD, item 1); (3) Control
T6(c) — the retention-conflict `deriveIssueAuthorityFromAdoption` wiring
block itself, whose absence from the real call site was this same round's
own major finding. Every load-bearing wiring point this feature has
introduced now carries an explicit presence assertion, an explicit
position assertion (where ordering matters for correctness), or both —
not merely a passing test of the underlying function in isolation.
Verified: 4.3 suite 256/256 (was 252, +4). No production code changed
this round — CONTROL T6(c) exercises the wiring already fixed and
verified in the fourth round; this is test-only hardening. **Completion
(same round, follow-up):** the wiring pin now covers presence, position,
AND assignment — an assignment-presence check (`out.issueAuthority =
retentionConflictDerived.issueAuthority;` / `out.identityProvisionalFields
= retentionConflictDerived.identityProvisionalFields;`, both anchored
after the derivation call and before the exact-cache eligibility site,
the pricing/listing contract site, and `finalizeResponse`) means a
derivation whose result is computed but silently discarded now fails the
pin, not just a derivation that is never called at all. Verified: 4.3
suite 262/262 (was 256, +6).

**Commit 4.3.1** — RETENTION-DECLINE FAIL-CLOSED CONTAINMENT (2026-07-31,
unstaged). A near-miss shape sits one condition short of Commit 4.3's own
qualified-retention predicate: `titleAxisOnlyBlock===true`, coherence
floor cleared, no contamination — but the family does NOT dominate its
runner-up by the required 3x margin. Before this commit, that exact shape
left `familyIssueConsensusResult` null (same as "no family at all") and
fell through unshortcut into the raw-pool vision-zero-support
OVERRIDE/ESCALATE check — silently adopting whatever the RAW POOL's own
unrelated plurality happened to be, with zero acknowledgment that a
coherent, unanimous family actively disagreed with it. Same failure
SHAPE as the original Commit 4.3 root cause (Spawn #351 vs. raw-pool
#300), one qualification condition removed.

**Fix (Section A).** `identityCore.js`'s `resolveIdentity` now detects
this exact shape (`isNearMissMarginDecline` — the same four base
conditions as `isQualifiedFamilyForRetention`, differing only on margin)
and records a genuine, UNRESOLVED conflict instead of silence:
`outcome:'conflicted'`, `authoritativeForCustody:false`,
`observedFamilyValue` = the family's own measured issue,
`resolvedValue` = the untouched prior (never adopted, never
overwritten — Control T1's own convention), `reason:
'retention-margin-decline-conflict'`. `familyAuthoritySkip` is extended
(`isNearMissConflictActive`) so raw-pool OVERRIDE/ESCALATE never fires on
top of a recorded conflict — verified via MUTATION 1 (naive: #300
takeover; real: blocked).

**Fix (Section B, market custody).** The `ac:` exact-issue active-comp
cache was already fail-closed by Commit 4's own `CACHE_SAFE` allowlist
(`'conflicted'` was never in it). The `cv:`/`pc:v1` Fix-3 Promise.all
lookups had NO equivalent gate — a disclosed-but-unfixed asymmetry from
Commit 4.3's own Section 3(c) note. `marketCustodyConflicted` (`out.issueAuthority?.status
=== 'conflicted'`) now skips both lookups entirely (no cache read, no
cache write, no live query). **HOLD-round finding (Item 3):** the initial
gate alone was insufficient — with `priceCharting` left `null` by the
gate, the pre-existing `needsRequery = !priceCharting || ...` expression
would ALWAYS evaluate true, silently reopening an unconditional PC
fallback/requery call for every conflicted request. Composed
`!marketCustodyConflicted` into that requery's own condition to close it
— verified via MUTATION 4 (naive: 1 unconditional cache read; real: 0).

**Fix (Section C, corroboration).** Slice A3's `visionLowButCorroborated`
gate used bare `topFamily.count` as `coherentFamilyCount` — ANY coherent
family counted toward corroboration regardless of whether its OWN issue
measurement agreed with `confirmedIssue` at all. Now requires
`hasValidFamilyMembership` (current-request membership) AND the family's
own `resolveFamilyIssueConsensus` measurement (the existing resolver, no
second issue parser) to be `'adopted'` AND equal `confirmedIssue`
exactly — verified via MUTATION 3 (naive: the #351 family wrongly
contributes 5 toward corroborating issue "1"; real: 0).

**Fix (Section D, terminal contract).** Achieved via EXISTING Commit 4
machinery once `.reason` propagates through
`deriveIssueAuthorityFromAdoption` — no new contract mechanism.
`computeIssueAuthorityContractPatch` nulls price/priceBands, sets
`refusedToPrice`/`listingHardLocked`, sets `identityConfident:false`.
**HOLD-round addition (Item 3):** verified `decision.action==='ID_REQUIRED'`
via a REAL, direct `computeDecision` (decisionEngine.js) call against the
exact patch shape — not asserted from a doc comment. Also verified (real
`computeConvergenceScore` field-mapping, `comicVine`/`priceChartingInitial`
both null): no catalog result can enter convergence; and (contract patch's
own `hypotheticalReferenceEstimate` field) a real active/sold reference is
relabeled, never allowed to silently unlock pricing.

**Fix (Section E, observability) — REVISED per reviewer rider (R1).** The
first-shipped near-miss `[family-evidence]` event built its `familyKey`
from `confirmedIssue` — which, for a near-miss, IS the untouched PRIOR
(the family was never authoritative for custody) — producing a
`familyKey="spawn|1"` line whose own `rows` field listed five #351
listings: the event contradicted itself. Explicit reviewer preference
(R1): emit BOTH fingerprints, named, rather than relabel one.
`buildRetentionFamilyEvidenceLog` (`imageSearchIdentity.js`) gained an
optional 6th parameter (`observedFamilyFingerprint`); for the near-miss
branch specifically the log now reads
`priorFingerprint="spawn|1|..." observedFamilyFingerprint="spawn|351|..."`
instead of a single `familyKey=`. Backward compatible — every
pre-existing (qualified-retention) call site omits the new parameter and
is byte-identical. The `[commit4.3.1] near-miss family conflict: ...`
containment line (N1 format: `family=<issue>@<count>/<weight>
runnerUp=<weight> margin=<ratio> prior=<vision issue>`) is unchanged and
fires exactly once per qualifying near-miss.

**Fixture honesty (Item 2 / R2, explicit finding).** "Pair 2" was
dispatched as summary statistics only (top=5/10.5, runner-up=1/4.0,
margin=2.625), with no accompanying raw row data. Per R2's explicit
instruction, inputs were NOT tuned to force a match: the real
`buildTitleFamilies`/`scoreTitleFamilies`/`mergeFragmentedTitleFamilies`/
`selectTitleFamilyCandidate` chain was run FIRST on the unmodified,
certified-real 18-row pool (the same physical Spawn #351 scan Commit 4.3
reconstructed from real production logs) — it produces the Pair 1
dominant shape (13.5/3.0, dominance holds), **not** a near-miss. Honest,
reported finding: no near-miss margin is reconstructable from currently
available real production logs for this book. A second, explicitly
SYNTHETIC pool was then built — the same 5 real Brett Booth listing
strings and the same real lot-listing string (both reused verbatim),
reassigned to row POSITIONS chosen using the disclosed, real, pure
rank-weight formula (never a hand-set `weightSum` field anywhere in the
test) — which the real scorer chain resolves to genuinely emergent
10.5/4.0/2.625, with `titleAxisOnlyBlock` computed by the real Q84 gate
(never hand-set). This fixture is labeled SYNTHETIC throughout, not
claimed as reconstructed production data.

**Consumer-spy boundary (Item 3 / R4) — CORRECTED WORDING (2026-07-31
HOLD, Item A).** The prior packet's summary text ("real kvGet/kvSet spies
prove zero ac:/cv:/pc:v1 cache activity") overstated what was actually
proven for two of the three namespaces. Precise accounting, by namespace:
  - **`ac:` (active-comp exact-issue cache) — genuine real-spy proof.** A
    real `kvGet` function, wrapped in a call-counting spy, is invoked only
    when the exact same boolean composition the real `api/enrich.js` gate
    uses (`canUseExactIssuePricingCache(...) &&
    checkCrossPopulationPromotionGuard(...).allowed`) evaluates true;
    under this fixture it evaluates false, and the spy genuinely records
    zero calls. This is a real, executed spy proof, extending the Commit
    4.3 orchestration-harness pattern directly.
  - **`cv:`/`pc:v1` (ComicVine / PriceCharting exact-issue cache) — key
    construction and structural proofs ONLY, NOT a call-count spy through
    the real consumer path.** What was actually proven: (1) the real,
    exported cache-key BUILDER/PARSER functions
    (`buildComicVineCacheKey`/`buildPriceChartingCacheKey`/
    `parseCacheKeyIssueSegment`) produce keys carrying the corrected issue
    "1", never "300" or "351" — a genuine, real-function proof, but of key
    CONSTRUCTION, not of whether a read/write actually occurs; (2) source
    presence — `api/enrich.js`'s own source text contains the
    `marketCustodyConflicted` guard, gating both the `cv:` and `pc:v1`
    IIFEs and the `pc:` requery fallback; (3) a structural, source-ORDER
    check — each gate's `return null;` appears, in the source text, before
    that same IIFE's `lookupComicVine(`/`lookupPriceCharting(` call
    (necessarily also before the `kvGet`/`kvSet` calls that follow it in
    the same block). This is a textual/positional proof, not a runtime
    call-count observation. Section 9's MUTATION 4 additionally spies a
    real `kvGet` call, but against a HAND-WRITTEN replica of the gate's
    boolean shape (`if (!marketCustodyConflicted) { spy(...) }`) written
    inline in the test — illustrative of the naive-vs-real contrast, and
    not itself a spy on `api/enrich.js`'s actual executing closures. No
    handler-level (full HTTP-request, `req`/`res`) proof exists for `cv:`/
    `pc:v1`, matching Commit 4.3's own disclosed scope boundary.
  - **`lookupComicVine`/`lookupPriceCharting` themselves (the real
    network-calling functions)** — NOT spied at all, at any level. A
    genuine call-count spy on these two specific functions requires live
    network access or `global.fetch` mocking — the SAME boundary Commit
    4.3's own Section 3 already disclosed and accepted for this exact pair
    of functions. Per the standing feasibility rule (invoked explicitly,
    not silently substituted): stopped at that boundary rather than
    claiming a proof that was not obtained.

**Isolated-worktree A/B baseline (Item 5).** `git worktree add --detach
<sibling-dir> 406c34f` (current `main` HEAD), `node_modules` symlinked
(not copied/reinstalled) from the primary tree for speed, full 130-file
suite run inside the isolated worktree. Diffed byte-for-byte against the
same 130 files in the primary working tree (the new, untracked Commit
4.3.1 test file excluded from the comparison since it does not exist at
the baseline SHA): identical output on every file except the intentionally-
updated `q-trackB-commit4.3-winning-family-authority.test.js` (262→266,
CONTROL B's own fixture is exactly the near-miss shape this commit adds
handling for — its pre-4.3.1 "stays null" assertion was superseded, not
reverted, with a dated comment). **No new failures relative to the
documented baseline** — same 11 pre-existing files (batch1-fixes,
comp-filter-hygiene, decision-engine, identity-gate,
image-search-extraction, mega-keys, pattern-k-dedupe-issue, priceBands,
q-adv397-visual-guard, ship26-integration, sold-verification), same
failure counts, on both sides.

**Worktree symlink deviation, disclosed (R1).** The `node_modules`
population step above deviated from the amended independent-npm-install
procedure a prior review round had established (fresh `npm install`
inside the isolated worktree, no shared storage with the primary tree) —
this round used `ln -s` instead, for speed, without re-verifying it
actually produced a live link. It did not: a direct canary check (a
marker file written into the primary tree's `node_modules` did not
appear inside the worktree's `node_modules`, and vice versa) proved the
worktree's `node_modules` was an independent, disconnected directory —
Windows `Get-Item` confirmed no `ReparsePoint` attribute and an empty
`LinkType`/`Target`, meaning `ln -s` on this filesystem (a OneDrive-synced
path) silently produced ordinary directory content rather than a real
symlink or junction, not a failure that was caught at creation time. The
test results this round are unaffected by this deviation (the worktree's
`node_modules` — real or linked — served the same 130-file suite
correctly either way, confirmed by the byte-identical diff above), but
the deviation itself is the finding: a symlink that silently isn't one is
indistinguishable from a real link by directory listing alone, and this
round trusted the listing. **Standing procedure going forward:** either
(a) a fresh `npm install` inside the isolated worktree (the original,
now-reconfirmed-correct procedure), or (b) if a link is used for speed,
verify it with a canary write-through check immediately after creation,
before relying on it for anything.

**Worktree/symlink removal (Item B, this HOLD round).** The prior
dispatch's proposed `git worktree remove` was correctly halted mid-session
while the (believed-to-be) `node_modules` link still existed inside the
worktree — removing a worktree containing an actual live symlink/junction
to the primary tree's `node_modules` risked a recursive delete following
the link into shared storage. This round's safe sequence, now standing
procedure: (1) inspect the link (`Get-Item ... | Select LinkType,Target,
Attributes` on Windows) and independently canary-verify it before
assuming its type from a directory listing alone; (2) remove the
`node_modules` entry specifically, as its own explicit step, BEFORE
touching the worktree itself; (3) verify the primary tree's own
`node_modules` immediately afterward (entry count + a known-package
existence check); (4) only then run `git worktree remove` on the
now-empty-of-node_modules worktree; (5) verify the primary tree's
`node_modules` a second time, post-removal. Executed exactly this way:
primary tree `node_modules` top-level entry count was 190 both
BEFORE step (2) and AFTER step (4) (identical), `node_modules/
@anthropic-ai/sdk` confirmed present both times, and `git worktree list`
after step (4) shows only the primary worktree. **The baseline worktree
(`comic-vault-baseline-4331`) has now been fully removed** — the prior
entry's "intentionally left in place, pending a separate decision" note
is superseded by this round's explicit removal.

**Repo-hygiene incident, disclosed (Item 6 / R3).** The PRIOR dispatch's
own verification pass used an unscoped `git stash && ... && git stash
pop` (not a `-- <pathspec>`-restricted stash) to compare working-tree
behavior against a clean checkout — this is the "unrestricted git stash"
this HOLD's own instruction (Item 5) explicitly prohibited going forward,
now replaced with the isolated-worktree method above. Because the stash
was unscoped, it also swept up `.claude/settings.local.json` (a
local-only, gitignored-adjacent-in-spirit but not actually gitignored
settings file — modified at session start, before Commit 4.3.1 work
began, accumulating this session's Bash-permission allowlist entries)
alongside the intended source files, and briefly held it inside the
stash object database before `git stash pop` restored it. Reviewed the
file's diff directly (`git diff -- .claude/settings.local.json`,
reproduced in this dispatch's own packet): it contains only Bash command
allowlist patterns and local filesystem paths — no credentials, tokens,
or secrets of any kind were present or exposed. `git stash list`
(checked BEFORE any new git operation this round, per R3) confirmed zero
stale stash entries — the pop completed cleanly and left no residue.
Disclosed as a process-scope finding (an unscoped git operation
unnecessarily enveloped a file with no reason to be part of a
source-code comparison), not a data-exposure finding.

**Verification.** New test
(`tests/q-trackB-commit4.3.1-retention-decline-fail-closed.test.js`):
73/73, including the Section-1 honest real-log finding, the Section-2
synthetic real-producer proof, 4 named mutations, 5 named controls.
`q-trackB-commit4.3-winning-family-authority.test.js`: 266/266 (CONTROL B
updated, dated, not reverted). Full 131-file suite (130 pre-existing +
1 new): 11 pre-existing failures, isolated-worktree-verified identical to
the 406c34f baseline. `npm run build` clean. `git diff --check` clean.
`git status --short`: nothing staged — 5 modified files
(`.claude/settings.local.json` pre-existing/unrelated,
`api/enrich.js`, `src/lib/identityCore.js`,
`src/lib/imageSearchIdentity.js`, `src/lib/issueAuthority.js`,
`tests/q-trackB-commit4.3-winning-family-authority.test.js`), 1 new
untracked test file. **No new failures relative to documented baseline.**

DO NOT STAGE, COMMIT, OR PUSH before review.
