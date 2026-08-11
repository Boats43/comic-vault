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
GK-68 | DEFERRED| -       | 2026-08-10 | Quick band never floor-checked — decided B (no displayed recommendation may contradict a displayed floor), enacted via operational band-suppression not code; underlying floor gap backlogged against band re-enablement | aliases: GK-41(draft, Dispatch 48)
GK-69 | OPEN    | -       | 2026-08-10 | Pricing-derivation custody gap — priceDerivationTrace/blendedAvg never persist to IndexedDB, priceLadder does — logged, not fixed | aliases:
GK-70 | OPEN    | -       | 2026-08-11 | api/comps.js:1803 — eBay grade-proximity comp filter falls back to the FULL unfiltered pool when the grade filter would remove every comp (Resurrect-Rejected-Evidence shape, 4th instance, found sweeping GK-66-class gates in Directive B Task 3). Deliberately NOT fixed: closing it changes which comps enter price computation — pricing-math boundary, needs its own greenlight | aliases:
GK-71 | CLOSED  | f6ce28e | 2026-08-11 | Three ComicVine identity gates (year-strict, token, publisher) no longer restore the rejected candidate set when the filtered set is empty — candidates.length=0 instead, matching the reprint-publisher gate's pre-existing Q99 precedent. Generalizes the standing "Rejection Must Not Create Authority" invariant | aliases:
GK-72 | CLOSED  | bbcb716 | 2026-08-11 | eBay UNAVAILABLE != EMPTY — emptyComps() classifies outage vs genuine-zero at the source, out.ebaySourceUnavailable/Reason surfaced unconditionally (not just in the refuse-to-price path), decisionEngine escalates to RESEARCH via a new critical warning, refuse-to-price priceNote distinguishes outage from a genuine zero-market book | aliases:
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
