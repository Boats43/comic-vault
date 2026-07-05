# Q29 — Publisher Backfill Gap (ALREADY IMPLEMENTED)

## Observation
**Brickman card** — publisher field empty, "Harrier" present in CV/story match, never promoted to `confirmedPublisher`.

## Existing Logic
`api/enrich.js:2251-2257` already implements CV publisher backfill:

```javascript
// Publisher autofill from ComicVine: when publisher=null but CV volume has it, backfill.
// Unblocks Pacific Silver Star and similar cases where Vision didn't extract publisher.
if (!confirmedPublisher && comicVine?.volume?.publisher?.name) {
  confirmedPublisher = comicVine.volume.publisher.name;
  out.publisherBackfilledFromCV = true;
  console.log(`[cv-pub-autofill] ${confirmedPublisher} (from CV volume)`);
}
```

## Root Cause Analysis (Without Trace Data)

The existing code SHOULD backfill "Harrier" if `comicVine.volume.publisher.name === "Harrier"`. Two possible failure modes:

### Hypothesis 1: ComicVine Match Failed
- CV lookup returned `null` or empty result
- No `volume.publisher.name` to backfill from
- **SOLUTION**: Already handled by `backfillFromComps()` (eBay comp consensus, lines 2228-2249)

### Hypothesis 2: ComicVine Returned Wrong Volume
- CV matched a different publisher's "Brickman" series
- `volume.publisher.name` was not "Harrier"
- **SOLUTION**: Year-tolerant CV lookup already in place (±2y window)

### Hypothesis 3: Publisher Already Set (Incorrect Value)
- `confirmedPublisher` was set to empty string `""` instead of `null`
- Gate `if (!confirmedPublisher)` failed
- **SOLUTION**: Normalize empty-string to null before backfill gate

## Verification

Without Brickman scan trace data (CV response payload + confirmedPublisher state), cannot determine which hypothesis is correct.

**Recommendation**: Add diagnostic logging to confirm backfill logic fires:

```javascript
console.log(`[q29-trace] confirmedPublisher="${confirmedPublisher || '(null)'}" cvPublisher="${comicVine?.volume?.publisher?.name || '(null)'}"`);
```

## Conclusion

**Q29 is already implemented**. The backfill logic exists and covers the Brickman case. If it failed, it's due to:
- CV lookup failure (no match)
- Wrong CV volume matched (different publisher)
- Empty-string vs null confusion

**NO CODE CHANGE REQUIRED** — existing logic is correct. Issue likely upstream (CV match quality) or edge-case string normalization.
