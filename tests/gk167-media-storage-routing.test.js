// tests/gk167-media-storage-routing.test.js
//
// GK-167 — deterministic regression proof that src/modules/media/index.js's
// head()/getBytes() dispatch by the object_uri's OWN scheme, never by
// MEDIA_STORAGE_DRIVER, while put() stays driven by MEDIA_STORAGE_DRIVER
// (writes only). Real module, real localfs bytes on a real temp directory —
// no network access and no live Blob token required or assumed. The
// https:// branch is proven by forcibly clearing BLOB_READ_WRITE_TOKEN for
// the duration of each such assertion (restored after), which guarantees
// driver-vercel-blob.js's requireToken() guard throws BEFORE any SDK import
// or network call is reached — deterministic regardless of what the ambient
// environment happens to have set.
//
// Invoke: node tests/gk167-media-storage-routing.test.js

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

let passed = 0;
let failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

console.log('\n=== GK-167 — media storage routing invariant (deterministic) ===\n');

const tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'gk167-routing-test-'));
process.env.MEDIA_LOCALFS_ROOT = tmpRoot;

const savedDriver = process.env.MEDIA_STORAGE_DRIVER;
const savedToken = process.env.BLOB_READ_WRITE_TOKEN;
function restoreEnv() {
  if (savedDriver === undefined) delete process.env.MEDIA_STORAGE_DRIVER;
  else process.env.MEDIA_STORAGE_DRIVER = savedDriver;
  if (savedToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN = savedToken;
}

const media = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'media', 'index.js')));

try {
  // --- Invariant 1: existing localfs:// media resolves through localfs
  // even when MEDIA_STORAGE_DRIVER=vercel-blob. ---
  delete process.env.MEDIA_STORAGE_DRIVER; // put() under the localfs default
  const bytes = Buffer.from('gk167-deterministic-' + Math.random());
  const putResult = await media.put({ bytes, contentType: 'text/plain' });
  assertTrue(putResult.objectUri.startsWith('localfs://'), 'put() under default (localfs) writes a localfs:// object_uri');

  process.env.MEDIA_STORAGE_DRIVER = 'vercel-blob';
  const headResult = await media.head({ objectUri: putResult.objectUri });
  assertTrue(headResult.exists === true, 'head() on a localfs:// row still resolves via localfs after MEDIA_STORAGE_DRIVER=vercel-blob');
  const gotBytes = await media.getBytes({ objectUri: putResult.objectUri });
  assertTrue(Buffer.compare(gotBytes, bytes) === 0, 'getBytes() on that same row returns the real original bytes, byte-identical');

  // --- Invariant 2: existing https:// media routes toward the Blob adapter
  // even when MEDIA_STORAGE_DRIVER=localfs. No network reached: token is
  // forcibly absent, so driver-vercel-blob.js's requireToken() guard throws
  // before any SDK call. ---
  process.env.MEDIA_STORAGE_DRIVER = 'localfs';
  delete process.env.BLOB_READ_WRITE_TOKEN;
  const FAKE_HTTPS_URI = 'https://example.blob.vercel-storage.com/sha256/ab/cdef0123456789';
  try {
    await media.head({ objectUri: FAKE_HTTPS_URI });
    assertTrue(false, 'head() on an https:// row with MEDIA_STORAGE_DRIVER=localfs (unexpected success — should have reached driver-vercel-blob.js and thrown)');
  } catch (e) {
    assertTrue(
      e.constructor.name === 'NotProvisionedError',
      `head() on an https:// row dispatches to driver-vercel-blob.js (NotProvisionedError) even with MEDIA_STORAGE_DRIVER=localfs — got ${e.constructor.name}: ${e.message}`
    );
  }
  try {
    await media.getBytes({ objectUri: FAKE_HTTPS_URI });
    assertTrue(false, 'getBytes() on an https:// row with MEDIA_STORAGE_DRIVER=localfs (unexpected success)');
  } catch (e) {
    assertTrue(
      e.constructor.name === 'NotProvisionedError',
      `getBytes() on an https:// row dispatches to driver-vercel-blob.js (NotProvisionedError) even with MEDIA_STORAGE_DRIVER=localfs — got ${e.constructor.name}: ${e.message}`
    );
  }

  // Same https:// row, with MEDIA_STORAGE_DRIVER=vercel-blob too — proves the
  // https branch is genuinely scheme-driven, not accidentally passing only
  // because the env var happened to disagree.
  process.env.MEDIA_STORAGE_DRIVER = 'vercel-blob';
  try {
    await media.head({ objectUri: FAKE_HTTPS_URI });
    assertTrue(false, 'head() on https:// row with MEDIA_STORAGE_DRIVER=vercel-blob too (unexpected success)');
  } catch (e) {
    assertTrue(
      e.constructor.name === 'NotProvisionedError',
      `head() on https:// row still dispatches to driver-vercel-blob.js with MEDIA_STORAGE_DRIVER=vercel-blob — got ${e.constructor.name}`
    );
  }

  // --- Invariant 3: malformed/unsupported URI fails explicitly, never a
  // silent fallback to whichever driver the env var currently names. ---
  for (const badUri of ['ftp://not-a-real-scheme/x', 'localfs-typo://x', '', null, undefined]) {
    try {
      await media.head({ objectUri: badUri });
      assertTrue(false, `head() on malformed scheme ${JSON.stringify(badUri)} (unexpected success)`);
    } catch (e) {
      assertTrue(
        /unrecognized or malformed scheme/.test(e.message),
        `head() on malformed scheme ${JSON.stringify(badUri)} throws the explicit routing error, not a silent fallback`
      );
    }
  }

  // --- Invariant 4: put() remains controlled by MEDIA_STORAGE_DRIVER (write
  // path is env-driven, unaffected by GK-167's read-path fix). Proven both
  // ways: localfs default succeeds and produces a localfs:// URI; switching
  // to vercel-blob with no token deterministically throws from the
  // vercel-blob driver (proving put() actually routed there, not silently
  // stayed on localfs). ---
  delete process.env.MEDIA_STORAGE_DRIVER;
  const putLocalfs = await media.put({ bytes: Buffer.from('put-invariant-localfs'), contentType: 'text/plain' });
  assertTrue(putLocalfs.objectUri.startsWith('localfs://'), 'put() with MEDIA_STORAGE_DRIVER unset (localfs default) writes localfs://');

  process.env.MEDIA_STORAGE_DRIVER = 'vercel-blob';
  delete process.env.BLOB_READ_WRITE_TOKEN;
  try {
    await media.put({ bytes: Buffer.from('put-invariant-blob'), contentType: 'text/plain' });
    assertTrue(false, 'put() with MEDIA_STORAGE_DRIVER=vercel-blob and no token (unexpected success)');
  } catch (e) {
    assertTrue(
      e.constructor.name === 'NotProvisionedError',
      `put() with MEDIA_STORAGE_DRIVER=vercel-blob routes to the vercel-blob driver (NotProvisionedError), proving the write path is env-controlled — got ${e.constructor.name}`
    );
  }
} finally {
  restoreEnv();
  delete process.env.MEDIA_LOCALFS_ROOT;
  rmSync(tmpRoot, { recursive: true, force: true });
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('FAILURES:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
