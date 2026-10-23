# Changelog

Generated from `release-notes/*.json` by `scripts/release.mjs`; do not edit by hand.
The same notes in Chinese are in the JSON files and on the docs site.

## 1.2.1 (2026-10-23)

### Fixed

- Closing a dialog no longer makes the blurred background flash back for a moment.

## 1.2.0 (2026-10-23)

### New

- Sem keeps working when you close or reload the page, and the conversation picks up where it is when you come back.

### Improved

- Grades: a course percentage is now rounded to a whole number before its letter grade and GPA are looked up (84.5% counts as 85%). You can turn this off in the Program's GPA settings.
- Account security: creating an API token or changing your email asks for your password if you signed in more than 10 minutes ago, changing or resetting your password also revokes your API tokens, and your old address is told when your email changes.

### Fixed

- Files and imports: import uploads count toward your storage, unsubmitted imports are cleaned up after 30 days, and two commits of the same import can no longer both write. File processing is faster and more robust (first-page thumbnails only, scanned pages read in parallel and one bad page no longer fails the file, missing embeddings are retried). Search is quicker, long file lists scroll smoothly, and uploads show real progress. Syllabus imports wait for course files that are still processing, read GBK text and phone photos correctly, cancel classes on "no class" dates, and share category weights across their assessments.
- Grades: with "Hide GPA" on, letter grades are hidden too.
- Calendar: opening an assessment deadline goes to the course's grades and highlights that assessment.
- Grades: plan mode no longer shows the average so far as the planned grade; it says how many items still need an assumed score.
- Canvas: pages load faster, Refresh fetches the course once instead of skipping the cache from then on, and the app no longer stalls while a Canvas file preview loads.
- Restoring a large backup no longer makes other saves fail while its files are copied; the last 3 backups are kept, and a new upload replaces one you did not restore.
- Fixed: the "manage devices" link in sign-in emails, signing up again right after deleting an account, and Sem turning Canvas writes or memory back on by itself. API: settings values moved to /me/settings.
- Live updates send fewer requests: changes arriving together refresh once, and reconnecting no longer reloads every page's data.
- Calendar export: exporting many weeks as PNG or PDF no longer fails.
- Calendar import: ICS files now keep moved and cancelled classes and every repeat rule. Importing the same file again keeps the sections you hid and your notes, removes cancellations the file no longer has, and no longer duplicates exams.
- Course schedule: "Keep only this section" now keeps every weekly class of that section.
- Course schedule: moved classes show their new end time, and subscribed calendars in Outlook pick up changes to classes.
- Deleting a term now keeps the events of courses that continue in other terms.
- Sem: changes you approved on a card no longer show as failed steps, update cards show what each field was before, and tidying Sem's memory no longer slows the app down.
- AI settings: the small model's purpose is now called "Light tasks", since it also summarizes long conversations and tidies Sem's memory.
- Tasks: tasks made from assessments now follow course deletes and setting changes, the Completed section loads faster, and term lists show tasks from every term.

## 1.1.1 (2026-10-22)

### Fixed

- Calendar: exporting the weekly timetable right after opening Export no longer comes out empty, and editing a class from its details says so when it no longer exists.

## 1.1.0 (2026-10-22)

### New

- Canvas tab: an opened assignment shows when it opens and closes, how to submit, how many attempts you have, why it is locked, and your grade with your teacher's comments and rubric. Modules show your progress, prerequisites and what each item needs, and quizzes show the time limit, attempts and your score.
- Canvas tab: the Files tab is back, with folders and search by file name. Word, PowerPoint and Excel files can be previewed as text.
- Grades posted on Canvas for imported assignments now show up in "Review changes", so you can bring them into your gradebook.
- New setting under Integrations: allow changes on the platform. When it's on, opening an announcement here also marks it read on Canvas. It's off by default, and Semestra then only reads.

### Fixed

- Pages open faster: hovering a link gets the page ready, and the app loads less code and data up front.

## 1.0.0 (2026-10-21)

### New

- Semestra 1.0: terms and courses, schedule and calendar, tasks, grades and GPA planning, course files, imports from syllabi, calendars and Canvas, and Sem, an assistant that works across all of them and asks before it changes anything.
