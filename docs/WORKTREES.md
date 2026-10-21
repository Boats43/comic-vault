# Worktree registry

Generated 2026-10-21T17:33Z directly from `git worktree list --porcelain` and `git status` (read-only, `--no-optional-locks`). **29 worktrees.** Dirty/clean is a snapshot and goes stale; re-run before relying on it. Cached refs (`origin/main` = `ba82e93`) do not establish current remote or Production state.

Classes: CANDIDATE (release-track), BASELINE (frozen comparison point), WIP (uncommitted/in-flight, do not touch), ARCHIVED (do not modify), UNCLASSIFIED (purpose not confirmed; branch name is a hint only, not a fact).

| Path | Branch / state | HEAD | Status | Class | Purpose | Modify? |
|---|---|---|---|---|---|---|
| `C:/Users/matam/OneDrive/Desktop/comic-vault` | `main` | `97c0397` | DIRTY (8 modified, 14 untracked) | ARCHIVED | Local main (97c0397); diverged from cached origin/main; carries uncommitted work | NO - DO NOT MODIFY |
| `C:/gk-oauth-id` | `gk-oauth-seller-identity-proof` | `e4c637d` | clean | UNCLASSIFIED | Not confirmed (branch name: gk-oauth-seller-identity-proof) | NO until classified |
| `C:/gk281/b1` | `b1-preflight-records` | `fe37bbb` | clean | UNCLASSIFIED | Not confirmed (branch name: b1-preflight-records) | NO until classified |
| `C:/gk281/gate` | `gk300-evidence-capacity` | `a9a5fe3` | clean | UNCLASSIFIED | Not confirmed (branch name: gk300-evidence-capacity) | NO until classified |
| `C:/gk281/impl` | `gk281-attempt-idempotency` | `5e36226` | clean | UNCLASSIFIED | Not confirmed (branch name: gk281-attempt-idempotency) | NO until classified |
| `C:/gk281/l1` | `launch1-security` | `b403f33` | clean | UNCLASSIFIED | Not confirmed (branch name: launch1-security) | NO until classified |
| `C:/gk281/work` | `(detached)` | `7fc2e20` | clean | BASELINE | Detached at 7fc2e20 (same commit as gk280a-grade-proof) | NO |
| `C:/Users/matam/AppData/Local/Temp/claude/C--Users-matam-OneDrive-Desktop-comic-vault/fd650eb8-af57-4db8-8e25-90fd814fb8ee/scratchpad/wt` | `gk-identity-authority-fix` | `fa903bb` | clean | UNCLASSIFIED | Not confirmed (branch name: gk-identity-authority-fix) | NO until classified |
| `C:/Users/matam/cv-auth` | `auth-entry-redesign` | `8c19a8e` | clean | UNCLASSIFIED | Not confirmed (branch name: auth-entry-redesign) | NO until classified |
| `C:/Users/matam/cv-ba82-baseline` | `(detached)` | `ba82e93` | clean | BASELINE | Detached at ba82e93 (cached origin/main) | NO |
| `C:/Users/matam/cv-failbefore` | `(detached)` | `ba82e93` | DIRTY (0 modified, 18 untracked) | WIP | Detached at ba82e93 with 18 untracked paths (fail-before experiments; not inspected) | NO |
| `C:/Users/matam/cv-p0c-check` | `gk-p0c-rescue-boundary` | `f9da6ae` | clean | UNCLASSIFIED | Not confirmed (branch name: gk-p0c-rescue-boundary) | NO until classified |
| `C:/Users/matam/cv-source-authority` | `v1-source-authority` | `ba19141` | DIRTY (8 modified, 8 untracked) | CANDIDATE | v1-source-authority: Gate B candidate branch; its 16 uncommitted paths are checkpointed on wip/gate-b-pricing-2026-10-21 (a633d62) and in the recovery backup | NO while it holds the original uncommitted work |
| `C:/Users/matam/cv-title-integrity` | `gk-title-integrity` | `09aba86` | clean | UNCLASSIFIED | Not confirmed (branch name: gk-title-integrity) | NO until classified |
| `C:/Users/matam/cv-v1-rc` | `v1-certification-rc` | `56b2448` | clean | CANDIDATE | v1-certification-rc: certification release-candidate branch | NO without explicit authorization |
| `C:/Users/matam/cv-wip-gate-b` | `wip/gate-b-pricing-2026-10-21` | `a633d62` | DIRTY (0 modified, 1 untracked) | WIP | Isolated Gate B pricing-repair worktree (this registry's home); branch wip/gate-b-pricing-2026-10-21 is NOT a release candidate | YES (the repair worktree) |
| `C:/Users/matam/gk-gateb-wt` | `gk-gateb-raw-copy` | `ec0deb7` | clean | UNCLASSIFIED | Not confirmed (branch name: gk-gateb-raw-copy) | NO until classified |
| `C:/Users/matam/gkwt-280a` | `gk280a-grade-proof` | `7fc2e20` | clean | UNCLASSIFIED | Not confirmed (branch name: gk280a-grade-proof) | NO until classified |
| `C:/Users/matam/OneDrive/Desktop/comic-vault/.claude/worktrees/agent-a30e21973fd4ce7b8` | `worktree-agent-a30e21973fd4ce7b8` | `17b10cc` | DIRTY (1 modified, 0 untracked) | WIP | Claude agent/slice worktree with one modified file (not inspected) | NO |
| `C:/Users/matam/OneDrive/Desktop/comic-vault/.claude/worktrees/agent-a913bbc37aa59ae39` | `worktree-agent-a913bbc37aa59ae39` | `17b10cc` | DIRTY (1 modified, 0 untracked) | WIP | Claude agent/slice worktree with one modified file (not inspected) | NO |
| `C:/Users/matam/OneDrive/Desktop/comic-vault/.claude/worktrees/agent-ad55e1a1c62dba031` | `worktree-agent-ad55e1a1c62dba031` | `17b10cc` | DIRTY (1 modified, 0 untracked) | WIP | Claude agent/slice worktree with one modified file (not inspected) | NO |
| `C:/Users/matam/OneDrive/Desktop/comic-vault/.claude/worktrees/agent-af4a9d94be57ca674` | `worktree-agent-af4a9d94be57ca674` | `17b10cc` | DIRTY (1 modified, 0 untracked) | WIP | Claude agent/slice worktree with one modified file (not inspected) | NO |
| `C:/Users/matam/OneDrive/Desktop/comic-vault/.claude/worktrees/slice7-scan-ownership` | `worktree-slice7-scan-ownership` | `af32d21` | DIRTY (1 modified, 0 untracked) | WIP | Claude agent/slice worktree with one modified file (not inspected) | NO |
| `C:/Users/matam/OneDrive/Desktop/comic-vault-rc-isolated` | `rc/grade-authority-control-plane` | `5c989d9` | clean | UNCLASSIFIED | Not confirmed (branch name: rc/grade-authority-control-plane) | NO until classified |
| `C:/Users/matam/OneDrive/Desktop/cv-dup-entry` | `dup-entry-closeout` | `8a951a9` | clean | UNCLASSIFIED | Not confirmed (branch name: dup-entry-closeout) | NO until classified |
| `C:/Users/matam/OneDrive/Desktop/cv-dup-release` | `dup-entry-release` | `1928cf0` | clean | UNCLASSIFIED | Not confirmed (branch name: dup-entry-release) | NO until classified |
| `C:/Users/matam/OneDrive/Desktop/cv-head-wt` | `(detached)` | `b7d24d6` | DIRTY (0 modified, 2 untracked) | WIP | Detached at b7d24d6 with untracked paths (not inspected) | NO |
| `C:/Users/matam/OneDrive/Desktop/cv-scan-latency` | `gk-p0c-issue-authority-local` | `30e6926` | clean | UNCLASSIFIED | Not confirmed (branch name: gk-p0c-issue-authority-local) | NO until classified |
| `C:/Users/matam/slice7-baseline-d58bce8` | `(detached)` | `d58bce8` | clean | BASELINE | Detached at d58bce8 baseline | NO |

## Local main vs cached origin/main
Local `main` (97c0397) has 4 commits not in cached `origin/main` (ba82e93), and is 50 commits behind it. Each of the four is contained in **no other local or remote-tracking branch** (checked with `git branch -a --contains`); they are unique to local main as far as refs show.

- `97c0397` 2026-10-05 15:45:05 -0700 Grade authority control plane: remove client/model-confidence gradeLocked, observe prediction-provenance failures, record evidence metadata
- `d32ca0d` 2026-10-05 15:05:57 -0700 Grade evidence sufficiency: annotate front-only grades PROVISIONAL, never alter grade (grading fairness audit)
- `4769657` 2026-10-04 20:23:56 -0700 Pricing experience + Daredevil authority closeout: three-concept pricing surface, $0 != unknown, research comparability, key-descriptor title guard
- `d74a4b0` 2026-10-04 19:47:26 -0700 Record Production migration 0039 (applied) + proof that category is validated before SQL

Production build `ba82e93` was observed earlier; this file does not verify it.
