#!/usr/bin/env bash
# One-off full-suite sweep for GrailKey Directive 2026-08-16-AL.
cd "$(dirname "$0")/.."
PASS=0
FAIL=0
TIMEOUT=0
FAILED_FILES=()
TIMEOUT_FILES=()
for f in tests/*.test.js; do
  out=$(timeout 25 node "$f" 2>&1)
  code=$?
  if [ $code -eq 124 ]; then
    TIMEOUT=$((TIMEOUT+1))
    TIMEOUT_FILES+=("$f")
  elif [ $code -eq 0 ]; then
    PASS=$((PASS+1))
  else
    FAIL=$((FAIL+1))
    FAILED_FILES+=("$f")
  fi
done
echo "PASS=$PASS FAIL=$FAIL TIMEOUT=$TIMEOUT TOTAL=$((PASS+FAIL+TIMEOUT))"
echo "--- FAILED ---"
printf '%s\n' "${FAILED_FILES[@]}"
echo "--- TIMEOUT ---"
printf '%s\n' "${TIMEOUT_FILES[@]}"
