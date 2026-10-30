#!/usr/bin/env bash
# Vercel "Ignored Build Step" for the app (apps/web), docs (apps/docs) and landing (apps/site)
# projects: exit 0 skips the build, exit 1 builds. Vercel runs it from the project's root directory.
#
#   vercel-ignore-build.sh <web|docs|site>
#
# Every deployment is kept and counts towards deployment storage, so build only what changed:
# - The version PR branch and the temporary branch changesets/action pushes its commit through
#   (changesets-ghcommit-temp/...) never build.
# - Production for the app and docs only builds the commit that merges a version PR (it
#   adds release-notes/<version>.json), so the hosted frontend changes when a release is cut. Deploy
#   the backend before merging the version PR when the API changed.
# - Previews, and production for the landing site, build only when a file the project is built
#   from changed since the branch's last successful deployment (or the previous commit).
set -u

# Paths are relative to the project's root directory (apps/<name>).
shared=(../../pnpm-lock.yaml ../../package.json ../../pnpm-workspace.yaml ../../scripts/vercel-ignore-build.sh)
case "${1:-}" in
    web) release=1 paths=(. ../../packages ../../release-notes "${shared[@]}") ;;
    docs) release=1 paths=(. ../../packages/api-client ../../release-notes ../../.changeset/areas.json ../web/messages "${shared[@]}") ;;
    site) release=0 paths=(. "${shared[@]}") ;;
    *)
        echo "build: unknown project '${1:-}'"
        exit 1
        ;;
esac

case "${VERCEL_GIT_COMMIT_REF:-}" in
    changeset-release/* | changesets-ghcommit-temp/*)
        echo "skip: version PR branch"
        exit 0
        ;;
esac

if [[ "${VERCEL_ENV:-}" == production && $release == 1 ]]; then
    # The version PR is merged with a merge commit; its first parent is the previous main. The
    # pathspec is anchored at the repository root (`:/`), since this runs from apps/web or apps/docs.
    added=$(git diff --name-only --diff-filter=A HEAD^ HEAD -- ':/release-notes/*.json') || {
        echo "build: cannot diff against HEAD^"
        exit 1
    }
    if [[ -n "$added" ]]; then
        echo "build: release $added"
        exit 1
    fi
    echo "skip: production builds only on releases"
    exit 0
fi

base=${VERCEL_GIT_PREVIOUS_SHA:-}
if [[ -z "$base" ]] || ! git cat-file -e "$base^{commit}" 2>/dev/null; then
    base=HEAD^
fi
changed=$(git diff --name-only "$base" HEAD -- "${paths[@]}") || {
    echo "build: cannot diff against $base"
    exit 1
}
if [[ -n "$changed" ]]; then
    echo "build: changed since $base"
    exit 1
fi
echo "skip: nothing for this project changed since $base"
exit 0
