#!/usr/bin/env bash
# Vercel "Ignored Build Step" for the app (apps/web) and docs (apps/docs) projects: exit 0 skips
# the build, exit 1 builds. Production only builds the commit that merges a version PR (it adds
# release-notes/<version>.json), so the hosted frontend changes when a release is cut, not on
# every push to main. Deploy the backend before merging the version PR when the API changed.
# Previews still build for PR branches, except the version PR branch itself.
set -u

if [[ "${VERCEL_GIT_COMMIT_REF:-}" == changeset-release/* ]]; then
    echo "skip: version PR branch"
    exit 0
fi

if [[ "${VERCEL_ENV:-}" != production ]]; then
    echo "build: preview"
    exit 1
fi

# The version PR is merged with a merge commit; its first parent is the previous main.
if git diff --name-only --diff-filter=A HEAD^ HEAD -- release-notes/ 2>/dev/null | grep -q '\.json$'; then
    echo "build: release $(git diff --name-only --diff-filter=A HEAD^ HEAD -- release-notes/)"
    exit 1
fi

echo "skip: production builds only on releases"
exit 0
