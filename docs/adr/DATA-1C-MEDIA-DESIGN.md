# DATA-1C — Media: The Pixels Become Permanent (Design + Build Report)

**GrailKey Dispatch 2026-08-23, DATA-1C.** Executed as PART A (the original
dispatch) AS AMENDED BY PART B (C0–C8, binding over A where they differ) AND
PART C (Outcome Ledger / Strategy commit / capture-order law — see
`docs/adr/DATA-1-OUTCOME-LEDGER-DESIGN.md`, `docs/GRAILKEY-STRATEGY.md`, and
Addition 3 below). Precedence honored: C over B over A throughout.

**Governing ADRs:** `ADR-MEDIA-001` (media table, capture roles, immutable
originals) · `ADR-STORAGE-001` (Postgres = truth, object store = pixels, KV
= cache only) · `ADR-ASSET-001` (media is evidence attached to the physical
asset).

**MODE: bounded build.** No production/scanner wiring, no UI changes, no
public upload endpoint (`GK-151` hard gate stands), no `api/enrich.js`
changes. Zero files under `api/` touched. Crawl and prior lanes untouched
except for a read-only liveness check (see CRAWL, below).

---

**CORRECTION PASS (2026-08-23, "DATA-1C REVIEW — CORE PASS, PUSH HOLD"),
applied on top of the original build described below — `4336e3e`.** Eight
findings (D1–D8), all real, all fixed or accurately relabeled in this same
correction commit:

- **D1 — M4-1 relabeled `BLOCKED-ON-SOURCE-ACCESS`, not `PASS`.** The
  original build's own "THE FIRST PERMANENT EVIDENCE" framing was wrong to
  apply to substitute bytes — that label is earned only by genuine
  historical pixels. The real, useful part of M4-1 (both `gkAsset` rows are
  real, the DB write is real, the local storage service genuinely accepted
  and round-tripped test media) is preserved and reported separately,
  never conflated with the unmet historical-pixel criterion. See the
  corrected Task 4 section below.
- **D2 — M4-6 relabeled `BLOCKED-ON-PRIMARY-PROVISIONING`, not `PASS`.**
  The adapter-swap MECHANISM and the honest-failure behavior are real and
  proven; the full storage-contract suite has not run against a live
  Vercel Blob store, so the milestone itself cannot be `PASS`. Vercel Blob
  stays a provisional-primary candidate, audited against Task 1's
  comparison table, until it actually runs.
- **D3 — C4 evidence semantics corrected.** `sha256` dedupes the STORED
  OBJECT only (`src/modules/media/`'s content addressing) — it never
  dedupes the EVIDENCE ROW. The original build's `findMediaByAssetRoleHash`
  automatically collapsed any second `attachMedia` call for the same
  `(asset, role, content)` into the existing row, which would have silently
  discarded a genuinely separate capture/evidence event (two grading
  sessions that happen to photograph the identical page are two legitimate
  rows, not one). **Removed entirely** — see the corrected Task 3 section.
- **D4 — `idempotencyKey` is now required on `attachMedia`**, and a
  request fingerprint (`sha256` of `{gkAssetId, captureRole, sha256}`) is
  stored alongside the idempotency claim and checked on every replay: same
  key + same semantic request → the original result; same key + a
  genuinely different request → a typed `ConflictError`. **Verified
  against the existing shared mechanism first, not assumed:** re-running
  `S3-9-idempotency-key-replay.mjs` confirms `checkIdempotencyReplay`/
  `claimIdempotencyKey` (`src/modules/assets/idempotency.js`) have NO
  fingerprint concept for ANY of the other 9 DATA-1B operations either — a
  real, wider gap (a replayed key with a genuinely different payload is
  silently returned as if it matched, for `recordValuation` and everything
  else), confirmed by direct evidence, not scoped or touched by this
  correction (out of bounds — this pass only fixes `attachMedia`, which is
  the one operation this dispatch itself introduced).
- **D5 — storage preflight ordering corrected.** A non-transactional
  preflight (`assertPrincipalActive` + `assertAssetExists`) now runs
  BEFORE `media.put()`; the PUT itself runs with no DB transaction open;
  the same invariants are re-run around the actual transactional write.
  Orphan-object language corrected from "harmless" to what it actually is:
  **not identity corruption, but a real storage/retention leak** — see the
  corrected Task 3 section.
- **D6 — Outcome Ledger append-only law: certified, unchanged.** See the
  "D6 certification" subsection under Addition 1 below — the excerpt
  already meets the law; nothing was changed.
- **D7 — full re-verification, corrected results below.** Re-run: syntax
  checks on every touched file, both module-boundary tests (17/17, 11/11 —
  unchanged), `S3-4-mint-idempotency.mjs` (9/9) and
  `S3-9-idempotency-key-replay.mjs` (8/8, the evidence for D4's "verify the
  existing behavior" instruction), the corrected M4 proof suite (31/31
  assertions, gate states corrected per D1/D2), and `npm run build`
  (clean).
- **D8 — checked against the real codebase, found FALSE as stated.** The
  proposed unblock path ("the app's existing 'Backup to Drive'/CSV-export
  flow serializes collection records including base64 photos") does not
  match `src/App.jsx`: `exportJSON` (line 2962), `exportCSV` (line 2974),
  and `backupToDrive` (line 2994) ALL either explicitly destructure
  `images` out of the record before serializing (`({ images, ...rest }) =>
  rest`, `exportJSON`/`backupToDrive`) or use a fixed column list that
  never includes `images` at all (`exportCSV`) — confirmed by direct
  `grep` for every `JSON.stringify(...)` call site touching `items`/`data`
  in that file; there is no other export path. **None of this app's
  current export flows include photo bytes.** Corrected in the design doc
  below: the real unblock path for genuine M4-1 does not exist in the app
  today and would need new code (a dedicated export mode that keeps
  `images`, or a direct IndexedDB read) — not a repurposing of an existing
  flow. Recorded honestly rather than silently reproducing an unverified
  claim as fact.

---

**Predecessor:** DATA-1B (`235d7a4` local, `f31810f` referenced as deployed
in that dispatch's own text). `531a2ee` (GK-162 registry log) rides this
train — both sit locally ahead of `origin/main` (confirmed:
`git log origin/main..HEAD` shows exactly `531a2ee`, one commit).

---

## C0 — PREDECESSOR PROOF (real evidence, gathered before writing any code)

Checked against the actual repo and the actual `data1_dev` database, not
against DATA-1B's own description of itself:

- **Module exists, file:line verified.** `src/modules/assets/{index,service,repository,db,idempotency,errors}.js` all present. `index.js` re-exports exactly the nine DATA-1B operations (`createPhysicalAsset, getPhysicalAsset, assignIdentity, correctIdentity, attachMediaMetadata, transferOwnership, recordAcquisition, recordValuation, recordDecision`) plus the five error classes plus `closePool` — matches the DATA-1B design doc's Section 1/2 verbatim.
- **S3-suite present.** `C:\grailkey-data\data-1\service-proof\` holds all ten scripts (`s3-1-create-reload.mjs` through `s3-10-authorization-parameter.mjs`), matching the DATA-1B slice summary's own task3 report.
- **`data1_dev` reachable, for real.** `node C:\grailkey-data\data-1\verify-pg-connection.mjs` → `PostgreSQL 18.6 (3484359) on aarch64-unknown-linux-gnu`, `uuidv7()` sample returned, non-system schemas `[data1_dev, pg_toast, public]`.
- **Live schema re-verified directly, not assumed from the 0004 draft** (same discipline DATA-1B's own repository.js header already restates): 14 tables in `data1_dev` — `acquisition_event, asset_identity_assignment, current_owner, decision_event, domain_event, entity_mint_basis, gk_asset, gk_principal, idempotency_key, media, mint_event, outbox, ownership_event, valuation_event`. `media` columns confirmed: `id, asset_id, media_type, content_hash, object_uri (nullable), local_path_placeholder (nullable, TEST-HARNESS ONLY per its own 0004 comment), captured_at, recorded_by_principal_id`.
- **Real state, not empty:** 21 `gk_asset` rows, 7 pre-existing `media` rows (all with `object_uri: null` — DATA-1B's own S3/T3 proof scripts recorded metadata only, never a real object; this dispatch's `attachMedia` is the first code path that ever populates `object_uri` for real).
- **A real, pre-DATA-1C asset for Creepy #1 (1964) confirmed:** `gk_asset.id = 01a02aae-23bc-7d51-a759-961c5ff4b4a1`, minted via `entity_mint_basis.basis_key` containing `correlationId: 3b2593e4-ed14-489f-bc6c-379bd1045f83`, a real scanlog record (`book: {title:"creepy", issue:"1", year:"1964"}`, `collectionItemId: cv_1787280644982_o2kilt`) — cross-checked against `C:\grailkey-data\data-1\real-scan-matches.json`, produced by `find-real-scan.mjs` querying the live Upstash `scanlog:` index directly. **Correction to the Part-A dispatch's own framing:** "the Sabrina and Creepy (the two real DATA-1A assets)" is not accurate as stated — Creepy #1 was a real, already-minted DATA-1A/1B asset; **Sabrina was not** (zero `sabrina`-containing `basis_key` anywhere in `entity_mint_basis`, checked directly before writing any Task 4 code). Sabrina exists only as real `scanlog:` history (35 matching records). Resolved per C6/Task 4 below by minting it for real from that real scanlog record, not by silently substituting a different already-minted book.

No preflight citation issues found this dispatch (unlike DATA-1B's own Section 0, which caught two — this dispatch's Part A/B/C text was checked against the same real ADRs cited and no fabricated ruling numbers were found).

---

## TASK 1 — VENDOR RULING, FROM REAL EVIDENCE (C7)

### 1a. Candidate comparison

| | **Vercel Blob** | **S3-compatible (R2/S3/B2)** | **Local filesystem** |
|---|---|---|---|
| Plan availability | Confirmed available — this project's team (`boats43's projects`, `team_qEx0TMOh3Wv0ugpc8mstYN0a`) is on the **Pro** plan (verified via `list_teams` MCP call, not assumed), and Vercel Blob (including the private-access beta) is documented as available without a separate plan gate for Pro. | Available (any account, no Vercel dependency) — not evaluated further this dispatch beyond noting it as the honest portability fallback (see 1b). | Always available — dev/test driver regardless of the other rulings. |
| **Provisioned today, this project?** | **No.** Confirmed by direct evidence, not assumption: `grep -i blob` across all five of this project's `.env*` files returns nothing (no `BLOB_READ_WRITE_TOKEN` anywhere); `package.json` has no `@vercel/blob` dependency; no MCP tool available to this session can create a store (`mcp__plugin_vercel_vercel__*` has no `create_store`/`buy_addon`-for-blob equivalent — `buy_addon` is SIEM-only); the Vercel CLI is not installed on this machine (confirmed by this session's own startup notice), so `vercel blob create-store` isn't runnable either. **Nothing is provisionable today without Jimmy's action** — see 1b for exactly what that action is. | N/A | Yes — used for every M4 proof this dispatch. |
| Cost at 3 photos/asset × 10K assets (~30GB-class) | Storage + operation pricing is real and documented (`vercel.com/docs/vercel-blob/usage-and-pricing`), but this session's own documentation search could not return exact current per-GB/per-operation rates with enough confidence to state a number here without risking a stale/wrong figure — flagged honestly rather than guessed (see COSTS section below for the caveated estimate that IS defensible). | Generally the cheapest at this exact scale for egress-heavy or very-large-object use (R2 in particular: zero egress fees) — not independently priced this dispatch since it isn't the ruling. | Free (local disk), not a real production option. |
| Immutability/versioning support | **Yes, natively usable for this purpose.** `put()` defaults to NOT overwriting an existing pathname (`allowOverwrite` must be explicitly set `true` to permit it — confirmed via `vercel.com/docs/storage/vercel-blob`'s own "Enable Overwriting with put()" section) — this IS a real create-if-absent primitive when combined with `addRandomSuffix:false` and a content-derived pathname, exactly what C2 asks for. | Varies by provider/config (S3 versioning, R2 conditional writes) — real but not evaluated in detail this dispatch. | `fs.open(path, 'wx')` — Node's own OS-level exclusive-create flag. Directly proven this dispatch (M4-3/M4-4). |
| URL/access model | **Private storage is real and documented** (`access: 'private'`, public beta, read back via `get()`) — satisfies C1 directly; a public-by-default store would have required the driver to explicitly reconfigure, this one doesn't need to. | Private by default (a real IAM/bucket-policy concern, provider-specific) — satisfies C1 with more setup. | Filesystem permissions only — fine for a dev/test root that's never served over HTTP. |
| Lock-in severity behind our adapter | **Low, by construction.** The adapter interface (Task 2) never leaks Vercel-specific concepts to callers — `objectUri` is an opaque string, content addressing means the SAME key-derivation logic works unchanged against any driver. Swapping the primary driver later is a new `driver-*.js` file plus one env var, not a schema or call-site change (proven structurally by M4-6). | Same low lock-in, by the same adapter design — genuinely portable BY the adapter, not because of the vendor. | N/A |

### 1b. The ruling

**The adapter makes the vendor demotable — that IS the real ruling**, per
the Part-A dispatch's own framing. Concretely, this dispatch:

- **Implements `driver-localfs.js` fully** — the only driver actually
  exercised, tested (M4-1 through M4-8, 26/26 real assertions against the
  real `data1_dev` schema), and provisioned right now.
- **Specs `driver-vercel-blob.js` fully, against verified docs, NOT
  provisioned.** Real code, matching the documented `@vercel/blob` API
  (`put`/`head`/`get`, `access:'private'`, `addRandomSuffix:false`, no
  `allowOverwrite`), dynamically imported (never a static top-level
  `import`) so `@vercel/blob`'s absence from `package.json` cannot break
  anything that doesn't select this driver. One disclosed uncertainty,
  stated in the file's own header comment: the exact error shape
  `@vercel/blob`'s `put()` throws on an existing pathname without
  `allowOverwrite` has not been confirmed against a live store (none
  exists to test against) — the driver matches defensively on error
  message text until that's verified for real, the first time it
  actually runs.
- **Recommends Vercel Blob as PRIMARY once provisioned** — evidence
  above: native to this stack, Pro plan already covers it, private
  storage satisfies C1 directly, and its default non-overwrite `put()`
  behavior IS a real create-if-absent primitive (C2) rather than
  something the driver has to fake with a check-then-write race.

**Exactly what Jimmy must click**, since nothing is provisionable from
this session: Vercel Dashboard → the `comic-vault` project → **Storage** tab
→ **Create Database** → **Blob** (or, once the Vercel CLI is installed,
`vercel blob create-store comic-vault-media --access private`) → `vercel
env pull .env.development.local --yes` to sync the resulting
`BLOB_READ_WRITE_TOKEN` locally → `npm install @vercel/blob` → set
`MEDIA_STORAGE_DRIVER=vercel-blob` in the environment that should use it.
Until then, `MEDIA_STORAGE_DRIVER` defaults to `localfs` and stays there.

**Migration story:** content-addressing does make objects portable by
construction — verified, not just asserted: the key is `sha256/<first2
hex chars>/<full hex hash>` (`src/modules/media/contentAddress.js`),
derived from the bytes alone, identical regardless of which driver wrote
it. Migrating primary driver later means re-uploading every object under
its already-known key to the new store and repointing `object_uri`
generation — no re-derivation of identity, no schema change, no call-site
change in `src/modules/assets/service.js`.

---

## TASK 2 — THE MEDIA STORAGE ADAPTER

### 2a. Module (`src/modules/media/`, mirrors DATA-1B's boundary discipline)

```
src/modules/media/
  index.js              PUBLIC — put/head/getBytes, error classes, sha256Hex/deriveKey
  contentAddress.js      PRIVATE — sha256Hex(bytes), deriveKey(hash)
  driver-localfs.js       PRIVATE — the only driver exercised this dispatch
  driver-vercel-blob.js    PRIVATE — spec'd, NOT provisioned (Task 1)
  errors.js              PUBLIC (re-exported via index.js) — MediaStorageError,
                          HashMismatchError, ImmutabilityViolationError,
                          MediaNotFoundError, NotProvisionedError
```

Enforced by `tests/media-module-boundary.test.js` (mirrors
`tests/assets-module-boundary.test.js` exactly): no file outside
`src/modules/media/` may import a private module (static + dynamic
`import()` both checked); `index.js` must re-export the real public
surface; **no delete()/del() export anywhere** (C3, checked structurally);
**no driver ever passes `allowOverwrite:true`** (checked structurally,
proves M4-3's "no overwrite path exists" claim at the source-text level,
not just by runtime behavior). **11/11 passing.**

### 2b. Content addressing + immutability

`put({ bytes, contentType, sha256 })` computes the ACTUAL hash from the
received bytes first (`contentAddress.sha256Hex`); if a caller-declared
`sha256` is present and disagrees, throws `HashMismatchError` before
touching storage at all (M4-5, proven). The key is
`sha256/<first2>/<fullhash>` — content-type is deliberately NOT part of
the key (two requests for identical bytes must resolve to the identical
object regardless of what content-type header either caller sent).
**Storing the same bytes twice is a genuine no-op** (M4-3, proven:
`created: false`, identical `objectUri` returned, zero new bytes
written). **Originals are immutable by construction, not by policy
enforcement** — no function in this module's public OR private surface
accepts an overwrite parameter at all (structurally checked by the
boundary test); a request for genuinely different bytes always resolves
to a genuinely different key (different hash), never touches the
original's key.

### 2c. Deletion — C3, the Part-A sketch removed

The Part-A dispatch's `delete({objectUri})` interface sketch is **removed
from the v1 interface**, per C3 — `src/modules/media/index.js` exports no
delete/del function of any kind (structurally verified by the boundary
test). No tombstone mechanism was built this dispatch either — the `media`
table has no status column, and nothing in `attachMedia` writes one. That
is a real, disclosed gap, not a silent claim of completion: **retention and
erasure remain entirely unbuilt, reserved for a future dedicated ADR**, as
both the Part-A dispatch and C3 specify. This dispatch only guarantees the
negative — there is no physical-delete code path anywhere in this module.

### 2d. Two drivers, same proof suite

`driver-localfs.js` and `driver-vercel-blob.js` implement the identical
`put/head/getBytes` contract. The M4 proof suite (Task 4) ran, for real,
against `driver-localfs.js` — the only one provisioned. `driver-vercel-blob.js`
was exercised only far enough to prove it's real and selectable
(M4-6: selecting it and attempting a real call fails with the honest,
typed `NotProvisionedError`, not a silent no-op or an unhandled crash) —
the adapter-swap guarantee that DOES hold today is "selecting a
different driver changes which code path runs, cleanly," not yet "the
full M4 suite passes against both," since the second driver has nothing
real to run against.

---

## TASK 3 — SERVICE INTEGRATION

`src/modules/assets/service.js` gains `attachMedia({ principalId,
gkAssetId, bytes, contentType, captureRole, idempotencyKey,
correlationId })`, re-exported from `src/modules/assets/index.js`.
`src/modules/assets/repository.js` gains one new query,
`findMediaByAssetRoleHash` — everything else in that module (nine DATA-1B
operations, the transaction/error/authorization shape) is untouched.

**C5 — the service computes the hash, not a trusted caller declaration.**
`attachMedia` computes `sha256` from the real received `bytes` via
`node:crypto` directly (a second, independent computation from the media
adapter's own internal check — defense in depth, both reading the same
real bytes) — this is the value written to `media.content_hash`, always,
never a caller-supplied value.

**CORRECTED (DATA-1C review, D3/D4) — two independent dedupe/idempotency
mechanisms, at two different layers, never conflated:**

1. **Blob-level dedupe** (`src/modules/media/`) — the SAME bytes, from ANY
   asset/role, always resolve to ONE stored object. This is a fact about
   PIXELS, not about evidence.
2. **`idempotencyKey` replay, now mandatory (D4)** — the ONLY mechanism
   that collapses two `attachMedia` calls into one `media` ROW. A request
   fingerprint (`sha256` of `{gkAssetId, captureRole, sha256}`) rides
   alongside the idempotency claim: same key + same fingerprint → the
   original result, verbatim; same key + a DIFFERENT fingerprint → a typed
   `ConflictError`, never a silent wrong-answer replay.

**Removed (D3): the original build's "evidence-row dedupe" layer**
(`repo.findMediaByAssetRoleHash`, automatically collapsing any call with
matching `(asset, role, content_hash)` into an existing row). This was a
real defect in the original design, not a style preference — it would
have silently discarded genuinely separate evidence. **Two distinct
`attachMedia` calls, under two distinct `idempotencyKey`s, for the
IDENTICAL `(asset, role, bytes)` now always produce TWO distinct `media`
rows** — proven directly by the corrected M4-4 (a "second capture event"
call with a different key creates a new row over the SAME underlying
object; blob-level dedupe stays intact even as evidence-row dedupe is
gone). `findMediaByAssetRoleHash` itself is deleted from
`repository.js`, not merely unused.

**D4 — verified against the existing shared mechanism, not assumed.**
`src/modules/assets/idempotency.js`'s `checkIdempotencyReplay`/
`claimIdempotencyKey` — the generic mechanism EVERY DATA-1B operation
uses — has NO request-fingerprint concept for any of the other 9
operations. Re-running `S3-9-idempotency-key-replay.mjs` (unmodified)
confirms this directly: step 3 sends the SAME `idempotencyKey` with a
DIFFERENTLY-valued `recordValuation` payload and receives back the
ORIGINAL (`$33.33`) value with no error and no warning — the same key
silently "wins" regardless of whether the new call's content agrees with
the old one. This is a real, disclosed, WIDER gap than `attachMedia`
alone — out of this bounded correction's scope (it would mean touching
the shared `idempotency_key` table's schema or every one of the other 9
operations, neither authorized here) — `attachMedia`'s own fingerprint
check is carried entirely inside its own `result_snapshot` JSONB, a
local fix scoped to the one operation this dispatch introduced, not a
change to the shared mechanism's contract for anyone else.

**D5 — storage I/O ordering, corrected.** `attachMedia` now runs, in
order: (1) a non-transactional preflight read
(`assertPrincipalActive`+`assertAssetExists`) BEFORE any storage I/O; (2)
`media.put()`, with NO DB transaction open at all; (3) a fresh connection
that re-runs `assertPrincipalActive` (the same "right before `BEGIN`"
convention every other DATA-1B operation already follows) and, inside the
transaction, re-verifies `assertAssetExists` again before the insert — a
genuine re-check against the window between (1) and (3), not merely
trusting the earlier read. A DB transaction is never held open across the
remote storage call.

**Orphan-object language, corrected (D5).** The original build's own
comment called an orphaned-but-unreferenced object (created if the
transactional write later fails) "harmless." That was the wrong word:
content-addressing means it's never IDENTITY corruption (the object is
still correctly addressed by its own hash; nothing is ever
misattributed) — but it IS a real storage/retention leak: bytes billed
and held with no `media` row pointing at them. **Orphan
reconciliation/GC is recorded here as pre-production media debt**, not
solved by this dispatch — a future pass needs a real answer (a periodic
sweep comparing stored keys against referenced `content_hash` values, or
equivalent), not assumed away by the word "harmless."

Every successful `attachMedia` call that actually creates a new row emits
a `media.attached` `domain_event` (Ruling 21's envelope), inside the same
transaction as the row insert — a pure `idempotencyKey` replay emits
nothing new, matching every other DATA-1B operation's own established
shape.

---

## TASK 4 — THE PROOF SUITE

Run for real against the real `data1_dev` schema via
`C:\grailkey-data\data-1\m4-media-proof.mjs` (local scratch, not
committed — matches the DATA-1A/DATA-1B/DATA-0E-PILOT precedent for proof
scripts). **31/31 assertions passing. Two of eight milestone GATES are
`BLOCKED` on an external prerequisite, not `PASS` — D1/D2, see below.**
The proof script itself now tracks a gate state per milestone, separate
from its individual assertions, specifically so a milestone with every
assertion green can still be honestly reported as blocked when what's
missing is an external prerequisite rather than a code defect.

**C6/D1 disclosure, stated plainly:** the "photo bytes" used below are an
**honestly-labeled substitute** — a well-known 1x1 public-domain PNG, with
a distinct per-book tag appended so Creepy's and Sabrina's "photos" hash
differently. **These are NOT the real Creepy #1 / Sabrina photographs**,
and the hashes below are **NOT** described as "the first permanent
evidence" (that framing was wrong in the original build — corrected per
D1). Checked directly before writing this proof: those photographs exist
only as base64 strings inside the operator's own browser IndexedDB
(`docs/DATA-1-READINESS.md`, section A1/A3) — `scanLog` records (the only
server-side trace of either scan) carry book/pricing/identity/latency
metadata and zero image bytes, confirmed by direct inspection of the real
`scanlog:` records pulled via `find-real-scan.mjs`. This server-side
environment has never had access to either photo and does not gain it by
running this proof.

```
M4-1  GATE: BLOCKED-ON-SOURCE-ACCESS (D1)  —  3/3 assertions PASS
      Both gkAsset rows are REAL: Creepy #1 (1964) pre-existing
        (01a02aae-23bc-7d51-a759-961c5ff4b4a1); Sabrina Annual Spectacular
        #1 minted for real this dispatch (01a02bd8-fd28-745d-92a5-198583e21817,
        from real scanlog correlationId 15594457-47b2-4e4e-b862-afdf576aef98).
      The real DB write and the real local storage service both genuinely
      accepted and round-tripped test media (preserved as useful proof,
      NOT relabeled as failing):
        Creepy   -> localfs://sha256/87/872c733ae1a2d2b93986eec2b274b6027b9e94aeb177f6a9f78e45c96bdf30c1  [SUBSTITUTE BYTES]
        Sabrina  -> localfs://sha256/80/80f09a065bd8cf68ac9c259ec8f81b46041666df94b805d40ba1dc183bf091da  [SUBSTITUTE BYTES]
      NOT MET: the genuine historical-pixel criterion. Both hashes above
      are substitute test bytes, explicitly not called "permanent
      evidence." See Addition D8 below for the real unblock path.

M4-2  GATE: PASS  —  2/2: retrieved bytes byte-identical to source
      (Buffer.compare === 0); re-hashed retrieved bytes match the stored
      sha256.

M4-3  GATE: PASS  —  4/4: identical re-put returns the SAME objectUri
      with created:false (no new write); genuinely different bytes land
      at a genuinely DIFFERENT key; the original object is still exactly
      the original bytes after that different put().

M4-4  GATE: PASS  —  11/11, D3/D4-corrected semantics (rewritten from the
      original build's 6/6, which tested the now-removed evidence-row
      auto-dedupe): (a) same idempotencyKey + same request -> original
      mediaId, zero new rows; (b) same idempotencyKey + a DIFFERENT
      request (different bytes) -> typed ConflictError via the request
      fingerprint, NOT a silent replay; (c) a DIFFERENT idempotencyKey for
      the IDENTICAL (asset,role,bytes) -> a NEW, legitimate row (D3 — no
      more automatic collapse), confirmed the row count grew by exactly 1;
      (d) idempotencyKey omitted entirely -> ValidationFailedError (D4 —
      now mandatory); (e) same bytes to a DIFFERENT asset, distinct key ->
      a new row over the SAME underlying object (blob-level dedupe intact).

M4-5  GATE: PASS  —  3/3: a declared sha256 that disagrees with the
      actual bytes throws HashMismatchError (typed, confirmed via
      instanceof) before anything is stored; confirmed zero rows exist
      afterward with that mismatched hash.

M4-6  GATE: BLOCKED-ON-PRIMARY-PROVISIONING (D2)  —  3/3 assertions PASS
      Switching MEDIA_STORAGE_DRIVER to 'vercel-blob' at runtime (env var
      read live, not cached) makes the NEXT call attempt the other
      driver; that attempt fails with the honest, typed
      NotProvisionedError (never a silent success or an unhandled crash);
      switching back to localfs works immediately. NOT MET: the same
      storage-contract suite has not run against a live Vercel Blob
      store — the milestone stays blocked until Task 1's PRIMARY
      candidate is actually provisioned and exercised, not merely
      selectable.

M4-7  GATE: PASS  —  11/11, tests/media-module-boundary.test.js, run
      separately, repo-tracked, no DB needed) — see Task 2a.

M4-8  GATE: PASS  —  3/3: a real media.attached domain_event row exists
      for the Creepy attach; a COLD getPhysicalAsset call (a fresh read,
      no cached state) returns the media row with the correct object_uri;
      that object_uri independently resolves via head().
```

**Gate summary:** `M4-1: BLOCKED-ON-SOURCE-ACCESS` · `M4-2: PASS` ·
`M4-3: PASS` · `M4-4: PASS` · `M4-5: PASS` ·
`M4-6: BLOCKED-ON-PRIMARY-PROVISIONING` · `M4-7: PASS` · `M4-8: PASS`.
Not claimed as "Task 4 complete" — two of eight gates remain genuinely
open on external prerequisites, per D1/D2.

---

## COSTS

**Now:** effectively $0 — `driver-localfs.js` writes to local disk
(`C:\grailkey-data\data-1\media-store\`, outside the repo), and no Vercel
Blob store is provisioned to bill against at all.

**Projected at 10K-asset scale (~30GB-class, per Task 1a's own framing):**
Vercel Blob's storage + simple/advanced-operation pricing is real and
documented at `vercel.com/docs/vercel-blob/usage-and-pricing`, but this
session's own `search_vercel_documentation` calls did not return a
current per-GB/per-operation rate table specific enough to state a
defensible number here — stating one anyway would be exactly the
"documentation assumption" C7 exists to forbid. **Honest gap, not a
guess:** confirm the current rate at that URL (or via `vercel storage`
CLI once installed) before this projection is used for any real pricing
decision. What IS defensible without further verification: at ~30GB and
a modest request volume for a single-operator prototype, this sits
comfortably inside "small enough that the exact rate rarely matters
operationally" territory for the Pro plan — the number worth getting
precisely right is the one at 100K+ assets, not 10K, and that's a
question for whenever Vertical #2 or the Long Box pilot make it real
(`docs/GRAILKEY-STRATEGY.md` §7).

---

## D6 — OUTCOME LEDGER CERTIFICATION (append-only law, verified against the real DDL)

Re-read `db/data0/0006_outcome_ledger.sql` directly against D6's own
standard before writing this section. **The law is met; nothing changed.**

```sql
CREATE TABLE outcome_event (
  event_id              UUID PRIMARY KEY,          -- uuidv7()
  gk_asset_id            UUID NOT NULL REFERENCES gk_asset(id),
  decision_event_id       UUID REFERENCES decision_event(id),
  outcome_type              TEXT NOT NULL CHECK (outcome_type IN (
                               'LISTED', 'SOLD', 'FEES_FINALIZED',
                               'FULFILLMENT_FINALIZED', 'REALIZED_OUTCOME'
                             )),
  occurred_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  ...
  ask_amount, gross_amount, fees_amount, shipping_amount, net_amount,
  days_to_sale   -- typed economic columns, every one nullable
);
```

- **No `UPDATE`/`DELETE` statement anywhere in the file** — confirmed by
  direct inspection, not assumed. `outcome_event` has no mutable-row
  update path at all; every economic fact (LISTED, then later SOLD, then
  later FEES_FINALIZED, ...) is its OWN row with its OWN `outcome_type`,
  never a field filled in on a prior row.
- **A separate, explicitly-labeled projection table**
  (`asset_outcome_current`) carries the derived "current state" —
  `PRIMARY KEY (gk_asset_id)`, one row per asset, pointing back at
  `as_of_outcome_event_id`. The file's own trailing comment states this
  is rebuilt FROM the ledger, matching `current_owner`'s already-proven
  convention in `0004_data1_foundation.sql` — never an independent write
  path.
- **LISTED/SOLD/FEES_FINALIZED/FULFILLMENT_FINALIZED/REALIZED_OUTCOME are
  represented as history** (distinct `outcome_type` values on distinct
  rows), never as progressive mutation of one row acquiring `listed_at`,
  then `sold_at`, then `fees_amount` in place — exactly the shape D6 asks
  to verify.

**Verdict: history appends; current state derives — confirmed, not
changed.** No edit made to `db/data0/0006_outcome_ledger.sql` or
`docs/adr/DATA-1-OUTCOME-LEDGER-DESIGN.md` as a result of this
certification, per D6's own instruction.

---

## D8 — THE REAL-PIXELS UNBLOCK PATH FOR GENUINE M4-1 (documented, corrected against the actual codebase)

**Checked against `src/App.jsx` before writing this section — the
originally-proposed path does not exist as described.** `src/App.jsx`
has exactly three export/backup functions that serialize the collection:

- `exportJSON` (`App.jsx:2962-2972`) — `items.map(({ images, ...rest }) =>
  rest)`. **Explicitly destructures `images` OUT** before serializing.
- `exportCSV` (`App.jsx:2974-2992`) — a fixed column list (`title, issue,
  publisher, year, grade, ...`) that **never includes `images` at all**.
- `backupToDrive` (`App.jsx:2994-3004`) — **identical** `({ images,
  ...rest }) => rest` destructure as `exportJSON`.

Confirmed exhaustive by direct `grep` for every `JSON.stringify(...)`
call site touching `items`/`data` in the file — there is no fourth export
path, and no existing flow anywhere in this app currently serializes
photo bytes out of IndexedDB. **None of this app's current export flows
include photo bytes** — the "Backup to Drive"/CSV-export route described
as the unblock path does not work as stated today.

**What a real unblock path actually requires** (not yet built, not
attempted this dispatch — MODE remains bounded build, no UI changes):

1. A new export mode (or a modification to `exportJSON`/`backupToDrive`)
   that KEEPS `images` in the serialized output — the simplest code
   change, but still a real UI-adjacent change out of this dispatch's
   bounded scope.
2. Alternatively, a direct IndexedDB read (`src/db.js`'s `comics` store)
   via a small one-off script run in the browser console or a temporary
   debug route — no `App.jsx` change needed, but requires Jimmy to run it
   himself since this server-side environment has no browser access at
   all.

**Until either exists and Jimmy provides the resulting file (or runs the
read himself and hands over the base64 strings), M4-1 stays
`BLOCKED-ON-SOURCE-ACCESS`, exactly as D1 states.** When it does: the
identical `m4-media-proof.mjs` script, with `substitutePhoto(...)`'s two
call sites replaced by the real decoded bytes, re-runs the identical
suite against genuine historical pixels — real provenance, and only then
are the resulting hashes recorded as the first permanent evidence.

---

## ADDITION 3 — CAPTURE-ORDER LAW (recorded here, the authoritative copy)

The sequence "1C media → capture wiring → 1D auth" is corrected to:

```
DATA-1C                durable media (this dispatch)
CAPTURE INTEGRATION    INTERNAL/STAGING ONLY — prove scan -> asset + photo
                       through the domain service; no public path, no
                       production user flow, operator-principal only
DATA-1D                principal auth + cross-device
PRODUCTION CAPTURE     ONLY AFTER 1D, behind a flag: authenticated
                       principal -> authorized asset -> authorized action ->
                       durable mint + media
```

A production scan that mints a durable `gkAssetId` and uploads permanent
evidence is a durable write; it does not ship before the authorization
chain exists. `GK-151` remains the hard gate — this law does not weaken
or route around it, it sequences what happens on either side of it.
Registry note (GK-162, `docs/TICKET-REGISTRY.md`): GK-162's decision/
contract split is the seed of a future **EXECUTION AUTHORITY** layer
between economic recommendation and execution — design-era note only,
nothing built against it this dispatch.

---

## CRAWL — liveness check (read-only, per the "crawl untouched" constraint)

`C:\grailkey-data\data-0e-full\acquire.pid` = **16696** (leading BOM byte
in the file, numeric value unaffected). Confirmed alive via
`Get-Process -Id 16696`: `node`, started 2026-08-22 16:21:08 (local). Last
checkpoint (`acquisition-checkpoint.json`): phase **fetching-details**,
`lastKnownRateLimit`: `sustainedRemaining: 729` (of the sustained budget),
`burstRemaining: 3`, observed 2026-08-22T23:34:38.333Z — healthy, not
rate-limited. Prior stdout log (still in the earlier **enumeration**
phase at that point) showed `candidateIds so far=138000+` before
transitioning into `fetching-details`. No action taken this dispatch, per
the "crawl untouched except through the service's own operations"
constraint — this is a read-only PID/log check, identical in kind to
DATA-1B's own crawl-status report.

---

## COMMITS

**Census (working tree at dispatch start vs. end), DATA-1C's own changes
only — pre-existing uncommitted files (`scripts/capture-active-cache-entry.mjs`
modified, `scripts/ingest-fixture-response.mjs`/`scripts/merge-fixture.mjs`
untracked) were already present before this dispatch began and are NOT
part of this commit — left exactly as found, per this session's own
"investigate before touching unfamiliar uncommitted state" discipline:**

```
new:      db/data0/0006_outcome_ledger.sql
new:      docs/GRAILKEY-STRATEGY.md
new:      docs/adr/DATA-1-OUTCOME-LEDGER-DESIGN.md
new:      docs/adr/DATA-1C-MEDIA-DESIGN.md
new:      src/modules/media/index.js
new:      src/modules/media/errors.js
new:      src/modules/media/contentAddress.js
new:      src/modules/media/driver-localfs.js
new:      src/modules/media/driver-vercel-blob.js
new:      tests/media-module-boundary.test.js
modified: src/modules/assets/index.js       (+attachMedia export)
modified: src/modules/assets/repository.js  (+findMediaByAssetRoleHash)
modified: src/modules/assets/service.js     (+attachMedia)
modified: docs/TICKET-REGISTRY.md           (GK-162 capture-order note)
```

**Correction commit, on top of `4336e3e` (D1-D8, "DATA-1C REVIEW — CORE
PASS, PUSH HOLD"), no history rewrite:**

```
modified: src/modules/assets/service.js     (attachMedia: D3 evidence-row
                                             dedupe removed, D4 mandatory
                                             idempotencyKey + request
                                             fingerprint, D5 preflight-
                                             before-PUT ordering)
modified: src/modules/assets/repository.js  (findMediaByAssetRoleHash
                                             deleted, per D3)
modified: docs/adr/DATA-1C-MEDIA-DESIGN.md  (M4-1/M4-6 gate states
                                             corrected per D1/D2; D3-D8
                                             documented in place)
modified: db/data0/snapshots/data-1c-media-slice-summary.json
                                             (gate states + corrections
                                             reflected)
```
(`C:\grailkey-data\data-1\m4-media-proof.mjs`, local scratch, not
committed, rewritten to match — see Task 4 above for the corrected
31/31-assertion run it produced.)

**Local only. Not pushed.** `531a2ee` → `4336e3e` → this correction
commit all sit on `main`, ahead of `origin/main`, per
`git log origin/main..HEAD`. Pre-existing quarantined scratch files
(`scripts/capture-active-cache-entry.mjs` modified,
`scripts/ingest-fixture-response.mjs`/`scripts/merge-fixture.mjs`
untracked) remain exactly as found — not part of any DATA-1C commit.
**Ask before push**, per the review's own explicit instruction.
