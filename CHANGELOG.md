# Changelog

Generated from `release-notes/*.json` by `scripts/release.mjs`; do not edit by hand.
The same notes in Chinese are in the JSON files and on the docs site.

## 1.3.0 (2026-10-27)

### New

- **AI:** The AI usage page can now show just today's requests, tokens and estimated cost.
- **Settings:** The theme previews in Settings → Preferences now show a more detailed mini app and follow your accent color in all three modes, and picking an accent color plays a short focus animation.
- **Data:** Settings → Data now shows how much of your storage you use, what takes the space (by course or file type), and how much data your account holds.
- **Sem:** See how full a conversation is and compact it yourself, from the ring by the input or with /compact, keeping what you name. Compacted turns are marked and their summary can be opened.
- **Sem:** Skills picked with / and courses or terms picked with @ now show as chips right in the text you type, and in your sent messages.

### Improved

- **Settings:** AI providers and LMS connections show brand logos and short statuses, adding DeepSeek, Kimi, Qwen or OpenRouter only asks for a key, and each AI task picks its model from one searchable list.
- **AI:** The Permissions page now covers both Sem and MCP clients. Choose whether Sem asks before every change, by module, or never, and turn on deleting for MCP clients in the same place.
- **Overview & Today:** Drag a card's corner to resize it, click a card to change its size, settings or remove it, see card contents while editing, and get more columns on large screens instead of stretched cards.
- **Canvas:** Files show their size and last update in columns and can be sorted by name, size or date.
- **Canvas:** A cleaner course menu with icons and an "Open in Canvas" group, scores and status badges for assignments, quizzes and grades, overdue module items marked, and announcement previews.
- **Grades:** Term grades: the page now matches the course gradebook, with a breakdown ring of each course's credits, the term GPA beside it, and a Plan mode where you type the final percentages you expect and set a term GPA to aim for.

### Fixed

- **AI:** The add-provider dialog now scrolls on small windows instead of running off the screen.
- **Import:** Long syllabi are no longer cut off and reported as having no useful information, and an AI provider account out of credit now says so.
- **Overview & Today:** Cards no longer wiggle, resizing from the corner is smoother, every card resizes from its bottom-right corner, and removing a card asks first.
- **Overview & Today:** A dragged card now follows the pointer smoothly instead of jumping from cell to cell.
- **Canvas:** Previewing, downloading and saving Canvas files works again, and images inside Canvas pages load.
- **General:** Course, habit and sticky-note color pickers now use the same animated swatches as the accent color, and the selection ring settles a little faster.
- **General:** Closing a dialog no longer makes the blurred background flash back for a moment.
- **Grades:** "Group by category" and "Count unfinished" in the gradebook are now switches, so it is clear whether they are on.
- **Grades:** GPA settings: the preset picker now shows the conversion table in use, and picking another preset switches the table after a confirmation.
- **General:** The "Add term" picker in the sidebar and the level path in settings keep a small gap between highlighted rows again.
- **Sem:** An approved change and the answer after it can be followed after a reload or in another tab, and a slow title no longer holds up the answer.
- **Sem:** Long conversations keep more of what was said, since what earlier lookups returned is cleared before anything is summarized, and pressing Stop while compacting ends the turn and keeps the history as it was.
- **Sem:** A change you approve after the conversation has moved on is no longer lost when you regenerate or edit a message.
- **Sem:** Sem keeps trying to learn from a conversation while your AI provider is unreachable, instead of giving up after a few tries.
- **Sem:** With providers that reuse tool call ids, approvals and steps now match the right answer.
- **Sem:** A scanned PDF page that cannot be rendered is noted in the conversation instead of breaking the answer.
- **Settings:** Changing the language, clock format or first day of the week in Settings no longer makes the settings window close and pop open again.
- **Sem:** The slash commands in the skills menu now line up at the right edge.
- **Account:** In the "Create API token" dialog, the permission and expiry options no longer sit in a track stretched across the whole dialog.

## 1.2.0 (2026-10-23)

### New

- **Sem:** Sem keeps working when you close or reload the page, and the conversation picks up where it is when you come back.

### Improved

- **Grades:** A course percentage is now rounded to a whole number before its letter grade and GPA are looked up (84.5% counts as 85%). You can turn this off in the Program's GPA settings.
- **Account:** Account security: creating an API token or changing your email asks for your password if you signed in more than 10 minutes ago, changing or resetting your password also revokes your API tokens, and your old address is told when your email changes.

### Fixed

- **Files:** Files and imports: import uploads count toward your storage, unsubmitted imports are cleaned up after 30 days, and two commits of the same import can no longer both write. File processing is faster and more robust (first-page thumbnails only, scanned pages read in parallel and one bad page no longer fails the file, missing embeddings are retried). Search is quicker, long file lists scroll smoothly, and uploads show real progress. Syllabus imports wait for course files that are still processing, read GBK text and phone photos correctly, cancel classes on "no class" dates, and share category weights across their assessments.
- **Grades:** With "Hide GPA" on, letter grades are hidden too.
- **Calendar:** Opening an assessment deadline goes to the course's grades and highlights that assessment.
- **Grades:** Plan mode no longer shows the average so far as the planned grade; it says how many items still need an assumed score.
- **Canvas:** Pages load faster, Refresh fetches the course once instead of skipping the cache from then on, and the app no longer stalls while a Canvas file preview loads.
- **Data:** Restoring a large backup no longer makes other saves fail while its files are copied; the last 3 backups are kept, and a new upload replaces one you did not restore.
- **Account:** The "manage devices" link in sign-in emails, signing up again right after deleting an account, and Sem turning Canvas writes or memory back on by itself. API: settings values moved to /me/settings.
- **General:** Live updates send fewer requests: changes arriving together refresh once, and reconnecting no longer reloads every page's data.
- **Calendar:** Calendar export: exporting many weeks as PNG or PDF no longer fails.
- **Calendar:** Calendar import: ICS files now keep moved and cancelled classes and every repeat rule. Importing the same file again keeps the sections you hid and your notes, removes cancellations the file no longer has, and no longer duplicates exams.
- **Calendar:** Course schedule: "Keep only this section" now keeps every weekly class of that section.
- **Calendar:** Course schedule: moved classes show their new end time, and subscribed calendars in Outlook pick up changes to classes.
- **Terms & courses:** Deleting a term now keeps the events of courses that continue in other terms.
- **Sem:** Changes you approved on a card no longer show as failed steps, update cards show what each field was before, and tidying Sem's memory no longer slows the app down.
- **AI:** AI settings: the small model's purpose is now called "Light tasks", since it also summarizes long conversations and tidies Sem's memory.
- **Tasks:** Tasks: tasks made from assessments now follow course deletes and setting changes, the Completed section loads faster, and term lists show tasks from every term.

## 1.1.1 (2026-10-22)

### Fixed

- **Calendar:** Exporting the weekly timetable right after opening Export no longer comes out empty, and editing a class from its details says so when it no longer exists.

## 1.1.0 (2026-10-22)

### New

- **Canvas:** An opened assignment shows when it opens and closes, how to submit, how many attempts you have, why it is locked, and your grade with your teacher's comments and rubric. Modules show your progress, prerequisites and what each item needs, and quizzes show the time limit, attempts and your score.
- **Canvas:** The Files tab is back, with folders and search by file name. Word, PowerPoint and Excel files can be previewed as text.
- **Canvas:** Grades posted on Canvas for imported assignments now show up in "Review changes", so you can bring them into your gradebook.
- **Canvas:** New setting under Integrations: allow changes on the platform. When it's on, opening an announcement here also marks it read on Canvas. It's off by default, and Semestra then only reads.

### Fixed

- **General:** Pages open faster: hovering a link gets the page ready, and the app loads less code and data up front.

## 1.0.0 (2026-10-21)

### New

- **General:** Semestra 1.0: terms and courses, schedule and calendar, tasks, grades and GPA planning, course files, imports from syllabi, calendars and Canvas, and Sem, an assistant that works across all of them and asks before it changes anything.
