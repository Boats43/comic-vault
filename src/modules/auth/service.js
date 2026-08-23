// src/modules/auth/service.js — the public surface implementation.
// Orchestrates login/token-verification via repository.js and
// token.js/credentials.js — the only file in this module permitted to
// import repository.js (see tests/auth-module-boundary.test.js).

import { acquireConnection } from './db.js';
import * as repo from './repository.js';
import { issueToken, verifyToken as verifyTokenRaw } from './token.js';
import { verifyCredential } from './credentials.js';
import { InvalidCredentialError, InvalidTokenError, NotProvisionedError } from './errors.js';

// login({ passphrase }) -> { token, expiresAt, principalId }
//
// Single-operator era: no username/email — there is exactly one
// operator principal to log in as. Multi-user login is explicitly not
// built (see docs/adr/DATA-1D-AUTH-CROSS-DEVICE.md, T1).
export async function login({ passphrase } = {}) {
  if (!passphrase || typeof passphrase !== 'string') {
    throw new InvalidCredentialError('passphrase is required');
  }
  const client = await acquireConnection();
  try {
    const principal = await repo.getOperatorPrincipal(client);
    if (!principal) {
      throw new NotProvisionedError('no operator principal exists in gk_principal');
    }
    const cred = await repo.getCredential(client, principal.id);
    if (!cred) {
      throw new NotProvisionedError(
        `no credential provisioned for operator principal ${principal.id} — ` +
        'run the local seed script before attempting login'
      );
    }
    const ok = verifyCredential(passphrase, cred.credential_hash, cred.credential_salt);
    if (!ok) {
      throw new InvalidCredentialError('incorrect passphrase');
    }
    const { token, expiresAt } = issueToken({ principalId: principal.id });
    return { token, expiresAt, principalId: principal.id };
  } finally {
    client.release();
  }
}

// verifyToken(token) -> { principalId, iat, exp }  — throws
// InvalidTokenError on anything else (missing, malformed, bad
// signature, expired). No DB round-trip — this token is self-verifying
// by design (see token.js).
export function verifyToken(token) {
  const result = verifyTokenRaw(token);
  if (!result) {
    throw new InvalidTokenError('missing, malformed, incorrectly signed, or expired token');
  }
  return result;
}
