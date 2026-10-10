# Grading Campaign — control plane, provenance, economic grade authority, corpus contract

Recorded 2026-10-05. Not a broad architecture campaign.

## Campaign spine (no stage may claim what a later stage must prove)

1. REMOVE INVALID GRADE AUTHORITY — client/model-confidence `gradeLocked` (this release candidate); sold-comp client grade (OPEN, hard gate below).
2. MEASURE PROVENANCE RELIABILITY — Phase 1 observe-only counters (this RC); refusal is a later pass.
3. MAKE PREDICTIONS RECONSTRUCTIBLE — additive `evidence` metadata on the GRADE prediction payload.
4. BUILD BLIND CERTIFIED CORPUS — contract below; ZERO usable examples today.
5. MEASURE STABILITY / RESOLUTION / PRIMING — not run.
6. ONLY THEN CALIBRATE THE RUBRIC.

**NO RUBRIC CALIBRATION BEFORE CORPUS.**

## Standing process law

**A CONDITIONAL STOP IS A STOP. THE CONDITION IS EVALUATED BY THE REVIEWER, NOT THE IMPLEMENTER.** "IF X -> STOP / HOLD / REPORT" means return the finding and wait for reviewer authorization; do not evaluate X and keep implementing in the same pass.

## Permanent laws

- MODEL CONFIDENCE IS NOT AUTHORITY.
- A BARCODE OBSERVES IDENTITY, NOT CONDITION.
- CLIENT STATE MAY NOT MINT GRADE AUTHORITY.
- A CLIENT MAY NOT CHOOSE WHICH EVIDENCE THE SERVER BELIEVES.
- ONE GOVERNING GRADE MUST GOVERN THE ENTIRE ECONOMIC DECISION FOR THAT VALUATION.
- NEW MATERIAL VISUAL EVIDENCE MUST BE ABLE TO GENERATE A NEW MODEL PREDICTION.
- A GRADE MAY NOT BECOME ECONOMICALLY LOAD-BEARING WITHOUT A DURABLE RECORD THAT IT WAS PREDICTED (recorded, NOT yet enforced; GK-274 precedent: NULL IS NOT NEUTRAL).
- A PARAMETER VALIDATED FOR IDENTITY MAY NOT GOVERN CONDITION WITHOUT ITS OWN EVIDENCE (800px: chosen for cover IDENTIFICATION, commit `6fcd7e6`; never validated for condition).
- PRODUCTION MODEL REFERENCES SHOULD USE IMMUTABLE / DATED IDS WHERE THE PROVIDER SUPPORTS THEM.

## OUTSIDE-USER HARD GATES (before Production principal #2)

1. **CLIENT SOLD-COMP GRADE AUTHORITY CLOSED** — OPEN. CLIENT ECONOMIC AUTHORITY DEFECT: `api/enrich.js` passes the raw request `grade` (`assessedGrade: grade`, plus `fetchComps({ grade })`) into evidence admission BEFORE `resolveGoverningGrade`. It controls sold-comp +/-1.5 proximity, qualitative low-grade ceilings, the price-ladder floor, GK-228 ungraded-title handling and active-comp proximity. A client can post a different grade and change the evidence pool behind a `SERVER_DERIVED` valuation.
2. Seller location no longer hardcoded Phoenix.
3. DELISTED / relist normal operator recovery.
4. Existing multi-user identity/isolation requirements remain satisfied.

Until gate 1 closes, an outside user may exercise asset management but must not cross into economic-decision / listing behavior that depends on client-influenced grade evidence.

### Client callers of `/api/enrich` that supply `grade` (all client-mutable; none server-verified)
scan (`gradeBlob`) and bulk import: raw model grade from `/api/grade`; auto-refresh / refresh / manual refresh: `item.grade` from the catalogue (IndexedDB, also a client-writable synced attribute); re-identify: fresh `gradeData.grade`; manual entry: `manualGrade` typed by the user; barcode: no grade. Operator grade / certified grade are resolved separately and earlier on the server from the durable row (owned flows only) and govern the MULTIPLIER path only.

### Proposed minimum correction (design only, not implemented)
Reuse `resolveGoverningGrade` (`src/lib/gradeAuthority.js`); do not invent an authority system. `effectiveGradeAuthority`/`effectiveOperatorGrade` are already resolved server-side near the top of the handler (before comps/sold fetch), so the call can be moved before admission: compute ONE `governing` early with precedence (1) verified certified grade, (2) operator-confirmed grade, (3) server-recorded model prediction, (4) none; feed it to `fetchComps({grade})`, `verifySoldComps({assessedGrade})`, ladder selection, multiplier, valuation and decision. Tiers 1-2 are available today. Tier 3 is available only for a first grade (receipt / write-once baseline); a re-grade has no durable item->latest-prediction link, so tier 3 needs either a claimed receipt on re-grade or the item's own server-held record. When only a client grade exists (tier 4), the evidence must be admitted grade-agnostically or the economics refused: a pricing-evidence change that needs reviewer/greenlight authorization.

### Internal inconsistency today (model 2.0, operator validly corrects to 4.0)
Sold proximity, ungraded-title rule, active-comp proximity and ladder selection use the REQUEST grade (item.grade stays the model 2.0; operator fields are separate). Only the multiplier/`governingGrade` use the operator 4.0. Tier-2 `sold_active_blend_30` applies no multiplier, so the whole valuation is built from the 2.0 evidence pool while the card says governing 4.0. Desired: every stage uses the one governing 4.0.

## Traced facts

- `chooseBetterGrade` is CONFIDENCE-BASED on pricing `confidenceLevel` (not authority/magnitude/recency); it runs only after `/api/enrich` merges (auto-refresh, scan-enrich, bulk-enrich), `/api/enrich` never returns a model grade (`out.grade` is CGC-cert only), so it can neither install nor block a model grade. Latent, dormant defect: a CGC-verified grade could be rejected on a low pricing-confidence rank.
- Server-ignored legacy request fields: `gradeLocked`, `existingGrade`, `gradeConfidence`, `forceRegrade` are INERT in `api/grade.js`. Clients still send `existingGrade`/`gradeConfidence`/`forceRegrade` as dead payload. Do NOT reconnect any of them as authority.
- First grade: KV receipt (6h) claimed once into write-once `modelPredictedProvenance`; `model_prediction_event` is attempted for EVERY `/api/grade` call (first and re-grade) but its `inputHash` covers only `images[0]`, not the full photo set. A re-grade's receipt is never claimed (client sends no `_gradeReceiptId` for it), so if its event write fails NO durable provenance remains; the re-grade can still become current (`grade: data.grade || item.grade`) and reach pricing via the client-sent grade.
- Barcode path: Vision skipped, no image, no grade; `/api/enrich` never invents one; the item saves with `grade: ""`.
- Opus: provider lists `claude-opus-4-7` only undated; no dated Opus 4.7 id exists. Do not invent one. Banked (Watch only).

## Phase 1 observability (implemented in this RC, additive, no schema migration)

`src/lib/gradeProvenanceObservability.js`: one structured `[grade-provenance]` log line plus an Upstash daily counter per event:
`gk:gradeprov:v1:<UTC day>:<prediction|receipt>:<ok|write_failed|issued|not_issued>:<branch>:<model>:<buildSha>:<FIRST_GRADE|RE_GRADE>`.
Failure rate per kind = `write_failed / (ok + write_failed)`. `predictionKind` is an observability label only (client label, else inferred from image count). No prompt, image, condition prose or principal id. The grade continues exactly as before; persistence stays non-mandatory. IMPLEMENTED LOCALLY: not shipped, not deployed, not measuring Production yet. Phase 2 (refusal of a grade lacking durable prediction provenance) is a separate later pass after the measured rate.

## Photo roles and material re-grade rule

Role trace: the GK-227 evidence control in `GrailKeyOperatorPanel.jsx` (Back / Spine / Pages, only for kernel-linked items) passes `{gkAssetId, captureView}` to `addPhotoToComic`, which sends `imageViews` with ONLY the new photo's role (all earlier entries null) to `/api/grade` (guard + prediction-event metadata) and appends a kernel `media.capture_view` row; the role is NOT stored per image in IndexedDB / the catalogue `images` array. The ordinary saved-item Add Photo (`handleAddPhotoChange`) declares NO role. Classification: B (one path has a role, another does not), plus A for earlier photos (role known at capture, then dropped). Target rule (not implemented): first declared BACK / SPINE / PAGES is material; the same role again, a same-input-hash duplicate or an undeclared image is not (never infer from count); extra images are always preserved. Held because the ordinary strip has no role selector and roles are not retained per image.

## Spend delta (the RC is NOT spend-neutral; pricing math is unchanged)

Grade call = 3 units, enrich = 2; per-principal cap 300/day, global 6000/day. Photo cap is 4, so at most 3 Add Photo re-grades per fill. BEFORE: a HIGH-confidence (locked) asset's Add Photo cost 0 units; unlocked cost 3 each. AFTER: every Add Photo costs 3. Worst case per asset ending with 4 photos: before 3 (initial grade) [+9 if unlocked]; after 12 (+2 enrich initial = 14). Active-user projection at the full 4-photo path, 14 units/asset: 10 assets/day = 140 (headroom 160), 25 = 350 (EXCEEDS the 300 principal cap), 50 = 700; before the RC, all-locked: 5 units/asset = 50 / 125 / 250. Hard bounds that remain: the 4-photo cap per fill and the per-principal daily cap (a 429 refusal, fail-closed). Not bounded per asset: delete-and-re-add and explicit re-identify (each costs 3), still capped by the daily guard. `SPEND_GUARD_OPERATOR_PRINCIPAL_IDS`: CANNOT VERIFY. Options (reviewer authorization needed): per-asset automatic re-grade ceiling, or ship the material-view rule (needs role capture first).

## Test-debt diagnosis (identical at `11f9481` and at the RC)

- gk260 (62 pass / 3 fail, then a crash): sections 1-2 send UNAUTHENTICATED requests and now get HTTP 401 from the GK-269 access gate (`ea9aa6e`, 2026-09-30), so `body.gradeAuthority` is `undefined` not `null` (stale fixture; the forged claim is never minted, passing assertions in those sections pass vacuously). The final cleanup `DELETE FROM gk_principal` violates `operator_correction_event_principal_id_fkey` (GK-278 `6e9595e`, 2026-10-02): harness cleanup debt, and every run leaks one fixture principal in Development. All authenticated sections pass. Not behavioral.
- gk258: every request is unauthenticated -> 401 (GK-269), so its refuse-to-price assertions never reach pricing. It currently proves NOTHING about GK-258 behavior (stale fixture).
- gk213c: its two failing assertions expect pre-GK-269 unauthenticated behavior; same FK cleanup crash as gk260.

## Material below is unchanged from the earlier campaign record

### Branch determinism (experiment design only)
Pin the branch by calling the model directly from a Development-only scratch script (no handler, no writes): SONNET = STANDARD_PROMPT with the dated Sonnet id; HAIKU = `buildGradeOnlyPrompt` with a fixed hand-supplied consensus and the dated Haiku id; same image bytes. The handler cannot pin a branch (eBay consensus >=0.3 chooses it and it is re-chosen on every call). SHOULD IDENTITY-RETRIEVAL SUCCESS CHOOSE THE CONDITION-GRADING MODEL? NO: it is unrelated to condition difficulty, silently changes both model and prompt (identity-primed Haiku vs unprimed Sonnet), and makes the same book gradeable two ways.

### Ground-truth corpus contract (schema only; not built)
Each example: `corpus_item_id`, `certifying_body`, `certified_grade`, `certification_number` / verification reference, `authority_class = KNOWN_CERTIFIED_GRADE`, `capture_device`, `capture_conditions`, `truth_image_reference`, `blind_grading_image_reference`, `view_role`, `image_dimensions`, `slabbed_or_raw`, `model_visible_grade_label = false`, `notes`. The blind image MUST NOT expose the certified grade, certification number, barcode, QR code or filename metadata encoding the grade; slabbed: truth image shows the label, blind image excludes the label/cert area. SLAB PLASTIC / GLARE IS A DOMAIN SHIFT FROM RAW-COMIC PHOTOGRAPHY; pre-slab raw photos tied to a certified grade are preferred.

KNOWN_CERTIFIED_GRADE is the best available anchor, NOT a physical constant (professional grading has inter-grader / re-submission variance). Calibration targets directional bias, band accuracy, stability, severe outliers and reproducibility, NOT zero numeric error against every slab label.

Initial target about 10-20 examples: LOW 0.5-2.5; MID-LOW 3.0-4.5; MID 5.0-6.5; HIGH 7.0-8.5; VERY HIGH 9.0+. Current usable authoritative examples: ZERO.

## Banked test debt

- **gk258 merge-site coverage (GK-213B scope debt):** the old self-labelled PRE-EXISTING assertion expected `governingGrade` at exactly 1 of the 8 `App.jsx` merge sites; the count is now 8, so the stale expectation (not a defect) was removed from the executable assertions and the test only logs the count.
- **Deleted non-discriminating assertions (mutation proof: they passed with and without the protected behavior):** see the commit message of the release-hygiene commit for the per-assertion coverage statement.
- **COVERAGE LOSS (disclosed):** the GK-254 `ownedAssetAuthRequired` fail-closed branch inside `api/enrich.js` (owned flow, missing/invalid auth -> refusedToPrice) is no longer reachable over HTTP because the GK-269 access gate refuses first, so no test exercises that internal defense-in-depth branch.


## Repeatability — sampling is unset and `temperature: 0` is not determinism (recorded 2026-10-09, Haiku 5.5 ruling)

- The grading lane (`callModel`, `api/grade.js`) does NOT explicitly set sampling temperature: no `temperature`, `top_p` or `top_k` is sent, so the provider default applies on whichever model the branch selected. The default is not recorded on any prediction.
- The only explicit `temperature: 0` in the repo is `src/lib/claudeCheck.js:193` (the record-check lane, not grading). It was a mitigation for Incredible Hulk #181 non-determinism. `temperature: 0` reduces but does NOT guarantee deterministic output, and it is not available on every model (Haiku 5.5 rejects any `temperature` other than 1 with a 400).
- Therefore SAME-IMAGE REPEATED INFERENCE MUST MEASURE ACTUAL VARIANCE (per branch, per model, same bytes, N repeats) before any stability claim. No parameter is to be changed on the grading lane to "fix" this; measurement comes first (campaign stage 5, not run).
- Any future model migration of a grading lane must satisfy this campaign's predeclared acceptance thresholds (declared BEFORE the candidate is run, on the certified corpus, covering band accuracy, severe outliers, same-image stability, resolution sensitivity and identity/era priming). A cheaper or faster model is not an acceptance criterion.

## Calibration cohort integrity (ruled 2026-10-09)

**A governing-model or prompt change creates a new calibration cohort. Historical predictions remain immutable.**

- A cohort is identified by (requested model id, provider-reported model id, prompt version, branch). Any change to any of these starts a new cohort; nothing is rewritten, relabeled or back-filled on existing `model_prediction_event` rows or grade receipts.
- The governing model and prompt are FROZEN for the duration of the current certified calibration campaign, unless an explicitly authorized safety correction requires otherwise (that correction is itself a cohort boundary and must be recorded as one).
- Predictions from different cohorts MUST NOT be pooled until the differences have been identified and evaluated. Unknown provenance (null model / null provider-reported model) is its own cohort, never merged into a known one.
- Consequence: the Haiku 5.5 evaluation is deferred (see `docs/HAIKU-5-5-DISPOSITION.md`).

## Model provenance — field semantics and what is still open (2026-10-09)

Two fields exist end to end: `model` (the REQUESTED id, `meta.requestedModel`) and `model_version` (the PROVIDER-REPORTED id, `message.model`; despite the name it is the reported model id; null unless the provider returned one). The grade receipt and every `model_prediction_event` row for a scan are built from ONE `provenance` object derived only from the producing call's `meta`. Fixed by the WATCH provenance repair: WATCH rows now carry the accepted pass's ids; the call-site-literal fallback in `attachGradeReceipt` is gone. Still open (not in this change): non-grade lanes (`enrich` AI-verify, `claudeCheck`, `chat`, `manage`) record no provider-reported model, and `researchMarket.js` collapses requested and reported into one field. Never infer a reported model from a call-site string.

## WATCH model-provenance repair — calibration provenance boundary (2026-10-09; TICKET: UNASSIGNED)

- **Pre-fix WATCH records may have UNKNOWN model provenance.** Before this change `api/grade.js` passed `model: null` and no call metadata for the WATCH branch, so WATCH `model_prediction_event` rows and grade receipts carry `model` / `model_version` = NULL even though a model call produced the grade. Those rows are not wrong; they are unattributed.
- **Post-fix WATCH records carry `model` (requested id) and `model_version` (provider-reported id) from the accepted pass's own call** (pass 1 Haiku, pass 2 Haiku, or pass 3 Opus), whenever the provider response reported one. If the provider omitted its model, `model_version` stays NULL — it is never filled from the request or from a call-site string.
- **Unknown-provenance records MUST NOT be pooled into model-attributed calibration cohorts.** NULL model / NULL model_version is its own cohort (see "Calibration cohort integrity").
- **Historical records remain immutable.** No backfill, migration, or reinterpretation of existing prediction events or receipts. The standard Haiku (`HAIKU_EBAY_CONSENSUS`) and Sonnet (`SONNET_*`) branches recorded the same values before and after this change (their `meta` was already supplied); only the removed call-site-literal fallback and the WATCH branch changed.
- **Boundary marker: RECORDED.** Activated by deployment of `653f41848b2cf9ed2bc1d29d781c6aa73d35cbda` (Production deployment `dpl_3wEzCXuTZgC13qK8DGz1HY5b3gou`, created 2026-10-10T00:05:46Z, READY and aliased 2026-10-10T00:06:21Z; verified Production alias `app.grailkey.com`, also `comic-vault-rouge.vercel.app`, serving the bundle that carries build marker `653f418`). This record was written in a subsequent documentation-only commit; that commit's SHA is NOT the activation SHA. See "MODEL PROVENANCE COHORT BOUNDARY" below.

## Cache effectiveness — read-only findings (2026-10-09; existing evidence only, no API call, no spend)

Evidence coverage: **no recorded cache-usage data exists in the repo.** `[cost-audit]`/`[cache-audit]` lines (usage incl. `cache_creation_input_tokens` / `cache_read_input_tokens`) go to Vercel runtime logs only (~24h retention) and are not persisted; no log export is on disk. Cache-read/creation distributions, zero/positive/missing row counts, and recorded prompt token counts are therefore all **unavailable** — status per lane is **insufficient usage evidence**, and nothing here claims caching did or did not occur.

What the code and docs establish (measured by capturing the mocked request bodies, no network):

| Lane | Model | `cache_control` on | Cached block size (chars; ≈ tokens at ~4 chars/token — an ESTIMATE, not a count) | Documented minimum | Eligibility |
|---|---|---|---|---|---|
| `HAIKU_EBAY_CONSENSUS` grade-only | Haiku 4.5 | 2nd system block (the grade-only prompt) | 5,864 (+250 uncached block) ≈ 1.5K | 4,096 | **likely-ineligible** (far below) |
| WATCH pass 1/2 | Haiku 4.5 | 2nd system block | 6,484 (+250) ≈ 1.7K | 4,096 | **likely-ineligible** |
| `SONNET_VISION_FALLBACK` / book | Sonnet 4.5 | 2nd system block (STANDARD_PROMPT) | 15,518 (+250) ≈ 3.9K | 1,024 | likely-eligible |
| WATCH pass 3 | Opus 4.7 | 2nd system block | ≈ 3.9K (STANDARD_PROMPT) | 2,048 | likely-eligible |

- Documented minimums re-confirmed against Anthropic's prompt-caching page on 2026-10-09 (Haiku 4.5 = 4,096; Sonnet 4.5 = 1,024; Opus 4.7 = 2,048; Haiku 5.5 = 512). Below the minimum, caching is silently skipped with no error and both cache usage fields read 0.
- `cache_control` is applied to the relevant prompt block on every `callModel` lane; the 250-char `SYSTEM_PROMPT` block ahead of it is not itself a breakpoint.
- The grade-only prompt embeds per-scan consensus fields (title, issue, year, publisher, listing agreement, confidence %), so even a hypothetically eligible prefix would differ between different books; only an identical consensus could ever read it.
- Conclusion by evidence class: Haiku grade-only and WATCH-Haiku — **expected no cache activity (estimate-based, not observed)**; Sonnet/Opus lanes — **cache-eligible, activity unobserved**. No lane is classified **confirmed cache activity** or **observed no cache activity**: confirming either requires the real `usage` fields from the Production `[cost-audit]` lines.
- Implication for the measured ≈ $0.004 grade-call cost and 4,370 ms model time (the 2 baseline scans in "SPEED BASELINE"): if the Haiku grade-only lane is below its minimum, its cache fields are 0 and the whole prompt bills as ordinary input; the existing evidence cannot say how much that contributes to either figure, and no saving or latency attribution is claimed. Nothing about caching, prompts, models or routing was changed.

## WATCH PROVENANCE INVARIANT (certified 2026-10-09; TICKET: UNASSIGNED)

**Current escalation returns the last attempted pass as the accepted result.** (Pass 1 accepted after 1 call, pass 2 after 2, pass 3 after 3; `acceptedPassIndex === attemptedPassCount` at every return.)

**Any change to escalation or pass selection requires renewed provenance-attribution certification.**

The invariant is asserted, not assumed: `watchPipeline` returns `acceptedPassIndex`, `attemptedPassCount` and `attemptMetas` (each attempted pass's own call metadata, in order); the handler attaches provenance only through `selectAcceptedPassMeta` (`src/lib/watchProvenance.js`), which requires the metadata to be the very object recorded for the accepted pass index. An inconsistent association is recorded as UNKNOWN (`[watch-provenance]` log line) and the scan is otherwise unchanged. If a future strategy accepts an earlier pass after further attempts, attribution follows the accepted pass index, never the last attempt. Proofs: `tests/watch-accepted-pass-authority.test.js` (association contract + real handler), `tests/model-provenance-cost-observability.test.js`, and the persisted-row proof `tests/watch-provenance-persisted-live.test.js` (real Development database; `model` = requested id, `model_version` = provider-reported id). No schema or persisted-shape change.

**Cohort boundary — recorded at release.** See "MODEL PROVENANCE COHORT BOUNDARY" and "COUNTER KEY-SPACE BOUNDARY" below for the actual activating deployment.

## HAIKU 4.5 GRADE CACHE — STRUCTURALLY INELIGIBLE UNDER THE INSPECTED REQUEST CONSTRUCTION

(Supersedes the looser wording in "Cache effectiveness" above. Classification of the code/request construction, NOT a historical production-wide measurement.)

- Estimated, not measured: the cache-controlled Haiku grading prefix is ~1,500 tokens (≈5.9K chars at ~4 chars/token; no provider token count exists on disk).
- Documented Haiku 4.5 minimum cacheable prefix: 4,096 tokens (re-confirmed 2026-10-09). Below the minimum caching is silently skipped; both cache usage fields read 0.
- The cache-controlled prompt also embeds per-book consensus data (title, issue, year, publisher, listing agreement, confidence), which limits prefix reuse between different scans even if the length were eligible.
- Evidence class: structural (request construction + documented threshold). NOT a measurement of production cache reads/writes — no persisted usage data exists, so no cache-hit rate is claimed.
- The measured ≈ $0.004 per grade call (SPEED BASELINE, n=2) is the existing observed cost baseline. No uncached-cost or latency penalty is claimed or quantified; that needs real `usage` evidence.
- Future reconsideration condition: Haiku 5.5's 512-token threshold may make a stable static prompt prefix eligible after prompt restructuring (static instructions first, per-book data after the cache breakpoint). Relevant only after certified calibration and explicit model-evaluation authorization. No prompt, caching, or model change now.

## MODEL PROVENANCE COHORT BOUNDARY

Activated by deployment of `653f41848b2cf9ed2bc1d29d781c6aa73d35cbda` (Production deployment `dpl_3wEzCXuTZgC13qK8DGz1HY5b3gou`, created 2026-10-10T00:05:46Z, READY and aliased 2026-10-10T00:06:21Z; verified Production alias `app.grailkey.com`, also `comic-vault-rouge.vercel.app`, serving the bundle that carries build marker `653f418`). This record was written in a subsequent documentation-only commit; that commit's SHA is NOT the activation SHA.

- Before the activating deployment, WATCH model attribution may be UNKNOWN (`model` / `model_version` NULL).
- From the activating deployment onward, WATCH provenance uses the accepted pass's requested (`model`) and provider-reported (`model_version`) model identifiers, subject to actual provider metadata availability (`model_version` stays NULL if the provider omitted it).
- Historical records are immutable.
- Do not pool unknown-provenance historical records into model-attributed calibration cohorts.
- Evidence: the deployment was READY and aliased, with no runtime error group attributable to it at verification time. No new WATCH traffic had been observed yet, so post-activation behavior rests on the pre-release proofs (mocked-provider handler tests and the Development persisted-row proof), not on a Production observation.

## COUNTER KEY-SPACE BOUNDARY

Activated by deployment of `653f41848b2cf9ed2bc1d29d781c6aa73d35cbda` (Production deployment `dpl_3wEzCXuTZgC13qK8DGz1HY5b3gou`, created 2026-10-10T00:05:46Z, READY and aliased 2026-10-10T00:06:21Z; verified Production alias `app.grailkey.com`, also `comic-vault-rouge.vercel.app`, serving the bundle that carries build marker `653f418`). This record was written in a subsequent documentation-only commit; that commit's SHA is NOT the activation SHA.

- From the activating deployment onward, unknown-model cost events are counted under `kind=cost`, `outcome=unknown_model` with the neutral `unknown` prediction-kind suffix (`predictionKind: null`): `gk:gradeprov:v1:<day>:cost:unknown_model:<branch>:<model>:<buildSha>:unknown`.
- Accuracy note (deviation from the release directive's premise): no earlier Production deployment emitted any `kind=cost` counter, so no Production cost series with a default `FIRST_GRADE` suffix exists; that variant existed only in intermediate, never-deployed local builds. If a `kind=cost` key ending in `:FIRST_GRADE` is ever found in any store, it is non-Production residue and must not be aggregated with the `unknown`-suffixed series without explicit normalization.
- Historical counter keys are not rewritten.
- Cost events must never be mixed into FIRST_GRADE or RE_GRADE prediction denominators; cost counters and grade-prediction counters stay distinct (proof: `tests/cost-counter-denominator-isolation.test.js`).
- Retained limitation: the enrichment verification-lane runtime behavior remains MIRRORED-WIRING-UNVERIFIED.

## Production stored-image census (read-only, 2026-10-10) — HISTORICAL SNAPSHOT taken BEFORE the GK-280A live scan (198 items; production now holds 199) — NOT a complete historical image or grading-event census

Method: one read-only transaction against the verified Production database (`BEGIN READ ONLY`, SELECT-only, counts only, no identifiers/titles/grades). It counts `attributes.remoteImages` — the images the server holds for each collection item (SYNCED images only; a photo that exists only on a device is not counted).

| Population | Exactly one stored image | Two or more | Zero / missing / unclassifiable |
|---|---|---|---|
| All collection items (198) | 196 | 0 | 2 |
| SERVER_BASELINE_VALID items (53) | 53 | 0 | 0 |

Also: SAME_COPY physical-copy decisions = 0.

Interpretation rules. One stored image is evidence consistent with a SINGLE CAPTURE; it is NOT proof of a single prediction event and NOT proof that a baseline is the current governing prediction (52 of the 53 baselines remain currentness-INDETERMINATE: later GRADE predictions exist for the principal and cannot be tied to the item). Image count alone is never used to classify a baseline as current and changes no governing-grade policy.

Implications. (1) Front-only grading calibration: effectively the whole existing Production population was graded from a single image, so the existing stored evidence is front-only; it contains no back / spine / pages views against which a multi-view grade could be calibrated (consistent with the PROVISIONAL front-only annotation law above). (2) The proposed 800px-versus-1600px experiment: the stored image is a client thumbnail produced by `makeThumbnail` (default longest edge 1000px; code-derived, the stored dimensions were NOT measured), while the graded input is resized to 800px (`resizeImageForVision`). The existing stored images therefore cannot supply a 1600px arm, and they are not the bytes that were graded; the experiment needs NEW captures at known source resolution (and same-capture 800px/1600px renderings), not a replay of the stored population. (3) This census does not establish how many grading events each item has had; that requires item-linked prediction evidence, which GK-280A begins to record (`currentGradePrediction`).
