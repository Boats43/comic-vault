# Open Blockers

Moved here verbatim from CLAUDE.md's own `## Open Blockers` section during
the CLAUDE-COMPACT-1 pass (2026-08-23) — CLAUDE.md now keeps only a
one-line status summary per item, pointing here. This content was not
duplicated anywhere else prior to this move (confirmed by direct search
against `docs/TICKET-REGISTRY.md` before archiving).

## External

- **GoCollect API key #019483** — pending since 2026-04-15.
- **eBay Marketplace Insights API** — gated for indie devs (DEAD).
- **eBay Finding API** — rate-limited 100% as of late April 2026, bypassed.
- **CGC certlookup endpoint (`cgccomics.com/certlookup/`)** — DORMANT as of
  2026-07-13. Returns HTTP 403 on all serverless requests, confirmed via
  direct fetch on a real cert, the bare path, and an arbitrary fake cert
  number (identical 403 on all three) — this is WAF/bot protection on that
  specific path, not a per-cert validity signal, and not simply an in-session
  rate limit (fires on the very first request). `lookupCGC()` in
  `api/cgc-lookup.js` returns null on any non-200; Q106's cgc-identity path
  degrades gracefully to visual-pool identity on every scan as a result — no
  code change needed to reactivate if/when CGC's WAF stops blocking
  serverless traffic. Known risk from the original Q106 note (Vision's own
  unverified `certNumber` OCR read) still applies whenever the endpoint does
  respond.

## Workaround Active

- PriceCharting sales-history scrape (Ship #20a foundation data layer).

## Internal — under investigation

- **RESOLVED (2026-08-07, GrailKey Dispatch 23) — the `api/` 14-vs-12 gap flagged in Dispatch 18.** See CLAUDE.md's Architecture section's "Vercel function cap" line for the full resolution: this project is on Pro or higher, not Hobby, and there is no function-count cap. Kept here as a pointer since this is where the original open question was recorded.
- **`cv-lang-gate` passes foreign volumes through while reporting a filter
  (found 2026-08-07, GrailKey Dispatch 05, Jetsons #10 class) — logged
  only, NOT fixed.** `api/enrich.js:728-742` filters ComicVine volume
  candidates by testing `vol.name` (the volume's own title string) against
  a literal language-keyword regex
  (`/\b(german|deutsch|french|français|spanish|español|italian|italiano)\b/i`).
  A real production scan matched `comicvine.matched = "Die Jetsons #10"`
  (`vol_id=146851`, publisher "Neuer Tessloff Verlag" — a German imprint)
  through this gate untouched: `[cv-lang-gate] 1 → 1 volumes (non-English
  filtered)`. The volume's own title is "Die Jetsons," not "German
  Jetsons" or similar — the regex checks for the literal NAME of a
  language, not any actual language/locale signal, so a foreign edition
  whose title is simply translated (not annotated with its language)
  never matches and survives. Compounding: the log fires whenever
  `langFiltered.length > 0` (`api/enrich.js:737`), with no check that
  anything was actually removed — `beforeLang=1, after=1` (zero
  candidates dropped) still prints "(non-English filtered)," so the log
  line itself is misleading evidence of a working filter even on a
  complete no-op pass. No damage in the case that surfaced this — a
  downstream, independent gate (`[ship28b-conflicts]`, `PUBLISHER_MISMATCH`
  + `YEAR_DRIFT`) caught the resulting publisher/year contradiction and
  suppressed the story — but the language gate itself is not doing what
  its own log line claims. Not yet fixed — needs a real language/locale
  signal (ComicVine's volume or issue payload, if one exists beyond the
  title string) rather than a keyword match against translated titles,
  and the log line should only claim "(non-English filtered)" when
  `langFiltered.length < beforeLang`.
- **GitHub→Vercel auto-deploy not firing (2026-07-16)** — two consecutive
  pushes to `main` (`58009cb`, `d03d5bf`) produced zero Vercel deployment
  activity, confirmed via the Vercel API (`list_deployments`,
  `get_project.latestDeployment`), while `git fetch` independently confirmed
  both commits genuinely reached `origin/main`. Production was still serving
  `4c74677` as of this note. Root cause not yet identified — needs a check of
  GitHub's webhook delivery log (repo Settings → Webhooks → Recent
  Deliveries) or the Vercel project's Git integration settings, neither of
  which was reachable from the available tooling at investigation time.

  **Note (2026-08-23):** every push since this note (through `a8dcdca`) has
  auto-deployed correctly — this specific 2026-07-16 incident has not
  recurred, but its root cause was never identified, so it's left open
  rather than closed on the strength of non-recurrence alone.
