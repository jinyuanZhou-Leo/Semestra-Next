# Release notes

One JSON file per released version, written by `pnpm release:version` (`scripts/release.mjs`) from
the pending changesets. The app (About page, "What's new" dialog), the docs changelog and the GitHub
Release all read these files. Don't edit them by hand: polish the wording in the `.changeset/*.md`
files (in the feature PR, or on `main` before releasing). The version PR is rebuilt and
force-pushed after every push to `main`, so edits made there are lost unless nothing else merges
before it. `date` is the day (America/Toronto) the version PR was last rebuilt; if the PR has sat
for a while, run the Version workflow by hand (Actions → Version → Run workflow) before merging.
