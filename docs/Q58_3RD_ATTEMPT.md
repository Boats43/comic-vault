# Q58 [P2] — 3rd Attempt: Backfill Block Never Executes

## Problem Statement
Zero [Q58] lines in production logs. Backfill block (commit 3edf3c0, line 1677) never executes.

## Current Code (api/enrich.js:1677)
```javascript
if (!issueNum && parsedVisualRows && parsedVisualRows.length > 0) {
  const issuePattern = /#\s*(\d+)/;
  const issueCounts = {};
  parsedVisualRows.forEach(r => {
    const match = (r.title || '').match(issuePattern);
    if (match) {
      const num = match[1];
      issueCounts[num] = (issueCounts[num] || 0) + 1;
    }
  });
  const totalVisual = parsedVisualRows.length;
  const consensusEntry = Object.entries(issueCounts)
    .sort((a, b) => b[1] - a[1])[0];
  if (consensusEntry) {
    const [issueBackfill, count] = consensusEntry;
    const ratio = count / totalVisual;
    if (ratio >= 0.70) {
      issueNum = issueBackfill;
      issueBackfilledFromVisual = true;
      issueBackfillProvenance = `${count}/${totalVisual} visual consensus`;
      console.log(`[Q58] backfilled issue=${issueBackfill} from ${(ratio * 100).toFixed(0)}% visual consensus (${count}/${totalVisual})`);
    }
  }
}
```

## Trace Points

### Point 1: Block Entry (line 1677)
Add log BEFORE `if (!issueNum ...)` to see if block condition is even evaluated:
```javascript
console.log(
  `[Q58-trace] ENTRY: issueNum="${issueNum}" ` +
  `parsedVisualRows.length=${parsedVisualRows?.length || 0}`
);
```

### Point 2: Inside Block
Already has log at line 1698 `[Q58] backfilled issue=...` but only fires if ratio ≥70%.
Add log when consensusEntry exists but ratio <70%:
```javascript
if (consensusEntry) {
  const [issueBackfill, count] = consensusEntry;
  const ratio = count / totalVisual;
  console.log(`[Q58-trace] consensus: issue=${issueBackfill} ratio=${(ratio*100).toFixed(0)}%`);
  if (ratio >= 0.70) {
    // ... backfill logic
  } else {
    console.log(`[Q58-trace] SKIP: ratio ${(ratio*100).toFixed(0)}% < 70%`);
  }
}
```

## Expected Cases

### Case A: Block Never Reached
```
[Q58-trace] ENTRY: issueNum="1" parsedVisualRows.length=18
```
→ issueNum ALREADY SET, block skipped (Vision got it right)

### Case B: Block Reached But No Consensus
```
[Q58-trace] ENTRY: issueNum="" parsedVisualRows.length=18
[Q58-trace] consensus: issue=1 ratio=45%
[Q58-trace] SKIP: ratio 45% < 70%
```
→ Consensus too weak

### Case C: Block Reached AND Backfills
```
[Q58-trace] ENTRY: issueNum="" parsedVisualRows.length=20
[Q58-trace] consensus: issue=1 ratio=90%
[Q58] backfilled issue=1 from 90% visual consensus (18/20)
```
→ SUCCESS

## Next Actions
1. Deploy trace instrumentation
2. Scan Cavewoman (Vision misses issue, should trigger backfill)
3. Check [Q58-trace] logs
4. Fix based on actual execution path
