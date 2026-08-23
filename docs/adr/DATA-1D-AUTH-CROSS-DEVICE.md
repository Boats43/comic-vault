# DATA-1D — Principal Auth + Cross-Device Retrieval (Milestone Ten)

**GrailKey Dispatch 2026-08-23, DATA-1D.** Bounded. Governed by
`ADR-AUTH-001`, `GK-151`, and the C1 private-media law (`ADR-MEDIA-001`).

**Predecessors:** DATA-1B service (`f31810f`) · DATA-1C media, corrected
(`8638a92`) · CAPTURE-INT (`083c8ff`).

---

## SCOPE DISCLOSURE — read this before T4

**This dispatch is committed locally and NOT pushed** (per its own "ask
before push" instruction, matching every DATA-1x dispatch this session).
Two consequences worth stating plainly before the rest of this document:

1. **T3's two new public endpoints only exist in this local working
   tree right now.** They are not live at `comic-vault-rouge.vercel.app`
   until this commit is reviewed and pushed.
2. **T4's cross-device proof cannot literally be "Jimmy's phone"
   from inside this environment.** What follows IS a real, honest proof
   of the underlying mechanism — two genuinely independent authenticated
   sessions (separate logins, separate tokens, zero shared state)
   retrieving the identical real asset, ledger, and photo bytes through
   the real, unmocked handler code — run in one process on one machine,
   because that is the strongest proof available without deploying. The
   LITERAL phone test is Jimmy's own next step once this is pushed — see
   "What Jimmy does next," at the end of this document.

---

## T1 — AUTH MECHANISM, EVIDENCE-CHOSEN

**Candidates considered, real evidence per candidate:**

- **A third-party auth SaaS** (Clerk, Descope, Auth0 — the options
  `vercel:auth` actually documents for this stack). Rejected: at exactly
  ONE principal (Jimmy, `kind='operator'`, seeded by DATA-1A), with
  registration explicitly out of scope this dispatch, a hosted
  multi-tenant auth provider solves a problem (user management, social
  login, org/role admin) this system doesn't have yet — real evidence
  against needing one, not a default preference against SaaS in general.
- **A stateless, HMAC-signed bearer token** (chosen). `node:crypto`'s
  `createHmac`/`timingSafeEqual` are stdlib — zero new dependency. At one
  principal, a stateless token needs no session-store infrastructure at
  all: the token itself carries `{principalId, iat, exp}`, verified by
  recomputing the HMAC against a server-side secret
  (`GRAILKEY_SESSION_SECRET`, new required env var, added to
  `.env.development.local` — gitignored, confirmed via direct `grep` of
  `.gitignore` before writing it, never committed).

**What authenticates:** a passphrase, checked against a `scrypt`-hashed
credential (`node:crypto.scryptSync`, stdlib, memory-hard, appropriate
for one rarely-changed operator credential) stored in a new table,
`principal_credential` (`db/data0/0008_principal_credential.sql`, applied
to `data1_dev`). **Single-operator era: no username** — `login({
passphrase })` looks up the one `kind='operator'` principal
(`src/modules/auth/repository.js:getOperatorPrincipal`).

**What a session is:** a bearer token, `<base64url(payload)>.
<base64url(HMAC-SHA256 signature)>`, payload `{principalId, iat, exp}`.
Sent as `Authorization: Bearer <token>` on every authenticated request.

**Expiry/rotation:** fixed 12-hour TTL, no rotation/refresh mechanism.
Verified directly with a real, correctly-signed, deliberately-expired
token (T4's auth-rejection suite) — rejected, `401`, not a mock.

**What is NOT built (single-operator era), stated explicitly:**
- **Registration** — no endpoint creates a credential. Provisioning is a
  one-off local admin script
  (`C:\grailkey-data\data-1\set-operator-credential.mjs`, never
  committed, same precedent as DATA-1A's own `seed-principal.mjs`),
  writing directly to `principal_credential` via the module's PRIVATE
  `repository.js`/`db.js` (deliberate — `upsertCredential` has no public
  equivalent by design, matching "registration not built").
- **Multi-user login** — `getOperatorPrincipal` assumes exactly one
  `kind='operator'` row; a second one is not handled.
- **Roles/permissions** — no role concept anywhere in this dispatch.
- **Token rotation/refresh** — a token simply expires; the caller logs in
  again.

**Jimmy's real, working credential this dispatch provisioned:**
a generated (not chosen) passphrase, set via the local seed script
(`C:\grailkey-data\data-1\set-operator-credential.mjs`) — never written
to this or any other committed file. Change it by re-running the same
script with a new passphrase; there is no in-app way to change it yet,
by design.

---

## T2 — THE AUTHORIZATION CHAIN, ENFORCED IN THE SERVICE

**The bootstrap-parameter era ends.** DATA-1B's own design doc named this
gap explicitly: `assertPrincipalActive` "proves the caller supplied a
real, existing principal id; it proves nothing about whether THIS
principal is allowed to touch THIS asset." A new `assertPrincipalOwnsAsset`
(`src/modules/assets/service.js`) closes it — queries `current_owner`
(materialized since DATA-1A, rebuilt on every `ownership_event` write,
never an independent write path) and throws `AuthorizationFailedError`
when the calling principal isn't the asset's current owner.

**Threaded into every operation that touches an existing `gkAssetId`** —
12 call sites across `getPhysicalAsset`, `getMediaById` (new, T3),
`assignIdentity`, `correctIdentity`, `attachMediaMetadata`, `attachMedia`
(both its D5 preflight AND its in-transaction re-check), `transferOwnership`,
`recordAcquisition`, `recordValuation`, `recordDecision`,
`linkCollectionItem`. `resolveCollectionItemLink` gets a variant: an
unauthorized resolution returns `null` (as if the link didn't exist)
rather than throwing — a lookup must never confirm to an unauthorized
caller that a `collectionItemId` belongs to someone else's real asset.
`createPhysicalAsset` needs no check (there is no existing asset to
authorize against; the minting principal becomes the owner automatically,
via the existing `initial-mint` `ownership_event`).

**In the current single-operator era, this check always passes for
Jimmy** (he owns every asset that exists) — but it is a REAL, enforced
query against `current_owner`, never a rubber stamp, proven by what it
broke:

**Re-running DATA-1B's own S3 proof suite surfaced two real, CORRECT
behavior changes, not regressions** — verified by tracing each to its
root cause before touching anything:
- `s3-5-ownership-transfer.mjs` read the transferred asset as `jimmy`
  AFTER transferring it to `buyer` — now correctly rejected
  (`AUTHORIZATION_FAILED`), since Jimmy is no longer the owner. Fixed to
  read as `buyer` post-transfer (the new real owner) — same for two
  negative-control calls that also ran as the now-unauthorized former
  owner.
- `s3-7-event-envelope.mjs` called `transferOwnership` mid-sequence, then
  kept calling `recordAcquisition`/`recordValuation`/`recordDecision` as
  the now-former owner — correctly rejected. Fixed by moving
  `transferOwnership` to the END of the one-of-every-operation sequence.

**All 10 S3 scripts pass after these two fixes — 94 assertions, 0
failures** (re-verified as a full sweep, not assumed from the individual
fixes). DATA-1C's M4 proof (31/31) and CAPTURE-INT's P1-P6 proof (31/31,
after two re-run-robustness fixes to the proof script's own assertions —
unrelated to T2, see the "full sweep" section below) both re-run clean —
every call in both uses the SAME principal throughout (mint → identity →
media → valuation → decision, all as the minting/owning principal), so
T2's new check was never going to affect them, and re-running confirmed
that directly rather than assuming it.

**`GK-151` updated: OPEN → PARTIALLY-SATISFIED (single-operator scope),
NOT CLOSED.** Steps 3-4 of the standing four-step chain (authorized
marketplace account, authorized mutation) remain entirely unbuilt;
`api/list-ebay.js`/`api/delist-ebay.js` are untouched, still gated on the
single shared `ACCESS_CODE`. The "second real user" scenario is
untested BY CONSTRUCTION (registration isn't built) — steps 1-2 are
correct by design against `current_owner`'s real query logic, not merely
because no second user has ever actually logged in. Full wording:
`docs/TICKET-REGISTRY.md`, GK-151.

---

## T3 — THE MINIMAL AUTHENTICATED READ SURFACE

Three new `api/*.js` files (14 → 17, still no cap — Pro plan, per the
Architecture section's own already-confirmed ruling):

- **`api/auth-login.js`** — `POST {passphrase}` → `{token, expiresAt}`.
  Rate-limited via the SAME `api/rate-limit.js` mechanism `api/enrich.js`
  already uses (a real, working limiter, reused — not a new half-built
  one). Wrong credential and "no credential provisioned yet"
  (`NotProvisionedError`) both return the identical `401` shape —
  deliberately never distinguishing them to an unauthenticated caller.
- **`api/assets.js`** — `GET` (Bearer token required). `?gkAssetId=<id>`
  → one asset's full graph; no param → `listMyAssets` (new
  `src/modules/assets` operation, scoped to the caller's own
  `principalId` by construction of its SQL `WHERE`). An asset the caller
  doesn't own returns `404`, the SAME shape as a genuinely nonexistent
  one — never `403`, never leaking existence.
- **`api/asset-media.js`** — `GET ?mediaId=<id>` (Bearer token required).
  **C1, proven for real, not asserted:** authorization
  (`getMediaById`, new — checks the media row's OWNING asset, not its
  `recorded_by_principal_id`, which is provenance, not authorization)
  happens BEFORE `src/modules/media/`'s `getBytes()` ever touches
  storage. An unauthenticated fetch of a real `mediaId` returns `401`
  and never reaches the storage layer at all — proven directly (see the
  handler-smoke results below), not inferred from code review alone.

**A real, disclosed gap found and fixed while building this:** the
`media` table had never stored a content type anywhere — confirmed,
`driver-localfs.js`'s own `head()` has always returned `contentType:
null`. DATA-1C never needed one (nothing served bytes over HTTP); T3
genuinely does (a browser needs a real `Content-Type` header to render
an image). Fixed via a new additive column
(`db/data0/0009_media_content_type.sql`, applied), `attachMedia`'s
existing (already-required) `contentType` parameter now reaches one
column further — no schema redesign, no backfill of historical rows
(nullable, deliberately — guessing a value for pre-existing rows would
be a real fabrication this project's own discipline forbids).

**GK-138 (handler-wiring verification): required and performed.** Real,
unmocked handler invocations against the real `data1_dev` schema and
real `localfs` storage —
`C:\grailkey-data\data-1\data1d-handler-smoke.mjs` (local scratch, not
committed — same precedent as every DATA-1x proof script; unlike
`api/enrich.js`'s external-provider smoke tests, this repo's own DB/
storage IS the thing being proven here, so stubbing it would prove
nothing real). **19/19 assertions passing:**

```
api/auth-login.js   correct passphrase -> 200 + real token
                    wrong passphrase -> 401
                    missing passphrase -> 400
                    GET method -> 405
api/assets.js       no Authorization header -> 401
                    garbage token -> 401
                    real token + real owned asset -> 200, full graph,
                      media object_uri rewritten to /api/asset-media
                      (never a raw localfs:// URI)
                    no gkAssetId -> list-my-assets, 200, real assets
                    Jimmy fetching an asset the T3-5 buyer owns -> 404
                      (real cross-principal data, from S3-5's own
                      corrected transfer proof — never leaks existence)
api/asset-media.js  UNAUTHENTICATED fetch of a real mediaId -> 401
                      (C1 proven directly)
                    bad-token fetch -> 401
                    authenticated + authorized fetch -> 200, real bytes
                      (147 bytes — the DATA-1C substitute test photo)
```

---

## T4 — MILESTONE TEN, THE PROOF

**`C:\grailkey-data\data-1\t4-cross-device-proof.mjs`** (local scratch,
not committed). **12/12 assertions passing:**

```
Two independent sessions (separate login() calls, DIFFERENT tokens,
zero shared state) both retrieve gkAssetId 01a02c0b-50f1-7490-804f-
902cf5805176 (the real CAPTURE-INT P1 asset):
  - SAME currentIdentityAssignment.id
  - SAME valuation ledger (identical id set)
  - SAME decision ledger (identical id set)
  - SAME media row referenced
  - SAME photo bytes, byte-identical (147 bytes), retrieved through two
    independently-authenticated sessions

Auth-rejection suite (combined with T3's own handler-smoke — no
token/bad token/wrong principal already proven there):
  - a correctly-signed but EXPIRED token (real HMAC, real secret,
    exp deliberately in the past) -> 401
  - a token signed with the WRONG secret (a forged/tampered token) -> 401
```

**Honest accounting, restated:** this is the strongest proof available
from this environment — real handler code, real DB, real storage, real
independently-issued tokens — but it is one process on one machine, not
two physical devices. See "What Jimmy does next" below for the literal
phone test.

---

## FULL REGRESSION SWEEP (api/ touched → yes, per T4)

```
tests/assets-module-boundary.test.js   22/22 (was 20/20 — +listMyAssets, +getMediaById)
tests/media-module-boundary.test.js    11/11 (unaffected)
tests/capture-module-boundary.test.js   7/7  (unaffected)
tests/auth-module-boundary.test.js      8/8  (new)
service-proof/s3-*.mjs (DATA-1B)       94/94 (2 real, correct behavior
                                        changes found and fixed — see T2)
m4-media-proof.mjs (DATA-1C)           31/31 (unaffected; gate states
                                        unchanged — M4-1 still BLOCKED-
                                        ON-SOURCE-ACCESS, M4-6 still
                                        BLOCKED-ON-PRIMARY-PROVISIONING)
p1-p6-capture-integration-proof.mjs    31/31 (2 real-but-unrelated re-run-
(CAPTURE-INT)                          robustness fixes to the proof
                                        script's OWN assertions — a prior
                                        run's collectionItemId links
                                        persist in data1_dev, so a
                                        re-run's mintOutcome can
                                        legitimately be
                                        attached-existing-via-link
                                        instead of minted-new; not a T2
                                        regression, traced and confirmed)
data1d-handler-smoke.mjs (DATA-1D)     19/19 (new)
t4-cross-device-proof.mjs (DATA-1D)    12/12 (new)
npm run build                          clean
```

Node's `--input-type=module --check` run manually against all three new
`api/*.js` files (the repo's `package.json` build script's own ESM-check
list is a fixed set that doesn't auto-include new `api/` files — a
pre-existing gap, not introduced here, worth a future housekeeping pass
but out of this dispatch's bounded scope) — all clean.

---

## WHAT JIMMY DOES NEXT (the literal phone test, once this is pushed)

1. Approve and push this commit (`git log origin/main..HEAD` will show
   it — ask before push, as this dispatch's own instruction states).
2. From a phone browser (or `curl`/an HTTP client app), `POST
   https://comic-vault-rouge.vercel.app/api/auth-login` with `{
   "passphrase": "<the current operator passphrase — read it from
   wherever the local seed script last wrote it; never copy/paste it
   through a screenshot or a shared note>" }` — real header
   `Authorization: Bearer <token>` for every request after.
3. `GET /api/assets` (list) or `GET /api/assets?gkAssetId=<id>` (one
   asset) from the phone — should show the identical real data this
   dispatch's proof already retrieved from this machine.
4. `GET /api/asset-media?mediaId=<id>` from the phone (or an `<img
   src>` pointed at it with the header attached) — the real stored photo
   should render.
5. Report back what you see — that closes Milestone Ten for real, on a
   genuinely different device, which this document's own proof cannot
   claim to have done itself.

**Blocking prerequisite, checked and flagged, not assumed away:**
`GRAILKEY_SESSION_SECRET` AND `GRAILKEY_CATALOG_DATABASE_URL` (and
siblings) both need to be set in Vercel's real production environment
before ANY of this dispatch's endpoints can work live — this is also the
FIRST dispatch where any `api/*.js` file imports `src/modules/assets`/
`auth`/`media` at all (DATA-1B/1C/CAPTURE-INT built and proved these
modules real, but nothing in `api/` ever called them until now). Checked
directly: the local `.env.production` snapshot (dated 2026-08-09, before
DATA-1 existed at all — a stale pre-Neon snapshot, not a live read of
Vercel's actual current environment) has **zero** `GRAILKEY_*` entries.
This does NOT prove Vercel's real production environment is missing
them — no tool available to this session can read Vercel's live env vars
directly — but it's real evidence worth a direct check before assuming
either secret is already there. If either is missing, `api/auth-login.js`/
`api/assets.js`/`api/asset-media.js` will fail at request time (not at
build/deploy time — Vercel doesn't validate env-var presence until a
function actually runs) with a real, but confusing, 500. **Confirm both
are set in the Vercel dashboard (Project → Settings → Environment
Variables) before or immediately after pushing.**
