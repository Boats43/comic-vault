# Open beta security release v4 — certification notes and next-release tickets (2026-10-12)

Release branch `launch1-security`, based on Production `5e36226`. NOT pushed, NOT deployed. This file is the operator-facing companion to the TICKET-REGISTRY entry for GK-L1A / GK-L1B.

## 1. Image GET limits (GK-L1B v4) — thresholds and expected load

Protected image reads (`GET /api/collection-image-v2`) are limited per **verified principal** (the credential's principal, never an IP) by `src/lib/imageReadLimiter.js`:

| Parameter | Value | Why |
|---|---|---|
| Burst capacity | 300 reads | A full first load of the operator's real 199-item Collection, with headroom. A mobile screen is 36 thumbnails. |
| Refill | 1 read / second (600 per 10 min, 3,600 per hour) | Restores a full screen in about 3 minutes. |
| In flight | 40 per principal | HTTP/2 can issue a whole screen at once; this bounds concurrent database/blob work. |
| Keyed by | verified principal | Users behind one shared address never throttle each other. |
| Scope | per serverless instance | Same trade-off as `api/rate-limit.js`; the bound is `limit × warm instances`. A durable counter would add an Upstash round trip to every thumbnail. |

Per read: one primary-key lookup (`collection_item` by `principal_id, id`, a pooled connection) + one media `head()` + one media `getBytes()` (~100–150 KB).
Worst case for one principal on one instance: 300 reads immediately, then 1 read/second ≈ 1 DB lookup + 2 media calls per second ≈ 0.13 MB/s (~470 MB/hour) of egress. The browser's private cache (`max-age ≤ 300 s`; URLs stay identical across silent credential refreshes) means a returning viewer re-requests little.
Exhaustion: `429 IMAGE_RATE_LIMITED` with `Retry-After`; a client treats it as a missing image and the error-recovery path is itself rate-limited (one recovery per 20 s). The credential mint stays on the per-principal `checkRateLimit` (30 / 10 min).

## 2. CDN recovery for the retired endpoint — capability and procedure

**Evidence (measured 2026-10-12 on the live Production edge):** the OLD endpoint's 200 responses ARE edge-cached — three consecutive GETs of one item URL returned `X-Vercel-Cache: MISS`, `HIT`, `HIT` (`Age` 0 → 1) despite the response having only `Cache-Control: public, max-age=31536000, immutable` (no `s-maxage`). A cached 200 after deployment is therefore a real possibility, not a hypothetical.

**Can the agent purge it? No.** The tools available here are tag-based only (`invalidate_by_tags`, `invalidate_by_src_images`) and the old responses carry no cache tag; there is no "purge all"/"purge path" tool and the Vercel CLI is not installed on this machine. A purge is also a Production mutation requiring its own authorization.

**Operator procedure (executable by the project owner/member, no code):**
1. Dashboard: Project `comic-vault` → **Settings → Caches → "Purge CDN Cache"** (confirm the dialog). Requires the Owner or Member role on the project (a Viewer cannot). Or CLI: `vercel cache purge --type cdn --yes` run from a logged-in, linked checkout.
2. Re-test `GET https://app.grailkey.com/api/collection-image?id=<a real item id>&index=0` three times: all three must be `410`, and no response may be a `200` image. Record `X-Vercel-Cache` for each.
3. If any `200` remains after the purge: the release stays **HOLD**; do not re-enable anything; escalate. **Do not roll back to the previous deployment** (it re-serves the insecure public endpoint). Any emergency forward change needs separate authorization.

**Pre-flight (do BEFORE deploying so recovery is known-executable):** the operator opens Settings → Caches and confirms the "Purge CDN Cache" control is present and enabled for their role. Do not click it.

Already-downloaded copies in browsers or intermediaries cannot be revoked; the retired URL only stops future fetches.

## 3. Operator configuration status (read-only, values not shown)

| Environment | `SPEND_GUARD_OPERATOR_PRINCIPAL_IDS` | Other spend variables |
|---|---|---|
| Production | PRESENT, valid (1 UUID) | operator 5000 / principal 100 / global 6000 / `GRADE_ATTEMPT_ENFORCEMENT` set |
| Preview | **MISSING** | none |
| Development | **MISSING** | none |

v4 makes a valid operator configuration mandatory in EVERY environment (no test or environment exception). Consequence: a Preview deployment, or `vercel dev`, refuses every paid call with `SPEND_GUARD_MISCONFIGURED` until the variable is set there. That is the intended fail-closed behaviour; setting it is an operator decision and was not done.

## 4. Controlled deployment sequence (NOT executed)

0. Pre-flight: operator confirms the CDN purge control exists (section 2) and has the iPhone with the installed PWA at hand.
1. Literal `PUSH AUTHORIZED` and `DEPLOY AUTHORIZED` for the exact release commit.
2. Clean-worktree build + focused suites; fast-forward `origin/main` from `5e36226` (no merge, no reset); deploy; confirm READY, aliases and commit.
3. Public edge, retired endpoint: three GETs of a real old URL → all `410`. A cached `200` is a **release failure**: run the section-2 procedure and re-test.
4. New endpoint: unauthenticated `GET /api/collection-image-v2?p=x&id=y&i=0` → `403 IMAGE_CREDENTIAL_MISSING`; `POST` without a session → `401`.
5. **Operator iPhone Collection check (explicit):** fully close and reopen the PWA; confirm the build marker shows the release commit; sign in; open **Collection** and scroll to the bottom — thumbnails for items whose photo is not stored on this phone must appear, none broken; background the app for 11+ minutes, return, scroll again — images still show or recover within a few seconds; **Log out** then sign back in — images reappear. Send one screenshot of the Collection and note anything missing. Items scanned on this phone render from local photos and prove nothing about the new path.
6. Spend: after the operator's next ordinary scan, confirm `sg:v1:p:<operator>:<UTC day>` incremented and `sg:v1:n:<UTC day>` did not (read-only counters).
7. Record final deployment ID, commit, the three 410 results and the iPhone confirmation.
8. Rollback policy: none automatic. Promoting the previous deployment re-exposes the public endpoint and needs separate authorization; prefer a forward fix.

## 4b. Test results and pre-existing failures

Sweep of the 230 test files that reach the spend guard (parallel pass, then sequential reruns of every non-pass, on BOTH the Production baseline `5e36226` and this branch). New/updated suites all pass (launch1a 127, launch1a browser 48, launch1b protected 112, launch1b principal+limits 56, launch1b browser 61, spend-guard 42, env-boundary 68, refusal-message 38). Three apparent regressions (`grailkey-commit-e`, `grailkey-directive-al-4a-4e-variant-year-custody`, `grailkey-directive-am-variant-custody-real`) assert git state ("file byte-identical to HEAD") and read the DIRTY working tree; they are re-verified after commit. 35 files fail identically on the baseline and the branch (the same failing-assertion counts, except `gk276-enrich-canary-handler-smoke` which improved 4/7 -> 5/6): artist-registry-sync, comp-filter-hygiene, decision-engine, dispatch-42-comicvine-kill (timeout), gk152-handler-smoke, gk157-158-handler-smoke, gk159-commit4-terminal-floor-handler-smoke, gk168-edition-facet, gk184-handler-smoke, gk227-asset-media-append-handler-smoke, gk229-content-unverified-handler-smoke, gk270-canonical-collection-projection, gk271-enrich-handler-smoke, gk272-classic-comics-refused-conflict-smoke, gk276-enrich-canary-handler-smoke, grailkey-commit-f, grailkey-commit-m-pc-query-fallback (timeout), grailkey-commit-v1, grailkey-directive-aj-http-handler, grailkey-directive-av-handler-smoke, grailkey-directive-aw-handler-smoke, grailkey-directive-j-gk79a-relabel, grailkey-directive-p-task3-variant-on-card, grailkey-dispatch-2026-08-21-gk145-gk146-measurement, grailkey-dispatch-e-task3-source-labels, grailkey-gk142-series-core-query-handler-smoke, grailkey-operator-panel-capture-wiring, grailkey-outcome1-grading-calibration-patch, image-search-extraction, p0a-rescan-continuity-handler-proof, q-adv397-visual-guard, q-trackB-commit4.3-winning-family-authority, q141-rachta-lin-pricing-eligibility-gate, second-principal-capture-certification, ship26-integration.

## 5. Next release — pricing trust (three tickets, NOT implemented, pricing-math greenlight required)

### GK-L2A — Grade authority before comparable selection (first)
Defect (code-verified): `api/enrich.js` passes the request's `grade`/`numericGrade` to `fetchComps` (≈ line 7416) before the governing grade is resolved (≈ line 8372); an operator-confirmed grade is already known by ≈ line 2875 yet the comp fetch still filters (grade-proximity ±1.5) on the client-asserted grade.
Fix: resolve `resolveGoverningGrade(...)` (durable operator authority; server-owned `currentGradePrediction` for owned items) BEFORE `fetchComps` and pass the governing grade/numeric to it. With no governing grade the existing request-grade behaviour stays but the result is marked provisional.
**Acceptance invariant:** for a fixed item, varying the untrusted client grade across every grade string/numeric cannot change the admitted sold-comparable pool when a governing grade exists (pool hash identical). Tests: property test over the grade space with a stubbed comp source; the real Wolverine #38 and New Mutants #98 fixtures; a forged `OPERATOR_CONFIRMED` request field must not count as governing.

### GK-L2C — Evidence-to-action rule (second)
Defect: nine Production items (all `active_ask_derived`, Tier 3) carry LIST_NOW (7) or LIST_LOW (2) — see table. Zero verified sold comps, or `SIMILAR_ONLY` standing, must never by itself justify LIST_NOW/LIST_LOW; the engine returns RESEARCH unless a **separately specified, governed exception** is approved.
Proposed rule (thresholds are governed parameters awaiting approval, not decided here): LIST_NOW/LIST_LOW require `pricingSource` in the sold-based set AND `verifiedCount ≥ N` AND `newestDaysAgo ≤ D` AND `marketStanding = EXACT_CURRENT`; otherwise RESEARCH. Tests: exact-match fresh sold → allowed; zero verified sold; similar-only; ask-derived with verified sold (the Batman: The Knight Returns #1 case — 17 verified, 14 days old, yet priced from asks, which also implicates GK-L2A); stale sold (> D days); every one of the nine as a fixture.

| Item | Scanned (UTC) | Action | Standing | Verified sold | Newest | GK-238 live at scan? |
|---|---|---|---|---|---|---|
| Brave and the Bold #141 | 2026-09-20 23:39 | LIST_LOW | EXACT_CURRENT | 1 | 250 d | **No** |
| Amazing Spider-Man #11 | 2026-09-21 00:43 | LIST_NOW | EXACT_CURRENT | 0 | — | **No** |
| Invincible Atom Eve #1 | 2026-09-21 03:19 | LIST_NOW | SIMILAR_ONLY | 0 | — | **No** |
| Batman Tim Drake #457 | 2026-09-21 03:27 | LIST_NOW | SIMILAR_ONLY | 20 | — | **No** |
| Detective Comics #424 | 2026-09-21 03:30 | LIST_LOW | EXACT_CURRENT | 1 | 203 d | **No** |
| Marvel Age #134 | 2026-09-25 01:04 | LIST_NOW | SIMILAR_ONLY | 1 | 103 d | Yes (`dpl_CsiznMajKUSu`, `dca47d5`) |
| S Greatest Comics #27 | 2026-09-25 01:38 | LIST_NOW | EXACT_CURRENT | 2 | 154 d | Yes (`dpl_CsiznMajKUSu`) |
| Iron Man #150 | 2026-09-27 14:59 | LIST_NOW | SIMILAR_ONLY | 26 | 2 d | Yes (`dpl_CiPFeh2atMop`, `f0c289c`) |
| Batman: The Knight Returns #1 | 2026-10-02 05:09 | LIST_NOW | EXACT_CURRENT | 17 | 14 d | Yes (`dpl_47U35kG9d1mw`, `5490d08`) |

**When GK-238 reached Production (verified from the deployment list and git ancestry):** commit `836f264` ("GK-238 — Authority Truthfulness Hotfix", authored 2026-09-21 15:11 PDT) was deployed as `dpl_2zhuTuYCnMieZFBMHPbN77AMrHEq`, created **2026-09-21T22:11:33.903Z**. The first five items were scanned before that; the last four after it, under deployments that contain it — so GK-238 alone did not prevent LIST_NOW on ask-derived prices. Stored decisions are scan-time snapshots; a refresh recomputes them.

### GK-L2B — One authoritative, dated valuation (third)
Defect: the Collection card shows the catalogue's saved price/contract (New Mutants #98: **$360.59**, scanned 2026-09-20) while the durable `valuation_event` is **$263.80** (2026-10-02) and the operator panel shows the latest valuation. Two surfaces, two numbers.
Fix: define one precedence — the latest durable valuation (by `recorded_at`, id tie-break) for linked assets, else the catalogue estimate labelled "card estimate, <scan date>" — and use it on the Collection card, detail view, packets and operator panel; always show the valuation date. Tests: New Mutants #98 fixture renders $263.80 + date on card and panel; an unlinked item shows the labelled estimate; no surface shows a price without its date.
