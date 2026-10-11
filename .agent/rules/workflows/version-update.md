---
description: "Workflow to update the running axonhub to a new version tag (rebase my-branch, rebuild, atomic restart)"
---

# Version Update Workflow

When switching the codebase to a different version and updating the running system, follow these steps strictly:

1. **Version check and decision**
   * Check the local code version tag and the latest tag in the remote repository, for example with `git tag -l` or `git fetch upstream --tags`.
   * Always fetch tags from the `upstream` remote (the official repo). The `origin` remote is the personal fork, whose tags are only a snapshot from fork time and go stale.
   * Do not inspect the contents of the unstable branch; only inspect tags.
   * If the locally running version is older than the target version, continue with the update workflow. Otherwise, do nothing and report the current status to the user.

2. **Rebase `my-branch` onto the target tag and preserve local commits**
   * The repository must not be left in a detached HEAD state. Before and after every version update, `git branch --show-current` must report `my-branch`.
   * Switch to the persistent local branch with `git switch my-branch`. If it does not exist yet, create it from the current local commit with `git switch -c my-branch` before continuing.
   * Discard any build-related local files in the workspace (e.g., `git restore frontend/pnpm-lock.yaml internal/build/VERSION`) before rebasing. This ensures there are no conflicts on lockfiles or version config files.
   * Save other uncommitted custom changes, including untracked files, with `git stash push -u`.
   * Identify the old version tag that `my-branch` is currently based on and review the local custom commits after it with `git log <old-tag>..my-branch`.
   * Do not check out the target tag directly. Rebase the existing local commits onto the target tag while staying on `my-branch`, for example: `git rebase --onto <target-tag> <old-tag> my-branch`.
   * Resolve any rebase conflicts on your custom features without dropping local custom changes. Do not replace this workflow with checkout-and-cherry-pick.
   * Restore the saved workspace changes with `git stash pop`, resolve any resulting conflicts, and confirm that the target tag is an ancestor of `my-branch` with `git merge-base --is-ancestor <target-tag> my-branch`.
   * Push the rebased branch to the fork to keep the remote backup in sync: `git push origin my-branch --force-with-lease` (rebase rewrites history, so a plain push will be rejected).
   * Re-run `git branch --show-current` and stop with an error if the result is not `my-branch`.

3. **Code build**
   * From the repository root, run the project build command, for example `make build`, to package frontend static assets, sync static files, and compile the Go backend into the latest `axonhub` executable.
   * The Makefile automatically injects the base official tag (from `git describe --tags --abbrev=0`) into the backend via ldflags (`internal/build.Version`), matching how goreleaser injects the git tag into official release binaries. Rebuilding after local modifications keeps the same version; it only changes after rebasing onto a new release tag. An explicit `make build VERSION=<tag>` override is available but normally unnecessary.
   * Do not modify `internal/build/VERSION` — it is maintained upstream, lags behind tags, and is only a fallback for builds outside this repository (e.g. docker builds without git metadata).

4. **Hot reload and deploy the new service**
   * To avoid gateway disconnection caused by manually executing stop and start sequentially (especially when the AI assistant itself relies on this gateway), you must use the atomic script to stop, deploy, and launch the service in one go.
   * Run the restart script: `bash restart.sh`.
   * Check the startup status and logs to ensure the new version starts correctly.
