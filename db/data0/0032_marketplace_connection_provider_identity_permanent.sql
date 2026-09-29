-- =====================================================================
-- 0032 -- GK-263 invariant-review correction. 0031's own provider-
-- identity uniqueness index was scoped to active states only
-- (CONNECTED/RECONNECT_REQUIRED), on the (incorrect, for Phase 1)
-- reasoning that a genuine disconnect should free a real provider
-- account for a different GrailKey principal to legitimately connect
-- later. A dedicated invariant review found this violates the actual
-- governing law: "a marketplace provider identity may not silently
-- migrate between GrailKey principals" — Phase 1 has NO account-transfer
-- or release semantic, so a DISCONNECTED row must still count as
-- "already claimed" by whichever principal first connected it.
--
-- Reproduced concretely: Principal A connects EBAY account X, disconnects
-- (row -> DISCONNECTED, provider_user_id column untouched -- still X),
-- then Principal B attempts to connect the same account X. Under 0031's
-- partial index, A's now-DISCONNECTED row drops out of the uniqueness
-- scope entirely, so B's INSERT succeeds -- a real, reproducible
-- cross-principal identity migration, not hypothetical.
--
-- Fix: drop the partial index, replace it with a PLAIN (permanent,
-- unconditional) unique index on (provider, provider_user_id) -- once
-- ANY principal's row (in any status) claims a provider account, no
-- OTHER principal's row may ever hold that same (provider,
-- provider_user_id) pair. This does not re-lock the SAME principal out
-- of their own account: reconnect updates the SAME existing row in
-- place (0031's own one-row-per-principal-provider design), so setting
-- provider_user_id back to a value the row itself already held is never
-- a uniqueness violation.
--
-- No other part of 0031 changes. No existing kernel table touched.
-- Reversibility: 0032_..._rollback.sql restores 0031's original partial
-- index exactly, dropping only the new plain one.
-- =====================================================================

SET search_path TO data1_dev;

DROP INDEX IF EXISTS marketplace_connection_provider_identity_active_uidx;

CREATE UNIQUE INDEX marketplace_connection_provider_identity_uidx
  ON marketplace_connection (provider, provider_user_id);
