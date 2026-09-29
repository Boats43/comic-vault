// src/modules/marketplace/crypto.js — PRIVATE. The server-only
// encryption primitive for provider (eBay today) refresh credentials.
// Never imported outside src/modules/marketplace/.
//
// AES-256-GCM, authenticated encryption, a random 12-byte IV per call,
// a versioned envelope format ("v1.<iv>.<ciphertext>.<authTag>", all
// base64url) so a future key rotation/migration (a v2 envelope, or a
// credential_key_version-driven re-encryption pass) never requires a
// schema change to this format itself.
//
// Dedicated key: GRAILKEY_MARKETPLACE_CREDENTIAL_KEY (base64url, must
// decode to exactly 32 bytes). Deliberately NEVER shares
// GRAILKEY_SESSION_SECRET, ACCESS_CODE, or any eBay app secret — a
// credential-encryption key compromise and a session-signing key
// compromise must never be the same incident.
//
// Fails closed: a missing key throws before any encrypt/decrypt is
// attempted; a wrong-length/malformed key throws the same way. Never
// logs the key, the plaintext credential, or the full ciphertext —
// callers in this module log only high-level facts (principalId,
// provider, connection_status), never envelope contents.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
export const CREDENTIAL_KEY_VERSION = 1;

function loadKey() {
  const raw = process.env.GRAILKEY_MARKETPLACE_CREDENTIAL_KEY;
  if (!raw) {
    throw new Error(
      '[marketplace/crypto] GRAILKEY_MARKETPLACE_CREDENTIAL_KEY is not set — ' +
      'fails closed, no credential may be encrypted or decrypted without it.'
    );
  }
  let key;
  try {
    key = Buffer.from(raw, 'base64url');
  } catch {
    throw new Error('[marketplace/crypto] GRAILKEY_MARKETPLACE_CREDENTIAL_KEY is not valid base64url — fails closed.');
  }
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `[marketplace/crypto] GRAILKEY_MARKETPLACE_CREDENTIAL_KEY must decode to exactly ${KEY_BYTES} bytes ` +
      `(base64url) — got ${key.length}. Fails closed.`
    );
  }
  return key;
}

export function encryptCredential(plaintext) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('[marketplace/crypto] encryptCredential requires a non-empty string plaintext.');
  }
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `v${CREDENTIAL_KEY_VERSION}.${iv.toString('base64url')}.${ciphertext.toString('base64url')}.${authTag.toString('base64url')}`;
}

export function decryptCredential(envelope) {
  if (typeof envelope !== 'string' || envelope.length === 0) {
    throw new Error('[marketplace/crypto] decryptCredential requires a non-empty string envelope.');
  }
  const parts = envelope.split('.');
  if (parts.length !== 4 || parts[0] !== `v${CREDENTIAL_KEY_VERSION}`) {
    throw new Error('[marketplace/crypto] unrecognized credential envelope format/version.');
  }
  const [, ivB64, ciphertextB64, authTagB64] = parts;
  const key = loadKey();
  const iv = Buffer.from(ivB64, 'base64url');
  const ciphertext = Buffer.from(ciphertextB64, 'base64url');
  const authTag = Buffer.from(authTagB64, 'base64url');
  if (iv.length !== IV_BYTES) {
    throw new Error('[marketplace/crypto] malformed credential envelope — wrong IV length.');
  }
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}
