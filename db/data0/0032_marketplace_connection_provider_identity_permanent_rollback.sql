SET search_path TO data1_dev;

DROP INDEX IF EXISTS marketplace_connection_provider_identity_uidx;

CREATE UNIQUE INDEX marketplace_connection_provider_identity_active_uidx
  ON marketplace_connection (provider, provider_user_id)
  WHERE connection_status IN ('CONNECTED', 'RECONNECT_REQUIRED');
