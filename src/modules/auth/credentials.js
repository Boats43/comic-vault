// src/modules/auth/credentials.js — PRIVATE. Never imported outside
// src/modules/auth/ — enforced by tests/auth-module-boundary.test.js.
//
// Passphrase hashing — node:crypto's scryptSync, stdlib, no new
// dependency (same "no SaaS/library unless evidence argues for it"
// discipline as token.js). scrypt is deliberately memory-hard —
// appropriate for a single, rarely-changed operator credential, not a
// high-throughput multi-user login system this project doesn't have yet.

import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

const KEY_LEN = 64;

export function hashCredential(passphrase) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(passphrase, salt, KEY_LEN).toString('hex');
  return { hash, salt };
}

export function verifyCredential(passphrase, hash, salt) {
  const check = scryptSync(passphrase, salt, KEY_LEN);
  const stored = Buffer.from(hash, 'hex');
  if (check.length !== stored.length) return false;
  return timingSafeEqual(check, stored);
}
