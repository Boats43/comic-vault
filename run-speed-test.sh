#!/bin/bash
# Speed Baseline Test — run all 5 vault books through enrich locally

echo "=========================================="
echo "SPEED BASELINE TEST"
echo "=========================================="
echo ""

BOOKS=(
  "groo-1"
  "batman-lotdk-62"
  "punisher-1"
  "marvel-westerns-1"
  "amazing-spider-man-300"
)

for book in "${BOOKS[@]}"; do
  echo "Testing: $book"
  echo "──────────────────────────────────────────"

  curl -s -X POST http://localhost:3000/api/enrich \
    -H "Content-Type: application/json" \
    -d @test-books/${book}.json \
    2>&1 | grep -E '\[timing\]|claudeCheck' | head -20

  echo ""
  echo ""
done

echo "=========================================="
echo "TEST COMPLETE"
echo "=========================================="
