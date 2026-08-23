// src/modules/auth/credentials.js — PRIVATE. Never imported outside
// src/modules/auth/ — enforced by tests/auth-module-boundary.test.js.
//
// Passphrase hashing — node:crypto's scryptSync, stdlib, no new
// dependency (same "no SaaS/library unless evidence argues for it"
// discipline as token.js). scrypt is deliberately memory-hard —
// appropriate for a single, rarely-changed operator credential, not a
// high-throughput multi-user login system this project doesn't have yet.
//
// DATA-1D correction pass (H2) — cost parameters pinned explicitly
// (SCRYPT_N/R/P below) instead of relying on node:crypto's own implicit
// defaults. Functionally identical today (these ARE Node's current
// defaults, N=2^14, r=8, p=1) — the change is that the values are now a
// named, reviewable constant in this file rather than "whatever this
// Node version happens to default to," so a future Node runtime change
// can't silently alter verification cost without it showing up in a
// diff here. Not persisted per-row (single-operator era, one row, no
// rotation history to reconcile) — if these constants are ever changed,
// every existing credential row must be re-hashed (re-run the seed
// script with the current passphrase), since scrypt has no way to
// re-derive an old hash under new cost parameters without the original
// passphrase.

import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

const KEY_LEN = 64;
const SCRYPT_N = 16384; // CPU/memory cost (2^14) — node:crypto's own current default, pinned explicitly
const SCRYPT_R = 8;     // block size — node:crypto's own current default, pinned explicitly
const SCRYPT_P = 1;     // parallelization — node:crypto's own current default, pinned explicitly
const SCRYPT_OPTS = { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }; // maxmem left at node:crypto's own default (32MB) — comfortably covers N×r above

export function hashCredential(passphrase) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(passphrase, salt, KEY_LEN, SCRYPT_OPTS).toString('hex');
  return { hash, salt };
}

export function verifyCredential(passphrase, hash, salt) {
  const check = scryptSync(passphrase, salt, KEY_LEN, SCRYPT_OPTS);
  const stored = Buffer.from(hash, 'hex');
  if (check.length !== stored.length) return false;
  return timingSafeEqual(check, stored);
}
