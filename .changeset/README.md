# Changesets

Every PR that changes an app or package adds a changeset: `pnpm changeset`. All `@semestra/*`
packages share one product version (`fixed`), so picking any one of them is enough.

Write the note for students in plain text (no Markdown), once in English and once in Chinese, one
change per file, and name the part of the app it is about with an `area` marker (a key of
[`areas.json`](areas.json)):

```md
---
"@semestra/web": minor
---

<!-- area: grades -->
<!-- en -->
Drag gradebook categories to reorder them.
<!-- zh -->
可以拖动调整成绩册的分类顺序。
```

- `major`: users must do something to keep working (backup format, API tokens / MCP, self-hosting config).
- `minor`: a new feature or a visible improvement. Shown in the "What's new" dialog.
- `patch`: a fix, copy or performance change. Listed on the About page, no dialog.
- Add `<!-- improved -->` on its own line to list a `minor` change under "Improved" instead of "New".
- The app, the docs changelog and the GitHub Release show the area's name before the note, so don't
  start the text with it ("Sem: …"). A new area goes into `areas.json` with its English and Chinese
  name; the order there is the order notes are listed in within a group.
- Internal-only changes (refactors, CI, tests): `pnpm changeset --empty`.

`pnpm release:check` validates the pending changesets; the release flow is in `scripts/release.mjs`.

## Pre-releases

`.changeset/pre.json` puts the repository in pre-release mode (`pnpm changeset pre enter beta`):
the version PR then makes `2.0.0-beta.0`, `2.0.0-beta.1`, … Each one's notes list only the
changesets added since the previous pre-release (Changesets moves the shipped ones to
`.changeset/pre/`). Its tag becomes a GitHub pre-release, its images don't move `latest`, and the
hosted app still deploys it like any release. `pnpm changeset pre exit` in a PR ends the mode: the
next version PR makes `2.0.0`, whose notes repeat everything since the last stable release, and
the "What's new" dialog shows those instead of the pre-releases'.
