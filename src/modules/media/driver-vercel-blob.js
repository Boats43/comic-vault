// src/modules/media/driver-vercel-blob.js — PRIVATE. Never imported
// outside src/modules/media/ — enforced by
// tests/media-module-boundary.test.js.
//
// PROVISIONED AND PROVEN (GK-166, 2026-08-23). `@vercel/blob` is
// installed; a real, private Vercel Blob store
// (comic-vault-media-primary, store_ELU7TMUZwfjot0Pk, iad1) is
// connected to this project, with BLOB_READ_WRITE_TOKEN set in
// Development/Preview/Production. This driver became the proving-ground
// PRIMARY driver this dispatch — the first real cloud implementation of
// the MediaStorage contract, not localfs — closing M4-6
// (`m4-media-proof.mjs`, BLOCKED-ON-PRIMARY-PROVISIONING → PASS): the
// same round-trip/immutability/hash-mismatch storage-contract suite
// M4-2/M4-3/M4-5 run against localfs now also runs, and passes, against
// this live store. Dynamically imported (never a static top-level
// `import`) specifically so an environment with no Blob store
// configured (MEDIA_STORAGE_DRIVER left at its 'localfs' default) is
// never affected by this file at all. This is a proving-ground choice,
// not a permanent vendor commitment — the adapter boundary
// (src/modules/media/index.js's driver selection) keeps it demotable if
// a future dispatch has reason to switch.
//
// One real bug found and fixed while proving this for real: the
// "pathname already exists" recovery path below originally called
// head() with a placeholder scheme (`vercel-blob-key:${key}`) that was
// never a valid input — silently defeating the whole recovery branch.
// Fixed to pass the real, deterministic content-addressed key directly;
// confirmed against the installed @vercel/blob's own type definitions
// that head()/get() both accept a bare pathname, not only a full URL.

import { sha256Hex, deriveKey } from './contentAddress.js';
import { HashMismatchError, MediaNotFoundError, NotProvisionedError } from './errors.js';

async function loadSdk() {
  try {
    return await import('@vercel/blob');
  } catch {
    throw new NotProvisionedError(
      '@vercel/blob is not installed. Run `npm install @vercel/blob` after a Blob store ' +
      'is provisioned for this project (see docs/adr/DATA-1C-MEDIA-DESIGN.md, Task 1).'
    );
  }
}

function requireToken() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new NotProvisionedError(
      'BLOB_READ_WRITE_TOKEN is not set. Provision a Vercel Blob store for this project ' +
      '(Dashboard → Storage → Create Database → Blob, or `vercel blob create-store`), then ' +
      '`vercel env pull` to sync the token locally. See docs/adr/DATA-1C-MEDIA-DESIGN.md, Task 1.'
    );
  }
}

export async function put({ bytes, contentType, sha256 }) {
  requireToken();
  const { put: blobPut } = await loadSdk();

  const actualHash = sha256Hex(bytes);
  if (sha256 && sha256 !== actualHash) {
    throw new HashMismatchError(
      `declared sha256 (${sha256}) does not match the actual bytes' sha256 (${actualHash}) — nothing stored`
    );
  }
  const key = deriveKey(actualHash);

  try {
    const result = await blobPut(key, bytes, {
      access: 'private', // C1 — never public by default
      contentType,
      addRandomSuffix: false, // the key IS the content address; a random suffix would break that
      // allowOverwrite intentionally omitted (defaults false) — this is
      // the native create-if-absent primitive C2 asks for: a second put
      // at the same key throws rather than silently replacing content.
    });
    return { objectUri: result.url, bytesStored: bytes.length, sha256Verified: actualHash, created: true };
  } catch (e) {
    // GK-166 (2026-08-23) — verified for real against a live store: the
    // installed @vercel/blob's own head()/get() BOTH accept a bare
    // pathname, not only a full URL (confirmed directly against
    // node_modules/@vercel/blob's own type definitions — `head(urlOrPathname:
    // string, ...)`). The original placeholder scheme
    // (`vercel-blob-key:${key}`) below was never a valid input to
    // head() and silently defeated this entire recovery path — fixed to
    // pass the real, deterministic `key` directly.
    if (/already exists|overwrite/i.test(e?.message || '')) {
      const { head: blobHeadFn } = await loadSdk();
      const meta = await blobHeadFn(key).catch(() => null);
      if (meta) {
        return { objectUri: meta.url, bytesStored: bytes.length, sha256Verified: actualHash, created: false };
      }
    }
    throw e;
  }
}

// NOTE: @vercel/blob's head()/get() operate on a full blob URL, not a
// bare pathname — the driver stores the resolved URL as objectUri (see
// put() above), so head()/getBytes() below expect a real https:// blob
// URL, not the placeholder "vercel-blob-key:" scheme used internally by
// put()'s own already-exists recovery path.
export async function head({ objectUri }) {
  requireToken();
  const { head: blobHead } = await loadSdk();
  try {
    const meta = await blobHead(objectUri);
    return { exists: true, bytes: meta.size, contentType: meta.contentType || null };
  } catch (e) {
    if (e?.name === 'BlobNotFoundError' || /not found/i.test(e?.message || '')) {
      return { exists: false, bytes: 0, contentType: null };
    }
    throw e;
  }
}

export async function getBytes({ objectUri }) {
  requireToken();
  const { get: blobGet } = await loadSdk();
  const result = await blobGet(objectUri, { access: 'private' });
  if (!result) throw new MediaNotFoundError(`no object at ${objectUri}`);
  const chunks = [];
  for await (const chunk of result.stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}
