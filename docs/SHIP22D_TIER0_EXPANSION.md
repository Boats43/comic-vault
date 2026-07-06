# Ship #22d — TIER-0 TABLE EXPANSION (Deferred)

## STATUS
**DEFERRED TO NEXT SESSION** — 22c complete, 22d requires 21+ entries + convergence lock logic.

## REQUIREMENTS
1. Expand `api/mega-keys.js` MEGA_KEYS_FLOOR from 29 → 50 entries
2. Add convergence <70 lock (hard block listing when identity confidence LOW)
3. Log: `[22d] tier0-locked convergence=N`

## ENTRIES TO ADD (21 remaining)
Core tier-0 mega-keys missing from current 29-entry table:

**Silver Age (10)**:
- Fantastic Four #1 (1961) — 1st FF
- Amazing Spider-Man #1 (1963) — 1st solo series
- X-Men #1 (1963) — 1st X-Men
- Avengers #1 (1963) — 1st Avengers
- Journey Into Mystery #83 (1962) — 1st Thor
- Tales of Suspense #39 (1963) — 1st Iron Man
- Tales to Astonish #27 (1962) — 1st Ant-Man
- Strange Tales #110 (1963) — 1st Doctor Strange
- Brave and the Bold #28 (1960) — 1st Justice League
- Green Lantern #76 (1970) — Neal Adams run start

**Bronze Age (6)**:
- House of Secrets #92 (1971) — 1st Swamp Thing
- Hero for Hire #1 (1972) — 1st Luke Cage
- Werewolf by Night #32 (1975) — 1st Moon Knight
- Marvel Spotlight #5 (1972) — 1st Ghost Rider
- All-Star Comics #58 (1976) — 1st Power Girl
- Green Lantern #87 (1971) — Death of Green Arrow's sidekick

**Modern (5)**:
- Walking Dead #1 (2003) — AMC series
- Saga #1 (2012) — BKV Image launch
- Bone #1 (1991) — Jeff Smith indie
- Sandman #1 (1989) — Neil Gaiman Vertigo
- Preacher #1 (1995) — Garth Ennis Vertigo

## CONVERGENCE LOCK LOGIC
Location: `api/enrich.js` after mega-key floor application

```javascript
// Ship #22d: Tier-0 convergence lock
if (out.megaKey?.badge && out.convergence?.convergenceScore < 70) {
  out.tier0Locked = true;
  out.decision = {
    action: 'DO_NOT_LIST',
    confidence: 'LOW',
    blockers: ['MEGA-KEY: verify identity before listing (convergence < 70)'],
    warnings: [],
    nextSteps: [
      'Verify title/issue/year/publisher match expected book',
      'Check convergence card for source disagreements',
      'Confirm this is the correct printing/era'
    ],
  };
  console.log(`[22d] tier0-locked: "${confirmedTitle}" #${confirmedIssue} convergence=${out.convergence.convergenceScore}`);
}
```

## NEXT SESSION
1. Add 21 entries to `api/mega-keys.js`
2. Wire convergence lock into `enrich.js` post-mega-key-floor
3. Test gate: ASM #1 (1963) with PC 2016 mismatch → convergence <70 → locked
4. Commit Ship #22d
