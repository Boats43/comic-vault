#!/bin/bash
# A6 DEPLOY-PING: Assert production build matches HEAD after push

set -e

PROD_URL="https://comic-vault-rouge.vercel.app"
LOCAL_HASH=$(git rev-parse --short HEAD)

echo "[deploy-ping] Local HEAD: $LOCAL_HASH"
echo "[deploy-ping] Curling $PROD_URL/api/grade..."

# Warm ping to trigger cold start
curl -s -X POST "$PROD_URL/api/grade" \
  -H "Content-Type: application/json" \
  -d '{"warmup": true}' > /dev/null 2>&1

sleep 2

# Fetch build ID from response header
REMOTE_HASH=$(curl -s -I -X POST "$PROD_URL/api/grade" \
  -H "Content-Type: application/json" \
  -d '{"warmup": true}' | grep -i 'x-cv-build' | awk '{print $2}' | tr -d '\r\n')

echo "[deploy-ping] Remote build: $REMOTE_HASH"

if [ "$REMOTE_HASH" == "$LOCAL_HASH" ]; then
  echo "[deploy-ping] ✅ MATCH — production is running $LOCAL_HASH"
  exit 0
else
  echo "[deploy-ping] ❌ MISMATCH — local=$LOCAL_HASH remote=$REMOTE_HASH"
  exit 1
fi
