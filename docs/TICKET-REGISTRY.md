# GrailKey Ticket Registry

Greppable, one line per ticket. No prose beyond the one-line summary. This file
is the state contract — any directive referencing a ticket ID or a structural
fact about this repo must run the preflight check against this file before
doing work (see CLAUDE.md, "Directive preflight requirement").

**Alias rule, absolute:** every retired identifier appears in the `aliases:`
field of its successor. A grep for a dead ticket number must return the live
line below. A dead number must never be greppable as OPEN.

Format: `ID | STATUS | SHA | DATE | ONE-LINE | aliases:`
Status vocabulary (closed set): `OPEN` `CLOSED` `RENAMED` `SUPERSEDED` `DEFERRED`

Populated from `git log` and `docs/PATTERN-LIBRARY.md` on 2026-08-11 against
HEAD `1aa6eb0`. Five tickets could not be conclusively resolved from evidence
in this repo and are marked `UNKNOWN` — see the note block at the bottom.

```
GK-19 | UNKNOWN | -       | -          | Q22/hasSufficientTitleOverlap bigram-join relocation target — status not established | aliases:
GK-21 | CLOSED  | -       | -          | applyVariantFallbackDivergenceCap — divergence-cap mechanism, has its own EX-A(a)-(d) coverage | aliases:
GK-24 | UNKNOWN | -       | -          | printing-axis fallback trigger (priceBands.js) — status not established | aliases:
GK-29 | OPEN    | -       | -          | gradeMult=0.55 displayed but not applied — recurrence logged, untracked | aliases:
GK-31 | CLOSED  | -       | -          | activeAnchoredOverFallbackSold — tier-3 active-anchor-over-fallback-sold mechanism, shipped (regression-test coverage gap tracked separately, not this ticket) | aliases:
GK-34 | CLOSED  | -       | 2026-08-07 | MIN_POOL_FOR_OVERRIDE=3 floor — single thin sold comp no longer overrides N actives (mirror of GK-21), Bone #1 class | aliases:
GK-35 | OPEN    | -       | 2026-08-07 | PRICING_GATE_CODES gap — log only | aliases:
GK-36 | OPEN    | -       | 2026-08-07 | [ship11] visual-pool-fallback median not grade-scoped — log only | aliases:
GK-37 | OPEN    | -       | 2026-08-07 | PUBLISHER_CONSENSUS_PATTERNS no bare-word fallback for major publishers — confirmed not root cause of the case that found it; still open, log only | aliases:
GK-38 | DEFERRED| -       | 2026-08-08 | Fix 2's issue-axis path renders a correction box on a book it just confirmed (identityProvisionalFields not cleared on promotion) — log only, not fixed | aliases: GK-38(draft, Dispatch 48 — unrelated collision, see GK-66)
GK-39 | CLOSED  | f03d564| 2026-08-10 | Fabricated authenticationScore/breakdown/confidence/needsReview deleted; listing gate at App.jsx:7506 removed (GK-39A) | aliases:
GK-40 | OPEN    | -       | 2026-08-08 | Three-to-four independent variant-token vocabularies (drifted-duplicate-constant class) — consolidation not scoped | aliases:
GK-41 | CLOSED  | -       | 2026-08-xx | Non-comic gate fix — shipped same commit as the Dispatch 29/30 wording fix it was found alongside | aliases: GK-41(draft, Dispatch 48 — unrelated collision, see GK-68)
GK-42 | OPEN    | -       | 2026-08-08 | Spawn #351 "Spawn #1" near-miss (commit4.3.1 family-conflict margin decline, prior=1 fabricated issue) — re-check before scoping, may self-resolve via Fix 3a; last checked Dispatch 31, unchanged | aliases: GK-42(draft, Dispatch 48 — unrelated collision, see GK-67)
GK-43 | DEFERRED| -       | 2026-08-08 | gradeBlob non-comic title check — pre-existing, deliberately untouched | aliases:
GK-44 | DEFERRED| -       | 2026-08-08 | Vision unstated-criterion reasoning-shortcut pattern — standing rule for future prompt changes, not a code defect | aliases:
GK-45 | OPEN    | -       | 2026-08-08 | convergence.tier doesn't actually certify PC agreement on issue/title (dead .issue axis, missing title/pc key) — log only | aliases:
GK-46 | OPEN    | -       | 2026-08-08 | soldVerification.js:934 zero-pool variant fallback already unconditionally reachable regardless of variantIdentitySource — log only | aliases:
GK-47 | UNKNOWN | -       | -          | Referenced as a pre-existing externally-assigned label (App.jsx, Dispatch 48) — never formally logged in this repo | aliases:
GK-48 | UNKNOWN | -       | -          | Referenced as a pre-existing externally-assigned label (App.jsx fold-in, reconfirmed live Dispatch 48) — never formally logged in this repo | aliases:
GK-49 | UNKNOWN | -       | -          | Referenced as a pre-existing externally-assigned label (api/comps.js:442 fold-in, reconfirmed live Dispatch 48) — never formally logged in this repo | aliases:
GK-50 | OPEN    | -       | 2026-08-10 | Logged verbatim as reported by operator (Dispatch 42-I) — not investigated | aliases:
GK-51 | OPEN    | -       | 2026-08-10 | Era filter returns bypassed:false while actually bypassing | aliases:
GK-52 | OPEN    | -       | 2026-08-10 | yearCorrected true when the raw year was empty | aliases:
GK-53 | OPEN    | -       | 2026-08-10 | noImage:true on scans that had images | aliases:
GK-54 | OPEN    | -       | 2026-08-10 | comicVine:{} stored on no-match — 3 of 5 production records | aliases:
GK-55 | CLOSED  | cf96d1b| 2026-08-10 | Shipped same push as Dispatch 42-I (SAFE-KILL certification) | aliases:
GK-56 | OPEN    | -       | 2026-08-10 | Same eBay listing ID present in both active and sold pools — double-counted as two independent observations | aliases:
GK-57 | OPEN    | -       | 2026-08-10 | [bulk] "year healed" and [persist-bulk] both logged twice for one savedId | aliases:
GK-62 | CLOSED  | 33079e4| 2026-08-10 | convergenceSources' vision slot no longer self-corroborates (a value must not vote for itself) | aliases:
GK-63 | RENAMED | -       | 2026-08-10 | Retired Dispatch 46B — see GK-65 (renumbered so GK-62 stays unique to the vision-provenance fix) | aliases: -> GK-65
GK-64 | OPEN    | -       | 2026-08-10 | identityAlignment is a stale Phase-2 snapshot vs. terminal out.confirmedYear, unmarked — not worked | aliases:
GK-65 | SUPERSEDED | f03d564 | 2026-08-10 | identityAlignment never persisted to IndexedDB (listing gate structurally unreachable) — resolved not by fixing persistence but by deleting the gate outright in the same push as GK-39A; underlying non-persistence fact itself still true, just nothing depends on it now | aliases: GK-63(draft)
GK-66 | CLOSED  | d07c236| 2026-08-10 | priceLadder removed as HOLD_FOR_CGC decision authority | aliases: GK-38(draft, Dispatch 48)
GK-67 | CLOSED  | c0653a5| 2026-08-10 | Pricing-source display truth (blend-line + source-label fixes), zero computation change | aliases: GK-42(draft, Dispatch 48)
GK-68 | OPEN    | -       | 2026-08-11 | Quick band never floor-checked. Was DEFERRED (2026-08-10) on the premise that operational band-suppression removed the exposure; reclassified to OPEN (Directive G Task 3) — Directive F proved the gap surfaces through the decision-warning panel (recommended-below-floor), which is NOT suppressed, and GK-74 made its detection live in production the same day. The deferral premise is false. Not fixed here — Directive G Task 1 fixed the false "raised to $X" wording only, not the underlying missing floor enforcement | aliases: GK-41(draft, Dispatch 48)
GK-69 | OPEN    | -       | 2026-08-10 | Pricing-derivation custody gap — priceDerivationTrace/blendedAvg never persist to IndexedDB, priceLadder does — logged, not fixed | aliases:
GK-70 | OPEN    | -       | 2026-08-11 | api/comps.js:1803 — eBay grade-proximity comp filter falls back to the FULL unfiltered pool when the grade filter would remove every comp (Resurrect-Rejected-Evidence shape, 4th instance, found sweeping GK-66-class gates in Directive B Task 3). Deliberately NOT fixed: closing it changes which comps enter price computation — pricing-math boundary, needs its own greenlight | aliases:
GK-71 | CLOSED  | f6ce28e | 2026-08-11 | Three ComicVine identity gates (year-strict, token, publisher) no longer restore the rejected candidate set when the filtered set is empty — candidates.length=0 instead, matching the reprint-publisher gate's pre-existing Q99 precedent. Generalizes the standing "Rejection Must Not Create Authority" invariant | aliases:
GK-72 | CLOSED  | bbcb716 | 2026-08-11 | eBay UNAVAILABLE != EMPTY — emptyComps() classifies outage vs genuine-zero at the source, out.ebaySourceUnavailable/Reason surfaced unconditionally (not just in the refuse-to-price path), decisionEngine escalates to RESEARCH via a new critical warning, refuse-to-price priceNote distinguishes outage from a genuine zero-market book | aliases:
GK-73 | OPEN    | -       | 2026-08-11 | out.ebaySourceUnavailable/Reason merge gap in App.jsx — CORRECTED on direct code inspection from the "3 sites, all dropping" premise this ticket was opened against. Two sites confirmed genuinely dropping a fresh flag: duplicate-confirm (~App.jsx:12845) and reIdentifyBook (~App.jsx:12093) both build their updated catalogue object from an explicit field list (`{ ...cur/item, field: enrich.X ?? cur.X, ... }`) that never references ebaySourceUnavailable/Reason at all, so a genuine new true from a fresh /api/enrich response is silently discarded and whatever the old item had (often nothing) survives instead. The third originally-suspected site, submitManualCorrection (buildCorrectedCatalogueItem, src/lib/manualCorrection.js), does NOT exhibit this — its merge is a full spread of the enrichData response (`{...cleared, ...enrichData}`), and ebaySourceUnavailable/Reason are in neither its clear-list nor its preserve-list, so a genuine new true is copied through correctly. It has a narrower, different gap instead: api/enrich.js:6240-6244 only ever explicitly sets out.ebaySourceUnavailable=true (no else branch clears/sets it false on the healthy path), so a stale true from before a correction can survive a correction whose new response is genuinely healthy and simply omits the key. TRIGGER (duplicate-confirm/reIdentifyBook): a re-identified or duplicate-confirmed book shows a normal price where it previously would have shown eBay-unavailable. TRIGGER (manual correction): a corrected book still shows eBay-unavailable after a correction that actually resolved cleanly. Deliberately deferred under Operator Mode Hold — not fixed, App.jsx not touched. | aliases:
GK-74 | CLOSED  | 359f751 | 2026-08-11 | decisionEngine.js's numeric safety checks were dead code against real production data — `item.price`/`systemPrice` is a currency STRING ("$800.00", via `fmtUsd()`) by the time `computeDecision(out,...)` runs, and every magnitude-based `>`/`<` comparison against it (catastrophic-system-overprice blocker, active-floor-far-below, recommended-below-floor, active-avg-far-below CRITICAL warning) silently evaluated false via NaN coercion. FIXED: `computeDecision` parses `item.price` to a local numeric (`systemPrice`, via `responseContract.js`'s `parsePriceNumber`) once, near the top, before any of these CHECK sites — reactivating all four on real data (Bone #1 real-shape regression: LIST_NOW → DO_NOT_LIST). SCOPE LIMIT, deliberately not closed by this fix: every `decision.price =` COMPUTATION site (`decisionEngine.js:862-865` et al.) still reads the raw `item.price` STRING unchanged, and `computeBestChannel`'s own separate `item.price` read is independently untouched — reaching either would unmask new values into the UI and needs its own greenlight. That remaining scope is GK-75, not this ticket. Verified: `tests/grailkey-dispatch-74-price-coercion.test.js` (12/12), `tests/decision-engine.test.js` 39/7/46 unchanged (documented baseline), zero regressions across 30 other dependent test files | aliases:
GK-75 | OPEN    | -       | 2026-08-11 | GK-74's explicit scope limit, not yet worked: remaining formatted-price ("$X.XX" string) read sites in `decisionEngine.js` that still do raw numeric arithmetic/comparison against `item.price` without `parsePriceNumber` coercion. Two named instances: the catalogue exit-strategy filter `c.price < 10` (~line 816, part of `computeBestChannel`'s bundle-routing logic) and `computeBestChannel`'s own top-of-function `item.price` read (~line 16, `const price = item.price ?? null;` then used directly in `price > 50`/`price < 25` comparisons a few lines later) — both independently NaN-prone on the real fmtUsd()-string shape, same root cause as GK-74, different call sites GK-74 deliberately left untouched. TRIGGER: exit-strategy recommendation (grade/barter/bundle routing) is identical across all books regardless of price or grade — the price-magnitude branches in `computeBestChannel` never numerically evaluate on real data, so every book falls through to the same default routing regardless of its actual price. Touches `decisionEngine.js`'s decision logic (not pure display) — pricing/decision-math boundary, needs its own greenlight before implementation | aliases:
GK-76 | OPEN    | -       | 2026-08-11 | Validation Bypass on Authority Replacement (Directive G Task 3/4) — `api/enrich.js:6649-6661` (the 22c-title-revote path) writes a fresh `out.pcProductId`/`out.pcProductName` from a re-queried PriceCharting match WITHOUT re-running the `pc-anchor-gate` year/name/discriminator validation (`api/enrich.js:5045-5126`) that governed the ORIGINAL PC match. A revoted match receives strictly less scrutiny than the first one did. Distinct failure class from Computed-Then-Discarded (nothing here is computed and discarded — a NEW value bypasses a gate that governed its PREDECESSOR); see the Authority Propagation Invariant, `docs/PATTERN-LIBRARY.md`. TRIGGER: a book whose title is revoted mid-scan (unanimous rejection + PC no-match on the original title, per the `[22c-title-revote]` log tag) renders PC evidence that would have failed the original anchor gate had it been checked against the revoted title/year. Not fixed — found during Directive F's Task 1 trace, logged here per Directive G Task 3's instruction; needs its own scoping (does the revote re-run the full gate, or a narrower re-check?) before implementation | aliases:
```

## UNKNOWN tickets — need Jimmy

Five tickets appear only as bare cross-references in CLAUDE.md / the Pattern
Library, with no dedicated write-up found in this repo establishing a shipped
SHA or a current open/closed state. Not guessed — flagged:

- **GK-19** — the `hasSufficientTitleOverlap` bigram-join relocation target
  named when Q22's stale assertions were characterized. Referenced only in
  CLAUDE.md's stale-test-suite section, never independently confirmed shipped
  or still open.
- **GK-24** — the "printing-axis fallback trigger" in `priceBands.js`,
  referenced only as a file-overlap check against the `priceBands (7)`
  test-failure triage. No dedicated entry found.
- **GK-47, GK-48, GK-49** — all three are referenced in Dispatch 48's entry as
  "pre-existing labels this repo had never logged" (i.e. externally assigned
  numbers this repo's own dispatches inherited mid-sequence) — Dispatch 50
  explicitly declined to backfill full write-ups for them, only noting their
  existence so a future renumbering pass wouldn't collide. Still true here:
  this pass does not backfill them either, consistent with that same decision.

## Related, not in this registry — do not confuse with GK-N

`Ship #NN` and `Q-NN` are a separate, older, stable identifier namespace with
no observed collision/renumbering problem — out of scope for this registry.
The renumbering problem this file exists to fix is specific to the `GK-N`
family (see GK-38/41/42's draft-vs-original collision above, the concrete
case that motivated this file).

## Observations

Non-ticket notes — record only, no GK-N assigned, no status tracked.

- **Classics Illustrated #26, 2026-08-11 re-scan.** Taxonomy changed
  `ID_REQUIRED` → `RESEARCH` between two scans of the same book. Containment
  held: price authority cleared, listing locked, Decision Safe false, price 0,
  identity unresolved. Phase 2 promoted a provisional identity (`pool family
  has 6 members >= 3 floor`), which moved the label but not the boundary. No
  defect established.
