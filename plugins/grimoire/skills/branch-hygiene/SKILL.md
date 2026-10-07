---
name: branch-hygiene
description: "Reaps the local branches and worktrees that Branch-and-PR efforts leave behind, and recovers commits stranded after a merge. Use when cleaning up local branches and worktrees left over after Branch-and-PR efforts, or when the SessionStart nudge flags reapable OR stranded branches. Triggers: branch cleanup, reap or prune merged branches, recover stranded post-merge commits, leftover or stale local branches, worktree cleanup, too many local branches sitting around."
---

# Branch Hygiene

This skill sweeps local branches and worktrees whose work has landed, under Safe Set and Hard Rules, and leaves everything else alone.

The SessionStart nudge flags **reapable** branches, merged and safe to sweep, and **stranded** ones, whose remote is gone because the PR merged while the branch holds commits that never reached the trunk. Stranded branches take priority: recover them before sweeping anything.

## Safe Set

A local branch is auto-reaped only if it is **verified merged into the integration branch**. For a branch with an open or merged pull request, the integration branch is that pull request's base as the host reports it, read at the act. On GitHub the read is `gh pr view <branch> --json state,baseRefName`, and the ref the procedures use is `origin/<baseRefName>`, after a fetch. Its base counts only where its state is OPEN or MERGED. Where it prints CLOSED or MERGED, `gh pr list --head <branch> --state all --json number,state,mergedAt,baseRefName` lists them, and the open one's base governs, else the most recently merged one's. On a GitHub remote, a read that fails for any reason but `no pull requests found` is a stop, not a fallback. For a branch with no open or merged pull request, a remote with no such read, or a merged pull request whose base is gone after the fetch or already an ancestor of the fallback (`git merge-base --is-ancestor origin/<baseRefName> <fallback>`), the integration branch is `origin/develop` if it exists, else `origin/main`, else `origin/master`. A merged pull request also takes that fallback where its base had already landed when it merged. A protected base never does: `develop`, `main`, `master` or the repo's default branch, which `gh repo view --json defaultBranchRef` names. Any other base had already landed where the governing pull request's `mergedAt` is later than every `mergedAt` that `gh pr list --head <baseRefName> --state all --json number,state,mergedAt` prints for the base's own merged pull requests. The governing pull request's `mergedAt` comes from the list row that governs. Where the base's list holds no merged pull request, the base governs. The session-start nudge resolves only that fallback, so a branch it flags as stranded is re-read against its pull request base before any recovery.

The sweep below tests every branch against that fallback, by ancestry, since one ref serves every branch and a branch whose work reached the trunk has landed whatever its base. A stacked branch whose work sits only in its parent is reaped once the parent lands. The ancestry test reads a merge-commit merge as landed, while a squash or rebase merge leaves a landed branch reading unmerged, which keeps it. A worktree is reaped only if it lives under `.claude/worktrees/`, sits on a reapable branch, and has a clean working tree.

Protected, never touched: `develop`, `main`, `master`, the current branch, the repo's default branch, and a worktree outside `.claude/worktrees/`.

## Procedure

1. `git fetch --prune` to refresh the integration and remote-tracking refs. If it fails or no integration ref resolves, stop and report without deleting.
2. Resolve the integration ref for the sweep, the fallback under Safe Set.
3. Compute the merged set: `git branch --merged <integration-ref>`, minus the protected list.
4. For each merged branch, record its tip SHA (`git rev-parse <name>`) before any delete. If the safe set admits its worktree, remove it, then `git branch -D <name>`.
5. Report in two parts:
   - **Reaped:** each branch and worktree removed, with `restore: git branch <name> <sha>`.
   - **Left for you, with the reason:** a branch with its upstream gone but unmerged; a branch ahead of the integration ref whose PR merged, likely stranded (see Stranded Branch Recovery); any other unmerged branch; any dirty worktree; any reapable-looking worktree outside `.claude/worktrees/`. List them and delete none.

## Stranded Branch Recovery

Recover a stranded branch's commits before deleting it. Here the integration ref is the stranded branch's own, per Safe Set:

1. Confirm the stranded commits: `git log --oneline <integration-ref>..<branch>`.
2. Branch fresh from the current integration ref: `git switch -c <branch>-recover <integration-ref>`. Never reuse the merged branch, which is frozen.
3. Bring the commits over: `git cherry-pick <integration-ref>..<branch>`.
4. Push the recovery branch and open a new PR against the integration branch.
5. Delete the stranded original only under the exception in "The only auto-delete trigger".

## Hard Rules

- The only auto-delete trigger is membership in `git branch --merged <integration-ref>`. Never `git branch -D` a branch outside that set, with one licensed exception: a stranded original once `git rev-parse --verify origin/<recovery>` prints the same hash as `git rev-parse <recovery>` and `git cherry <recovery> <stranded>` prints no `+` line. One condition missing is a report, not a delete. The branch must be checked out in no worktree, per `git worktree list`, and git's refusal is a report too. "Upstream gone" alone is a report, not a delete.
- Never `git worktree remove --force`. A dirty worktree is reported, never removed.
- Never touch anything on the protected list under Safe Set.
