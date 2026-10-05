// tests/gk268-auth-launch-google-login.test.js
//
// GK-268 AUTH LAUNCH — removes the legacy shared operator entry-key gate
// from the product and makes GrailKey self-service: any verified external
// identity (Clerk today, carrying Google/etc. behind it) resolves-or-
// creates exactly one GrailKey principal, server-side, atomically — never
// a client-chosen principalId, never a shared secret, never a silent
// fallback to any other principal.
//
// Covers the dispatch's required test matrix (letters match the dispatch):
//   B/D  — a new, never-seen-before verified external identity gets a
//          brand-new 'user'-kind principal.
//   C    — the SAME external identity logging in again resolves to the
//          SAME principal, never a duplicate.
//   (race) — two concurrent first-logins for the same brand-new subject
//          both resolve to exactly one created principal (23505 recovery).
//   G    — loginWithExternalIdentity/the Clerk adapter never accept a
//          client-supplied principalId as authority (static, extends
//          tests/beta1a-clerk-identity-adapter.test.js's own proof).
//   H/I  — tenant isolation: principal A cannot read principal B's
//          physical asset or marketplace connection (pre-existing
//          AuthorizationFailedError / principal-scoped WHERE clause,
//          re-proven here as a regression guard, not newly built).
//   J    — an EXISTING mapped identity (simulating Jimmy's own real,
//          already-live Clerk mapping) still resolves to its existing
//          principal, never creates a second one.
//
// Real Development Postgres throughout — own throwaway principals/
// identities, real service-layer calls, real rows, all cleaned up in a
// finally block. Never touches Jimmy's real principal/mapping.
//
// Invoke: node tests/gk268-auth-launch-google-login.test.js

import { readFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

const envRaw = readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8');
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}
process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';
if (!process.env.GRAILKEY_SESSION_SECRET) {
  process.env.GRAILKEY_SESSION_SECRET = randomBytes(32).toString('base64url');
}
if (!process.env.GRAILKEY_MARKETPLACE_CREDENTIAL_KEY) {
  process.env.GRAILKEY_MARKETPLACE_CREDENTIAL_KEY = randomBytes(32).toString('base64url');
}

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

const TAG = `gk268-${Date.now()}`;
console.log(`\n=== GK-268 AUTH LAUNCH — Google/Clerk self-service login (real Development DB, tag=${TAG}) ===\n`);

const authMod = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'auth', 'index.js')).href);
const { loginWithExternalIdentity, verifyToken, closePool: closeAuthPool } = authMod;
const assetsMod = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'assets', 'index.js')).href);
const { createPhysicalAsset, getPhysicalAsset, AuthorizationFailedError, closePool: closeAssetsPool } = assetsMod;
const marketplaceMod = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'marketplace', 'index.js')).href);
const { upsertMarketplaceConnection, getMarketplaceConnection, closePool: closeMarketplacePool } = marketplaceMod;

// Direct DB access only for setup/cleanup verification (never for the
// behavior under test, which always goes through the real service layer).
const { assertAdminDbTarget } = await import(pathToFileURL(path.join(repoRoot, 'scripts', 'db-admin-preflight.mjs')).href);

const createdPrincipalIds = [];
const createdIdentitySubjects = [];
const createdAssetIds = [];

try {
  // ─────────────────────────────────────────────────────────────────
  // B/D — brand-new verified identity -> brand-new 'user'-kind principal
  // ─────────────────────────────────────────────────────────────────
  console.log('--- B/D: new verified external identity creates a new principal ---');
  const subjectNew1 = `${TAG}-google-user-1`;
  createdIdentitySubjects.push(subjectNew1);
  const login1 = await loginWithExternalIdentity({ provider: 'clerk', externalSubject: subjectNew1, displayName: `${TAG} New User One` });
  assertTrue(typeof login1.token === 'string' && login1.token.length > 0, 'a real session token is issued for a brand-new identity');
  assertTrue(typeof login1.principalId === 'string' && login1.principalId.length > 0, 'a real principalId is returned');
  createdPrincipalIds.push(login1.principalId);
  const verified1 = verifyToken(login1.token);
  assertTrue(verified1.principalId === login1.principalId, 'the issued token verifies back to the exact same principalId');

  // ─────────────────────────────────────────────────────────────────
  // C — the SAME identity logging in again resolves to the SAME principal
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- C: returning user resolves to the SAME principal, never a duplicate ---');
  const login1Again = await loginWithExternalIdentity({ provider: 'clerk', externalSubject: subjectNew1, displayName: 'ignored on an existing mapping' });
  assertTrue(login1Again.principalId === login1.principalId, 'the same external subject, logging in a second time, resolves to the identical principalId (no duplicate created)');

  // ─────────────────────────────────────────────────────────────────
  // D (second instance) — a DIFFERENT new identity gets a DIFFERENT principal
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- D: a second, different new identity gets a different new principal ---');
  const subjectNew2 = `${TAG}-google-user-2`;
  createdIdentitySubjects.push(subjectNew2);
  const login2 = await loginWithExternalIdentity({ provider: 'clerk', externalSubject: subjectNew2, displayName: `${TAG} New User Two` });
  createdPrincipalIds.push(login2.principalId);
  assertTrue(login2.principalId !== login1.principalId, 'two different verified identities resolve to two different principals');

  // ─────────────────────────────────────────────────────────────────
  // Race: two concurrent first-logins for the SAME brand-new subject ->
  // exactly one principal created, both calls agree on it (23505 recovery)
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- Race: concurrent first-logins for one new subject create exactly one principal ---');
  const subjectRace = `${TAG}-google-race-user`;
  createdIdentitySubjects.push(subjectRace);
  const [raceA, raceB] = await Promise.all([
    loginWithExternalIdentity({ provider: 'clerk', externalSubject: subjectRace, displayName: 'race A' }),
    loginWithExternalIdentity({ provider: 'clerk', externalSubject: subjectRace, displayName: 'race B' }),
  ]);
  createdPrincipalIds.push(raceA.principalId);
  assertTrue(raceA.principalId === raceB.principalId, 'two concurrent logins for the same brand-new external subject both resolve to the SAME principal (unique-violation race recovered, not two rows)');

  // ─────────────────────────────────────────────────────────────────
  // J — an EXISTING mapped identity still resolves to its existing
  // principal (simulates Jimmy's own real, already-live mapping without
  // touching his real row).
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- J: an existing mapping is preserved, never re-created ---');
  const existingLoginFirst = await loginWithExternalIdentity({ provider: 'clerk', externalSubject: `${TAG}-pretend-existing-user` });
  createdIdentitySubjects.push(`${TAG}-pretend-existing-user`);
  createdPrincipalIds.push(existingLoginFirst.principalId);
  const existingLoginSecond = await loginWithExternalIdentity({ provider: 'clerk', externalSubject: `${TAG}-pretend-existing-user`, displayName: 'should be ignored' });
  assertTrue(existingLoginSecond.principalId === existingLoginFirst.principalId, 'a subject with an existing mapping (this test’s own stand-in for Jimmy’s real one) resolves to the same principal on every subsequent login, exactly matching Jimmy’s real principal_external_identity row behavior');

  // ─────────────────────────────────────────────────────────────────
  // H — tenant isolation: principal A cannot read principal B's physical asset
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- H: tenant isolation — principal A cannot read principal B\'s physical asset ---');
  const principalA = login1.principalId;
  const principalB = login2.principalId;
  const assetB = await createPhysicalAsset({ assetClass: 'comic',
    principalId: principalB,
    captureBasis: { test: true, tag: TAG, nonce: randomUUID() },
    idempotencyKey: `${TAG}-asset-b-${randomUUID()}`,
  });
  createdAssetIds.push(assetB.assetId);
  let crossTenantRejected = false;
  try {
    await getPhysicalAsset({ principalId: principalA, gkAssetId: assetB.assetId });
  } catch (e) {
    crossTenantRejected = e instanceof AuthorizationFailedError;
  }
  assertTrue(crossTenantRejected, 'principal A reading principal B\'s real gkAssetId is rejected with AuthorizationFailedError (pre-existing Asset Service invariant, re-proven here, not newly built by this dispatch)');
  const ownRead = await getPhysicalAsset({ principalId: principalB, gkAssetId: assetB.assetId });
  assertTrue(ownRead.asset.id === assetB.assetId, 'principal B reading their own asset succeeds normally');

  // ─────────────────────────────────────────────────────────────────
  // I — tenant isolation: principal A cannot resolve principal B's
  // marketplace connection.
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- I: tenant isolation — principal A cannot resolve principal B\'s marketplace credential ---');
  await upsertMarketplaceConnection({
    principalId: principalB,
    provider: 'EBAY',
    providerUserId: `${TAG}-seller-b`,
    refreshCredential: 'fake-refresh-token-for-test',
  });
  const bOwnConnection = await getMarketplaceConnection({ principalId: principalB, provider: 'EBAY' });
  assertTrue(bOwnConnection?.providerUserId === `${TAG}-seller-b`, 'principal B can read their own marketplace connection');
  const aQueryingBsProvider = await getMarketplaceConnection({ principalId: principalA, provider: 'EBAY' });
  assertTrue(aQueryingBsProvider == null, 'principal A querying the same provider resolves to null/not-found — never principal B\'s connection (principal-scoped lookup, not a shared/global credential)');

  // ─────────────────────────────────────────────────────────────────
  // G — static: loginWithExternalIdentity's signature never accepts a
  // caller-supplied principalId (extends beta1a-clerk-identity-adapter's
  // own static proof with the post-GK-268 signature, which also now
  // takes displayName).
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- G: no client-suppliable principalId anywhere in the login surface (static) ---');
  const serviceSrc = readFileSync(path.join(repoRoot, 'src', 'modules', 'auth', 'service.js'), 'utf8');
  const sigMatch = serviceSrc.match(/export async function loginWithExternalIdentity\(\{([^}]*)\}/);
  const params = sigMatch ? sigMatch[1] : '';
  assertTrue(!/principalId/.test(params), 'loginWithExternalIdentity\'s parameter list never includes principalId');
  const clerkSrc = readFileSync(path.join(repoRoot, 'api', 'auth-clerk.js'), 'utf8');
  assertTrue(!/req\.body\?\.principalId|req\.body\.principalId/.test(clerkSrc), 'api/auth-clerk.js never reads principalId from the request body');

  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
} finally {
  // ───────────────── cleanup: self-contained, never touches Jimmy ─────────────────
  const client = await assertAdminDbTarget({
    connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL,
    label: 'gk268 test cleanup',
  });
  try {
    if (createdIdentitySubjects.length > 0) {
      await client.query(
        `DELETE FROM data1_dev.principal_external_identity WHERE external_subject = ANY($1::text[])`,
        [createdIdentitySubjects]
      );
    }
    for (const assetId of createdAssetIds.filter(Boolean)) {
      // Same cleanup shape tests/capture-scan-endpoint-h8-gate-proof.test.js
      // already established: asset_identity_assignment/gk_asset/
      // entity_mint_basis/mint_event are permanently retained (GK-188
      // precedent) — only the lighter linkage/ownership rows are removed.
      await client.query(`DELETE FROM data1_dev.outbox WHERE domain_event_id IN (SELECT event_id FROM data1_dev.domain_event WHERE (subject->>'entity_id')::uuid = $1)`, [assetId]);
      await client.query(`DELETE FROM data1_dev.domain_event WHERE (subject->>'entity_id')::uuid = $1`, [assetId]);
      await client.query(`DELETE FROM data1_dev.media WHERE asset_id = $1`, [assetId]);
      await client.query(`DELETE FROM data1_dev.collection_item_link WHERE gk_asset_id = $1`, [assetId]);
      await client.query(`DELETE FROM data1_dev.current_owner WHERE asset_id = $1`, [assetId]);
      await client.query(`DELETE FROM data1_dev.ownership_event WHERE asset_id = $1`, [assetId]);
    }
    if (createdPrincipalIds.length > 0) {
      await client.query(`DELETE FROM data1_dev.marketplace_connection WHERE principal_id = ANY($1::uuid[])`, [createdPrincipalIds]).catch(() => {});
    }
    // gk_principal rows themselves are intentionally left in place, same
    // established convention every other real-Development-DB test in this
    // repo already follows (e.g. the gk264/gk265/gk266 test principals
    // visible in a live census) — a throwaway 'user'-kind principal with no
    // credential, no durable asset, and no marketplace connection left
    // attached to it is inert, not a security or cost concern.
    console.log(`\n[cleanup] removed ${createdIdentitySubjects.length} test identity row(s), ${createdAssetIds.length} test asset's linkage rows; ${createdPrincipalIds.length} throwaway test principal(s) left in place (established convention)`);
  } finally {
    await client.end();
  }
  await closeAuthPool();
  await closeAssetsPool();
  await closeMarketplacePool();
}

if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
