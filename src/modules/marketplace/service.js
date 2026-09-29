// src/modules/marketplace/service.js — the public surface
// implementation. Orchestrates transactions, calls repository.js,
// NEVER issues SQL directly. GK-263 Phase 1 — storage + ownership +
// encryption primitives ONLY. No OAuth flow, no HTTP handler imports
// this module yet (that is a later, separately-authorized phase).
//
// GOVERNING LAWS (see the dispatch that authorized this module):
//   1. Marketplace credentials belong to a verified GrailKey principal.
//   2. A client-supplied principalId is never authority — every function
//      here trusts principalId only as much as its caller already
//      verified it (this module does not itself authenticate anyone;
//      a future OAuth callback handler must resolve principalId from a
//      real GrailKey session before ever calling upsertMarketplaceConnection).
//   3. No refresh credential is ever stored plaintext.
//   4. No credential material is ever returned by the metadata getter.
//   5. No secret material is ever logged.
//   6. No operation may read or mutate another principal's connection.
//   7. No global-token fallback exists anywhere in this module.
//   8. This table is for SELLER-USER connections only, never
//      application-scoped credentials (those stay in process.env, e.g.
//      the existing EBAY_APP_ID/EBAY_CERT_ID Browse-API client_credentials
//      pair — untouched, unrelated, not migrated here).

import * as repo from './repository.js';
import { acquireConnection } from './db.js';
import { encryptCredential, decryptCredential, CREDENTIAL_KEY_VERSION } from './crypto.js';
import { NotFoundError, ValidationFailedError, AuthorizationFailedError, ConflictError, ProviderIdentityConflictError } from './errors.js';

const SUPPORTED_PROVIDERS = ['EBAY'];

function requireFields(obj, fields) {
  for (const f of fields) {
    if (obj == null || obj[f] === undefined || obj[f] === null || obj[f] === '') {
      throw new ValidationFailedError(`Missing required field: ${f}`);
    }
  }
}

function requireProvider(provider) {
  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    throw new ValidationFailedError(`provider must be one of [${SUPPORTED_PROVIDERS.join(', ')}], got: ${JSON.stringify(provider)}`);
  }
}

async function assertPrincipalActive(client, principalId) {
  if (!principalId) throw new AuthorizationFailedError('principalId is required');
  const exists = await repo.assertPrincipalExists(client, principalId);
  if (!exists) throw new AuthorizationFailedError(`principalId ${principalId} does not resolve to a real gk_principal row`);
}

// toMetadata — THE SECRET-RETURN BOUNDARY. Every public read-facing
// function in this file returns ONLY what this strips down to.
// encrypted_refresh_credential / credential_key_version never cross
// this line — the ONLY function that ever returns credential material
// (decrypted, never the ciphertext/nonce/tag) is
// resolveMarketplaceRefreshCredential, below, which must never be wired
// to an HTTP response body by any future caller.
function toMetadata(row) {
  if (!row) return null;
  return {
    id: row.id,
    principalId: row.principal_id,
    provider: row.provider,
    providerUserId: row.provider_user_id,
    connectionStatus: row.connection_status,
    grantedScopes: row.granted_scopes,
    connectedAt: row.connected_at,
    updatedAt: row.updated_at,
    lastError: row.last_error,
  };
}

// upsertMarketplaceConnection — the only writer of a real credential.
// principalId is taken as given (Governing Law 2 makes this the
// CALLER's responsibility — this function itself never authenticates
// anyone). refreshCredential is encrypted before it is ever passed to
// repository.js — the plaintext value never reaches SQL or a log line.
//
// One row per (principalId, provider), reused across reconnects (see
// the migration's own header) — a first-ever connect inserts; every
// later (re)connect for the same principal+provider updates the same
// row in place, resetting connection_status to CONNECTED and clearing
// last_error.
export async function upsertMarketplaceConnection({
  principalId, provider, providerUserId, refreshCredential, grantedScopes = [], connectedAt,
} = {}) {
  requireFields({ principalId, provider, providerUserId, refreshCredential }, ['principalId', 'provider', 'providerUserId', 'refreshCredential']);
  requireProvider(provider);

  const client = await acquireConnection();
  try {
    await assertPrincipalActive(client, principalId);
    await client.query('BEGIN');
    try {
      // Section 6 — provider-identity collision. Fail closed, no
      // overwrite, no reassignment: if a DIFFERENT principal already
      // holds an active connection for this exact provider account,
      // this request is refused outright.
      const collision = await repo.getActiveConnectionByProviderIdentity(client, {
        provider, providerUserId, excludePrincipalId: principalId,
      });
      if (collision) {
        throw new ProviderIdentityConflictError(
          `${provider} account ${providerUserId} is already actively connected to a different GrailKey principal — refusing to move or overwrite ownership`
        );
      }

      const encryptedRefreshCredential = encryptCredential(refreshCredential);
      const existing = await repo.getConnectionByPrincipalProvider(client, { principalId, provider });
      const resolvedConnectedAt = connectedAt ?? new Date();

      if (existing) {
        await repo.updateConnectionForReconnect(client, {
          id: existing.id, providerUserId, connectionStatus: 'CONNECTED', grantedScopes,
          encryptedRefreshCredential, credentialKeyVersion: CREDENTIAL_KEY_VERSION, connectedAt: resolvedConnectedAt,
        });
      } else {
        const idRes = await client.query('SELECT uuidv7() as id');
        await repo.insertConnection(client, {
          id: idRes.rows[0].id, principalId, provider, providerUserId, connectionStatus: 'CONNECTED', grantedScopes,
          encryptedRefreshCredential, credentialKeyVersion: CREDENTIAL_KEY_VERSION, connectedAt: resolvedConnectedAt,
        });
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }

    const row = await repo.getConnectionByPrincipalProvider(client, { principalId, provider });
    return toMetadata(row);
  } finally {
    client.release();
  }
}

// getMarketplaceConnection — METADATA ONLY (see toMetadata above). Scoped
// strictly by principalId + provider — there is no id-based lookup
// exposed anywhere in this module's public surface, so "Principal A
// supplies Principal B's connection id" is structurally impossible, not
// merely disallowed by convention.
export async function getMarketplaceConnection({ principalId, provider } = {}) {
  requireFields({ principalId, provider }, ['principalId', 'provider']);
  requireProvider(provider);
  const client = await acquireConnection();
  try {
    await assertPrincipalActive(client, principalId);
    const row = await repo.getConnectionByPrincipalProvider(client, { principalId, provider });
    return toMetadata(row);
  } finally {
    client.release();
  }
}

// resolveMarketplaceRefreshCredential — SERVER-ONLY. The ONE function in
// this module that ever returns plaintext credential material. Must
// never be wired to an HTTP response body by any future caller — it
// exists for a future server-side eBay-call credential resolver
// (explicitly not built in this phase) to consume internally.
//
// Fails closed on RECONNECT_REQUIRED (never treats a stored ciphertext,
// if any, as usable in that state) and on DISCONNECTED/missing (no
// ciphertext exists to decrypt, enforced by the DB-layer CHECK
// constraint, not merely this function's own discipline).
export async function resolveMarketplaceRefreshCredential({ principalId, provider } = {}) {
  requireFields({ principalId, provider }, ['principalId', 'provider']);
  requireProvider(provider);
  const client = await acquireConnection();
  try {
    await assertPrincipalActive(client, principalId);
    const row = await repo.getConnectionByPrincipalProvider(client, { principalId, provider });
    if (!row) {
      throw new NotFoundError(`no ${provider} marketplace connection exists for this principal`);
    }
    if (row.connection_status === 'RECONNECT_REQUIRED') {
      throw new ConflictError(`${provider} marketplace connection requires reconnection before its credential can be used again (${row.last_error || 'no reason recorded'})`);
    }
    if (row.connection_status !== 'CONNECTED' || !row.encrypted_refresh_credential) {
      throw new ConflictError(`${provider} marketplace connection has no usable credential (status: ${row.connection_status})`);
    }
    return { refreshCredential: decryptCredential(row.encrypted_refresh_credential), grantedScopes: row.granted_scopes };
  } finally {
    client.release();
  }
}

// markMarketplaceReconnectRequired — CONNECTED -> RECONNECT_REQUIRED.
// Used by a future credential-refresh path that discovers a stored
// refresh credential no longer works (revoked/expired) — not built in
// this phase, but the state transition it will need already exists.
export async function markMarketplaceReconnectRequired({ principalId, provider, reason } = {}) {
  requireFields({ principalId, provider }, ['principalId', 'provider']);
  requireProvider(provider);
  const client = await acquireConnection();
  try {
    await assertPrincipalActive(client, principalId);
    const row = await repo.getConnectionByPrincipalProvider(client, { principalId, provider });
    if (!row) throw new NotFoundError(`no ${provider} marketplace connection exists for this principal`);
    if (row.connection_status === 'DISCONNECTED') {
      throw new ConflictError(`cannot mark a DISCONNECTED ${provider} connection as reconnect-required — connect it again instead`);
    }
    await repo.markReconnectRequired(client, { id: row.id, reason });
    const updated = await repo.getConnectionByPrincipalProvider(client, { principalId, provider });
    return toMetadata(updated);
  } finally {
    client.release();
  }
}

// disconnectMarketplaceConnection — makes the credential unusable by
// GrailKey (status DISCONNECTED, ciphertext cleared). No eBay
// revocation call — that belongs to a later, separately-authorized
// OAuth phase.
export async function disconnectMarketplaceConnection({ principalId, provider } = {}) {
  requireFields({ principalId, provider }, ['principalId', 'provider']);
  requireProvider(provider);
  const client = await acquireConnection();
  try {
    await assertPrincipalActive(client, principalId);
    const row = await repo.getConnectionByPrincipalProvider(client, { principalId, provider });
    if (!row) throw new NotFoundError(`no ${provider} marketplace connection exists for this principal`);
    await repo.disconnectConnection(client, { id: row.id });
    const updated = await repo.getConnectionByPrincipalProvider(client, { principalId, provider });
    return toMetadata(updated);
  } finally {
    client.release();
  }
}
