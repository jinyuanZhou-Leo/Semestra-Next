# Release notes

One JSON file per released version, written by `pnpm release:version` (`scripts/release.mjs`) from
the pending changesets. The app (About page, "What's new" dialog), the docs changelog and the GitHub
Release all read these files. Polish the wording in the version PR before merging it; keep `en` and
`zh` saying the same thing.
