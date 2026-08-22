// src/modules/media/driver-localfs.js — PRIVATE. Never imported outside
// src/modules/media/ — enforced by tests/media-module-boundary.test.js.
//
// Dev/test driver (Task 2d). Root lives OUTSIDE this repo by default —
// never defaults into the tracked source tree, so a stray run can't
// accidentally get media bytes committed. Override with
// MEDIA_LOCALFS_ROOT when a caller wants a specific location (every M4
// proof script in this dispatch does, pointing at
// C:\grailkey-data\data-1\media-store).
//
// Atomicity (C2): uses fs.open(path, 'wx') — POSIX/Node's own exclusive-
// create flag. Two concurrent puts of the same key race at the OS level;
// exactly one open() succeeds, the other gets EEXIST. That EEXIST is not
// an error from this driver's point of view — it means "the object
// already exists" (which, under content-addressing, means the bytes are
// already there), so it resolves the same way a slower caller who simply
// checked existence first would. This is the real native create-if-
// absent primitive C2 asks for, not an application-level check-then-
// write race.

import { mkdir, open, readFile, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { sha256Hex, deriveKey } from './contentAddress.js';
import { HashMismatchError, MediaNotFoundError } from './errors.js';

function resolveRoot() {
  return process.env.MEDIA_LOCALFS_ROOT || path.join(os.tmpdir(), 'grailkey-media-localfs');
}

function keyToPath(root, key) {
  // key is always "sha256/<xx>/<hash>" (contentAddress.js) — join
  // verbatim, no caller-supplied path segments ever reach this function.
  return path.join(root, ...key.split('/'));
}

export async function put({ bytes, contentType, sha256 }) {
  const actualHash = sha256Hex(bytes);
  if (sha256 && sha256 !== actualHash) {
    throw new HashMismatchError(
      `declared sha256 (${sha256}) does not match the actual bytes' sha256 (${actualHash}) — nothing stored`
    );
  }
  const key = deriveKey(actualHash);
  const root = resolveRoot();
  const filePath = keyToPath(root, key);
  await mkdir(path.dirname(filePath), { recursive: true });

  let created = false;
  try {
    const handle = await open(filePath, 'wx'); // exclusive create — the atomicity primitive
    try {
      await handle.writeFile(bytes);
      // sidecar content-type, best-effort, never load-bearing for
      // correctness (the hash/key relationship is what's load-bearing)
      await handle.close();
      created = true;
    } catch (e) {
      await handle.close().catch(() => {});
      await rm(filePath, { force: true });
      throw e;
    }
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    // Already there — under content-addressing this means the bytes are
    // already there (see the module-level note above). Idempotent no-op.
  }

  return {
    objectUri: `localfs://${key}`,
    bytesStored: bytes.length,
    sha256Verified: actualHash,
    created,
  };
}

function uriToKey(objectUri) {
  if (!objectUri.startsWith('localfs://')) {
    throw new MediaNotFoundError(`not a localfs:// URI: ${objectUri}`);
  }
  return objectUri.slice('localfs://'.length);
}

export async function head({ objectUri }) {
  const root = resolveRoot();
  const filePath = keyToPath(root, uriToKey(objectUri));
  try {
    const st = await stat(filePath);
    return { exists: true, bytes: st.size, contentType: null };
  } catch (e) {
    if (e.code === 'ENOENT') return { exists: false, bytes: 0, contentType: null };
    throw e;
  }
}

export async function getBytes({ objectUri }) {
  const root = resolveRoot();
  const filePath = keyToPath(root, uriToKey(objectUri));
  try {
    return await readFile(filePath);
  } catch (e) {
    if (e.code === 'ENOENT') throw new MediaNotFoundError(`no object at ${objectUri}`);
    throw e;
  }
}
