# Known Stale Test Suites

Moved here verbatim from CLAUDE.md's `## Current State` section during the
CLAUDE-COMPACT-1 pass (2026-08-23) — CLAUDE.md now keeps only a one-line
pointer to this file. This content was not duplicated anywhere else prior
to this move.

**CANONICAL, re-verified 2026-08-06 (GrailKey Dispatch 02, Commit 0a). This
list is the single source of truth for "documented baseline" going forward;
`docs/LAUNCH-AUDIT.md`'s older baseline mentions (which omitted
`q-adv397-visual-guard` and never carried per-suite counts for 5 of these
10 files) are historical record only and do not supersede this.** No test
runner is installed in this repo (no `vitest`/`jest`, no `npm test`
script) — every `tests/*.test.js` is a standalone script, run individually
via `node tests/X.test.js`.

decision-engine (7), comp-filter-hygiene (4, Bug 1/2 helpers),
sold-verification (5, variant filters), identity-gate (7),
image-search-extraction (2), mega-keys (8), pattern-k-dedupe-issue (4),
q-adv397-visual-guard (5, previously missing from this list entirely).

**priceBands (7)** — re-triaged 2026-08-06 against GK-31 and Commit 5
specifically, not just GK-21. Two unrelated root causes, neither
overlapping GK-31 or GK-24/GK-19:
- 2 failures (`buildVerifiedSoldPool` "wrong issue filtered" / "variant
  mismatch filtered") test behavior `buildVerifiedSoldPool` deliberately
  stopped doing (Ship 1.6, `priceBands.js:164-183`) — issue/variant filtering
  moved entirely to `verifySoldComps` (Layer 10, `soldVerification.js`) so
  this function now trusts its input rather than re-filtering. This is the
  same file GK-24 (printing-axis fallback trigger) touches, but a different,
  already-superseded function — no landmine for GK-24.
- 5 failures (STEP 1/2/3, Action Comics #33, Flash #216) all fail on plain
  fresh-sold-pool fixtures with no variant/fallback content at all — root
  cause is a fixture/signature drift: `computePriceBands` now requires an
  explicit `soldVerifyResult.verified[].recencyBand`-shaped object for
  tier-1/2/2.5 detection (added by the same EX-A/Q109 work that also
  produces GK-31's `activeAnchoredOverFallbackSold`), but these 5 legacy
  fixtures still pass a flat `soldComps` array with an unread `daysAgo`
  field. Confirmed NOT related to GK-31's specific branch — these fixtures
  never reach tier-3 logic at all.
- **`applyVariantFallbackDivergenceCap`/GK-21** — confirmed clean, unrelated,
  has its own passing coverage (EX-A(a)-(d)) in this same file.
- **GK-31 coverage gap, found during re-triage, not one of the 7 failures:**
  zero tests anywhere in this file exercise `activeAnchoredOverFallbackSold
  = true` (`priceBands.js:531-553`, requires `verifiedActive.length >= 3`
  AND `isActivePoolVariantConfirmed`). The passing EX-A(c) fixtures use only
  1 active comp — below the ≥3 floor — so they hit the divergence-cap
  branch (GK-21), never GK-31's tier-3-active-anchor branch. Landing GK-31
  against this file has no existing regression test watching the branch it
  modifies; add one alongside the fix, not after.

**batch1-fixes** — throws on first failure instead of collecting (test-design
gap, not fixed). Characterized 2026-08-06: 0/16 assertions run before the
throw. Root cause confirmed structural, not a stale one-liner — Q22's
hyphen-normalization assertions test `tokenizeTitle`'s own output, but FIX-2
(`jrcrp-17838110`, `src/lib/compHygiene.js` ~789) deliberately moved
hyphen-join equivalence out of `tokenizeTitle` (which now correctly
space-splits "Spider-Man" → `[spider, man]`) into `hasSufficientTitleOverlap`'s
bigram-join check, to fix a real production regression (Giant-Size X-Men
vs. Giant Size X Men, 17 sold rows wrongly rejected). Q22's 4 assertions
are obsolete by design; Q23's 7 and Q28's 5 (unreached, gated behind Q22's
throw) independently verified to still pass against current code. **Do not
retire Q22 — relocate it.** `hasSufficientTitleOverlap` is GK-19's target
(one-directional overlap check, `src/lib/compHygiene.js` ~819 area — never
penalizes a listing's extra distinguishing tokens, letting "Batman Gotham
Adventures" clear 0.75 against "Batman Adventures"). When Commit 5 lands
GK-19's fix, that is the moment to rewrite Q22's 4 assertions against
`hasSufficientTitleOverlap`'s bigram-join logic — the layer the hyphen-join
behavior actually lives on now — rather than against `tokenizeTitle`.

**Stale assertion, not yet patched:** `grailkey-commit-e.test.js` and
`grailkey-commit-f.test.js` Part 2 ("scope proof: only src/App.jsx changed")
reads the live `git diff --name-only HEAD` working-tree state, not the
historical diff of the commit each file is named for. Written assuming a
single-file commit; will false-fail (informational only, not a regression
signal) any time it's run with other unrelated changes sitting uncommitted
— including this exact Commit 0a patch. Flagged in both files' Part 2
comment 2026-08-06; not restructured to be commit-agnostic (out of scope
for a display-only patch pass).

**ship26-integration** — FIXED 2026-08-06 (harness-only: `tests/
ship26-integration.test.js`'s `callEnrich` mock omitted `req.headers`,
so `api/rate-limit.js:12`'s `req.headers['x-vault-key']` threw
`TypeError` before any assertion ran. Added `headers: {}` to the mock
request. No production code touched. Now 13/13 passing — removed from
this stale list.**

Reconcile remaining stale expectations vs code in a dedicated pass.

**Full-suite re-sweep, GrailKey Directive 2026-08-11-C, HEAD `0cb4c38`,
2026-08-11 — 5 files failing or timing out that were not named anywhere
above. Enumeration only, per the closeout directive's own scope — none
investigated or fixed this pass.**
- **artist-registry-sync.test.js** — 2 failures ("dekal", "spears" —
  `ARTIST_SURNAME_WORDS` entries that don't trace back to any
  `ARTIST_PATTERNS` entry).
- **grailkey-commit-g.test.js** — 1 failure, same shape as the already-
  documented `grailkey-commit-e.test.js`/`grailkey-commit-f.test.js` Part
  2 stale-assertion above (reads live `git diff --name-only HEAD`, false-
  fails whenever other uncommitted changes are present) — a third file
  with the identical known defect class, just never added to that
  paragraph by name until now.
- **grailkey-commit-v1.test.js** — 1 failure (`exactly 24
  writeConfirmed() call-assignments after the anchor` — expected 24,
  found 25; a hardcoded count assertion one commit behind current code).
- **grailkey-dispatch-33-parity-harness.test.js** — exits non-zero by
  deliberate design, not a defect: `0 passed, 0 failed, 1 skipped` — the
  Dispatch 33 parity-harness stub intentionally ships with zero cases
  until a shadow lane exists to compare against (see the Dispatch 33
  Pattern Library entry). Flagged here only because it wasn't previously
  named in this list and a naive PASS/FAIL sweep reads its exit code as
  a failure.
- **ship26-integration.test.js** — TIMEOUT, confirmed non-deterministic
  (one run completed clean at ~35s, a second run genuinely hung past
  40s) — **contradicts the "FIXED... 13/13 passing, removed from this
  stale list" entry directly above.** Root cause not investigated this
  pass; the visible symptom is repeated `[Upstash Redis] Redis client
  was initialized without url or token` lines, consistent with this
  being a local-environment artifact (no `KV_REST_API_URL`/`TOKEN` set
  outside Vercel) rather than a genuine code regression, but that is an
  unverified hypothesis, not a finding.
- **Checked and ruled out, not added:** `dispatch-42-comicvine-kill.test.js`
  and `grailkey-commit-m-pc-query-fallback.test.js` both appeared as
  TIMEOUT under this sweep's own 20s-per-file cutoff, but both complete
  cleanly (27/27 and 10/10 passing respectively) once re-run with a
  longer timeout — an artifact of the sweep harness, not a real failure
  or hang. Noted so a future sweep doesn't re-flag them without checking.
