#!/usr/bin/env bash
# Merges Pablo's prototype branch into the current branch (mar/ui-tests).
# Safe to run every day: it only merges, never rewrites history, and stops
# if the working tree is dirty or the merge conflicts.
set -euo pipefail

UPSTREAM="origin/PabloWiedemann/instances-landing-prototypes"
cd "$(git rev-parse --show-toplevel)"

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree has changes. Commit or stash them, then run again." >&2
  exit 1
fi

git fetch --quiet origin
behind=$(git rev-list --count "HEAD..$UPSTREAM")
if [ "$behind" -eq 0 ]; then
  echo "Already up to date with $UPSTREAM."
  exit 0
fi

echo "Merging $behind new commit(s) from $UPSTREAM..."
if ! git merge --no-edit "$UPSTREAM"; then
  echo "Merge conflict. Resolve it, then commit (or run: git merge --abort)." >&2
  exit 1
fi
echo "Done."
