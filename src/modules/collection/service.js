// src/modules/collection/service.js — the public surface implementation.
// GrailKey Clean Account/Collection Cutover (2026-09-17): server becomes
// authoritative for "what does this account own," category-agnostic.
//
// Ownership rule, absolute: every function here takes principalId as an
// explicit parameter and every caller (api/collection.js) derives it
// EXCLUSIVELY from the verified Bearer token — never from request body,
// query string, or any other client-supplied value. This file has no
// knowledge of HTTP at all and cannot itself enforce that; api/collection.js
// is where that boundary is actually held.
//
// Physical-asset doctrine, unchanged: this module never references
// gk_asset, never mints a gkAssetId, never calls into
// src/modules/assets/. A collection_item is a claim of ownership over a
// generic record, nothing more — linking one to a real physical asset
// later is collection_item_link's job (0007, capture module), untouched
// by this dispatch.

import { acquireConnection } from './db.js';
import * as repo from './repository.js';
import { ValidationFailedError, AuthorizationFailedError, NotFoundError } from './errors.js';

function requireFields(obj, fields) {
  for (const f of fields) {
    if (obj == null || obj[f] === undefined || obj[f] === null || obj[f] === '') {
      throw new ValidationFailedError(`Missing required field: ${f}`);
    }
  }
}

async function assertPrincipalActive(client, principalId) {
  if (!principalId) throw new AuthorizationFailedError('principalId is required');
  const exists = await repo.assertPrincipalExists(client, principalId);
  if (!exists) throw new AuthorizationFailedError(`principalId ${principalId} does not resolve to a real gk_principal row`);
}

export async function listMyCollection({ principalId } = {}) {
  requireFields({ principalId }, ['principalId']);
  const client = await acquireConnection();
  try {
    await assertPrincipalActive(client, principalId);
    return await repo.listByPrincipal(client, principalId);
  } finally {
    client.release();
  }
}

export async function getMyCollectionItem({ principalId, id } = {}) {
  requireFields({ principalId, id }, ['principalId', 'id']);
  const client = await acquireConnection();
  try {
    await assertPrincipalActive(client, principalId);
    const item = await repo.getByPrincipalAndId(client, principalId, id);
    // Indistinguishable-from-not-found convention: this function never
    // reveals whether `id` exists under a DIFFERENT principal.
    if (!item) throw new NotFoundError(`collection item ${id} does not exist`);
    return item;
  } finally {
    client.release();
  }
}

export async function createCollectionItem({ principalId, id, assetCategory = 'comic', attributes } = {}) {
  requireFields({ principalId, id, attributes }, ['principalId', 'id', 'attributes']);
  if (typeof attributes !== 'object' || Array.isArray(attributes)) {
    throw new ValidationFailedError('attributes must be a JSON object');
  }
  const client = await acquireConnection();
  try {
    await assertPrincipalActive(client, principalId);
    return await repo.upsertItem(client, { id, principalId, assetCategory, attributes });
  } finally {
    client.release();
  }
}

export async function updateCollectionItem({ principalId, id, assetCategory, attributes } = {}) {
  requireFields({ principalId, id, attributes }, ['principalId', 'id', 'attributes']);
  if (typeof attributes !== 'object' || Array.isArray(attributes)) {
    throw new ValidationFailedError('attributes must be a JSON object');
  }
  const client = await acquireConnection();
  try {
    await assertPrincipalActive(client, principalId);
    const updated = await repo.updateItem(client, { id, principalId, assetCategory, attributes });
    if (!updated) throw new NotFoundError(`collection item ${id} does not exist`);
    return updated;
  } finally {
    client.release();
  }
}

export async function deleteCollectionItem({ principalId, id } = {}) {
  requireFields({ principalId, id }, ['principalId', 'id']);
  const client = await acquireConnection();
  try {
    await assertPrincipalActive(client, principalId);
    const deleted = await repo.deleteItem(client, principalId, id);
    if (!deleted) throw new NotFoundError(`collection item ${id} does not exist`);
    return { id, deleted: true };
  } finally {
    client.release();
  }
}
