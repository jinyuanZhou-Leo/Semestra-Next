# Changelog

Generated from `release-notes/*.json` by `scripts/release.mjs`; do not edit by hand.
The same notes in Chinese are in the JSON files and on the docs site.

## 1.11.0 (2026-11-01)

### Improved

- **General:** Card settings now look like the rest of Settings, and every form dialog has a Cancel button next to its main action.
- **Calendar:** Calendar export is now a menu with image or PDF (with a live preview), calendar file and subscription link.
- **Calendar:** Each program now has one calendar subscription link that you can copy any time, change what it includes, or reset.
- **Calendar:** The calendar week view now matches the timetable's look.

### Fixed

- **General:** Clearer, more consistent wording across the interface.
- **Calendar:** Fixed the week number in the calendar, the day order in exported images for Sunday-start weeks, and the time format in month view.
- **Account:** Limited how many times a sign-in code can be checked for one email address per day, to better protect accounts.

## 1.10.0 (2026-10-31)

### New

- **Settings:** Choose which page Semestra opens on, including where you left off.

### Improved

- **General:** The sidebar now holds the current term's pages and courses, with a term switcher above them; term pages no longer have a tab bar.
- **Overview & Today:** Cards make better use of their space: small cards drop the title row, long lists fade at the edge to show they scroll, and schedule entries open with a click.
- **Terms & courses:** Read a course's details from a file such as its syllabus in the course settings: pick a file, check the changes, apply.
- **Grades:** Clearer GPA cards: the overview adds a GPA bar for each term, and the charts line up across terms.
- **Calendar:** The week card now shows the coming days starting from yesterday, sized to fit your classes.
- **Calendar:** The course schedule is reorganized into weekly meetings, one-off events and cancellations, sections can be switched on or off as a whole, and you can now cancel or move a single class from it.
- **Tasks:** Task lists are shown in a column on the Tasks page instead of the sidebar.
- **Files:** Upload files from a term's Files page by choosing a course or dropping them on its section, and drop files on a folder to upload into it.
- **Plugins:** The habit calendar is now part of the habit card: check in on the ring and review past weeks beside it. Existing calendar cards are converted automatically.

### Fixed

- **Sem:** Fixed the last characters of an edited message sometimes being dropped when it was sent with Enter.
- **Files:** Fixed a stray horizontal scrollbar under the file list.
- **Import:** Reading a syllabus with Claude models works again, and is faster: course info, grading and schedule are read side by side.

## 1.9.0 (2026-10-30)

### New

- **API & MCP:** MCP tools are streamlined: adding items always takes a list, and failed calls include a hint on what to do next.

### Fixed

- **Sem:** Sem's tool definitions are leaner, so each request uses less context.
- **Sem:** Token counts now show in k and M, and the context usage bar no longer shows stray lines.
- **Sem:** Sem picks the right tools more reliably and recovers from failed actions with clearer guidance.
- **API & MCP:** API reference pages in the docs load faster.

## 1.8.0 (2026-10-30)

### Improved

- **Overview & Today:** Cards show a skeleton while they load.
- **Terms & courses:** Every "Add course" button now offers the same choices as the new-term wizard: enter courses manually, continue a full-year course from last term, or import them from a calendar file, syllabus, screenshot, pasted text or your LMS.

### Fixed

- **General:** Performance improvements.
- **Sem:** When no AI provider is set up, Sem shows the setup prompt directly instead of briefly showing the chat first.
- **AI:** The provider list in the Add provider dialog now fills the full width.
- **AI:** When adding a known compatible service, its address, model and capabilities now sit under a lighter "Endpoint settings" section.

## 1.7.0 (2026-10-29)

### New

- **General:** On a phone, Semestra opens a simpler app with Today, Tasks and Sem, and it can be added to your home screen.

## 1.6.0 (2026-10-28)

### New

- **AI:** OCR of scanned pages has its own model setting, so you can use a cheaper model than the one for images.
- **Self-hosting:** Self-hosted servers read scanned PDFs and photos on their own with PaddleOCR (also in Docker on a Mac), without calling any AI model, and each user can pick the OCR model in settings. A model downloads the first time it is needed, and you can watch its progress.

## 1.5.0 (2026-10-28)

### New

- **Files:** You can turn off automatic indexing of new files for a Program or a course, and index a file only when you need it.

### Improved

- **Sem:** Hover the context ring to see what fills the conversation, and compact it from the bottom of that card; while it compacts, the messages being summarized fade in place.
- **Terms & courses:** When you sign up you can choose "Add later" instead of creating your first term, and add it from Terms & courses once the term starts.
- **Tasks:** A task you check off now stays in place for 5 seconds with a short animation before it moves to Completed, so you can uncheck it if you tapped by mistake.

### Fixed

- **Terms & courses:** The number of weeks shown next to a term's dates now counts calendar weeks, so a term that starts mid-week is no longer a week short.
- **Files:** When a file can't be processed, the file list says why next to the retry button.
- **Files:** While a file is being processed, the file list shows which step it is on (such as reading pages 12/48) next to its progress bar.
- **Account:** The "Continue with Google" button on the sign-in page no longer overlaps the "or" divider or shows a white box in dark mode, and it now matches the width of the form.

## 1.4.0 (2026-10-27)

### Improved

- **Terms & courses:** Creating a term now takes two steps: pick the term's dates in one range calendar that shows the number of weeks, edit breaks in a table, and create the term right from the course list, where continuing year-long courses and each imported course's source are shown. Date pickers now follow your language and first day of the week.
- **Import:** Add from a syllabus, screenshot or calendar file right in each page's Add menu, read a file already in the course with "Read with AI…", and watch each file's upload progress.
- **Canvas:** Link a course to Canvas from its settings by searching one list, with the matching course suggested first, and see its status and actions in a single row.
- **Settings:** The "What's new" dialog and the release notes in Settings → About mark New, Improved and Fixed with their own icon and color, and within each, notes are listed under the part of the app they are about.

### Fixed

- **General:** While the app loads, an outline of the sidebar (or the Semestra logo) shows right away instead of a blank page.
- **General:** The app downloads less code when it starts and asks for your data sooner, so it opens faster on slow connections.
- **General:** Pages opened from a link or after a refresh show their data sooner, and the term calendar shows a week's classes as soon as you move to it.
- **General:** Pages stay responsive in the seconds after they load, and changing a preference no longer reloads your preferences twice.
- **Sem:** The Sem side panel opens faster, and the full Sem page shows your conversation list sooner.
- **Overview & Today:** Cards on Today and on a term's overview show their content sooner.
- **Tasks:** Selecting and checking off tasks in a long list responds faster, and task due dates show weekdays in the app's language.
- **Canvas:** In the Canvas tab's assignments, the columns no longer shift when you open an assignment or fold a group.
- **Canvas:** In the Canvas tab, assignments you already imported now show a dimmed checkbox, so it is clear they can't be ticked again.

## 1.3.0 (2026-10-27)

### New

- **Sem:** See how full a conversation is and compact it yourself, from the ring by the input or with /compact, keeping what you name. Compacted turns are marked and their summary can be opened.
- **Sem:** Skills picked with / and courses or terms picked with @ now show as chips right in the text you type, and in your sent messages.
- **AI:** The AI usage page can now show just today's requests, tokens and estimated cost.
- **Settings:** The theme previews in Settings → Preferences now show a more detailed mini app and follow your accent color in all three modes, and picking an accent color plays a short focus animation.
- **Data:** Settings → Data now shows how much of your storage you use, what takes the space (by course or file type), and how much data your account holds.

### Improved

- **Overview & Today:** Drag a card's corner to resize it, click a card to change its size, settings or remove it, see card contents while editing, and get more columns on large screens instead of stretched cards.
- **Grades:** The term grades page now matches the course gradebook, with a breakdown ring of each course's credits, the term GPA beside it, and a Plan mode where you type the final percentages you expect and set a term GPA to aim for.
- **Canvas:** Files show their size and last update in columns and can be sorted by name, size or date.
- **Canvas:** A cleaner course menu with icons and an "Open in Canvas" group, scores and status badges for assignments, quizzes and grades, overdue module items marked, and announcement previews.
- **AI:** AI providers and LMS connections show brand logos and short statuses, adding DeepSeek, Kimi, Qwen or OpenRouter only asks for a key, and each AI task picks its model from one searchable list.
- **AI:** The Permissions page now covers both Sem and MCP clients. Choose whether Sem asks before every change, by module, or never, and turn on deleting for MCP clients in the same place.

### Fixed

- **General:** Course, habit and sticky-note color pickers now use the same animated swatches as the accent color, and the selection ring settles a little faster.
- **General:** Closing a dialog no longer makes the blurred background flash back for a moment.
- **General:** The "Add term" picker in the sidebar and the level path in settings keep a small gap between highlighted rows again.
- **Sem:** An approved change and the answer after it can be followed after a reload or in another tab, and a slow title no longer holds up the answer.
- **Sem:** Long conversations keep more of what was said, since what earlier lookups returned is cleared before anything is summarized, and pressing Stop while compacting ends the turn and keeps the history as it was.
- **Sem:** A change you approve after the conversation has moved on is no longer lost when you regenerate or edit a message.
- **Sem:** Sem keeps trying to learn from a conversation while your AI provider is unreachable, instead of giving up after a few tries.
- **Sem:** With providers that reuse tool call ids, approvals and steps now match the right answer.
- **Sem:** A scanned PDF page that cannot be rendered is noted in the conversation instead of breaking the answer.
- **Sem:** The slash commands in the skills menu now line up at the right edge.
- **Overview & Today:** Cards no longer wiggle, resizing from the corner is smoother, every card resizes from its bottom-right corner, and removing a card asks first.
- **Overview & Today:** A dragged card now follows the pointer smoothly instead of jumping from cell to cell.
- **Grades:** "Group by category" and "Count unfinished" in the gradebook are now switches, so it is clear whether they are on.
- **Grades:** The preset picker in GPA settings now shows the conversion table in use, and picking another preset switches the table after a confirmation.
- **Import:** Long syllabi are no longer cut off and reported as having no useful information, and an AI provider account out of credit now says so.
- **Canvas:** Previewing, downloading and saving Canvas files works again, and images inside Canvas pages load.
- **AI:** The add-provider dialog now scrolls on small windows instead of running off the screen.
- **Settings:** Changing the language, clock format or first day of the week in Settings no longer makes the settings window close and pop open again.
- **Account:** In the "Create API token" dialog, the permission and expiry options no longer sit in a track stretched across the whole dialog.

## 1.2.0 (2026-10-23)

### New

- **Sem:** Sem keeps working when you close or reload the page, and the conversation picks up where it is when you come back.

### Improved

- **Grades:** A course percentage is now rounded to a whole number before its letter grade and GPA are looked up (84.5% counts as 85%). You can turn this off in the Program's GPA settings.
- **Account:** Creating an API token or changing your email asks for your password if you signed in more than 10 minutes ago, changing or resetting your password also revokes your API tokens, and your old address is told when your email changes.

### Fixed

- **General:** Live updates send fewer requests: changes arriving together refresh once, and reconnecting no longer reloads every page's data.
- **Sem:** Changes you approved on a card no longer show as failed steps, update cards show what each field was before, and tidying Sem's memory no longer slows the app down.
- **Terms & courses:** Deleting a term now keeps the events of courses that continue in other terms.
- **Grades:** With "Hide GPA" on, letter grades are hidden too.
- **Grades:** Plan mode no longer shows the average so far as the planned grade; it says how many items still need an assumed score.
- **Calendar:** Opening an assessment deadline goes to the course's grades and highlights that assessment.
- **Calendar:** Exporting many calendar weeks as PNG or PDF no longer fails.
- **Calendar:** Importing an ICS file now keeps moved and cancelled classes and every repeat rule. Importing the same file again keeps the sections you hid and your notes, removes cancellations the file no longer has, and no longer duplicates exams.
- **Calendar:** "Keep only this section" in a course's schedule now keeps every weekly class of that section.
- **Calendar:** Moved classes in a course's schedule show their new end time, and subscribed calendars in Outlook pick up changes to classes.
- **Tasks:** Tasks made from assessments now follow course deletes and setting changes, the Completed section loads faster, and term lists show tasks from every term.
- **Files:** Import uploads count toward your storage, unsubmitted imports are cleaned up after 30 days, and two commits of the same import can no longer both write. File processing is faster and more robust (first-page thumbnails only, scanned pages read in parallel and one bad page no longer fails the file, missing embeddings are retried). Search is quicker, long file lists scroll smoothly, and uploads show real progress. Syllabus imports wait for course files that are still processing, read GBK text and phone photos correctly, cancel classes on "no class" dates, and share category weights across their assessments.
- **Canvas:** Pages load faster, Refresh fetches the course once instead of skipping the cache from then on, and the app no longer stalls while a Canvas file preview loads.
- **AI:** The small model's purpose in AI settings is now called "Light tasks", since it also summarizes long conversations and tidies Sem's memory.
- **Account:** The "manage devices" link in sign-in emails, signing up again right after deleting an account, and Sem turning Canvas writes or memory back on by itself. API: settings values moved to /me/settings.
- **Data:** Restoring a large backup no longer makes other saves fail while its files are copied; the last 3 backups are kept, and a new upload replaces one you did not restore.

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
