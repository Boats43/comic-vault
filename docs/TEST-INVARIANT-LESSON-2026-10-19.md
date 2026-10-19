# Engineering principle — tests must enforce invariants, not implementation magnitudes (2026-10-19)

**Tests must enforce meaningful behavioral or structural invariants, not arbitrary implementation magnitudes.**

## Evidence (the first full sweep of RC `56b2448`)
- `grailkey-commit-f` asserted `api/enrich.js` has fewer than 11,813 lines. The file had 13,811 lines at `ba82e93`; the assertion was a snapshot of file size at commit time and failed on every tree for a reason unrelated to the behavior under test.
- `grailkey-commit-v1` asserted exactly 24 `writeConfirmed` call-assignments. The count was already 31-33.
- Behind that first failure sat **two more hidden count pins**: `variantIdentitySource` "exactly 5 assignments" (8 at `ba82e93`) and `identitySource` "exactly 5 assignments" (6).
- `dispatch-42-comicvine-kill` pinned "exactly 7 comicVine merge paths" (9 now) while the structural invariant it exists for (no stale `cur/s/item` fallback) passed in the same file.
- **A structural invariant caught a real gap that the counts hid:** `grailkey-commit-v1`'s "no bare (unwrapped) post-anchor assignment to a confirmed* field" assertion — a structural wrapper invariant — was failing because of a genuine unwrapped identity write, the GK-152 comps-pool issue rescue (`confirmedIssue = gk152Rescue.issue`). That write bypassed identity provenance and (traced in B3) was fed by circular evidence. A magnitude pin could never have told the difference between "a new wrapped site was added" and "an identity write escaped the wrapper".
- Other source-pin failures were mis-tuned to the platform rather than the contract: `gk184` and `d5a` strip comments with `/\/\/.*$/` and fail on CRLF checkouts; `gk201` matched the word "mint" in the panel's own comments; `gk252` demanded a `|| 'comic'` default that Universal U1 deliberately removed; `eux` bounded a source block with a marker that became `export function`.

## What replaced them (commit `17b10bb`, on `v1-source-authority`)
Behavioral or structural contracts: an explicit, documented exception list for unwrapped identity writes (a new unwrapped write fails); coverage per identity field; the logger must never write the identity trackers; no mint CODE (comments stripped) in the operator panel; `assetType` is threaded and never defaulted.

## Roster denominator
**Unchanged.** The correction replaced assertions in four existing files; no test file was added or deleted (RC roster 469, corrected branch 471 = RC + two new files from the authority work). Credit where due: the prior correction kept the denominator honest instead of deleting inconvenient tests.

## Rule going forward
A pin on a count, a line number, a file size or a literal string is acceptable only when that exact value IS the contract. Otherwise assert the property the number was standing in for, and make the failure message name it.
