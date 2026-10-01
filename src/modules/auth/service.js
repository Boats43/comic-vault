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

// BETA-1A, extended by GK-268 AUTH LAUNCH (2026-09-30) —
// loginWithExternalIdentity({ provider, externalSubject, displayName }) ->
// { token, expiresAt, principalId }
//
// The Clerk adapter's ONLY entry point into this module. `externalSubject`
// must already be a VERIFIED value (api/auth-clerk.js derives it from
// @clerk/backend's own verifyToken() — a request-supplied subject never
// reaches this function). Issues the SAME HMAC session token login() does
// — everything downstream of a successful call here (assets.js,
// asset-media.js, operator-action.js) is unchanged, because the resulting
// token is indistinguishable from one the passphrase path issued.
//
// GK-268 retired the prior invite-only boundary (0022's own migration
// header: "do NOT provision public users yet" / NotProvisionedError on
// any unmapped subject) by explicit product ruling: a verified external
// identity with no existing mapping now gets a brand-new 'user'-kind
// principal, auto-created atomically with its identity mapping
// (repo.createPrincipalWithExternalIdentity) — never a silent fallback to
// any OTHER existing principal, and never a client-chosen principalId.
// `displayName` is optional, caller-supplied verified profile metadata
// (e.g. the Clerk user's own email) used only for a brand-new principal's
// initial display_name — ignored entirely when the subject already
// resolves to an existing principal.
export async function loginWithExternalIdentity({ provider, externalSubject, displayName } = {}) {
  if (!provider || !externalSubject || typeof externalSubject !== 'string') {
    throw new InvalidCredentialError('provider and externalSubject are required');
  }
  const client = await acquireConnection();
  try {
    let principal = await repo.getPrincipalByExternalIdentity(client, { provider, externalSubject });
    if (!principal) {
      try {
        principal = await repo.createPrincipalWithExternalIdentity(client, {
          displayName: displayName || 'GrailKey User',
          provider,
          externalSubject,
        });
      } catch (e) {
        // Unique-violation race (23505): two concurrent first-logins for
        // the same brand-new subject both missed the SELECT above. Recover
        // the winner's already-committed row rather than erroring — same
        // "recover the winner's result on the loser's unique-violation"
        // precedent as GK-193's idempotency-claim race.
        if (e?.code === '23505') {
          principal = await repo.getPrincipalByExternalIdentity(client, { provider, externalSubject });
        }
        if (!principal) throw e;
      }
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
