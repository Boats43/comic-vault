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

**Blocked this pass — reported honestly, not inferred.**

Attempted: `npx vercel@latest whoami` → `Logged out`. No interactive
`vercel login` is possible from this environment. No MCP tool available
in this session exposes environment-variable listing (`get_project`
returns project/deployment metadata only, no env vars). Per this pass's
own instruction, the stale, pre-Neon `.env.production` snapshot (dated
2026-08-09, zero `GRAILKEY_*` entries) is explicitly NOT treated as
evidence of Production's real current state — it is noted only as
context that existed before this investigation, not as a substitute for
it.

**Fail-closed behavior IS verified** (code trace + the H2 live tests
above): if either `GRAILKEY_SESSION_SECRET` or
`GRAILKEY_CATALOG_DATABASE_URL` is missing or too weak in a real
deployment, all three endpoints (`api/auth-login.js`, `api/assets.js`,
`api/asset-media.js`) already catch the resulting error in a generic
handler and return `{error:'Internal error'}` with HTTP 500 — no stack
trace, no secret value, reaches the caller. This was true before this
pass and is unchanged by it; the new secret-strength floor makes the
failure trigger a bit earlier (a WEAK secret now also fails closed, not
just a MISSING one) but the response shape is identical either way.

### Jimmy's exact env-var checklist (Vercel dashboard → Project →
### Settings → Environment Variables → Production)

Confirm ALL of the following are set for **Production** specifically
(Preview/Development having them is not sufficient):

- [ ] `GRAILKEY_SESSION_SECRET` — a random string, **32+ characters**
      (the code now enforces this floor; anything shorter fails closed
      at request time, not at deploy time). Generate one with, e.g.:
      `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
- [ ] `GRAILKEY_CATALOG_DATABASE_URL` — the Neon Postgres connection
      string for the `data1_dev`-equivalent Production schema (or
      whatever schema DATA-1's own Production cutover ultimately
      targets — this pass does not change which schema is live).
- [ ] (If DATA-1's Production storage driver differs from local
      `localfs` — check `src/modules/media/` for which driver is
      selected in a Vercel/serverless context) any storage-specific
      credentials that driver requires.
- [ ] After setting/changing any of the above, a new deployment is
      required — Vercel does not hot-reload env vars into already-running
      function instances.

**Once confirmed:** re-run this checklist's result back into
`docs/PATTERN-LIBRARY.md`'s GK-164 entry as a dated confirmation line,
the same discipline every other environment-gate finding in this repo
follows.

---

## H6 — Preview before production

**Blocked this pass, same root cause as H5** — no authenticated Vercel
CLI session, so `vercel deploy` (preview target) cannot run from this
environment, and this pass does not push to any branch (main or
otherwise) to trigger an auto-preview, since the top-level instruction
for this pass is DO NOT PUSH without qualification.

**Once H5 is resolved (Jimmy logs in via `vercel login` or provides a
token), the concrete next step is:**
```
vercel link            # confirm this links to the existing comic-vault project
vercel deploy          # preview target (no --prod flag)
```
then run the login → asset metadata → asset-media round-trip against
the resulting preview URL before any push to `main`. Production
scanner/capture wiring stays forbidden regardless of preview outcome,
per this pass's own standing instruction.

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
- `docs/TICKET-REGISTRY.md` — GK-164 entry (OPEN).
- `docs/adr/DATA-1D-CORRECTION-PASS.md` — this document.

Not committed (local scratch, outside the repo, same precedent as every
other DATA-1x proof script): `rotate-operator-credential.mjs`,
`verify-rotation.mjs`, `verify-epoch.mjs`, `verify-weak-secret.mjs`,
`OPERATOR-PASSPHRASE-CURRENT.txt` — all under `C:\grailkey-data\data-1\`.
