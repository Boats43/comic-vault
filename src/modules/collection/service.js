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
import { ValidationFailedError, AuthorizationFailedError, NotFoundError, CategoryImmutableError } from './errors.js';
import { isSupportedAssetCategory, describeSupportedCategories } from '../../lib/assetCategories.js';
import { appendOperatorCorrectionEventTx } from '../learning/index.js';
import { planGradingCorrections, planIdentityCorrection } from '../../lib/operatorCorrectionPlan.js';

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

export async function createCollectionItem({ principalId, id, assetCategory, attributes } = {}) {
  requireFields({ principalId, id, attributes }, ['principalId', 'id', 'attributes']);
  // U1 — NO DEFAULT CATEGORY. A missing/unknown category never becomes 'comic'.
  if (!isSupportedAssetCategory(assetCategory)) {
    throw new ValidationFailedError(`assetCategory is required and must be one of ${describeSupportedCategories()} (no default), got: ${assetCategory === undefined ? 'undefined' : JSON.stringify(assetCategory)}`);
  }
  if (typeof attributes !== 'object' || Array.isArray(attributes)) {
    throw new ValidationFailedError('attributes must be a JSON object');
  }
  const client = await acquireConnection();
  try {
    await assertPrincipalActive(client, principalId);
    const row = await repo.upsertItem(client, { id, principalId, assetCategory, attributes });
    if (!row) {
      throw new CategoryImmutableError(`collection item ${id} already exists with a different category; category is immutable (no reclassification)`);
    }
    return row;
  } finally {
    client.release();
  }
}

export async function updateCollectionItem({ principalId, id, assetCategory, attributes } = {}) {
  requireFields({ principalId, id, attributes }, ['principalId', 'id', 'attributes']);
  if (typeof attributes !== 'object' || Array.isArray(attributes)) {
    throw new ValidationFailedError('attributes must be a JSON object');
  }
  if (assetCategory !== undefined && assetCategory !== null && !isSupportedAssetCategory(assetCategory)) {
    throw new ValidationFailedError(`assetCategory must be one of ${describeSupportedCategories()}, got: ${JSON.stringify(assetCategory)}`);
  }
  const client = await acquireConnection();
  try {
    await assertPrincipalActive(client, principalId);
    const updated = await repo.updateItem(client, { id, principalId, assetCategory, attributes });
    if (!updated) {
      // Distinguish a missing row from a category mismatch (the update only applies when the
      // supplied category equals the stored one).
      const existing = assetCategory ? await repo.getByPrincipalAndId(client, principalId, id) : null;
      if (existing) throw new CategoryImmutableError(`collection item ${id} has a different category; category is immutable (no reclassification)`);
      throw new NotFoundError(`collection item ${id} does not exist`);
    }
    return updated;
  } finally {
    client.release();
  }
}

// GK-260 (Server-Owned Write Authority) — the ONLY way to durably set,
// change, or clear operatorGrade/operatorGradeNumeric/operatorGradeSetAt/
// gradeAuthority/operatorIsGraded/gradingFormatAuthority. Called
// exclusively from api/enrich.js, and only after a validated
// setOperatorGrade/clearOperatorGrade/setOperatorGradingFormat/
// clearOperatorGradingFormat result — `patch` must be that function's own
// output, never raw request-body fields. `principalId` comes from
// api/enrich.js's own verified Bearer-token resolution (the same
// GK-254 auth check that already gates the durable-row read this patch
// follows), never from the request body. repo.applyGradingAuthorityPatch
// independently filters `patch` to the six protected keys as defense in
// depth.
//
// GK-278: the mutation and the operator_correction_event(s) that record it commit in ONE
// transaction under a row lock -- both or neither. A patch that changes nothing logically
// performs neither (no mutation without an event, no event without a mutation).
// `correction` carries only server-resolved context: { gkAssetId, source, reason, buildSha }.
async function runCorrectionTx({ principalId, id, plan, correction, apply }) {
  const client = await acquireConnection();
  try {
    await assertPrincipalActive(client, principalId);
    await client.query('BEGIN');
    try {
      const attrs = await repo.lockItemAttributes(client, { id, principalId });
      if (!attrs) throw new NotFoundError(`collection item ${id} does not exist`);
      const p = plan(attrs);
      if (p.noop) {
        await client.query('COMMIT');
        const current = await repo.getByPrincipalAndId(client, principalId, id);
        return { ...current, correctionEventIds: [], correctionNoop: true };
      }
      const updated = await apply(client, p.mutation);
      const relatedPredictionEventId = attrs?.modelPredictedProvenance?.predictionEventId ?? null;
      const eventIds = [];
      for (const ev of p.events) {
        const eid = await appendOperatorCorrectionEventTx(client, {
          principalId, collectionItemId: id, gkAssetId: correction?.gkAssetId ?? null,
          surface: ev.surface, action: ev.action,
          beforeValue: ev.beforeValue, afterValue: ev.afterValue,
          authorityBefore: ev.authorityBefore, authorityAfter: ev.authorityAfter,
          relatedPredictionEventId, source: correction?.source ?? null, reason: correction?.reason ?? null,
          buildSha: correction?.buildSha ?? null,
        });
        if (eid) eventIds.push(eid);
      }
      await client.query('COMMIT');
      return { ...updated, correctionEventIds: eventIds, correctionNoop: false };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  } finally {
    client.release();
  }
}

export async function applyGradingAuthorityPatch({ principalId, id, patch, correction } = {}) {
  requireFields({ principalId, id }, ['principalId', 'id']);
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    throw new ValidationFailedError('patch must be a JSON object');
  }
  return runCorrectionTx({
    principalId, id, correction,
    plan: (attrs) => planGradingCorrections(attrs, patch),
    apply: async (client, mutation) => {
      const updated = await repo.applyGradingAuthorityPatch(client, { id, principalId, patch: mutation });
      if (!updated) throw new NotFoundError(`collection item ${id} does not exist`);
      return updated;
    },
  });
}

// GK-261 — write-once model baseline from a SERVER-CLAIMED grade receipt.
// `baseline` must be claimGradeReceipt's output; api/collection.js is the only caller.
export async function claimModelBaseline({ principalId, id, baseline } = {}) {
  requireFields({ principalId, id }, ['principalId', 'id']);
  if (typeof baseline !== 'object' || baseline === null || Array.isArray(baseline)) {
    throw new ValidationFailedError('baseline must be a JSON object');
  }
  const client = await acquireConnection();
  try {
    await assertPrincipalActive(client, principalId);
    const out = await repo.claimModelBaselinePatch(client, { id, principalId, baseline });
    if (!out.item) throw new NotFoundError(`collection item ${id} does not exist`);
    return out;
  } finally {
    client.release();
  }
}

// GK-261 — the ONLY durable write path for identityAuthority; api/enrich.js only,
// after a validated manual-correction request on a verified, owned item.
export async function applyIdentityAuthorityPatch({ principalId, id, identityAuthority, correction } = {}) {
  requireFields({ principalId, id }, ['principalId', 'id']);
  if (typeof identityAuthority !== 'object' || identityAuthority === null || Array.isArray(identityAuthority)) {
    throw new ValidationFailedError('identityAuthority must be a JSON object');
  }
  return runCorrectionTx({
    principalId, id, correction,
    plan: (attrs) => planIdentityCorrection(attrs, {
      fields: correction?.fields, afterValues: correction?.afterValues, mergedAuthority: identityAuthority,
    }),
    apply: async (client, mutation) => {
      const updated = await repo.applyIdentityAuthorityPatch(client, { id, principalId, identityAuthority: mutation.identityAuthority, values: mutation.values });
      if (!updated) throw new NotFoundError(`collection item ${id} does not exist`);
      return updated;
    },
  });
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

// GRAILKEY — COLLECTION IMAGE SYNC (2026-09-19). See
// repository.js's getRemoteImageUri for the deliberate no-principal-scope
// rationale. Used only by api/collection-image.js.
export async function getRemoteImageUri({ id, index = 0 } = {}) {
  requireFields({ id }, ['id']);
  const client = await acquireConnection();
  try {
    return await repo.getRemoteImageUri(client, id, index);
  } finally {
    client.release();
  }
}
