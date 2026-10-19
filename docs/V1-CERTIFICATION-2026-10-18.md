# V1 Certification — 2026-10-18

Base: Production `ba82e93` (= origin/main). Branch `v1-certification-rc`. NOT pushed, NOT deployed.

> **STATUS CORRECTED 2026-10-19 — HOLD. Full-suite certification is NOT established.** The original text below is preserved unchanged; see "CORRECTION 2026-10-19" at the end of this document.

## Scorecard (what was actually tested)
| | Area | Verdict | Evidence / scope |
|---|---|---|---|
| A | Capture & evidence integrity | PASS (local) | v1-p0d-physical-evidence-authenticity 50/50 (real capture-scan handler + Development DB); screen/uncertain captures withhold physical claims, grade PROVISIONAL, never "verified"; attestation required. Model screen-detection is a claim only (residual). Production: not verified. |
| B | Exact-object identity & edition authority | PASS (local) | v1-enrich-handler-truthfulness 14/14 over the real 29-listing Street Fighter pool; foreign-edition claim needs transcription, else dropped; unresolved edition => identityStanding CONFLICTED. P0-C (fa9b27f) is NOT in this branch (separate, local-only). |
| C | Condition assessment & uncertainty | PARTIAL | Containment of unsupported claims done; grade accuracy itself not calibrated (no blind certified corpus, per GRADING-CAMPAIGN). NOT CERTIFIED for grade accuracy. |
| D | Market evidence, pricing, economic refusal | PASS (local) | $19 = activeAvg 22.3476 x 0.85 (grade multiplier does not enter), real handler; label "active asks (not sold-verified)"; NO_SOLD_EVIDENCE REVIEW lock holds. Comp-pool leakage (lots/Gold/other-publisher) NOT fixed — pricing-math greenlight needed. |
| E | Durable ownership & Collection management | PASS (local/dev) | u1-generic-book-live 85/85, second-principal 20/20, gk253/254 130/130 (Book never becomes Comic). Production has zero physical assets besides Old Man Logan #25. |
| F | Auth, session recovery, principal isolation | PASS (local/dev) | gk268-auth-recovery-ux 52/52, google-login 13/13, second-principal-capture-certification 20/20. /api/assets 404 = "no asset linked to this item" (by design, UI treats as none). Session is fixed 12h, no refresh: relogin required (UX friction, not a defect). |
| G | Operator corrections & provenance | PASS (local) | operator-confirmed title/variant/grade authority tests in base; attestation + capture-authenticity recorded in asset.minted event. |
| H | Governed marketplace listing readiness | NOT CERTIFIED | GK-240 fail-open fixed and proven through real list-ebay handler (172/172). Old Man Logan blocked by operator-only gates (below). |
| I | Realized economic outcome | NOT CERTIFIED | Requires a real completed external sale. |

## Defects repaired
1. GK-240: `api/list-ebay.js` now resolves authority evidence from the owned asset's durable row first (`src/lib/listingAuthorityEvidence.js`); absent sold diagnostics FAIL CLOSED. Tests: v1-gk240-listing-authority-fail-closed 9/9; list-ebay-outcome1-handler-smoke 172/172 (new forged-READY scenario -> 403, zero eBay writes).
2. Verification truthfulness: skipped claude-check = `{verified:null,status:'SKIPPED'}`; legacy cached `verified:true+skipReason` reclassified; priceNote says "active asks (not sold-verified)" for ask-derived prices.
3. P0-D: `src/lib/captureAuthenticity.js`, grade.js prompt/shapes/choke point, `src/lib/ownershipAttestation.js`; `/api/capture-scan` requires the fixed attestation statement (400 OWNERSHIP_ATTESTATION_REQUIRED) and refuses scan-flagged screens (400 CAPTURE_REFERENCE_ONLY); both client capture paths gained an unchecked-by-default checkbox; durable provenance in `asset.minted`.
4. Identity: unresolved edition => identityStanding CONFLICTED (`actionAuthority.js`).
5. UI: "Low match 100/100" contradiction (score hidden when tiers disagree); reference-only/provisional notice.

## Pre-existing failures (identical on pristine ba82e93, not regressions)
> *[Correction 2026-10-19: this claim came from a small targeted subset and was NOT shown for the full suite. It is retained as originally written. See the end of this document.]*

gk227-asset-media-append-handler-smoke (4/28), grailkey-operator-panel-capture-wiring (4/4, fixture collision with retained Development rows), p0a-rescan-continuity-handler-proof (5), gk168-edition-facet (18), gk159-commit4-terminal-floor-handler-smoke (8), gk277 (1, global-count race).

## Banked, not fixed
- Comp pool admits multi-issue lots ("#1 & 3"), "Gold Edition", other-publisher and "Best of" listings; no raw-pool grade-proximity filter (pricing-math greenlight).
- Active-path `comps.lastSoldDate`/`recentSales` carry an active listing's end date (api/comps.js:2470); not displayed as a sale (contract.lastSold is null).
- Collection attributes are client-synced; durable-evidence authority in list-ebay is per-request-forgery-proof, not server-computed.
- Authenticity detection is the model's claim; the attestation is the ownership control.

## Old Man Logan #25 (marketplace)
A2 resolved on Production code: title is `Old Man Logan Deodato #25 1:25 Marvel 2017 Raw NM-` (the earlier bare-"9.2" title was computed on stale local code). A3: `authoritativeRecommendation` ($4.18) is a stale enrich-time copy of out.price kept by `||` merge precedence; nothing in listing/price code reads it. A1 (confirmedTitle "Wolverine: Old Man Logan Giant-Size" vs the comic) and identity confirmations, persisted $19.99 price, Q41/LIST approval, seller identity (`/api/ebay-connection?verify=1`), duplicate state and eBay policies require the operator.

---
## CORRECTION 2026-10-19 — the "pre-existing failures" statement did not establish full-suite behavior

**Process finding: a result observed in a selected test subset was represented as a property of the complete certification suite.**

### What the original statement said
That six groups (gk227-asset-media-append-handler-smoke, grailkey-operator-panel-capture-wiring, p0a-rescan-continuity-handler-proof, gk168-edition-facet,
gk159-commit4-terminal-floor-handler-smoke, gk277) "fail identically on pristine ba82e93, not regressions". That came from a 34-file targeted subset. It did not run, and could not
establish, the behavior of the complete suite on either tree.

### What the first full sweep of RC `56b2448` recorded (2026-10-19, sequential runner, incremental log `rc.jsonl`, preserved read-only)
| Outcome | Files |
|---|---|
| Planned sweep | 469 test files |
| PASS | 181 |
| FAIL | 37 |
| TIMEOUT (90 s) | 8 |
| ENV_ERROR (process never started: Windows 0xC0000142 under memory pressure) | 243 — NOT failures and NOT coverage |
Of the six documented groups: **3 FAIL** (gk227-asset-media-append-handler-smoke, gk159-commit4-terminal-floor-handler-smoke, gk168-edition-facet), **2 ENV_ERROR**
(grailkey-operator-panel-capture-wiring, p0a-rescan-continuity-handler-proof), **1 PASS** (gk277).
**34 of the 37 failed files are outside the six documented groups.**

### Evidence grading of the 37 failures (C1/C2 review)
| Level | Basis | Files |
|---|---|---|
| PROVEN | E3 source-equivalence: the asserted source condition is identical in baseline and RC | grailkey-commit-f, grailkey-commit-v1, gk201-operator-path-source-contract, gk252-book-client-acceptance (4) |
| PROVEN | E1: identical failure signature executed on pristine ba82e93 | artist-registry-sync, asset-graph-operator-actions-live-proof (2) |
| STRONG | E2: identical signature on Lane B (ba82e93-based, no RC code) | b1rc-ebay-xml-contract, beta1a-0022-live-apply-gate (2) |
| STRONG (environment, not a code defect) | E4/E4b: required environment variable not set in the test process | gk179-environment-guard-latency, gk179-environment-guard-wiring-smoke, gk179-environment-marker-migration-contract, gk194-stored-function-resolution-scratch (4) |
| WEAK | E1b: pristine baseline failed with the same exit code only (signature not compared) | batch1-fixes, comp-filter-hygiene, gk157-158-handler-smoke (3) |
| WEAK | E5: the test references no RC-changed file (absence of evidence of dependence) | d4-identifier-fabric-live-concurrency, d4-identifier-fabric-live-retry-closure, d4-identifier-fabric-live-retry-deterministic, d5a-market-observation-migration-contract, decision-engine (5) |
| UNRESOLVED | three documented-group failures not independently verified on pristine baseline | gk227-asset-media-append-handler-smoke, gk159-commit4-terminal-floor-handler-smoke, gk168-edition-facet (3) |
| UNRESOLVED | no baseline run, no source proof | eux-edition-verify-panel, gk152-handler-smoke, gk184-evidence-observed-at-unit, gk184-handler-smoke, gk213a-identity-authority, gk227-0029-migration-contract, gk229-content-unverified-handler-smoke, gk270-canonical-collection-projection, gk270-relink-tool, gk271-enrich-handler-smoke, gk272-classic-comics-refused-conflict-smoke, gk276-enrich-canary-handler-smoke, gk280a-amendment (13) |
| (documented elsewhere) | no bearer token, so 401 (code-health notes B3) | grailkey-directive-aj-http-handler (1) |
Environment-dependent failures are kept distinct from pre-existing code defects; **it is not claimed that all previously grouped files are conclusively pre-existing.**

### Disposition
- **Certification status: HOLD. Full-suite certification is not established.**
- RC `56b2448` additionally has a demonstrated /api/collection authority bypass (fixed on branch `v1-source-authority`).
- The 243 ENV_ERROR RC files are deferred (the superseded RC will not be certified); they remain ENV_ERROR in the record.
- Historical sweep results are preserved unchanged (`rc.jsonl`, `rc.jsonl.preserved-20261019`).
