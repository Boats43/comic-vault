# Comic Vault PWA

## Project
Comic Vault — a progressive web app for grading, pricing, and managing comic book collections. GrailKey is the durable-asset-infrastructure program layered underneath it (DATA-0/DATA-1) — see "GrailKey Architecture Constitution" below.

## Stack
- **Frontend**: React + Vite (single-page app in `src/App.jsx`)
- **Backend**: Vercel serverless functions (`api/` directory)
- **Storage**: IndexedDB (client-side) for the catalogue. Server-side: Upstash Redis via Vercel KV (`api/kv-cache.js`, live since 2026-06-29) caches ComicVine/PriceCharting/active-comps/PriceCharting-HTML/eBay-OAuth-token lookups — this is real server-side persistence (KV cache, not a relational/persistent-catalogue store). Requires `KV_REST_API_URL`/`KV_REST_API_TOKEN`. Separately, GrailKey's DATA-1 asset graph lives in real Neon Postgres (`GRAILKEY_CATALOG_DATABASE_URL`, schema `data1_dev`) and real Vercel Blob (`BLOB_READ_WRITE_TOKEN`) — see Current State.
- **Deploy**: Vercel (auto-deploys from `main` branch)

## Build & Deploy
```bash
npm run build           # always run before commit; zero errors required
                        # ESM-mode parse enforced (--input-type=module)
                        # catches reserved words (protected, interface, etc.)
git push origin main    # production deploy (auto, primary protocol)
git revert <hash> && git push   # single-step rollback
npx vercel --prod       # uncommitted-tree fallback only
```

**STANDING RULE — ESM Parse Enforcement (P0, evidence: 2026-07-05 outage):**
Build verification (`npm run build`) MUST use ESM-mode syntax check for all `api/*.js` and `src/lib/*.js` files:
```bash
node --input-type=module --check < FILE
```
Plain `node --check FILE` parses as CommonJS (sloppy mode) and MISSES ESM-only reserved word errors (`const protected`, `let interface`, etc.). Vercel runtime uses ESM → strict mode → reserved words throw SyntaxError at module load → all API endpoints dead. The 2026-07-05 outage (commit dc08a6d used `const protected`) proved `node --check` is insufficient.

## Key Files

### AssetCore (Universal Pricing & Decision Engine)
- `src/lib/pricingEngine.js` — 9 universal pricing helpers (floor guards, sanity checks, multipliers)
- `src/lib/identityCore.js` — 5 universal identity resolvers (overlap, resolveIdentity, resolveIssue, backfillFromComps, resolveYear)
- `src/lib/decisionEngine.js` — universal decision engine (LIST_NOW/RESEARCH/GRADE_CANDIDATE/etc.)
- `docs/ASSETCORE_INTERFACE.md` — contract between AssetCore and format adapters (18 TODOs resolved)
- `docs/ASSETCORE_BASELINE.md` — pre-extraction snapshot (Session 3A)
- `docs/ASSETCORE_STOP_CONDITIONS.md` — 9 stop conditions for extraction safety
- `docs/ASSETCORE_EXTRACTION_SEQUENCE.md` — 7-step extraction plan

### Comic Adapter (Format-Specific Logic)
- `src/adapters/ComicAdapter.js` — 312 lines, 4/4 functions (verifyStory, detectKeyValue, computeEraRisk, sanitizeComicTitle)

### API Endpoints
- `api/enrich.js` — second-pass enrichment (PriceCharting, eBay comps, ComicVine, Ximilar, CGC lookup, GoCollect, Decision Engine)
- `api/grade.js` — Claude Vision comic identification and grading
- `api/chat.js` — Claude collection chat (inline queries, Whatnot session context)
- `api/comps.js` — eBay Browse API comp fetching
- `api/sold.js` — eBay completed/sold listings (legacy, dormant — routes via PC scrape)
- `api/cgc-lookup.js` — CGC cert number verification (dormant, see Open Blockers)
- `api/gocollect.js` — GoCollect CGC FMV lookup (dormant, see Environment Variables)
- `api/manage.js` — collection analysis via Claude
- `api/list-ebay.js` / `api/delist-ebay.js` — eBay listing creation/removal
- `api/mega-keys.js` — mega-key floor map (43 entries: 41 MEGA / 2 MANUAL, publisher+year strict, schema 2.0.0)
- `api/pricecharting-pop.js` — PC pop + sales-history + price ladder + velocity scrape
- `api/auth-login.js` / `api/assets.js` / `api/asset-media.js` — DATA-1D authenticated principal/asset/media read surface (see Current State)

### Shared Libraries
- `src/lib/compHygiene.js` — shared regex + helpers (REPRINT_RE, SLAB_RE, VARIANT_CONTAM_RE, SIGNED_RE, ARTIST_PATTERNS, etc.)
- `src/lib/soldVerification.js` — `verifySoldComps(rawRows, ctx)` filter chain
- `src/lib/listPriceWarning.js` — UI helper (over-reach detection)
- `src/lib/premiumCreators.js` — 80-creator tiered registry
- `src/lib/pedigreeRegistry.js` — 22-pedigree canonical lookup

### GrailKey DATA-1 Modules (module-boundary enforced — see each module's own index.js)
- `src/modules/assets/` — the Asset Service (mint, identity, media, ownership, valuation, decision, idempotency)
- `src/modules/auth/` — principal authentication (HMAC session tokens, scrypt credentials)
- `src/modules/media/` — content-addressed storage (localfs + Vercel Blob drivers)
- `src/modules/capture/` — scan→asset orchestration over the Asset Service's public contract

### Frontend
- `src/App.jsx` — entire frontend (ResultCard, CollectionDetail, grading flow, catalogue, FloatingSearchBar, BidCalculator)

## Repo & Live
- **Repo**: Boats43/comic-vault
- **Live**: comic-vault-rouge.vercel.app

## Environment Variables
Nine keys required (all set in Vercel), plus:
`ANTHROPIC_API_KEY`, `EBAY_APP_ID`, `EBAY_CERT_ID`, `EBAY_DEV_ID`, `EBAY_AUTH_TOKEN`, `EBAY_SANDBOX`, `COMICVINE_API_KEY`, `XIMILAR_API_TOKEN`, `PRICECHARTING_TOKEN`
- `SOLD_INSIGHTS_DISABLED=1` (production) — skips the dead eBay Marketplace Insights OAuth attempt in api/sold.js entirely.
- `GOCOLLECT_API` — **integration NOT live.** Removed from enrich Promise.all by Q25 (100% timeout); enrich passes `Promise.resolve(null)`. api/gocollect.js remains on disk but is never called.
- `KV_REST_API_URL` / `KV_REST_API_TOKEN` — Upstash Redis credentials for `api/kv-cache.js`.
- `GRAILKEY_SESSION_SECRET` / `GRAILKEY_CATALOG_DATABASE_URL` / `GRAILKEY_SESSION_EPOCH` — DATA-1D auth (32+ char secret required, fails closed below that; per-environment distinct secrets — Preview and Production never share one). Confirmed active in Production, Preview, and Development.
- `BLOB_READ_WRITE_TOKEN` / `MEDIA_STORAGE_DRIVER=vercel-blob` — real Vercel Blob store (`comic-vault-media-primary`), private access, connected to all three environments.

## Rules

### CLAUDE.md size limit (P0 PROTOCOL — standing, ruled 2026-08-07, GrailKey Dispatch 16) — STANDING CONSTRAINT, do not let finding writeups accumulate inline
**CLAUDE.md must stay comfortably under 150,000 chars or it stops loading — a doc that silently stops loading takes every constraint in it down with it, not just the newest one.** Evidence: 2026-08-07 the file reached 193,005 chars and was no longer being fully loaded. First compaction that day (193k→74,839 via moving the full finding history to `docs/PATTERN-LIBRARY.md`). Second compaction 2026-08-14 (148,847→98,875, `8d8af44`). Third compaction (CLAUDE-COMPACT-1) 2026-08-23 at ~147,265 chars — see the compaction commit for the pre-compaction SHA; full pre-compaction text is recoverable from git history, not duplicated as a backup file in this repo. Fourth compaction (CLAUDE-COMPACT-4) 2026-10-26 at 149,120 bytes / 147,713 chars (pre-compaction SHA `f6e5d28`): the removed text was RELOCATED VERBATIM (not summarized away) to `docs/archive/CLAUDE-MD-REMOVED-2026-10-26.md` and `docs/TEST-BASELINE-HISTORY.md`, and every standing rule in it was lifted into the "Standing implementation invariants" digest. NOTE: the limit is measured in characters but multi-byte characters make `wc -c` larger; keep BOTH numbers under 150,000.
**Rule:** a new finding gets one line in the Pattern Library index here, plus the `docs/PATTERN-LIBRARY.md`/`docs/TICKET-REGISTRY.md` pointer — the full writeup goes in that file, never inline in CLAUDE.md. Before committing any addition to this file, check `wc -c CLAUDE.md` stays well under 150,000.

### Documentation Currency (P0 PROTOCOL — standing, ruled 2026-10-13, B1 record protection)
**Release status records must be updated contemporaneously with release preparation and supported by evidence. Documentation updates do not bypass migration, push, deployment, or marketplace authorization gates.** Every status line says which kind of fact it is: VERIFIED LIVE (read from a live system this session) · HISTORICAL EVIDENCE (a dated record) · OPERATOR-REPORTED (stated by the operator, not independently re-checked) · UNVERIFIED. Evidence: on 2026-10-13 this file still named `origin/main = a8dcdca` while Production was `b403f33` after ~18 further deployments, and a stale local `main` almost passed for current state.

### Push & Deploy Are Held By Default (P0 PROTOCOL — standing, ruled 2026-10-05, Universal U1 Production Closeout)
**PUSH AND DEPLOY ARE HELD BY DEFAULT.** A dispatch authorizes a `git push` only with the explicit words **PUSH AUTHORIZED**, and a Production deploy only with **DEPLOY AUTHORIZED** (each scoped to what that dispatch names). **A list of stop conditions is NOT authorization** — stop conditions add refusals, they never grant authority; if no stop condition fires, the default HOLD still stands. Every push to `main` auto-deploys to Production on Vercel, so a push is a deploy: batch an authorized push into ONE push at the intended final SHA. Production migrations (e.g. 0039) need their own explicit authorization (`PRODUCTION MIGRATION <n> AUTHORIZED`). Evidence: the U1 runtime (`21e0473`..`d642796`) reached Production before the intended final release-candidate approval — backward-compatible, no historical rewrite, no rollback needed, recorded as a sequencing deviation (`docs/TICKET-REGISTRY.md`, "UNIVERSAL U1 PRODUCTION CLOSEOUT"). No cleanup campaign.

### Conditional Stop Is A Stop (P0 PROTOCOL — standing, ruled 2026-10-05, grade-authority release isolation)
**A CONDITIONAL STOP IS A STOP. THE CONDITION IS EVALUATED BY THE REVIEWER, NOT THE IMPLEMENTER.** If a dispatch says "IF X → STOP / HOLD / REPORT", do not evaluate X and keep implementing in the same pass: return the finding and wait for reviewer authorization. Outside-user hard gates (client sold-comp grade authority, seller location, DELISTED recovery) are in `docs/GRADING-CAMPAIGN.md`.

### Secret Hygiene (P0 PROTOCOL — standing, ruled 2026-08-23, DATA-1D correction pass, GK-164)
**Secrets never appear in reports, logs, commits, tests, or docs — state where they live, never what they are.** Evidence: `docs/adr/DATA-1D-AUTH-CROSS-DEVICE.md` printed Jimmy's real operator passphrase in cleartext, in a local commit never pushed to `origin`. Fix: credential rotated via a local, uncommitted script that generates the new value inside itself and never prints it; a session-epoch revocation mechanism (`GRAILKEY_SESSION_EPOCH`, `src/modules/auth/token.js`) now lets a disclosure be neutralized for ALL outstanding tokens, not just future logins; the disclosing commit itself was rewritten out of local history before push (ruled by Jimmy, GK-164) — `git reflog expire`/`gc` deliberately NOT run as part of that. When a credential must be referenced in any artifact, name its storage location only (`"rotated, stored at X, not displayed"`). Full detail: `docs/PATTERN-LIBRARY.md`, "GK-164."

**Extension (ruled 2026-09-10, GrailKey Resume-Mainline dispatch, sixth exposure this session / second from `vercel env pull`):** any command that emits configuration values — `vercel env pull` chief among them, but this covers the whole class — MUST redirect output to a file and be consumed in-process/blind, NEVER left to print to stdout/terminal scrollback. `vercel env pull` with no output path prints pulled values straight to the terminal; always give it an explicit file target (e.g. `vercel env pull .env.tmp`) and read that file programmatically, never `cat`/echo it. Same rule for any equivalent config-dump command (`neon connection-string`, `vercel env ls` is fine — it hides values — but any command whose whole purpose is to reveal a value is in scope).

### Subagent Scope-Violation Rule (P0 PROTOCOL — standing, ruled 2026-09-12, GK-204, Outcome #1 pre-publish hardening dispatch)
**A subagent/fork explicitly scoped read-only that performs code edits, migrations, database writes, or external API calls has violated its scope — full stop, regardless of whether the result turns out correct or harmless.** Evidence: a fork dispatched with an explicit "read-only research task, no edits" prompt (mid Outcome #1 work) instead applied a live DB migration to real Development Postgres, edited 6 source files, created 2 new files, and made a real (read-only) call to eBay's production Trading API — none of it requested of it, apparently acting on the parent conversation's inherited context (a large user directive requesting exactly that implementation) rather than the literal scope of the prompt it was given. The GetUser call it made was harmless and read-only, but it was still outside a read-only research scope — harmlessness is not the test.
**Required response when this is caught:** (1) disclose the violation to the user, explicitly, before reporting any of the subagent's claimed results; (2) independently re-verify every claimed state change — re-read every diff, re-run affected tests under your own execution, re-run the build, issue your own fresh read-only DB queries against the real state — never accept the violating subagent's self-report as evidence of what it actually did; (3) do not infer correctness from the report's confidence or detail — a thorough-sounding report is not verification. Only after independent re-verification passes may the work be treated as done. Full detail: `docs/TICKET-REGISTRY.md`, "GK-204."

### Quarantined Scratch — Standing Law (codified from dispatch history 2026-08-20→22)
Three pre-existing scratch files are under standing quarantine unless explicitly superseded by a future authorized ruling:
```
scripts/capture-active-cache-entry.mjs   (modified)
scripts/ingest-fixture-response.mjs      (untracked)
scripts/merge-fixture.mjs                (untracked)
```
They are NEVER staged, committed, stashed, reset, cleaned, or pushed while this quarantine stands. No bulk-stage commands (`git add -A`, `git add .`, blanket stash/reset/clean) are permitted in this repo while quarantined scratch exists — files are staged explicitly by path. Every push census must expose the quarantined scratch state and the exact expected commit stack before any push.

### DATA-0E-FULL Crawl Isolation — Standing Law (codified from dispatch history 2026-08-20→22)
DATA-0E-FULL acquisition runs as one detached process, independent of any Claude/session/harness lifecycle. **NEVER launch a second crawler** — any resume path MUST first prove no live acquisition process exists via PID/liveness check. Resume is checkpoint-based only; the checkpoint is authoritative. Rate limiting: the server-reported remaining quota is authoritative over any local counter; the observed quota window is rolling 24h, NOT a calendar-day reset. `ABORT-BULK-GRANTED.txt` is the acquisition abort sentinel — a granted authorized Metron bulk export supersedes the crawl. Never run diagnostic queries against a staging database during DDL-heavy imports (metadata-lock collision physically demonstrated 2026-08-21). The staging MySQL container and crawl artifacts belong to the acquisition lane — other dispatches must not stop, restart, query, mutate, or otherwise interfere with them.

**Runbook pointer:** root `C:\grailkey-data\data-0e-full\` · resume source of truth `acquisition-checkpoint.json` · logs `acquire.stdout.log`/`acquire.stderr.log` · watchdog: Scheduled Task "GrailKey-0E-Full-Watchdog" (trigger AtLogOn, resume-only, PID-guarded — **known caveat: the registration script has a cosmetic reporting bug and may print success unconditionally; script output alone is not proof registration succeeded**) · quota docs `docs/DATA-1-ACQUISITION-QUOTA-WINDOW.md`.

### Directive preflight requirement (P0 PROTOCOL — standing, ruled 2026-08-11, GrailKey Directive 2026-08-11-B)
**Any directive referencing a ticket ID (`GK-N`) or a structural fact about this repo must run a preflight check against `docs/TICKET-REGISTRY.md` before doing work.** The registry exists specifically so that lookup is a `grep`, not a re-investigation. Preflight shape: report HEAD SHA, working-tree-clean status, each referenced `GK-N`'s current status/aliases from the registry, and each referenced structural fact's stamped value below — before proceeding, not after.

**Structural-fact stamps** — re-stamp any of these the moment code changes what they describe:
- **IndexedDB merge sites: 8** — see "App.jsx merge paths" below.
- **Live external sources (3):** ComicVine (API), eBay Browse API (image + text search), PriceCharting (HTML scrape). **Dormant (2):** CGC cert lookup (WAF 403s), GoCollect (hardcoded null).
- **ComicVine identity-gate status:** CLOSED (GK-71) — all three gates in `api/enrich.js` empty the candidate set rather than silently restoring the rejected pre-filter set on a would-remove-everyone filter. One instance NOT fixed (pricing-math boundary, needs greenlight): `api/comps.js:1803`, logged `GK-70`.
- **Vercel function cap:** RESOLVED — Pro/Enterprise confirmed, no cap. 14+ files in `api/`, do not re-add a "12/12 Hobby" framing without re-verifying the plan tier.

**TEST BASELINE & ROSTER (compacted 2026-10-26, compaction #4).** The current file count and its stamp live in `docs/TEST-ROSTER.md`; re-stamp THERE in the same commit as any `tests/*.test.js` add/remove (this file is near its size limit — a rule that cannot be followed stops being followed). Pass/fail comes only from a recorded sweep (`docs/certification/runs/`). Every historical baseline and per-train "Roster delta" paragraph (2026-08-26 → 2026-10-26) is preserved verbatim in `docs/TEST-BASELINE-HISTORY.md`. Last full-suite baseline: 2026-08-26, 229 PASS / 19 FAIL / 2 TIMEOUT / 250. The 2026-10-09 measured baseline (285 pass / 44 fail / 2 timeout of 331 database-free files; 95 database/env files NOT run) is dated and command-specific — NOT a universal count. `tests/grailkey-commit-e.test.js` and `tests/grailkey-commit-g.test.js` assert via `git diff --name-only HEAD` that only `src/App.jsx` changed, so they fail on ANY unrelated dirty-tree change (convention tripwires, not behavioral tests).

### Standing implementation invariants (digest, compaction #4 — each is ACTIVE; the narrative that established it is archived in `docs/archive/CLAUDE-MD-REMOVED-2026-10-26.md` and `docs/TEST-BASELINE-HISTORY.md`, full tickets in `docs/TICKET-REGISTRY.md`)
- **Publication authority (C1):** every single-item publish requires a server-issued authority receipt that verifies for the principal, names this asset and catalogue row, matches the row's identity and carries the current media-evidence version. Q41 is only an exact-price acknowledgement, never evidence (`403 ACTION_AUTHORITY_NOT_READY`, `AUTHORITY_RECEIPT_*`).
- **Linkage and attachment (GK-203/205/207):** publish requires authentication and complete `gkAssetId`/`decisionEventId`/`operatorActionEventId`, validated BEFORE any eBay call. A `LISTED` outcome attaches only to the specific `LIST` operator action, never `HOLD`/`PASS`. Bundle listing is disabled fail-closed in Production.
- **Price binding:** the Q41-acknowledged price must exactly equal the outbound price AND the approved `LIST` action price (`MANUAL_PRICE_ACK_MISMATCH`, `LIST_ACTION_PRICE_*`) before any eBay call. Three prices never conflate: predicted `valuation_event.value_amount` / actual `outcome_event.ask_amount` / realized `gross_amount` (NULL until a real SOLD).
- **Listing content:** shipping service, condition policy and aspect enums come from authoritative eBay metadata (Ground Advantage = `USPSParcel`, never Media Mail; no `ConditionID` unless ruled; Era from eBay's enum; Best Offer default OFF). Title, description and specifics are built ONLY from governed durable catalogue facts resolved server-side (fail-closed `LISTING_FACTS_UNAVAILABLE`): deterministic title, no AI title, no market/demand/key claims, an ungoverned grade is never published, and raw reason/`claudeCheck` flags/pricing-source labels never reach marketplace text (`src/lib/buyerSafeListingCopy.js`).
- **Listing photos:** single-list images go through the eBay Media API only (needs `sell.inventory`; the bundle's legacy `UploadSiteHostedPictures` is Production-disabled). The outgoing photo is the asset's own certified FRONT evidence, sha256-verified against its media row, fail-closed; zero usable photo ⇒ `PUBLISH_BLOCKED_NO_PHOTO` before the provider write.
- **Inventory Authority (GK-224/225):** UNMANAGED → AVAILABLE → RESERVED → SOLD (SOLD terminal). Enrollment is an explicit operator action, never inferred. The LIST preflight requires AVAILABLE, no active listing on the channel (`DUPLICATE_ACTIVE_LISTING`) and no authoritative SOLD outcome (checked FIRST, channel-agnostic). Reservation is manual/API-driven (no safe automatic eBay signal exists).
- **SOLD evidence and economics:** SOLD only from a real Fulfillment order with a confirmed non-cancelled payment state; a listing ending or disappearing is never sufficient; DELISTED/EXPIRED_UNSOLD rows are never re-evaluated for SOLD. A missing economic component stays UNKNOWN, never $0. PredictionError resolves `outcome.decision_event_id → decision_event.valuation_event_id`; any break REFUSES (no fallback, no $0).
- **Publication concurrency and provider idempotency (P0 2026-10-26):** one in-flight publication per (asset, channel) via a Postgres transaction-level advisory lock (namespace 40295, try-lock that never waits; 150s timer; 180s server-side backstop), taken after the receipt gate, with the duplicate/sold/inventory preflight re-run under it and release in `finally`. READY `Item.UUID` = `sha256(asset|channel|generation)` (generation = terminal listings in `outcome_event`; no migration). Error 488 is verified (seller + SKU + Active) or preserved AMBIGUOUS. The mutex is NOT a durable record of an ambiguous provider outcome.
- **Listing state:** `outcome_event` is the authoritative source of a listing association; the client mirrors it (`GET /api/assets?listings=1`, principal-scoped). Provider `active` ⇒ app status `listed`; `ended` is never `sold`; an unknown or failed provider response changes nothing and never re-enables publication.
- **Category and identity authority:** an explicit category (`comic|book|generic`) at every writer — no silent comic default (`CATEGORY_REQUIRED_CLIENT_OUTDATED` for a stale client). Only `assetType==='comic'` reaches comic pricing/decision (GK-250). The durable category is pinned symmetrically on owned refresh/re-identify (`ownedRefresh`/`ownedReidentify`); missing or expired auth on an owned flow fails closed; category conflicts are refused both ways. An OPERATOR_CONFIRMED title/variant cannot be overwritten by a PriceCharting anchor or Vision. Execution-deciding fields are server-issued (authority receipt); client copies are inert. Market standing needs verified sold evidence (GK-238).
- **Principal isolation:** client storage is principal-scoped; ambiguous legacy local data is UNCLAIMED, NOT operator-claimable. Every authenticated call fails closed on 401 (clear session → login gate; never send an expired token; never clear on 403/409/503/5xx/network; never replay). Collection images are served only through the cookie-credential v2 route keyed by `principal_id` AND `id` (the old id-only route is retired, 410).
- **Spend guard:** durable UTC-day counters via a fail-closed store; refusal precedes any paid call; operator ids come ONLY from env `SPEND_GUARD_OPERATOR_PRINCIPAL_IDS`; no test exception or environment bypass; the in-memory store is refused on every hosted runtime marker; non-operator sub-ceiling applies. One logical scan attempt ⇒ at most one paid grading workflow (GK-281).
- **Physical copies (GK-279):** one server-adjudicated SAME COPY / ANOTHER COPY decision at save; fail-closed `PHYSICAL_COPY_CANDIDATE_CHECK_UNAVAILABLE`; `priorCollectionItemId` only server-proven; bulk/JSON/409 conflicts become durable HELD records, never silent skips.
- **Media and capture:** kernel media is appended only via `/api/asset-media-append` from operator-supplied fresh bytes with a 5-role `capture_view` (no URL-fetch path); certification completeness derives only from durable media rows. Capture-as-physical-asset is an explicit operator tap, never inferred from image source or scan success.
- **Research and learning:** Research the Market (GK-273) is bounded and operator-triggered; `WEB_RESEARCH` is provenance, not an evidence class; its rows start CANDIDATE with no promotion path and never touch price/contract/listing locks. Vision-only country claims cannot reach the Canadian multiplier (GK-271). The Learning Spine schema is UNAUTHORIZED (`docs/LEARNING-SPINE-LAWS.md`).
- **Environment hygiene:** database admin/scratch tooling goes through `assertAdminDbTarget`/`assertScratchSchemaTarget` (fail-closed database identity, GK-221/223); never `SET search_path` on a pooled connection (every query is schema-qualified, GK-178); mind the `GRAILKEY_CATALOG_DATABASE_URL_UNPOOLED` hazard.
- **Production migrations and recovery:** every Production migration needs its own explicit `PRODUCTION MIGRATION <n> AUTHORIZED`, a fresh backup, a CONFIRMED Neon restore window (the 6-hour Free-tier window is last-known 2026-09-01, UNCONFIRMED) and a recorded UTC restore-point timestamp with full before/after verification (GK-216 practice). A Production migration is never applied implicitly by a deploy.
- **Irreversible transitions:** report and HOLD; never perform one in the same pass even if conditionally permitted.

### Customer-Grade Standard (P0 PROTOCOL — standing)
**PRODUCTION RULE:** No card ships a price that contradicts its own evidence panel. Self-flagged mismatches (>100% drift over own pool avg, tier-4 NO DATA, refuse states) must be coherent:
- **Self-flagged drift:** Auto-RESEARCH decision (never LIST_NOW/LIST_LOW when engine flags >100% over comps)
- **Refused states:** Render $0 everywhere OR render nothing (blank/null). Zero bands + single "REFUSED" banner (Q68).
- **NO DATA tier-4:** "Estimated comps" label under Verified badge (P3).
- **Evidence consistency:** Match confidence, decision action, and displayed price must align. A LOW-confidence $300 book with 2 comps averaging $18 fails customer-grade.

**Enforcement:** Pre-ship validation checks decision.action vs match confidence tier vs price deviation. Cards violating coherence are blocked from LIST actions until fixed.

### I13 — Log-Card Fidelity (P0 PROTOCOL — standing, ruled 2026-07-19)
**If the logs have it, the card has it — exact, sourced, annotated.** No gate, filter, fallback, or default may hide or replace pipeline data on the card. New features comply with I13 by construction or fail CI.

- **Data exists in logs → renders on card.** 29 rejected comps found → card shows all 29, greyed, with reasons. A valid comp in the pool → visible, never vaporized. A sold record → shown with its date and title.
- **Data absent in logs → card shows "—".** No sold data → no "Last sold $4," ever (the Harley Quinn #62 violation this rule exists to make impossible).
- **Gates flag, never filter from view.** A gate's opinion is an annotation attached alongside the data — the data itself is untouchable. Suppression is prohibited. Fabrication is prohibited. The only permitted transformations between log and card are formatting and annotation — never replacement, never omission, never synthesis.
- **Every card value must be traceable to a log line.** If Claude Code can't cite the logRef for a rendered number, that number doesn't render.
- **Enforcement:** `validateContract` (`src/lib/responseContract.js`) implements I13 alongside invariants I1–I12: every populated `contract.fields` entry must carry a non-null `source` + `logRef`. The client-side half (`assertContractField` dev-mode warning in `App.jsx`) is real but necessarily partial.

### Log Statement Discipline (P0 PROTOCOL — standing)
**Log statements are code.** Every `console.log()` referencing a variable must reference a DECLARED identifier. Trace/log additions get the same review as logic changes.

**Evidence:** f707f5b outage (2026-07-05) — `const protected` (reserved word) → SyntaxError at module load → all API endpoints dead. Q62 regression (3c0e6f9) — `console.log` referencing an undefined `raw` → ReferenceError → tokenization crash → 100% comp pool loss.

**Rule:** Before committing any log statement: (1) verify every referenced variable is declared in scope, (2) test log statements trigger, (3) ESM-parse verification catches reserved words, NOT undefined references. Capture values BEFORE operations that might transform them (`const beforeStrip = normalized` before `normalized = stripMetadataTokens(normalized)`), never log a variable a preceding line already reassigned away.

### Handler-Wiring Verification (P0 PROTOCOL — standing, ruled 2026-08-19, GrailKey Directive AU, GK-138)
**Unit fixtures exercise library functions; they cannot catch a wiring bug in `api/enrich.js`'s own handler.** `node --check` catches syntax errors and reserved words, not runtime `ReferenceError`s from a variable that's out of lexical scope at its use site.

**Evidence:** GrailKey Directive AU's own build referenced `variantSourceItems` ~150 lines past where its declaring block had closed. 24/24 passing unit tests called the library functions directly and caught nothing. `node --check` and `npm run build` both passed. The bug reached production and threw a real HTTP 500 on two live scans before it was caught.

**Rule:** Any dispatch that edits `api/enrich.js` wiring (adds/moves a call site, threads a new parameter through the handler, hoists or relocates a declaration) ships with at least one real-handler smoke invocation — `import handler` called directly with a mock `req`/`res` and stubbed `fetch` proving the specific new code path executes without throwing and produces the expected log/response shape. Absent that, the dispatch's acceptance report must be labeled **MIRRORED-WIRING-UNVERIFIED** rather than PASS. Reference shape: `tests/grailkey-directive-au-handler-smoke.test.js`.

### Architecture (top priority)
- **Vercel function cap: no limit.** This project is on Pro/Enterprise, not Hobby — confirmed 2026-08-07 (GrailKey Dispatch 23) against live deployment evidence. Every `.js` file in `api/` becomes its own serverless function regardless of whether it has a default-exported HTTP handler. Re-verify the plan tier before ever re-imposing a "12/12" framing.
  - Pure UI helpers belong in `src/lib/` (no HTTP handler). `App.jsx` imports relatively.
  - Pure server helpers used by `api/enrich.js` go INLINE in that file OR in `src/lib/` imported via `../src/lib/X.js` — Vercel bundles transitively.
  - Filename convention: kebab → camel for helpers.
- **Pricing-math greenlight protocol:** never modify pricing math (grade multipliers, sanity checks, floor guards, key/variant multipliers, comp-pool composition logic in `api/enrich.js` or `api/comps.js`) without explicit user instruction. Layer A trust hardening (display gates, ID checks, advisories) does NOT require greenlight; Layer B accuracy changes do. When uncertain, ask first.
- **Auto-deploy on push to main.** Production deploys trigger automatically. Verify locally before push: `npm run build` clean, tests passing.
- **Investigation-first protocol:** when a bug is reported or surfaced, investigate root cause before implementing. Don't bypass safety checks (`--no-verify`, etc.) as a shortcut.
- **Diff-before-commit on all changes.** Show the user the diff for review before committing high-impact admin changes.
- **Variable scope discipline:** variables used in shared code paths (catch blocks, final return statements, post-conditional code) must be declared BEFORE any try/catch or if/else branches that might skip their initialization.
- **Phone validation immediately after deploy.** Tests verify code correctness, not feature correctness. Production behavior must be observed on real scans before next ship.
- **Gate vocabulary (P0 PROTOCOL — standing):** ✅ = production scan PASSED the gate condition. Pre-scan gates are TARGETS, never marked ✅. Marking unscanned gates ✅ is a protocol violation.
- **Timestamp comparisons (P0 PROTOCOL — standing):** MUST include dates when comparing scan time vs deploy time (`YYYY-MM-DD HH:MM:SS`). Never compare raw times without date context.
- **Conservative direction preferred when uncertain.** Bias toward under-pricing rather than over-pricing on weak signals; under-confident rather than over-confident on identification.
- **Refactor identifier audit (P0 RULE — standing):** Any `App.jsx` refactor that deletes lines must grep remaining scope for references to deleted identifiers BEFORE commit.

### Pricing stack (do not reorder without greenlight)
- Stack: PriceCharting → grade multiplier → sanity check → defect penalty → floor guard → browse_api fallback.
- PriceCharting year threshold: 5 years max gap between comic year and product year.
- PriceCharting skipped when `issue=null`.
- Visual search only overrides with 3+ matches.
- Non-comic titles ("not a comic", "unknown") rejected at enrich entry.
- AI verify: accept variant/cover B listings if same character + issue number. Year tolerance ±1-2y (cover-date vs publication-date drift).

### Era cutoffs
- `getEra(year)`: `parseInt(year) >= 1985 ? 'modern' : 'vintage'`. Null/undefined/0/empty-string → vintage (safe default).
- Sanity thresholds use a SECOND boundary: comic-community Silver Age start = 1956 (Showcase #4). Boundary asymmetry documented in `computeSanityFallback` docstring.
- Bundle ERA bands (display only): Golden <1956, Silver ≤1970, Bronze ≤1984, Copper ≤1991, Modern 1992+.

### Grade multipliers (era-aware)
- `CGC_MULTIPLIERS` and `RAW_MULTIPLIERS` split into `{ vintage, modern }`. Vintage tables preserved exactly (calibrated). Modern damped: CGC 9.4 2.2→1.35, 9.8 5.0→2.2, VF+ 8.5 1.3→1.05, 10 12.0→3.0.
- Modern RAW: graduated upper-curve damp (NM 1.00→0.90 through VG 0.45→0.40), flat tail below VG/G.
- **Multiplier table is calibrated. Never modify without explicit instruction.**
- `getGradeMultiplier(grade, year)` and `getRawGradeMultiplier(gradeStr, year)` — use `confirmedYear || year`.

### Sanity check (`computeSanityFallback`)
- **Sanity comparison base:** `sanityCompsAvg = compsAvg` — ALWAYS raw (eBay listings already reflect market grade; multiplying by gradeMultiplier double-counts).
- **High thresholds:** `lowCompsCount<3 || isMixedFallback` → 1.25x; Golden <1970 → 3x; Silver/Bronze <1985 → 1.75x; Modern ≥1985 → 1.5x.
- **Low threshold:** Silver+Bronze (1956–1984) → 0.6×; all other eras → 0.5×.
- **Gate:** `compsAvg > 1`.
- **Input preference:** `fallbackMedian || blendedAvg || compsFromEbay?.average`. On any fallback flag (reprint/variant/aiVerify), uses median instead of mean.
- **Skip when:** mega-key book OR `compsExhausted` (AI verify rejected 100%).

### Floor guard
- Field: `rawComps.lowest`. Raw `rawFloor` (no grade multiplier). Capped at `compsAvg`. Skip when: mega-key book OR `compsExhausted`.

### Browse_api path
- **No grade multiplier.** eBay listings already reflect market grade. Variant mult and key mult: PC source ONLY — gated by `isFromPC` flag, snapshotted after PC/sanity branch, before floor/variant/key blocks.

### Variant multipliers (descending, first substring match wins)
triple cover ×10, double cover ×8, 35¢/35 cent ×6, 30¢/30 cent ×4, inverted ×4, gold ×3, printing error ×3, miscut ×3, mark jewelers ×2.5, canadian price ×2, price variant ×2, type 1a/1b ×2, canadian ×1.8, whitman ×1.8, 2nd/second print ×1.5, pence ×1.5, dc universe logo ×1.5, newsstand ×1.3.
- Test-market variants gated by allowlist (35¢ window June-Oct 1977, 30¢ window Apr-Aug 1976).
- Composition damping (Bug 4): `variantRatio = variantHits / rawComps.prices.length`. Ladder: >0.80 → ×0.5, >0.50 → ×0.75, ≤0.50 → full.
- **NO_PREMIUM list:** corner box, masterpieces, design variant, headshot, trading card, cover a/b/c/d, marvel legacy, legacy.

### Key multipliers (PC source only, requires comps)
- Tiered: major (1st appearance, origin, death, first issue) ×1.5; minor (2nd app, first cover, cameo, iconic, classic) ×1.2; other ×1.0. Gated by `isFromPC && blendedAvg`.

### Comp filter chain order (`api/comps.js`, hard first / soft last)
title-similarity → reprint → VARIANT_CONTAM_RE (hard) → variant preference → cover-letter → lot → half-issue → TPB format → slab → signed → grade proximity → creator match (SOFT) → price sanity → dedup. Loop only breaks on post-filter survivors, not raw results — too-specific attempts fall through to broader queries.

### Filter regex catalogs
- **SLAB_RE** matches CGC/CBCS/PGX/etc. + grade number; bare seller self-grade does NOT trigger.
- **SIGNED_RE** matches signed/signature series/autographed/label text; bare `SS` and blue label deliberately omitted.
- **VARIANT_CONTAM_RE** (hard filter, module scope) catches variant/virgin/foil/ratio/incentive/newsstand/whitman/exclusive/sketch text.
- **REPRINT_RE** detects reprint/facsimile/later printing — pre-filter set kept when it would remove all, raises `reprintFallback`.
- **TPB_MARKER_RE** / **LOT_RE** / **EDITION_WARNING_PATTERNS** — format/bundle/edition-warning detection, do not modify pricing directly.

### Cover-letter matching (Filter 1d)
Cover A/B/C/D are separate books with separate prices. Empty/Cover A/1st print variant drops Cover B/C/D+ listings; a specific letter keeps ONLY that letter (fallback to all if zero match). `OTHER_VARIANT_DESCRIPTOR_RE` (Q108) is a **stopgap name/phrase list** (card stock, foil/sketch/virgin cover, trade dress, etc.) for named non-letter variants — extend as new patterns emerge; long-term fix is a variant-type classifier.

### TPB pipeline
TPB-marker titles get a `tpb-aware` query with no `#issue`; comp titles must contain a TPB marker when `isTPB` (graceful fallback if zero matches); Filter 0a relaxation accepts either `#issueNum` or a TPB marker.

### Multi-issue / sequel-volume / title-similarity
`hasMultipleDistinctIssues` rejects ≥2 distinct `#N` patterns. `detectSeriesMarkers` catches roman numerals/vol/part/book/annual/special/king-size/giant-size markers; asymmetry filter rejects a listing carrying a marker our title lacks. Title tokenizer: `MIN_TOKEN_LEN=2`, stop-words excluded from similarity (but stay in the eBay query), `hasSufficientTitleOverlap` requires ≥50% overlap.

### Search query construction
Attempt 0 is most specific (`title #issue full-variant year publisher`, capped 100 chars), falling through to shorter/no-year attempts. Atlas/pre-Marvel publishers append "Atlas Marvel". Dell + issue >100 tries Four Color aliases. `ARTIST_PATTERNS` matches unshift an artist-specific query (36+ entries, multi-word first).

### Browse API / Finding API / Sold comps
`limit=100`, `sort=bestMatch`, both buying options. Finding API skipped by default (`EBAY_USE_FINDING`, 500-errored 100% as of April 2026). Sold comps source from the PriceCharting sales-history scrape (24h cache); `verifySoldComps` runs a 10-stage filter chain; `blendedAvg = soldAvg×0.6 + activeAvg×0.4`, sold-only ×1.1 bump.

### Year override guard (`resolveYear`, `src/lib/identityCore.js`)
`confirmedYear` derivation, trust-but-verify. Verified line-by-line against the real implementation (Q112, 2026-07-18):
- (a) eBay-consensus year (≥10 pool items, ≥8 agreeing) → wins outright, no gap check.
- (b) PC and CV agree within ±2y → average.
- (c) PC present AND (no user year OR PC within ±2y of user) → PC wins.
- (d) CV present AND (no user year OR CV within ±2y of user) → CV wins.
- (e) user year present but PC/CV both disagree by >2y (or absent) → keep user year, `yearOverrideRejected=true`.
- (f) no user year AND no PC/CV match → fall through: PC, then CV, then Vision's raw value, `-fallback` suffix.

**Known gap (c)/(d):** with no Vision/user year at all, branches (c)/(d) accept PC/CV's year unconditionally, zero plausibility check — (e)'s safeguard is unreachable. No issue-number-vs-year plausibility check exists anywhere in the codebase.

**`cvYear`** comes from `deriveCvYear(comicVine)`'s matched-issue `coverDate` — **never** `comicVine.startYear` (the volume's launch year; fixed Q112, Batman #608 class). Fix 6 (`rescueYearFromVisionFallback`, GrailKey Dispatch 19, SHIPPED) restores an adopted family-scoped year when `resolveYear` would otherwise fall through to Vision's bare `"Unknown"` placeholder. Full investigative narrative (Q112 era-gate dead-code note, Fix 6 derivation): `docs/PATTERN-LIBRARY.md`, "Year override guard — full narrative."

### Issue-consensus guard (`resolveFamilyIssueConsensus`, `src/lib/identityCore.js`) — STANDING CONSTRAINT, do not rank-weight
**Rule: issue-axis consensus is a pure aggregate vote (unique-row count vs. a fixed 60% agreement bar + a clear-lead margin over the runner-up). It is NEVER weighted by eBay search-result rank/position.** A rank-weighted version was attempted and reverted twice before landing on the aggregate-vote design now shipped (`18ed481`). Record here so it is not silently re-attempted.

**Load-bearing precedent: Flash #139 mixed-family conflict.** A numerically-dominant #170 anniversary-issue cluster (3/5 rows) outnumbers the genuinely-correct #139 rows (2/5, matching Vision's own read). `resolveFamilyIssueConsensus` must NOT adopt the numeric plurality — `mode: 'conflict-locked'`, issue stays `'139'`, `winner: '170'` recorded only for diagnostics. Any issue-consensus fix that would resolve this case by ranking/weighting risks reintroducing the exact regression this precedent guards against.

Five modes, all pure count-based: missing+≥3-unique+≥60%+clear-lead → `adopted`; present+aggregate-agrees → `corroborated`; present+aggregate-disagrees → `conflict-locked`; present+zero-consensus → `no-consensus`; single representative row (even 100% self-agreement) → `no-consensus` (<3-unique-row floor).

**Open, not yet scoped:** `zeroSupportNoAdoption`'s safety-net check is an equality test (`visionIssueCount===0`), not a ratio — a single coincidental pool mention (as low as 1/19) fully disables it, and the gate sits behind a separate `titleOk≥30%` precondition that can independently silence it. A support-ratio floor (~10%) is the proposed, unscoped fix. Full investigative narrative (Jetsons #19 Q51/Q54 trace, the three-scan comparison table): `docs/PATTERN-LIBRARY.md`, "Issue-consensus guard — full narrative."

### `applyDualAxisGate` reason-string coupling (`src/lib/imageSearchIdentity.js`) — STANDING CONSTRAINT, do not reword the reason string
**`applyDualAxisGate`'s `reason` string is parsed by at least one downstream consumer as load-bearing behavior, not read as a log message.** `isBareCreatorTokensOnly` (Commit B1) regex-matches `reason` (`/^creator-tokens \[/`, excluding `/adjacent-pair recovered/`) to distinguish which additions get a family-member issue-corroboration check. **Changing the reason wording for either branch is a behavior change, not cosmetic** — any edit to `applyDualAxisGate`'s `reason` strings must grep `isBareCreatorTokensOnly`'s two patterns first and confirm they still match. Second confirmed instance of this exact shape in the file (the first: 22c's `[22c-title-revote]` guard, resolved by Q48). Full narrative: `docs/PATTERN-LIBRARY.md`.

### Mega-keys (`api/mega-keys.js`, 43 entries)
- 10 Golden / 15 Silver / 2 Bronze / 2 Modern. Two types: MEGA (`grades` bucket map) and MANUAL (Action #1, Superman #1; manual review only).
- Strict canonical match: `getMegaKeyEntry(title, issue, publisher, year)`. Pre-1962 `yearTolerance:2`; post-1962 `yearTolerance:1`. `normalizePublisher` collapses Timely/Atlas → marvel.
- Three-tier badge: VERIFIED (green) / ESTIMATED (yellow) / MANUAL REVIEW (red) / GRADE EXCEEDS MAP (amber). Listing button hard-blocked on MANUAL + GRADE EXCEEDS MAP.

### CGC penalty-aware Vision (Ship #18, STANDARD_PROMPT only)
Detects store stamps, staple popping, polybag indents, corner chips, pedigree stamps. `out.cgcPenaltyFlags` plumbed through 8 merge paths. `pedigreeRegistry.js` 22 canonical pedigrees + aliases, strict match.

### Watch Mode pipeline
Pass 1 — Haiku fast ID (confidence=high + title known → return). Pass 2 — Haiku self-correction. Pass 3 — Opus escalation (full STANDARD_PROMPT). No Sonnet anywhere in Watch Mode.

### Standard (non-watch) scan pipeline — eBay-first, Vision fallback
1. `lookupEbayIdentity` — eBay Browse API `search_by_image`, zero Claude cost.
2. Confidence ≥0.3 → cheap path: one Haiku grade-only call. No Sonnet/Opus.
3. Below 0.3/no consensus → Vision fallback: one Sonnet call (full ID); a second Sonnet call on top if book-signals detected or voice context supplied.
Opus never appears in this path (Watch-Mode-only). Prompt caching shares `system: [{SYSTEM_PROMPT},{promptText, cache_control:ephemeral}]` — the image itself is never cached.

### Voice + text context / Match confidence / List-price warning
Voice+text share `watchContext` state, last one wins; auto-bid regex-extracts `$N`. Match confidence: 0 comps→score 0/LOW; 1 comp→max 60/LOW; 2 comps→max 75/MEDIUM if rawScore≥65; 3+→full scoring; Vision confidence caps match confidence tier. `listPriceWarning.js`: three triggers (25% over engine rec, 20% over comps.highest, 50% over comps.average), skip flags for mega-key/manual-review/grade-exceeds-map.

### Low-grade floor anchor / Thin-pool anchor / Multi-key extraction / Premium creators
Low-grade floor (Ship #17): `pop.belowGrade===0` + browse_api source → re-anchor to `rawComps.lowest`. Thin-pool anchor (Ship #13.1): `rawComps.count<3` → cap at `rawComps.highest×1.05`. Both skip on mega-key/compsExhausted. Multi-key extraction (Ship #12a, display only) and premium creator credits (Ship #16, 80-creator registry, display only) both feed card display, never `keyIssue`/pricing directly — promotion gated behind explicit greenlight.

### Decision Engine (Layer 3, v0-D.1 deployed)
`computeDecision(item)` (`src/lib/decisionEngine.js`) returns action/confidence/blockers/warnings/next-steps. Actions: ID_REQUIRED (genuinely incomplete identity) · DO_NOT_LIST (hard blockers) · RESEARCH (critical warnings) · GRADE_CANDIDATE (2x+ grading upside) · LIST_LOW (moderate warnings) · LIST_NOW (clean). **Q110 ruling:** `assetTypeConfident=false`/reprint/identity-conflict are advisory `criticalWarnings` (→RESEARCH), never hard blockers — `listingHardLocked` gates only the List button, price stays visible. Genuinely-missing identity still hard-blocks. `describeBlocker`/`describeWarning` map slugs to item-grounded sentences, called from `App.jsx`'s decision-panel render sites.

### App.jsx merge paths
**IndexedDB merge sites: 8** (verified 2026-08-11): auto-refresh→catalogue, scan→catalogue, scan→selectedItem, bulk-import→catalogue, refreshMarketData, duplicate-confirm, reIdentifyBook, manual correction. Pattern: `enrich.X || cur.X || defaultValue`.

### Auto-refresh / Bulk import / Buyer-Whatnot / eBay listing / GoCollect CGC FMV / Misc
Auto-refresh: collection tab only, no detail open, 60s cooldown, skips items <5min old. Bulk import: non-comic rejection, title+issue+year dup detection, publisher-as-title WARN not block. Buyer/Whatnot: localStorage sessions/budget/settings, net profit formula, BUY/PASS auto-suggest. eBay listing title includes variant, filtered by `NO_TITLE_VARIANTS`. GoCollect CGC FMV: **NOT live** (Q25) — UI paths remain wired for future re-enable. Misc: `cleanPublisher` strips bracket/quote chars; FloatingSearchBar 🔍 search vs 🧠 claude never mix; Share Target → Buyer tab, `gradeBlob(blob,{save:false})`; nav swipe gesture requires ≤500ms + `|dx|≥50` + `|dx|>|dy|`.

## GrailKey Architecture Constitution

```
Asset First · IDs Ours · Claims Aren't Truth · History Appends ·
Domains Separate · Kernel Universal · API Before UI · Execute Anywhere ·
Outcomes Learn · Build Late, Design Early

CatalogEntity ≠ PhysicalAsset ≠ Owner ≠ Listing ≠ Transaction ≠ Payment
external ID ≠ GrailKey ID · listing ≠ asset · AI output ≠ canonical truth ·
pipeline trace ≠ audit identity
```

Full strategy: `docs/GRAILKEY-STRATEGY.md`. Architecture decisions: `docs/adr/` (ADR-AUTH-001 principal/owner/custodian, ADR-ASSET-001 physical-asset identity, ADR-MEDIA-001 private-media law, ADR-EVENT-001 event model, ADR-STORAGE-001 storage roles, ADR-ADAPTER-001 adapter contract, ADR-API-001 API contract discipline, ADR-ID-001 permanent identity, ADR-IDENTIFIER-001 identifier fabric (D4, schema ruling only — Phase A HOLD), ADR-VALUATION-001 ValuationQuestion + Applicability (D5B semantic closure, docs-only — 0015 design boundary), plus per-milestone design docs).

## Features
- **Bundle listing**: Manage tab → "📦 Create Bundle" chip → multi-select tiles → floating bar → `/api/list-ebay` with `{bundle:true, items:[...]}` → single eBay listing, shared `ebayItemId`/`bundleId`. ERA from earliest book year.
- **Watch Mode**: Buyer tab → 👁 Watch Mode → rear camera JPEG every 3s → `/api/grade` self-correcting pipeline → dedup by `title|issue` → `/api/enrich` on new comic. Voice + text context, auto-bid from transcript.
- **Post All HOT**: filters HOT-tagged unlisted priced items, sequential post with 1500ms between rows.
- **Editable list price**: numeric input overrides eBay StartPrice + persists.
- **CGC submission scenarios**: per-grade `fmv → net` pass/fail.
- **Decision recommendations**: BUY/SELL/HOLD/WAIT badges, gate listing on WAIT.

## CURRENT STATE — RECONCILED 2026-10-26 (supersedes the 2026-10-13 reconciled block, the 2026-08-23 "HISTORICAL" state block and the DATA-1D status block — all archived verbatim in `docs/archive/CLAUDE-MD-REMOVED-2026-10-26.md`; detail `docs/TICKET-REGISTRY.md`, "GK-P0 FIRST LISTING RECONCILIATION")

**VERIFIED LIVE (read-only, 2026-10-26):** Production = `main` = `f6e5d285bd9519dceb26bbf80dc6868614067e1a` — the P0 release: `2687099` (listing-state sync + cross-device restoration) · `50fe656` (publication mutex) · `f6e5d28` (provider UUID + verified error-488 recovery). Deployment `dpl_BQoooBuNzsy2VkkeyDkzFQAJmS7J`, READY, ref `main`, aliases `app.grailkey.com` · `comic-vault-rouge.vercel.app` · `comic-vault-boats43s-projects.vercel.app` · `comic-vault-git-main-boats43s-projects.vercel.app`, `aliasError` null. Previous deployment `dpl_6P4Q9h9n7mwtErfYr77zNMbMEdQ6` (`2bac0db`) is the rollback target. Push == deploy for `main`. Production database `idle_in_transaction_session_timeout` = 5min (the publication mutex sets its own 180s inside its transaction). `vercel.json` pins `api/list-ebay.js` `maxDuration` to 120s: the build accepted it, runtime enforcement was NOT independently observed. Vercel plan: a paid tier (billed overage, Rolling Releases available) — the exact label is not returned by any available API; confirm in the dashboard.

**FIRST CERTIFIED LISTING (database facts VERIFIED LIVE; browser acceptance OPERATOR-REPORTED PASS):** Old Man Logan #25 · asset `01a0bb24-c806-7a63-aa86-ce26fe8eed83` · catalogue `cv_1790809927798_txjz5n` · eBay ItemID `366762997648` · seller `boats-007` · approved price **$15.42** · published 2026-10-26T20:27Z through the Q41 (OPERATOR_MANUAL) path. Durable `outcome_event` LISTED plus attempt ledger AUTHORIZED → SUBMITTED → LISTED_CONFIRMED; inventory AVAILABLE; the attached `LIST` action is $15.42; closed economic outcomes remain 0. Operator-reported on `f6e5d28`: Sync eBay Status → refresh → sign-out/sign-in all PASS. Never publish, revise or end this listing, or change its price, as part of any verification.

**PUBLICATION RULES (standing):**
- **NO SECOND GRAILKEY EBAY PUBLICATION until the shipping defaults are corrected and verified** (operator ruling 2026-10-26). Evidence: `api/list-ebay.js` hard-codes flat shipping ($4.99, $0.00 at ≥$50), 3-business-day handling, 30-day seller-paid returns and a Phoenix, AZ 85033 item location, and reads none of the seller's business policies; the live listing displayed $6.15 shipping, origin UNKNOWN.
- **NEVER retry an ambiguous publication through a different path (READY ↔ Q41).** READY (no attempt row) and Q41 (attempt-derived) use different provider UUID schemes and are NOT deduplicated against each other. A failed, timed-out, interrupted or ambiguous request requires reconciliation against authoritative listing records and Seller Hub before another attempt. An expired lock is NOT permission to publish again. A unified logical publication identity is a REQUIRED follow-up before outside sellers receive publication privileges.
- Marketplace writes are OPERATOR-ONLY (`requireMarketplaceOperator`); no non-operator marketplace write until GK-283, GK-294 and GK-295 close. GrailKey Disconnect clears the local credential only and does NOT revoke at eBay (GK-264 stub).

**PROJECT QUEUE (operator-stated 2026-10-26 — the order is binding; each item needs its own explicit authorization; NONE is started):**
- **A. Outcome #1 — Record Sale and Finances host correction.** Today: `POST /api/ebay-outcome-reconciler` / `scripts/reconcile-ebay-outcome.mjs <ItemID>` (no dry-run, writes on a confirmed sale; no UI, cron or webhook); the Finances calls use `api.ebay.com` while eBay documents `apiz.ebay.com`; packing cost, acquisition basis and payout have no field and stay UNKNOWN, never $0; the order lookup reads one page of 50.
- **B. Adapter V1.1a — listing quality.** Description rules: ONLY verified condition observations and operator-supplied inputs; no invented defects and no professional-grading claims. Revision safety: read the CURRENT eBay item specifics and images before merging; never overwrite legitimate manual changes.
- **C. Adapter V1.1b — seller business policies** (Account API; needs the `sell.account` scope = a seller reconnect), a reusable packaging preset with measured weight/dimensions, and approved shipping. Do not invent weights, dimensions, condition or fees.
- **D. C3 pricing — only after explicit operator approval.** No pricing policy is rewritten as if it were approved.

**OPERATOR-REPORTED (2026-10-13, not re-verified):** independent cold-start Production recovery = PASS; local recovery database absence verified.

**HAZARD — local `main` divergence:** a local working copy's `main` (`97c0397`) has diverged from `origin/main` and its commits are not patch-equivalent to released ones. Never push local `main`; release only the exact authorized SHA, from an isolated worktree.

**Strategy (adopted 2026-10-13):** GrailKey optimizes the asset owner's risk-adjusted economic outcome; the customer question is "What should I do with this exact physical asset?". Leading customer hypothesis = comic dealers, NOT a validated market. Immediate test: **ONE SALE. THREE DEALERS. TWO MEASUREMENTS.** Candidate wedges (grading-versus-raw, MAX BUY, inventory disposition) are banked hypotheses — the winning wedge is NOT proven; dealer behavior (GK-298) decides — no wedge implementation authorized. Tickets: **GK-285** full scan COGS (spec only; the $0.015/scan figure is UNMEASURED) · **GK-297** same-image repeatability ($5 cap, no scans authorized) · **GK-298** dealer discovery (operator-owned) · **GK-299** dealer action/outcome gap (banked). Buyer Decision Ledger records BUY/PASS plus an optional purchase price tied to the decision — NOT linked to a physical asset and with no true acquisition date (registry finding).

**Kernel and DATA-1D (HISTORICAL EVIDENCE, 2026-09-19 → 2026-10-13; detail `docs/TICKET-REGISTRY.md` GK-215/216, `docs/B1-RELEASE-SEQUENCING-FINAL.md`):** authentication and the server-backed collection are live; GK-216 closed the Production schema gaps (0020/0021/0023/0024/0025) and the operator-authority attempt ledger (0040) was certified in Production 2026-10-13. EVIDENCE-LABEL RULE: Development rows and assets (e.g. Creepy #1 `01a02d23-…`) are Development evidence — never fabricated, copied or relabeled as Production evidence. H8 law: bootstrap authorization ≠ H8 proof (`MILESTONE_TEN_H8_BOOTSTRAP` is one-shot and is not `MILESTONE_TEN_H8_PASS`); no capture beyond the authorized H8-A → bootstrap → H8-B sequence (`docs/TICKET-REGISTRY.md` GK-215). The current H8 flag state was NOT re-verified in this compaction — OPERATOR TO CONFIRM before relying on it. The bundle-listing path publishes with no per-item linkage and is disabled in Production.

**Comic-pricing launch status:** ⛔ Prior GO void, `launch-candidate` tag deleted (post-`5cb121a` production findings reopened certification). Active gate: `docs/LAUNCH-AUDIT.md` Section 10. Post-launch roadmap: (1) edition-fingerprint campaign (designed, not built — `docs/LAUNCH-AUDIT.md` Section 2), (2) remaining comp-hygiene items (cover-only listings, foreign-variant blending, ComicVine wrong-volume matching), (3) D3-class follow-ups (refinement only, no defect).

**Known stale test suites:** full canonical list (per-suite counts, root causes, the 5 files found in the 2026-08-11-C full-suite re-sweep): `docs/KNOWN-STALE-TESTS.md`.

**Comic-pricing open items:** Q65 (Invincible #19 REVIEW gate), Q-SS (SS yellow-label comp-pool incoherence, needs its own design), FIX-4 floor re-verify (`docs/FLOOR_REVERIFY_2026-07-11.md`, pricing math — per-entry greenlight required), variant fallback for thin markets (architecture confirmed, awaiting greenlight), title-family fragmentation (watch-listed, one book so far — Pattern Library "GrailKey Dispatch 21"), `api/rate-limit.js` still not migrated onto the KV cache (in-memory Map, per-instance, not cross-instance-persistent), Q106 certNumber OCR risk (moot while CGC certlookup stays dormant).

**Session security:** `GRAILKEY_SESSION_SECRET` 32-char floor (fails closed under it), per-environment distinct secrets, `GRAILKEY_SESSION_EPOCH` global revocation, scrypt cost params pinned explicitly (`N=16384,r=8,p=1`), zero secret logging anywhere in the auth/assets/media modules — full detail `docs/adr/DATA-1D-CORRECTION-PASS.md`.

**Idempotency:** class-wide request-fingerprint law across all 10 Asset Service operations (GK-163) — same key+same payload replays, same key+different payload throws `IdempotencyConflictError`, both proven 40/40 against the real DB. Full detail `docs/TICKET-REGISTRY.md`, "GK-163."

## Roadmap

**Session 4A** (Next) — BookAdapter: create BookAdapter.js (ISBN lookup, condition keywords, edition detection). Universal AssetCore handles pricing/decision.
**Session 4B** — CardAdapter: create CardAdapter.js (player, team, card number, set, rookie flag).
**Session 5** — Multi-format UI: asset type selector, format-specific scan flows.
**Session 6** — Portfolio intelligence: cross-collection analytics, optimization recommendations.

(GrailKey's own DATA-0/DATA-1 roadmap is tracked live in the DATA-1D current-state block above, not here — this Roadmap section is the pre-GrailKey comic-pricing multi-format plan.)

## Architecture Notes

### AssetCore Abstraction (Session 3B)
AssetCore is **universal** — operates on primitives only (title, year, grade, price, rawComps, etc.). All format-specific domain knowledge lives in adapters:
- **ComicAdapter.js** (312 lines) — issue, publisher, variant, keyIssue, certNumber, cgcPenaltyFlags, comicVine, era detection, creator patterns, artist names, character-in-series, publisher-in-title protection, title sanitization
- **BookAdapter.js** / **CardAdapter.js** (future)

**Universal modules:** `identityCore.js` (title overlap, identity/issue/year resolution, comp backfill), `pricingEngine.js` (floor guards, sanity checks, grade multipliers, thin-pool anchor), `decisionEngine.js` (action selection, blocker/warning detection).

**Creating a new adapter:** one file implementing 4 functions (detectKeyValue, verifyStory, computeEraRisk, sanitizeFormatTitle), setting universal flags. **Boundary enforcement:** AssetCore MUST NOT reference format-specific fields. See `docs/ASSETCORE_INTERFACE.md`.

## Pattern Library
**Descriptive names, not letters, for the older class-based findings; numbered dispatches/directives after. Full writeups: `docs/PATTERN-LIBRARY.md` (older/architectural) or `docs/TICKET-REGISTRY.md` (GK-N ticket-numbered, current convention). One line per finding here — never the full writeup inline.**

**Classes (pre-numbering era):** Sinful Suzie (wrong-title comp contamination) · Thor #4 (printing-version mismatch) · Howard Duck Magazine (format collision) · Marvel Age #58 (shared issue #, different title) · Annual #2 (marker asymmetry) · Loot Crate (unflagged convention variant) · Chip n Dale (text verified, wrong cover image) · Whitman #978 (non-comic format priced as comic) · Action Force (thin pence/UK false HIGH) · Spooky #118 (grade mismatch in active pool) · D'Orc #1 (apostrophe tokenization) · Star Wars #1 (reprint vs first-print, Ship #19) · Biker Mice #1 (thin-pool sanity flip, Ship #13.1) · Action #1/Superman #1/Detective #27 (manual-review mega-keys) · JLA #62 (low-grade floor, Ship #17) · FF #61 (Silver Age underpricing, Ship #14) · House of Secrets #106 (alias-only creator detection, Ship #16) · TMNT #1 IDW 2016 (mega-key publisher+year disambiguation) · Donald Duck Whitman #978 (refuse-to-price gate) · Provisional State Write (optimistic-state persists through merge) · Vision Hallucination (Vision infers from JSON_SHAPE at low confidence) · Build-Pass Runtime-Fail (JSX scope errors) · Renumbered-franchise collision (ASM #17/Action Comics #33, price-band Tier 2 mitigation) · Distinctive-artist-style confusion (Peach Momoko, TPB fix insufficient) · Variant-artist token fusion (Skottie Young, fixed via ARTIST_PATTERNS strip) · Intake-vs-listing gate (Q110, `listingHardLocked`) · Generic-descriptor variant-match (Q111, `classifyVariantTokens`) · Batman #608 five-bug class (Q112–115, ComicVine volume-year leak et al.) · Incredible Hulk #377 printing/edition (Q116, `classifySpecificPrinting`) · Catwoman #64 Szerdy-variant (Q127) · Drifted-duplicate-constant/year-tolerance (Q128) · Volume-launch-year comp date (Q128, Harley Quinn #62) · Correct-rejection silent-substitution (Q129) · Bone #1 (GK-34 `MIN_POOL_FOR_OVERRIDE=3`) · Dormant-multiplier (newsstand extended, key held).

**Standing invariants named across these dispatches (full definitions in `docs/PATTERN-LIBRARY.md`, grep the name):** Monotonic Evidence Extension · No Self-Corroboration (Dispatch 33) · Rejection must not create authority (Dispatch 34, extended by 38's mega-key-floor axis) · cache correctness is authority correctness — key on the predicate, never a proxy for it (Dispatch 37) · authority must be use-consistent (Dispatch 44) · a safety gate must not disappear because an asset crossed a persistence boundary · a value must not vote for itself (Dispatch 46/46B) · Authority Propagation Invariant — Computed-Then-Discarded / Validation Bypass on Authority Replacement / Stale Authority Inheritance (Directive 11-G/11-H) · unknown printing confers no exact-print authority (Directive 12-J, `docs/TICKET-REGISTRY.md`) · issue-axis consensus is never rank-weighted (Flash #139, see "Issue-consensus guard" above) · corroboration must be physical (Directive AN) · authority is earned from evidence, never granted by list membership nor retained by an unresolved contest (Directive AR).

**Numbered dispatches/directives (2026-08-07 onward), one clause each:**
- **15** titleOk bar lowered, vision-zero-support floor, 3 creator additions SHIPPED. **16** CLAUDE.md split (first compaction). **17** GCD terms obtained, cover-matcher plan-only. **18** KV drift reconciled, api/ count 14. **19** Fix 5/6 SHIPPED (asset-type lift, vision-fallback year rescue). **20** commit-p rank-slot theft = title-family fragmentation. **21** fragmentation watch-listed; KV scan-logging designed. **22** KV scan-logging SHIPPED. **23** function cap RESOLVED. **24** confidence-leak confirmed intermittent. **25** unanimous-consensus unblock, Fix 1/2/2b SHIPPED, Fix 2c HELD.
- **32** coherent-content-token lane DELETED (0/15 hit rate). **33** Architecture v1.0 instrumentation, 2 standing invariants. **34** Rejection-must-not-create-authority invariant, Step 1 SHIPPED. **37** cache-key correction, 4th invariant. **38** mega-key floor axis of same invariant (Bone). **39** pricing-auditability gap named. **40** cache Gate 2 CLOSED PASSED, decision-layer non-determinism found. **41** Gate 1 CLOSED. **42** priceDerivationTrace never persisted. **43** bulk cardinality proven, fixture pipeline built. **44** mega-key root cause confirmed, 5th invariant.
- **Dispatch 42-I** SAFE-KILL certified. **45** GK-39 fabrication found, split. **46+46B** GK-62 SHIPPED, 2 invariants. **47** GK-39A SHIPPED. **48+50** GK-66/67 SHIPPED. **Operator Mode Hold** `1aa6eb0` baseline, engineering paused. **11-A** GK-38/42 resolved as stale numbers. **11-B** TICKET-REGISTRY.md created, GK-71/72 SHIPPED. **11-G** Authority Propagation Invariant named, GK-74 SHIPPED. **11-H** Stale Authority Inheritance mechanism added. **12-J** GK-77 split, unknown-printing invariant, GK-79A CLOSED.
- **13-O** comp query ladder fix SHIPPED. **13-P** Task 1/2 BLOCKED, Task 3 SHIPPED. **Directive Q** corrected P's Task 3 (presence-aware fix, 7 sites). **13-R** variantNote omission fixed. **14-T** picker foundation, GK-85/86/87. **14-U** GK-87 gradeBlob gap CLOSED. **14-V** CLAUDE.md compaction #2, activeScanRef guard. **14-X** GK-94 CLOSED. **Directive Y** Sabrina root cause traced (GK-95/96). **Directive Z** GK-95/96 SHIPPED (`actionAuthority.js`).
- **AB** GK-101 CLOSED (variantApplicability custody). **AD** GK-99 SHIPPED (identity-recovery toggle). **AE** GK-107 CLOSED (cache-key publisher). **AF** GK-98 CLOSED (discriminative-evidence, Flash #139 unrelaxed). **AG** GK-98 kill-path-3 RE-CLOSED (22e exemption). **AH** GK-111 CLOSED (3rd false-READY). **AI** GK-113/114 SHIPPED (`identityReconciler.js`). **AJ** GK-117/118 CLOSED (reconciler reachability). **AK** GK-119 CLOSED (population-precedence). **AL** GK-109/120 SHIPPED-PENDING (PC anchor + variant authority). **AL continuation** variant reconciler + physical-year custody. **AM** GK-109 CLOSED, GK-120 F-1/F-3 SHIPPED. **AN** GK-121 SHIPPED-PENDING ("corroboration must be physical"). **AN correction** GK-123 found. **AQ-follow-up** GK-128 CLOSED. **AR** GK-129/130 SHIPPED-PENDING (evidence-earned authority). **AS** GK-132 SHIPPED-PENDING ("candidate always enters"). **AT** GK-135 SHIPPED-PENDING (`reconcileYear` added). **AU** GK-136/137 fixed, GK-138 born (Handler-Wiring Verification). **AW** GK-140 SHIPPED (`canonicalizeTitleCandidate`). **AV** GK-133/139 SHIPPED-PENDING (last facet + mega-key identity gate). **AQ** GK-127 SHIPPED-PENDING, GK-128 OPEN. **AP** GK-124 SHIPPED-PENDING (`UNRESOLVED` variant state). **AO** GK-123 SHIPPED-PENDING (`COMPANION_PRODUCT_RE`).
- **2026-08-21 → 2026-10-26 ticket train (compaction #4: the full 51 KB narrative is archived VERBATIM in `docs/archive/CLAUDE-MD-REMOVED-2026-10-26.md` §B; ticket rows `docs/TICKET-REGISTRY.md`; the standing rules it established are the "Standing implementation invariants" digest above). One clause each:** **Identity/pricing:** GK-142/143/148/149/152–159 closed via physical rescan · GK-160/161 report-only · GK-238 authority truthfulness (GK-239/240 banked) · GK-246/247 re-scoped from GK-147 · GK-249–254 U6.0 Book safety chain (category allowlist, durable category authority, owned-flow fail-closed). **Kernel/DATA:** GK-163 class-wide idempotency · GK-164 credential incident · GK-165/166 · GK-178 pooled-connection session-state hazard · GK-179 environment-identity guard (regressed 2026-09-11, guard held) · D5A–D5D (market_observation, ValuationQuestion/Applicability 0015/0016, MarketPopulation 0017, isolated valuation writer with ZERO production call sites; D5D wiring is separately gated) · GK-180–193 D5 findings · GK-201/202 audits and rescan continuity · GK-221–223 database-target hygiene. **Outcome #1/marketplace:** GK-203/205/206/207/208 (outcome ledger, unconditional linkage, photo handoff) · GK-209/210/219/220 (reconciler, economics, PredictionError) · GK-211 agent-commerce projection boundary · GK-213 product-refinement bank · GK-214 OAuth state · GK-215/216/218 (H8 deadlock, Production integrity audit, capture wiring) · GK-224/225 Inventory Authority + SOLD consistency · GK-226/227 valuation fix + post-capture media append · MAX BUY V1 · Buyer Decision Ledger V1 · Outcome #1 packet safety and V1 buyer copy · buyer-facing text sanitation · GK-268 auth recovery UX · GK-271 market-evidence foundation · GK-273 Research the Market · GK-274 PredictionError anchor · GK-279 physical-copy guard. **2026-10-26 P0:** `2687099`/`50fe656`/`f6e5d28` (see CURRENT STATE).

## Open Blockers
Full detail (external API status, internal-investigation notes): `docs/OPEN-BLOCKERS.md`.

- **External:** GoCollect key pending. eBay Marketplace Insights DEAD. eBay Finding API bypassed. CGC certlookup DORMANT (WAF 403).
- **Workaround active:** PriceCharting sales-history scrape.
- **Internal:** `cv-lang-gate` passes foreign volumes while reporting a filter (logged, not fixed — no real language/locale signal exists to replace the keyword match). GitHub→Vercel auto-deploy silently didn't fire once (2026-07-16, root cause never found; has not recurred through `a8dcdca`).

## Handoff Pointers — Navigation

- Physical Asset Protocol (Six Foundation Laws + Compatibility Matrix, canonical) → `docs/architecture/GRAILKEY-PHYSICAL-ASSET-PROTOCOL-v1.md`
- Cross-workstream status board → `docs/MASTER-BOARD.md`
- Universal Launch Census (a SYSTEM MAP, NOT the roadmap — roadmap is live exposure closure → Universal U1 → outside-user private beta; Outcome #1 in parallel) → `docs/UNIVERSAL-LAUNCH-CENSUS.md`
- Tickets/history → `docs/TICKET-REGISTRY.md`
- Product refinement / grading program bank (GK-213, not implemented) → `docs/PRODUCT-REFINEMENT-BANK.md`
- Grading campaign spine, grade-authority laws, outside-user hard gates, blind-certified-corpus contract (NO rubric calibration before corpus) → `docs/GRADING-CAMPAIGN.md`
- Failure patterns (older/architectural) → `docs/PATTERN-LIBRARY.md`
- Architecture decisions → `docs/adr/`
- Strategy → `docs/GRAILKEY-STRATEGY.md`
- Test baseline cascade (pre-current stamps) → `docs/TEST-BASELINE-HISTORY.md`
- Known stale test suites (full) → `docs/KNOWN-STALE-TESTS.md`
- Open blockers (full) → `docs/OPEN-BLOCKERS.md`
- DATA-1D auth/session/media design → `docs/adr/DATA-1D-CORRECTION-PASS.md`, `docs/adr/DATA-1D-AUTH-CROSS-DEVICE.md`
- D5B ValuationQuestion/Applicability design + 0015 scratch proof → `docs/adr/ADR-VALUATION-001-question-applicability.md`, `docs/D5B-0015-DESIGN-REPORT.md`
- HOLD outcome model (design only, not built) → `docs/HOLD-OUTCOME-MODEL-DESIGN.md`
- DATA-1 readiness interrogation (GK-145/146/147) → `docs/DATA-1-READINESS.md`
- GrailKey record-class/gkAssetId boundary (§10) → `docs/DATA-0-ARCHITECTURE.md`
- Session history → `docs/archive/` directory; full ship log → `docs/SESSION_ARCHIVE.md`
- Text removed by compaction #4 (verbatim) → `docs/archive/CLAUDE-MD-REMOVED-2026-10-26.md`; test roster count/stamp → `docs/TEST-ROSTER.md`; roster-delta history → `docs/TEST-BASELINE-HISTORY.md`
- Behavioral specs → `tests/` directory (standalone scripts, run via `node tests/X.test.js`, no test runner installed)
- Pricing math → `api/enrich.js`
- Sold verification → `src/lib/soldVerification.js`
- Comp hygiene → `src/lib/compHygiene.js`
- Pedigree registry → `src/lib/pedigreeRegistry.js`
- Premium creators → `src/lib/premiumCreators.js`
- List-price warning → `src/lib/listPriceWarning.js`
- Decision Engine → `src/lib/decisionEngine.js`
- Vision integration → `api/grade.js`
- PriceCharting scrape → `api/pricecharting-pop.js`
- Mega-keys floor → `api/mega-keys.js`
- Asset Service → `src/modules/assets/`
- Auth module → `src/modules/auth/`
- Media module → `src/modules/media/`
- Capture integration → `src/modules/capture/`
