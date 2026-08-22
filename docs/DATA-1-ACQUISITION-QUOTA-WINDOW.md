# DATA-1 Foundation, Task 0b — Metron Sustained Quota Window: Real Semantics

**GrailKey Dispatch 2026-08-22 (DATA-1 Foundation).** The DATA-0E-FULL
acquisition crawl (`C:\grailkey-data\data-0e-full\acquire.mjs`, PID 21828
at the time of this investigation) self-throttled its own request volume
against a 3,500/day budget by resetting a counter to zero at each UTC
midnight and sleeping until the next one when the counter was spent. That
scheme assumed Metron's own "sustained" (5,000/day) server-side limit
resets on the same fixed UTC-midnight boundary. This document records why
that assumption was wrong, the real evidence gathered instead, and the fix.

## The assumption, and why it mattered

If the crawl's local day-block resets at a fixed UTC midnight but the
provider's true window is something else (rolling, or offset from UTC),
two consecutive local day-blocks separated by less real wall-clock time
than the provider's own true window could together exceed the provider's
real limit — risking a burst of `429`s partway through the second block.
At the crawl's actual pace (3,500 requests × 3.5s ≈ 3.4 hours of active
fetching, then ~20.6 hours idle until the next UTC midnight), the active
window in each day-block is well short of a full 24 hours — exactly the
shape that would expose a rolling-vs-calendar mismatch, if one exists.

## Evidence gathered, in order

**1. Metron's own published documentation** (`https://metron-project.
github.io/blog/api-best-practices`, fetched live):

> "The API enforces two independent throttle windows per authenticated
> user": **Burst** — 20 requests/minute — and **Sustained** — 5,000
> requests/day.

Documented response headers (quoted verbatim from the page's own
example):

```
X-RateLimit-Burst-Limit: 20
X-RateLimit-Burst-Remaining: 17
X-RateLimit-Burst-Reset: 1712876543
X-RateLimit-Sustained-Limit: 5000
X-RateLimit-Sustained-Remaining: 4983
X-RateLimit-Sustained-Reset: 1712966400
```

> "The `*-Reset` value is a Unix timestamp indicating when the window
> resets." … "Read these headers before every request and pause if
> `*-Remaining` reaches zero, rather than sending requests until you
> receive a `429 Too Many Requests` response." … "A `304 Not Modified`
> response still counts as a request against both the burst and
> sustained limits." … "`429` — Rate limit exceeded — Wait for the
> `*-Reset` timestamp before retrying."

The page does **not** explicitly state calendar-day vs. rolling-window
semantics in prose. But its own example value is suggestive: converting
`X-RateLimit-Sustained-Reset: 1712966400` gives **`2024-04-13T00:00:00.000Z`
— an exact UTC midnight.** Taken at face value, this looked like it might
confirm the calendar-day assumption. It does not — see below.

**2. A live, single-request header probe** (`probe-rate-limit-headers.
mjs`, one request, run separately from the crawl, costing 1 request
against the same shared 5,000/day token — a deliberate one-time cost for
real evidence, not a recurring one). Run at `2026-08-22T06:29:43Z`:

```
x-ratelimit-burst-limit: 20
x-ratelimit-burst-remaining: 4
x-ratelimit-burst-reset: 1787380187      ->  2026-08-22T06:29:47Z
x-ratelimit-sustained-limit: 5000
x-ratelimit-sustained-remaining: 3437
x-ratelimit-sustained-reset: 1787453391  ->  2026-08-23T02:49:51Z
```

**This is the deciding evidence.** `2026-08-23T02:49:51Z` is **not** a
UTC midnight, not any other obviously-fixed clock boundary — it is
`~20h20m` after the probe request. The documentation's own illustrative
example (an exact midnight) was coincidental/illustrative, not a
statement of real reset semantics — the live server disagrees with it
directly.

## Conclusion: a genuine rolling 24-hour window

This is consistent with Django REST Framework's standard throttle
implementation (`SimpleRateThrottle`), which the "DRF sets Retry-After"
line in Metron's own docs already hints this API is built on: DRF's
default throttle stores the timestamp of every counted request and, on
each check, purges any older than the window duration, computing the
"reset" as **the oldest still-counted request's own timestamp plus the
window length** — a true rolling window, not a fixed calendar boundary.
The observed reset value is fully explained by this: some request from
`2026-08-22T02:49:51Z` (roughly 3.5 hours before the probe, consistent
with earlier same-day activity — the crawl's own enumeration phase, plus
manual DATA-0D/0E-PILOT work from this same token) is the oldest one
still inside the provider's trailing-24h count, and will itself age out
at `2026-08-23T02:49:51Z`.

**This refutes the crawl's original UTC-midnight day-block design.**

## An additional finding from the same probe

At probe time, `sustained-remaining` was **3,437** — already below the
crawl's own planned 3,500-per-fresh-day budget. Under the old scheme, a
UTC-midnight reset would have reset the crawl's LOCAL counter to zero and
let it attempt up to 3,500 more requests from that moment, even though
the server's real remaining capacity at that instant was only 3,437 —
guaranteed to produce a `429` partway through, on top of the
window-alignment defect above.

## Fix, two independent, cooperating layers (implemented in `acquire.mjs`)

1. **Primary, authoritative gate**: every response's own
   `X-RateLimit-Sustained-Remaining` / `X-RateLimit-Sustained-Reset`
   headers are read and cached. Before every request, if the cached
   remaining count is below a safety floor (100), the crawl sleeps until
   the cached reset timestamp plus a 5-minute clock-drift buffer. This is
   correct under *any* window semantics the provider actually uses,
   because it never reconstructs their algorithm — it reads their live
   answer directly.
2. **Secondary, voluntary gate**: a genuine rolling 24-hour request log
   (pruned of anything older than 24h on every check) self-caps this
   crawl's own footprint at 3,500 requests in any trailing 24h window —
   preserved specifically to leave real margin under the provider's hard
   5,000 cap for incidental non-crawl usage of the same token (this
   investigation's own probe request is exactly such a case). Correctly
   rolling now, not a day-block, so it cannot itself reintroduce the
   boundary-overlap bug it replaces.

Whichever gate demands the longer wait governs. Long waits are chunked
(max 30 minutes per sleep) so the standing abort-on-Metron-export
sentinel is still checked responsively during a multi-hour wait, not just
once at the start of it.

## Why this required a restart, not a hot config reload

This is a change to the crawl's own throttling **algorithm** (day-block
counter → rolling-window/server-truth gate), not a data value the running
process re-reads from a config file each day. The running process (PID
21828 at investigation time) had no mechanism to hot-swap its own control
flow. A restart was therefore required — done immediately, while today's
first UTC-midnight boundary (where the original defect would first have
fired) was still hours away, rather than waiting for that boundary to
arrive under the old, known-defective logic. The restart is safe by the
crawl's own resumable design: the checkpoint (candidate IDs, results,
enumeration progress) is untouched by this change and the new code
resumes from exactly where the old process left off, losing at most the
one in-flight request.

## Known, bounded transient from the upgrade

The new rolling-window request log (`requestTimestamps`) starts empty on
first load of an old-shape checkpoint — it has no memory of the ~230-ish
requests the crawl already made earlier in the same UTC day before this
fix. This is a one-time, self-correcting undercount, safe because (a) the
PRIMARY gate (server-reported remaining) is authoritative regardless of
what the local log remembers, and (b) the 1,500-request margin between
the self-imposed 3,500/day budget and the provider's real 5,000/day cap
comfortably absorbs an undercount of this size.
