# Pattern Library

Full finding history for Comic Vault's identity/pricing pipeline, moved out of CLAUDE.md 2026-08-07 (GrailKey Dispatch 16) to keep CLAUDE.md under the 150k-char load limit. CLAUDE.md carries a one-line index; this file carries the complete writeups verbatim, in the same approximate order of discovery.

**Descriptive names, not letters. Listed in approximate order of discovery.**

- **Sinful Suzie class** — wrong-title comp contamination (different series under same nominal title).
- **Thor #4 class** — printing version mismatch (1st vs 2nd print same cover).
- **Howard Duck Magazine class** — format collision (magazine vs comic same character).
- **Marvel Age #58 class** — shared issue # different title.
- **Annual #2 class** — marker asymmetry (Annual #1 vs Annual #2 same series).
- **Loot Crate class** — convention/variant in active pool not flagged as variant.
- **Chip n Dale class** — text verified but cover image was different book.
- **Whitman #978 class** — non-comic format priced as regular comic.
- **Action Force class** — thin pence/UK market false HIGH match.
- **Spooky #118 class** — grade mismatch in active pool.
- **D'Orc #1 class** — apostrophe title eBay tokenization (`cleanTitleForSearch` SPACE replacement).
- **Star Wars #1 class** — reprint vs first-print (Vision sees, engine ignores) — Ship #19 territory.
- **Biker Mice #1 class** — thin pool sanity-flipped above lone comp — Ship #13.1 territory.
- **Action #1 / Superman #1 / Detective #27 class** — manual-review mega-keys.
- **JLA #62 class** — bottom-of-CGC-census low-grade floor — Ship #17 territory.
- **FF #61 class** — Silver Age key low-side threshold underpricing — Ship #14 territory.
- **House of Secrets #106 class** — alias-only creator detection — Ship #16 territory.
- **TMNT #1 IDW 2016 class** — mega-key publisher+year disambiguation — Ship #20a.7 territory.
- **Donald Duck Whitman #978 class** — refuse-to-price gate — Ship #20a.6.4 territory.
- **Provisional State Write class** — component writes optimistic state before backend confirmation, persists through merge.
- **Vision Hallucination class** — Vision infers fields from JSON_SHAPE context when confidence low.
- **Build-Pass Runtime-Fail class** — code passes build + tests but crashes at runtime (JSX scope errors).
- **Renumbered-franchise title/issue collision class** (ASM #17, 2026-07-16) —
  active-comp pool contaminated by a modern relaunch/anthology reprint sharing
  the exact same title+issue# as a scarce vintage original (Amazing
  Spider-Man #17 1964 vs. 2015/2025 relaunch "#17"s; also reproduced live for
  Action Comics #33 vs. its 2014 New 52 "#33"). NOT merch, NOT a category-gate
  leak — `MERCH_RE` and the `category_ids=259104` restriction work correctly;
  these are genuine, honestly-priced comics, just the wrong book. Root cause:
  `api/comps.js` Filter 0c (era-consistency, "FIX B"/Ship #25.1) deliberately
  accepts any active listing with no year token in its title, to protect
  genuine vintage sellers who omit the year (World's Finest #139/#149/#159/
  #163). That escape valve is symmetric — undated modern-relaunch listings
  pass the identical branch. **Source-level fix investigated and closed
  2026-07-16, no code path exists:** checked every field the eBay Browse API
  returns at both `item_summary/search` and `item/{itemId}` (full inventory —
  `itemCreationDate`/`itemOriginDate` is the *listing* post date, not the
  comic's publication date; `condition`/`conditionId` and `categoryId`/
  `leafCategoryIds` are identical across modern and vintage examples; `epid`
  correlates with lot-vs-single-item, not era) — no publication-date field
  exists anywhere in the API surface. Tested a price-band heuristic
  ($3.99-$4.99 = "probably modern") against a non-collision control book
  (Fantastic Four #187, 1977, no relaunch overlap) — 12/98 real, genuinely
  dated 1977 comps sat in that exact band, proving the heuristic would mass-
  reject legitimate non-key vintage back-issue comps. **Do not re-attempt a
  source-level (admission-time) fix without a genuinely new signal — this
  was investigated exhaustively, not skipped.** Mitigated at the card level
  instead: `computePriceBands` Tier 2 (`src/lib/priceBands.js`) flags the
  active pool as suspect when `activeAvg < soldAvg×0.25` or
  `activeLow < soldLow×0.25` and falls back to sold-only pricing rather than
  blending contaminated data in (commit 354d759). The parallel Q75 filter in
  `buildVerifiedActivePool` (same file) consumes the same eBay-sourced
  `{price, title}` shape and inherits the identical blind spot — no
  independent fix needed there; it's covered by the same card-level backstop
  once sold data reaches tier pricing. Residual gap: this backstop only
  engages when verified sold comps exist (`soldPool > 0`, i.e. Tier 2); a
  book with zero sold comps and a contaminated active-only pool (Tier 3/4)
  has no sold anchor to flag against and remains exposed. **A second,
  more severe gap in this exact guard — a sold pool of `n=1` treated as
  authoritative over 18 actives — found 2026-08-07: see "Bone #1 class"
  in the Pattern Library below (GK-34), scoped together with the
  mirror-image GK-21 defect in `applyVariantFallbackDivergenceCap`.**
- **Distinctive-artist-style confusion class** (Uncanny X-Men #27 /
  Ultimate X-Men #1, 2026-07-18) — Vision's own direct-image read
  (`STANDARD_PROMPT`, Sonnet) and eBay's independent reverse-image search
  both misidentified a Peach Momoko-illustrated cover as a different,
  unrelated title (Uncanny X-Men #27, 2026, misread as Ultimate X-Men #1,
  2024) — a title-level, not issue-level, confusion, confirmed on 3
  independent physical rescans of the same book with identical results.
  NOT the artist-consensus backfill ratio-gate class (Ditko/ASM #17,
  McFarlane/ASM #300, same night) — that gate governs whether an artist
  name in a MINORITY of a mixed pool should be trusted as distinguishing;
  Vision wasn't null on title here, so that mechanism never engages.
  Root cause: Vision's title came back wrong BEFORE any eBay signal
  entered the pipeline — grade.js's own eBay-image-search pre-check
  independently scored <0.3 confidence (triggering Vision fallback on its
  own), then Sonnet's `STANDARD_PROMPT` call (no eBay data injected)
  independently produced "Ultimate X-Men," and enrich.js's own separate
  reverse-image search (phase1) also converged on "Ultimate X-Men" from
  the raw photo. Two nominally-independent signals agreed, but on a
  correlated error — both keying off Momoko's stylistically consistent
  art across her different Marvel covers — not genuine corroboration,
  which is exactly what the system's "eBay agrees with Vision → trust it"
  design principle cannot distinguish from the real thing.
  **Mitigation investigated and implemented, honestly confirmed
  insufficient for this specific case:** TPB/collected-edition
  contamination of the identity-determination pool was a real,
  independently-discovered, separate gap (`TPB_MARKER_RE` gated the LATER
  comp-pricing pool only, never the earlier identity-consensus stage) —
  fixed via `IDENTITY_TPB_MARKER_RE` in `extractConsensus` (commit
  `2b00db5`). Reconstructed the real 20-listing production pool and
  confirmed: only 1/20 rows even matched (most sellers write "Paperback"
  with no "Trade" prefix), and removing it neither flips nor meaningfully
  moves the outcome — `extractConsensus`'s `issueOk` gate (3/20
  extractable issue numbers = 0.15, needs ≥0.5) was already correctly
  returning no-consensus with or without that row, matching production
  logs verbatim (`[visual] consensus: none — pool=20 (below issueOk>=50%
  coherence gate)`). With no consensus, the system correctly falls back
  to trusting Vision's own title — which was wrong from the start,
  upstream of anything this fix touches. **No further code-level fix
  identified — do not re-attempt without a genuinely new signal.** No
  field in Vision's response or eBay's API distinguishes "confidently
  reading the masthead correctly" from "confidently pattern-matching on a
  recognized artist's style"; both produce an identical high-confidence
  shape. A hard-coded "Uncanny ≠ Ultimate X-Men" rule would fix this one
  pair without generalizing (same caveat as the `OTHER_VARIANT_DESCRIPTOR_RE`
  stopgap elsewhere). This was investigated with a real, correctly
  implemented, low-risk, independently-justified mitigation attempt, not
  skipped or shrugged off — the mitigation shipped on its own merits but
  did not and could not resolve this case. Flagged for manual
  verification: any scan attributing a book to Peach Momoko (or any
  artist with a highly distinctive, recognizable style across multiple
  titles) should be double-checked against the physical masthead text
  before trusting title/issue.
- **Variant-artist token fusion class** (Black Cat #1 Skottie Young,
  2026-07-18) — the title-family weighted-consensus clustering pipeline
  (`buildTitleFamilies`/`selectTitleFamilyCandidate`, `src/lib/
  imageSearchIdentity.js`) fused a widely-shared variant-descriptor token
  into the confirmed series title. Vision correctly read "Black Cat" #1;
  because nearly every seller in the pool named the variant artist
  (Skottie Young) in their listing title, "young"/"skottie" co-occurred
  with "black"/"cat" in the required ≥60%-of-members share, so the Q45
  consensus-token vote treated them as core title tokens and fused them
  into the family string ("black cat young skottie"). That corrupted
  title then failed every downstream comp-title match (0/30 verified on
  20 genuinely correct comps), collapsing price to a fallback far under
  Vision's own estimate. Same failure SHAPE as the McFarlane/Ditko
  backfill-ratio finding the same night (a widely-shared artist name
  treated as distinguishing when it's common seller phrasing) but a
  DIFFERENT mechanism — that fix (`BACKFILL_MIN_YEAR` era-gate) only
  guards the CONFIRMEDVARIANT backfill path; the title-family clustering
  algorithm itself had zero artist-name awareness at the token-extraction
  stage (`tokenizeTitleFamily` → `extractSeriesTitle`, whose
  `NOISE_WORDS_RE`/`CATEGORY_BLOCKS` strip convention/ratio/retailer/
  exclusive/limitation/authentication/finish tokens but never creator
  names). Root cause was compounded by drift: TWO other independent,
  hand-maintained creator-name blocklists already existed downstream
  (`sanitizeSeriesTitle` in `src/lib/identityCore.js`, and
  `stripVariantNoise`/`extractMainTitle` in `imageSearchIdentity.js`) and
  BOTH were also missing Skottie Young — three separate artist-name lists
  had drifted out of sync with the canonical, comprehensive registry
  (`ARTIST_PATTERNS` in `src/lib/compHygiene.js`, which already had
  `/skottie young/i`) that `api/comps.js` soft-match creator filtering
  already trusts. **Fix:** `tokenizeTitleFamily` now strips
  `ARTIST_PATTERNS` matches before tokenizing, closing the gap at the
  single choke point shared by both Jaccard clustering AND the Q84
  dual-axis `ebayConsensusTitle` comparison (both route through this
  function), rather than forking a fourth list. Falls back to the
  unstripped title if stripping would empty it. Verified this does not
  regress the deliberate "creator-class addition allowed" behavior
  (Wonder Woman #75 / Jenny Frison, `tests/q84-dual-axis.test.js`) — that
  gate governs whether the Q84 override may ADD an artist name beyond
  what Vision+eBay already agreed on; it never depended on artist names
  surviving the base tokenizer, and the WW#75 fixture still passes
  unchanged. Regression fixture added: `tests/family-clustering.test.js`
  Fixture G, reconstructing the 20-listing Black Cat pool — confirms
  `confirmedTitle` resolves to "Black Cat" (not "black cat young
  skottie") and all 20 comps now cluster into a single matchable family.
  The other two drifted blocklists (`sanitizeSeriesTitle`,
  `stripVariantNoise`) were left as-is (out of scope for this fix — they
  didn't need to change for this bug's root cause to close, and touching
  them risks their own independently-tuned behavior); flag for a future
  pass if either surfaces its own production miss.
- **Intake-vs-listing gate class** (Walking Dead #109 / Siege #3 / Edge of
  Spider-Verse, Q110 dispatch, 2026-07-18) — three independent conditions
  (`assetTypeConfident=false`, Vision-confirmed `isReprint`/`editionType`,
  title-family-clustering `refused-identity-conflict`) were each wired as
  hard blockers that nulled price AND comps even when real, already-
  computed pricing data existed underneath — a card with a genuine
  10-listing comp pool (Walking Dead #109) showed a blank "Identification
  Required" wall instead of a number. Root cause was a FOUR-layer redundant
  block chain, not one gate: `api/enrich.js` nulled price directly and
  skipped the entire tier1-4 synthesis block (so the already-fetched
  comps never got priced); `decisionEngine.js`'s `identityBlockers` list
  forced `decision.action='ID_REQUIRED'`; `responseContract.js`'s
  `deriveState()` treated `ID_REQUIRED`/`refusedToPrice` as REFUSED-class
  and force-nulled `contract.price` regardless of what `out.price` held
  (enforced by invariant I1); `App.jsx`'s client-side merge separately
  folded `assetTypeConfident===false` into `idGated`, re-nulling price a
  third time. Comps were never gated by any of these layers and reached
  the client fully intact the whole time — hence "10 real listings, blank
  price." Separately, Siege #3 (a 2010 Marvel event tie-in) hit
  `identityRefused` — one of only 3 hard `return`s in the entire
  `api/enrich.js` pricing pipeline — which discarded the already-fetched
  eBay reverse-image-search pool (`visualResult.items`) entirely before
  the tier-4 visual-pool fallback (Ship 11, fires on
  `verifiedCount===0 && soldCount===0 && visualResult.items.length>=10`)
  ever got a chance to run; a sibling book in the same batch
  (Transformers Universe #1) correctly hit that same fallback and showed
  a $30 estimate with a $9.95–$125.99 range. Root-cause hypothesis for why
  event tie-ins are exposed: `tokenizeTitleFamily`/`buildTitleFamilies`
  (title-family clustering, see the Variant-artist-token-fusion entry
  above) has zero event/crossover awareness — a heavily cross-promoted
  event book's visual pool plausibly fragments across differently-titled
  tie-ins sharing similar cover branding, landing on a fragmented
  `fallback-vision` that escalates to `refused-identity-conflict`
  whenever Vision's own title-read confidence is LOW (plausible when a
  dominant event banner overwrites the small-print series title).
  **Ruling (explicit, not inferred):** all three conditions become
  informational-only at intake — the flag stays visible, but never
  prevents a computed price from displaying. Reserve hard, unconditional
  blocking for a later "ready to publish" stage, not intake/scan time.
  Genuinely-missing identity (no usable title/issue/year/publisher at
  all — `identity-not-confident`) is explicitly NOT included in this
  ruling and remains a hard blocker; there is no book to price against in
  that case, distinct from "identity present but a confidence flag fired."
  **Fix, reusing existing primitives rather than inventing new state:**
  `responseContract.js` already had exactly the right mechanism —
  `listingHardLocked` routes to contract state `LOCKED`, which (per the
  pre-existing "XMEN1 ruling" comment) keeps price/bands visible and only
  gates the List button, unlike `REFUSED`/`ID_REQUIRED` which null price
  everywhere. All three conditions now set `listingHardLocked` +
  `listingHardLockBanner` (the advisory copy) instead of
  `refusedToPrice`/`identityConfident=false`/forcing `ID_REQUIRED`, and
  `api/enrich.js`'s price-synthesis gate no longer short-circuits on
  `assetTypeConfident`. `isPolybagPricing` is deliberately NOT set true
  for the Vision-confirmed-reprint case (it was overloaded — also used by
  two genuinely data-driven, untouched divergence-abort branches and the
  legitimate reprint-pool pricing formula a few lines below) so control
  now falls through into that SAME existing reprint-pool pricing formula,
  or the normal tier engine, rather than a new bespoke path. The
  `identityRefused` early-return in `api/enrich.js` now computes the
  identical Ship-11 median/P25/P75 formula from `visualResult.items`
  inline (duplicated, not refactored, to avoid touching the already-
  tested Ship-11 code path) before returning, so a card only shows a
  genuinely blank price when there's truly nothing to fall back to (no
  visual pool either) — still not a REFUSED wall, an honest INCOMPLETE.
  Session-adjacent note: the `assetTypeConfident` hard-block itself was
  added same-day, hours earlier, in commit `1ea15f8` — this ruling is a
  conscious, explicit reversal of that gate's severity (confirmed with
  the user before implementing), not an accidental undo.
  **Messaging (Part 3, same dispatch):** `App.jsx`'s decision-panel
  render was showing raw blocker/warning slugs verbatim (literally
  `content-unverified`, `zero-verified-comps`) — `decisionEngine.js`
  already had nicer text in `buildWarningReason`/`buildBlockerReason` for
  some slugs, but that function's OUTPUT (`decision.reason`) was never
  what `App.jsx` rendered per-item. New exported `describeBlocker`/
  `describeWarning(slug, item)` functions map each slug to a specific,
  item-grounded sentence — `zero-verified-comps` now names the dominant
  `soldCompDiagnostics.reasons` rejection cause ("mostly variant
  mismatch"), `content-unverified` names the specific
  `storySuppressedReason` (era-gate-year-drift / foreign-edition /
  title-weak-match / title-token-mismatch / publisher-mismatch),
  `thin-pool-anchor` names the actual comp count, `identity-conflict-
  unresolved` surfaces the real `refusalReason` text. Found and fixed a
  genuinely dead field along the way: `out.compPoolContaminated` could
  never fire — `api/comps.js` computes and returns
  `reprintFallback`/`variantFallback` on its result, but `api/enrich.js`'s
  copy-forward block only ever threaded `artistFallback`/
  `premiumVariantIsolated` onto `out`, never those two — so "comp pool
  used a variant/reprint fallback" could never actually surface to a
  customer despite the check for it existing.
  Regression: `tests/q110-intake-nonblocking.test.js` — reconstructs
  Walking Dead #109 (LOCKED, real price visible), Siege #3 (LOCKED,
  Ship-11-formula fallback visible, range intact), the genuinely-zero-
  data sibling (honest no-price, still not REFUSED), and Edge of
  Spider-Verse (no longer the ID_REQUIRED wall, reframed as lowest-
  confidence RESEARCH tier) — plus a completeness guard asserting every
  known warning slug has a specific `describeWarning` branch, so a future
  `push()` with no matching branch can't silently regress back to raw-
  slug display.
- **Generic-descriptor variant-match class** (Venomverse #1, Q111
  dispatch, 2026-07-18) — active-comp variant isolation used only the
  generic finish descriptor ("foil") to require a match, pooling 2-3
  genuinely different products together (2017 "1:2000 Remastered B&W
  Variant", 2017 "1:1000 Remastered Incentive Color Variant" — same ratio
  as the correct book but a different, cheaper 2017 product — and the
  actual 2025 "SDCC McFarlane 1:1000 Mexican Foil" exclusive) into one
  averaged price. Confirmed NOT covered by the SAME-DAY Magik #1 / Silk #1
  fix (commit `1ea15f8`, `PREMIUM_VARIANT_RE` + `minMatches` threshold in
  `api/comps.js` Filter 1c) — that fix is a pure count/threshold change
  (2→1 matches required when the variant string contains a premium
  keyword); it assumes the token list handed to Filter 1c is already
  correct and never touches which tokens are extracted or how a listing is
  deemed to match. Two stacked, independent bugs, both real:
  1. **Upstream (root cause of this specific case):** `extractConsensus`
     (`src/lib/imageSearchIdentity.js`) built the confirmed `variant`
     string by flattening every category (convention/ratio/retailer/
     exclusive/limitation/authentication/finish) into ONE array and
     picking the single most-frequent token pool-wide via `getMostCommon`.
     In a foil-heavy pool, "foil" (finish category) is nearly always the
     most common token and wins outright — "sdcc" (convention) and
     "1:1000" (ratio), which `extractVariantTokens` correctly extracted
     per-listing one line earlier, were discarded before `variant` even
     left this function. Only affects the "Ship #EBAY-FIRST" eBay-first
     identity path (`api/grade.js:589-639`, the common "cheap path" when
     image-search confidence ≥0.3, per the Standard scan pipeline docs
     above) — the STANDARD_PROMPT/Vision-direct path is unaffected since
     Vision writes its own combined descriptive phrase with no lossy
     consensus step.
  2. **Filter 1c itself (independent, compounding, affects both identity
     paths):** `varWords.some(w => t.includes(w))` — ANY single token
     match counts as a full "variantMatch," never ALL. Even when `variant`
     DOES survive as a multi-word string, a listing containing only the
     generic "foil" (and none of the specific tokens) still isolates into
     the pool. Made WORSE by the same-day Magik/Silk fix specifically: a
     `variant` containing "sdcc" trips `PREMIUM_VARIANT_RE`, dropping
     `minMatches` to 1 — so a pool could "isolate" on a single
     generic-foil-only match with zero listings actually containing the
     premium marker, and get logged as validated `premium-variant
     isolation`.
  **Fix, reusing the existing taxonomy rather than forking a new one:**
  new `classifyVariantTokens(variant)` (`imageSearchIdentity.js`) — single
  source of truth splitting tokens into SPECIFIC (convention/ratio/
  retailer/exclusive/limitation/authentication) vs GENERIC (finish only:
  foil/virgin/sketch/holographic/etc — a cover TREATMENT, not a
  distinguishing PRODUCT) — used by BOTH call sites so they can't drift.
  (1) `extractConsensus` now computes the most-common token WITHIN each
  category independently (same pre-existing ≥2 adoption threshold), joins
  every category that reaches consensus in stable order — "sdcc 1:1000
  foil", not just "foil". (2) Filter 1c, extracted into a pure exported
  `applyVariantPreferenceFilter(pool, variant)`
  (`api/comps.js`) for direct regression-testability (matches the
  `hasMultipleDistinctIssues`/`detectSeriesMarkers` pattern already used
  in this file) — when 2+ specific tokens exist, require ALL of them
  (AND-match) instead of any single token; falls back to the original
  any-token OR-match if the AND-match produces zero comps (flagged via a
  `matchMode` field — `'all-specific'` / `'any'` / `'any-fallback'` —
  never silent). Single-specific-token variants (`"exclusive"` alone,
  Silk #1 class) and pure-generic variants (`"virgin"` alone — classifies
  as `finish`, i.e. generic — Magik #1 class) reduce to exactly the
  pre-Q111 OR-match behavior; only multi-token mixes change, confirmed by
  regression. Residual, deliberately out of scope: no regional-descriptor
  category exists anywhere in the codebase (`"mexican"`/`"uk"`/
  `"canadian"` are invisible to every tokenizer, including this fix) — not
  load-bearing for this case (`sdcc`+`1:1000` alone already correctly
  excludes both 2017 products), flagged as a follow-up if a future case
  needs it.
  Regression: `tests/q111-variant-token-specificity.test.js` — reconstructs
  the real Venomverse #1 pool (2017 ×2 wrong-ratio + 2017 wrong-product
  sharing "1:1000" + 2025 SDCC Mexican foil ×4), confirms `variant` recovers
  "sdcc 1:1000 foil" (not bare "foil") and Filter 1c isolates to exactly
  the 4 genuine SDCC listings, excluding BOTH 2017 products including the
  1:1000-sharing one a naive single-token match would still catch. Also
  reconstructs Magik #1 and Silk #1 (confirmed byte-for-byte unchanged
  behavior), a bare-generic-only variant (ANY-match fallback intact, no
  over-narrowing), and a synthetic AND-match-produces-zero case (confirms
  the fallback fires and is visibly flagged, never silently starves the
  pool to zero).
- **Batman #608 class, five stacked but independent bugs** (Q112/Q113/Q114/
  Q115 dispatch, 2026-07-18) — one card, four internal contradictions plus
  a fifth, deeper root cause discovered via direct production-log
  reconstruction AFTER Q112 shipped — confirmed as five genuinely separate
  root causes (not one fix covering all of them):
  1. **Year resolution (SHIPPED)** — `cvYear` was derived from
     `comicVine.startYear` (the matched ComicVine *volume*'s launch year —
     1940 for Batman vol. 1) instead of the matched *issue*'s own
     `coverDate` (2002 for #608, Hush). `resolveYear`'s `(!userYear || …)`
     branches (`src/lib/identityCore.js`) accept PC/CV years unconditionally
     with zero plausibility check whenever no Vision/user year is present on
     the request — the documented "keep user, reject override" safeguard is
     unreachable in that case. Structural: exposes any long-running ongoing
     series (Detective, Action, Superman, ASM v1, FF v1, X-Men v1, etc.), not
     Batman-specific. Fix: new `deriveCvYear(comicVine)`
     (`identityCore.js`) — issue `coverDate` only, no `startYear` fallback.
     Ruling: core fix only — the dead era-gate at `api/enrich.js` ~2893-2909
     (built to catch exactly this via an eBay-visual-pool-derived era lock,
     but reads the wrong `comicVine?.volume?.startYear` shape and has never
     fired) is a QUEUED FOLLOW-UP, not bundled here — it also touches CV
     convergence-score axes (~2811/2817/2823) and CV publisher backfill
     (~3332-3335), three more dead-code paths sharing the same shape bug,
     with unknown interaction effects once simultaneously reactivated after
     however long they've been dormant. Regression:
     `tests/q112-year-resolution.test.js`.
  2. **Sold-comp verification-count math (SHIPPED)** — card showed "30→20
     verified (20 variantMismatch, 6 annualMismatch, 3 lot)," summing to
     ~29 against a rejectedCount of 10. Root cause: `verifySoldComps`'s
     VARIANT FALLBACK path (`src/lib/soldVerification.js` ~828-1080) is a
     SECOND, independent filter pass over the full raw pool (fires when the
     first pass rejects 100% of rows with ≥1 variantMismatch, skipping
     variant filters on retry) — the returned verifiedCount/rejectedCount
     came from this second pass, but `reasons` was the abandoned FIRST
     pass's tally, which (having rejected every row before falling back)
     always sums to ~rawCount regardless of what the second pass actually
     excluded. Two different runs' numbers displayed as one set. Fix: the
     fallback pass now tracks its own `fallbackReasons`/
     `fallbackRejectedSamples` during construction, mirroring the main
     chain's exact per-filter reason-key mapping — `sum(reasons)` now
     reconciles with `rejectedCount` by construction, for any pool shape.
     Regression: `tests/q113-sold-fallback-reasons.test.js`, a 30-item pool
     reconstructing the real production shape.
  3. **Contradictory sold-data claims (SHIPPED, labeling only)** — "Sold
     data: 16d recency" (3 visible solds) vs Price Derivation's "Based on 0
     eBay sales in last 30 days" on the same card. NOT a data bug — confirmed
     these are two genuinely independent sources (`item.soldComps`,
     PriceCharting sales-history via `soldVerification.js`, vs
     `item.comps.count`, a separate eBay Browse/Finding API fetch via
     `api/comps.js`) that can legitimately disagree, presented with no
     source qualifier so they read as contradictory. Bonus finding: the "in
     last 30 days" claim is itself unenforced — `api/comps.js`'s
     `findCompletedItems` has no explicit date-range filter anywhere in the
     query. Fix: source qualifiers added to both lines (`App.jsx`, "Sold
     data: Nd recency (PriceCharting)" / "Based on N eBay listings (eBay)"),
     "in last 30 days" removed since it was never actually true.
  4. **Over-broad variantMismatch rejection (INVESTIGATED, FIX REVERTED —
     highest financial impact of the four, still open)** — 20/30 sold comps
     rejected as `variantMismatch` on a book with multiple genuine first-print
     Hush Cover A comps visibly sitting in the "Last Sold" pool; price
     $19.28 vs Vision's own $175-275 estimate. Confirmed NOT the same bug as
     the same-night Q111 fix (`f705054`) — `soldVerification.js` is untouched
     by that commit, imports nothing from `imageSearchIdentity.js`, and
     defines its own separate, cruder local `extractVariantTokens` (flat
     foil/virgin/newsstand/exclusive/ratio/sketch/altcover/reprint labels,
     no specific-vs-generic distinction). Root mechanism: Filter 8 case (a)
     (`compVariantTokens.length > 0 && userVariantTokens.length === 0` →
     reject) fires on ANY token when our confirmed variant is empty,
     including incidental marketing language, not just genuine variant
     declarations. **Attempted fix, reverted after implementation testing
     (not caught during the investigation/report phase):** classify tokens
     via `classifyVariantTokens` (same taxonomy as the Q111 fix) into
     SPECIFIC (convention/ratio/retailer/exclusive/limitation/authentication)
     vs GENERIC (finish: foil/virgin/sketch), only reject on specific-token
     presence. Broke a validated, real protection instead — the existing
     test `"Test Comic #1 virgin variant"` / `"Test Comic #1 foil variant"`
     (`tests/sold-verification.test.js`, "Variant contamination — our book
     NOT a variant rejects variant rows") are UNAMBIGUOUS explicit variant
     labels (the word "variant" is right there), not marketing hype — and
     CATEGORY_BLOCKS classifies by WORD MEANING (is "foil" a finish
     descriptor?), not by whether the word appears as part of an actual "X
     variant"/"X cover" declaration vs standing alone as sales language on
     an otherwise-standard listing. Those are different questions; the
     generic/specific split can't answer the second one, and conflating them
     silently reopened exactly the contamination class Filter 8 case (a)
     exists to prevent. **A correct fix needs phrase-level context-
     sensitivity — does the token sit inside an explicit variant-declaring
     phrase, or stand alone as apparent hype? — which no pattern in this
     codebase has today.** Reverted cleanly (confirmed `sold-verification.test.js`
     back to the exact 124-passed/5-failed pre-existing baseline). Do not
     re-attempt with the same specific/generic heuristic without first
     designing the phrase-context signal — this was a real, honest attempt
     that surfaced a genuine gap during testing, not skipped or guessed at.
  5. **Visual-pool contamination corrupting variant/year backfill (SHIPPED
     — the actual primary root cause of the wrong year in this exact card,
     discovered via direct Vercel production-log reconstruction AFTER #1
     shipped)** — pulled the real 20-item eBay reverse-image-search pool
     for this exact scan (searched runtime logs for the distinctive title
     string, confirmed via `[boot]` build ID it was the authentic pre-fix
     request). **0 of 20 items were genuinely Batman #608** — a mix of
     Superman/Batman #657, Absolute Batman #19, Detective Comics #1000,
     Batman #1 reprints/facsimiles, Batman and Robin #25, and even
     unrelated Marvel Venomverse listings, sharing only eBay's own visual-
     similarity confusion around cover artist Dell'Otto's distinctive
     painted style across his many DIFFERENT DC variant covers (confirmed
     genuine eBay-search-quality noise, not a category/leaf-filter gap on
     our side — all correctly categorized `259104`). Title-family
     clustering correctly detected the incoherence (`decision=fallback-
     vision`, `[visual] consensus: none`) and correctly avoided the pool
     for TITLE purposes. **The bug: `extractConfirmedVariant`
     (`src/lib/variantIdentity.js`) is a SEPARATE consumer of the exact
     same raw pool that never learns about that determination** — it
     re-processes the full unfiltered 20 items regardless. 4/20 mentioned
     "Dell'Otto" — a MINORITY (20%), correctly scored as *not* the
     standard cover by the existing artist-consensus ratio gate (Q109-FIX-
     A, `< 70%` = "distinguishing," the exact signal shape this feature
     treats as a genuine variant subset when the pool IS the same book,
     its original documented purpose — e.g. a Skottie Young facsimile
     mixed into a Captain America #25 pool). With no issue-level check,
     the gate can't distinguish "genuine minority-variant subset of THIS
     book" from "these are just different books that happen to share a
     prolific painter." Backfilled `confirmedVariant="exclusive Dell'Otto
     limited"` and, via the feature's own Q99-B artist-year sub-mechanism,
     overrode `confirmedYear` 2002 → 1940 — **entirely independent of and
     downstream from `resolveYear`**, which had already correctly resolved
     2002 by this point (confirmed directly in the log:
     `[variant-identity] gates passed: year=2002` immediately followed by
     `[variant-year] overriding confirmedYear 2002 → 1940`). This
     corrupted variant then drove the active-comp search query itself
     (`Batman #608 Dell'Otto 1940 DC Comics`) and rejected all 30 genuine
     PriceCharting sold comps in Filter 7 (`classifyArtistMatch` — real
     Batman #608 listings never mention "Dell'Otto," the actual artist is
     Jim Lee) before Q113's fallback rescued 20 of them at the wrong
     price. **Confirms Fix #1 (item 1 above) is real and independently
     worth keeping, but was NOT sufficient alone for this exact production
     symptom** — the two fixes are complementary defense-in-depth on two
     structurally separate pathways (ComicVine volume-year leak vs.
     visual-pool variant/year backfill), not redundant.
     **Fix, reusing the existing per-item `.issue` field rather than new
     extraction logic:** new `filterItemsByIssue(items, confirmedIssue)`
     (`src/lib/variantIdentity.js`) — filters the visual pool to only
     items whose OWN extracted issue number (already computed by
     `extractIdentityFromImageSearch`/`extractIssueFromTitle`, the exact
     value the `[visual] extracted issues: [...]` log line already draws
     from) matches our confirmed issue, applied in `api/enrich.js`
     immediately before `extractConfirmedVariant` is called — root-
     mechanism fix (bad input never reaches the computation), not a
     downstream flag on bad output. An artist-name match can structurally
     never come from a different issue once this filter is applied. The
     pre-existing Ship 26.3B family-narrowing (only fires for
     `top-rank-protection`/`weighted-consensus` decisions) is unioned with
     this filter, not replaced by it — Ship 26.3B still narrows to the
     selected title family first when one was found; this filter then
     additionally requires genuine issue-number agreement regardless of
     which branch produced the candidate pool. Confirmed the facsimile/
     genuine-variant case this feature was originally built for (Captain
     America #25 / Skottie Young) is unaffected — those listings still
     carry "#25," so they survive the filter untouched, including when
     mixed with unrelated-issue noise in the same pool.
     Regression: `tests/q115-variant-issue-filter.test.js` — reconstructs
     the real 20-item Batman #608 pool with `.issue` values matching the
     production log exactly (15 non-null / 5 null, zero "608"), confirms
     the bug reproduces on the unfiltered pool (fixture fidelity check)
     and resolves after filtering (`confirmedVariant` stays null,
     `confirmedYear` stays 2002); confirms Captain America #25 / Skottie
     Young still backfills correctly standalone AND when mixed with
     unrelated-issue noise; confirms empty and single-item post-filter
     pools fall through gracefully (no crash, no backfill) rather than
     defaulting to something else.
- **Incredible Hulk #377 class, printing/edition not tracked** (Q116
  dispatch, 2026-07-18) — printing (1st/2nd/3rd/.../Nth, facsimile) was not
  a variant category anywhere in the system. Confirmed real: Incredible
  Hulk #377 (McKeown/McLeod 3rd printing, $100 min raw per Goldin.co) priced
  at $10.52 by blending 1st/2nd/3rd-print comps together. Investigation via
  real Vercel production logs found `editionWarning.detected` never fired
  for that exact scan — Vision's cover-photo-only analysis never captured a
  printing signal at all, a genuine upstream limitation this dispatch
  cannot fix (see Part 3 / Option A below). Separately found a real,
  actionable bug even when the signal DOES fire: `api/enrich.js`'s existing
  edition-gate (Ship #1.3) grouped ALL reprint-labeled comps into one
  undifferentiated "any reprint" bucket, discarding
  `editionWarning.signals`' own specific classification
  (`'second-print'`/`'third-print'`/`'facsimile'`).
  **Part 1 fix:** new `classifySpecificPrinting(signals)` (`api/grade.js`)
  — priority third > second > facsimile, returns `null` on generic-only
  signals (`'reprint'`/`'later-printing'`/`'not-first-print'`/
  `'not-original'`/`'less-valuable'` — deliberately not threaded, since a
  vague "some kind of reprint" signal is exactly the under-specified input
  Q111 already fixed AND-match against, not real data). `api/enrich.js`'s
  edition-gate now isolates comps to the specific printing kind when one is
  classified, falling back to the old undifferentiated regex only when
  Vision's signal was itself generic.
  **Part 2 fix:** the classified kind is threaded into `confirmedVariant`
  (`api/enrich.js`, guarded by `!cgcIdentityConfirmed && editionWarning?.detected`)
  so it feeds the SAME isolation machinery already built for other variant
  categories — Q111's AND-match (`applyVariantPreferenceFilter`, Filter 1c)
  on the active-comp side, and the pre-existing `printingMatch`
  (`soldVerification.js`) on the sold-comp side. New `PRINTING_PATTERNS`
  category added to `CATEGORY_BLOCKS` (`imageSearchIdentity.js`), classified
  SPECIFIC (not generic — a 3rd printing and a 1st printing are different
  products with different market values, same reasoning as an
  SDCC-exclusive or ratio-incentive claim).
  **Compounding bug found and fixed while writing the regression (NOT part
  of the original ask, surfaced by testing, reported before fixing per
  standing protocol):** threading `confirmedVariant = "3rd print"` did
  NOT actually activate Q111's AND-match on the active-comp side.
  Two stacked root causes in `api/comps.js`'s `applyVariantPreferenceFilter`
  (Filter 1c), both pre-existing and general, not introduced by Part 1/2:
  (a) a `varWords` stopword/length filter gated the ENTIRE function before
  `classifyVariantTokens` was even consulted — `'3rd'` is length 3 (filter
  requires `>3`), `'print'` is an explicit stopword, so `varWords` came out
  empty and the function early-returned `matchMode:'none'` for every
  printing token, unconditionally; (b) `classifyVariantTokens` itself
  word-split the input and looked up each word individually against the
  token registry — silently breaks any token that's inherently multi-word
  with no useful standalone-word remainder. Confirmed this second issue
  predates Q116 entirely: `classifyVariantTokens('signature series')` was
  already `{specific:[], generic:[]}` (`'gold foil'`/`'convention
  exclusive'` happened to survive "by luck," since their second word is
  separately a valid standalone token — `'3rd print'` has no such luck).
  **Fix (greenlit separately, same dispatch):** `classifyVariantTokens`
  rewritten from whitespace word-split to a longest-token-first substring
  match against the full known-token registry (mirrors
  `extractVariantTokens`' own convention, with the same
  skip-if-already-covered-by-a-longer-match guard used there for bare
  `'foil'` vs `'gold foil'`). `applyVariantPreferenceFilter` no longer lets
  `varWords` gate the function up front — `classifyVariantTokens` is
  consulted first; `varWords` is now only a same-purpose fallback for
  variant text `classifyVariantTokens` can't classify at all. Verified
  zero regression on the full Q111 suite (27/27, including the Venomverse
  AND-match, Silk #1, Magik #1, and AND-match-fallback fixtures,
  byte-identical behavior) plus the `signature series` fix landing as a
  confirmed side effect, not the reason it shipped.
  **Part 3 (explicit product decision, not a code fix, recorded for future
  reference):** cover-only photography cannot see printing-edition indicia
  for most books — physics, not a bug. Decided: Option A — a manual
  "Printing" dropdown field (1st/2nd/3rd/Nth/Unknown), same UX pattern as
  the existing Mark-as-Raw/Mark-as-Graded toggle, feeding directly into
  `confirmedVariant` to trigger the same isolation machinery built here.
  Not yet implemented — queued as a future dispatch, not bundled into this
  one.
  Regression: `tests/q116-printing-edition.test.js` (39 assertions) —
  `classifySpecificPrinting` priority/null behavior; `PRINTING_PATTERNS`
  extraction and SPECIFIC classification; an end-to-end reconstruction
  (Vision text genuinely triggers `'third-print'`, real Incredible Hulk
  #377 comp-pool title data reused from the actual production pool) proving
  both the active-side isolation (14 comps → 2 genuine 3rd-print survivors)
  and the sold-side `printingMatch` isolation (verified average $105 vs.
  the $12-20 blended 1st/2nd-print comps) now work; a thin-pool honest
  refusal case (<3 matching comps); and a control case confirming a normal
  no-printing-signal book is completely unaffected end to end.
- **Catwoman #64 Szerdy-variant class, same title/same issue#/different
  year** (Q127 dispatch, 2026-07-19) — a NEW visual-pool contamination
  shape, distinct from the Batman #608 class (Q115): there, the wrong-book
  pool shared a DIFFERENT issue number, so `filterItemsByIssue` fixes it at
  the root. Here, the wrong-book pool (a 2024 Nathan Szerdy "exclusive/
  limited" trade-dress homage variant) shares the SAME title string AND the
  SAME issue number as the real 2007 Catwoman #64 — `filterItemsByIssue` is
  a structural no-op against it (confirmed: 20/20 pool items genuinely
  extract issue "64"). The only signal distinguishing the two books is
  YEAR. `poolYearHint` (independently computed per-request from the same
  visual pool, no ComicVine dependency) already carried it — 2024 at 100%
  agreement (6/20 explicit mentions) — completely decoupled from
  `confirmedYear` (2007, resolved later from PriceCharting) and never
  cross-checked against it. Root mechanism was two-layered: (1) grade.js's
  own eBay-first path (`extractConsensus`, api/grade.js:353, a SEPARATE
  request/pool fetch from enrich.js's own) produced the contaminated
  `variant="exclusive limited signed"` and forwarded it to the client, who
  sent it back as `req.body.variant`; (2) `extractConfirmedVariant`'s own
  gates in enrich.js never fired to correct it (Gate 4, confidence=high,
  silently declined the override), so the contaminated client-forwarded
  string passed through untouched. Fix: `detectVariantPoolYearConflict`
  (`src/lib/variantIdentity.js`) — a POOL-LEVEL (not item-level) gate,
  deliberately: only 6/20 of the real contaminating listings even mentioned
  a year at all; the other 14 ("Nathan Szerdy DC Comics Trade Dress Variant
  A /3000 Homage Cover") carry no year and would survive a per-item filter
  untouched, still contributing exclusive/limited tokens. Mirrors the
  existing `[cv-era-gate]` precedent (suppress outright on a huge,
  incontrovertible year drift, rather than partially filter). When
  `poolYearHint` conflicts with `confirmedYear` by more than 5 years (a
  tunable tolerance, looser than mega-key/AI-verify ±1-2y conventions —
  this is a coarser "is this pool even plausibly the same printing"
  check), `api/enrich.js` suppresses BOTH the client-forwarded
  `req.body.variant` (nulled, not trusted) AND the `extractConfirmedVariant`
  recomputation (skipped entirely, never re-derives the same contamination
  from the same pool) — surfaced via `out.variantPoolYearConflict` per I13
  (annotate, never silently drop). Deliberately conservative: can suppress
  a genuine Vision-read variant on the rare chance one coincides with a
  conflicting `poolYearHint` — accepted per standing doctrine (prefer
  under-confident over over-confident identification; a missed multiplier
  is a small miss, a contaminated one is the $13.50-vs-real-price class of
  bug this gate exists to close).
  Regression: `tests/q127-variant-pool-year-conflict.test.js` (26
  assertions) — `detectVariantPoolYearConflict` unit behavior (no-hint,
  agreement, boundary-at-tolerance, over-tolerance); an end-to-end
  reconstruction of the real 20-item Catwoman #64 pool confirming
  `filterItemsByIssue` is genuinely a no-op (0/20 removed) while the new
  year-gate correctly suppresses both `req.body.variant` and
  `extractConfirmedVariant`; a regression confirming the Batman #608 class
  stays inert under this new gate (no poolYearHint → gate never engages,
  Q115's own fix remains the mechanism that closes it); and a genuine
  same-year multi-variant case (Captain America #25 / Skottie Young,
  poolYearHint agreeing with confirmedYear) confirming the gate does not
  false-positive and the real variant backfill still fires normally.
- **Drifted-duplicate-constant class, third instance: year-tolerance
  numbers** (Q128 dispatch, 2026-07-19) — the same "independently-
  maintained copy silently drifts from its sibling" shape found twice
  earlier the same night (Q119: five separate `COMPOUND_TITLE_WHITELIST`-
  equivalent lists, consolidated onto one canonical export; Finding 2/Q127:
  ~10 separate `req.body.variant` read-sites in `api/enrich.js`, several
  bypassing the gated `confirmedVariant`) — recurring a third time, this
  time as a NUMERIC tolerance constant rather than a string list or a
  variable-read site. `api/comps.js`'s active-listing Filter 0c (±3y for
  modern books) and `src/lib/soldVerification.js`'s sold-comp
  `yearMismatch` filter (±2y for modern, in TWO places — a main pass and a
  fallback pass) had already silently diverged — and `soldVerification.js`'s
  own comment literally read "Era-based tolerance (mirrors active Filter
  0c)," a claim that was no longer true by the time it was read. Same
  lesson as the prior two instances: a comment asserting cross-file
  consistency is not itself evidence of consistency; only a shared,
  single-sourced value is. Fix: `getEraYearTolerance` +
  `evaluateEraYearMatch` (`src/lib/compHygiene.js`, already the
  established shared-helpers home per this doc's Key Files list) — one
  function each, reused by `api/comps.js` and both `soldVerification.js`
  passes. `identityAlignment.js`'s own flat (non-era-banded) ±2y
  `yearMatch` was deliberately NOT folded in — it serves a different
  purpose (Vision/CV/PC self-consistency scoring, not comp-pool admission)
  and was never part of the false "mirrors" claim; consolidating it too
  risked unrelated collateral effects on identity-confidence scoring for
  no clear benefit. When auditing for this class going forward: grep for
  the same VALUE (a regex, a whitelist, a tolerance number, a threshold)
  appearing in more than one file, not just for files that explicitly cite
  each other — the citation is exactly the thing that goes stale first.
- **Back-issue comp listings commonly cite a series' volume-launch year,
  not the specific issue's own cover date** (Q128 dispatch, 2026-07-19,
  Harley Quinn #62) — a domain-knowledge fact about how the secondary
  comics market labels listings, independent of the code-drift finding
  above; documented here on its own so a future investigation doesn't
  have to re-derive it. Confirmed via a direct, real ComicVine `/volumes/`
  API lookup during this dispatch (not inferred): a real production card
  for Harley Quinn #62 (confirmed via PriceCharting to be cover-dated
  2019) had an active eBay comp titled "...Harley Quinn #62 (2016)
  Guillem March 1st Print..." sitting in its comp pool. This looked, on
  its face, identical to the Batman #608 / Catwoman #64 wrong-volume
  contamination shape (Q115/Q127) — but querying ComicVine directly for
  the exact volume this book's issue #62 resolves to (vol_id 92750, per
  the same production log's own `[comicvine] volDetails fetched: 1/1 —
  92750:Harley Quinn(2016,DC Comics)` line) returned `start_year: 2016`
  as ComicVine's own canonical value for that volume — confirming the
  "(2016)" label is the ongoing series' launch year, not a different,
  wrong printing. Sellers on eBay (and, per this same lookup, ComicVine/
  GCD/MyComicShop-style cataloging generally) routinely cite the volume's
  start year for back issues rather than looking up each individual
  issue's specific cover date — completely standard practice, not seller
  error and not contamination. Mechanically encoded as `isVolumeLabelYear`
  (`src/lib/compHygiene.js`): a comp's stated year is treated as
  legitimate when it lands within ±1y of the CONFIRMED book's own
  ComicVine volume start year, even when it falls outside the ordinary
  confirmedYear era tolerance. Does NOT weaken protection against genuine
  wrong-volume contamination (Batman #608 class) — a volume-label match
  only admits a year matching THIS specific book's own resolved volume,
  never an arbitrary nearby year. Before assuming a same-title/same-issue,
  different-year comp is contamination: check whether the stated year
  matches the confirmed book's own ComicVine volume start year first —
  it may be the more mundane, correct explanation.
- **Correct-rejection silent-substitution class** (Q129 dispatch,
  2026-07-19, Harley Quinn #62 Guillem March Cover C) — a fourth same-
  night instance of the "same title, same issue#, different year meaning"
  shape (Q115 Batman #608, Q127 Catwoman #64, Q128 Harley Quinn #62's own
  active-pool tolerance gap), but structurally the FIRST where the correct
  behavior (era-filter rejecting a different printing) is what CAUSES the
  downstream problem, rather than a filter failing to reject something.
  Confirmed real: the physical book is the Guillem March Cover C card-
  stock variant (confirmedYear 2019). Every currently-live eBay listing
  matching that exact description is a 2026 DC homage/nostalgia reprint
  solicitation, correctly rejected by Filter 0c's era check (3 of 14
  rejections explicitly named "Cover C"/"Guillem March"). With zero
  genuine 2019 Cover C comps left in the market right now, the variant-
  preference filter fell back to matching on "1st print" — a token nearly
  every current listing shares, including the wrong ones — and the
  surviving pool (generic Main Cover comps) silently produced a price with
  no signal that the SPECIFIC variant being priced has no current market
  data. Not fabrication (Vision Hallucination class), not contamination
  (Q115/Q127/Q128) — a silent substitution of one real product's comps for
  a different real product's when the correct data genuinely doesn't
  exist right now. Compounding factor found during investigation: "Guillem
  March" was entirely absent from `ARTIST_PATTERNS`
  (`src/lib/compHygiene.js`) — the same drifted/incomplete-registry shape
  documented multiple times this session, discovered fresh here; added as
  a multi-word-only pattern (deliberately no bare `/march/i` fallback —
  collides with the calendar month). Fix: `hasNamedVariantDescriptor` +
  `detectVariantCompsExcludedByEra` (`src/lib/compHygiene.js`) — reuses
  three pre-existing detectors (`OTHER_COVER_RE`, `OTHER_VARIANT_DESCRIPTOR_RE`,
  `extractArtist`) rather than inventing a fourth. `api/comps.js`'s Filter
  0c tracks era-rejected listings that name a specific cover variant, then
  flags only when the FINAL priced pool carries no named descriptor at
  all — a final pool that DOES carry a different-but-still-named variant
  is still pricing a real, specific product, not the silent-substitution
  shape this catches. Surfaced via `out.variantCompsExcludedByEra` (I13)
  and a new `variant-comps-unavailable` decision warning, escalating to
  RESEARCH. When investigating a "wrong price" report going forward: check
  whether an upstream filter (era, in this case) correctly rejected the
  RIGHT comps for a legitimate reason, leaving only wrong-but-permitted
  comps behind — this is a different failure shape from data getting IN
  that shouldn't have, and needs a flag, not a filter change.
- **Bone #1 class — Strip 1's first production validation, plus a cluster
  of independent real findings surfaced by the same scan** (GrailKey
  Dispatch 05/06, 2026-08-07). Two Bone #1 books scanned back to back.

  **Strip 1 confirmed working, first production evidence.** Book 1:
  `[Q84] override-allowed reason=coherent-content tokens [cartoon,books]
  (>=3 member support each: [4,4])`, `[title-family] selected=bone`,
  `[identity] confirmed="bone" #1` — verified against `confirmedTitle` in
  the logs, not the card, per standing practice in this dispatch chain.
  The publisher/imprint-noise tokens ("cartoon," "books" — pool boilerplate
  from "Cartoon Books" imprint mentions) were routed to the variant-suffix
  path instead of corrupting the title, exactly as Strip 1 was designed to
  do. `[strip1-variant-routing]` itself did not fire on this scan because
  `confirmedVariant` was already populated ("signed nth print" from
  Vision) and that block is fill-only-if-empty — an acceptable non-fire,
  not a miss: the load-bearing half (keeping the tokens OUT of the title)
  worked regardless of which specific block absorbed them. Book 2 shows
  Strip 1's known limit, not a regression: Q140 admitted `[jeff,smith]` as
  coherent-content (not on the routing phrase list), so both tokens stayed
  in the title — `confirmedTitle = "bone jeff"` — and were then rejected
  by the pre-existing `[22c]` title-revote backstop as expected
  (`title rejections: ebay="bone" (expected "bone jeff"), vision="bone"
  (expected "bone jeff")`). The creator-recognition gate independently
  failed on the same input (`override-blocked reason=non-creator additions
  [jeff,smith]`) — see the registry-gap finding below; this is a separate
  mechanism from Strip 1/22c, not a second instance of the same bug.

  **GK-34 — mirror-image of GK-21, same root defect, not yet fixed.**
  Both books priced at $1,619.99 (real value ~$15-40). Root chain,
  verified directly in `src/lib/priceBands.js`:
  `[sold-verify] kept 1/21 (rejected 20: annualMismatch=1, gradeMismatch=4,
  stale=15)` left exactly one surviving sold comp — a genuine $1,619.99
  sale of a **1991 US first printing** — against a book that is actually a
  **later-printing UK edition** (£2.95, "signed nth print"). The Tier-2
  `activePoolSuspect` predicate (`priceBands.js:658-661`,
  `activeAvg > 0 && soldAvg > 0 && (activeAvg < soldAvg*0.25 ||
  activeLow < soldLow*0.25)`) compared that lone $1,619.99 sold comp
  against 18 active listings averaging $40.50, concluded the 18 actives
  must be the anomaly, and discarded them — `market = soldAvg` at line
  668. **Confirmed: neither this predicate nor its mirror-image sibling
  has any minimum-pool-size floor on the side doing the overriding.**
  `applyVariantFallbackDivergenceCap` (`priceBands.js:417-459`, the GK-21
  mechanism — 1 active listing previously overrode 28 solds) only checks
  `activePrices.length === 0` (line 423, i.e. "not empty," not "big
  enough") before letting a single active price cap/overwrite a
  sold-pool-derived result of any size. Both are pure ratio tests with no
  sample-size gate on the overriding pool — `n=1` carries the same
  authority as `n=18` or `n=28`. (By contrast, the sibling
  `activeAnchoredOverFallbackSold`/GK-31 branch, `priceBands.js:546`, and
  `isActivePoolVariantConfirmed`, `priceBands.js:298`, already DO enforce
  a `verifiedActive.length >= 3` / `< 2`-reject floor — precedent for the
  fix below already exists in this same file, just not applied to these
  two mechanisms.)

  **FIXED (2026-08-07, commit `2dbf651`) — greenlit with a revision to the
  original GK-34 proposal.** Shared constant `MIN_POOL_FOR_OVERRIDE = 3`
  (matching the GK-31/`isActivePoolVariantConfirmed` precedent),
  `priceBands.js`. **GK-21** (line 423, `applyVariantFallbackDivergenceCap`):
  shipped exactly as specced — `activePrices.length === 0` → `< 3`. **GK-34**
  (Tier 2 `activePoolSuspect`): the original 70/30-blend-fallthrough
  proposal was rejected before coding — 0.7×1619.99 + 0.3×40.50 = $1,146,
  still absurd for a $15-40 book, because a thin sold pool would still
  dominate the blend's arithmetic even without dominating it outright.
  Revised instead: when `soldPrices.length < MIN_POOL_FOR_OVERRIDE`, the
  weighting inverts — the active pool carries the price via the same
  ask-discount formula Tier 3 already uses (`activeAvg × 0.85`), and the
  thin sold pool is demoted to a reference annotation
  (`soldPoolTreatedAsReference`, I13-compliant: surfaced, never
  vaporized, never the anchor). **Verified against the real Bone #1
  numbers before shipping, per the acceptance-test requirement**:
  soldAvg=$1,619.99 (n=1), activeAvg=$40.50 (n=18) → market=**$34.42**,
  inside the specified $15–40 target. A sold pool that clears the floor
  keeps the original sold-only behavior — the ASM #17 contamination
  defense this guard exists for is untouched. Also added, per explicit
  request: `[pool-ratio-warn]` logging (observational, non-gating) on
  both mechanisms whenever an override fires with the overriding pool
  smaller than 1/3 of the overridden pool — n=3 clears the floor but
  isn't asserted as sufficient; this is what will show whether it is, in
  production. Regression: `tests/priceBands.test.js` — EX-A(c)'s "2.01x
  caps" fixture widened to a 3-comp active pool to keep testing the cap
  threshold now that it requires a floor-clearing pool (discovered while
  updating it: 3 identically-titled comps matching the confirmed variant
  word tripped `isActivePoolVariantConfirmed` and rerouted to the
  unrelated GK-31 branch — retitled to a non-matching title to keep the
  test on its original target); new dedicated test confirms a 1-comp
  active pool no longer caps at all, any divergence ratio. Baseline
  7-failure count (this doc's own documented pre-existing stale-suite
  list) unchanged before and after — zero regressions.

  **Upstream contributor to the GK-34 singleton, investigated, not yet
  addressed:** the `stale` filter in `verifySoldComps`
  (`src/lib/soldVerification.js:216-224`, thresholds at lines 61-68 —
  `MODERN_STALE_DAYS=90` for books ≥2000, `COPPER_STALE_DAYS=180` for
  1985-1999, no cutoff at all below 1985) rejected 15 of Bone #1's 21 raw
  sold rows. Bone #1 (1991) falls in the 180-day Copper tier. Git history
  shows this was tightened from a uniform 540-day window
  (commit `1e77516`, "Modern (2000+): 540d → 90d, Copper (1985-1999):
  540d → 180d") — a 3x cut for Copper, 6x for Modern — on an asserted-not-
  demonstrated rationale ("higher velocity markets... still active," no
  sales-cadence data cited). `tests/sold-verification.test.js`'s existing
  stale fixture only exercises day values that reject/keep identically
  under both the old and new thresholds (30/90 kept, 600/800 rejected) —
  the tightening shipped with no regression test pinning the new
  90/180-day boundary specifically. The vintage tier (`bookYear < 1985`)
  is explicitly exempted from rejection because "sold pools naturally
  thin" (`soldVerification.js:64`) — the same reasoning applies to a
  non-blockbuster Copper-era back issue like Bone #1 in a specific grade,
  which the current era cutoff doesn't protect. Not yet fixed or
  rescoped — flagged as the upstream manufacturer of GK-34-shaped
  singletons generally, not just this one book; any fix to the trust-
  decision floor above should be paired with re-examining this threshold,
  not treated as a full substitute for it.

  **Measurement attempt (2026-08-07), partial, honest result — does NOT
  answer "how many of the 48 ledger scans" as asked.** Queried live
  Vercel production runtime logs directly (`get_runtime_logs`, full-text
  search on `[sold-verify] kept`) rather than guessing. A `since=24h`
  window returned exactly 15 scans total; wider windows (`48h`, `4d`,
  `7d`) all timed out against this project's log volume before returning
  results — this tool cannot currently reach back far enough to cover an
  arbitrary 48-scan ledger without knowing which 48 requests those are.
  Of the 15 scans in the successful 24h sample, exactly 2 hit the `stale`
  filter at all — and both are the two Bone #1 scans from this exact
  dispatch (`kept 1/21 ... stale=15` / `kept 1/21 ... stale=14`,
  byte-matching the quoted log lines). Zero of the other 13 scans in the
  sample show any `stale=` rejection. This is consistent with either "the
  180-day cutoff mostly doesn't bite in practice, Bone #1 was unlucky" or
  "the ledger's other 46 scans mostly fall outside this 24h window and
  the sample is too small/recent to say anything" — 15 scans, 2 of which
  are the known-bad case, cannot distinguish those. **Does not clear the
  threshold change for a decision either way.** To get a real answer:
  either supply the actual 48 request IDs/timestamps being tracked so
  they can be queried directly, or accept a `deploymentId`-scoped,
  narrower-but-deeper query as a substitute. Threshold left untouched.
  **Parked (2026-08-07)** — not answerable from available logs, not worth
  further time until the right requests can be queried directly (request
  IDs/timestamps, or a `deploymentId`-scoped query). No further action
  pending new input.

  **Creator-registry gap, confirmed as a real audit (not a one-off name
  add) — "Jeff Smith"/"Cory Walker" class.** Traced the
  `override-blocked reason=non-creator additions [jeff,smith]` gate to its
  actual source: `applyDualAxisGate`
  (`src/lib/imageSearchIdentity.js:1455`, blocked-return at line 1593)
  computes `nonCreator` (line 1525) against `poolArtistTokens`
  (`extractPoolArtistTokens`, lines 1296-1314), which matches pool titles
  against `ARTIST_PATTERNS` — the canonical registry
  (`src/lib/compHygiene.js:370-442`, ~68 patterns, already named canonical
  by the Variant-artist-token-fusion entry above). **Root cause: neither
  "Jeff Smith" nor "Cory Walker" exists in `ARTIST_PATTERNS`, or in any of
  the other five creator-name-adjacent lists in the codebase** — a genuine
  absence, not a canonical-vs-drifted disagreement for these two names
  specifically. Full inventory: `ARTIST_PATTERNS` (canonical, ~68
  patterns); the `artistWords` Set inside `compHygiene.js`'s own
  `tokenizeTitle()` (lines 756-777, labeled "Q55-C: Full sync with
  ARTIST_PATTERNS" but confirmed stale — missing frison/giang/eom/lozano,
  all added to the canonical list after that sync comment was written —
  **a THIRD drifted copy, not previously named in this doc alongside the
  two the Variant-artist-token-fusion entry already tracks**
  (`sanitizeSeriesTitle`'s `NOISE_PATTERNS` in `identityCore.js:171`, and
  `stripVariantNoise` in `imageSearchIdentity.js:528-529`)); and
  `PREMIUM_CREATORS` (`src/lib/premiumCreators.js`, 84 entries — grown
  from the "80" this doc's own Premium Creator Credits section states,
  itself minor doc/code drift — architecturally separate, display-only,
  does not gate anything, should NOT be folded into a gating-list
  consolidation). "neal passenger" resolved as a false lead — not a named
  case, no dedicated registry: it's two adjacent words from an unrelated
  `imageSearchIdentity.js:1541-1547` comment ("'joker'/'iconic' rode along
  as **passengers** on **'neal'**'s recovery, Batman #251 class") about
  the generic token `"neal"`, already covered by existing test coverage.
  **Scoping note, not yet actioned:** this doc's own prior text (line
  ~927-931, Variant-artist-token-fusion entry) already flagged "extend
  this list as new named-variant patterns emerge" / "flag for a future
  pass if either [drifted list] surfaces its own production miss" — Jeff
  Smith/Cory Walker are exactly that trigger, now on its third instance
  (after Q119's title-whitelist and Q128's year-tolerance consolidations).
  Adding the two missing names to `ARTIST_PATTERNS` alone would fix this
  one instance but leave `artistWords`/`sanitizeSeriesTitle`/
  `stripVariantNoise` independently stale again, per the established
  pattern — a real consolidation (mirroring Q119's) is the request here,
  not a fourth patch. Not yet scoped as a concrete diff or implemented.

  **Consolidation attempt (2026-08-07) — started, deliberately stopped
  before coding. The three "drifted copies" are not as structurally
  uniform as the first-pass audit characterized; a byte-identical
  mechanical merge is not actually mechanical.** Read all three in full
  before touching anything:
  - `identityCore.js:171`'s `NOISE_PATTERNS[0]` strips bare, individual
    FIRST names (neal, john, jim, todd, chris, joe, steve, barry, alan,
    kaare) alongside surnames — `ARTIST_PATTERNS` has NO first-name
    entries at all (deliberately — this doc's own Q131 note explains bare
    single words are collision-risk-swept one at a time, first names
    being far more collision-prone than distinctive surnames). Replacing
    this list with an `ARTIST_PATTERNS`-derived regex would silently
    **stop** stripping "neal," "john," "jim," etc. — a real behavior
    regression, and specifically the kind of gap the "neal passenger"
    comment thread (`imageSearchIdentity.js:1541-1547`, referenced above)
    is adjacent to.
  - `imageSearchIdentity.js:528-529`'s `stripVariantNoise` list has the
    inverse problem: "raymond gay" and "stanley lau" appear in it but
    exist **nowhere** in `ARTIST_PATTERNS` — not as multi-word entries,
    not even as bare surnames. These aren't drift from the canonical
    list; they're names the canonical list itself is missing. Discovered
    as a direct byproduct of attempting this consolidation, not
    previously known.
  - `compHygiene.js:756-777`'s `artistWords` Set (inside `tokenizeTitle`)
    IS confirmed genuinely stale relative to `ARTIST_PATTERNS`'s own
    single-word entries specifically (missing `frison`/`giang`/`eom`/
    `lozano` — re-verified directly against the live file this session,
    matching the original audit) — but attempting to auto-derive it from
    `ARTIST_PATTERNS.map(p => p.source)` risks a different class of bug:
    several patterns use regex constructs that don't reduce to clean
    words (`/dell'?otto/i`, `/windsor.?smith/i`) — the existing hand list
    already has an unexplained artifact from this exact ambiguity
    (`'dekal'`, which is not a substring of `dell'?otto` or any other
    entry — likely a stale/mistaken addition from a past manual edit, a
    small live example of exactly the risk a scripted derivation could
    reintroduce silently).

  **SHIPPED (2026-08-07), the narrowed two-commit split — approved as
  proposed, with `NOISE_PATTERNS[0]`'s bare-first-name stripping and
  `stripVariantNoise`'s exact regex shape deliberately left untouched
  pending the design decision above (not a mechanical question).**
  Commit 1 (`e05b040`): closed the confirmed frison/giang/eom/lozano gap
  in `artistWords` directly (mechanical — catching up to what
  `ARTIST_PATTERNS` already recognized, not new recognition) and added
  `tests/artist-registry-sync.test.js`, asserting every single-word
  `ARTIST_PATTERNS` entry is actually stripped by `tokenizeTitle` —
  47/47 passing, would have caught this exact gap. Commit 2 (`47cf1e0`):
  added Jeff Smith, Cory Walker (the two real Bone #1/Invincible #1
  gaps), and Raymond Gay / Stanley Lau (the reverse gap this
  investigation found — present in `stripVariantNoise`, absent from the
  canonical list it was assumed to mirror) to `ARTIST_PATTERNS` as
  multi-word-only entries, each individually collision-swept (no bare
  `smith`/`walker`/`gay`/`lau` fallback — all four too generic alone,
  same convention as `guillem march`/`brett booth`); their last names
  also added to `artistWords` in the same commit, so the addition works
  in the tokenizer immediately rather than leaving a second gap for
  commit 1's guard to eventually catch. Extended the same test file with
  per-name checks (pattern match + tokenizer strip) plus a negative check
  confirming Jeff Smith stays multi-word-only — 56/56 passing. Full build
  clean both commits; adjacent suites (`comp-filter-hygiene`,
  `image-search-extraction`, `family-clustering`,
  `q130`/`q131`/`q133`/`q136`-named artist tests) all match their
  documented pre-existing baselines — zero regressions. Both deployed
  (`dpl_7kgVfL5M7dz8gdsbsfNTqKr1QFCM`, READY, production).

  **Reverse direction, SHIPPED (2026-08-07, `818037c`, GrailKey Dispatch
  09).** Commit 1's guard only checked one direction (`ARTIST_PATTERNS` →
  `artistWords`). Promoted `NOISE_PATTERNS[0]` and `stripVariantNoise`'s
  two creator-name regexes to module-level exports
  (`LEGACY_CREATOR_NOISE_WORDS` in `identityCore.js`;
  `STRIP_VARIANT_NOISE_CREATOR_NAMES_1`/`_2` in `imageSearchIdentity.js`;
  `artistWords` itself promoted and renamed `ARTIST_SURNAME_WORDS` in
  `compHygiene.js`) — pure extraction, zero behavior change, verified via
  a full regression sweep. Three reverse checks added to
  `tests/artist-registry-sync.test.js`: (1) `stripVariantNoise`'s 12
  names against `ARTIST_PATTERNS` — all pass; (2)
  `LEGACY_CREATOR_NOISE_WORDS`' 27 bare words against
  `ARTIST_SURNAME_WORDS`, with two documented, permanent exception
  classes (13 bare first names — `neal, john, jack, steve, barry, jim,
  todd, frank, alan, chris, joe, kaare, alex` — `ARTIST_PATTERNS`
  deliberately never carries these; `windsor`, a compound-surname
  fragment, neither a first name nor independently a surname); (3)
  `ARTIST_SURNAME_WORDS` itself against `ARTIST_PATTERNS`' raw regex
  sources (word-boundary-safe — a naive `\bword\b` test against a raw
  `.source` string false-negatives right at the `\b` anchor's own literal
  "b" character, a real bug hit and fixed while building this).

  **Found 4 new, real, previously-unknown gaps via check (2) — fixed in
  the same commit:** John Romita, Alan Moore, Chris Claremont, Joe Jusko
  — all legitimate, major, well-known creators entirely absent from
  `ARTIST_PATTERNS`, identical shape to Raymond Gay/Stanley Lau, just
  surfaced by the test instead of a production incident. Added as
  multi-word-only entries (individually collision-swept — no bare
  `moore`/`claremont` fallback, both have real ambiguity; `romita`/`jusko`
  kept multi-word for consistency within the batch rather than mixing
  conventions) plus their surnames into `ARTIST_SURNAME_WORDS`.

  **Found a second unexplained artifact via check (3), left deliberately
  failing, same as `dekal`:** `'spears'` in `ARTIST_SURNAME_WORDS` traces
  to no `ARTIST_PATTERNS` entry either — origin unknown, not documented
  anywhere. Per the explicit instruction that produced check (3), neither
  `dekal` nor `spears` is exempted or silently fixed. The test currently
  reports 153/155 — those 2 failures are the point, not a bug in the
  test. If a future investigation explains either, add it with a reason;
  otherwise the evidence points toward removing both.

  **First-name split — investigated (Dispatch 09), NOT coded, per
  explicit instruction.** The proposal: `LEGACY_CREATOR_NOISE_WORDS`
  conflates two different jobs — bare first-name stripping (genuine
  title noise, no creator-recognition intent) and surname stripping
  (creator recognition, ARTIST_PATTERNS' actual job) — and should split
  so each list has one clear purpose. Checked empirically, not assumed:
  of the 27 words, 13 are bare first names (`neal`/`john`/`jack`/...,
  listed above) and 1 (`windsor`) is the compound-fragment edge case;
  the remaining 13 are surnames (`adams, romita, kirby, ditko, smith,
  lee, mcfarlane, miller, moore, claremont, jusko, andrews, ross`) —
  **every single one of which is now, post-Dispatch-09, already a member
  of `ARTIST_SURNAME_WORDS`** (confirmed via direct set-difference query,
  zero remainder). **The split is clean, and better than a rename: the
  surname half doesn't need its own list at all — it can just import
  `ARTIST_SURNAME_WORDS` directly**, leaving `identityCore.js` with only
  a small, genuinely-standalone `BARE_FIRST_NAME_TITLE_NOISE`-style list
  (13 entries + `windsor` as a documented edge case) that has zero
  overlap with the creator registry and never will by design. This would
  eliminate `LEGACY_CREATOR_NOISE_WORDS` as an independent list entirely
  rather than just renaming it — one fewer hand-maintained structure, not
  a relabeled one.
  **One real caveat, not resolved, requires a decision:** `ARTIST_SURNAME_WORDS`
  is 60 entries; the current surname-stripping behavior in
  `sanitizeSeriesTitle` only ever exercised the 13 that happened to be
  hand-copied into `LEGACY_CREATOR_NOISE_WORDS`. Switching to import
  `ARTIST_SURNAME_WORDS` wholesale would widen what `sanitizeSeriesTitle`
  strips from raw titles to all 60 (`kirkham`, `suayan`, `forstner`,
  `albuquerque`, etc.) — a real behavior change for this specific
  consumer, not yet vetted against real title data the way the original
  13-word list implicitly was by years of production use. Recommend: if
  this split is greenlit, treat the behavior-widening as its own
  reviewable decision (possibly a separate flag/step), not a silent
  side effect of the rename. Not coded.

  **Two further real, independently-verified findings from the same
  scan, not yet actioned (surfaced, not requested for investigation this
  round):**
  - **Mega-key protection defeated by a publisher mismatch.** Bone #1 is
    in the mega-keys table, but `passesIdentityGates`
    (`api/mega-keys.js:1081-1103`) hard-rejects on any publisher
    disagreement (`entryPub && userPub && userPub !== entryPub`, line
    1097) with no fuzzy tolerance — logged as `[mega-key-match] rejected —
    publisher mismatch`. `confirmedPublisher` had been set to "Bonnier
    Carlsen" (a Swedish publisher) via a ComicVine volume-match issue,
    defeating the strongest available protection against exactly this
    class of mispricing on the one book most in need of it.
  - **`[q27]` correctly detects, but doesn't gate the path that mattered.**
    The foreign-edition flag (`api/enrich.js:10130-10134`,
    `out.foreignEdition = true`, logged `[q27] foreign edition detected —
    pc_estimate blocked`) fired correctly and, per its own design, blocks
    the `pc_estimate` (PriceCharting single-point lookup) path only. It
    does not gate the PriceCharting sales-history scrape /
    `verifySoldComps` pipeline (Ship #20a) — the actual path that
    supplied the $1,619.99 US-first-print anchor. The system detected the
    mismatch and the detection had no reach into the pricing path that
    used it.
  - **GK-29 recurrence, untracked.** `gradeMult=0.55` was displayed but
    not applied — `$1,619.99 × 0.55 = $891`, not the shipped price. Both
    books (VG 4.0 and VF 8.0) received the identical price despite
    different grades. Referenced as "again" in the dispatch (implying a
    prior, undocumented occurrence) — not yet given its own root-cause
    investigation in this doc; flagged here so it isn't lost, not closed.

  **GK-34 + registry, CONFIRMED IN PRODUCTION (2026-08-07, GrailKey
  Dispatch 10) — third and fourth validated fixes of this effort.** Both
  Bone books re-scanned on live production traffic, not the unit
  harness:
  ```
  [tier-2] SOLD POOL TOO THIN TO OVERRIDE — treated as reference, active pool anchors price:
           sold pool n=1 below MIN_POOL_FOR_OVERRIDE=3 — shown as reference (I13),
           active pool (n=2) used as pricing anchor instead
  [price-bands] source=tier2_active_dominant_thin_sold market=$10.49
  ```
  $1,619.99 → $10.49 and $13.51, exact arithmetic ($12.34×0.85=$10.49,
  $15.89×0.85=$13.51), real market $10-25. Same scan's `[Q84]
  override-allowed reason=same title, nothing added` and
  `confirmedTitle="bone"` (not "bone jeff") confirms the registry fix
  independently — Jeff Smith recognized, no override needed at all this
  time since Q140 didn't even try to add the tokens.

  **Found in the same batch — a real I13 provenance bug in the NEW GK-34
  path, fixed same-day (`b2d16ed`).** `api/enrich.js`'s `tierSourceMap`
  (~line 7367, `#20b-FIX1`) translates `priceBands.js`'s internal
  `source` values into the label the card displays, defaulting unmapped
  sources to `'pc_estimate'`. `tier2_active_dominant_thin_sold` was
  missing from this map — confirmed live: `[price-bands] source=
  tier2_active_dominant_thin_sold` (correct) immediately followed by the
  card showing `pc_estimate` (wrong). Not merely cosmetic: this exact map
  already has two documented prior incidents of the identical shape
  (`Q109-DISPATCH-1-B`, `Q109-D`, both inline in this file) where a
  missing entry fell through to `'pc_estimate'`, which sits inside
  `VARIANT_MULT_ELIGIBLE_SOURCES` (~line 7629) — an unmapped,
  already-active-anchored, already-0.85-discounted price is eligible to
  get a variant/key multiplier re-applied on top, double-counting. Fixed
  by mapping to the same semantic sibling those two prior fixes used —
  `'active_ask_derived'` (matches `tier3_active_discounted`'s
  construction: active-pool anchor, ask-derived, already discounted).

  **Reclassified and closed permanently (2026-08-07, GrailKey Dispatch
  11, `1699c2e`) — this was called a display defect; it wasn't.**
  `pc_estimate` is the default for any unmapped source, and it sits
  inside `VARIANT_MULT_ELIGIBLE_SOURCES` (~`api/enrich.js:7629`) — so an
  already active-anchored, already-discounted price was eligible for a
  variant/key multiplier re-application on top, the exact double-count
  this map exists to prevent. Three incidents of the identical shape
  (`Q109-DISPATCH-1-B`, `Q109-D`, this one) is a design gap, not a
  pattern of missed entries — closed with a completeness check instead
  of hoping for a fourth catch: `PRICE_BANDS_SOURCES` (the exhaustive
  list of every `source` value `priceBands.js` can emit) and
  `TIER_SOURCE_MAP` both relocated to `src/lib/priceBands.js` (not left
  in `api/enrich.js`, which does not cleanly exit when imported in a
  bare Node/test context — same reason `cacheKeys.js` exists) so
  `tests/tier-source-map-completeness.test.js` can assert every source
  has an explicit map entry (12/12 passing). Also added a
  `console.error` diagnostic in the handler itself for the case this
  test can't cover — an unmapped source actually reaching production
  before the next test run catches it — so the gap is loud at runtime
  too, not just at test time. "No silent default," both statically and
  at runtime.

  **Wolverine #37 — worst card in the batch, traced.** Two numbers from
  one request: `[price-bands] source=tier4_pc_estimate market=$5.09`
  followed later by `[verify] ... recommended: $99.99`. Traced directly:
  `recommendedPrice` (`api/enrich.js` ~line 8957) reads `finalPriceNum =
  parseFloat(out.price)` — so `[verify]` showing $99.99 proves `out.price`
  was ALREADY $99.99 by the time that log line ran, not $5.09. Between
  the `[price-bands-pricing]` log (~line 7443, where `out.price` is first
  set to $5.09) and `[verify]` (~line 8967), two floor mechanisms run:
  `computeThinPoolAnchor` (Ship #13.1, a CAP — cannot raise a price, ruled
  out) and `computeLowGradeFloor` (Ship #17, ~line 8078 — a genuine
  raise: "when pop.belowGrade===0, override with `rawComps.lowest`").
  `computeLowGradeFloor` is the only mechanism in that window capable of
  moving a price UP from $5.09 to $99.99, and its own log format
  (`[low-grade-floor] anchored cur=$X → comp.lowest=$Y`) matches the
  dispatch's own description ("a floor fired at 99.99 after the fact")
  exactly. **The card shows $99.99, not $5.09** — `out.price` is the same
  field both `[verify]` and the client read; nothing after
  `computeLowGradeFloor` in this trace lowers it back down. **CONFIRMED
  (2026-08-07)** — the `[price-trace]` line from the actual request
  supplies the direct evidence this entry originally lacked:
  `rawFloor: 99.99 floor: 99.99 floorFired: true`. `computeLowGradeFloor`
  fired, and its anchor came from `rawComps.lowest` in a comp pool built
  on the corrupted query. Root chain: the Greg Capullo registry gap
  (below) corrupted the search query (`confirmedTitle="wolverine greg
  capullo"`), which — being the same query construction `api/comps.js`
  uses to build BOTH the sold-comp pool (25/30 titleMismatch-rejected)
  and the active `rawComps` pool the low-grade floor reads
  `rawComps.lowest` from — pulled in wrong-book active listings whose
  lowest price is $99.99, which the floor then (correctly, by its own
  logic, on contaminated input) trusted as the real market bottom. This
  specific instance is closed by the registry fix below (a corrected
  query no longer feeds the floor a contaminated pool). **The general
  class stays open as its own standing finding, separate from this
  instance:**

  - **Floor-on-contaminated-pool class (open).** `computeLowGradeFloor`
    (and, by the same reasoning, `computeThinPoolAnchor` — any mechanism
    that derives a price from `rawComps` rather than from
    identity-verified sold/active pools) trusts whatever `rawComps`
    contains with no independent check that the pool itself is
    correctly-identified. Registry gaps are ONE way to corrupt the query
    that builds `rawComps` — closing them one name at a time (this week's
    9 additions) reduces how often this fires but does not close the
    class, since ANY upstream identity corruption (a title-family
    misfire, a wrong-issue consensus, any of the other classes already
    documented in this Pattern Library) feeds the exact same floor
    mechanism with the exact same blind trust. Not yet scoped as a fix —
    recorded here so a future "why did the floor anchor to a wrong price"
    report is recognized as this class, not investigated from scratch.

  **Registry gaps 5, 6, 7 — SHIPPED (`cb49224`), same shape as 1-4, found
  by production scans instead of the reverse-direction sweep this time.**
  Greg Capullo (Wolverine #37 — corrupted `confirmedTitle`, the direct
  cause of the trace above) and Jason Latour + Robbi Rodriguez
  (Spider-Gwen — `confirmedTitle="spider gwen latour rodriguez"`, both
  co-creators missing at once). All three added to `ARTIST_PATTERNS` as
  multi-word-only entries (no bare fallback — Rodriguez is one of the
  most common US surnames, Latour has real ambiguity with wine/place
  names, Capullo is plausibly bare-fallback-safe under this file's own
  precedent for distinctive names but deliberately not swept to keep this
  batch's risk profile consistent with the rest) plus their surnames into
  `ARTIST_SURNAME_WORDS`. `tests/artist-registry-sync.test.js` extended
  with all three (163/165 passing — `dekal`/`spears` remain the only, and
  only intended, failures). Both commits deployed
  (`dpl_FtwvjUjjWW8pgiNBoAPm2FpCqhTu`, READY, production). This is now
  five production-incident-driven additions plus four found by the
  reverse-direction test itself in one week — the registry's real
  completeness gap is likely still wider than either discovery channel
  has surfaced alone.

  **Seeding `ARTIST_PATTERNS` from ComicVine `person_credits` —
  investigated (2026-08-07, GrailKey Dispatch 11), PLAN ONLY, not coded.**
  Nine additions in one week across two independent discovery channels
  (five production incidents, four from the reverse-direction test) is
  the strategic signal this dispatch called it: one-at-a-time addition
  will not converge. The proposal — reuse data already being fetched,
  the same move that closed the publisher question — checks out on
  direct inspection, not assumption:
  - `api/enrich.js:609` already requests `person_credits` in the
    ComicVine issue-search `field_list` (has for a while — this is not a
    new API call).
  - `api/enrich.js:1219-1224` already parses it into a clean
    `personCredits: [{name, role}, ...]` array per match.
  - `docs/WHAT_WE_HAVE.md:96-100` confirms this data is currently used
    for exactly one thing: display-only "Creators" text on the metadata
    endpoint. It is fetched, parsed, and then discarded for registry
    purposes on every single scan.

  **Proposed plan, two phases, neither built yet:**
  1. **Live detection (near-zero cost, no new API calls, no pricing/
     identity behavior change).** On every scan that already returns
     `personCredits`, check each credited name against
     `ARTIST_PATTERNS` (reusing the exact substring-match logic
     `tests/artist-registry-sync.test.js` already uses) and log a
     structured line — e.g. `[artist-registry-gap] name="X" role="Y" not
     in ARTIST_PATTERNS` — for anything unrecognized. Purely additive
     instrumentation, same shape as the `titleOk`-failure and
     `pool-ratio-warn` logging already shipped this week; zero risk to
     pricing or identity resolution.
  2. **Periodic batch review (reuses existing tooling, no new
     infrastructure).** Query accumulated `[artist-registry-gap]` lines
     via the same Vercel `get_runtime_logs` mechanism already used for
     the stale-threshold measurement above, producing a ranked list of
     real, production-observed creator gaps — reviewed and added to
     `ARTIST_PATTERNS` in a batch sweep, the same discipline already
     established this week (multi-word-only by default, individual
     collision sweep before any bare single-word fallback), rather than
     waiting for the next book to misfire.

  **Explicitly NOT proposed:** a one-time bulk harvest that calls
  ComicVine's API against a broad catalog swath to pre-populate the
  registry wholesale. That would need new tooling, raises API-quota
  questions (`COMICVINE_API_KEY` is presumably rate-limited, exact limits
  not confirmed), and would scan mostly-irrelevant books — Option 1
  above gets the same data for free, scoped to exactly the books real
  users actually scan, with zero additional ComicVine calls.

  **Open questions, not resolved by this investigation:** should ALL
  credited roles feed the check, or only cover/artist-relevant ones? The
  week's own evidence argues for ALL roles — Alan Moore and Chris
  Claremont are writers, not artists, and both bled into titles exactly
  the way Jeff Smith and Cory Walker did; role does not predict whether a
  name shows up in a seller's listing title. Should gap-detection ALSO
  apply the multi-word-vs-bare-fallback risk classification
  automatically (flag common-word surnames for mandatory human review,
  auto-suggest distinctive ones), or should every detected gap go through
  the same manual judgment call this week's 9 additions did? Leaning
  toward the latter — the `'dekal'`/`'spears'` artifacts are a caution
  against trusting any mechanical classification of "safe to auto-add"
  without a human step. Not coded; both phases require their own
  greenlight before implementation.

  **Build/version skew across a single log batch — flagged, not a code
  issue.** Four different deployment SHAs appeared across one scan
  window: `0b46a52`, `3f0ed98`, `6979b4f`, `6af0698`. The Wolverine and
  Marvel Feature scans specifically ran on `6979b4f` — pushed BEFORE
  GK-34/GK-21 (`2dbf651`) — meaning their pricing behavior reflects a
  pre-fix build, not a regression against the fixes documented above.
  This is expected, ordinary client/CDN cache staleness (a phone or
  browser tab that loaded the app before a newer deploy went out keeps
  hitting the old bundle's API calls until it's reloaded or the cache
  expires) — not a deployment pipeline defect. Recorded here as a
  standing caution for reading any future multi-scan batch: **check the
  `[boot] Comic Vault build <sha>` line on every individual scan before
  attributing its behavior to the current code** — a batch spanning
  several builds can contain both pre-fix and post-fix evidence at once,
  and conflating them misreads which is which.

- **Dormant-multiplier class (GrailKey Dispatch 12, 2026-08-07) —
  investigated, PLAN ONLY, no code, pricing-math greenlight held pending
  review of the projection below.** Every tier-engine pricing source
  (Tiers 1/2/2.5/3 — i.e. every price actually derived from verified
  sold/active comps) is excluded from the newsstand/variant multiplier,
  and mostly excluded from the key multiplier too, while Tier 4
  (`pc_estimate`, the LEAST-verified generic PriceCharting lookup) is the
  primary source that DOES get both. This is backwards from what you'd
  want — multipliers apply most readily to the least-trustworthy price,
  not the best-verified one.

  **Part 1 — every `pricingSource` whitelist in the repo, enumerated by
  direct grep, not assumed to be "the two" originally suspected:**
  1. `VARIANT_MULT_ELIGIBLE_SOURCES` (`api/enrich.js:~7616`) — Set of 4:
     `pricecharting`, `pc_estimate`, `verified_active`, `browse_api`.
     Gates `isFromPC`, which gates BOTH the newsstand/era/variant
     multiplier directly AND (via `isFromPC && blendedAvg`) the PRIMARY
     key-multiplier path.
  2. Key-mult fallback inline check (`~7998`):
     `out.pricingSource === 'verified_sold' || out.pricingSource ===
     'verified_active'` — the SECONDARY key-mult path used when
     `isFromPC` is false.
  3. `SOLD_DERIVED_SOURCES` (`~8179`) — Set of 5:
     `verified_sold_recency`, `verified_sold`, `sold_active_blend_30`,
     `verified_sold_active_blend`, `verified_sold_stale`. Gates the
     mega-key-floor contamination-detection basis — a different purpose
     (not multiplier eligibility), but the same whitelist-drift shape.
     Checked against `TIER_SOURCE_MAP`'s current sold-tier outputs:
     **currently correct and complete**, not itself a gap.
  4. Web-search trigger gate (`~9247-9248`):
     `out.pricingSource !== 'verified_sold' && out.pricingSource !==
     'pricecharting'` — unrelated to multipliers (gates the AI web-search
     fallback), noted for completeness of the grep, not in scope here.
  5. `hasPCData = out.pricingSource === "pricecharting"` (`~8851`) —
     gates match-confidence display tier, not a multiplier, not in scope.

  **Part 2 — cross-referencing every real `out.pricingSource` label
  against whitelists 1 and 2 (the actual multiplier gates):**

  | pricingSource label | Tier | Newsstand/variant mult (whitelist 1) | Key mult (whitelist 1 or 2) |
  |---|---|---|---|
  | `verified_sold_recency` | 1 | ✗ excluded | ✗ excluded (exact-string mismatch — check wants literal `'verified_sold'`) |
  | `sold_active_blend_30` | 2 blend | ✗ excluded | ✗ excluded |
  | `verified_sold` | 2 sold-only / sold-only-suspect | ✗ excluded | ✓ eligible (whitelist 2) |
  | `verified_sold_stale` | 2.5 | ✗ excluded | ✗ excluded |
  | `active_ask_derived` | 3 (all sub-variants) + GK-34 | ✗ excluded | ✗ excluded — **this is the label all 3 confirmed-affected books hit** |
  | `pc_estimate` | 4 | ✓ eligible | ✓ eligible (via `isFromPC && blendedAvg`, if PC price present) |
  | `active_reference_range`, `thin_pool_anchor`, `visual_pool_fallback`/`visual_pool_family_isolated`, `catalog_ladder_reference` | non-tier real pricing paths | ✗ excluded | ✗ excluded |
  | `ebay-polybag-active` | polybag | ✗ excluded (deliberately — Ship 6 explicitly skips key mult on polybag pricing; correct, not a gap) | ✗ excluded (deliberate) |
  | `web_search_fallback`, `ai_estimate` | AI-estimated fallback | ✗ excluded | ✗ excluded (defensible — compounding an AI estimate with a premium multiplier is a real risk, not obviously a bug) |
  | `verified_active` | — | referenced in both whitelists but **dead code** — not in `PRICE_BANDS_SOURCES`, never directly assigned anywhere in the handler; a stale reference, plausibly meant to represent what `active_ask_derived` now covers |

  **Part 3 — impact projection, real production data, table form.**
  Pulled directly from live Vercel runtime logs (`get_runtime_logs`),
  not estimated. 2 of the 3 named books fully confirmed end-to-end; the
  third confirmed as a real request with the same root shape but its
  pricing-tail log lines could not be retrieved within reasonable query
  effort (truncated before the `[key]`/`[price-bands]` lines across
  multiple attempts) — reported as partial, not padded into a number:

  | Book | Grade | Tier / mapped source | Current price | Multiplier(s) dormant | Would-be price | Δ |
  |---|---|---|---|---|---|---|
  | Batman: The Killing Joke #1 | FN 6.0 | `tier3_active_discounted` → `active_ask_derived` | $52.19 | key ×1.5 (major: "first printing, classic Brian Bolland cover, seminal Joker origin story") | $78.29 | +50.0% |
  | Amazing Spider-Man #222 | FN 6.0, newsstand | `tier3_active_discounted_over_fallback_sold` → `active_ask_derived` | $10.31 | newsstand ×1.3 (variant mult skipped via whitelist 1) | $13.40 | +30.0% |
  | Giant-Size Chillers #1 | — | `active_ask_derived` (confirmed via identity/title logs) | not retrieved | key ×1.5 per original report | not retrieved | — |

  **Important nuance on ASM #222, found directly in its logs, not
  assumed:** its key multiplier did NOT skip via the whitelist-gap
  mechanism this dispatch is about — `[key] keyIssue: null major: false
  minor: false mult: 1 isFromPC: false` shows `out.keyIssue` itself was
  never populated for this scan, so `keyMult` was `1.0` by construction;
  the multi-key comp-derived detection did find the signal
  (`[key-from-comps] consensus: first-appearance/1st App×5`) but that
  mechanism is **display-only** (Ship #12a, `CLAUDE.md` "Multi-key
  extraction from comps" — promotion to `keyIssue` is Ship #12b, gated
  behind its own separate greenlight, never granted). So ASM #222's
  newsstand-multiplier loss IS the whitelist-gap class; its key-multiplier
  loss is a different, already-documented, separately-gated limitation —
  conflating the two would misdiagnose the fix's actual scope.

  **Part 4 — over-correction check: inconclusive, not cleared.** Neither
  confirmed example strikes an obvious "too high" note on a plain-market
  read ($78.29 for a raw FN 6.0 Killing Joke #1 — a well-known,
  consistently $75-150-raw back issue — reads as a correction toward
  accuracy, not past it; $13.40 for a raw FN 6.0 ASM #222 newsstand with
  a minor first appearance is unremarkable). **This is a qualitative
  read, not a verified one** — the actual PC price-ladder rung values for
  the confirmed grade on each book were not pulled (ASM #222's own logs
  confirm a real 12-rung ladder exists — `[pc-sales] id=2315254 grades=8
  ... ladder=12` — but not its dollar values). Before this multiplier
  ships, the ladder-rung comparison the dispatch asked for needs the
  actual numbers, not an eyeball read — flagged as not yet done, not
  quietly assumed clear.

  **Part 5 — structural fix, proposed, NOT coded.** Same discipline just
  established for `TIER_SOURCE_MAP` itself: stop hardcoding independent
  literal whitelists that can silently exclude a new source by omission.
  Concretely: restructure `TIER_SOURCE_MAP`'s values from plain label
  strings to small records carrying explicit eligibility flags (e.g.
  `{ label, variantMultEligible, keyMultEligible }`), and derive
  `VARIANT_MULT_ELIGIBLE_SOURCES` / the key-mult check FROM that
  structure instead of maintaining them as separate hardcoded Sets. A new
  tier source then can't be added without an explicit eligibility
  decision at the same time it's named — the same "no silent default"
  shape that closed the `TIER_SOURCE_MAP` gap itself.

  **Reframed explicitly (2026-08-07, GrailKey Dispatch 13) — this is not
  "add missing labels to a whitelist," it's an inverted trust model.**
  Every tier-engine source (real, comp-verified prices) is currently
  LESS eligible for a key/newsstand premium than `pc_estimate` (the
  least-verified source). The default direction going forward: **yes for
  both**, per-source, unless a specific source has a reason to decline —
  a verified sold pool for a key issue already reflects real market
  demand for that key (the comps ARE the premium), and a newsstand
  premium is a scarcity signal the comp pool cannot see on its own (nothing
  in an active-listing price tells you it's the rarer distribution
  channel) and therefore still needs to be applied externally regardless
  of how well-verified the base price is.

  **Approved in principle (2026-08-07) — plan-only, still gated on the
  ladder check below, not on anything else.**

  **Part 6 — the ladder-rung check, done. Split verdict — the multiplier
  does NOT clear cleanly.** Pulled the real PriceCharting price guide for
  both books directly (their public price-guide pages, not estimated),
  matched to the exact grade (6.0 = Fine, matching both books'
  user-supplied "FN 6.0"):
  - **Amazing Spider-Man #222 (1981)**, PC product id=2315254 (the exact
    product the real production request anchored to): **FN 6.0 rung =
    $20.80.** Projected price with the newsstand ×1.3 multiplier: $13.40
    — comfortably BELOW the rung (35% under). No over-correction; the
    multiplier moves the price toward the ladder, not past it. **Clears.**
  - **Batman: The Killing Joke (1988)**, PC product id=2405125 — the
    genuine 1988 first-print entry. Note: this exact product was NEVER
    surfaced by the app's own PC search query for this book at all (its
    candidate list only ever returned the 2018 Absolute anniversary
    edition and 2026 reprints, all correctly rejected on year grounds) —
    a separate, real gap (the app's PC query construction misses this
    product entirely) flagged here but not investigated further, out of
    scope for this dispatch. **FN 6.0 rung = $47.43.** Projected price
    with the key ×1.5 multiplier: $78.29 — **65% ABOVE the rung**
    ($30.86 over). This is the over-correction the ladder check exists to
    catch. **Does not clear.**

  **Verdict, per the explicit decision rule this check was set up to
  answer: 1.5× needs recalibration before it ships to every key in the
  collection.** The newsstand ×1.3 multiplier clears on its one tested
  book; the key ×1.5 multiplier does not, on the one book where a real
  ladder comparison was possible. Structural fix (Part 5) stays
  plan-only — approved in principle, but the specific 1.5×/1.2× key-tier
  multiplier values themselves are now confirmed miscalibrated for at
  least this tier/book combination and must not ship as-is. Recalibrating
  those values is itself pricing math and needs its own dedicated pass
  (likely a lower multiplier, or a cap relative to the ladder rung when
  one is available) before the structural fix's eligibility change is
  implemented — implementing eligibility correctly and then immediately
  overshipping the multiplier value would just move the over-correction
  from "silently skipped" to "silently applied wrong."

  **Dead-code cleanup, SHIPPED (`b30d4e7`).** `'verified_active'`
  confirmed genuinely dead (not in `PRICE_BANDS_SOURCES`, never assigned
  to `out.pricingSource` anywhere) and removed from both multiplier
  whitelists plus `TIER_SOURCE_MAP`'s own legacy pass-through. Two more
  independent references found in the same sweep, deliberately left
  untouched (different mechanisms, not multiplier eligibility, out of
  this fix's scope): `src/lib/responseContract.js`'s `ESTIMATED_SOURCES`
  Set + an inline `===` check, and `src/lib/dataQualityGuard.js`'s
  `PRICE_RANK` ordering table. `src/App.jsx`'s display label for this
  value was also deliberately left alone — legitimate backward-compat
  rendering for old catalogue items that may still carry this value in
  IndexedDB from before it went dead in the live pipeline, a display
  concern rather than a pricing gate.

  **Giant-Size Chillers — stays partial, no further effort spent**, per
  explicit instruction. Two confirmed books (one clearing, one not) was
  enough to answer the gating question.

  **Part 7 — SPLIT (2026-08-07, GrailKey Dispatch 14). Newsstand
  greenlit and SHIPPED (`3d5ec78`); key held.** The two
  multipliers had two different verdicts (newsstand clears, key doesn't)
  and were de-coupled rather than shipped or held together. Implemented
  in `api/enrich.js`: a new `isNewsstandMultEligible` flag
  (`NEWSSTAND_MULT_TIER_SOURCES` — the 5 tier-engine labels:
  `verified_sold_recency`, `sold_active_blend_30`, `verified_sold`,
  `verified_sold_stale`, `active_ask_derived`), checked independently of
  `isFromPC`. The outer variant-multiplier gate now reads
  `isFromPC || isNewsstandMultEligible`; internally, the era-aware
  newsstand branch runs under that OR, while the numbered/limited-run
  block and the entire flat `variantMultipliers` table (35¢/30¢, gold,
  triple/double cover, canadian, whitman, virgin, exclusive, etc.) were
  wrapped in an explicit `if (isFromPC)` so they stay on the original,
  narrower, untouched eligibility — none of those were ladder-tested this
  round. `isFromPC` itself, and everything it gates for the key
  multiplier (`isFromPC && blendedAvg` at the key-mult's primary path),
  is completely unmodified — key stays held by construction, not by
  convention. No dedicated unit test added (matches established practice
  for this exact inline handler logic — the two prior fixes to this same
  area, Q109-DISPATCH-1-B and Q109-D, also shipped on production-log
  verification rather than a unit harness, since the handler doesn't
  cleanly import into a bare test context); verify on the next real
  1985-1995 newsstand scan.

  **Part 8 — double-count hypothesis: investigated, hypothesis
  correction found, genuine test still open.** The proposed test
  ("compare $52.19, sold-derived, against the $47.43 rung") rests on a
  factual error worth catching before it shapes the recalibration:
  **Killing Joke's $52.19 is NOT sold-derived.** Its own production log
  states `[Q52-investigate] Batman: The Killing Joke #1: zero sold rows
  from PriceCharting` — zero sold comps existed for this request at all;
  `$52.19` came from `tier3_active_discounted` (7 active/ask comps ×0.85),
  the SAME `active_ask_derived` label the whole dormant-multiplier
  finding is about, not a sold-tier price. The evidence offered doesn't
  test "do sold comps already price in the key premium" — there's no
  sold data in this example to test that claim with. What it DOES
  support, more narrowly: active ASK prices for a widely-recognized key
  may already reflect elevated demand (sellers who know what they're
  listing price accordingly) — a real, plausible, but different and
  narrower finding than the one proposed.
  A genuine test of the original hypothesis needs a book that (a)
  actually has `out.keyIssue` populated (rare — established earlier this
  same dispatch that 10/10 scans in a 6h production sample had
  `keyIssue: null`) AND (b) priced via a genuinely sold-derived tier
  (1, 2, or 2.5 — `verified_sold_recency`/`verified_sold`/
  `sold_active_blend_30`/`verified_sold_stale`), so a real sold-average
  can be compared against the ladder rung directly. Neither confirmed
  example from Part 3 satisfies both conditions (Killing Joke: no
  keyIssue path relevant here since it's active-derived; ASM #222: real
  sold data existed — 27 verified comps, sold avg $7.77 — but no
  `keyIssue` was ever populated for it either, and its sold avg sits
  63% BELOW its own $20.80 ladder rung, which if anything argues against
  "sold data converges to ladder value" as a general rule, independent
  of the key question). **Not resolved — flagged as needing a genuinely
  matching example, not answered by the data in hand.** The theoretical
  case for excluding key-mult from truly sold-derived sources remains
  plausible on its own economic logic (a completed transaction for a
  recognized key already reflects whatever premium buyers paid), but
  that logic hasn't yet been tested against real matching data — treat
  it as a hypothesis worth keeping, not yet as a confirmed answer.

  **Part 9 — PC-product-discovery gap, elevated to its own standing
  finding.** Killing Joke's genuine 1988 first-print PriceCharting
  product (id=2405125, `https://www.pricecharting.com/game/2405125`) —
  the exact product whose ladder just settled the key-multiplier
  question — was **never returned as a candidate by the app's own PC
  search query** for this book at all. The real production log's
  `[pc-candidate]` list for this request contained only "Absolute
  Batman: The Killing Joke [30th Anniversary] #1 (2018)" and three 2026
  reprint/foil/blank entries — all correctly rejected on year grounds —
  never the plain 1988 base entry, despite it demonstrably existing on
  PriceCharting (found directly via their site search, 31 total results
  for "Batman The Killing Joke", of which the genuine 1988 entry is one).
  This means: **the ladder that just decided this dispatch's outcome was
  never available to the pricing engine itself** — Killing Joke priced
  via Tier 3 active-only specifically BECAUSE its own PC query never
  found a usable anchor, the same structural shape as the anchor
  rejection already visible in this exact request's own log
  (`[pc-anchor-gate] rejecting PC match ... no PC anchor for this book's
  actual edition`), just one layer further upstream — not a rejection of
  a found-but-wrong candidate, an outright miss of the right one. Root
  cause not yet investigated (query construction, PriceCharting's own
  search ranking for this specific product, or something else) — logged
  here as its own finding per explicit instruction, not folded into the
  ladder-check note it was originally attached to.

  **dekal/spears — unchanged, still the only two deliberately-failing
  entries in the registry sync test**, per explicit instruction (no
  action needed; recorded here only to confirm the standing state wasn't
  touched by this dispatch).

- **GrailKey Dispatch 15 (2026-08-07) — six identity/pricing fixes, three
  shipped, three designed-not-coded, plus a cover-matcher investigation.**
  ~14 production scans this dispatch, all production-observed evidence.

  **Fix 1 SHIPPED (`2c11377`) — `extractConsensus`'s `titleOk` bar lowered
  0.30 → 0.15** (`src/lib/imageSearchIdentity.js`). Two confirmed live
  misses at the old bar (Wha...!? #1 5/20=0.25, Power Rangers #1
  4/20=0.20) — both indie titles whose pools legitimately can't reach 30%
  title-string agreement, which silently disabled the downstream
  vision-zero-support OVERRIDE/ESCALATE check exactly on the thin/
  scattered pools most likely to need it. Issue consensus keeps its own
  separate 50% bar untouched — lowering titleOk alone cannot adopt a
  wrong issue on an incoherent pool, it only stops discarding the
  zero-support signal outright. Verified against the full
  extractConsensus-touching regression battery (9 suites); one real,
  understood side effect found and handled: two Adventure Time SS #1
  assertions (`tests/q141b-shared-issue-extractor.test.js`,
  `tests/q141c-marketplace-category-rejection.test.js`) were pinned to
  the old null return and flipped to a real (safe, `noIssueConsensus`)
  object — confirmed inert in production because
  `familyAuthoritySkip` (`identityCore.js` ~2170) already resolves that
  exact book via family-scoped consensus before the raw-pool check this
  object feeds ever runs. Both pre-existing documented-baseline failure
  counts (image-search-extraction: 2, q-adv397-visual-guard: 5)
  unchanged.

  **Fix 2 SHIPPED (`368f4d0`) — vision-zero-support ratio floor, not
  exact zero.** `visionIssueCount === 0` was an equality test. Real case
  (Jetsons, Dispatch 05 item 2): Vision's "#10" had 1/19 = 5.3% raw-pool
  support — not literally zero — so the escalation never fired and the
  book shipped under the wrong issue (#10 instead of the correct #32,
  market $9.95–$16.00). New shared `isIssueZeroSupport(count, total)`
  helper (`identityCore.js`, `ISSUE_ZERO_SUPPORT_RATIO_FLOOR = 0.10`)
  replaces the equality check at both call sites — `resolveIdentity`'s
  OVERRIDE/ESCALATE gate and `extractConsensus`'s
  `zeroSupportNoAdoption` carve-out — one source of truth instead of two
  independently-maintained checks. Scoped to the issue axis only, per
  explicit dispatch scope: the sibling `visionPublisherCount` check and
  `resolveFamilyIssueConsensus`'s own pure aggregate-vote adoption logic
  (the Flash #139 standing constraint) are untouched. Verified against
  18 suites / ~1,100 assertions, zero new failures.

  **Fix 3 SHIPPED (`184675a`) — registry additions.** Greg Land
  (`ARTIST_PATTERNS`, `compHygiene.js`) — Wolverine #10 scan corrupted
  `confirmedTitle` to "wolverine greg land," rejecting 26/27 genuine
  sold comps; a real eBay search for the correct book returns 5+
  listings ($4.99–$19.99, median ~$13.85) vs. the 1 GrailKey found priced
  at $9.99. Multi-word ONLY, no bare `/land/i` — deliberately also NOT
  added to `ARTIST_SURNAME_WORDS` (the `tokenizeTitle` strip-list),
  unlike this batch's precedent (Capullo/Latour/Rodriguez/etc. all got a
  surname-list entry) — "land" as a standalone token appears in real
  comic titles ("No Man's Land"), a materially higher collision risk for
  a strip-list than a surname like Moore/Walker; the reverse-sync test
  only requires single-word `ARTIST_PATTERNS` entries to have a surname
  counterpart, so this is not a test gap. Bruce Hershenson
  (`KNOWN_PUBLISHER_IMPRINT_EVENT_PHRASES`, `imageSearchIdentity.js`) —
  Wha...!? #1's `confirmedTitle` corrupted to "wha hero hershenson,"
  every comp query zero-matched; not a publisher/imprint/event in the
  strict sense this list is named for, reused anyway rather than forking
  a fifth near-identical list for one entry.

  **Fix 4 DESIGNED, NOT CODED — issue adoption bar for the zero-support
  override.** Real case: Spawn #350 (Vision) → pool consensus adopted
  #369 at 9/17=53% winner share, reported `[22c] convergence=90
  tier=HIGH`. Real answer: #360D (Brett Booth 1:50 virgin variant),
  which never appeared in the pool at all — a cover-image-only variant
  with no masthead text a title-based reverse-image search can surface.
  Two distinct, independently-confirmed root causes:
  1. The OVERRIDE branch (`identityCore.js` ~2194) adopts `ebay.issue`
     whenever non-null, and `ebay.issue` is set by `extractConsensus`'s
     plain `issueOk >= 0.5` bar (`imageSearchIdentity.js`,
     `agreement.issue = issueResult.count`) — a 53% winner over a close
     runner-up is treated identically to a 95% landslide. No
     margin-over-runner-up signal exists anywhere in this path today.
  2. `[22c]` convergence (`src/lib/convergenceScore.js`,
     `computeConvergenceScore`/`applyIdentityConflictDemotion`) is a
     genuinely separate, uncoordinated scoring mechanism from
     vision-zero-support's own `matchConfidenceDemote`/`visionZeroSupport`
     flags — those are consumed only by the `finalMc` match-confidence
     cap at `api/enrich.js:8663`, computed hundreds of lines AFTER `[22c]`
     runs (`api/enrich.js:3759-3803`). `applyIdentityConflictDemotion`'s
     only existing input is `familyDecision==='refused-identity-conflict'`
     — it has never been told "this axis's value came from an
     unsupported-claim override," so a confidently-reported HIGH tier can
     sit directly on top of an override the system itself flagged as
     uncertain.

  Proposed design (not implemented): (a) extend `extractConsensus`'s
  issue tally with a runner-up count (new sibling to `getMostCommon`,
  e.g. `getTopTwo`), exposed as `agreement.issueRunnerUpCount` — a pure
  aggregate count, no rank-weighting, Flash #139-constraint-compliant.
  (b) In the OVERRIDE branch specifically (not the general `issueOk`
  report used elsewhere), require `issueWinnerRatio >= 0.75 AND
  (issueWinnerRatio - issueRunnerUpRatio) >= <margin, candidate 0.20>`
  before adopting; below that bar (including the current 50–74% adoption
  band), fall through to the ESCALATE branch (`confirmedIssue = null`,
  `ID_REQUIRED`) instead of silently adopting a bare-majority winner —
  strictly more conservative, per the standing "conservative direction
  preferred when uncertain" rule. (c) Thread `visionZeroSupport`/
  `matchConfidenceDemote` into `applyIdentityConflictDemotion` as a
  second demotion input alongside the existing family-conflict cap, so
  an override/escalate always caps convergence to LOW/≤69 directly
  rather than relying on the axis-disagreement side effect that
  currently only sometimes drags the score down. Open before landing:
  confirm the exact adoption-margin number against real captured pools
  (same discipline as Fix 2's ratio floor and Dispatch 14's ladder
  check, not guessed blind); confirm scope stays confined to this
  OVERRIDE branch, never touching `resolveFamilyIssueConsensus`'s own
  adoption bar.

  **Margin validation attempt (2026-08-07, GrailKey Dispatch 16) — one
  anchor confirmed, one anchor confirmed VACUOUS, still NOT CODED.**
  Pulled both cited anchors directly from live Vercel production runtime
  logs, not re-derived from the dispatch's own summary:
  - **Spawn #369 (2026-08-07 04:51:10 UTC, `/api/enrich`) — must-fail
    case, confirmed as specced.** `[visual] consensus: issue=369 (9/17)
    visionIssueCount=0`, `[vision-zero-support] OVERRIDE: Vision
    issue="350" has 0/17 pool support — adopting pool #369`, `[22c]
    convergence=90 tier=HIGH`. Raw-pool winner share is 9/17=52.9% (just
    clears the existing `issueOk >= 0.5` bar); the family-scoped
    consensus separately reports `ratio=0.75 uniqueRows=8 runnerUp=366`
    — a different, stricter computation over deduplicated rows, not the
    number the OVERRIDE branch actually reads. Under the proposed design
    (`>=0.75` winner AND `>=0.20` margin over runner-up, both computed on
    the SAME basis the OVERRIDE branch consumes), this adoption would
    correctly fail to clear and fall through to ESCALATE — confirms the
    bug is real and the proposed gate closes it on the exact case that
    motivated it.
  - **Tomb of Dracula #17 (2026-08-07 04:23:00 UTC, `/api/enrich`) —
    confirmed VACUOUS, does not test this branch at all.** `[visual]
    consensus: issue=17 (20/20) visionIssueCount=20`, `[vision-zero-
    support] SKIPPED reason=winning-family-authority mode=corroborated
    issue=17 population=8 support=8 ratio=1.00 rawPoolVisionSupport=20`.
    Vision's own issue had full raw-pool support, so `familyAuthoritySkip`
    exempted this scan from the zero-support check entirely — the
    OVERRIDE branch this fix targets never ran. This anchor can confirm
    Fix 4 doesn't regress a clean-agreement scan, but cannot validate the
    margin gate's pass side, since the gate it would sit inside never
    engaged.
  - **Searched for a natural third anchor, found none.** Queried
    production logs for every `[vision-zero-support] OVERRIDE` firing
    over the trailing 3 days (`get_runtime_logs`, full-text + grouped
    count) — exactly 1 result, the Spawn #369 scan above. No production
    scan in this window shows the shape Fix 4's "must pass" side needs:
    Vision issue with near-zero pool support, where the ADOPTED pool
    consensus itself is a landslide (candidate: `>=0.90` with a clear
    runner-up gap). **Fix 4 stays DESIGNED, NOT CODED — blocked on a
    genuine must-pass anchor, not on the margin number itself.** Coding
    against only a must-fail example risks tuning the gate to reject
    everything rather than to discriminate; a landslide OVERRIDE case
    needs to actually pass once one is captured, either from a future
    production scan or (if the wait is unacceptable) a synthetic pool
    constructed and explicitly flagged as synthetic rather than presented
    as production-validated.

  **Fix 5 DESIGNED, NOT CODED, RE-SCOPED — pool overriding a "not a
  comic" verdict.** Investigation found the dispatch's literal framing
  doesn't match current code: `assetTypeConfident`
  (`api/enrich.js:2402-2420`, `:7328-7334`) has been advisory-only since
  Q110 — it sets `listingHardLocked` (List button gated) but does NOT
  block title/issue extraction, the eBay visual-pool search, or pricing;
  all of those already run unconditionally regardless of this flag. The
  real damage the dispatch describes (Vision returns no issue at all)
  is a Vision-output-shape problem upstream of this gate, not something
  the gate itself causes. Re-scoped design: reuse the EXISTING Q32
  category-vote machinery (`inferAssetTypeFromCategories`,
  `imageSearchIdentity.js:428-467`, wired at `api/enrich.js:3428-3445`)
  that today only detects merchandise contamination (`merchandiseRatio
  >= 0.5` → hard `DO_NOT_LIST` block) — extend it to also tally
  comic-category votes, and when `!assetTypeConfident` but the pool
  independently shows strong, title-coherent comic-category agreement
  (candidate bar: `>=5` comic-category listings, `>=60%` ratio, plus
  reusing `extractConsensus`'s own title-coherence check on the same
  pool so a scattered pool of unrelated comic-category junk can't force
  an override), flip the advisory lock off before it fires. Must be
  strictly additive to the Q32 merchandise hard-block, never able to
  override it. Open before landing: one real captured Vision JSON
  response for a genuine "not a comic" virgin-variant misread, to
  confirm whether `issue` comes back null vs. a stale wrong value
  (determines whether this is a display/lock-only fix or also needs to
  feed a corrected issue back into `resolveIdentity` — though the
  now-shipped Fixes 1–2 already improve that path independently);
  threshold numbers are placeholders pending real-pool validation.

  **Fix 6 DESIGNED, NOT CODED — pool year hint feeding `resolveYear`.**
  Confirmed real and currently narrow: `poolYearHint`
  (`api/enrich.js:2659-2678`, >=3 pool items / >=50% agreement) is
  computed early but today feeds ONLY ComicVine volume-disambiguation
  scoring and two narrow conflict-detection checks — never `resolveYear`
  itself (`identityCore.js:2787`), whose 4th argument (`ebayYear`) is
  bound to the separate, stricter `ebayYearAuthoritative` (>=10 items,
  >=8 agreeing). Proposed design: thread `poolYearHint` into `resolveYear`
  via a new branch inserted between existing branch (a) (`ebayYear`,
  kept top-priority — already vetted at a stronger bar) and branch (b)
  (pc+cv agreement), firing ONLY when there is no Vision/user year at
  all (`!visionYear && !userYear`) and `poolYearHint.agreement >= 0.80`
  — deliberately narrower than the raw 50%-bar computation, applied only
  at this consumption point so the two existing looser-bar consumers are
  untouched. This targets exactly the documented gap in the "Year
  override guard" section above (branch (e)'s "no year at all" hole) and
  never overrides an actual Vision-asserted year, unlike Fix 4's
  issue-override territory. New `yearSource = 'pool-year-hint'` needs an
  explicit `PROVEN_SOURCES` classification decision (candidate:
  `'unproven'`, same tier as `vision-fallback` — a raw title-text tally
  is a weaker source than the independently-verified sources that
  currently earn `'proven'`). **Found a real inconsistency in the
  dispatch's own evidence, not silently resolved either way:** the
  dispatch cites two production instances — "year=2019 agreement=80%
  (4/5)" and "year=2024 support=3/4" — but 3/4 is 75%, not >=80% as the
  dispatch's own proposed bar states. Either the bar needs to be >=75%
  to cover both cited cases, or the second case is expected to still
  fail and escalate under an 80% bar. Needs an explicit decision before
  coding, not a guess.

  **RESOLVED (2026-08-07, GrailKey Dispatch 16) — bar set to >=0.75, not
  >=0.80. Still DESIGNED, NOT CODED.** Both cited production instances
  (year=2019 at 4/5=80%, year=2024 at 3/4=75%) were confirmed correct
  identifications — an 80% bar would silently exclude the second, correct
  case to hit a round number, and this branch only fires when there is no
  Vision year at all, so the alternative for that case is the book
  blocking entirely rather than resolving. `yearSource = 'pool-year-hint'`
  confirmed classified `'unproven'` (same tier as `vision-fallback`) — a
  raw title-text tally is weaker than the independently-verified sources
  that earn `'proven'`. Still not coded — this closes the bar-selection
  question only; implementation is unstarted.

  **Cover-matcher investigation — PLAN ONLY, no code, per explicit
  scope.** Six virgin/sketch variant scans this dispatch, zero correct
  identifications (three scans of the same book alone returned #351,
  #293, #369 — correct answer #360D). Researched, not assumed:
  - **GCD (comics.org) API** — public JSON endpoints, no auth challenge.
    Variant linkage exists as data (`variant_of_id`, `is_variant` fields
    on the issue model) — i.e. variant covers ARE distinct records,
    filterable by series/year via the series walk. Data/metadata is
    CC-BY-SA (commercial use with attribution permitted). Two real
    caveats worth flagging before building on this: (1) GCD explicitly
    prohibits bulk image distribution and aggressive scraping — cover
    images are hosted under fair-use for on-site identification, a
    materially different (and murkier, for a commercial third-party app)
    legal footing than the CC-BY-SA metadata; a production integration
    needs its own light-touch usage review, not an assumption that the
    data license covers the images too. (2) The app guidelines page
    (`docs.comics.org/wiki/App_Guidelines`) returned HTTP 403 on a
    direct fetch during this investigation — confirm current terms
    directly before integrating, this doc is relaying search-result
    summaries, not a verified primary read. Community guidance (not
    official docs) suggests conservative concurrency (~8 parallel issue
    fetches, 200ms/series-page and 50ms/issue-fetch delays) to stay
    within polite-use norms on the community-run server.
  - **ComicVine's `image` field** — per existing public documentation
    and community reports, models one primary image per issue record;
    variant covers are inconsistently catalogued (sometimes as separate
    issue objects with a lettered issue_number suffix, often not at
    all) — not a reliable variant-cover source on its own, consistent
    with this codebase's own existing experience (`deriveCvYear`,
    `comicVine.volume` shape bugs elsewhere in this doc already
    established ComicVine's data as inconsistent in adjacent ways).
  - **Narrowing — confirmed already possible without new extraction
    code.** The dispatch worried Booth's variant/artist tokens are
    invisible at the point an issue would resolve, since
    `tokenizeTitleFamily` (`imageSearchIdentity.js:920`) strips
    `ARTIST_PATTERNS` matches (including `/brett booth/i`, already
    registered) from the family-clustering title key — by design, the
    Black Cat/Skottie Young class protection. Confirmed this does NOT
    lose the data: `extractVariantTokens(rawTitle)` is computed and
    stored per-row independently (`imageSearchIdentity.js:407`,
    `row.variantTokens`), untouched by the family-title stripping. A
    cover-matcher candidate-narrowing step can reuse
    `row.variantTokens`/`extractArtist` directly to scope a candidate
    set to series + artist + year, without touching the existing
    stripping behavior that a different, load-bearing fix depends on.
  - **Image hashing** — `jimp` (`^0.22.12`) is already a dependency,
    currently used only for resize/JPEG-quality reduction before the
    Vision API call (`api/grade.js:413-428`), not for any hashing today.
    Jimp's own API includes a perceptual-hash method and a
    hash-distance comparator, which would need a small spike to confirm
    behavior/accuracy on real comic cover photos (cover art has very
    different structure than the photography Jimp's hash is typically
    validated against) before relying on it — not yet spiked.
  - **Failure mode, per explicit instruction:** strict threshold,
    `ID_REQUIRED` below it, never a guess. A cover-matcher would be a
    NEW identity authority requiring an explicit rank in the existing
    authority matrix (`decideFieldAuthority`, `identityCore.js:1444`) —
    not scoped further than that here; where it ranks relative to
    Vision/eBay-consensus/family-clustering is a design decision for
    when this moves from investigation to a real proposal.
  - **GCD terms verification attempt (2026-08-07, GrailKey Dispatch 16)
    — BLOCKED, primary source unreachable, gate stays closed.** Per
    explicit instruction, attempted to read GCD's terms directly rather
    than relay the search-summary caveat a second time. Every path tried
    failed:
    - `docs.comics.org/wiki/App_Guidelines` — HTTP 403 (repeat of the
      original finding, re-confirmed).
    - `docs.comics.org/wiki/API_Terms` — HTTP 403.
    - `www.comics.org/about/` — HTTP 403.
    - `www.comics.org/` (bare root) — HTTP 403. This confirms the block
      is domain-wide (both `docs.` and `www.` subdomains, including the
      bare root), not a permissions issue on one specific page — reads as
      a bot/WAF block on this fetch tool generically, not a
      terms-specific restriction.
    - A web.archive.org mirror of the App_Guidelines page — refused
      outright at the tool level ("unable to fetch from web.archive.org"),
      not a site-specific 403.
    - `github.com/GrandComicsDatabase/gcd-django` (the Django application
      repo) — reachable, but its GPL-3.0 license badge covers the
      **application code**, not comics.org's site content, images, or
      API data; conflating the two would be a real category error, not a
      substitute answer. No terms-of-use text present in the visible
      README/LICENSE excerpt.
    - `github.com/GrandComicsDatabase/gcd-django/wiki/API` (GitHub-hosted
      wiki, reachable) — contains only a rate-limit note ("accessible for
      anonymous users with some limits... larger limits" for logged-in
      users, no numbers given); zero licensing or image-usage terms.
    **Conclusion, stated plainly rather than re-summarized from search
    results: no path available to this session can reach GCD's actual
    terms.** The image-licensing question this gates — whether cover
    images fall under the same CC-BY-SA the metadata carries, or under a
    narrower fair-use-for-identification basis as the original
    search-summary suggested — remains unverified from a primary source.
    Cover-matcher stays blocked on this exactly as before; the entire
    feature is gated pending terms obtained through a different channel
    (a logged-in browser session, a direct GCD contact, or equivalent).
  - **GCD terms obtained via external channel (2026-08-07, GrailKey
    Dispatch 17) — supersedes the "BLOCKED" finding above.** Obtained and
    read directly by the user (not this session's fetch tool, which
    remained blocked) — GCD App Guidelines page (`docs.comics.org` wiki),
    last edited 2022-01-02. **Evidence-quality caveat, stated explicitly
    rather than glossed over:** only one sentence was passed through as
    an exact quote; the three findings below are the user's own summary
    of the page, not a second verbatim transcript. Recorded as such —
    the one verbatim sentence quoted, the rest marked reported —
    consistent with this file's own standing discipline elsewhere
    (confirm via direct evidence, don't present a paraphrase as a
    primary read). A true verbatim archive of the full page is still
    outstanding; add it here if it becomes available.

    **Verbatim quote:** "We don't offer access to our data via an API,
    only as a database dump download."

    **Reported findings (paraphrase, not verbatim):**
    1. **No API exists.** Confirmed by the quote above. Intended
       consumption pattern per GCD: download the database dump, import
       it into your own store, build your own query layer against it,
       refresh periodically.
    2. **Images ARE permitted under fair use for identification**, with
       a named compliant pattern GCD points integrators to (the CBI case
       study): check local cache → check back-end cache → fetch the
       single image on demand → archive it permanently. This is a
       narrower basis than the CC-BY-SA metadata license, and a
       materially different *pattern* than bulk retrieval.
    3. **CC-BY-SA attribution is a hard requirement** on the metadata:
       visible credit to Grand Comics Database plus a link back to the
       specific source page, on any UI surfacing their data. ShareAlike's
       interaction with a commercial pricing product is a separate
       question from attribution and is NOT resolved by this finding.

    **Re-scoped plan, PLAN ONLY, no code — three changes from the
    original Dispatch 15 sketch:**
    1. **No live API → local dump import, not a live-query integration.**
       The original sketch ("GCD API — public JSON endpoints") was
       wrong; there is no API to call at request time. This means: (a)
       download and import GCD's DB dump into a store this project
       controls, (b) build a query layer over that import, (c) refresh
       on some cadence (release frequency not established — open
       question). This is a genuinely different category of work than
       "call an endpoint" — it's a new data-ingestion pipeline plus
       wherever it lives long-term. Concretely against this codebase:
       the Stack section states "no server database," but production
       logs show an active `[kv-cache]` layer already caching ComicVine/
       PriceCharting/eBay lookups in production right now (`SET`/`MISS`
       lines on nearly every `/api/enrich` request) — meaning some
       server-side KV already exists and is provisioned, contradicting
       the "Future: Vercel KV for cross-instance rate limit persistence"
       framing as not-yet-done elsewhere in this doc (flagged here as a
       doc/reality drift worth reconciling separately, not fixed in this
       pass). That existing KV is a plain key-value store, not a
       relational one — adequate for flattening the dump into precomputed
       lookup keys (e.g. `gcd:covers:<series>:<issue>` populated once at
       import time), NOT adequate for arbitrary relational queries
       (fuzzy series matching, joins across variant/series/publisher
       tables) the way the raw dump itself supports. Two real options,
       neither scoped further than naming them: (i) flatten the dump to
       the specific lookup shapes this feature needs and load those into
       the existing KV — smaller lift, less flexible; (ii) provision a
       real relational store for the dump via the Vercel Marketplace
       (Neon Postgres is the natural fit per current Vercel offerings)
       — bigger lift, keeps the dump queryable on its own terms. This
       decision needs its own scoping pass, not a default pick here.
    2. **Bulk-hash spike → per-lookup fetch with permanent archival.**
       The original idea ("pull a series' variant covers to hash") is
       exactly the bulk-retrieval pattern GCD's terms don't cover —
       re-scoped to the CBI pattern instead: at scan time, narrow to a
       small candidate set using data already available locally (the
       dump-derived series/issue/variant match, refined by
       `row.variantTokens`/`extractArtist`, both already confirmed
       reusable per the Narrowing finding above), THEN fetch only those
       specific candidate images one at a time, checking local cache and
       back-end cache first, archiving each fetched image permanently
       once retrieved.

       **Vercel Blob question, sharpened (2026-08-07, GrailKey Dispatch
       18) — explicitly unresolved, do not assume equivalence.** The
       CBI pattern GCD points to describes caching to your OWN back-end
       — an internal application cache, not visible to the outside world
       as a re-served copy. Vercel Blob, even on private access, is a
       distinct third-party cloud storage/CDN product with its own
       delivery infrastructure — storing an archived GCD image there is
       plausibly a materially different act than an in-process or
       same-service cache, and GCD's terms (as reported so far) don't
       speak to that distinction one way or the other. Treat "cache to
       our back-end" and "re-host in a blob store" as two different
       claims until reviewed, not two names for the same thing. Default,
       pending that review: **private access only, never public** — a
       publicly-reachable Blob URL for an archived GCD image is the
       closer of the two to redistribution, and redistribution is
       exactly what the fair-use-for-identification basis does NOT
       obviously cover. Do not provision or wire up Blob storage for
       this feature until this specific question — internal cache vs.
       third-party-hosted archive, under GCD's actual terms — has an
       answer.

       The `jimp` perceptual-hash spike (still not done)
       now scopes down to hashing individual on-demand-fetched images
       against a narrowed candidate set, not building a pre-hashed index
       of an entire series' variant covers.
    3. **Attribution — new UI surface, not yet designed.** Any card
       showing GCD-sourced data (metadata now, images later if the
       fair-use pattern above ships) needs a visible "Grand Comics
       Database" credit and a link back to the specific GCD source page
       — a real, unscoped UI addition, not a footer-once fix, since
       CC-BY-SA attribution conventionally travels with the specific
       data shown, not just a blanket site-wide mention. ShareAlike vs.
       the commercial pricing model is a legal/product question flagged
       for explicit human review — not something to resolve by
       implementation choice.

    **Net effect on scope: materially larger than the original Dispatch
    15 estimate.** The original sketch treated this as roughly
    "call GCD's API, add a hash spike." The actual requirement is a
    data-ingestion pipeline (dump download + import + refresh cadence +
    a storage decision), a request-time fetch-and-archive pattern
    instead of a pre-built index, and a new attribution UI surface — three
    separate, real pieces of infrastructure work, each needing its own
    scoping before any of this becomes buildable. Cover-matcher remains
    plan-only; nothing here is coded.
  - **Explicitly not scoped into this dispatch's six fixes** — ships
    independently, per instruction.

- **GrailKey Dispatch 19 (2026-08-07) — Spawn #351 real scan, four
  findings: Fix 6 shipped (corrected design), Fix 5 shipped, Vision
  confidence string leak fixed, commit-p near-miss investigated (report
  only, no code).** Single real production scan (Spawn #351, 2026-08-07
  20:40:36 UTC, POST /api/enrich, `dep=dpl_4mwr6MwTQZ7m4CxsZQFdjoaXr1SW`)
  supplied the evidence for all four items — pulled directly from Vercel
  runtime logs, not summarized secondhand.

  **Fix 6 SHIPPED, design corrected from Dispatch 15/16's original —
  `rescueYearFromVisionFallback` (`src/lib/issueAuthority.js`, log tag
  `[commit-p3]`).** The queued design (thread `poolYearHint` into
  `resolveYear`) was never coded as originally specced — investigating
  this scan found the design's own justifying citation had conflated two
  different signals. The scan's real log:
  ```
  [commit4.1] identityProvisionalFields += 'year' (family-scoped adoption): year=2024 support=3/4
  ...
  [identity-write] field=confirmedYear from="2024" (source=unknown) to="Unknown" (source=vision-fallback) site=resolve-year
  ```
  Commit 4.1 (`api/enrich.js` ~3026-3041) had already adopted year=2024
  from `identity.familyYearConsensus` (family-scoped, support=3/4=75%) —
  but `resolveYear` (`identityCore.js`) never even sees that adopted
  value on this path (`identityIsProvisionalOverride` is false for the
  weighted-consensus family-override route — B-Q1, `api/enrich.js`
  ~6933), so it fell through its own final branch and returned Vision's
  raw sentinel value, the literal string `"Unknown"` — not JS `null`.
  This is why the pre-existing `deriveProvisionalYearBackfill`/commit-p2
  rescue (added GrailKey Commit P2, 2026-08-03, specifically to guard
  against resolveYear clobbering an adopted year) didn't catch it: its
  `currentConfirmedYear != null` guard was built assuming a JS-`null`
  fallback and never fires against a non-null "Unknown" string, and
  separately its `issueAuthority.highConfidenceMarketplaceConsensus`
  gate was ALSO false on this exact scan (see the commit-p near-miss
  finding below — the same root cause blocks both commit-p and
  commit-p2 on this scan, independently discovered while investigating
  each). Two compounding reasons, not one.

  **The Dispatch 15/16 citation error, specifically:** the original Fix
  6 write-up cited "year=2024 support=3/4" as a `poolYearHint` instance
  ("agreement=X%" is `poolYearHint`'s own log format;
  `[commit4.1]`'s format is "support=X/Y" — a different field entirely).
  On this exact scan, `poolYearHint` really was computed
  (`[cv-pool-year-hint] year=2020 agreement=50% (3/6)`) and it was
  WRONG (2020, diluted by unrelated #300/#307/#293 listings in the raw
  20-item pool) — confirming `poolYearHint` was never the right signal
  to thread into `resolveYear` at all. `rescueYearFromVisionFallback`
  reads `identity.familyYearConsensus` exclusively; `poolYearHint` is
  not a parameter.

  **Fires ONLY when `yearSource === 'vision-fallback'` exactly** (not a
  loose truthy/null check) **AND** `familyYearConsensus.mode ===
  'adopted'` **AND** `support >= 3` — the same floor commit-p2 already
  enforces, validated by this real 3/4=75% case, unchanged. Placed
  immediately after the existing commit-p2 block in `api/enrich.js`
  (after every intermediate backfill — Q86 PC-tolerated, Q58-TITLE comp
  consensus, pc-anchor-gate, q99-b-variant-year — has already had its
  chance to find something better), so it only fires when NOTHING else
  fixed the year in between. Never touches any yearSource representing
  real corroboration (pc-cv-agreement, pricecharting, comicvine,
  ebay-consensus, or even the rejected-override case). 25-assertion
  regression: `tests/grailkey-dispatch-19-fix6-year-rescue.test.js`.

  **commit-p near-miss — INVESTIGATED, report only, no code changed,
  per explicit instruction.** The same scan's terminal gate fired
  `[commit4-terminal]` (forcing `ID_REQUIRED`, clearing price authority)
  instead of `[commit-p]` (price preserved) despite `issue=#351
  support=4/4=100%` — matching the shape of an earlier same-day scan
  (04:37:20 UTC, same book, same deployment) where `[commit-p]` DID
  fire. Traced to `meetsHighConfidenceMarketplaceConsensusBar`
  (`src/lib/issueAuthority.js`): `HIGH_CONFIDENCE_WEIGHT_FLOOR = 12`
  (justified in-code as "the maximum weight three members could carry
  using only the highest-ranked results," 5+4+3 from `getRankWeight`'s
  own scale, `imageSearchIdentity.js`). The two scans' own title-family
  weightSums:
  | Scan | Members (raw-pool rank indices) | Weight | Clears floor? |
  |---|---|---|---|
  | 04:37:20 (earlier, same day) | 0,1,2,5 → 5+4+3+1 | 13 | Yes — `[commit-p]` fired |
  | 20:40:36 (the dispatch scan) | 0,1,3,4 → 5+4+1+1 | 11 | No — one point short |

  Every OTHER `meetsHighConfidenceMarketplaceConsensusBar` condition
  passed identically on the 20:40 scan (decision='weighted-consensus',
  `topFamily.count=4 >= 3`, `overlapRatio=1`, dominant margin over
  runner-up 11 vs 3, no contaminated member, no series-marker
  asymmetry) — it failed on weight alone, by exactly one point. Root
  cause of the DIFFERENCE between the two scans: in the 04:37 scan,
  eBay's own reverse-image-search results happened to put a genuine
  #351 comp at raw-pool rank-2 (the third-highest weight tier, worth 3);
  in the 20:40 scan, that same rank slot was occupied by an unrelated
  "Spawn #326-#352 YOU PICK We Combine Shipping!!" lot listing, which
  the family-clustering step correctly excludes from membership but
  which still CONSUMED the rank-2 weight slot, denying it to a genuine
  member. `filterVisualIdentityPool`, `getRankWeight`, and
  `meetsHighConfidenceMarketplaceConsensusBar` all behaved correctly and
  identically given their actual inputs on both scans — this is NOT a
  code bug in either mechanism. It is a structural property of a
  rank-position-based weight floor: which raw listings eBay's live
  search-by-image API returns, and in what order, genuinely varies
  scan-to-scan for the same physical book (ordinary marketplace
  listing churn, not a determinism bug on this codebase's side) —
  meaning the SAME confirmed-correct book, photographed and scanned
  identically hours apart, can non-deterministically land on either
  side of the P1 high-confidence bar depending purely on what else eBay
  happened to rank alongside it that day.
  **Not fixed, not scoped — reported for a decision.** Two directions
  worth naming, neither implemented: (a) leave the floor as-is — it is
  a genuine floor, not a bug, and this near-miss is exactly the kind of
  case a floor is supposed to sometimes not clear; or (b) exclude
  known-junk categories (lot/bundle listings specifically, reusing the
  existing `LOT_RE`-family detection already used elsewhere in this
  codebase) from consuming a top-3 rank slot in the weight computation,
  so an irrelevant listing can no longer silently cost a genuine
  family its rank-3 weight. Direction (b) touches
  `meetsHighConfidenceMarketplaceConsensusBar`/`getRankWeight` — pricing
  math-adjacent territory (the P1 gate directly controls whether a
  price gets nulled) and needs its own explicit greenlight before any
  implementation, per this project's standing pricing-math protocol.

  **Vision confidence string leak — TRACED AND FIXED.** The same
  scan's own `[match-conf]` log line read
  `vision=high that this is not a comic book` — an asset-type verdict
  sentence being consumed where a `low`/`medium`/`high` confidence tier
  was expected. Traced to `req.body.confidence`
  (`api/enrich.js`, destructured at handler entry) literally containing
  the string `"High that this is NOT a comic book"` on this scan.
  Root cause was two-layered:
  1. **Prompt gap (`api/grade.js`).** `STANDARD_PROMPT`/`WATCH_PROMPT`
     never actually instructed Vision on `confidence`'s required format
     — confirmed by direct read of the live prompt text, no such
     sentence existed, despite `normalizeVisionConfidence`'s own doc
     comment (`identityCore.js`) claiming otherwise. The separately-
     specified `buildGradeOnlyPrompt` (the eBay-first cheap path) DID
     already have the correct instruction — the gap was specific to the
     two full-identification prompts. With `assetTypeConfident` and
     `confidence` presented back-to-back with no explicit format given
     for the latter, the model free-styled a justification sentence
     instead. Fixed: both prompts now carry an explicit "confidence
     must always be exactly one of the three words low/medium/high...
     never a restatement of the assetTypeConfident determination"
     instruction.
  2. **Zero validation at consumption (four independently-drifted call
     sites).** `normalizeVisionConfidence` (`identityCore.js`) blindly
     lowercased whatever string arrived with no check against the
     three-value enum — AND three separate, independent inline
     duplicates of the identical unchecked
     `String(confidence || 'medium').toLowerCase()` pattern existed in
     `api/enrich.js` (~4049, ~4232, ~8667), none of them routing
     through the one centralized function at all — the same
     drifted-duplicate-constant shape this file has documented
     repeatedly (Q119/Q127/Q128, the `ARTIST_PATTERNS` registry saga).
     Fixed: `normalizeVisionConfidence` now validates against
     `{low, medium, high}`, defaulting anything else to `'medium'` with
     a loud `[vision-confidence-invalid]` log line (never silent,
     preserves the offending raw value for diagnosis); all three inline
     `api/enrich.js` duplicates now call the shared function instead of
     re-deriving it. 20-assertion regression, including a direct read
     of the live prompt source confirming the instruction text actually
     landed: `tests/grailkey-dispatch-19-vision-confidence-leak.test.js`.

  **The leak is intermittent, not deterministic — confirmed, not
  assumed (GrailKey Dispatch 24, 2026-08-07).** A second Spawn #351
  scan, same build (`b212c64`, the pre-push build — this observation
  predates the fix reaching production), did NOT reproduce the bad
  string: `confidence="Low"` / `visionConfidence: "low"` /
  `[match-conf] vision=low`, a well-formed value, on the exact same
  code that produced `"High that this is NOT a comic book"` the day
  before. Same prompt, same code path, different Vision output shape
  from one photo to the next — the model doesn't reliably free-style
  the bad sentence every time it sets `assetTypeConfident=false`, only
  sometimes. **This does not weaken the Dispatch 19 fix or its
  reasoning** — a prompt gap plus an unvalidated consumer was a real
  defect regardless of how often it manifested, and an intermittent
  failure mode is arguably worse to leave unfixed, not less urgent,
  since it would have passed casual spot-checks indefinitely. It DOES
  mean: **do not expect to reproduce the original bad string on demand
  for verification.** A future regression check for this class of bug
  should rely on the unit test (`grailkey-dispatch-19-vision-confidence-
  leak.test.js`, which forces the input directly rather than waiting for
  Vision to volunteer it) and on the validator's own
  `[vision-confidence-invalid]` log line staying silent in production
  (its absence over time is the actual evidence the fix holds), not on
  catching the literal sentence in a fresh scan — the sentence's
  absence from any one scan is not evidence of anything, in either
  direction. The `scanlog:` record (GrailKey Dispatch 22) does not
  currently carry `confidence`/`visionConfidence` as a field either —
  another concrete instance of the same "v1 doesn't collect what a
  follow-up question needs" gap already noted for the `titleOk`
  question in the Dispatch 23 scan-log validation-questions note above.

  **Fix 5 SHIPPED — `shouldLiftAssetTypeAdvisoryLock`
  (`src/lib/imageSearchIdentity.js`), log tag `[Q32-asset-type-override]`.**
  Blocked since GrailKey Dispatch 15 on a real captured Vision JSON to
  determine whether a "not a comic" misread returns `issue=null`
  (display/lock-only fix) or a stale wrong value (would also need to
  feed a corrected issue back into `resolveIdentity`). This exact scan
  answers it: `[phase1] identity determination: Vision="Spawn" #null` —
  confirmed null, not stale. Implemented as originally re-scoped in
  Dispatch 15: extends the existing Q32 category-vote machinery
  (merchandise detection) to also tally comic-category votes, and when
  Vision flagged `!assetTypeConfident` but the pool independently shows
  strong (`>=5` listings, `>=60%` ratio) comic-category agreement AND
  the pool is coherent, lifts Q110's advisory `listingHardLocked` flag
  before it fires. Strictly additive to the Q32 merchandise hard-block —
  the predicate short-circuits to `false` whenever `merchandiseRatio >=
  0.5`, so it can never override that block; it only ever runs from
  inside the branch merchandise detection already declined.
  **Coherence-gate design decision, made explicit rather than left
  ambiguous:** the original Dispatch 15 wording said "reusing
  extractConsensus's own title-coherence check" — investigating the
  actual code found `titleOk` is a private local variable inside
  `extractConsensus` (`imageSearchIdentity.js`), not exposed on its
  return value, and `extractConsensus` returning `null` conflates TWO
  independent failure axes (title OR issue incoherence), not title
  alone. Rather than refactor `extractConsensus`'s internal closures
  (`stripVariantNoise`/`extractMainTitle`/`getMostCommon`) out to module
  scope just to isolate the title-only sub-check — a real option,
  deliberately not taken, to keep this fix's surface area contained —
  the shipped gate reuses `extractConsensus(...) !== null` as a single
  boolean input, which is the MORE conservative of the two choices
  (requires the pool to agree on both title AND issue, not title alone),
  consistent with this project's standing "conservative when uncertain"
  rule. **Disclosed limitation, not hidden:** this exact scan's own
  `visualConsensus` was `null` (`[phase1] eBay visual: 20 results,
  consensus=NO` — title consensus was fine, but the issue axis never
  reached its own separate 50% bar, the same near-miss described
  above) — so Fix 5, as shipped, would NOT have lifted this specific
  scan's own advisory lock. It targets the more common, different shape
  where the pool agrees on both title and issue but Vision's own
  `assetTypeConfident` read was wrong (a poster/print visually confused
  for a genuine, convergent listing pool) — real and different from
  this scan's own outcome, which is disclosed rather than papered over.
  Thresholds (`>=5`, `>=60%`) validated against this scan's real numbers
  (0/20 merchandise, ~20/20 comic-category — clears trivially, though
  this pool doesn't exercise the boundary itself since its own
  coherence gate declines regardless). 14-assertion regression:
  `tests/grailkey-dispatch-19-fix5-asset-type-override.test.js`.

  **Regression sweep, all pre-existing baseline failures confirmed
  byte-identical before/after (via `git stash`, not assumed):**
  `q-trackB-commit4.3-winning-family-authority` (266/266, zero
  pre-existing failures), `q110-intake-nonblocking` (38/38),
  `identity-gate` (1 pre-existing failure, an unrelated stale "author"
  field fixture, confirmed identical on `git stash`), `mega-keys` (the
  documented B&B #28 boundary failure), `q-adv397-visual-guard` (the
  documented 5-failure baseline), `image-search-extraction` (the
  documented 2-failure baseline), `pattern-k-dedupe-issue` (the
  documented 4-failure baseline) — none of this dispatch's four changes
  touched any of the code paths those pre-existing failures exercise.

- **Misattributed-anchor class — the Fix 6 spec error, standing note
  (GrailKey Dispatch 20, 2026-08-07).** Not just a corrected
  implementation: a wrong specification survived three dispatches (15,
  16, and would have shipped as designed in 19 had a real production
  scan not incidentally exposed it during unrelated work) with a
  passing, 25-assertion regression suite behind it — worth recording as
  its own failure class, because "well-tested" and "correctly specified"
  turned out to be independent properties here, and the gap between
  them is exactly the dangerous kind: invisible from the test output.

  **What happened, precisely.** GrailKey Dispatch 15 proposed Fix 6
  ("thread `poolYearHint` into `resolveYear`'s branch (e)"), citing two
  production log lines as validation: "year=2019 agreement=80% (4/5)"
  and "year=2024 support=3/4." Dispatch 15 itself flagged that 80% and
  75% didn't match one proposed bar and left the number an open
  question — a good instinct — but did not ask a prior, more basic
  question: were both citations actually instances of the SAME signal
  (`poolYearHint`) at all? GrailKey Dispatch 16 (this same session,
  earlier) picked `>=0.75` to accommodate both citations and shipped
  the design decision, with a 25-assertion regression suite built
  entirely from those two numbers. Every assertion passed. The design
  itself was never coded in that dispatch (implementation stayed
  queued) — which is the only reason this didn't ship silently wrong;
  had implementation kept pace with the validated bar, it would have
  shipped reading `poolYearHint` on every future scan, believing itself
  tested.

  GrailKey Dispatch 19, investigating an unrelated real production scan
  (Spawn #351) for Fix 5's evidence, incidentally pulled the exact log
  line the second citation came from and found it was never
  `poolYearHint` at all — it was `[commit4.1]`'s own family-scoped year
  adoption line (`identity.familyYearConsensus`), a structurally
  different computation (scoped to a title-family's own members, not
  the raw whole pool) that happens to share a superficially similar log
  shape: both read as "a ratio of pool rows supporting a candidate
  year," both print an X/Y-shaped fraction, easy to mistake for the
  same field at a glance if you don't trace the literal source line.
  `poolYearHint`'s OWN real value on that same scan was 2020 at
  3/6=50% — a third number, genuinely computed, and wrong. Three
  numbers on one real scan (2019/80%, 2024/75%, 2020/50%), only one of
  which was ever poolYearHint, and the design being validated (Fix 6)
  was never checked against that one correctly.

  **Why the passing tests didn't catch it.** The 25 Dispatch 16
  assertions validated that `>=0.75` correctly accepted both cited
  ratios and correctly rejected values below it — a genuine, honest
  test of the THRESHOLD. They could not have caught the deeper problem
  because the test fixtures were HAND-CONSTRUCTED from the citations
  themselves (`{ agreement: 0.75, year: 2024 }`-shaped inputs), not
  derived by re-tracing each citation back to its actual log line and
  variable. A test built from a mislabeled citation faithfully tests
  the mislabel. Coverage of "does the bar behave correctly given this
  input" is a different claim from "is this the right input" — the
  first is a property of the test, the second is a property of the
  citation, and no amount of the first proves the second.

  **The standing rule, generalized beyond this one case:** when a
  design cites a production log line as validation — a ratio, a
  count, an X/Y fraction — trace it back to its LITERAL source (the
  exact `console.log` call site and the exact variable printed) before
  building anything on it, not just its face-value meaning. This
  matters most exactly when two mechanisms in the same pipeline can
  produce similarly-shaped output for a related purpose (here:
  `poolYearHint`'s whole-pool `agreement=X%` vs `[commit4.1]`'s
  family-scoped `support=X/Y` — both about "how many rows support this
  year," different scopes, different reliability, easy to conflate).
  A citation that "looks like" the signal a design names is not
  evidence it IS that signal. This is a different, earlier-stage
  failure than the drifted-duplicate-constant class already documented
  in this file (Q119/Q127/Q128, the `ARTIST_PATTERNS` saga) — those are
  about a value or list independently drifting apart from a sibling
  copy after correct attribution; this is about the attribution itself
  being wrong from the start, before any drift could even occur. Watch
  for it specifically whenever a fix's evidence section cites "a real
  production log line" without also showing the line's own log tag/
  call-site context — the tag is what proves which mechanism actually
  produced it.

- **GrailKey Dispatch 20 (2026-08-07) — Fix 5 decline-path logging
  shipped; commit-p rank-slot theft investigated and found to be the
  MINORITY cause, not the majority, of the near-misses it superficially
  resembles.**

  **Fix 5 decline-path logging, SHIPPED.** The `[Q32-asset-type-override]`
  call site already logged both branches (fire and decline) as shipped
  in Dispatch 19 — verified directly before changing anything, not
  assumed missing. Enhanced the decline log with a `blockedBy` reason
  breakdown (`merchandise-hard-block-region` / `comicVotes<5` /
  `comicRatio<60%` / `pool-incoherent`) and explicit `merchandiseRatio`,
  so a future batch sweep asking "does this ever fire" doesn't need to
  hand-recompute which sub-condition failed from raw numbers alone.
  8-assertion regression: `tests/grailkey-dispatch-20-fix5-decline-logging.test.js`.

  **commit-p rank-slot theft — INVESTIGATED, report only, no code,
  `HIGH_CONFIDENCE_WEIGHT_FLOOR` left untouched, per explicit
  instruction.** Queried production runtime logs for every
  `[commit4] issueAuthority=provisional` firing (the only population
  where `HIGH_CONFIDENCE_WEIGHT_FLOOR` actually gates anything) across
  2026-08-01 through 2026-08-07. Group-by counts (fast, reliable):
  16 total firings in that window. Full-content pulls (the only way to
  see each scan's actual raw-pool indices) repeatedly timed out over
  multi-day and even single-day windows for this specific query — narrow
  (≤12h) windows worked reliably; wider ones did not, regardless of
  `deploymentId` scoping. **9 of the 16 were reachable and fully
  verified** (indices, family membership, and the literal content of
  every raw-pool row checked directly, not inferred); **7 remain
  unreachable** within this investigation's tool budget — recorded as a
  genuine gap, not glossed over.

  **Critical caveat found while pulling the 9: this is not a diverse
  sample.** All 9 reachable scans are repeat scans of essentially ONE
  physical book — Spawn #351 Cover C Brett Booth Virgin (8 of the 9) —
  plus one scan of a second book, Spawn #369 (the Dispatch 15/16 anchor).
  This strongly suggests the reachable window is dominated by this
  investigation's own repeated test/dev scans of the same book, not a
  representative cross-section of real customer traffic. Any frequency
  claim below is scoped honestly to "within this narrow, non-diverse
  sample," not "across the scan ledger" as originally asked — the
  ledger-wide question remains genuinely unanswered given the tool's
  reach limits, the same honest conclusion this file already reached
  once before for a different measurement (see the Bone #1 / GK-34
  entry's own stale-threshold measurement, "Parked... not answerable
  from available logs").

  **Finding, precise per-scan (all 9 checked directly against the raw
  `[visual] titles:` array and the `[family-evidence]` index list, not
  pattern-matched from memory across scans):**

  | Scan (UTC) | Book | Weight | Family indices | Top-3 slot 2 occupant | Mechanism |
  |---|---|---|---|---|---|
  | 04:37:20 Aug 7 | Spawn #351 | 13 | {0,1,2,5} | genuine family member | clean, `commit-p` fires |
  | 03:48:42 Aug 4 | Spawn #351 | 14 | {0,1,2,3,5} | genuine family member | clean, `commit-p` fires |
  | 04:40:00 Aug 3 | Spawn #351 | 14 | (5 members) | genuine family member | clean, `commit-p` fires |
  | 04:39:27 Aug 3 | Spawn #351 | 14 | (5 members) | genuine family member | clean, `commit-p` fires |
  | 20:40:36 Aug 7 | Spawn #351 | 11 | {0,1,3,4} | **genuine junk — "Spawn #326-#352 YOU PICK We Combine Shipping!!" lot listing** | **junk rank-slot theft** |
  | 02:23:00 Aug 4 | Spawn #351 | 10 | {0,1,4} | real, on-topic "CAMEO OF LYRA" listing — split into its own 2-member sibling sub-family instead of merging | title-family fragmentation, NOT junk |
  | 04:24:49 Aug 3 | Spawn #351 | 10 | {0,1,4} | same as above | fragmentation, NOT junk |
  | 03:52:16 Aug 3 | Spawn #351 | 10 | {0,1,4} | same as above | fragmentation, NOT junk |
  | 04:51:10 Aug 7 | Spawn #369 | 8.5 | (8 members, broad "spawn"-only family) | slots 0 and 1 both genuine, on-topic #369 listings that didn't cluster into this family | fragmentation, NOT junk |

  **The specific mechanism asked about — a lot/multi-issue/junk-category
  listing directly occupying a top-3 rank slot — was confirmed in
  exactly 1 of the 9 reachable scans.** The mechanism that actually
  recurs more often in this sample (4 of 9, all involving no junk
  whatsoever) is a different, structurally distinct problem: title-family
  clustering splitting genuinely relevant, on-topic listings into
  sibling sub-families instead of merging them into the winning family —
  which drags `weightSum` below the floor for a completely unrelated
  reason. Both mechanisms independently produce the same visible symptom
  (near-miss, `commit-p` doesn't fire, `commit4-terminal` forces
  `ID_REQUIRED`) — which is why a first look at two symptomatically
  identical scans (both landing on `family={0,1,4}`/weight=10) can look
  like "the same bug happening twice" when re-tracing the ACTUAL content
  behind the missing slot shows they are not. The initial hypothesis
  going into this investigation ("the junk listing keeps stealing rank
  slots") was itself a version of the misattributed-anchor mistake
  documented above — two scans producing an identical-looking
  `family=/weight=` fingerprint were assumed to share a cause without
  independently re-verifying each one's actual row content.

  **Conclusion, matching the explicit instruction not to touch anything:**
  within the reachable, honestly-caveated sample, junk-in-top-3 is a
  known marginal case — 1 confirmed instance, not evidence of a common
  problem, consistent with "leave `HIGH_CONFIDENCE_WEIGHT_FLOOR` alone."
  The fragmentation mechanism recurred more often in this same sample
  and is a genuinely different, unscoped problem — flagged here as a
  candidate for its own future investigation if the pattern holds up
  outside this narrow, single-book-dominated sample, but explicitly NOT
  requested or scoped this dispatch, and not investigated further here.
  `HIGH_CONFIDENCE_WEIGHT_FLOOR` and every rank-weight mechanism
  (`getRankWeight`, `meetsHighConfidenceMarketplaceConsensusBar`,
  `selectTitleFamilyCandidate`'s merge logic) remain completely
  untouched by this dispatch.

- **GrailKey Dispatch 21 (2026-08-07) — title-family fragmentation added
  to the watch list (no action); structured KV scan-logging investigated,
  plan only, no code.**

  **Watch list, not scoped, no action — title-family fragmentation.**
  Dispatch 20's commit-p investigation found that 4 of 9 verified scans'
  near-misses were caused by `selectTitleFamilyCandidate` splitting
  genuinely on-topic, relevant listings into sibling sub-families instead
  of merging them into the winning family (e.g. a "CAMEO OF LYRA"
  variant-descriptor listing landing in its own 2-member family rather
  than joining the main 3-member "spawn brett booth" family it visually
  and topically belongs with) — a structurally different mechanism from
  junk-listing rank-slot theft, confirmed by direct re-verification of
  each scan's actual row content. **Explicitly not scoped or
  investigated further per instruction:** all 4 instances are the same
  single book (Spawn #351) in a sample already established as
  non-diverse (dominated by repeat scans of that one book) — one book at
  nine repeats is not evidence of a general pattern, and generalizing
  from it would repeat the exact misattribution error this session
  already found and corrected once (the Fix 6 spec error). Recorded here
  so a future dispatch that sees this shape on an UNRELATED book
  recognizes it rather than re-diagnosing from scratch — flag if it
  recurs elsewhere; no threshold, no code, no scoping decision made now.

  **Structured KV scan-logging — INVESTIGATED, PLAN ONLY, no code.**
  Two separate frequency questions this session ended genuinely
  unanswered for the identical underlying reason: the GK-34 stale-comp
  threshold measurement (see that entry above, "Parked... not answerable
  from available logs") and this dispatch's own commit-p rank-slot
  frequency investigation (7 of 16 scans unreachable). Both hit the same
  wall: the Vercel runtime-log tool reliably answers COUNT queries
  (`group_by`) over wide time ranges, but full-content pulls — the only
  way to see the actual field values a frequency question needs — time
  out past roughly a 12-hour window regardless of `deploymentId` scoping,
  confirmed via repeated direct attempts across both investigations, not
  assumed. This is a standing tooling gap, not a one-off — two unrelated
  questions failed on it in one session.

  **The proposal: write one compact, structured record per scan directly
  to the KV layer that already exists** (`api/kv-cache.js`, Upstash
  Redis, live since 2026-06-29 — see the Stack section and GrailKey
  Dispatch 18) — a direct Redis query against that store is not subject
  to the runtime-log tool's content-scan timeout at all, since it reads
  pre-structured records instead of re-parsing verbose console output
  after the fact.

  **Record shape, first draft, not final — needs iteration before
  coding:**
  ```json
  {
    "v": 1,
    "ts": 1786...,
    "requestId": "...",
    "book": { "title": "...", "issue": "...", "year": "..." },
    "issueAuthority": { "status": "provisional", "reasons": [...], "highConfidenceMarketplaceConsensus": true, "supportRatio": 0.53 },
    "familyWeight": { "weightSum": 11, "count": 4, "overlapRatio": 1, "decision": "weighted-consensus" },
    "terminalReason": "commit-p" | "commit4-terminal" | "clean" | null,
    "poolSizes": { "raw": 20, "eligible": 20, "familyMembers": 4 },
    "assetTypeOverride": { "evaluated": true, "fired": false, "blockedBy": ["pool-incoherent"] }
  }
  ```
  Directly answers both of this session's dead-end questions (the
  `familyWeight`/`terminalReason` fields alone would have made the
  rank-slot investigation a direct query instead of nine individual log
  pulls) and is written generally enough to answer whatever the NEXT
  unanswerable frequency question turns out to be — a per-scan record
  scoped only to today's specific question would just recreate today's
  problem the next time a different filter is needed. Versioned (`v: 1`)
  from day one, matching this exact file's own `PC_FILTER_VERSION`/
  `CV_FILTER_VERSION` convention (`api/kv-cache.js`) — a schema change
  must not silently corrupt historical queries.

  **Storage primitive — two options, recommendation given, needs
  verification before committing:**
  1. **Redis Streams (`XADD`/`XRANGE`), recommended.** Purpose-built for
     exactly this shape (append-only, time-ordered, range-queryable
     event log) — one command per write, no separate index structure to
     keep in sync. Not yet verified whether Upstash Redis's specific
     offering supports stream commands on the plan this project is on —
     a real prerequisite check, not assumed, before this direction is
     picked.
  2. **Plain per-record keys (`scanlog:v1:<ts>:<id>`) + a sorted-set time
     index (`ZADD scanlog:index:v1 <ts> <key>`), fallback.** Definitely
     supported (uses only primitives `api/kv-cache.js` already proves
     work against this project's Upstash instance), but two writes per
     scan instead of one, and the index needs its own retention/trim
     policy independent of the records it points to.

  Either option needs new wrapper functions in `api/kv-cache.js` (today
  only exports `kvGet`/`kvSet`/`kvDel`, plain GET/SET/DEL — no
  stream/sorted-set operations wrapped yet) — a small, additive change to
  that file, not a rewrite.

  **Open questions, deliberately not resolved here:**
  - **Volume/cost.** No current daily/monthly scan-count figure exists
    in this codebase's own documentation to project storage or
    per-command cost against. Needs a real number (Vercel function
    invocation count, or a short observation period) before committing
    to "log every scan" — the record above is small, but small × unknown
    volume × unbounded retention is not a costed decision.
  - **Retention.** This is an analytics/audit trail, not a cache in the
    existing sense (avoiding redundant external API calls) — a distinct
    purpose deserving its own TTL policy (candidate: 30-90 days) rather
    than inheriting any existing `KV_TTL` constant, and its own key
    namespace (`scanlog:`, distinct from the existing `cv:`/`pc:`/`gc:`/
    `ac:`/`bc:`/`ph:`/`oauth:` prefixes) per this file's own established
    namespace-isolation discipline.
  - **Scope: every scan, or only the interesting ones?** Logging only
    `commit4`-provisional scans directly answers today's specific
    question cheaply, but recreates the SAME narrow-denominator problem
    the next time a different filter is needed (as it did twice this
    session, for two different filters). Logging every scan with a
    small, flat record answers arbitrary future frequency questions but
    costs more and is a bigger decision — leaning toward "every scan"
    for durability of the investment, but this is exactly the kind of
    tradeoff to decide once volume is known, not before.
  - **Write-site failure mode.** Must follow the SAME graceful-degradation
    convention `kvGet`/`kvSet` already use (try/catch, swallow failures,
    console.warn, never block or fail the actual pricing response) — a
    logging write must never be able to take down a real scan.
  - **Query interface.** Recommended: a local Node script
    (`scripts/query-scanlog.mjs`, not yet written) run against
    `KV_REST_API_URL`/`TOKEN` pulled via `vercel env pull` — talks
    directly to Upstash, no new deploy, no new Vercel function. A
    dedicated API endpoint was considered and rejected as the default:
    `api/` is already at 14 files against a nominally-12 cap (unresolved
    per GrailKey Dispatch 18) — spending one of those scarce slots on an
    investigation tool, not a customer-facing feature, is the wrong
    trade when a local script reaches the same data with zero function
    cost.

  Nothing in this proposal is implemented. The next step, if greenlit,
  is verifying Upstash's stream-command support specifically (the one
  real unknown blocking a choice between the two storage options above)
  before any code is written.

- **GrailKey Dispatch 22 (2026-08-07) — structured KV scan-logging
  SHIPPED, greenlit with two decisions made explicitly to avoid waiting
  on data that wouldn't start accumulating until this was live.**

  **Decision 1: log every scan, not just the interesting ones.** The
  Dispatch 21 plan's own argument was the deciding one — a narrowly-
  scoped log recreates the exact denominator problem that broke both
  of this session's frequency investigations, each needing a different
  filter. Volume judged not a real constraint at current scale (~60
  scans/week during heavy testing, ~500-byte records, well under
  20MB/year) — explicitly revisit if usage grows an order of magnitude,
  not a permanent assumption.

  **Decision 2: sorted-set index instead of Redis Streams.** Streams
  were the Dispatch 21 recommendation but carried one real, named
  blocker: unverified whether this project's Upstash plan supports
  stream commands. The sorted-set fallback uses only primitives
  `api/kv-cache.js` already proves work against this project's real
  Upstash instance (plain `GET`/`SET`, now `ZADD`/`ZRANGE`) — removes
  the blocker outright rather than resolving it. Two writes per scan
  (the record plus the index entry) instead of Streams' one judged
  irrelevant at ~60 scans/week. Streams remain the documented upgrade
  path, not abandoned — worth revisiting if write volume ever grows
  enough that two round-trips per scan starts to matter.

  **What shipped, concretely:**
  - `src/lib/scanLog.js` (new) — `buildScanLogRecord` (pure, no I/O,
    every field defaults to `null` rather than being omitted, so a
    consumer querying many records never needs a presence check) and
    `buildScanLogKey` (`scanlog:v1:<ts>:<id>`). `SCAN_LOG_VERSION=1`,
    `SCAN_LOG_TTL_SECONDS` (90 days), `SCAN_LOG_INDEX_KEY`
    (`scanlog:index:v1`) all exported as named constants, matching this
    file's own `PC_FILTER_VERSION`/`CV_FILTER_VERSION` versioning
    discipline (`api/kv-cache.js`) from day one — a future schema
    change bumps the version rather than silently reshaping historical
    records a live query is still reading.
  - `api/kv-cache.js` — new `kvZAdd(key, score, member)`, same
    graceful-degradation contract as the existing `kvGet`/`kvSet`
    (try/catch, swallow failures, `console.warn`, never throw). New
    `KV_TTL.SCANLOG` constant and a `scanlog:` line added to the file's
    own key-prefix documentation comment.
  - `api/enrich.js` — three changes: (1) a `scanLogTerminalReason`
    variable, declared just above the commit4-terminal/commit-p branch
    and set inside each (`'commit4-terminal'` / `'commit4.1-terminal'`
    / `'commit-p'` / stays `null` when neither fires — a normal,
    confident scan); (2) Fix 5's `assetTypeOverrideEvaluated`/
    `assetTypeOverrideBlockedBy` now persisted onto `out` (previously
    only logged, not stored, so the scanlog write site — much later in
    the same handler — had nothing to read); (3) the write site itself,
    placed immediately after `out.decision = computeDecision(...)` (the
    point every field the record needs — `out.issueAuthority`,
    `familyCandidate.topFamily`, pool sizes, the terminal reason — is
    settled), wrapped in its own try/catch as a second layer of
    protection beyond `kvSet`/`kvZAdd`'s own internal error-swallowing
    (this block also builds the record and reads several `out`/local
    fields, which the KV wrapper functions' own try/catch can't cover).
    Awaited, not fire-and-forget — a genuinely un-awaited promise in a
    serverless function has no guaranteed chance to complete once the
    response is sent; `kvSet`/`kvZAdd` already resolve in one fast
    Redis round-trip each, so awaiting costs negligible latency while
    guaranteeing the write is attempted.
  - `scripts/query-scanlog.mjs` (new) — local script, no new Vercel
    function (deliberately: `api/` is already at 14 files against a
    nominally-12 cap, an unresolved open question since GrailKey
    Dispatch 18; spending one of those scarce slots on an investigation
    tool rather than a customer-facing feature would be the wrong
    trade). Loads `KV_REST_API_URL`/`KV_REST_API_TOKEN` from whichever
    pulled `.env*` file has them, same preference-order pattern already
    established in `scripts/pc-token-health.mjs` — no new dependency,
    no dotenv (this repo has none). Accepts `--since`/`--until` (ISO or
    relative, `"7d"`/`"24h"`/`"30m"`), `--json` for raw records, `--limit`
    on the index read. Default summary output breaks down
    `terminalReason` and `issueAuthority.status` counts and Fix 5's
    evaluated/fired counts directly — the exact shape both of this
    session's dead-end investigations actually needed.

  **26-assertion regression** (`tests/grailkey-dispatch-22-scanlog.test.js`):
  the pure builders' full/minimal/partial-input behavior, and a direct
  confirmation that `kvZAdd` never throws even with no KV configured
  (this test environment's own real shape — the same shape a production
  Redis outage would produce). Full build clean. Regression sweep against
  `q-trackB-commit4.3-winning-family-authority` (266/266),
  `q110-intake-nonblocking` (38/38), `identity-gate` (1 pre-existing,
  unrelated failure, unchanged), and every Dispatch 19/20 test file
  (`fix6-year-rescue`, `vision-confidence-leak`,
  `fix5-asset-type-override`, `fix5-decline-logging`) — all confirmed
  passing, zero regressions from touching `api/enrich.js` a fourth time
  this session.

  **What this instrumentation exists to answer (GrailKey Dispatch 23,
  2026-08-07) — recorded here so a future session queries for these
  directly instead of re-deriving them from scratch. All three are
  currently guesses; revisit after roughly 2 weeks of accumulated
  records (`node scripts/query-scanlog.mjs --since=14d`).**
  1. **Does `shouldLiftAssetTypeAdvisoryLock` ever fire in production,
     or is the bar too conservative?** Dispatch 19's own disclosed gap
     — the fix shipped with its own motivating scan (Spawn #351)
     confirmed NOT to qualify under its own bar. Query:
     `assetTypeOverride.evaluated` count vs. `assetTypeOverride.fired`
     count (the query script's default summary already reports both).
     If `evaluated > 0` and `fired` stays at 0 across a real batch, the
     `>=5` / `>=60%` / coherence-gate combination needs revisiting with
     real numbers instead of the Dispatch 15 placeholders it still
     carries.
  2. **How often does a commit-p near-miss happen, and on books other
     than Spawn #351, does fragmentation or junk-slot theft dominate?**
     Dispatch 20's finding was a single-book sample (8 of 9 verified
     scans were the same physical book) — explicitly flagged as not
     generalizable. Query: `terminalReason` breakdown
     (`commit-p`/`commit4-terminal`/`commit4.1-terminal`/`clean`)
     grouped by `book.title`/`book.issue`, once enough distinct books
     have accumulated records to say anything. The `familyWeight` field
     doesn't by itself distinguish fragmentation from junk-slot-theft —
     that still requires reading the actual raw-pool row content the
     way Dispatch 20 did by hand — but a `terminalReason` breakdown
     across many DIFFERENT books would at minimum answer the frequency
     half of the question, which the single-book sample explicitly
     could not.
  3. **Are the `titleOk` 0.15 bar (GrailKey Dispatch 15 Fix 1) and the
     vision-zero-support ratio floor (Dispatch 15 Fix 2) actually
     catching real cases, or firing on nothing?** Both shipped against
     specific cited production misses at the time, but neither has a
     structured way to check its ongoing hit rate — today that would
     mean a fresh runtime-log sweep for each, the same reach-limited
     approach that produced two unanswerable measurements this session.
     Not yet a field on the scanlog record — closing this specific
     question would need `familyIssueConsensus`'s `titleOk` value (and
     whether the zero-support override path was taken at all) added to
     `buildScanLogRecord`'s schema before it's queryable. Recorded here
     as a real gap in the CURRENT schema, not just an open question —
     v1 doesn't carry what this specific question needs; a v2 addition
     is the honest next step if this is prioritized, not a query against
     data already being collected.

- **GrailKey Dispatch 25 (2026-08-07) — unanimous-consensus identity
  unblock. Fix 1 STEP 1 shipped, bare-title hypothesis KILLED, Fix 1/
  Fix 2 confirmed as one root cause, GK-35 opened.**

  **Repro (locked, reproduced twice on demand):** Spawn #351 Cover C
  Brett Booth Virgin Variant, two scans (22:08:43 and 22:16:19 UTC,
  build `b926dba`), identical failure both times — `ID_REQUIRED`, no
  price, listing blocked, despite unanimous marketplace evidence
  (`[commit4] issueAuthority=provisional (marketplace-only-adoption):
  issue=#351 support=4/4=100%`).

  **Step 0/0b locations (`git grep`, verified structurally, not from
  memory):** `[evidence-eligibility]` (`api/comps.js:2238/2250`, inside
  `fetchComps`); `[commit4] issueAuthority` (`api/enrich.js:3011`
  provisional-adoption, `:9302` conflict-escalation, both inside the
  single `handler` function — confirmed no nested function boundary
  anywhere in `api/enrich.js` between lines 2158–10600); `[commit4-
  terminal]` (`api/enrich.js:10549`, also inside `handler`); `[22e-LOSS]`
  (three print sites — `src/lib/identityCore.js:352`/`:386` inside
  `checkAssemblyIntegrity`, and `api/enrich.js:6102` inside `handler`,
  its own wrapper log around calling that function a second time in
  "Phase 2"); `[identity-gate] REFUSED` (`api/enrich.js:7403`, inside
  `handler`). Step 0b — the actual Phase 1 force behind the repro's
  title revert — `api/enrich.js:3266` (`writeConfirmed(...,
  '22e-force')`, inside `handler`, calling `checkAssemblyIntegrity` at
  line 3254 — runs BEFORE the `fetchComps` call site at line 5689, which
  is why this site and not the Phase 2 one at 6102 is the one that could
  have affected `evidenceTarget.seriesTitle` at classification time).

  **Fix 1 STEP 1, SHIPPED — instrumentation only, zero behavior
  change.** `classifyEvidenceRow` (`src/lib/evidenceEligibility.js:245`)
  now returns a `rejectionDetails` array alongside the existing
  `rejectionCodes` — one entry per code, pairing it with the exact
  predicate/values that produced it. `buildPricingEligibleRows`
  (`evidenceEligibility.js:824`) now logs `[evidence-eligibility-reject]`
  once per row it filters out, naming the specific `PRICING_GATE_CODES`
  entry(ies) that blocked it. `fetchComps` (`api/comps.js:2175`) now
  logs `[evidence-target]` once, printing the exact population every row
  is measured against. Every behavior-determining line
  (`rejectionCodes.push`, `identityEligible`, `rawPricingEligible`, the
  `isPricingMathEligible(...)` call itself) is byte-identical to before
  — confirmed via a 471-assertion regression sweep across the 9 suites
  that exercise this file, all unchanged, plus 22 new assertions
  (`tests/grailkey-dispatch-25-fix1-instrumentation.test.js`).

  **Bare-title hypothesis — KILLED, not left open.** The original
  hypothesis (classification measures against `confirmedTitle="Spawn"`,
  the post-`22e-force` bare title, rather than the winning family, so
  variant-specific comps fail a title predicate they already passed
  upstream) is refuted at the code level, confirmed by a direct test
  (`grailkey-dispatch-25-fix1-instrumentation.test.js`, Section 2): a
  row reconstructing the repro's exact shape
  (`issueAuthorityPresent=true, issueAuthorityStatus='provisional'`)
  rejects on `TARGET_ISSUE_PROVISIONAL_AUTHORITY` alone — no
  `WRONG_ISSUE`, no `WRONG_VARIANT` — **despite a title that would
  otherwise match on both axes**. Swapping in a row title with zero
  relation to "Spawn"/"351" produces the byte-identical single rejection
  code, proving the result does not depend on title content at all:
  `TARGET_ISSUE_PROVISIONAL_AUTHORITY` (`evidenceEligibility.js` ~line
  322) is an `else if` branch mutually exclusive with `WRONG_ISSUE` —
  when it fires, `hasIssueNumber()` (the actual title/issue text check)
  is never evaluated for that row, regardless of what
  `evidenceTarget.seriesTitle` holds. The 22e-force mechanism (Step 0b)
  is real and does revert `confirmedTitle` to Vision's bare title in
  this exact scan, but that revert is irrelevant to why these 14 rows
  were eliminated — a genuinely different mechanism, evaluated earlier
  in the same `if`/`else if` chain, got there first.

  **Fix 1 and Fix 2 are one root cause, not two — confirmed, all four
  cited blocks verified present in this exact repro's log shape, not
  assumed from the claim alone.** `out.issueAuthority.status ===
  'provisional'` (Commit 4's marketplace-only-adoption) independently
  gates four separate blocks, all keyed off the identical field:
  1. CV/PC exact-identity lookup skip — `[commit4.3.1] exact-identity
     cv/pc: lookup SKIPPED — issueAuthority.status="provisional"`.
  2. Active-comps cache skip — `[active-cache] SKIP:
     issueAuthority.status="provisional" — marketplace-only-adopted
     issue not cached (Commit 4)`.
  3. Evidence-eligibility 14→0 elimination — this dispatch's own
     finding, above: `TARGET_ISSUE_PROVISIONAL_AUTHORITY` in
     `PRICING_GATE_CODES` rejects every row unconditionally.
  4. `commit4-terminal` forcing `ID_REQUIRED`, clearing price authority,
     locking the listing (`api/enrich.js:10549`).
  A single upstream promotion (provisional → confirmed, under the strict
  unanimous-consensus predicate specified below) resolves all four
  simultaneously, since none of the four has any logic of its own beyond
  reading this one field. **Fix 2/2b SHIPPED (commit `81ca1d2`)** — see
  the dedicated writeup below for the final predicate, the year-axis
  correction found during plan review, and the V4 safety-regression
  closure.

- **GK-35 (2026-08-07, GrailKey Dispatch 25) — `PRICING_GATE_CODES`
  covers only 6 of 14 `classifyEvidenceRow` rejection codes; the other
  8 have zero redundancy at the pricing layer. LOGGED ONLY, not
  scoped or acted on this session, per explicit instruction.** Found
  while writing Fix 1 STEP 1's regression test (a wrong test assumption
  — that `LOT_OR_BUNDLE` would block `buildPricingEligibleRows` —
  failed and revealed this directly, not inferred from documentation).
  `PRICING_GATE_CODES` (`evidenceEligibility.js:802`) = `[INCOMPLETE_COPY,
  RESTORED_COPY, FORMAT_MISMATCH_RAW_VS_SLAB, UNCONFIRMED_EDITION,
  TARGET_ISSUE_UNRESOLVED, TARGET_ISSUE_PROVISIONAL_AUTHORITY]`. The
  other 8 codes `classifyEvidenceRow` can produce — `WRONG_VARIANT`,
  `WRONG_PRINTING`, `WRONG_ISSUE`, `WRONG_YEAR`, `SIGNED_MISMATCH`,
  `LOT_OR_BUNDLE`, `COLLECTED_EDITION_MISMATCH`,
  `FORMAT_MISMATCH_GRADED_VS_RAW` — do NOT block
  `isPricingMathEligible`. A row carrying ONLY one of those 8 codes
  (`identityEligible=false` inside `classifyEvidenceRow`, per that
  function's own determination) still passes `buildPricingEligibleRows`
  and can enter `fetchComps`'s pricing pool. This is deliberate,
  documented design (`evidenceEligibility.js`'s own Track B Phase 0
  Commit 1 comment: those 9 original codes — now 8, `TARGET_ISSUE_
  UNRESOLVED` having since been added to the gate — "already locked in
  by tests/q-commitD1.1-collision-aware-eligibility.test.js's
  LEGACY_OVERLAPPING_CODES assertion... the existing, more nuanced
  api/comps.js/soldVerification.js filter chains already enforce these
  with edge-case handling this narrower classifier doesn't replicate")
  — `classifyEvidenceRow` was designed as a SECOND, narrower layer
  covering gaps in the legacy filter chains specifically, not a full
  redundant re-check of everything the legacy chains already do. That
  design intent is real, but its practical consequence is what this
  finding names: variant/issue/printing/year correctness at the
  pricing-math layer currently has exactly ONE line of defense (the
  legacy `api/comps.js`/`soldVerification.js` filter chains) for 8 of
  14 possible mismatch classes, not two. Directly relevant to this
  session's own virgin-variant repro: if a future scan's legacy filter
  chain ever admits a wrong-variant row (e.g. a Cover B listing
  contaminating a virgin-variant pool) that `classifyEvidenceRow`
  correctly flags `WRONG_VARIANT` on, that row still prices — the
  narrower classifier's correct identification provides zero backstop
  for 8 of its own 14 possible findings. Not scoped, not fixed, no
  threshold or gate touched this session — flagged for a future
  dispatch to decide whether closing this gap (widening
  `PRICING_GATE_CODES`, and re-running the Commit 1 audit that
  originally decided against it) is warranted, given the legacy chains'
  own edge-case handling was the stated reason it wasn't done at the
  time.

- **GrailKey Dispatch 25, Fix 2/2b SHIPPED (2026-08-07, commit `81ca1d2`)
  — unanimous-consensus promotion of `issueAuthority.status`, plus a
  third "wrong population" instance found in plan review, plus a safety
  regression found in the same review before push.** Closes the four
  blocks enumerated in the entry above by promoting
  `out.issueAuthority.status` from `'provisional'` to `'confirmed'`
  ONLY under a strict, all-of predicate — never a general loosening.

  **Fix 2 (issue axis) — `evaluateUnanimousConsensusPromotion`
  (`src/lib/issueAuthority.js`).** Promotes only when: family
  `uniqueRows >= 4`; `support === uniqueRows` (exact unanimity, integer
  equality, not a ratio threshold); `runnerUp === null` (no second-place
  candidate exists at all — confirmed via direct source read that
  `resolveFamilyIssueConsensus` returns literal `null` here, not a
  string `'none'`, which only appears in one display-only log template
  downstream); family `weightSum >= 8.0`; every contributing row has a
  distinct `itemId` AND a distinct `sellerUsername` (new
  `checkDistinctItemIdAndSeller` helper — guards against a single seller
  cross-posting the same claim under several listings inflating
  `uniqueRows` without genuine independent corroboration). Any one
  condition failing declines outright; current pre-Dispatch-25 behavior
  is unchanged on decline. Logs `[commit4-promote]` with every input on
  both the promote and decline paths.

  **Fix 2b (year axis) — third recorded instance of "measuring
  coherence against the wrong population."** The first two instances of
  this class are the launch-era vision-zero-support defect and the
  Bone #1/GK-34 sold-pool-size-floor family documented earlier in this
  file. This is the third, found during plan review (not shipped, then
  caught by tests) — the user explicitly required a verification step
  before any code was written. `resolveFamilyYearConsensus`'s own
  `uniqueRows`/`support` fields (`identityCore.js:1234`) are NOT
  assertion counts — `uniqueRows` increments for every deduped family
  member regardless of whether that row carries a parseable year at all
  (line 1278), while `support` (the field this dispatch initially
  proposed reusing directly) only increments for rows that DO assert a
  year (line 1281-1282). Naively reusing `support === uniqueRows` as the
  unanimity check would therefore count a SILENT row (no year token in
  that listing's title — neutral, no claim made) as equivalent to a
  DISSENTING row (a different year explicitly asserted) — both would
  suppress promotion identically, when only the second is a real
  disagreement. Named explicitly per the user's instruction: **"silence
  counted as dissent."** Fixed by `evaluateUnanimousYearConsensusPromotion`
  recomputing directly from raw `indices`/`visualItems` rather than
  reusing the family-consensus object's aggregate fields at all: tallies
  only rows that assert a year (`analyzeYearAssertions`), requires
  `assertingCount >= 3`, requires zero dissent among the asserting rows
  (any asserting row naming a different year is a hard fail — the
  standing rule, "conservative direction preferred when uncertain," made
  explicit at the row level), and applies the identical
  itemId/seller-distinctness check as Fix 2. Verified directly against
  the real repro shape before shipping: 3 rows unanimously asserting one
  year, 1 silent row — would have wrongly DECLINED under the naive
  `support === uniqueRows` reuse (the silent row drags `support` below
  `uniqueRows`), correctly PROMOTES under the corrected, assertion-scoped
  predicate. On promotion, `'year'` is deliberately never appended to
  `identityProvisionalFields` (there is no removal primitive for that
  list; not appending in the first place is the correct representation
  of "no longer provisional").

  **V4 — found in review before push, not by any test: "status
  promotion orphans a status-gated guard."** Fix 2's promotion
  unconditionally unlocked two things at once: the CV/PC exact-identity
  lookup and active-cache paths that were correctly skipped while
  provisional, AND `escalateIssueAuthorityOnConflict`
  (`issueAuthority.js`), which existed before this dispatch specifically
  to re-escalate a marketplace-only-adopted issue back to `'conflicted'`
  if later evidence disagreed with it. That function's original guard
  checked `status === 'provisional'` only — so a row promoted to
  `'confirmed'` by Fix 2 could never re-escalate again, even on a
  genuine later contradiction. **A safety regression shipped inside a
  safety fix**, and the general lesson is the point worth keeping: any
  code path that promotes/upgrades a status field must grep every
  consumer that gates on the PRE-promotion value before shipping — a
  promotion is not just "this row is now trusted more," it is also
  "every guard that only fires on the old, lower-trust status now goes
  silently dark for this row." Nothing in Fix 2's own test suite caught
  this, because nothing in that suite exercised the conflict-escalation
  path against a promoted row — it took a second, explicit review pass
  before push to find it, not a red test.

  The user explicitly forbade the obvious-looking fix
  (`status === 'provisional' || status === 'confirmed'`), since that
  would let ANY confirmed row — including one confirmed via the
  catalog/user-correction route, which this project's standing authority
  matrix (catalog holds identity authority, marketplace holds
  pricing-evidence authority only) treats as strictly higher-trust than
  marketplace consensus — be knocked back down by a mere marketplace
  pool disagreement. Verified directly against
  `manualCorrection.js:599-605`, the real other-confirmed route:
  `{source:'user', status:'confirmed', reasons:['user-correction']}` —
  no `'unanimous-marketplace-consensus'` reason present. Fixed with
  provenance instead of a loosened status check, reusing this file's own
  pre-existing convention rather than adding a new field: promotion now
  appends `'unanimous-marketplace-consensus'` to `issueAuthority.reasons`
  (the same array `escalateIssueAuthorityOnConflict` already read for its
  provisional-case check, `reasons.includes('marketplace-only-adoption')`
  — the array was already the live provenance mechanism in this file
  before this session touched it). `escalateIssueAuthorityOnConflict`'s
  eligibility is now `(status==='provisional' && reasons.includes(
  'marketplace-only-adoption')) || (status==='confirmed' &&
  reasons.includes('unanimous-marketplace-consensus'))` — a confirmed
  row is only escalatable if its OWN reasons explicitly say it arrived
  via this dispatch's marketplace-consensus route; the user-correction
  route's `reasons` array never contains that string, so it structurally
  cannot be knocked back down by marketplace disagreement, preserving the
  authority matrix by construction rather than by convention.
  `computeIssueAuthorityContractPatch` verified (not assumed) to already
  handle `'conflicted'` uniformly regardless of which status it
  escalated from — no `escalatedFrom`-style branching exists anywhere in
  that function, so no change was needed there. The one real
  escalation call site (`api/enrich.js`) now captures `originStatus`/
  `wasPromoted` before calling and logs which origin produced a given
  `'conflicted'` outcome, so a promoted-then-conflicted row is
  distinguishable in logs from a provisional-then-conflicted one.

  Regression: `tests/grailkey-dispatch-25-fix2-unanimous-promotion.test.js`,
  38 assertions — sections 1-8 cover Fix 2/2b promote/decline cases
  including the exact real repro shapes for both axes; sections 9-12
  (added for V4) cover promoted-confirmed+conflict escalates,
  catalog/user-confirmed+conflict does NOT escalate (the proof this fix
  is provenance-scoped, not status-loosened), provisional+conflict still
  escalates (regression guard on the original mechanism), and
  promoted-confirmed+no-conflict stays confirmed (referential no-op).
  Full pre-existing suite sweep re-run clean after the V4 amend, working
  tree confirmed clean via `grailkey-commit-e`/`-f` going green (both are
  the pre-documented "false-fails on any uncommitted diff" tests
  elsewhere in this file — their passing here is itself part of the
  verification, not incidental). Fix 3 (Vision virgin-variant prompt
  change) remains explicitly HELD, not started this session.

  **PRODUCTION VALIDATION (2026-08-08, GrailKey Dispatch 27, build
  `4f9a62c`).** The Spawn #351 re-scan that motivated Dispatch 26 landed
  on `mode==='adopted'` — Fix 2/2b's own path, not Fix 4/4b's — and
  validated both fixes directly against real production data, verbatim:
  ```
  [commit4-promote] PROMOTE issue=#351 uniqueRows=4 support=4
    runnerUp=null weightSum=11 uniqueItemIdCount=4/4
    uniqueSellerCount=4/4 — provisional -> confirmed
  [commit4-promote-year] PROMOTE year=2024 assertingRows=3 silentRows=1
    dissentingRows=0
  [evidence-target] issueAuthorityStatus="confirmed"
  [evidence-eligibility] activeInput=14 rawPricingEligible=14 rejected=0
  ```
  The year promotion is the EXACT Fix 2b corrected-denominator shape
  this entry documents above (3 asserting rows, 1 silent, 0 dissent) —
  under the naive `support === uniqueRows` reuse Fix 2b replaced, this
  would have wrongly declined (`support=3 !== uniqueRows=4`). Confirmed
  live, not just in the regression fixture: zero comps eliminated
  (`rejected=0` of 14), the book priced. Fix 4/4b (this same session,
  GrailKey Dispatch 26) shipped alongside this validated path but were
  NOT exercised by this scan — record that distinction explicitly: Fix
  2/2b is production-validated; Fix 4/4b remains shipped but
  UNVALIDATED in production, pending a scan that actually reaches the
  `mode==='conflict-locked'`/zero-support shape.

- **GrailKey Dispatch 25, Fix 2c (2026-08-07) — Batman #213 class:
  title-family weight margin was reported as an issue-authority
  conflict.** `identityCore.js`'s near-miss margin-decline branch
  (Commit 4.3.1, `isNearMissMarginDecline`) measures its 3x dominance
  requirement purely on TITLE-FAMILY WEIGHT
  (`familyDominatesRunnerUp(topFamily.weightSum, runnerUp.weightSum)`,
  `compHygiene.js:203-206`) — zero awareness of what issue number either
  family's own rows assert. A real production scan (Batman #213, scan
  23:13:49 UTC, build `b2c7358`) hit this: two competing TITLE clusters
  ("batman giant 30th anniversary issue origin robin" vs "batman dc"),
  margin 1.3 against a required 3 — but every row in BOTH clusters, and
  the raw pool overall (19/19), asserted issue #213. Verified by direct
  source read (STEP A, before any code was written): the near-miss
  branch only ever measures `resolveFamilyIssueConsensus` against
  `topFamily.indices` — `runnerUp.indices` was never read at all — so it
  wrote `outcome:'conflicted'` unconditionally whenever the margin
  failed, regardless of whether the competing family agreed. That false
  conflict reached the card verbatim via `api/enrich.js`'s
  `out.issueConsensusConflict` construction
  (`identity.familyIssueConsensus?.mode==='conflict-locked'` gate,
  ~line 2935): "Marketplace listings disagree on this book's issue
  number" — false when every row agrees. Wrong axis, the same disease
  class as Fix 2b's denominator and vision-zero-support.

  Fix: before recording a conflict, measure the DISTINCT set of issues
  asserted by the top family AND by the runner-up (the only competing
  family the margin predicate itself concerns — it is `scored[1]`, the
  sole family ever compared against `scored[0]`). Agreement requires
  UNANIMITY, not plurality: both families' own asserted-issue sets must
  each have size exactly 1, and those two single values must match. If
  so, there is no issue conflict — `familyIssueConsensusResult` is left
  `null` (not populated with a new "agreed" pseudo-state) so every
  downstream consumer evaluates the field exactly as if no near-miss had
  occurred at all. A genuine disagreement — either family internally
  split, or both unanimous but on different issues — is unaffected, same
  `'conflicted'` outcome as before, confirmed unchanged against the
  pre-existing 73-assertion
  `q-trackB-commit4.3.1-retention-decline-fail-closed.test.js` suite
  (its own fixture's runner-up is a lot listing with no coherent issue
  of its own — correctly still conflicts under the fix).

  **Two implementation traps found and fixed before shipping — both
  caught by the user's own review, not by the first-pass test suite.**
  (1) The obvious choice, comparing `resolveFamilyIssueConsensus(...).issue`
  on both families, is silently wrong: `.issue` is gated behind the
  standing uniqueRows>=3 adoption floor (the "Issue-consensus guard"
  standing constraint elsewhere in this file) — a real 2-member
  synthetic runner-up family whose both rows plainly assert the same
  issue returns `{issue: null, mode: 'no-consensus', winner: '213', ...}`.
  Caught during test authoring, not static review: the first fixture
  attempt failed against `.issue` and revealed the floor directly. (2) A
  first-shipped correction reached for `.winner` (raw per-row PLURALITY)
  instead — this is a SECOND, more dangerous defect, caught only in
  review before push: `.winner` is populated the instant a single
  non-tied top candidate exists, regardless of whether every row agrees.
  A 3-row runner-up with two rows asserting #213 and one asserting #300
  has `.winner==='213'` — plurality — so the `.winner`-based version
  would have suppressed a GENUINE conflict on live dissent. Explicitly
  named as the fourth instance this session of the "measuring coherence
  against the wrong population" disease class — and its own inverse of
  Fix 2b's bug: there, silence was wrongly counted as dissent; here,
  dissent would have been wrongly absorbed by plurality. Fixed by using
  `.assertedIssues` (the distinct SET of values a family's rows assert —
  `Object.keys(counts)` inside `resolveFamilyIssueConsensus`, entirely
  unfloored, same underlying tally `.issue`/`.winner` are both built
  from) and requiring its size be exactly 1 on BOTH families before
  calling it agreement — silence (a row asserting nothing) stays neutral
  per Fix 2b's own rule, but any row asserting a genuinely different
  value fails unanimity outright, regardless of how rare it is relative
  to the majority.

  Logs `[commit4.3.1-axis-check]` with `topFamilyAssertedIssues`,
  `topFamilyIssueCounts` (a local, read-only per-family tally —
  `tallyFamilyIssueCounts`, `identityCore.js` — deliberately mirroring
  `resolveFamilyIssueConsensus`'s own row-counting loop exactly rather
  than adding a field to that function's return shape, which is spread
  verbatim into `familyIssueConsensusResult` at multiple call sites, at
  least one of which has an existing exact-full-object-shape regression
  assertion — `q-trackB-commit4.2-fingerprint-year-restamp.test.js`,
  confirmed unaffected, still 160/160), `runnerUpAssertedIssues`,
  `runnerUpIssueCounts`, `topUnanimous`, `runnerUpUnanimous`, and
  `decision` on BOTH paths (agree/disagree) — never silent. 60 assertions
  (`tests/grailkey-dispatch-25-fix2c-axis-check.test.js`, up from an
  initial 31 before the unanimity correction): the real near-miss shape
  (genuinely emergent weights from real row positions, not hand-set) for
  the agreement case (Batman #213 itself, some rows silent elsewhere in
  the wider pool), a full-disagreement regression guard (both families
  unanimous but on different issues), a no-runner-up sanity check, and —
  the two cases the plurality defect required — a runner-up internally
  split 2x#213/1x#300 (conflict correctly stands; this fixture is proven
  to be exactly the shape that would have wrongly agreed under the
  rejected `.winner`-based version) and a top family internally split
  (conflict stands regardless of a unanimous runner-up). Full
  pre-existing suite sweep re-run clean; `npm run build` clean.

  **Regression-baseline discipline (V-A, per explicit instruction):**
  every failing suite in the post-fix sweep was individually checked
  against a clean `git worktree` at `bf543d6` (the commit immediately
  preceding Dispatch 25's first commit), not summarized as "matches
  documented baseline." `artist-registry-sync` (163/2),
  `decision-engine` (39/7), `image-search-extraction` (161/2),
  `mega-keys` (198/8), `pattern-k-dedupe-issue` (4/4), `priceBands`
  (24/7), `sold-verification` (124/5), `comp-filter-hygiene`,
  `identity-gate`, `q-adv397-visual-guard`, and `batch1-fixes`
  (throws-on-first, same first assertion) all reproduce byte-identical
  failures at `bf543d6` once the worktree's missing `node_modules`
  symlink was fixed (a worktree doesn't share `node_modules`, which
  isn't git-tracked — the first baseline run threw
  `ERR_MODULE_NOT_FOUND` for unrelated files, not a real difference).
  `grailkey-commit-m-pc-query-fallback` and `ship26-integration` both
  time out identically at `bf543d6` too (network-dependent — no
  `KV_REST_API_URL`/PriceCharting token in this sandbox). `grailkey-
  commit-v1`'s drift was already proven pre-existing earlier this
  dispatch (checked out `bf543d6`, same 24-vs-25 mismatch, unrelated to
  Dispatch 25 entirely). `grailkey-commit-e`/`-f`/`-g` are the
  documented "false-fail on any uncommitted diff" tests (`git diff
  --name-only HEAD` against the live working tree, not the historical
  commit diff) — expected to fail whenever ANY uncommitted change
  exists, which one genuinely did at sweep time; `-g`'s own failure text
  names the exact extra file (`src/lib/identityCore.js`), confirming the
  mechanism directly rather than by assertion. All three go green
  immediately upon commit (already demonstrated twice earlier this
  dispatch, for `81ca1d2` and again expected here).

  **Downstream investigation, reported not fixed blind (per explicit
  instruction) — `confirmedPublisher` resolving to `null` on this same
  book. CORRECTED after an initial reported comp-title count turned out
  wrong (a misread of a different log figure, `[cv-pool-year-hint]`'s
  11/11 year-agreement, not a DC publisher count).** Real counts from
  the 19 visual titles: "DC Comics" exact phrasing 3/19 = 15.8%; any
  form including bare "DC" 7/19 = 36.8%. Two independent publisher paths
  exist. (1) `comicVine?.publisher` fallback (`api/enrich.js:4594`) is
  genuinely gated on the CV/PC exact-identity lookup skip
  (`marketCustodyConflicted`, driven by `out.issueAuthority.status===
  'conflicted'`) — Fix 2c resolves this one for free, since the
  axis-agreement case no longer sets that status. (2)
  `backfillFromComps`'s comp-consensus publisher backfill
  (`identityCore.js:2668`, called `api/enrich.js:4539`) reads
  `visualResult?.items` directly and is NOT gated on `issueAuthority` at
  all. Verified precisely against source: `hitRatio`'s denominator
  (`identityCore.js:2824`) is `compTitles.length` — essentially the full
  comp pool — not narrowed by the separate `titleMatchRatio>=0.7`
  precondition gate a few lines up, which only decides whether ANY
  publisher-backfill attempt is allowed at all, not which titles count
  toward the ratio. Against the `>=0.5` backfill floor, **both real
  counts fail** — even the generous "any form" figure (36.8%) falls
  well short. Confirmed: on this specific book, the bare-word "DC"
  pattern gap (found while investigating, real as a general observation
  — see GK-37 below) would NOT have rescued publisher resolution either
  way. `confirmedPublisher` on Batman #213 resolves only via the CV/PC
  path Fix 2c unblocks — not via comp-consensus regardless of pattern
  coverage. The pattern gap itself is downgraded to its own logged
  finding (GK-37), explicitly not scoped as part of Fix 2c.

- **GK-36 (2026-08-07, GrailKey Dispatch 25) — `[ship11]
  visual_pool_fallback` median is not grade-scoped. LOG ONLY, not
  scoped or acted on this session, per explicit instruction.**
  `api/enrich.js:9149-9184`: when the primary comp pipeline returns zero
  verified/sold comps and the eBay visual-similarity pool has >=10 items
  with >=5 valid prices, the block computes `median`/`low`(p25)/`high`
  (p75) directly from `poolPrices` — every priced item in the visual
  pool, unconditionally, with **no grade filter of any kind** against
  the book's own actual grade. Confirmed via direct source read: the
  only filters applied are `Number.isFinite(p) && p > 0 && p < 10000`
  (numeric sanity), nothing grade-related. Reported on a real GD 2.0
  book: `median=$71.85` from a pool spanning VG through VF/NM
  ($34.99-$153.00) — not representative of the book's actual condition.
  `out.pricingSource`/`out.price` ARE set to this value when the block
  fires (lines 9165-9175), so on a book where this is the terminal
  pricing path it would be the shown price, not merely a reference
  figure — worth re-checking against the specific request that surfaced
  this the next time it's investigated, since "not used as price here"
  implies some other path won out on that particular scan. Not scoped,
  not fixed, no threshold touched.

- **GK-37 (2026-08-07, GrailKey Dispatch 25) — `PUBLISHER_CONSENSUS_PATTERNS`
  has no bare-word fallback for major publishers (DC/Marvel/Image/etc.).
  LOG ONLY, not scoped or acted on this session — explicitly downgraded
  out of Fix 2c after V-B correction (see that entry above): confirmed
  NOT the cause of Batman #213's `confirmedPublisher=null`, since even
  the generous "any bare-DC form" count (36.8%) falls short of the
  backfill floor on that specific book.** `identityCore.js:2572-2600`:
  DC's entry is `\b(?:dc\s+comics?|dc\s+universe|dcu)\b` — requires "DC"
  followed by "Comics"/"Universe," or the exact token "DCU." No bare-word
  "DC" pattern exists, unlike Charlton/Eclipse/Warren, which explicitly
  got one added (same list, Q96 comment) specifically because casual
  eBay listing titles often drop "Comics." Marvel/Image/Dark
  Horse/IDW/BOOM!/Valiant/Archie share the identical shape — full-name-
  only, no bare-word fallback — while several smaller indies do have
  one. This is a real, general asymmetry in the pattern table (the
  publishers most likely to be shortened casually in listing titles are
  exactly the ones with no fallback for it), independent of any single
  book's resolution. Not scoped, not fixed, no pattern added — a future
  dispatch should decide whether adding bare-word fallbacks for the
  major publishers is warranted, and if so, whether a higher hit-ratio
  floor is needed for a bare 2-letter/short token to avoid false
  positives that "DC Comics"/"Marvel Comics"-style full phrases don't
  risk.

- **"Measuring coherence against the wrong population" — four instances
  in one session (2026-08-07, GrailKey Dispatch 25). The frequency is
  itself the finding.** (1) vision-zero-support's `visionIssueCount===0`
  equality check (prior dispatch, referenced in this session's Fix 1/2
  root-cause work) measured presence against the WRONG population
  boundary (exact-zero vs. near-zero support). (2) Fix 2b's year-axis
  promotion predicate: `resolveFamilyYearConsensus`'s own `support`/
  `uniqueRows` denominator is family MEMBERSHIP (every row, silent or
  not), not ASSERTION — a naive reuse would have counted a silent row
  against unanimity exactly like a dissenting row ("silence counted as
  dissent"). (3) Fix 2c's first draft: `.issue` is gated behind the
  unrelated uniqueRows>=3 adoption floor — a real 2-member family that
  unanimously agrees returns `issue: null` anyway, because the FLOOR's
  population (rows needed to trust ADOPTION elsewhere) is not the
  question being asked (do these rows agree with each other at all).
  (4) Fix 2c's second draft: `.winner` measures PLURALITY across a
  family's rows — the wrong population is "the majority" when the actual
  question is "every row, including the minority." A 2-of-3 majority
  read as agreement while a real dissenting row sat in the pool
  unexamined.
  Every instance has the same shape: a value or threshold that is
  correct and well-tested FOR THE QUESTION IT WAS ORIGINALLY BUILT TO
  ANSWER gets reused for a DIFFERENT question that sounds similar but
  scopes a different population — adoption-worthiness vs. mere
  agreement, membership vs. assertion, majority vs. unanimity. None of
  the four were caught by writing the predicate correctly the first
  time; all four were caught by either dedicated verification steps or
  by review before push, never by intuition about what a field named
  `.issue` or `.winner` "obviously" measures.
  **Standing check, going forward: before writing any consensus or
  agreement predicate, name the population the CANDIDATE FIELD actually
  measures and the population THE QUESTION AT HAND is actually about,
  and confirm the two match, in writing, before the code is written —
  not after a test fails.** This is now the highest-yield single check
  available for this class of bug in this codebase, evidenced by a 4-for-4
  hit rate in one session once someone started asking it explicitly.

- **CORRECTED (2026-08-08, GrailKey Dispatch 26, before any code was
  written) — Dispatch 26's own opening diagnosis was wrong about WHICH
  gate blocked the Spawn #351 (Cover C Brett Booth virgin variant) family
  alternate, and the wrong framing is retracted here rather than left
  standing.** The dispatch's initial repro writeup attributed the miss to
  "a TITLE-axis block suppressed an ISSUE-axis adoption" — i.e., Q84's
  title-safety gate (`family.decision === 'fallback-vision'`). Verified
  false by direct source read (STEP A, `identityCore.js`) before any fix
  was scoped: Commit 4.3's retention branch (`isQualifiedFamilyForRetention`,
  ~line 2031) exists specifically to survive a Q84 title-axis block, and it
  fired correctly on this exact scan — the family's 4/4=100% unanimous
  issue consensus (`#351`, weightSum 13.0) WAS measured and reached
  `decideFieldAuthority` (`identityCore.js:1505`). Q84 is not the gate that
  discarded the alternate; Commit 4.3 already defeats that mechanism, as
  designed.

  The real gate is `decideFieldAuthority`'s Rule D (`identityCore.js:1561-1564`,
  GrailKey Dispatch 25's own IMPLEMENTATION PACKET HOLD): a Vision prior
  that is untrusted (`priorIndependentlyTrusted=false`) but self-reports
  `confidence:'high'`, with ZERO support inside an otherwise-unanimous
  qualified family, is deliberately routed to `outcome:'conflicted',
  authoritativeForCustody:false` rather than silently adopting the
  family's value — a design decision from Dispatch 25 to protect a
  confident Vision read from being silently overridden. `legacyModeFor`
  then maps that to the legacy mode `'conflict-locked'`
  (`identityCore.js:2095`), which fails `familyAuthoritySkip`'s
  `mode==='adopted'||'corroborated'` check (~line 2338), and the
  zero-support ESCALATE branch (~line 2361) falls through to a check of
  the RAW, unclustered pool's `ebay.issue`/`ebay.noIssueConsensus` only —
  never re-consulting `familyIssueConsensusResult`, which is fully present
  at that point but was already read once (for the coarse skip check) and
  discarded.

  Net effect unchanged from the dispatch's original conclusion (a real,
  unanimous family alternate is discarded in favor of ID_REQUIRED) — only
  the MECHANISM was misattributed. Filed as its own entry, not folded into
  the "wrong population" pattern above: this is a different disease
  (correct population, correct measurement, but a confidence-based override
  rule applied to a case — Vision confident on a virgin variant with no
  printed issue number, 0/20 raw-pool support, 0/4 family support — where
  the self-reported confidence itself has no corroboration and should not
  have earned the veto). Fix 4 (scoping in progress) targets Rule D's
  confidence carve-out directly, not the population-measurement class of
  bug this correction sits next to.

- **"Independent posting is not independent identification" (2026-08-08,
  GrailKey Dispatch 26, Fix 4 scoping) — caught by asking the risk
  question before shipping, not by a test.** While scoping Fix 4's
  zero-support rescue predicate (reuses `evaluateUnanimousConsensusPromotion`,
  `issueAuthority.js`), the question "construct a case where Vision is
  right and a unanimous, distinct-seller family is wrong" produced a
  concrete, realistic answer: eBay sellers routinely copy a competitor's
  listing title verbatim for search-ranking reasons (a well-documented,
  non-adversarial marketplace behavior, not collusion). If the first
  seller to list a hard-to-identify book (a no-printed-issue-number
  virgin variant, exactly Fix 3's target class) mislabels it, later
  sellers copying that title text propagate the identical wrong number
  under their own distinct account, distinct item ID, distinct listing.
  `checkDistinctItemIdAndSeller` (`issueAuthority.js:188-210`) — the
  anti-collusion guard `evaluateUnanimousConsensusPromotion` already
  relies on for both the issue-axis and year-axis unanimous-promotion
  predicates (Fix 2/2b, this same dispatch) — answers "were these
  listings independently POSTED," which it does correctly. It cannot
  answer, and was never built to answer, "did these sellers independently
  IDENTIFY the book." Four distinct sellers carrying one propagated
  labeling error look identical, to that check, to four sellers who each
  independently read the cover and agreed.

  The fix is not a new axis of distrust — it's a signal already latent in
  the data. Copy-propagated titles are near-identical strings; independently-
  authored titles describing the same real book diverge in wording,
  ordering, and which details get mentioned. Verified directly against the
  real Spawn #351 repro's four family-member titles: pairwise Jaccard
  token-set similarity (the same metric `buildTitleFamilies` already uses
  for coarse family formation, `imageSearchIdentity.js:1046-1055`, reapplied
  within a family at a much higher threshold to detect near-duplicates
  rather than same-book clustering) separates one genuinely-copied pair
  (0.929) from every other pairing (0.368–0.538) with a clean gap — the
  two listings sharing the identical "cameo of lyra htf scarce" boilerplate
  phrase are the copy-propagated pair; the other two are independently
  worded. See Fix 4's sixth condition (title-text independence, ≥3 distinct
  clusters among asserting rows) for the shipped predicate.

  General lesson, stated for reuse: **any predicate that treats
  seller-distinctness or listing-ID-distinctness as evidence of
  independent corroboration is measuring the wrong thing** — distinct
  postings prove nothing about how many people actually looked at the
  book and formed an opinion, only that nobody technically reused an
  account. Anywhere this codebase leans on "N distinct sellers" as a
  trust signal (currently: `checkDistinctItemIdAndSeller`, both call
  sites) should be read as "N distinct postings, authorship not yet
  verified" until a text-independence check like this one is layered on
  top.

- **GK-38 (2026-08-08, GrailKey Dispatch 26) — Fix 2's issue-axis path
  renders a correction box on a book it just confirmed. LOG ONLY, not
  fixed this pass.** Found while reviewing Fix 4's own `out.issueAuthority`/
  `out.identityProvisionalFields` wiring (P1-1, same dispatch): Fix 2's
  promotion call site (`api/enrich.js`, the `mode==='adopted'` branch)
  calls `deriveIssueAuthorityFromAdoption`, which unconditionally returns
  `identityProvisionalFields: ['issue']` for the 'adopted' case
  (`issueAuthority.js:508`) — set BEFORE Fix 2's own promotion check
  (`evaluateUnanimousConsensusPromotion`) even runs, and never revisited
  afterward. When promotion succeeds and `out.issueAuthority.status`
  becomes `'confirmed'`, `out.identityProvisionalFields` still carries
  `'issue'` — `getCorrectableFields` (`manualCorrection.js:286-291`, real
  render site `App.jsx:6001`) unions `identityProvisionalFields` with
  `identityMissingFields` with no awareness of `issueAuthority.status` at
  all, so a Fix-2-promoted book renders an "Issue #" correction input
  exactly as if the issue were still an unconfirmed marketplace guess.
  Contrast Fix 2b (year axis), which already gets this right by design —
  its own doc comment: "'year' NOT appended to identityProvisionalFields
  at all... not appending is the only correct way to represent 'not
  provisional'" (there is no removal mechanism anywhere in this codebase,
  so the only way to avoid this state is to never enter it). Fix 4's own
  new rescue branch (this dispatch) was built correctly from the start —
  it never sets `identityProvisionalFields` for the field it confirms,
  matching Fix 2b's precedent rather than Fix 2's. Real, user-visible,
  pre-existing (Fix 2 shipped GrailKey Dispatch 25, 2026-08-07) — not
  touched here: fixing it means either making `deriveIssueAuthorityFromAdoption`
  promotion-aware (a signature change) or having Fix 2's own promotion
  block strip `'issue'` back out of `out.identityProvisionalFields` after
  a successful promotion (no removal mechanism currently exists for that
  either — would be the first). Scoping either belongs to its own
  dispatch, not folded into Fix 4/4b.

- **GK-40 (2026-08-08, GrailKey Dispatch 27) — three independent variant-
  token vocabularies, plus two same-named-but-different functions. LOG
  ONLY, its own dispatch, not consolidated here.** Found while diagnosing
  why a 16/20-consensus "virgin" signal (Spawn #351, real production
  scan) never reached `confirmedVariant` and, independently, why
  `soldVerification.js` rejected 11 real virgin sold comps outright. The
  fourth recorded instance of the drifted-duplicate-constant class
  (Q119/Q127/Q128 were the first three — all VALUE-level constants; this
  is the first at the FUNCTION/vocabulary level). Three separate lists,
  all encoding roughly "which physical cover-treatment terms exist,"
  independently extended over time:
  - `src/lib/compHygiene.js:extractVariantTokensByAxis`'s `coverType`
    axis — 3 tokens (`foil`, `virgin`, `sketch`), bare substring regex,
    no `\b` word-boundary. This is the ONLY one `soldVerification.js`
    (`:56,655-657`) actually reads when comparing a comp's title against
    `confirmedVariant`.
  - `src/lib/imageSearchIdentity.js:CATEGORY_BLOCKS`'s `'finish'` kind
    (`FINISH_PATTERNS`) — 10 tokens (adds `gold foil`/`silver foil`/
    `holofoil`/`holographic`/`glow-in-dark`/`embossed`/`metallic`),
    `\b`-bounded. Feeds `item.variantTokens` on every pool row
    (`imageSearchIdentity.js:407`) and `extractConsensus`'s own
    per-category consensus — this is where the real scan's `[image-
    search-titles]` log's `tokens:["virgin"]` actually came from.
  - `src/lib/compHygiene.js` ALSO exports its own, second,
    **identically-named** `extractVariantTokens` (line 1427) — a flat
    wrapper over its own `extractVariantTokensByAxis` — confusable with
    `imageSearchIdentity.js`'s unrelated `extractVariantTokens` (line
    262) of the same name in a different file. `variantIdentity.js`
    imports the `imageSearchIdentity.js` one; `soldVerification.js`
    imports the `compHygiene.js` one. Neither file's own token vocabulary
    is aware the other exists.
  Verified directly (not assumed): extracting via the richer
  `imageSearchIdentity.js` 'finish' list and feeding it into
  `confirmedVariant` would silently fail to round-trip for 4 of its 10
  tokens (`holographic`/`glow-in-dark`/`embossed`/`metallic` — none
  contain the substrings `foil`/`virgin`/`sketch` `compHygiene.js`'s
  narrower regex checks for) — confirming a variant `soldVerification`
  could never subsequently match, the exact "nothing changes" failure
  the fix this dispatch's own predicate had to route around. Fix 27-A
  (below) reads `compHygiene.js`'s narrower list specifically, BY
  CONSTRUCTION guaranteeing the round-trip, rather than consolidating
  the three vocabularies — a real, separate piece of work (which list
  should be canonical, whether the richer 'finish' set should be taught
  to `compHygiene.js`'s coverType axis or vice versa, and a rename to
  de-collide the two same-named `extractVariantTokens` exports) that
  belongs to its own dispatch, scoped and greenlit on its own, not folded
  into a pricing fix under time pressure.

  **GK-40 addendum (2026-08-08, GrailKey Dispatch 28) — a fourth
  independent variant-token vocabulary, found while diagnosing why
  `buildVerifiedActivePool`'s Q75 filter rejected the same 4 comps the
  variant preference filter had just accepted.**
  `src/lib/priceBands.js:329`, `VARIANT_CONTAM_ACTIVE = /\b(1:25|1:50|
  1:100|1:500|incentive|sketch|virgin|timeless|ratio|exclusive|
  convention|sdcc|nycc)\b/i` — its own bare hand-rolled list, matching
  none of the three named above. **Confirmed NOT the actual cause of the
  Q75 rejection** (GrailKey Dispatch 28 STEP A1): the real defect was a
  stale INPUT VALUE (`safeReqVariant`, pre-consensus, passed where
  `confirmedVariant` was needed — see the "deferred debt" entry below),
  not the vocabulary itself — even a perfectly shared vocabulary would
  have misfired against the wrong input. **Deliberately NOT touched**
  when the real fix shipped: with `confirmedVariant` correctly wired,
  `scanIsVariant` is true and this regex never evaluates for this class
  of book — the vocabulary divergence goes DORMANT, not fixed. Flagging
  explicitly: a future change that nulls or bypasses `confirmedVariant`
  on this code path reactivates this exact divergence. Left for the
  consolidation dispatch GK-40 already scopes.

- **"Deferred debt promoted to live by a downstream fix's success"
  (2026-08-08, GrailKey Dispatch 28) — a distinct class from GK-40's
  vocabulary drift and from the wrong-population family. SHIPPED.**
  `enrich.js:6529`'s `computePriceBandsFromSold` call passed
  `variant: safeReqVariant` (the raw, pre-consensus request field)
  instead of `confirmedVariant` — one wrong variable, two simultaneous
  symptoms: `buildVerifiedActivePool`'s Q75 filter (`priceBands.js`)
  saw a false `scanIsVariant=false` and rejected a book's own confirmed-
  variant active comps down to zero; `isActivePoolVariantConfirmed`'s
  `!variant` early-return starved GK-31's own already-shipped
  `activeAnchoredOverFallbackSold` mechanism — built specifically to
  anchor to a confirmed variant-matched active pool instead of blending
  in wrong-variant sold-fallback data — so it never got the chance to
  fire even though the exact condition it exists for was present.

  This was not a fresh oversight. `enrich.js:5152-5167` (Commit D2,
  2026-08-02) explicitly named this exact gap and consciously deferred
  it: *"req.body.variant itself is left untouched for its other
  existing consumers (variant-multiplier block, computePriceBandsFromSold,
  AI-verify prompt) — out of scope for this dispatch."* The gap sat
  inert for six days because `confirmedVariant` was categorically never
  populated from backfill at all before Fix 27-A (GrailKey Dispatch 27)
  — `safeReqVariant` and `confirmedVariant` were identical (both null)
  for any book reaching this shape, so the wrong-variable bug had no
  observable effect. The moment Fix 27-A started producing real,
  non-null backfilled values, the six-day-old deferred gap became
  load-bearing on the very next relevant scan.

  Fixed as a bare one-line substitution (`variant: safeReqVariant` →
  `variant: confirmedVariant`), not a composite re-guarded expression —
  verified, not assumed, that `confirmedVariant` already carries both
  guards `safeReqVariant` encodes (`suppressVariantForYearConflict` via
  two redundant paths — `safeReqVariant`'s own null-out, which seeds
  `confirmedVariant`, AND the separate `variantCheck = ... ? null : ...`
  gate on the pool-consensus update itself — and `variantProvenanceValid`
  the same way, plus Fix 27-A's own backfill path being independently
  safe regardless since it's scoped to `confirmedIssue` by construction
  via `filterItemsByIssue`). Re-deriving either guard a second time at
  the pricing call site would have been exactly the kind of redundant,
  independently-drifting logic GK-40's vocabularies show the cost of.
  Every other consumer of the same parameter audited (`buildVerifiedSoldPool`
  destructures `variant` but never reads it — confirmed dead, noted in
  its own doc comment so a future reader doesn't wonder).

  **The general check this implies, for reuse whenever a fix starts
  producing real values in a field that was categorically null/empty
  before: grep every consumer of that field, AND every sibling variable
  that was previously interchangeable with it while the field was
  always empty — the divergence between them only becomes observable
  once the field stops being empty, exactly like the value-vs-variable
  confusion this entry documents.**

- **Accepted residual risk (2026-08-08, GrailKey Dispatch 27, Fix
  27-A) — population contamination on `fallback-vision` variant
  extraction, defended by exact-unanimity, not by population-scoping.**
  `variantSourceItemsPreIssueFilter` (`api/enrich.js:5228-5233`) uses the
  FULL raw visual pool (not the winning title-family) whenever
  `familyCandidate.decision === 'fallback-vision'`, narrowed only by
  `filterItemsByIssue`'s per-row issue-number text match — never by
  title-cluster membership. Deliberately NOT reworked to scope to
  `family.topFamily.indices` instead: doing so requires either exposing
  a new "is this family qualified" signal out of `resolveIdentity`
  (`identityCore.js`'s `isQualifiedFamilyForRetention` is presently a
  local, unexported variable) or re-deriving that exact predicate a
  second time at the variant call site — the latter would be a FOURTH
  independently-drifting copy of the same population-qualification
  logic GK-40 already names one instance of, at the function-vocabulary
  level, and Q119/Q127/Q128 name at the value level. The existing
  raw-pool behavior is also deliberately load-bearing for the GENERAL
  `fallback-vision` case (Q115 dispatch, Batman #608: title-clustering
  itself found no coherent family at all, so scoping to a "family" would
  scope to nothing trustworthy) — reworking it purely for this dispatch
  risks reintroducing that exact regression for the many `fallback-
  vision` scans that never reach a qualified family.

  Instead, Fix 27-A relies on `evaluateUnanimousConsensusPromotion`'s
  own exact-unanimity requirement (`support === uniqueRows`) as the
  practical defense — identical reasoning, identical population, and
  identical residual risk to Fix 4's own issue-axis rescue, which
  already accepted this exact trade-off on this exact population. A
  contaminating row from a different, same-issue-number variant cluster
  would almost always assert either a different coverType token or none
  at all, failing exact unanimity and declining the whole rescue —
  fail-closed, consistent with the standing "when uncertain, leave
  null" principle. **Explicitly NOT a complete defense**: a
  contaminating row that coincidentally also asserts the SAME coverType
  token (e.g. a second, genuinely different virgin-variant product
  sharing the same issue number) would slip through either way, whether
  or not the population were family-scoped — narrowing to the family
  would not have closed this specific residual case either. Accepted
  as a known, named, residual risk rather than built around, per
  explicit instruction.

- **Fix 27-A PRODUCTION VALIDATION (2026-08-08, GrailKey Dispatch 28,
  build `75a2ba3`).** The Spawn #351 re-scan fired exactly as predicted,
  verbatim:
  ```
  [coverType-consensus] FIRE winner=virgin support=4/4 runnerUp=null
    promotion.declineReason=none uniqueItemIdCount=4/4
    uniqueSellerCount=4/4 independence.pass=true assertingRows=4
    distinctClusters=3 largestClusterSize=2 maxPairwiseJaccard=1
    minPairwiseJaccard=0.3888888888888889
  [identity-write] field=confirmedVariant from="" to="virgin"
    (source=ebay_image_consensus) site=variant-check-consensus fill=true
  [comps] variant preference filter: before=35 after=4 kept=4
    (match "virgin", mode=any, premium-variant isolation)
  [evidence-target] variant="virgin" issueAuthorityStatus="confirmed"
  ```
  Three distinct clusters on the real production pool (the copy-
  propagated pair scored `maxPairwiseJaccard=1.0` this time — a
  verbatim duplicate rather than the near-duplicate 0.929 seen during
  scoping; `minPairwiseJaccard=0.389` for the independents) — condition
  6 held on real, not synthetic, data. The active-comp variant
  preference filter (`api/comps.js`) correctly narrowed 35 candidates
  to the 4 real virgin listings ($21.25-$26.50) using the newly-
  confirmed variant. **Two further, previously-invisible bugs
  surfaced downstream once `confirmedVariant` stopped being null for
  the first time on this exact book** — `[Q75]` rejecting the same 4
  rows the variant preference filter had just accepted, and the sold-
  comp variant fallback re-admitting Cover A pricing data onto a now-
  confirmed-virgin book — both scoped as their own dispatch (GrailKey
  Dispatch 28), not fixed in this entry.

- **GrailKey Dispatch 28 PRODUCTION VALIDATION (2026-08-08, build
  `c95f1c8`) — verified via the card, not the runtime log.** Spawn #351
  re-scanned 2026-08-07 9:56 PM: headline price **$20.77** (was
  $5.49/$5.64 before Dispatch 27/28) — Price Bands Quick $18.06 /
  Market $20.77 / Stretch $23.88; Active Listings correctly shows the 4
  virgin comps, $21.25-$26.50, avg $24.43; "Price ready" checkmark set;
  the old $5.64 sold average correctly DEMOTED to a labeled reference
  line rather than driving the headline; no two-prices-on-one-card
  contradiction. Both symptoms confirmed resolved: Q75 no longer zeroes
  the active pool, and GK-31's `activeAnchoredOverFallbackSold` fired
  in production for the first time on record. (Note for anyone
  reviewing this session's transcript: a runtime log pasted alongside
  this card in the same message was from a DIFFERENT, unrelated scan —
  build `75a2ba3`, pre-Dispatch-28, a different book — and does not
  belong to this verification; the card is the evidence here, not that
  log.)

- **"The prompt told it to guess" (2026-08-08, GrailKey Dispatch 29,
  Fix 3a) — the fabricated "Spawn #1, 1992, high confidence" this
  session's own Fix 4/4b were built to survive was not a model
  hallucination.** `api/grade.js`'s `STANDARD_PROMPT` `year` clause, as
  shipped through GrailKey Dispatch 28, ended: *"Read it from the cover
  — do not guess. If year is not visible use context clues like art
  style, cover price, and characters."* That second sentence is an
  **explicit, standing instruction** to infer a year from recognizing
  the character/franchise when no printed year is visible — precisely
  what produced "1992" on a virgin variant with no cover date at all.
  The `issue` clause had the mirror-image gap: no absence guidance at
  all, leaving Vision free to default to "1" on any recognized
  first-issue-adjacent character with nothing telling it not to.

  The instinct on seeing a fabricated field is to suspect the model.
  The first place to look is the instruction actually given to it —
  named here as its own standing check, for reuse whenever a Vision
  field looks fabricated rather than merely wrong: **read the literal
  prompt text governing that field before assuming the model invented
  the value on its own.** Fixed by replacing (not appending after) the
  guess-from-characters sentence — appending would have left the
  prompt self-contradictory, with a real risk Vision keeps obeying the
  older, more specific instruction over a newer, more general one
  added alongside it. Same reasoning applied to the `issue` clause,
  which previously had no absence guidance to contradict but was given
  an explicit one for the same reason.

  Full wording and the asset-type-classification companion fix (a
  virgin/sketch/blank-cover variant recognized by physical book cues —
  staples, spine, interior page edges — rather than cover text) are
  Fix 3a, `api/grade.js`, both `STANDARD_PROMPT` and `WATCH_PROMPT`.
  Explicitly verified before shipping (per the standing risk-asymmetry
  discipline) that the new physical-cue wording does not weaken the
  existing poster/art-print/statue/toy disqualification — the gate
  requires positive physical-book evidence (staples/spine/page edges),
  not merely "the art looks like a comic," so a flat art print or
  poster fails it regardless of how comic-accurate the rendering is. A
  bound art-print-portfolio edge case was identified and deliberately
  NOT closed with a required paper-stock gate (Vision judging stock
  from a photo is unreliable and would trade a common virgin-variant
  false-negative for a rare portfolio false-positive) — added instead
  as a tiebreaker for the specifically-ambiguous case only (staples/
  spine visible, but stock/format suggests an oversized art object).

  **`shouldLiftAssetTypeAdvisoryLock`'s documented gap remains open,
  log only, not fixed here.** Its own Dispatch 19 doc comment already
  ran this exact Spawn #351 pool and found `hasCoherentConsensus ===
  false`, meaning it would not have qualified to lift the advisory
  lock even under its own merchandise/comic-vote conditions clearing.
  Fix 3a routes around this entirely for the virgin-variant class — if
  the prompt fix makes Vision report `assetTypeConfident=true`
  directly, the advisory-lock/lift mechanism never engages for this
  book at all — but the underlying gap is untouched and remains open
  for any pool where Vision still reports `assetTypeConfident=false`
  for other reasons.

- **Fix 3a SAME-DAY PRODUCTION REGRESSION, corrected as GrailKey
  Dispatch 30 (2026-08-08) — the physical-cues-required design was
  unsatisfiable by the way comics are normally photographed.** Fix
  3a's `assetTypeConfident` wording required a visible staple, spine,
  or interior page edge before treating a textless cover as a comic. A
  flat, straight-on cover photograph — the ordinary shape of a bulk-
  import scan — can never show any of those, comic or not. A real
  Spawn #351 virgin-variant bulk import returned "0 added, 1 failed…
  not a comic" the same day Fix 3a shipped. **Corrected direction:**
  a textless or minimally-texted cover at comic-cover proportions
  (~6.6 x 10.2 in) showing comic-style character art is a comic BY
  DEFAULT — `assetTypeConfident=true`. Physical-book cues, when
  visible, only STRENGTHEN that call; their absence is the ordinary
  case for a cover scan, never evidence against it. The
  paper-stock/"bound art portfolio" tiebreaker is dropped entirely —
  also unassessable from a flat scan, same root problem one level
  down. **Named misclassification gap, stated plainly rather than
  claimed airtight:** a poster deliberately printed at exact
  comic-cover proportions, photographed straight-on with no visible
  mat, mounting, or border, has no remaining discriminator besides
  aspect ratio and framing, and could pass. Accepted per the standing
  risk-asymmetry principle — a false "is a comic" is caught downstream
  by identity resolution and comp-matching (no real comps for a
  poster's fabricated identity); a false "not a comic" kills the
  workflow with nothing downstream to catch it.

  **GK-41, SHIPPED same commit — the actual bug the wording fix alone
  would NOT have resolved.** The bulk-import "0 added" hard-reject is
  `(!data.publisher && !data.year && !data.issue)` at both
  `gradeBlob` and `handleBulkImport` (`src/App.jsx`) — a gate fully
  independent of `assetTypeConfident`, never consulted by it. On a
  genuine virgin variant Vision now correctly returns null for all
  three, because Fix 3a's own (correct, kept) issue-null and
  year-null clauses are working exactly as designed. **The old
  year-guessing sentence Fix 3a removed had been accidentally
  load-bearing for this gate**: a fabricated "1992" kept the
  three-null clause from ever firing; removing the fabrication —
  correctly — exposed a downstream consumer that had never seen an
  empty value before. Named class, general check for reuse: **"a
  consumer depending on a fabricated value fails when the value
  becomes honest"** — one layer deeper than Dispatch 28's "deferred
  debt promoted to live by a downstream fix's success" (same shape:
  a fix makes a field honest for the first time, and a latent
  consumer that only ever saw the dishonest version breaks). When a
  fix replaces a fabricated value with null, grep every consumer that
  tests that field for presence — a truthiness check written against
  a field that was never empty is a latent hard failure.

  Fix: `(!data.publisher && !data.year && !data.issue &&
  data.assetTypeConfident !== true)` at both call sites — the
  three-null clause is bypassed only when Vision itself affirms
  `assetTypeConfident===true`. Deliberately NOT also re-gated on
  `data.title` in the new conjunct: `!data.title` already forces
  rejection via the first clause in the same `||` chain, so repeating
  it would be dead logic dressed as a safeguard — the exact shape
  GK-40's duplicated-vocabulary drift warns against. Slipped-through
  case, bounded and accepted: Vision wrongly asserts
  `assetTypeConfident=true` on a genuine non-comic object AND
  simultaneously returns zero identity signal — narrower than the
  prior blanket rejection of every zero-metadata cover, and it
  degrades honestly downstream (`identityGate.assessIdentityConfidence`
  still requires `missingFields.length===0`, so the book lands on
  `ID_REQUIRED`, not a fabricated price). Verified via extraction-and-
  eval of the real shipped `if` condition text from both call sites
  (`tests/grailkey-dispatch-30-gk41-non-comic-gate.test.js`) rather
  than a hand-retyped predicate, so the test cannot silently drift
  from the shipped code. **Cannot-verify note, stated plainly:**
  client-side bulk rejections never reach `/api/enrich`, so there is
  no server-side log trace of the specific reported failure
  (`s-l1600.webp`) — the evidence for this fix is the code read (the
  byte-identical three-null predicate at both call sites), not a
  reproduced production log line.

  **GK-42, logged only — a different, adjacent bug found while
  pulling logs for GK-41, not chased.** A post-`ba28666` Spawn #351
  scan resolved to "Spawn #1" via `commit4.3.1`'s near-miss
  family-conflict margin decline (`family=351@4/9.5 runnerUp=4
  margin=2.38 prior=1 requiredMargin=3`) — Dispatch 26/Fix 2c
  territory. Note for whoever picks this up: `prior=1` is Vision's
  own fabricated issue number, which Fix 3a's issue-null clause
  should now prevent from ever being set in the first place — this
  may resolve itself on the next scan with no code change. Re-check
  before scoping any fix.

  **GK-43, logged only — pre-existing, deliberately untouched in this
  commit.** `gradeBlob`'s non-comic title check uses
  `.includes('unknown')` (substring match); `handleBulkImport`'s uses
  `titleLower === 'unknown'` (exact match). Real divergence, confirmed
  by direct outcome test (Section 3,
  `tests/grailkey-dispatch-30-gk41-non-comic-gate.test.js`), unrelated
  to GK-41, left alone — touching an unrelated pre-existing quirk
  inside an urgent regression fix is how unrelated regressions get
  bought.

- **STANDING TEST-DESIGN RULE (2026-08-08, GrailKey Dispatch 30) —
  assert against the shipped expression, never a copy of it.** A test
  that hand-retypes the logic under test (a predicate, a regex, a
  formula) passes even after the shipped version drifts, because it is
  only ever checking itself. This is the third time this exact
  false-pass shape was caught and avoided in one session: the Fix 27-A
  fixture (an all-virgin-only sold pool triggered `verifySoldComps`'s
  legitimate variant-fallback safety net and produced a false pass by
  accident, not by design), the Dispatch 28 test's
  `variantAdjusted`-vs-`diagnostics.reasons.variantMismatch` assertion
  (checking the wrong pass's tally), and GK-41's own non-comic gate,
  which has no exported function to import at all — the App.jsx
  predicate is an inline conditional in a React callback. Rather than
  hand-retype it into the test (which would silently drift from the
  shipped code the moment either changed independently — precisely the
  GK-43 divergence this same dispatch documents happening for real),
  `tests/grailkey-dispatch-30-gk41-non-comic-gate.test.js` extracts
  each call site's actual `if (...)` condition text directly from the
  live `src/App.jsx` source via anchored regex and evaluates it as real
  JavaScript against fixture data. When no exported function exists to
  test directly, extract-and-eval the literal shipped text rather than
  reimplementing it — a reimplementation is a second copy of the logic,
  and a second copy is exactly what GK-40 and GK-43 show the cost of.

- **GrailKey Dispatch 30 PRODUCTION VALIDATION (2026-08-08, build
  `30fb7f2`).** Bulk import of the same Spawn #351 virgin variant
  (`s-l1600.webp`) accepted — "1 of 5," no "not a comic" rejection.
  GK-41 confirmed resolved on real production data. Full pricing chain
  confirmed working on the same scan, verbatim:
  ```
  [coverType-consensus] FIRE winner=virgin support=4/4
  [commit4-promote] PROMOTE issue=#351 ... provisional -> confirmed
  [commit4-promote-year] PROMOTE year=2024 assertingRows=3 silentRows=1
  [Q53-buildActive] filtered 4/4 active comps
  [price-trace] sold pool 100% edition-fallback but active pool
    confirmed variant-matched (4 comps, variant="virgin") — anchoring
    Tier 3 active-only instead of blending
  [tier-3] activeAvg=$24.43 discounted=$20.77
  [match-conf] score=96 tier=HIGH
  ```
  Fix 3a's null clauses (Dispatch 29, kept unchanged through Dispatch
  30) also confirmed working on this same scan, recorded here as its
  own separate success rather than folded into the failure below:
  `[phase1] identity determination: Vision="Spawn" #null`, and the
  year-drift conflict log shows `"vision": null` — no fabricated issue,
  no fabricated year. Half of Fix 3a's job (issue/year absence
  guidance) has been production-correct since Dispatch 29; the other
  half (assetTypeConfident wording) needed two more corrective passes
  — Dispatch 30, then Dispatch 31 below — before it matched reality.

- **GrailKey Dispatch 31 (2026-08-08) — two independent bugs found on
  the same re-scan, one prompt (second correction), one decision gate.**

  **Fix 31-A, SHIPPED — the wrong-axis gate, named and removed.**
  `shouldLiftAssetTypeAdvisoryLock`'s `hasCoherentConsensus` conjunct
  (title+issue majority-vote agreement on the eBay visual pool) gated
  whether Vision's own `assetTypeConfident=false` could be overridden
  by category-vote evidence. On the real re-scan: `comicVotes=20/20
  (ratio=100%) merchandiseRatio=0% coherent=false blockedBy=
  [pool-incoherent]` — an unambiguous asset-type signal (20/20 comic-
  category, zero merchandise) blocked solely because the pool's 20
  listings didn't converge on one title/issue. Confirmed by direct
  source read: `hasCoherentConsensus` measures "do these listings
  describe the same book," a different question from "is this object a
  comic," which the category vote already answers directly over the
  identical pool. No named failure case motivated the conjunct at
  introduction (Dispatch 19's own comment called it "the MORE
  conservative of the two options," a general principle) and it failed
  against its own only validation pool at ship time (that same comment
  disclosed the motivating Spawn #351 scan wouldn't have qualified
  under its own bar). Removed entirely, not replaced — category votes
  are already the correct-axis, direct measure; inventing a replacement
  conjunct would be a second, weaker proxy for what Q32 already
  measures. If a genuine pool-quality failure mode is ever observed, it
  needs a signal that actually measures pool quality/diversity, sized
  against a real incident — logged as an unscoped watch item, not built
  speculatively here. `src/lib/imageSearchIdentity.js`'s
  `shouldLiftAssetTypeAdvisoryLock` dropped from 4 params to 3; call
  site (`api/enrich.js`) and both stale test files
  (`grailkey-dispatch-19-fix5-asset-type-override.test.js`,
  `grailkey-dispatch-20-fix5-decline-logging.test.js`) updated in the
  same commit — the former's Section 1/5 inverted to assert the new
  behavior rather than deleted, so the removal itself stays a checked
  fact.

  **Fix 31-B, SHIPPED — Dispatch 30's own aspect-ratio wording
  backfired the same day it shipped.** The photo was the book on a
  light background with margins; Vision's condition report cited "The
  proportions and presentation suggest this is printed art stock rather
  than a periodical comic book cover" and "The paper stock and framing
  indicate this is likely a standalone art piece or poster." Two
  failures: (a) Vision cited paper stock — the exact tiebreaker
  Dispatch 30 explicitly dropped — re-inventing it; (b) IMAGE
  proportions are not OBJECT proportions, and the aspect-ratio/framing
  cue Dispatch 30 added was read as evidence AGAINST an ordinary
  photographed book, backfiring on the ordinary case it was meant to
  protect. Both cues removed entirely (not narrowed) from both prompts
  — an explicit, by-name prohibition on paper-stock/print-stock/
  material-appearance reasoning added instead. Explicitly a wider
  positive-signal surface than Dispatch 30's version, and explicitly
  conditional on GK-41 (Dispatch 30) remaining in place: before GK-41 a
  false "is a comic" could reach a hard block; after GK-41 it degrades
  to `ID_REQUIRED` (if identity can't resolve) or an advisory-locked
  listing button (if it can't be verified) — never a fabricated price
  or a dead end. A future reader must not treat this width as an
  unconditional loosening independent of GK-41 staying shipped.

  **GK-44 — named finding, most reusable of this dispatch, standing
  rule for every future prompt change in this codebase.** Vision has
  now reached for an unstated criterion twice: the masthead/price-box/
  barcode checklist (pre-Dispatch-29, part of "the prompt told it to
  guess"), then paper stock and framing (pre-Dispatch-31, this entry).
  **Omitting guidance is not the same as prohibiting a behavior —
  silence reads as "unconstrained," not "not applicable."** Pre-ship
  check for every future default-permissive prompt clause: ask what
  specific reasoning shortcut a model might reach for to justify the
  restrictive outcome, and forbid it by name before shipping, rather
  than discovering it re-invented in production after the fact.

  **GK-42 status, checked before scoping (per the explicit note left in
  Dispatch 30): re-verify before touching.** Not re-checked this
  dispatch — still open, unchanged.

  Verified: 19/19 new assertions
  (`tests/grailkey-dispatch-31-fix31a-wrong-axis-removed.test.js`),
  split three ways — Part 1 calls the real exported
  `shouldLiftAssetTypeAdvisoryLock` directly on the actual Spawn #351
  figures and a genuine merchandise-heavy contrast case; Part 2
  extracts the real `listingHardLocked` conditional text from
  `api/enrich.js` via anchored regex (tightened during authoring after
  an initial loose anchor-then-wildcard pattern accidentally matched an
  unrelated polybag-pricing gate elsewhere in the file — caught before
  commit, not shipped) and evaluates it against the real predicate's
  output, proving the actual downstream outcome (not locked) rather
  than just the predicate in isolation; Part 3 is prompt source-
  presence, absence-first per the standing Dispatch 29/30 discipline.
  13/13 pre-existing assertions across the two superseded Dispatch
  19/20 test files updated (not deleted) to assert current behavior —
  34/34 the (twice-superseded) Dispatch 29 prompt test still clean.
  Both changes are decision-gate / trust-intake adjacent, not pricing
  math — 31-A explicitly flagged and greenlit as a decision-gate change
  per CLAUDE.md's standing protocol; 31-B's width explicitly signed off
  given the GK-41 risk-budget argument above.

- **"A log excerpt is not evidence unless it includes the reconciling
  line" — review-discipline note, GrailKey Dispatch 32 (2026-08-08),
  pairing two retractions.** Two flagged defects in the same batch
  review (47 real scans) both turned out to be pipeline components
  working as designed, both caught by the identical failure mode: a
  partial log excerpt was read as proof of a discrepancy without
  checking for the line that explains it.
  - **Key multiplier** (Marvel Super Heroes Secret Wars #8, Batman: The
    Killing Joke, Immortal Hulk Great Power #1). `[key] SKIPPED — no
    multiplier base available (source=verified_sold_recency/
    active_ask_derived, isFromPC=false)` was read as a missed
    multiplier. It is the `isFromPC` gate working exactly as designed —
    a comp-verified price (18 real sold comps of that exact key issue)
    already embeds the key premium; applying the 1.5x key multiplier on
    top would double-count. The gate exists precisely so the multiplier
    only lifts a generic PriceCharting base, never a real,
    comp-derived price.
  - **Recommended-price divergence** (Spidey Super Stories #23,
    Dispatch 32 Defect 5). `[tier-4] pc_estimate=$9.90` next to
    `[verify] ... recommended: $50` was read as an untracked variable.
    `[verify]`'s `recommended` re-parses `out.price` directly
    (`enrich.js:9364-9386`) — it is not independently computed. The
    $9.90→$50 jump is the single-comp ask-based floor guard
    (`enrich.js:8065-8093`, `enforceFloorWithCap`) firing correctly on a
    1-item active pool, logged at `` `[floor] price 9.90 < floor 50 ...
    — enforcing` `` (line 8087) — a line the report's excerpt simply
    stopped short of.
  Both defects were retracted in the same review pass they were raised
  in, at the cost of one extra grep each. **Standing check, going
  forward: when a report cites two numeric values from the pipeline as
  evidence of a discrepancy, the report must also show — or explicitly
  say it checked for and did not find — the log lines between them.** A
  value pulled from one log line and compared against a value pulled
  from a different, non-adjacent log line is not itself evidence of a
  bug; it is evidence that needs the connecting narrative before it's
  reportable.

- **"Two guards on the same population with different threshold shapes
  disagree by construction" — GrailKey Dispatch 32 (2026-08-08), STEP A
  finding, provable from the arithmetic rather than observed from
  failures.** Q84's coherent-content lane (`src/lib/
  imageSearchIdentity.js:1545-1695`, `applyDualAxisGate`) admits a
  marketplace token into `confirmedTitle` on an ABSOLUTE floor:
  `countMemberSupport(token, familyMemberTokens) >= 3` (`:1465-1466`,
  `:1652-1681`). `22e-force`/`22e-LOSS` (`identityCore.js:294-436`,
  `checkAssemblyIntegrity`) rejects the same class of token as a stray
  addition on a PERCENTAGE floor: `<60%` of `compTitles` (`:368-406`).
  When a family override has occurred, both predicates are confirmed to
  run over the literal same population — `compTitles` at the
  `22e-force`/`22e-LOSS` call sites is set to `winningFamilyTitles`
  (`enrich.js:3422-3428`, `6282-6285`), the identical `topFamily`
  Q84's `familyMemberTokens` is drawn from.
  Given that, the two thresholds are not independently tunable — they
  are the same measurement expressed in two incompatible units, and the
  crossover point is arithmetic, not incidental: in any family with 5 or
  fewer members, 3 supporters is already >=60% (3/5 = 60%), so
  `22e-force`'s percentage floor can mathematically never flag what
  Q84's absolute floor admitted, for any family at or under that size.
  In a larger family, 3 supporters can fall under 60% and gets caught.
  This reproduces the observed catch-rate split exactly (small, tight
  visual-pool families — Star Wars #68, Strange Tales, and others —
  passed through uncaught; larger families — Iron Man #150, X-Men #39,
  and others — were caught) without needing to have observed every
  individual failure to know it would happen: the disagreement is
  guaranteed by the two threshold shapes alone, for any family under the
  crossover size, regardless of which specific tokens are involved.
  Related to, but a distinct sibling of, the "measuring coherence
  against the wrong population" class (vision-zero-support, Bone
  #1/GK-34, Fix 2b, Fix 2c's two drafts) and the "drifted-duplicate-
  constant" class (Q119, Q127, Q128, GK-40): those are about a
  measurement applied to the wrong population, or the same nominal
  vocabulary independently drifting in content. This is neither — the
  population is identical and correctly identified by both guards; what
  disagrees is the SHAPE of the threshold applied to it. Recorded as its
  own class since a fix that only closes one sibling (e.g. widening a
  drifted vocabulary, or re-scoping a wrong-population measurement)
  would not touch this one. (Numbering note: this entry is not asserted
  as a specific ordinal instance of any single prior-named class — it is
  the first instance of this particular sub-shape, cross-referenced
  above to its two nearest siblings rather than folded into either
  one's running count.)
  **Standing check, added to the existing "name the population" check
  from the wrong-population class: when two predicates gate the same
  population, state both thresholds in the same units — before shipping
  either — and confirm neither can structurally out-vote the other for
  any population size in the expected range.**

- **GK-45 (2026-08-08, GrailKey Dispatch 32, found while scoping Fix 32-C).
  `convergence.tier` does not actually certify PriceCharting agreement on
  issue number or title — LOG ONLY, not fixed this dispatch.**
  `convergenceSources` (`api/enrich.js:4016-4060`) feeds PC data into the
  `era` (`:4046`) and `publisher` (`:4052`) axes only. The `title` axis
  has no `pc:` key at all (`:4017-4036` — only `ebay`/`vision`/`cv`), and
  the `issue` axis's `pc: priceChartingInitial?.issue` (`:4040`) is a
  dead reference: `lookupPriceCharting`'s returned candidate objects
  (`api/enrich.js:1782`, `{ price, productName, id, year, source }`; the
  id-anchored branch's return at `:1568-1575` is the same shape) never
  set an `.issue` field, so this axis reads `undefined` from PC on every
  scan, always. Net effect: `convergence.tier === 'HIGH'` currently means
  year/publisher agreement was confirmed against PC — it says nothing
  about whether PC agrees on issue number or title, despite the field's
  name implying general identity convergence. Relevant to Fix 32-C:
  `visionLowButCorroborated`'s new catalog-corroboration arm deliberately
  does NOT gate on `convergence.tier === 'HIGH'` for exactly this reason
  — raising that bar would not buy real issue-level assurance, only make
  the arm harder to satisfy for an unrelated reason. Flag for any other
  future consumer of `convergence.tier`: treat it as weaker evidence than
  its name implies until the dead `.issue` axis and missing `title`/`pc`
  key are addressed.

- **GK-46 (2026-08-08, GrailKey Dispatch 32, found while scoping Fix
  32-B). The `soldVerification.js:934` zero-pool variant fallback is
  ALREADY unconditionally reachable today, regardless of
  `variantIdentitySource` — meaning Fix 32-B's originally-planned
  mechanism (gate Filter 8's case a-inverse by provenance, route to the
  `:934` fallback) may not change Marvel Team-Up #141's actual outcome.
  Investigated, NOT resolved — needs live verification before 32-B's
  code proceeds.** `soldVerification.js:934`'s guard —
  `working.length === 0 && reasons.variantMismatch > 0 && rawCount > 0`
  — has no provenance check today. If Filter 8's case (a-inverse) zeroed
  `working` for Marvel Team-Up #141 (as the Dispatch 32 report's
  `codes={"WRONG_VARIANT":30}` log line implied), this fallback should
  already have engaged in the real scan, independent of whether
  `confirmedVariant="newsstand"` came from Vision alone or a corroborated
  source. That means the real production outcome (zero pricing evidence,
  per the original report) was decided by what happened INSIDE the
  fallback — either its self-consistency guard
  (`recognizedDistinct.size >= 2`, `:1149-1151`) tripped, or the
  re-filtered pool fell to zero via filters 1-6/9-13 — not by the
  fallback failing to trigger at all. **This is also a corroborating
  data gap, not just a mechanism gap**: the `codes={"WRONG_VARIANT":30}`
  figure cited in the original report comes from
  `evidenceEligibility.js`'s independent DIAGNOSTIC classifier (confirmed
  elsewhere in this dispatch to be non-gating for pricing), not from
  `soldVerification.js`'s own internal fallback logging — so it is not
  itself proof that `soldVerification.js`'s real working pool ended up
  empty after the fallback ran; it only proves Filter 8's initial
  rejection tally. Fix 32-B's design (skip the case-(a-inverse) hard
  reject when uncorroborated, route through the same `:934` machinery)
  produces a near-identical candidate pool to what the existing
  unconditional fallback already computes — if the fallback already ran
  and already failed via `recognizedDistinct` or re-filtering, the
  planned fix may hit the identical failure point and change nothing.
  **Before writing code for Fix 32-B: pull the real `[sold-verify]`
  fallback log lines (`variant fallback triggered` /
  `variant fallback INCOHERENT` / `variant fallback — N any-variant
  grade-matched comps`) from the actual Marvel Team-Up #141 production
  scan, or re-scan live, to confirm which of the fallback's three
  outcomes actually occurred** — this determines whether Fix 32-B's
  provenance gate is the real fix, or whether the real fix instead needs
  to touch the self-consistency guard's behavior when the disputed axis
  token is itself uncorroborated.

- **NAMED OPEN INFRASTRUCTURE PROJECT (2026-08-08, GrailKey Dispatch 32,
  post-catalog title finalization) — scoped, NOT started. An outside
  architectural review reached this independently: the durable fix for
  the coherent-content-token-lane class of bug is Evidence ->
  Classification -> Authority -> Identity -> Market, replacing
  marketplace-repetition-infers-identity-with-exceptions-patched-after.**
  Confirmed tractable because **this architecture already exists in this
  codebase, on the issue axis** — `issueAuthority`
  (`{status: provisional|confirmed|conflicted, reasons[], source}`,
  `identityProvisionalFields` as pending state, promotion via
  `decideFieldAuthority`/`resolveFamilyIssueConsensus`, shipped by Fix
  2/2b/V4) is the exact pattern. `titleComponents`
  (`[{value, type, status:'pending-catalog'}]`) is the SAME pattern
  extended to the title axis — not a rewrite, an application of a proven
  in-repo pattern to the one axis that lacks it.
  **CORRECTED (parallel review, same dispatch) — not "reusable
  verbatim."** The authority-state vocabulary, custody semantics,
  provisional-state pattern, and decision model (`decideFieldAuthority`'s
  outcome vocabulary — adopted / provisionally-corrected / corroborated /
  preserved-prior / conflicted, the `authoritativeForCustody` boolean,
  `identityProvisionalFields`'s pending-state bookkeeping, the
  legacy-mode compatibility mapping pattern) are reusable as a PATTERN.
  **Direct implementation reuse requires title-axis interface proof
  first** — `decideFieldAuthority` takes a single scalar `priorValue`/
  `familyValue` pair; title is an ORDERED SET of independently-typed
  claims, not one scalar claim, and nothing in this codebase has proven
  the function (or a variant of it) actually composes over a set without
  redesign. Recording this distinction explicitly so a future engineer
  doesn't read "reusable verbatim," conclude `decideFieldAuthority()`
  just needs to accept arrays, and call the architecture question closed
  without doing that proof.
  **Needs a title-axis equivalent, does not exist today**: issue
  authority only ever resolves a single scalar (a number, via one regex
  shape, `#\s*(\d+)`) — title is a SET/SEQUENCE of tokens, and unlike an
  issue number, individual tokens need their own TYPE classification
  (canonical / edition-event / creator / story-content / publisher-
  imprint / seller-boilerplate) before authority can even be asked about
  them. This per-token classification step has no issue-axis analog to
  reuse — it is new work, not an extension of `resolveFamilyIssueConsensus`.
  Target shape for the eventual project (Phase 1 collect candidates
  without finalizing uncertain tokens -> Phase 2 acquire CV/PC catalog
  candidates -> Phase 3 reconcile candidate tokens against catalog
  identity -> Phase 4 finalize canonicalTitle/issue/year/publisher/
  format/variant -> Phase 5 generate market-search fingerprint -> Phase 6
  price only against the finalized fingerprint) is recorded here as the
  standing target, not yet designed in detail.
  **Standing design criteria for this project, going forward:**
  1. Does the code encode a property of the world, or today's dataset
     behavior?
  2. Does the same concept exist in more than one place? Consolidate.
  3. Would adding 100 new publishers/conventions/formats/marketplaces
     require modifying control flow? If yes, the abstraction is wrong.
  4. Can the system say "unknown / not yet authoritative" instead of
     deciding prematurely? If not, it needs an intermediate
     representation.
  **Question 4 is load-bearing — it is the structural form of this
  codebase's own standing product principle: honest and locked, never
  confident and wrong.** The Adventure Time SDCC reachability trace
  (this same dispatch) is a direct, empirical instance of question 4 in
  action: post-deletion, the book resolves to `confirmedTitle="Adventure
  Time"` / `confirmedIssue=null` — an honest incomplete state — rather
  than the pre-fix confidently-wrong $22.09 off a different product.
  This project would let the SAME honest-null discipline extend to the
  title tokens themselves ("summer special" is `pending-catalog`, not
  silently dropped and not silently promoted) instead of the current
  binary admit-or-block choice this dispatch is stuck making.

- **SDCC-fix scope correction, recorded alongside the deletion
  (2026-08-08, GrailKey Dispatch 32).** An earlier draft of the
  EDITION/EVENT typed-replacement list proposed routing `annual`,
  `giant-size`, and `summer special` to variant alongside genuine
  event/convention tokens (`sdcc`, `nycc`, `c2e2`). Two real corpus
  books falsify this: **giant size doctor strange #1** ($15.00, 20 sold
  comps, Vision itself already reads "giant size" directly off the
  cover — "giant-size" is CANONICAL for this book, not a routable
  edition descriptor) and **Marvel 85th Anniversary Special #1**
  ($11.62 — "special" is CANONICAL, part of PriceCharting's own product
  name). Routing either word to variant would strip canonical title
  content on these two books — the inverse of the bug being fixed. The
  typed EDITION/EVENT list ships scoped to genuine named-convention/
  event phrases only (`sdcc`, `nycc`, `c2e2`, `convention exclusive`);
  `annual`/`giant-size`/`summer special`/`special` are explicitly
  excluded and stay in the "never blindly routed, catalog-corroboration
  only" bucket — which, per the open infrastructure project above, does
  not exist yet. Adventure Time Summer Special's own "summer special"
  falls in this excluded bucket and stays a named, explicitly
  unresolved gap.

- **CLASSIFICATION IS NOT AUTHORITY — standing design principle
  (2026-08-08, GrailKey Dispatch 32).** Recognizing that a token is a
  particular KIND of claim (an event name, a creator name, a printing
  descriptor) answers only what kind it is — never whether it belongs to
  the specific book being identified. Required shape for any future
  classifier in this codebase: `token -> classification -> [family-scoped
  corroboration | visual evidence | catalog evidence] -> authority
  decision -> adopt | provisional | conflict | reject`. NOT: `known type
  -> automatically adopted`. Concretely enforced in this dispatch's own
  typed event/imprint routing (`matchKnownPublisherImprintEventTokens` +
  `countMemberSupport`'s >=3-member floor, `imageSearchIdentity.js`) —
  matching a known phrase (classification) and clearing family-scoped
  corroboration (authority) are both required, checked in that order, and
  a token that clears only the first (e.g. "sdcc" at 2/5 member support)
  is never routed. This is the same principle the coherent-content
  lane's own deletion establishes from the opposite direction: a token
  does not gain identity authority by being repeated across marketplace
  listings — classification by phrase-match doesn't grant authority
  either, corroboration does the actual work in both directions. Applies
  to the co-title gating in this same dispatch too: `visual_pool_top3` as
  a SOURCE is a classification of where a token came from, not evidence
  it belongs to the book — audited (0/1 beneficial) and found wanting on
  authority grounds, not on classification grounds (the source was
  correctly identified as visual_pool_top3 every time; that correct
  classification never implied the token belonged to the family).

- **3x margin finding — narrow conclusion only, not an argument to tune
  (2026-08-08, GrailKey Dispatch 32).** `isQualifiedFamilyForRetention`'s
  `familyDominatesRunnerUp` (Commit 4.3, `identityCore.js`) requires the
  winning family to out-weight its runner-up by 3x before independently
  rescuing issue/year on a title-axis-only block. Checked against 8 real
  corpus books during this dispatch's reachability work: **5 of 8 fail
  the margin** (star wars #68 10<12, strange tales 8.5<25.5, batman #608
  5.5<16.5, gears of war #1 14.5<21, fantasy masterpieces #1 13.5<22.5),
  3 pass (immortal hulk #44 18>=9, super villain team-up #5 17.5>=9,
  spidey super stories #23 14>=12). **The correct, narrow conclusion:
  Commit 4.3 is a deliberately narrow rescue that frequently does not
  activate, and this is usually harmless — checked directly, 7 of the 8
  books above have Vision independently supplying the correct issue
  number regardless of whether Commit 4.3 fires, so the margin miss has
  no consequence for them.** The demonstrated residual-risk class is
  narrower than "the margin is too strict": it is specifically
  Vision-has-zero-issue-signal PLUS an ambiguous-or-wrong pool-wide vote
  — Adventure Time Summer Special is the one specimen of this class found
  in this dispatch's work (real trace: `confirmedIssue` resolves to
  honest `null`, not the wrong pool-wide vote, when the margin misses —
  see the Part 2 reachability trace, `tests/q140-coherent-content-token-
  lane.test.js`). Adventure Time's own margin miss (14 < 15) is a
  one-point coincidence, not evidence the threshold is miscalibrated —
  do not read it as one. **Explicitly not touched this dispatch, and not
  to be touched as adjacent cleanup in any future dispatch without its
  own dedicated scoping and greenlight**: `familyDominatesRunnerUp`'s 3x
  constant, same standing status as the standing "do not rank-weight
  issue-consensus" and "do not touch Commit 4.3" rules already recorded
  in this file.

- **Coherent-content lane deletion + co-title `visual_pool_top3` gating
  — SHIPPED (2026-08-08, GrailKey Dispatch 32).** Two independent
  injectors closed in one atomic commit, per real-corpus audit evidence
  gathered across this dispatch (47 real production scans, 2026-08-08
  07:00-08:15 UTC): the Q140 coherent-content-token lane
  (`applyDualAxisGate`, `imageSearchIdentity.js`) deleted outright — 15
  observed firings, 0 beneficial, real motivating incident (Adventure
  Time SDCC) not reproduced in the audited corpus and left explicitly
  unresolved rather than half-fixed; and `co-title`'s `visual_pool_top3`
  source (`api/enrich.js`) stripped of append authority entirely — 1
  observed firing (iron man #150, "DR DOOM White"), 0 beneficial,
  vision-sourced co-title (the validated Q104 FIX-3 crossover-title
  path) left untouched. Replaced by a standalone typed event/imprint
  routing mechanism reusing the existing >=3-member corroboration floor
  (never title-admission authority again) — widened with genuine named-
  convention phrases (`sdcc`, `nycc`, `c2e2`, `convention exclusive`),
  deliberately excluding `annual`/`giant-size`/`summer special`/`special`
  (see the SDCC-fix-scope-correction entry above). **Corpus role, not
  count, for the 15 firings** — do not let a future benchmark or launch
  document read this as "15 books fixed": ~8 were genuine harm this
  deletion corrects (star wars #68, strange tales, immortal hulk #44,
  batman #608, gears of war #1, fantasy masterpieces #1, spidey super
  stories #23, amazing spider man #17); 4 were already self-correcting
  pre-deletion via an unrelated mechanism (super villain team-up #5 via
  22e-force Rule 2; x-men #39, marvel team-up #14, marvel team-up #141
  via Rule 1) and stay correct post-deletion via the same or a more
  direct path; amazing spider man #119's title is fixed here but its
  pricing outcome is governed separately by the already-shipped Fix
  32-C; iron man #150 needed BOTH injectors closed to reach fully clean.
  Frozen as a permanent, deterministic, no-live-eBay regression suite:
  `tests/grailkey-dispatch-32-frozen-corpus.test.js` (33 assertions, all
  15 firings plus 2 controls, real pools copied verbatim from the
  production log corpus, not reconstructed), plus
  `tests/q140-coherent-content-token-lane.test.js` rewritten (26
  assertions: lane-deletion proof, typed-routing unit behavior including
  a CLASSIFICATION-IS-NOT-AUTHORITY control, and the Adventure Time gap
  re-verified against real function calls) and
  `tests/q133-slice1b-eom-registry.test.js` restored to its pre-Q140
  assertions verbatim (13 assertions — the reintroduction guard). One
  real gap found and fixed during implementation, not just documented:
  the `fallback-vision` return object in `selectTitleFamilyCandidate`
  never threaded `admittedVariantTokens` at all — without the fix, Gears
  of War #1's "wildstorm" routing would have silently regressed the
  moment the lane's admission path stopped being the only way to reach
  that return site. Full regression sweep (decision-engine 39/7, comp-
  filter-hygiene 182/4, sold-verification 124/5, identity-gate 92/7,
  image-search-extraction 161/2, mega-keys 198/8, pattern-k-dedupe-issue
  4/4, q-adv397-visual-guard 11/5) matches documented baseline exactly;
  one pre-existing test (`tests/q144a-family-discriminator-gate.test.js`)
  had its one predicted assertion updated, everything else in that file
  unaffected, confirmed by the suite staying green. `npm run build`
  clean. `resolveFamilyIssueConsensus`, Commit 4.3, the 3x margin, Fix
  32-B, and the gate chain are all untouched.

- **HIDDEN-PATH DEPENDENCY — named, reusable principle (2026-08-08,
  GrailKey Dispatch 32).** `selectTitleFamilyCandidate`'s
  `fallback-vision` return object (`imageSearchIdentity.js`, the
  weighted-consensus branch's blocked-addition return) never threaded
  `admittedVariantTokens` through — this went unnoticed for as long as
  the coherent-content lane existed, because that lane's own
  `allowed: true` success return was the only place `admittedVariantTokens`
  ever needed to survive to the caller; the blocked path never carried a
  populated value worth losing. Deleting the lane made `fallback-vision`
  the sole outcome for every non-creator addition — including the new
  standalone typed event/imprint routing's corroborated tokens — and the
  same missing field that was harmless for years became a silent
  regression on the very first real case (Gears of War #1's "wildstorm").
  Found and fixed during implementation, not left as a shipped defect.
  **Reusable principle, name it before it recurs: a mechanism reached
  through only one historical control-flow path can acquire a hidden
  dependency on that path — a field or side effect that "just happens"
  to survive because nothing else ever took the other branches. When
  deleting or bypassing a path, audit every side-channel field produced
  anywhere in the deleted/bypassed code for whether every NEWLY reachable
  return site actually threads it through — do not assume a return
  object's shape was ever exercised by the case you're about to make
  common.**

- **CO-TITLE EVIDENCE DISCIPLINE — three verdicts, not two (2026-08-08,
  GrailKey Dispatch 32).** Auditing `[co-title]` firings across the
  47-scan corpus produced exactly one resolved case (`visual_pool_top3`,
  iron man #150, pollution) and zero firings of the other source
  (`vision`-sourced co-title, the validated Q104 FIX-3 crossover-title
  path). **Zero firings is recorded as a COVERAGE GAP, not as evidence
  either for or against the mechanism** — the corpus simply never
  exercised it. `visual_pool_top3`'s append authority was removed on its
  own resolved evidence (1 firing, 0 beneficial); `vision`-sourced
  co-title was left unchanged on the correct basis that its own separate,
  prior validation (the real Deadpool/Batman incident) still stands,
  never on this corpus having tested it. Recorded as a standing
  discipline for future hit-rate audits in this codebase: a mechanism
  with zero observed firings in an audit corpus gets UNRESOLVED, not a
  default verdict borrowed from a sibling mechanism's result — the same
  three-verdict requirement (BENEFICIAL / POLLUTION / UNRESOLVED, never
  forced to a binary) that governed the co-title audit itself applies one
  level up, to whether a source was tested at all.

- **"NO NEW REGRESSION AGAINST DOCUMENTED BASELINE" — standing
  terminology rule, not "tests pass" (2026-08-08, GrailKey Dispatch
  32).** This codebase's test suites carry real, individually-documented
  pre-existing failures — decision-engine 39/7, comp-filter-hygiene
  182/4, identity-gate 92/7, image-search-extraction 161/2, mega-keys
  198/8, sold-verification 124/5, q-adv397-visual-guard 11/5, and more
  (see "Known stale test suites" in CLAUDE.md's Current State section).
  **"Tests pass" is never the accurate claim for a sweep against this
  suite — it silently grandfathers 30+ already-known failures as if they
  were successes.** The accurate, required claim is that the sweep
  produced NO NEW failures beyond the documented count for each file —
  verified by comparing the exact pass/fail numbers to the documented
  baseline, not by checking exit codes or "did it print all-green."
  GrailKey Dispatch 32's own regression sweep is the worked example:
  reported as "decision-engine 39/7... matches documented baseline
  exactly," never as "decision-engine passes." **Use this exact phrasing
  in every future commit message and report describing a regression
  sweep against this suite.** Standing reason to keep this precise, not
  just a style preference: when a formal launch-certification gate is
  eventually built in this codebase, this distinction is the entire
  difference between an honest gate and one that silently certifies
  everything already broken. A certification step that reports "tests
  pass" against a baseline already carrying 30+ known failures certifies
  nothing — it would pass unchanged the day before and the day after an
  unrelated regression landed in one of the already-red suites, because
  nothing in "tests pass" phrasing distinguishes "still red for the
  documented reason" from "newly red for an undocumented one."

- **Dispatch 32 Defect 7 downgraded, log only, not scoped (2026-08-08).**
  The three `[22e-LOSS]` log lines the batch report read as
  `buildTitleFamilies` silently dropping tokens (`x`, `marvel`) into a
  truncated `confirmedTitle` are the guard's own FAIL output
  (`identityCore.js:358-363`) — meaning all three were caught and
  reverted to Vision's clean title before shipping, not silently
  truncated. Underlying mechanism confirmed real: a min-length filter
  drops single-character tokens (`src/lib/imageSearchIdentity.js:
  1015-1019`, catches "x"), and a separate 60%-family-consensus step
  drops non-majority publisher tokens like "marvel" (`:1114-1118`) — but
  confirmed cosmetic only, since family membership/clustering is decided
  before the token-consensus step runs (`:1074-1097` vs. `:1103-1174`),
  so truncation never changes which listings cluster together. No fix
  scoped.

## GrailKey Dispatch 33 (2026-08-08) — Architecture v1.0, Week 1: instrumentation and contracts only

Zero customer-visible behavior change this week. No routing change, no
new lanes, no barcode decode logic, no agent framework, no prompt
changes, no `api/enrich.js` control-flow changes (only new
timer-wrapping/logging around existing calls). Full plan and design
decisions: `.claude/plans/bright-meandering-reddy.md` (this session).

### Step 0 — eBay legacy Product API urgency check

Grepped the full codebase for `findProducts`, `getProductDetails`, and
`getProductCompatibilities` — **zero call sites anywhere.** Confirmed via
eBay's own developer docs
(`developer.ebay.com/devzone/Product/CallRef/findProducts.html`,
`.../getProductDetails.html`) that all three are genuinely deprecated and
scheduled for decommission **2026-08-15** — the secondhand claim that
triggered this check was accurate, not a rumor. This codebase's actual
eBay surface: Browse API (`buy/browse/v1`, current, not part of this
decommission), Trading API (`ws/api.dll` — `AddFixedPriceItem`/`EndItem`,
a separate legacy API, also not part of this decommission), the legacy
Finding API (`svcs.ebay.com/FindingService`, already documented dead/
bypassed in CLAUDE.md's Open Blockers), and Marketplace Insights
(already documented dead/gated). The `epid` field seen throughout
`src/lib/imageSearchIdentity.js`/`evidenceEligibility.js` is a Browse API
response field used as a cross-reference key into PriceCharting lookups
— not a call to the deprecated Product API. **Conclusion: no migration
needed, nothing was ever built against the decommissioned surface.**

### Step 1 — two standing invariants for every future evidence source

Recorded here verbatim, per instruction, before any contract code was
written — the contracts in Step 2 exist to satisfy these, not the other
way around.

**INVARIANT 1 — MONOTONIC EVIDENCE EXTENSION.** A new evidence source may
strengthen, contradict, or leave unchanged an existing determination.
Failure or absence of the new source must not weaken, contaminate,
constrain, or otherwise alter the established fallback path. Concretely,
a fast-identity miss may NOT: alter the legacy Vision prompt; alter the
eBay query; shrink or reorder the candidate pool; populate
confirmedTitle/issue/year/variant/publisher; contaminate shared request
state; write a cache entry that affects the legacy route; change grading
mode. This is stronger than fallback logic — it is monotonic extension:
the legacy path is the floor, by construction.

**INVARIANT 2 — NO SELF-CORROBORATION.** Evidence derived directly or
transitively from an authority mechanism cannot count as independent
corroboration of that same mechanism. Independence is COMPUTED by the
Authority Resolver (future work, not built this week) from evidence
lineage (`derivedFromEnvelopeIds`, `sourceIndependenceGroup`) — it is
NEVER a boolean a worker sets. This covers barcode, catalog, visual
retrieval, future agents, and sources not yet conceived. See
`src/lib/evidenceContracts.js`'s closing comment: a stored `independent`
field would defeat this guard by construction, which is why one does not
exist anywhere in this codebase and any future addition of one should be
rejected on sight, not patched around.

### Step 2 — EvidenceEnvelope / SourcePolicy / barcode-ladder contracts (types and tables only)

`src/lib/evidenceContracts.js` — new file, **nothing imports it yet**
(grep-verified at ship time; re-verify before this claim goes stale).
Contains: the `EvidenceEnvelope` JSDoc typedef (every field from the
dispatch spec); `RetentionClass` frozen enum
(`FIRST_PARTY_PERMANENT`/`LICENSED_PERMANENT`/`TRANSIENT_EXTERNAL`);
`SOURCE_POLICIES`, one row per source (ebay, pricecharting, comicvine,
google, gcd) — populated conservatively, `termsCheckedAt: null` + a TODO
on every row except GCD's (the one row with real, if still incomplete,
cited terms from Dispatch 17 — CC-BY-SA attribution confirmed required,
no live query API, no bulk retrieval); `BARCODE_AUTHORITY_LADDER`, a
plain 3-value enum (`BARCODE_OBSERVED`/`BARCODE_MAPPED`/
`BARCODE_EDITION_RESOLVED`) with no decode logic behind it.

**Flagged, not fixed:** this ladder needs future reconciliation with the
*existing* barcode path in `api/enrich.js` (`lookupComicVineByUPC`,
`identitySource === 'barcode'`) — today that path is an all-or-nothing
lock (UPC found in ComicVine ⇒ "100% certain," skips `resolveIdentity`
entirely; UPC not found ⇒ hard 404) with no "observed but unmapped"
state at all. Wiring the 3-tier ladder into that existing lock is
deliberately out of scope this week.

### Step 3/4 — instrumentation, threaded through `src/lib/scanLog.js` (additive, no version bump)

Same additive-field convention as Fix 32-C (`visionLowButCorroborated`):
every new key defaults to `null`/`[]` on absence, `SCAN_LOG_VERSION`
stays `1`. New top-level keys: `correlationId`, `latency`, `identity`,
`cost`, `evidence`, `sources`, `barcode`, `eventualCertifiedGrade`.

**correlationId** — reuses `api/enrich.js`'s existing `pipelineTraceId`
(`randomUUID()` at handler entry, already threaded through
`out.pipelineAudit.traceId`). No new ID generation, no new plumbing.

**A key architectural fact this instrumentation is built around:**
`api/grade.js` (Vision identification) and `api/enrich.js` (pricing
pipeline, the only place `scanLog` writes to KV) are **two separate HTTP
requests**, not one. There is no shared correlation ID or log sink
spanning both today. This creates two honest, documented gaps rather
than fabricated numbers:

- `latency.visionLatencyMs` is always `null` in `scanLog` — Vision's
  latency is real and measured (`api/grade.js`'s own `mark()`/`ms`
  timers), just not persisted here.
- `cost.conditionCostUsd` is always `null` in `scanLog` for the same
  reason — Vision's per-call cost IS computed and logged (see below),
  just not joined to the enrich-side record.

Resolved direction (explicit, not a default): compute and
`console.log` both numbers inside `api/grade.js` (readable via Vercel
runtime logs for the Step 5A audit) and leave the corresponding
`scanLog` fields `null` with a code comment. **Do not timestamp-stitch
the two requests to manufacture a joined per-scan total** — a correlation
built by matching timestamps between two independent requests is false
precision, not data. Closing this gap for real needs either a client
(`App.jsx`) contract change forwarding `correlationId`/measured values
from `grade.js` into the `enrich.js` request, or a second KV log sink
inside `grade.js` itself — both are named, scoped-but-not-started
follow-ups, not started this week.

**latency** (`ebayImageSearchLatencyMs`, `comicvineLatencyMs`,
`priceChartingLatencyMs`, `compsLatencyMs`, `aiVerifyLatencyMs`,
`totalLatencyMs`, `visionLatencyMs`) — the first three are new timers
wrapped around `api/enrich.js`'s own existing eBay-image-search
(`lookupEbayVisual`), ComicVine (`lookupComicVine`), and PriceCharting
(`lookupPriceCharting`) calls; `compsLatencyMs`/`aiVerifyLatencyMs`/
`totalLatencyMs` alias the already-computed `out.timings.comps_ms`/
`verify_ms`/`total_ms`. **Documented partial coverage:** ComicVine and
PriceCharting each have multiple call sites in this handler (retries,
subtitle-stripped fallback, a later re-query path) — only the PRIMARY
(first, cache-miss) call at each is timed, not summed across every
retry/fallback. Touching every call site's control flow to sum them was
judged out of scope for an instrumentation-only week; this is a
documented gap, not a silent one.

**identity** (`identityRoute`, `identityOwnedEvidenceOnly`,
`authorityPath`) — all three are derived **read-only** from the existing
`identitySource` string (`src/lib/identityCore.js`, already documented
as "KNOWN-FRAGILE" for exact-match callers due to `+`-joined suffix
mutation). `identityRoute` = `identitySource.split('+')[0]`;
`authorityPath` = the full split array; `identityOwnedEvidenceOnly` =
true only when the route is `barcode`/`manual`/`cgc_cert` (the three
single-source bypass branches in `api/enrich.js`, confirmed via direct
read of the identity-resolution `if/else if/else` chain). None of this
mutates `identitySource` itself.

**cost** (`identityCostUsd`, `conditionCostUsd`, `verificationCostUsd`,
`researchCostUsd`, `totalCostUsd`) — **the four lanes are never blended**
(explicit design goal: showing identity cost trend toward zero while
condition cost doesn't requires keeping them apart). Real mapping,
confirmed by enumerating every `messages.create`/`anthropic.messages`
call site in `api/enrich.js` (there is exactly one):
- `verificationCostUsd` ← `verifyCompsTitles`, the AI-verify comp-title-
  matching pass — the only enrich.js-side Claude call, confirmed against
  its own prompt text (asks Claude to MATCH/NO_MATCH each eBay comp
  listing against the identified book). Attached to its return value as
  a side-channel `_verificationCostUsd` property (same idiom as
  `api/grade.js`'s existing `_watchPasses`, since arrays are objects in
  JS and this is invisible to every existing caller) rather than
  changing the function's return contract.
- `identityCostUsd` — **always null.** There is no identity-
  disambiguation LLM call anywhere inside `api/enrich.js` today; identity
  resolution in this codebase (`resolveIdentity`, `decideFieldAuthority`,
  the whole issue/year-authority machinery) is pure deterministic JS, not
  an LLM call. A hypothesized "aiChooseBestProduct" call was searched for
  and does not exist. This is an honest absence, not an unmapped call —
  flag it here so a future reader doesn't assume a bug.
- `conditionCostUsd` — always null in `scanLog` (cross-request gap
  above); real value computed and logged in `api/grade.js`.
- `researchCostUsd` — fixed `0.0`, reserved for product-keyed enrichment,
  never computed per-scan.

**PRICING_USD_PER_MTOK** (`src/lib/anthropicPricing.js`) — one named
pricing table, verified against Anthropic's official pricing page
(`platform.claude.com/docs/en/about-claude/pricing`, retrieved
2026-08-08) rather than assumed from training data. Keyed on the EXACT
literal model-ID strings this codebase sends — four distinct strings
across two files, not one: `claude-haiku-4-5-20251001`,
`claude-sonnet-4-5-20250929`, `claude-opus-4-7` (all three in
`api/grade.js`), and a fourth, separate **undated alias**
`claude-haiku-4-5` (`api/enrich.js`'s `verifyCompsTitles`, its own
distinct literal string, not the same key as the dated Haiku row). A
table keyed on anything other than what the code actually sends makes
`computeAnthropicCallCostUsd` return `null` on every call and the whole
instrumentation logs nothing — silently. (A review pass initially
flagged `claude-opus-4-7`/`claude-sonnet-4-5-20250929` as stale/invalid
based on general recall; both were re-confirmed live and non-retired
directly against the fetched pricing page before proceeding — worth
recording as a small worked example of why a live source beats memory
even when the pushback sounds confident.) Cache-write TTL uses the SDK's
real `usage.cache_creation.{ephemeral_5m_input_tokens,
ephemeral_1h_input_tokens}` breakdown when present, falling back to
pricing the flat `cache_creation_input_tokens` as 5-minute-only only
because source inspection confirms this codebase's one `cache_control`
call site never sets `ttl: "1h"` — not a general assumption. Static-
prefix token counts use Anthropic's real `messages.countTokens` API
(confirmed present in the installed SDK), cached per
(model, git-SHA, prompt-hash) so it runs once per unique combination,
not once per scan; `promptText.length` is demoted to a diagnostic-only
figure, never the cache-eligibility or reported-token signal.

**evidence** (`conditionEvidenceLevel`, `model`, `modelVersion`,
`promptVersion`) — `conditionEvidenceLevel` hardcoded `'front'` this
week (no per-scan image-count awareness exists yet — TODO, not inferred).
`model`/`modelVersion` describe the condition-assessment (Vision) call,
which happens in `api/grade.js` — always null here, same cross-request
gap as `conditionCostUsd`. `promptVersion` = `process.env
.VERCEL_GIT_COMMIT_SHA` (Vercel's own system env var) — chosen explicitly
over a hand-maintained version constant, since prompt behavior is fully
determined by the deployed commit and a parallel constant would
eventually drift silently from what's actually live. Revisit if prompts
ever move out of this repo.

**sources** (`sourceCalls`, `quotaState`) — `sourceCalls` covers only the
legs this dispatch actually instrumented (ebay-image-search, comicvine,
pricecharting, ai-verify) — explicitly not a comprehensive inventory of
every external call this 10,000+-line handler makes. `quotaState` is
always null; no external API in this codebase currently surfaces quota
headers.

**barcode** (`barcodeDetected`, `barcodeRaw`, `barcodeBase`,
`barcodeSupplementLength`) — capture-only, from the existing opaque
`barcode` request field. `barcodeSupplementLength` is always null: this
codebase has no supplement-digit (2-digit/5-digit UPC add-on) concept
anywhere — the full 12/13-digit scanned or typed string is retained as
one opaque field end-to-end, confirmed via direct read of the client
scanner, the request contract, and `lookupComicVineByUPC`.

`scripts/query-scanlog.mjs` updated to aggregate the new fields
(identityRoute distribution, totalLatencyMs p50/p95, verificationCostUsd
sum/avg) without breaking `--json` raw-dump mode; tolerates pre-Dispatch-
33 records that simply lack these keys. `SCAN_LOG_INDEX_KEY` import
confirmed intact (unchanged by this dispatch — Fix 32-C's actual change
was the `visionLowButCorroborated` field, not this constant; there was
never a separate index-key bug to fix here).

### Step 5A — prompt-caching audit (mechanism shipped, real numbers pending data)

`[cost-audit]`/`[cache-audit]` tagged `console.log` lines added at every
Claude call site in both `api/grade.js` (`callModel`) and
`api/enrich.js` (`verifyCompsTitles`) — real token counts
(`message.usage`), real computed cost (`PRICING_USD_PER_MTOK`), and for
`api/grade.js` specifically, an ESTIMATED static-prefix length via the
cached `countTokens` call described above.

**Precision correction (2026-08-08, same-day review):** the function was
initially named `getStaticPrefixTokenCount` and its log field
`staticPrefixTokens`, both implying a measured, authoritative count.
Anthropic's own token-counting docs
(`platform.claude.com/docs/en/build-with-claude/token-counting`,
retrieved 2026-08-08) say otherwise, verbatim: *"The token count is an
estimate. In some cases, the actual number of input tokens used when
creating a message might differ by a small amount,"* counts *"may
include tokens added automatically by Anthropic for system
optimizations,"* and — the more consequential line — *"token counting
provides an estimate without using caching logic"* — it does not
simulate or confirm caching behavior at all. Renamed to
`getEstimatedStaticPrefixTokens` / `estimatedStaticPrefixTokens`
throughout, with the docstring and log line now stating plainly that
`usage.cache_creation_input_tokens`/`cache_read_input_tokens`/the
`cache_creation.ephemeral_5m_input_tokens`/`ephemeral_1h_input_tokens`
breakdown from a REAL call (already read by `computeAnthropicCallCostUsd`)
are the only authoritative signal — this estimate is diagnostic-only, a
"is this prefix in the right ballpark" check, never a substitute.

A new `classifyCacheEligibility(estimatedTokens, model)` returns
`likely-eligible`/`likely-ineligible`/`unresolved` against real, verified
per-model cache minimums (`platform.claude.com/docs/en/build-with-claude
/prompt-caching`, "Cache limitations" section, retrieved 2026-08-08 —
**no longer "reportedly," now confirmed**: Haiku 4.5 = 4,096 tokens,
Sonnet 4.5 = 1,024 tokens, Opus 4.7 = 2,048 tokens). Estimates landing
within ±10% of the model's minimum classify as `unresolved` rather than
asserting a side of the line — that 10% band is this file's own chosen
diagnostic margin, not an Anthropic-published error figure, and should
be revisited once real `usage` data shows whether it's too tight or too
loose. If a real call's `cache_creation_input_tokens` and
`cache_read_input_tokens` both read 0, the prefix did not meet the
minimum, full stop — that observation always overrides this
classification.

**No real numbers are reported here yet — that would be fabrication.**
Pull them from Vercel runtime logs (or, once accumulated,
`scripts/query-scanlog.mjs` for the `enrich.js`-side lanes) after this
ships and a real batch of scans runs. Whether Haiku's cache hit rate
being 0% (if that's what the data shows) is a bug or correct behavior
given its real 4,096-token minimum is exactly the open question this
logging exists to answer; do not assume either way before the data is
in.

### Step 5B — Fix 4/4b reachability, traced against the G.I. Joe #303 shape

**Terminology hazard found first:** "Fix 4" is reused for at least four
unrelated things in this codebase — a Ship #23 UI button
("Update All Books"), the manual-identity-bypass branch in
`api/enrich.js`, Ship #14's sanity-threshold tuning
(`pricingEngine.js`), and a Dispatch-15 margin-gate proposal that was
never shipped. The mechanism this dispatch actually means is GrailKey
Dispatch 26's "zero-support unanimous rescue"
(`src/lib/identityCore.js:2227-2409`,
`tests/grailkey-dispatch-26-fix4-zero-support-rescue.test.js`) — Fix 4 is
the issue-axis rescue, Fix 4b its year-axis mirror. Recording this here
so the name isn't silently re-collided with in a future dispatch.

**The trace.** Fix 4 fires only when six conditions ALL hold (full detail
in `identityCore.js`'s own comment, `:2240-2290`); the three that matter
for this shape:
1. `issueDecision.outcome === 'conflicted'` and `authoritativeForCustody === false` (Rule D already produced a non-authoritative outcome).
2. Vision's prior isn't independently trusted (never true for a plain Vision guess).
3. **`isIssueZeroSupport(visionIssueCount, total)`** — raw-pool support for Vision's own issue number is at or below the zero-support ratio floor.

For G.I. Joe #303 (Vision issue = 303, 0/20 raw-pool support, per the
dispatch's own framing): condition 3 above **would be satisfied** by this
shape — a 0/20 pool is squarely inside "zero support." But conditions
4-6 (not reproduced in full here — see the source comment) require
`evaluateUnanimousConsensusPromotion` AND `evaluateTitleTextIndependence`
to both pass on the REPLACEMENT candidate — i.e., the family's own issue
axis must show real, independently-worded unanimous consensus (≥4 unique
rows, exact unanimity, no runner-up, weightSum≥8, distinct itemId AND
seller, AND ≥3 distinct Jaccard-clustered title-wording clusters among
the asserting rows). A genuinely scattered pool — the same
"no-consensus" shape already documented for the Jetsons #19 precedent
(Dispatch 03/05 above, ratio below the 60% bar) — would fail this bar and
correctly DECLINE, not fire.

**Conclusion: Fix 4 is not proven unreachable for this shape.** "Reached
the zero-support gate and correctly declined for lack of a real
replacement candidate" is at least as plausible as "never reached at
all," and the two produce identical observable behavior (Vision's own
issue stands, unrescued) — which is exactly why this was unresolvable
from log absence alone before this dispatch's instrumentation. The
`[commit4.3-zero-support-rescue]` log line already fires on BOTH the fire
and decline path (never silent) — what's been missing is aggregate
volume across real scans to tell "reached-and-declines" apart from
"never reached." That's precisely what `scripts/query-scanlog.mjs`
exists to answer once enough records accumulate; no code changed here,
this is a report-only trace per the dispatch's explicit instruction.

### Step 6 — the certification metric (standing gate for every future routing change)

Accuracy alone is the wrong primary metric — a routing change can raise
raw accuracy while making the WRONG cases worse (confidently wrong more
often, on fewer but higher-stakes books). A candidate architecture wins
only if ALL of the following hold, recorded here as the standing bar:

- **PRIMARY — confident-wrong identity rate ↓ toward zero**
  (`confident_wrong / authoritative_identity_results`). This is the
  metric that actually matters: a book shipped as confidently,
  authoritatively identified that is WRONG is worse than one correctly
  flagged as uncertain.
- **SECONDARY — correct authoritative resolution rate ↑ or unchanged.**
  A architecture that reduces confident-wrong purely by resolving fewer
  books authoritatively isn't winning, it's punting — this metric alone
  distinguishes real improvement from that failure mode.
- **GUARD — false refusal rate ↓ or acceptable.** Prevents gaming the
  primary metric by refusing to resolve everything (a system that never
  claims authority can trivially hit zero confident-wrong).
- **ALSO tracked, not gating alone:** fallback parity (the parity harness
  above), identity-correction rate, grade drift, median + p95 latency,
  external cost-per-scan.
- **AND:** no new structural failure class introduced (a genuinely new
  way to be wrong that didn't exist before, distinct from an existing
  failure mode simply occurring at a different rate).

Any future routing/fast-lane proposal is evaluated against this exact
gate, not against raw accuracy alone.

### Step 7 — the parity harness (stub, ships before the shadow lane it will gate)

`tests/grailkey-dispatch-33-parity-harness.test.js` — `assertParity`
deep-compares `identity`/`variant`/`compPool`/`price`/`decision`/
`warnings` between a legacy-path result and a new-architecture result;
anything outside the allowed-diff set (`timing`, `instrumentation`,
`latency`, `cost`, `correlationId`) that differs is a hard FAIL, with no
"close enough" exception. Shipped with **zero cases, on purpose, before
any shadow lane exists** — per explicit instruction, an empty harness
with a documented contract forces the next phase to have a gate already
waiting for it, rather than building the gate to fit whatever gets
written later (which is how parity tests become theater). **Zero cases
is a LOUD SKIP, not a pass** — same reasoning as this project's other
intentionally-red suites (CLAUDE.md's "Known stale test suites"
baseline): an unexplained green reads as coverage to a future session,
and there is none here yet. The harness exits non-zero with an explicit
SKIP banner for as long as it has zero cases; it only becomes a real
pass/fail gate once a future shadow lane adds its first case.

