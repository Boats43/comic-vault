// src/modules/media/driver-vercel-blob.js — PRIVATE. Never imported
// outside src/modules/media/ — enforced by
// tests/media-module-boundary.test.js.
//
// SPEC'D, NOT PROVISIONED (DATA-1C, Task 1 / C7). `@vercel/blob` is not
// installed in this repo's package.json and no BLOB_READ_WRITE_TOKEN
// exists in any of this project's .env* files as of this dispatch —
// confirmed by direct grep, not assumed. This file is real code against
// the documented @vercel/blob API, dynamically imported (never a static
// top-level `import`) specifically so its absence cannot break any build
// or test that doesn't actually select this driver. It has NOT been
// exercised against a live store — the M4 proof suite (DATA-1C) runs
// against driver-localfs.js only. See docs/adr/DATA-1C-MEDIA-DESIGN.md,
// Task 1, for exactly what provisioning this requires (Jimmy's action)
// and the disclosed uncertainty around head()'s exact return shape,
// which needs re-verification against the installed package version the
// first time this driver actually runs.

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
    // Disclosed uncertainty: the exact error shape @vercel/blob throws
    // for "pathname already exists, allowOverwrite not set" has not been
    // confirmed against a live store in this dispatch (no store is
    // provisioned to test against — see the module header). Matching
    // defensively on message text until that's verified for real.
    if (/already exists|overwrite/i.test(e?.message || '')) {
      const existing = await head({ objectUri: `vercel-blob-key:${key}` }).catch(() => null);
      if (existing?.exists) {
        return { objectUri: existing.objectUri, bytesStored: bytes.length, sha256Verified: actualHash, created: false };
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
