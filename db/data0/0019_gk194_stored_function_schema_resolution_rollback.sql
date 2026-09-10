-- =====================================================================
-- 0019 ROLLBACK -- GK-194: stored function schema resolution
-- =====================================================================
-- Restores the exact pre-GK-194 state expected on a fresh isolated
-- target: proconfig = NULL. Deliberately does NOT encode Development's
-- already-fixed historical state as any kind of fallback -- a fresh
-- target (Production/Preview at GK-179 provisioning time, or any future
-- rebuild) starts with proconfig = NULL, and that is what this rollback
-- returns to, unconditionally.
--
-- RESET (not a hardcoded re-SET to some other value) removes exactly the
-- search_path GUC this migration's forward text added, leaving
-- proconfig NULL again since it was the only entry -- symmetric with the
-- forward file's own single-purpose scope.
-- =====================================================================

ALTER FUNCTION data1_dev.asset_identifier_assertion_guard()
  RESET search_path;

ALTER FUNCTION data1_dev.asset_identity_assignment_guard()
  RESET search_path;
