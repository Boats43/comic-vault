# DATA-1D — Correction Pass (Credential Incident + Session Hardening)

**GrailKey Dispatch 2026-08-23, DATA-1D correction pass.** Governed by
`ADR-AUTH-001`, `GK-151`, `GK-164`. **Committed locally, NOT pushed —
H5/H6 (Production environment verification, Preview deploy) remain
blocking.**

**Incident record, exact wording per Jimmy's ruling on H1:** *a
credential disclosure occurred during DATA-1D development, was detected
pre-push, rotated, scrubbed, and the affected unpublished commits were
rewritten.*

---

## H1 — Credential incident hygiene

**Finding.** The original `docs/adr/DATA-1D-AUTH-CROSS-DEVICE.md` (T1)
printed Jimmy's real operator passphrase in cleartext as part of its own
design narrative, in a local commit never pushed to `origin`.

**Reach, checked not assumed.** `git fetch origin` + `git log
origin/main..HEAD` confirmed the disclosing commit was LOCAL ONLY —
`origin/main` was at `083c8ff` throughout. The disclosure never reached
the remote, GitHub, or any deploy.

**Secret sweep.** `git log -S "<the disclosed passphrase>" --oneline
--all` across every local branch: exactly one hit — one file, one
commit. Working tree and staging area also checked (`git status`, `git
diff --cached`) — clean. No second disclosure site found.

**Rotation — done, proven, not merely claimed.** A local, uncommitted
script (`C:\grailkey-data\data-1\rotate-operator-credential.mjs`,
mirrors `set-operator-credential.mjs`'s own precedent) generates a new
24-byte-random passphrase INSIDE the script itself — never as a CLI
argument, never printed to stdout/stderr — and writes it via the real
`upsertCredential` path against the live `data1_dev`
`principal_credential` row. Verified directly against the real DB,
values never displayed: the disclosed old passphrase now returns
`INVALID_CREDENTIAL`; the new one issues a real, correctly-signed token.
New value stored ONLY at
`C:\grailkey-data\data-1\OPERATOR-PASSPHRASE-CURRENT.txt` — outside the
repo, never displayed in any report/log/test/doc.

**History rewritten, per Jimmy's explicit ruling.** The local branch was
rebuilt as `083c8ff → DATA-1D (scrubbed) → correction pass` — the
disclosing commit and the first correction-pass commit built on top of
it are both superseded local history, never pushed, and the cleartext
credential appears in NEITHER commit that will ever be pushed. Built via
`git commit-tree` against a scratch index (never touched the working
directory or the real index mid-rewrite) — the scrubbed `DATA-1D` commit
is byte-identical to the original except the one file's two disclosure
lines, replaced with neutral, non-forward-referencing text (it reads as
though it always said this, not as a redaction notice). No `git reflog
expire`/`git gc` run — the superseded commits remain locally reachable
via reflog if ever needed; expiring them is a separate authorization,
not exercised here (the credential is rotated; the local remnants are
inert). Full rewritten-stack census in the companion report.

**Standing rule added to CLAUDE.md** (Secret Hygiene, P0 PROTOCOL) —
secrets never appear in reports, logs, commits, tests, or docs; state
where they live, never what they are.

**GK-164: CLOSED.** Disclosure detected pre-push, credential rotated,
history rewritten, hardening shipped (H2, below). H5/H6 are tracked
separately — they gate the push of this entire lane, not this ticket's
own scope.

---

## H2 — Session security proof

All eight items audited against the real code, four required a fix,
all four proven live against the real dev DB (not just read as code):

| Requirement | Status | Evidence |
|---|---|---|
| Pinned signing algorithm | Already correct | `createHmac('sha256', ...)` hardcoded — no `alg` claim in the token for an attacker to redirect, unlike JWT's classic alg-confusion class. |
| Cryptographically strong production secret | **Fixed** | `token.js`'s `secret()` now refuses to sign/verify under a `GRAILKEY_SESSION_SECRET` shorter than 32 chars — fails closed, error message never includes the value. Proven live against a deliberately weak secret. Current dev secret is 96 chars (length checked, value not read into this report). |
| Explicit iat/exp, bounded TTL | Already correct | Payload carries `{principalId, iat, exp, epoch}`; 12h fixed TTL, no rotation/refresh — unchanged, already proven in the original T4 proof. |
| Signature verified before claims trusted | Already correct | `verifyToken` computes and constant-time-compares the signature BEFORE ever parsing the payload JSON — a forged payload never reaches `JSON.parse`. |
| Constant-time credential/signature comparison | Already correct | `credentials.js`/`token.js` both use `timingSafeEqual`; the length pre-checks that gate it compare only fixed-size (non-secret-dependent) lengths, not secret content. |
| Random scrypt salt, recorded cost parameters | **Fixed** | Salt: `randomBytes(16)`, already correct. Cost parameters (`N=16384, r=8, p=1`) were previously node:crypto's own IMPLICIT defaults — now named constants in `credentials.js`, explicit and reviewable in a diff rather than silently whatever a future Node runtime defaults to. Functionally identical hash output today; the fix is provenance, not behavior. |
| Zero secret logging | Already correct | Grepped `src/modules/auth/` + the three new `api/*.js` files for any `console.*` referencing passphrase/token/secret/hash/salt — clean. The two existing `console.error` calls in `auth-login.js` log only typed-error `.message` text. |
| Session-epoch/version mechanism | **Built new** | `GRAILKEY_SESSION_EPOCH` (env var, defaults `'1'`) embedded in every issued token; `verifyToken` rejects any token whose `epoch` doesn't match the current value. Bumping the env var invalidates every outstanding token immediately, independent of `GRAILKEY_SESSION_SECRET` rotation — closes the real gap H1 exposed (rotating the passphrase alone does nothing to a token already issued, since tokens are signed by a separate secret). Proven live: epoch-1 token verifies under epoch 1, is rejected the instant the epoch bumps to 2, and a fresh epoch-2 token verifies under epoch 2 (then the same again for 2→3). |

No roles/registration framework added — out of scope, matches T1's own
explicit "what is NOT built" list.

---

## H3 — Login abuse boundary

`api/auth-login.js` already reuses `api/rate-limit.js` — the same
sliding-window limiter (30 req / 10 min per key+IP) `api/enrich.js`
uses — checked before the passphrase comparison runs at all.

**Evidence-chosen: reused as-is, not modified.** The rotated passphrase
carries ~192 bits of entropy (24 random bytes, base64url). At any
request rate a single IP could plausibly sustain against a public
endpoint, brute-forcing that keyspace is not a realistic threat — the
limiter's real job here is blunting scripted credential-stuffing/DoS
noise, which the existing, already-proven mechanism does. Building a
second, login-specific limiter would be new half-built infrastructure
solving a problem the entropy budget already solves — the same
"reuse over rebuild" discipline T3 itself used when it first wired this
endpoint up. No auth SaaS; the boundary stays fully replaceable.

---

## H4 — Authorization semantics, temporary policy

`ADR-AUTH-001` (Rulings 12–15, 36) and `GK-151`'s own registry line
already state this explicitly: the current single-shared-owner-check
model (`assertPrincipalOwnsAsset`) is "acceptable today, as a
single-operator prototype under Jimmy's own sole use. Categorically
unacceptable the moment a second real user exists." `GK-151` stays
`PARTIALLY-SATISFIED`, never `CLOSED`, until Ruling 13's full four-step
chain (authenticated principal → authorized asset → authorized
marketplace account → authorized mutation) is built and enforced.

This correction pass adds no new authorization code and changes no
ticket status — it only makes this cross-reference explicit here, so a
reader of the correction pass doesn't have to already know to look in
the ADR. **Restated for this doc specifically:** owner-only is this
lane's CURRENT single-principal policy, not permanent GrailKey law.
Custodian, delegate, org, and operator authority remain distinct
concepts under `ADR-AUTH-001` and are deliberately unbuilt, not
rejected.

---

## H5 — Production environment gate

**RESOLVED (2026-08-23, same day, after Vercel CLI login) — verified by
real tooling, not inferred, values never displayed.**

`vercel env ls production` / `vercel env ls preview` (the CLI's own
listing, values always shown only as `Encrypted`) confirmed, before any
change: **zero** `GRAILKEY_*` variables existed in either environment —
this matched, and for the first time actually PROVED rather than merely
echoed, the stale `.env.production` snapshot's implication.

**Added, per Jimmy's ruling:**
- `GRAILKEY_CATALOG_DATABASE_URL` — the real `data1_dev` Neon connection
  string, the SAME value in Production and Preview. Rationale on record:
  the milestone proof needs real assets, the deployed surface is
  read-only (no production capture/write path exists yet), and
  `data1_dev` is the designated proving ground. **Open item, logged
  (`GK-164` update, `docs/TICKET-REGISTRY.md`):** the production-capture
  era revisits DB promotion vs. a true, separate branch — an existing
  reserved decision, not reopened by this pass.
- `GRAILKEY_SESSION_SECRET` — freshly generated (48 random bytes,
  base64url, well above the 32-char floor), **a DIFFERENT value in each
  environment.** Rationale: Preview and Production must never share a
  signing secret — a token minted under a Preview login must never
  verify against Production, and vice versa. Sharing one secret would
  make Preview (generally more exposed, more people can trigger deploys
  of it) a backdoor into Production session forgery.
- `GRAILKEY_SESSION_EPOCH` — explicitly set to `1` in both (explicit
  beats an unstated default, even though the code's default is already
  `'1'`).

All added via `vercel env add <name> <env> --value "$(...)" --yes`,
value piped from a local scratch file that was deleted immediately
after — never printed in any command text, log, or report.

**Re-run H5 table — all ✅, both environments, names only:**

| Var | Production | Preview |
|---|---|---|
| `GRAILKEY_SESSION_SECRET` | ✅ present | ✅ present |
| `GRAILKEY_CATALOG_DATABASE_URL` | ✅ present | ✅ present |
| `GRAILKEY_SESSION_EPOCH` | ✅ present | ✅ present |

**Fail-closed behavior confirmed live, not just by code trace** — see
H6's asset-media result below: a real missing-driver failure on Preview
produced a clean `{error:'Internal error'}` 500, with the real cause
(`no object at localfs://...`) visible only in Vercel's own server-side
runtime logs, never in the HTTP response.

---

## H6 — Preview before production

**STATUS: PREVIEW AUTH/ASSET PROOF PASS — FULL MEDIA ROUND-TRIP BLOCKED (GK-166), first pass.**
Relabeled per the consolidated pre-push pass instruction. See "GK-166
infrastructure update" below for what has since changed — the label
above records the state of the FIRST full round-trip specifically; it
is superseded by that update, not deleted, so the record of what was
actually observed at each point in time stays intact.

**Deployed and round-trip tested (2026-08-23).** A pre-existing,
unrelated build-tooling gap was found and fixed first:
`scripts/inject-build-id.js` shelled out to `git rev-parse` to stamp a
build ID, which fails in Vercel's remote build container for a local
CLI `vercel deploy` (no `.git` directory uploaded, unlike a
git-triggered build) — fixed with a fallback to
`VERCEL_GIT_COMMIT_SHA`, committed separately (`2396c56`, unrelated to
the DATA-1D auth lane, not folded into GK-164).

**Preview URL:** `https://comic-vault-hbd5y7p2u-boats43s-projects.vercel.app`
(deployment `dpl_5X6hu8SNMnPJwB9baRkjHW3Zvb7x`, stack
`083c8ff → d61f9ea → 5056fe0 → 2396c56`, READY).

Note: this project has Vercel Deployment Protection enabled on Preview
(an SSO wall in front of every route, including API routes) — bypassed
for testing via a temporary shareable-access cookie
(`get_access_to_vercel_url`), 23h TTL, unrelated to the app's own auth.

**Full round-trip, real HTTPS requests against the live Preview URL:**

| Step | Result |
|---|---|
| Login, wrong passphrase | `401 {"error":"Invalid credentials"}` ✅ |
| Login, correct passphrase | `200`, real token (186 chars), real `expiresAt` ✅ |
| Login, rate-limit boundary | `x-ratelimit-remaining` counted down request-by-request to `0`; requests 30–33 all `429 Too Many Requests` ✅ |
| Authenticated asset list | `200`, 54 real assets (Jimmy's real `data1_dev` collection) ✅ |
| Authenticated asset fetch (real asset, title "creepy") | `200`, real identity/valuation/decision graph, media `object_uri` correctly rewritten to `/api/asset-media?...` ✅ |
| Asset-media, UNAUTHENTICATED | `401 {"error":"Missing, invalid, or expired token"}` — before storage is ever touched (C1, proven live) ✅ |
| Asset-media, AUTHENTICATED | `500 {"error":"Internal error"}` — see below |

**The one incomplete step, root-caused via real Vercel runtime logs
(not guessed):** `[asset-media] unexpected error: no object at
localfs://sha256/87/872c...` — the media STORAGE layer has no working
driver in Preview/Production. `localfs` (this repo's only
dev/test-proven driver) resolves its root to a local Windows path that
obviously doesn't exist on Vercel's serverless filesystem; the
`vercel-blob` driver exists in code but has never been provisioned
against a real Blob store (matches the pre-existing `m4-media-proof.mjs`
gate M4-6, `BLOCKED-ON-PRIMARY-PROVISIONING`). **This is NOT a DATA-1D
auth defect** — authorization correctly ran and passed BEFORE the
storage call, matching C1's designed order exactly; the failure is one
layer downstream, in a different subsystem (DATA-1C media), and fails
closed just as cleanly (generic 500, no stack trace, no secret,
confirmed via Vercel's own runtime logs showing the real cause
server-side only). Logged as `GK-166` (new), not fixed here — needs its
own provisioning decision (a real Vercel Blob store + token) before any
Preview/Production media-byte round-trip can pass.

**Verdict: the auth mechanism itself — login, rate-limiting, DB-backed
per-principal authorization, and the C1 authorize-before-storage
guarantee — is now proven live on a real Vercel deployment, not just
locally.** Media BYTE retrieval is blocked by a separate, pre-existing,
now-disclosed storage-provisioning gap (`GK-166`), unrelated to this
lane's own scope.

Still not pushed to `main`. This round-trip result is the basis for the
next push ruling.

### GK-166 infrastructure update (same day, consolidated pre-push pass)

A real, private Vercel Blob store is now provisioned and connected to
Preview/Production (`BLOB_READ_WRITE_TOKEN` set in all three
environments); `MEDIA_STORAGE_DRIVER=vercel-blob` set in Preview/
Production. A real bug in `driver-vercel-blob.js`'s own "already
exists" recovery path was found and fixed (a placeholder objectUri
scheme that was never valid input to `head()`). `m4-media-proof.mjs`'s
M4-6 gate — the same round-trip/immutability/hash-mismatch
storage-contract suite already proven against `localfs` — now also
passes (10/10) against the LIVE Blob store. Full detail:
`docs/TICKET-REGISTRY.md`, "GK-166."

**What this does NOT yet close:** GK-166 itself stays OPEN. The
instruction's own bar is a genuine NEW capture — real comic, real
photograph — through the internal capture integration, landing in
Blob, retrieved byte-identical through the live Preview's authenticated
`asset-media` endpoint. That step needs a real photo file, which this
environment cannot supply itself (no camera, no verified-provenance
photo of an actual physical book reachable locally) — asked Jimmy
directly rather than substituting a found file of unknown provenance,
per the instruction's own explicit fallback.

**A related, real gap found and logged while closing M4-6, not yet
hit in production:** `GK-167` — driver selection
(`src/modules/media/index.js`) is global (`MEDIA_STORAGE_DRIVER`), not
per-object (based on the `object_uri` scheme already stored on a
row) — switching the driver, as this update just did, means every
row written under the OLD driver (every existing `localfs://...` media
row) would fail to read through the new one if fetched. New captures
going forward are unaffected (written and read under the same active
driver) — including the one this ticket's own closing proof will
create — but this is a real production-readiness gap worth fixing
before any broader cutover. Not fixed this pass; log-only.

---

## H7 — GK-138 + full regression

See the companion report for exact pass/fail counts from this session's
run. Summary of what was exercised:

- **Real-handler smoke, all three endpoints**, against the live
  `data1_dev` DB (not mocked) — login success, login failure (wrong
  passphrase), login under the existing rate limiter's boundary,
  authenticated asset fetch (owned + cross-principal-404 + no-token-401
  cases), unauthenticated media rejection (401 before storage is ever
  touched, matching C1's original proof shape).
- **New this pass:** the session-epoch revocation proof and the
  weak-secret fail-closed proof (both above, H2) — genuinely new
  coverage, not present in the original T4 proof, because the mechanism
  itself is new.
- `tests/auth-module-boundary.test.js`,
  `tests/assets-module-boundary.test.js`,
  `tests/media-module-boundary.test.js`,
  `tests/capture-module-boundary.test.js` — re-run.
- `npm run build` — re-run.
- Full unfiltered `tests/*.test.js` sweep — re-run, compared against the
  CLAUDE.md-documented baseline; results in the companion report.

---

## H8 — Milestone status

**DATA-1D = MECHANISM-PASS / PHYSICAL-CROSS-DEVICE-PENDING.**

Session security, credential hygiene, and the auth mechanism itself are
now proven end-to-end against real code and a real database, including
the two new hardening mechanisms this pass added (session epoch,
secret-strength floor). What remains genuinely unproven is the same
thing the original DATA-1D dispatch already disclosed: a literal second
physical device.

### The exact phone procedure (once H5/H6 clear and this is pushed)

1. Jimmy approves and this commit (and the correction commit on top of
   it) get pushed to `main`.
2. Confirm the Production env-var checklist above is complete — if not,
   every step below will 500.
3. **From the phone**, independently: `POST
   https://comic-vault-rouge.vercel.app/api/auth-login` with `{
   "passphrase": "<the current rotated passphrase, read from
   C:\grailkey-data\data-1\OPERATOR-PASSPHRASE-CURRENT.txt on the
   desktop — typed in on the phone directly, NEVER copied/shared as a
   token or screenshot between devices>" }`. This must be a fresh login
   the phone performs itself — not a token copied over from desktop.
   Record the returned `token` value (on the phone only) and the
   `gkAssetId` you intend to check.
4. `GET /api/assets?gkAssetId=<id>` from the phone, using the phone's
   OWN token in the `Authorization: Bearer` header. Record the
   `currentIdentityAssignment.id` and the `media[0].id` (rewritten
   `object_uri` path) from the response.
5. `GET /api/asset-media?mediaId=<id>` from the phone (same header) —
   either via a raw HTTP client or an `<img src>` with the header
   attached. Record: does the real photo render, and its byte length
   (visible via the HTTP response's `Content-Length` if your client
   shows it, or by saving the file and checking its size).
6. **Independently, from the desktop**, using a SEPARATE login (do not
   reuse the phone's token): repeat steps 3–5 for the identical
   `gkAssetId`/`mediaId`. Record the same three data points.
7. **Milestone Ten closes when, and only when:** the
   `currentIdentityAssignment.id` matches between phone and desktop, the
   `media[0].id` matches, and the retrieved photo's byte length matches
   — two independently-authenticated sessions, two physically separate
   devices, identical persistent state. Report back what you saw on
   each device (id values and byte length are fine to report; the
   passphrase and any token values are not — Secret Hygiene applies to
   this report too).

---

## Files touched this pass

- `src/modules/auth/token.js` — session epoch, secret-strength floor.
- `src/modules/auth/credentials.js` — explicit scrypt cost parameters.
- `CLAUDE.md` — new Secret Hygiene standing rule + Pattern Library index
  line.
- `docs/PATTERN-LIBRARY.md` — GK-164 full writeup.
- `docs/TICKET-REGISTRY.md` — GK-164/165/166 entries.
- `docs/adr/DATA-1D-CORRECTION-PASS.md` — this document.
- `docs/adr/DATA-1D-AUTH-CROSS-DEVICE.md` — scrubbed (part of the H1
  history rewrite, not a normal edit — see H1 above).
- `scripts/inject-build-id.js` — unrelated build-tooling fix, own commit
  (`2396c56`), needed to unblock the H6 Preview deploy.

Vercel project config touched (not repo files): `GRAILKEY_SESSION_SECRET`
/ `GRAILKEY_CATALOG_DATABASE_URL` / `GRAILKEY_SESSION_EPOCH` added to
Production and Preview via `vercel env add` (H5).

Not committed (local scratch, outside the repo, same precedent as every
other DATA-1x proof script): `rotate-operator-credential.mjs`,
`verify-rotation.mjs`, `verify-epoch.mjs`, `verify-weak-secret.mjs`,
`OPERATOR-PASSPHRASE-CURRENT.txt`, `find-creepy*.mjs`,
`inspect-cols.mjs`, `check-p1-and-creepy-media.mjs` — all under
`C:\grailkey-data\data-1\`.
