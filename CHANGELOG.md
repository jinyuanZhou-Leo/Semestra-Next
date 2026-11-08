# Changelog

Generated from `release-notes/*.json` by `scripts/release.mjs`; do not edit by hand.
The same notes in Chinese are in the JSON files and on the docs site.

## 2.0.0-beta.2 (2026-11-08)

### New

- **Sem:** Sem searches and reads everything in your Canvas courses, including page text, discussions and your teachers' feedback, and can tell you what is new across a term.

### Improved

- **Calendar:** The course schedule groups sections by type, pre-fills the next section code, and can merge a section into an existing one with the same code.
- **Account:** Sensitive account actions now confirm it's you in place, with your password, an email code or Google, instead of signing you out.
- **API & MCP:** Connect Cursor, Claude Code, VS Code, Codex and other MCP clients from Settings in two steps, with the API token already filled in.

### Fixed

- **Sem:** Unsent messages and attachments in Sem are kept when you open settings, switch pages or close the panel, and Sem reopens the conversation you were in.
- **Terms & courses:** The sidebar shows a course's full title on hover only when the row shows its alias or code.
- **Grades:** The forecast chart shows each assessment's full name without overlapping, labels the hidden GPA, and the grade breakdown's tooltip no longer slides in on hover.
- **Calendar:** Removed redundant hover tooltips from the calendar and timetable pages.
- **Calendar:** Changing a section to a code that is already taken no longer fails with an unknown error.
- **Calendar:** Expanding a section in the course schedule no longer shifts the table, and its times slide open smoothly.
- **Canvas:** A part of a course the instructor hid in Canvas now says so instead of failing to load.

## 2.0.0-beta.1 (2026-11-08)

### New

- **API & MCP:** The unused endpoint for reordering assessments (PUT /courses/{course_id}/assessment-order) has been removed.
- **Self-hosting:** Behind the bundled Caddy or another reverse proxy, set SEMESTRA_TRUSTED_PROXY_HOPS=1 so sign-in limits see the real client address; FORWARDED_ALLOW_IPS is no longer used.

### Improved

- **Terms & courses:** A year-long course's terms are now chosen as a start and end term, and instructors are listed in their own table in course settings.
- **Import:** Calendar files are read by term: full calendar app exports work, classes spanning two terms are added to each, and every-other-week classes across a reading week are recognized.
- **Settings:** API tokens, the MCP server and client permissions now share one API & MCP page; Integrations is renamed Learning platforms.

### Fixed

- **General:** Faster imports and updates involving many assessments or to-dos, and lighter calendar subscription refreshes.
- **General:** Deleting terms, programs, folders and Sem conversations is faster, and uploading a backup no longer holds up other changes.
- **General:** Dialogs keep their content while closing, expanding sections animate, and loading and error states look the same across the app.
- **General:** Fewer repeated requests after saving changes and when returning to the app.
- **General:** Faster first load: less code is downloaded before the first page appears.
- **Sem:** An approved change that is still being applied no longer briefly shows as failed in another tab.
- **Sem:** Sem keeps conversation summaries after a failed request, handles long reading sessions better, and no longer loses a streaming answer when a conversation is renamed or pinned.
- **Sem:** Older conversations started on a course page now work in that course's term.
- **Sem:** When your session expires during a conversation, Sem asks you to sign in again and then continues.
- **Tasks:** The tasks page opens the last viewed list without loading other lists first.
- **Notifications:** Turning notifications on or off for this device no longer shifts the settings layout.
- **Notifications:** Reminders now follow changes to term dates, breaks and the program time zone right away, and keep arriving after the browser renews its subscription.
- **Files:** Files that finish processing while you switch search models are indexed again with the new model.
- **Files:** Files whose processing was stopped or interrupted no longer stay in processing; they show why and can be processed again.
- **Files:** Fixed scanned files failing to process with on-server OCR.
- **Files:** Uploading or processing files in one course no longer reloads the file lists of other courses.
- **Files:** Searching selected files now stays within the current term or course.
- **Files:** Storage quota is enforced the same way for course files, import uploads and Sem attachments, including uploads made at the same time.
- **Import:** Fixed a calendar file import dropping a class whose time changed partway through the term.
- **Import:** Importing the same syllabus again no longer duplicates its deadline tasks and calendar events.
- **Import:** An interrupted import resumes without reading files it already read, avoiding repeat AI charges.
- **Import:** Sources quoted from scanned pages of an imported document now point to the right page.
- **Import:** Syllabus dates such as "Week 5, Friday" or "Oct 3" now resolve when importing into a course, and dates far outside the term are flagged for review.
- **Import:** Imports show when they are waiting for course files, and an import that found the course already up to date is no longer listed as failed.
- **Canvas:** Fixed missed announcement notifications, all-day events landing on the previous day, and repeated assignment changes not being notified again.
- **AI:** AI providers are no longer marked unreachable by errors unrelated to the provider, and model lists load faster.
- **Settings:** Reduce motion now applies to all animations, including progress bars and card effects.
- **Data:** Stopping a backup export or restore no longer reports an error; a stopped restore can be started again.
- **API & MCP:** Import sessions report the waiting_files and up_to_date states, and Sem's approval cards report executing.
- **API & MCP:** Added an endpoint that lists all course links of a program, and an option to include active jobs when listing jobs.
- **API & MCP:** API tokens follow the same limits on REST endpoints as over MCP: deleting needs the "Delete data" permission, and settings only you may change stay protected.
- **Self-hosting:** Lower memory use with local embedding, and faster repeated searches and attachment cleanup.
- **Self-hosting:** A local embedding model that fails no longer interrupts search and indexing for other users of the server.
- **Self-hosting:** Link-local and cloud metadata addresses are now always blocked for outbound requests, even when private network access is allowed.

## 2.0.0-beta.0 (2026-11-08)

### New

- **Sem:** Sem can ask you a question with a few options when it needs your choice, and its questions and change approvals now appear in place of the input box.
- **Sem:** Sem's page lists your conversations in a column beside the open one, like the Tasks page; the sidebar no longer shows recent chats.
- **Grades:** The gradebook has a To-do column for checking off assessments, and an assessment's to-do shows its weight and score with a link back to the gradebook.
- **Grades:** Redesigned the grades page: filter and search assessments, see a forecast chart for the remaining work, and pick a target GPA from your scale. Forecasts now appear as soon as anything is graded.
- **Calendar:** To-dos appear in the calendar: check them off in place, drag them to another day, and create a to-do or an event from New.
- **Notifications:** Notifications for new Canvas grades, assignment changes and announcements, and a daily reminder for habits.
- **Notifications:** System notifications: reminders before classes, events and due to-dos, a daily summary, and alerts for imports, Sem approvals and new sign-ins, with quiet hours.
- **Files:** Select several files and folders to move or delete them together, pick a destination from the folder tree, or drag them onto a folder.
- **Canvas:** The Canvas tab combines assignments, quizzes and grades into one list; grades already on Canvas come along when importing to the gradebook.
- **Canvas:** A notification points out new Canvas assignments, with one click to import or ignore them.
- **Canvas:** Importing Canvas assignments puts those worth points in the gradebook and the rest in to-dos, and saves right away unless something needs checking; a to-do can be added to the gradebook later.
- **Canvas:** To-dos of imported assignments are checked off once Canvas shows them submitted; this can be turned off in the integration settings.
- **Data:** Self-hosted servers: see, download and delete local OCR and search models under Settings → Data.
- **API & MCP:** Schedule endpoints and MCP tools are organized by section: weekly times are listed and added through schedule.section.*, and integrations that used schedule.meeting.list or schedule.meeting.create_many need updating.

### Improved

- **General:** Tables now add entries from a button beside their heading instead of a row at the bottom.
- **Sem:** Suggested questions in new conversations now come from your deadlines, classes and grades, and can be personalized by the light-task model (can be turned off in settings).
- **Grades:** Every assessment with a due date has a to-do that follows it and is finished when the assessment is graded; the calendar shows each deadline once.
- **Calendar:** Canvas events in the calendar carry a Canvas mark and open in Canvas from their details.
- **Calendar:** A course's schedule lists one row per section, expandable to its times; the section dialog edits times in a table and shows set weeks only when needed.
- **Calendar:** Weeks are now set per section, so all times of a section always run in the same weeks.
- **Tasks:** New tasks are created in the list with due date, priority, course and flag set as you add them, from the New task button on the Tasks page, on Today and list cards, and on phones.
- **Tasks:** Tasks now expand into place when added and collapse smoothly when completed, deleted or moved, on computers and phones.
- **Import:** The import review is one table by course, with problems marked where they occur and weight totals that include the gradebook. Closing the dialog keeps the import, and opening the same import again picks it up.
- **Settings:** Settings are easier to find: the top level is now called Global, and groups use the same names for programs, terms and courses.
- **Data:** Backups made with 1.x can be restored.

### Fixed

- **General:** Addresses that don't exist now show a friendly not-found page with a way back home.
- **General:** Unified the look of file drop areas across imports, backup restore, files and Sem; backup restore now says why a file was refused.
- **Grades:** Past-due assessments without a grade are no longer marked overdue; the upcoming card lists only deadlines still ahead.
- **Tasks:** The new task row is spaced from the task above it.
- **Notifications:** Classes, events and to-dos moved to a new time are reminded again at the new time.
- **Files:** Course files and Canvas files open in the same preview, with actions at the bottom; a failed import shows a short message instead of a full-size error.
- **Canvas:** Links and images in Canvas pages and announcements now open on Canvas instead of a "Page not found" screen.
- **Canvas:** The Canvas assignments table now says in words whether each assignment is in the gradebook, in to-dos or not added, with a link to it.

## 1.15.0 (2026-11-06)

### New

- **Terms & courses:** Switching to another course now keeps the open tab; turn this off in Settings → Preferences → Navigation.
- **Canvas:** The Canvas tab can show pages, announcements, assignment descriptions and the syllabus in Canvas style, with a default display setting and a switch on the page.

### Improved

- **Files:** PDF previews scroll continuously through the whole document.
- **Files:** A term's files page shows each course as a folder, with one upload button for the open course.

### Fixed

- **General:** The status bar no longer reports background tasks that finished together as failed.
- **General:** The Semestra icon now appears on browser tabs.
- **Grades:** Grade breakdown details now appear below the chart instead of covering it, and the weight total warning is gone.

## 1.14.1 (2026-11-06)

### Fixed

- **Self-hosting:** Fixed self-hosted Docker instances failing to save Canvas connections and AI provider keys.

## 1.14.0 (2026-11-05)

### New

- **AI:** Background tasks wait out provider rate limits and show when they are waiting. Each provider can limit how many requests run at once.
- **AI:** Each AI task can set its own output limit under Advanced, also when its model is on Auto.
- **AI:** Changing the search model asks for confirmation when files already have search vectors that would be rebuilt.
- **AI:** The model picker shows each on-server model's size, speed and accuracy, and on-server OCR models download only when first needed.

### Fixed

- **General:** Command palette submenu arrows now align to the right edge, and the ask row reads "Sem:".
- **Files:** Improved search accuracy for common embedding models, smaller Gemini vectors, and support for services that accept only small batches.
- **Files:** Search falls back to keywords within seconds when the embedding model is slow.
- **Import:** Long syllabi and scanned documents import reliably, and reading them is faster and cheaper.
- **Self-hosting:** Rebuilding search indexes and downloading models no longer hold up imports and new files.
- **Self-hosting:** Faster local OCR and local search when users choose different models.

## 1.13.0 (2026-11-04)

### New

- **Self-hosting:** Self-hosted servers can run search embedding models locally, so file search works without an AI provider. Choose a built-in model or any Hugging Face model with an ONNX version. The default image is now tagged -local; the -ocr tag still works.

### Fixed

- **General:** Finished background tasks now stay in the status bar for about 15 seconds, and while the task list is open.
- **Calendar:** Polished the calendar: rounded month and agenda views, cleaner all-day events and week numbers, and clearer date ranges.
- **Settings:** Closing settings after following a link to another settings page now closes the dialog in one step.

## 1.12.0 (2026-11-04)

### New

- **Settings:** Search settings, with matching options shown and highlighted in place.
- **Settings:** Switch between light, dark and system themes from the account menu or the command palette.

### Fixed

- **Plugins:** Pressing Esc on the uninstall confirmation closes only the confirmation, never the plugin details behind it.

## 1.11.3 (2026-11-03)

### Fixed

- **Calendar:** The calendar now runs on FullCalendar 7, and the agenda view no longer shows each course dot twice.

## 1.11.2 (2026-11-03)

### Fixed

- **AI:** Corrected the descriptions of the Sem and light-task purposes in model settings.

## 1.11.1 (2026-11-03)

### Fixed

- **Canvas:** Self-hosted instances can connect Canvas with a school account instead of a personal access token.

## 1.11.0 (2026-11-01)

### Improved

- **General:** Card settings now look like the rest of Settings, and every form dialog has a Cancel button next to its main action.
- **Calendar:** Calendar export is now a menu with image or PDF (with a live preview), calendar file and subscription link.
- **Calendar:** Each program now has one calendar subscription link that you can copy any time, change what it includes, or reset.
- **Calendar:** The calendar week view now matches the timetable's look.

### Fixed

- **General:** Clearer, more consistent wording across the interface.
- **Sem:** Fixed an error when opening a confirmed step. Steps now open only to show what changed or why they failed.
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
