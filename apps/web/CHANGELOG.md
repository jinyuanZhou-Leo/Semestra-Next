# @semestra/web

## 2.0.0-beta.7

### Minor Changes

- 9375f05: <!-- area: files -->
  <!-- en -->
  The file preview is larger, with the file's contents on the left, a search for this file, page and zoom controls, and a recognized-text view for PDFs.
  <!-- zh -->
  文件预览更大了：左侧显示文件目录，可在当前文件中搜索，支持翻页与缩放，PDF 还可切换查看识别出的文字。

### Patch Changes

- 1af5abc: <!-- area: canvas -->
  <!-- en -->
  Long assignment names in the Canvas tab now stay on one line next to their icon instead of pushing it onto its own line.
  <!-- zh -->
  Canvas 页签中过长的作业名称现在与图标保持在同一行，不再把图标挤到单独一行。
- a1c1c00: <!-- area: courses -->
  <!-- en -->
  The LMS line on the course info card now fits on one line, and the card size switcher no longer has a squared-off edge.
  <!-- zh -->
  课程信息卡片中的 LMS 一行现在只占一行，卡片尺寸切换条也不再有被裁成直角的边缘。
- @semestra/api-client@2.0.0-beta.7

## 2.0.0-beta.6

### Patch Changes

- 8026738: <!-- area: api -->
  <!-- en -->
  The copy button for MCP connection settings now works on a self-hosted instance opened over http.
  <!-- zh -->
  通过 http 打开自托管实例时，MCP 连接配置的复制按钮也能使用。
- eb15d29: <!-- area: self-hosting -->
  <!-- en -->
  A self-hosted instance opened over plain http from another device on the network now loads, and copy buttons and duplicate-upload detection work there too.
  <!-- zh -->
  从局域网其他设备用 http 打开自托管实例时可以正常加载，复制按钮和重复上传检测也能使用。
- @semestra/api-client@2.0.0-beta.6

## 2.0.0-beta.5

### Minor Changes

- 75d9a15: <!-- area: canvas -->
  <!-- en -->
  Assessments added by hand can be bound to Canvas assignments, and importing an assignment of the same name binds it instead of adding a duplicate.
  <!-- zh -->
  手动添加的考核可以绑定到 Canvas 作业，导入同名作业时会绑定到已有考核，不再重复添加。
- 5d3aacd: <!-- area: canvas -->
  <!-- improved -->
  <!-- en -->
  Canvas assignment groups are imported into the course's existing grade categories, and remember where you moved them.
  <!-- zh -->
  导入 Canvas 作业时，作业组会归入课程已有的成绩分类，并记住你调整过的归类。
- cd685d3: <!-- area: sem -->
  <!-- improved -->
  <!-- en -->
  Auto Dream tidies Sem's memories in the background at most once a day, after a number of new conversations you choose.
  <!-- zh -->
  Auto Dream 每天最多一次在后台整理 Sem 的记忆，频率按新对话数量可调。
- d0ecead: <!-- area: grades -->
  <!-- improved -->
  <!-- en -->
  Redesigned the assessment dialog with grouped fields and a switch for leaving an assessment out of the grade.
  <!-- zh -->
  重新设计了考核对话框：字段分组排列，“不计入成绩”改为开关。
- d0ecead: <!-- area: calendar -->
  <!-- improved -->
  <!-- en -->
  Redesigned the meeting, event and cancel-or-move dialogs with grouped fields, a weekday picker and one-line time ranges.
  <!-- zh -->
  重新设计了上课时间、单次事件和停课调课对话框：字段分组排列，星期一键选择，起止时间并为一行。

### Patch Changes

- @semestra/api-client@2.0.0-beta.5

## 2.0.0-beta.4

### Minor Changes

- 8d8f504: <!-- area: calendar -->
  <!-- improved -->
  <!-- en -->
  Calendar item details open beside the item without covering the calendar, with clearer actions.
  <!-- zh -->
  日历条目的详情改为在条目旁弹出，不再遮挡日历，操作更清晰。
- 1c7aeab: <!-- area: general -->
  <!-- improved -->
  <!-- en -->
  Redesigned onboarding: connect AI and your learning platform before creating your first term, go back to any earlier step, and review everything on a summary page.
  <!-- zh -->
  重新设计新用户引导：创建第一个学期前即可连接 AI 和学习平台，可以返回上一步修改，最后在汇总页确认所有设置。

### Patch Changes

- @semestra/api-client@2.0.0-beta.4

## 2.0.0-beta.3

### Minor Changes

- c160f2b: <!-- area: api -->
  <!-- improved -->

  <!-- en -->

  Connect an MCP client or create an API token from one "New connection" button, with each client's icon in the token list.

  <!-- zh -->

  连接 MCP 客户端与创建 API 令牌合并为一个「新建连接」入口，令牌列表显示各客户端的图标。

- d1014b7: <!-- area: sem -->
  <!-- improved -->
  <!-- en -->
  Ask Sem to compact the conversation.
  <!-- zh -->
  可以直接让 Sem 压缩对话。
- d1014b7: <!-- area: sem -->
  <!-- en -->
  Sem can search and reference your earlier conversations, and link to the one it drew on.
  <!-- zh -->
  Sem 可以搜索并引用以前的对话，回答里会附上来源对话的链接。
- 5802219: <!-- area: account -->
  <!-- improved -->
  <!-- en -->

  Confirming it's you for sensitive account actions now appears up front in place of the form, so the dialog no longer changes size.

  <!-- zh -->

  敏感账户操作的身份确认改为一打开就显示在表单的位置，对话框不再变高。

### Patch Changes

- 3b4a0e3: <!-- area: general -->
  <!-- en -->
  Add buttons above lists and tables now use the accent color, so they are easier to find.
  <!-- zh -->
  列表和表格上方的添加按钮改用强调色，更容易找到。
- @semestra/api-client@2.0.0-beta.3

## 2.0.0-beta.2

### Minor Changes

- a9eb8c8: <!-- area: account -->
  <!-- improved -->
  <!-- en -->
  Sensitive account actions now confirm it's you in place, with your password, an email code or Google, instead of signing you out.
  <!-- zh -->
  敏感的账户操作改为就地确认身份（密码、邮箱验证码或 Google），不再需要退出重新登录。
- c92f7be: <!-- area: api -->
  <!-- improved -->

  <!-- en -->

  Connect Cursor, Claude Code, VS Code, Codex and other MCP clients from Settings in two steps, with the API token already filled in.

  <!-- zh -->

  在设置中两步连接 Cursor、Claude Code、VS Code、Codex 等 MCP 客户端，API 令牌自动填好。

- e419fab: <!-- area: calendar -->
  <!-- improved -->
  <!-- en -->
  The course schedule groups sections by type, pre-fills the next section code, and can merge a section into an existing one with the same code.
  <!-- zh -->
  课程课表按教学班类型分组，新建时预填下一个编号，并可将教学班并入编号相同的已有教学班。
- ccc294c: <!-- area: sem -->
  <!-- en -->
  Sem searches and reads everything in your Canvas courses, including page text, discussions and your teachers' feedback, and can tell you what is new across a term.
  <!-- zh -->
  Sem 可以搜索和读取 Canvas 课程里的全部内容（包括页面正文、讨论和老师的评语），还能告诉你整个学期有哪些新动态。

### Patch Changes

- ccc294c: <!-- area: canvas -->
  <!-- en -->
  A part of a course the instructor hid in Canvas now says so instead of failing to load.
  <!-- zh -->
  老师在 Canvas 里隐藏的课程部分现在会直接说明，不再显示加载失败。
- fc50828: <!-- area: grades -->
  <!-- en -->
  The forecast chart shows each assessment's full name without overlapping, labels the hidden GPA, and the grade breakdown's tooltip no longer slides in on hover.
  <!-- zh -->
  成绩预测图完整显示每项考核的名称、不再重叠，隐藏的 GPA 有了标注，成绩构成的提示框悬停时也不再滑动。
- cd3d559: <!-- area: calendar -->
  <!-- en -->
  Removed redundant hover tooltips from the calendar and timetable pages.
  <!-- zh -->
  去掉了日历与课表页面上多余的悬停提示。
- e419fab: <!-- area: calendar -->
  <!-- en -->
  Expanding a section in the course schedule no longer shifts the table, and its times slide open smoothly.
  <!-- zh -->
  展开课表中的教学班时表格不再跳动，上课时间平滑展开。
- 423e864: <!-- area: sem -->
  <!-- en -->
  Unsent messages and attachments in Sem are kept when you open settings, switch pages or close the panel, and Sem reopens the conversation you were in.
  <!-- zh -->
  打开设置、切换页面或关闭面板时，Sem 中未发送的内容和附件会保留，再次打开时回到原来的对话。
- cd3d559: <!-- area: courses -->
  <!-- en -->
  The sidebar shows a course's full title on hover only when the row shows its alias or code.
  <!-- zh -->
  侧边栏的课程行只在显示别名或代码时，才在悬停时显示完整课程名称。
- @semestra/api-client@2.0.0-beta.2

## 2.0.0-beta.1

### Major Changes

- 85173ea: <!-- area: api -->
  <!-- en -->
  The unused endpoint for reordering assessments (PUT /courses/{course_id}/assessment-order) has been removed.
  <!-- zh -->
  移除了未使用的考核排序接口（PUT /courses/{course_id}/assessment-order）。

### Minor Changes

- 3358bb5: <!-- area: courses -->
  <!-- improved -->
  <!-- en -->
  A year-long course's terms are now chosen as a start and end term, and instructors are listed in their own table in course settings.
  <!-- zh -->
  跨学期课程改为选择开始与结束学期，课程设置中的授课教师改为独立表格。
- 85173ea: <!-- area: imports -->
  <!-- improved -->
  <!-- en -->
  Calendar files are read by term: full calendar app exports work, classes spanning two terms are added to each, and every-other-week classes across a reading week are recognized.
  <!-- zh -->
  日历文件按学期读取：支持日历应用的完整导出，跨两个学期的课会分别加入各学期，隔周课跨阅读周也能正确识别。
- 66b0206: <!-- area: settings -->
  <!-- improved -->
  <!-- en -->
  API tokens, the MCP server and client permissions now share one API & MCP page; Integrations is renamed Learning platforms.
  <!-- zh -->
  API 令牌、MCP 服务与客户端权限合并到「API 与 MCP」一页，「集成」更名为「学习平台」。

### Patch Changes

- d95d08c: <!-- area: api -->
  <!-- en -->
  Import sessions report the waiting_files and up_to_date states, and Sem's approval cards report executing.
  <!-- zh -->
  导入会话新增 waiting_files 与 up_to_date 状态，Sem 的确认卡片新增 executing 状态。
- e80a1c2: <!-- area: data -->
  <!-- en -->
  Stopping a backup export or restore no longer reports an error; a stopped restore can be started again.
  <!-- zh -->
  停止导出或恢复备份不再显示出错，停止的恢复可以重新开始。
- 85173ea: <!-- area: general -->
  <!-- en -->
  Faster imports and updates involving many assessments or to-dos, and lighter calendar subscription refreshes.
  <!-- zh -->
  批量导入与更新考核、待办更快，日历订阅刷新的开销更小。
- 85173ea: <!-- area: canvas -->
  <!-- en -->
  Fixed missed announcement notifications, all-day events landing on the previous day, and repeated assignment changes not being notified again.
  <!-- zh -->
  修复部分公告不通知、全天事件显示在前一天，以及作业再次改动时不再通知的问题。
- d95d08c: <!-- area: files -->
  <!-- en -->
  Files whose processing was stopped or interrupted no longer stay in processing; they show why and can be processed again.
  <!-- zh -->
  处理被停止或中断的文件不再一直显示处理中，会显示原因并可重新处理。
- 85173ea: <!-- area: imports -->
  <!-- en -->
  Fixed a calendar file import dropping a class whose time changed partway through the term.
  <!-- zh -->
  修复导入日历文件时，学期中途改时间的课只保留一个时间的问题。
- c148c1b: <!-- area: imports -->
  <!-- en -->
  Syllabus dates such as "Week 5, Friday" or "Oct 3" now resolve when importing into a course, and dates far outside the term are flagged for review.
  <!-- zh -->
  导入到课程时可正确解析“第 5 周周五”“10 月 3 日”等大纲日期，远在学期之外的日期会在审核时标出。
- d95d08c: <!-- area: imports -->
  <!-- en -->
  Imports show when they are waiting for course files, and an import that found the course already up to date is no longer listed as failed.
  <!-- zh -->
  导入在等待课程文件处理时会显示出来，课程信息已是最新的导入不再在导入历史中显示为失败。
- 3358bb5: <!-- area: general -->
  <!-- en -->
  Dialogs keep their content while closing, expanding sections animate, and loading and error states look the same across the app.
  <!-- zh -->
  对话框关闭时内容不再提前消失，展开区域带过渡动画，各处的加载与出错状态保持一致。
- 66b0206: <!-- area: notifications -->
  <!-- en -->
  Turning notifications on or off for this device no longer shifts the settings layout.
  <!-- zh -->
  开关本设备通知时，设置页布局不再跳动。
- 61e922d: <!-- area: general -->
  <!-- en -->
  Fewer repeated requests after saving changes and when returning to the app.
  <!-- zh -->
  保存修改后和切回应用时不再重复请求数据。
- 61e922d: <!-- area: files -->
  <!-- en -->
  Uploading or processing files in one course no longer reloads the file lists of other courses.
  <!-- zh -->
  上传或处理某门课的文件时，不再重新加载其他课程的文件列表。
- 61e922d: <!-- area: general -->
  <!-- en -->
  Faster first load: less code is downloaded before the first page appears.
  <!-- zh -->
  首屏下载的代码更少，打开更快。
- 61e922d: <!-- area: tasks -->
  <!-- en -->
  The tasks page opens the last viewed list without loading other lists first.
  <!-- zh -->
  待办页直接打开上次查看的列表，不再先加载其他列表。
- 61e922d: <!-- area: settings -->
  <!-- en -->
  Reduce motion now applies to all animations, including progress bars and card effects.
  <!-- zh -->
  “减少动画”现在对所有动画生效，包括进度条和卡片动效。
- 85173ea: <!-- area: notifications -->
  <!-- en -->
  Reminders now follow changes to term dates, breaks and the program time zone right away, and keep arriving after the browser renews its subscription.
  <!-- zh -->
  修改学期日期、假期或学业项目时区后提醒立即更新；浏览器更新推送订阅后通知不再中断。
- d95d08c: <!-- area: sem -->
  <!-- en -->
  An approved change that is still being applied no longer briefly shows as failed in another tab.
  <!-- zh -->
  已批准、仍在执行的修改不再在其他标签页中短暂显示为失败。
- f042585: <!-- area: sem -->
  <!-- en -->
  Sem keeps conversation summaries after a failed request, handles long reading sessions better, and no longer loses a streaming answer when a conversation is renamed or pinned.
  <!-- zh -->
  Sem 在请求失败后仍保留对话摘要，更好地处理大量阅读的长回合，重命名或置顶对话时不再丢失正在生成的回答。
- f042585: <!-- area: sem -->
  <!-- en -->
  Older conversations started on a course page now work in that course's term.
  <!-- zh -->
  在课程页开始的旧对话改为在该课程所在学期中工作。
- cc73b39: <!-- area: sem -->
  <!-- en -->
  When your session expires during a conversation, Sem asks you to sign in again and then continues.
  <!-- zh -->
  对话中登录过期时，Sem 会请你重新登录，然后继续。
- @semestra/api-client@2.0.0-beta.1

## 2.0.0-beta.0

### Minor Changes

- 0629c7c: <!-- area: general -->
  <!-- improved -->
  <!-- en -->
  Tables now add entries from a button beside their heading instead of a row at the bottom.
  <!-- zh -->
  表格的新建入口统一移到标题旁的按钮，不再放在表格末行。
- ee1cb26: <!-- area: calendar -->
  <!-- improved -->
  <!-- en -->
  Canvas events in the calendar carry a Canvas mark and open in Canvas from their details.
  <!-- zh -->
  日历中的 Canvas 事件带有 Canvas 标记，可从详情直接在 Canvas 中打开。
- 56d3ac2: <!-- area: canvas -->
  <!-- en -->
  The Canvas tab combines assignments, quizzes and grades into one list; grades already on Canvas come along when importing to the gradebook.
  <!-- zh -->
  Canvas 页签把作业、测验和成绩合并为一个列表；导入到成绩簿时会带上 Canvas 上已有的成绩。
- ec74a72: <!-- area: notifications -->
  <!-- en -->
  Notifications for new Canvas grades, assignment changes and announcements, and a daily reminder for habits.
  <!-- zh -->
  新增 Canvas 新成绩、作业变更与公告的通知，以及习惯打卡的每日提醒。
- ee1cb26: <!-- area: canvas -->
  <!-- en -->
  A notification points out new Canvas assignments, with one click to import or ignore them.
  <!-- zh -->
  Canvas 上有新作业时会弹出通知，可一键导入或忽略。
- ee1cb26: <!-- area: canvas -->
  <!-- en -->
  Importing Canvas assignments puts those worth points in the gradebook and the rest in to-dos, and saves right away unless something needs checking; a to-do can be added to the gradebook later.
  <!-- zh -->
  导入 Canvas 作业时，有分值的进入成绩簿，其余成为待办；没有需要确认的内容时直接保存。只是待办的作业之后也可以加入成绩簿。
- 1652960: <!-- area: files -->
  <!-- en -->
  Select several files and folders to move or delete them together, pick a destination from the folder tree, or drag them onto a folder.
  <!-- zh -->
  可以多选文件和文件夹一起移动或删除，从文件夹树中选择目标位置，也可以直接拖到文件夹上。
- e355327: <!-- area: grades -->
  <!-- en -->
  The gradebook has a To-do column for checking off assessments, and an assessment's to-do shows its weight and score with a link back to the gradebook.
  <!-- zh -->
  成绩册新增“待办”列，可直接勾选完成；考核的待办详情显示权重和成绩，并可跳回成绩册。
- 01a43ea: <!-- area: grades -->
  <!-- en -->
  Redesigned the grades page: filter and search assessments, see a forecast chart for the remaining work, and pick a target GPA from your scale. Forecasts now appear as soon as anything is graded.
  <!-- zh -->
  重新设计成绩页：考核可筛选与搜索，预测卡片用图表展示剩余考核，目标 GPA 从换算表中选择；只要有成绩录入就会给出预测。
- ee1cb26: <!-- area: imports -->
  <!-- improved -->
  <!-- en -->
  The import review is one table by course, with problems marked where they occur and weight totals that include the gradebook. Closing the dialog keeps the import, and opening the same import again picks it up.
  <!-- zh -->
  导入审核改为按课程分组的表格，问题标在对应位置，权重合计包含成绩簿里已有的考核。关闭对话框不会丢弃导入，再次打开同一导入即可继续。
- d65890a: <!-- area: data -->
  <!-- en -->
  Self-hosted servers: see, download and delete local OCR and search models under Settings → Data.
  <!-- zh -->
  自部署服务器可在设置 → 数据中查看、下载和删除本地 OCR 与搜索模型。
- 0629c7c: <!-- area: calendar -->
  <!-- improved -->
  <!-- en -->
  A course's schedule lists one row per section, expandable to its times; the section dialog edits times in a table and shows set weeks only when needed.
  <!-- zh -->
  课程课表改为每个教学班一行，可展开查看每节课；编辑教学班时上课时间以表格填写，周次需要时再设置。
- 29d2459: <!-- area: calendar -->
  <!-- improved -->
  <!-- en -->
  Weeks are now set per section, so all times of a section always run in the same weeks.
  <!-- zh -->
  周次改为按教学班设置，同一教学班的各节课周次始终一致。
- 1d48402: <!-- area: sem -->
  <!-- en -->
  Sem can ask you a question with a few options when it needs your choice, and its questions and change approvals now appear in place of the input box.
  <!-- zh -->
  Sem 需要你做选择时可以提问并给出选项，提问和修改确认现在都显示在输入框的位置。
- e6e69a4: <!-- area: sem -->

  <!-- en -->

  Sem's page lists your conversations in a column beside the open one, like the Tasks page; the sidebar no longer shows recent chats.

  <!-- zh -->

  Sem 页面像待办页一样在左侧一栏列出所有对话，边栏不再显示最近对话。

- 1529763: <!-- area: sem -->
  <!-- improved -->
  <!-- en -->
  Suggested questions in new conversations now come from your deadlines, classes and grades, and can be personalized by the light-task model (can be turned off in settings).
  <!-- zh -->
  新对话的推荐问题改为根据你的截止、课程和成绩生成，并可由轻量任务模型个性化改写（可在设置中关闭）。
- 459f19e: <!-- area: settings -->
  <!-- improved -->
  <!-- en -->
  Settings are easier to find: the top level is now called Global, and groups use the same names for programs, terms and courses.
  <!-- zh -->
  设置更好找：最上层改名为“全局”，学业项目、学期和课程使用同一套分组。
- be0d883: <!-- area: tasks -->
  <!-- improved -->
  <!-- en -->
  New tasks are created in the list with due date, priority, course and flag set as you add them, from the New task button on the Tasks page, on Today and list cards, and on phones.
  <!-- zh -->
  新待办改为在列表中直接添加，添加时即可设置截止日期、优先级、课程和标记；待办页、“今天”与列表卡片以及手机端都提供“新待办”按钮。
- 9e622fd: <!-- area: notifications -->
  <!-- en -->
  System notifications: reminders before classes, events and due to-dos, a daily summary, and alerts for imports, Sem approvals and new sign-ins, with quiet hours.
  <!-- zh -->
  新增系统通知：上课、事件和待办截止前提醒，每日摘要，以及导入、Sem 等待确认和新登录通知，支持免打扰时段。
- db96d79: <!-- area: tasks -->
  <!-- improved -->
  <!-- en -->
  Tasks now expand into place when added and collapse smoothly when completed, deleted or moved, on computers and phones.
  <!-- zh -->
  待办在添加时平滑展开，完成、删除或移走时平滑收起，电脑与手机端均已支持。
- 08d582e: <!-- area: calendar -->
  <!-- en -->
  To-dos appear in the calendar: check them off in place, drag them to another day, and create a to-do or an event from New.
  <!-- zh -->
  待办显示在日历中：可直接勾选完成、拖动改日期，“新建”可选择建事件或待办。

### Patch Changes

- 4d69039: <!-- area: grades -->
  <!-- en -->
  Past-due assessments without a grade are no longer marked overdue; the upcoming card lists only deadlines still ahead.
  <!-- zh -->
  已过截止但未出分的考核不再标为逾期，“即将截止”卡片只列出尚未到期的考核。
- 5b0f752: <!-- area: canvas -->
  <!-- en -->
  The Canvas assignments table now says in words whether each assignment is in the gradebook, in to-dos or not added, with a link to it.
  <!-- zh -->
  Canvas 作业表直接用文字标明每项作业已加入成绩簿、已加入待办还是未加入，并可点击跳转。
- c4651cf: <!-- area: tasks -->
  <!-- en -->
  The new task row is spaced from the task above it.
  <!-- zh -->
  新待办行与上方待办之间留出间距。
- f088b87: <!-- area: general -->
  <!-- en -->
  Addresses that don't exist now show a friendly not-found page with a way back home.
  <!-- zh -->
  访问不存在的地址时，会显示友好的“页面不存在”提示，并可一键回到首页。
- e33ca74: <!-- area: notifications -->
  <!-- en -->
  Classes, events and to-dos moved to a new time are reminded again at the new time.
  <!-- zh -->
  课程、事件和待办改到新时间后，会按新时间再次提醒。
- 3cefff2: <!-- area: general -->
  <!-- en -->
  Unified the look of file drop areas across imports, backup restore, files and Sem; backup restore now says why a file was refused.
  <!-- zh -->
  统一了导入、备份恢复、文件和 Sem 中拖放文件区域的外观；备份恢复会说明文件被拒收的原因。
- 56d3ac2: <!-- area: files -->
  <!-- en -->
  Course files and Canvas files open in the same preview, with actions at the bottom; a failed import shows a short message instead of a full-size error.
  <!-- zh -->
  课程文件和 Canvas 文件使用同一种预览，操作按钮统一放在底部；导入失败时显示简短说明，不再是占满窗口的报错。
- @semestra/api-client@2.0.0-beta.0

## 1.15.0

### Minor Changes

- 5d89783: <!-- area: canvas -->
  <!-- en -->
  The Canvas tab can show pages, announcements, assignment descriptions and the syllabus in Canvas style, with a default display setting and a switch on the page.
  <!-- zh -->
  Canvas 页签可按 Canvas 样式显示页面、公告、作业说明和课程大纲，可设置默认显示方式，也可在页面上切换。
- 35a237c: <!-- area: courses -->
  <!-- en -->
  Switching to another course now keeps the open tab; turn this off in Settings → Preferences → Navigation.
  <!-- zh -->
  切换课程时会保留当前标签页，可在“设置 → 偏好 → 导航”中关闭。
- 6eef61e: <!-- area: files -->
  <!-- improved -->
  <!-- en -->
  PDF previews scroll continuously through the whole document.
  <!-- zh -->
  PDF 预览可连续纵向滚动浏览整份文档。
- 9917b73: <!-- area: files -->
  <!-- improved -->
  <!-- en -->
  A term's files page shows each course as a folder, with one upload button for the open course.
  <!-- zh -->
  学期文件页改为按课程显示文件夹，进入课程后用同一个上传按钮上传。

### Patch Changes

- c057d39: <!-- area: grades -->
  <!-- en -->
  Grade breakdown details now appear below the chart instead of covering it, and the weight total warning is gone.
  <!-- zh -->
  成绩构成的明细提示改为显示在图表下方，不再遮挡图表；去掉了权重合计提示条。
- b4f8c84: <!-- area: general -->
  <!-- en -->
  The status bar no longer reports background tasks that finished together as failed.
  <!-- zh -->
  多个后台任务先后完成时，状态栏不再误报为失败。
- 0b6d03f: <!-- area: general -->
  <!-- en -->
  The Semestra icon now appears on browser tabs.
  <!-- zh -->
  浏览器标签页现在会显示 Semestra 图标。
- @semestra/api-client@1.15.0

## 1.14.1

### Patch Changes

- @semestra/api-client@1.14.1

## 1.14.0

### Minor Changes

- e53664d: <!-- area: ai -->
  <!-- en -->
  Background tasks wait out provider rate limits and show when they are waiting. Each provider can limit how many requests run at once.
  <!-- zh -->
  后台任务遇到服务商限流时会等待并显示“等待中”；可为每个服务商设置同时请求数上限。
- e53664d: <!-- area: ai -->
  <!-- en -->
  Each AI task can set its own output limit under Advanced, also when its model is on Auto.
  <!-- zh -->
  可在“高级”中为每项 AI 任务单独设置输出上限，模型为“自动”时同样生效。
- 71b16b3: <!-- area: ai -->
  <!-- en -->
  Changing the search model asks for confirmation when files already have search vectors that would be rebuilt.
  <!-- zh -->
  更换搜索模型时，如果已有文件需要重新计算搜索向量，会先请你确认。
- f1d11f2: <!-- area: ai -->
  <!-- en -->
  The model picker shows each on-server model's size, speed and accuracy, and on-server OCR models download only when first needed.
  <!-- zh -->
  模型选择器会显示服务器本机模型的大小、速度和准确程度，本机 OCR 模型改为第一次用到时再下载。

### Patch Changes

- bd3a99e: <!-- area: general -->
  <!-- en -->
  Command palette submenu arrows now align to the right edge, and the ask row reads "Sem:".
  <!-- zh -->
  命令面板中子菜单箭头改为靠右对齐，提问一行改为显示「Sem：」。
- @semestra/api-client@1.14.0

## 1.13.0

### Patch Changes

- 8a5064b: <!-- area: calendar -->
  <!-- en -->
  Polished the calendar: rounded month and agenda views, cleaner all-day events and week numbers, and clearer date ranges.
  <!-- zh -->
  优化日历细节：月视图与日程视图改为圆角，全天事件与周次显示更简洁，日期范围更清晰。
- c9c83ad: <!-- area: general -->
  <!-- en -->
  Finished background tasks now stay in the status bar for about 15 seconds, and while the task list is open.
  <!-- zh -->
  后台任务完成后会在状态条保留约 15 秒，任务列表打开期间也不会消失。
- cdc4e1c: <!-- area: settings -->
  <!-- en -->
  Closing settings after following a link to another settings page now closes the dialog in one step.
  <!-- zh -->
  在设置内跳转到其他设置页后，点一次关闭即可退出设置。
- @semestra/api-client@1.13.0

## 1.12.0

### Minor Changes

- ec5ee42: <!-- area: settings -->
  <!-- en -->
  Search settings, with matching options shown and highlighted in place.
  <!-- zh -->
  设置支持搜索，匹配的选项会就地显示并高亮。
- b713e80: <!-- area: settings -->
  <!-- en -->
  Switch between light, dark and system themes from the account menu or the command palette.
  <!-- zh -->
  可以在账户菜单或命令面板中切换浅色、深色和跟随系统主题。

### Patch Changes

- bc6e7ca: <!-- area: plugins -->
  <!-- en -->
  Pressing Esc on the uninstall confirmation closes only the confirmation, never the plugin details behind it.
  <!-- zh -->
  在卸载确认框上按 Esc 只会关闭确认框，不会连带关闭后面的插件详情。
- @semestra/api-client@1.12.0

## 1.11.3

### Patch Changes

- 5c2e717: <!-- area: calendar -->
  <!-- en -->
  The calendar now runs on FullCalendar 7, and the agenda view no longer shows each course dot twice.
  <!-- zh -->
  日历升级到 FullCalendar 7，日程视图不再重复显示课程色点。
- @semestra/api-client@1.11.3

## 1.11.2

### Patch Changes

- 7a8cfbc: <!-- area: ai -->
  <!-- en -->
  Corrected the descriptions of the Sem and light-task purposes in model settings.
  <!-- zh -->
  更正模型设置里 Sem 与轻量任务的用途说明。
- @semestra/api-client@1.11.2

## 1.11.1

### Patch Changes

- 9f1ca3e: <!-- area: canvas -->
  <!-- en -->
  Self-hosted instances can connect Canvas with a school account instead of a personal access token.
  <!-- zh -->
  自托管实例可用学校账号连接 Canvas，无需个人访问令牌。
- @semestra/api-client@1.11.1

## 1.11.0

### Minor Changes

- 7af7a49: <!-- area: calendar -->
  <!-- improved -->
  <!-- en -->
  Calendar export is now a menu with image or PDF (with a live preview), calendar file and subscription link.
  <!-- zh -->
  日历导出改为菜单，包含图片或 PDF（带实时预览）、日历文件和订阅链接。
- 7af7a49: <!-- area: calendar -->
  <!-- improved -->
  <!-- en -->
  Each program now has one calendar subscription link that you can copy any time, change what it includes, or reset.
  <!-- zh -->
  每个学业项目现在只有一个日历订阅链接，可随时复制、调整包含的内容，也能重置。
- 7af7a49: <!-- area: calendar -->
  <!-- improved -->
  <!-- en -->
  The calendar week view now matches the timetable's look.
  <!-- zh -->
  日历周视图的样式与课表统一。
- 0134a8a: <!-- area: general -->
  <!-- improved -->
  <!-- en -->
  Card settings now look like the rest of Settings, and every form dialog has a Cancel button next to its main action.
  <!-- zh -->
  卡片设置改为与设置页一致的样式，所有表单弹窗都在主按钮旁提供“取消”。

### Patch Changes

- 7af7a49: <!-- area: calendar -->
  <!-- en -->
  Fixed the week number in the calendar, the day order in exported images for Sunday-start weeks, and the time format in month view.
  <!-- zh -->
  修正了日历中的周次、周日起始时导出图片的日期顺序，以及月视图的时间格式。
- fd9d879: <!-- area: general -->
  <!-- en -->
  Clearer, more consistent wording across the interface.
  <!-- zh -->
  统一并精简了界面文案。
- d0adf02: <!-- area: sem -->
  <!-- en -->
  Fixed an error when opening a confirmed step. Steps now open only to show what changed or why they failed.
  <!-- zh -->
  修复展开已确认的步骤时报错的问题；步骤只在有改动或失败原因时才可展开。
- @semestra/api-client@1.11.0

## 1.10.0

### Minor Changes

- c048933: <!-- area: overview -->
  <!-- improved -->
  <!-- en -->
  Cards make better use of their space: small cards drop the title row, long lists fade at the edge to show they scroll, and schedule entries open with a click.
  <!-- zh -->
  卡片更充分地利用空间：小卡片不再占用标题行，长列表在边缘渐隐提示可以滚动，课表条目点一下即可打开。
- c048933: <!-- area: calendar -->
  <!-- improved -->
  <!-- en -->
  The week card now shows the coming days starting from yesterday, sized to fit your classes.
  <!-- zh -->
  本周课表卡片改为显示从昨天起的近几日课表，时间范围按课程自动适配。
- f228d2f: <!-- area: courses -->
  <!-- improved -->
  <!-- en -->
  Read a course's details from a file such as its syllabus in the course settings: pick a file, check the changes, apply.
  <!-- zh -->
  在课程设置里从文件识别课程信息：选一个文件，核对变化后应用。
- 654df9d: <!-- area: calendar -->
  <!-- improved -->
  <!-- en -->
  The course schedule is reorganized into weekly meetings, one-off events and cancellations, sections can be switched on or off as a whole, and you can now cancel or move a single class from it.
  <!-- zh -->
  课程课表按每周上课时间、单次事件和停课与调课重新整理，可按教学班整体开关，并可直接停课或调课。
- d52d1fd: <!-- area: files -->
  <!-- improved -->
  <!-- en -->
  Upload files from a term's Files page by choosing a course or dropping them on its section, and drop files on a folder to upload into it.
  <!-- zh -->
  学期的文件页可以选择课程上传，或把文件拖到课程分组上；文件也可以直接拖进文件夹。
- c048933: <!-- area: grades -->
  <!-- improved -->
  <!-- en -->
  Clearer GPA cards: the overview adds a GPA bar for each term, and the charts line up across terms.
  <!-- zh -->
  GPA 卡片更清晰：概览新增各学期的 GPA 条，图表在各学期之间对齐。
- c048933: <!-- area: plugins -->
  <!-- improved -->
  <!-- en -->
  The habit calendar is now part of the habit card: check in on the ring and review past weeks beside it. Existing calendar cards are converted automatically.
  <!-- zh -->
  习惯日历并入习惯打卡卡片：在圆环上打卡，旁边回顾最近几周的记录；已有的日历卡片会自动转换。
- cac0a03: <!-- area: general -->
  <!-- improved -->
  <!-- en -->
  The sidebar now holds the current term's pages and courses, with a term switcher above them; term pages no longer have a tab bar.
  <!-- zh -->
  侧边栏改为当前学期的工作区，直接列出学期页面与课程，并可在顶部切换学期；学期页面不再显示标签栏。
- cac0a03: <!-- area: settings -->
  <!-- en -->
  Choose which page Semestra opens on, including where you left off.
  <!-- zh -->
  可以设置打开 Semestra 时显示的页面，包括上次离开的页面。
- cac0a03: <!-- area: tasks -->
  <!-- improved -->
  <!-- en -->
  Task lists are shown in a column on the Tasks page instead of the sidebar.
  <!-- zh -->
  待办列表移到待办页面左侧，不再在侧边栏中展开。

### Patch Changes

- 5bd1758: <!-- area: files -->
  <!-- en -->
  Fixed a stray horizontal scrollbar under the file list.
  <!-- zh -->
  修复文件列表下方多出的横向滚动条。
- f8f2b1a: <!-- area: sem -->
  <!-- en -->
  Fixed the last characters of an edited message sometimes being dropped when it was sent with Enter.
  <!-- zh -->
  修复编辑消息后按 Enter 发送时，偶尔丢失最后几个字符的问题。
- @semestra/api-client@1.10.0

## 1.9.0

### Minor Changes

- 33aa7fe: <!-- area: api -->
  <!-- en -->
  MCP tools are streamlined: adding items always takes a list, and failed calls include a hint on what to do next.
  <!-- zh -->
  精简 MCP 工具：添加条目统一接受列表，调用失败时附带下一步提示。

### Patch Changes

- 6f8cc3a: <!-- area: sem -->
  <!-- en -->
  Token counts now show in k and M, and the context usage bar no longer shows stray lines.
  <!-- zh -->
  token 数统一以 k、M 显示，上下文用量条不再出现多余的分隔线。
- @semestra/api-client@1.9.0

## 1.8.0

### Minor Changes

- 928eee0: <!-- area: overview -->
  <!-- improved -->
  <!-- en -->
  Cards show a skeleton while they load.
  <!-- zh -->
  卡片加载时显示骨架占位。
- 0d06016: <!-- area: courses -->
  <!-- improved -->
  <!-- en -->
  Every "Add course" button now offers the same choices as the new-term wizard: enter courses manually, continue a full-year course from last term, or import them from a calendar file, syllabus, screenshot, pasted text or your LMS.
  <!-- zh -->
  所有「添加课程」按钮都提供与新建学期向导相同的方式：手动填写、延续上学期的全年课，或从日历文件、Syllabus、截图、粘贴文本和 LMS 导入。

### Patch Changes

- 17bdc65: <!-- area: ai -->
  <!-- en -->
  The provider list in the Add provider dialog now fills the full width.
  <!-- zh -->
  “添加服务商”对话框中的服务商列表现在占满整行宽度。
- 9e2d0c8: <!-- area: sem -->
  <!-- en -->
  When no AI provider is set up, Sem shows the setup prompt directly instead of briefly showing the chat first.
  <!-- zh -->
  未配置 AI 服务商时，Sem 直接显示配置提示，不再先闪现聊天界面。
- abd5137: <!-- area: ai -->
  <!-- en -->
  When adding a known compatible service, its address, model and capabilities now sit under a lighter "Endpoint settings" section.
  <!-- zh -->
  添加已知的兼容服务时，接口地址、模型和能力改为放在更简洁的「接口设置」折叠区中。
- @semestra/api-client@1.8.0

## 1.7.0

### Minor Changes

- 4a27dc5: <!-- area: general -->
  <!-- en -->
  On a phone, Semestra opens a simpler app with Today, Tasks and Sem, and it can be added to your home screen.
  <!-- zh -->
  在手机上打开 Semestra 会进入更简单的界面，可以看今天的安排、处理待办、和 Sem 对话，也可以添加到主屏幕。

### Patch Changes

- @semestra/api-client@1.7.0

## 1.6.0

### Minor Changes

- 61f6fc3: <!-- area: ai -->
  <!-- en -->
  OCR of scanned pages has its own model setting, so you can use a cheaper model than the one for images.
  <!-- zh -->
  扫描页的 OCR 有了单独的模型设置，可以用比读图更便宜的模型。
- 61f6fc3: <!-- area: self-hosting -->
  <!-- en -->
  Self-hosted servers read scanned PDFs and photos on their own with PaddleOCR (also in Docker on a Mac), without calling any AI model, and each user can pick the OCR model in settings. A model downloads the first time it is needed, and you can watch its progress.
  <!-- zh -->
  自托管的服务器可以用 PaddleOCR 自己识别扫描版 PDF 和照片（Mac 上的 Docker 也可以），不需要调用任何 AI 模型；每个用户都可以在设置里选择 OCR 模型。模型在第一次用到时下载，可以看到下载进度。

### Patch Changes

- @semestra/api-client@1.6.0

## 1.5.0

### Minor Changes

- d819cc5: <!-- area: files -->
  <!-- en -->
  You can turn off automatic indexing of new files for a Program or a course, and index a file only when you need it.
  <!-- zh -->
  可以为学业项目或单门课程关闭新文件的自动索引，需要时再为某个文件建立索引。
- 0e03ee2: <!-- area: courses -->
  <!-- improved -->
  <!-- en -->
  When you sign up you can choose "Add later" instead of creating your first term, and add it from Terms & courses once the term starts.
  <!-- zh -->
  注册时可以选择“稍后添加”跳过创建第一个学期，开学后再在“学期与课程”里添加。
- 8cc8873: <!-- area: sem -->
  <!-- improved -->
  <!-- en -->
  Hover the context ring to see what fills the conversation, and compact it from the bottom of that card; while it compacts, the messages being summarized fade in place.
  <!-- zh -->
  鼠标移到上下文圆环上可以看到对话的各部分占用，并在卡片底部压缩对话；压缩时，正在总结的消息会在原处变淡。
- d7b8797: <!-- area: tasks -->
  <!-- improved -->
  <!-- en -->
  A task you check off now stays in place for 5 seconds with a short animation before it moves to Completed, so you can uncheck it if you tapped by mistake.
  <!-- zh -->
  勾选完成的待办会带着一个简短的动画在原处停留 5 秒，再移到“已完成”，点错了可以直接取消勾选。

### Patch Changes

- d819cc5: <!-- area: files -->
  <!-- en -->
  When a file can't be processed, the file list says why next to the retry button.
  <!-- zh -->
  文件处理失败时，文件列表会在重试按钮旁写明原因。
- 2d7047d: <!-- area: files -->
  <!-- en -->
  While a file is being processed, the file list shows which step it is on (such as reading pages 12/48) next to its progress bar.
  <!-- zh -->
  文件处理中时，文件列表会在进度条旁显示当前步骤（例如“读取页面 12/48”）。
- f3f324d: <!-- area: account -->
  <!-- en -->
  The "Continue with Google" button on the sign-in page no longer overlaps the "or" divider or shows a white box in dark mode, and it now matches the width of the form.
  <!-- zh -->
  登录页的“使用 Google 继续”按钮不再压住“或”分隔线，深色模式下也不再有白色方底，宽度与表单一致。
- 0e03ee2: <!-- area: courses -->
  <!-- en -->
  The number of weeks shown next to a term's dates now counts calendar weeks, so a term that starts mid-week is no longer a week short.
  <!-- zh -->
  学期日期旁的周数现在按日历周计算，学期不从一周第一天开始时不再少算一周。
- @semestra/api-client@1.5.0

## 1.4.0

### Minor Changes

- 2522629: <!-- improved -->
  <!-- area: imports -->
  <!-- en -->
  Add from a syllabus, screenshot or calendar file right in each page's Add menu, read a file already in the course with "Read with AI…", and watch each file's upload progress.
  <!-- zh -->
  在各页的“添加”菜单里直接从 syllabus、截图或日历文件添加，课程里已有的文件可以用“用这个文件识别…”直接读取，上传时每个文件都有自己的进度。
- 1030b7e: <!-- improved -->
  <!-- area: settings -->
  <!-- en -->
  The "What's new" dialog and the release notes in Settings → About mark New, Improved and Fixed with their own icon and color, and within each, notes are listed under the part of the app they are about.
  <!-- zh -->
  「更新了什么」弹窗和设置 → 关于里的更新日志，新功能、改进和修复各有图标和颜色，每类里的条目再按模块分开列出。
- 6a5106e: <!-- improved -->
  <!-- area: canvas -->
  <!-- en -->
  Link a course to Canvas from its settings by searching one list, with the matching course suggested first, and see its status and actions in a single row.
  <!-- zh -->
  在课程设置里通过一个可搜索的列表把课程关联到 Canvas，代码对得上的课程排在最前，关联后的状态和操作都在一行里。
- b413c3c: <!-- improved -->
  <!-- area: courses -->
  <!-- en -->
  Creating a term now takes two steps: pick the term's dates in one range calendar that shows the number of weeks, edit breaks in a table, and create the term right from the course list, where continuing year-long courses and each imported course's source are shown. Date pickers now follow your language and first day of the week.
  <!-- zh -->
  新建学期改成两步：在一个日历里选好学期起止日期并直接看到周数，假期用表格编辑，在课程列表里直接创建学期，延续的全年课程和导入课程的来源都会显示。日期选择器现在跟随界面语言和每周起始日。

### Patch Changes

- 8c22188: <!-- area: overview -->
  <!-- en -->

  Cards on Today and on a term's overview show their content sooner.

  <!-- zh -->

  “今天”和学期概览页上的卡片内容显示得更快。

- e3fc326: <!-- area: general -->
  <!-- en -->
  While the app loads, an outline of the sidebar (or the Semestra logo) shows right away instead of a blank page.
  <!-- zh -->
  应用加载时会立即显示侧边栏轮廓（或 Semestra 标志），不再是一片空白。
- cb8d030: <!-- area: canvas -->
  <!-- en -->

  In the Canvas tab's assignments, the columns no longer shift when you open an assignment or fold a group.

  <!-- zh -->

  Canvas 页签的作业表里，展开作业或折叠分组时列不再左右移动。

- f55c7ab: <!-- area: canvas -->
  <!-- en -->

  In the Canvas tab, assignments you already imported now show a dimmed checkbox, so it is clear they can't be ticked again.

  <!-- zh -->

  Canvas 页签里已导入的作业，勾选框现在会变淡，一眼就能看出不能再勾选。

- 8d35540: <!-- area: general -->
  <!-- en -->
  The app downloads less code when it starts and asks for your data sooner, so it opens faster on slow connections.
  <!-- zh -->
  应用启动时下载的代码更少、数据请求发得更早，网络较慢时打开更快。
- bc3f36a: <!-- area: general -->
  <!-- en -->
  Pages opened from a link or after a refresh show their data sooner, and the term calendar shows a week's classes as soon as you move to it.
  <!-- zh -->
  从链接打开或刷新后，页面数据显示得更快；学期日历翻周时课程会立刻出现。
- 8542c96: <!-- area: general -->
  <!-- en -->
  Pages stay responsive in the seconds after they load, and changing a preference no longer reloads your preferences twice.
  <!-- zh -->
  页面加载后的几秒内操作更跟手；修改偏好设置时不再重复加载两次。
- 8c22188: <!-- area: sem -->
  <!-- en -->

  The Sem side panel opens faster, and the full Sem page shows your conversation list sooner.

  <!-- zh -->

  Sem 侧边面板打开得更快，Sem 全屏页的对话列表也显示得更早。

- bc3bb6b: <!-- area: tasks -->
  <!-- en -->
  Selecting and checking off tasks in a long list responds faster, and task due dates show weekdays in the app's language.
  <!-- zh -->
  在长待办列表里选中和勾选任务响应更快；待办截止日期里的星期按应用语言显示。
- @semestra/api-client@1.4.0

## 1.3.0

### Minor Changes

- 806fc09: <!-- improved -->
  <!-- en -->
  Settings: AI providers and LMS connections show brand logos and short statuses, adding DeepSeek, Kimi, Qwen or OpenRouter only asks for a key, and each AI task picks its model from one searchable list.
  <!-- zh -->
  设置：AI 服务商和 LMS 连接显示品牌 logo 和简短状态，添加 DeepSeek、Kimi、通义千问或 OpenRouter 只需填 key，每类 AI 任务在一个可搜索的列表里选模型。
- 273006a: <!-- improved -->
  <!-- en -->
  Settings: the Permissions page now covers both Sem and MCP clients. Choose whether Sem asks before every change, by module, or never, and turn on deleting for MCP clients in the same place.
  <!-- zh -->
  设置：权限页同时管理 Sem 和 MCP 客户端。可以选择 Sem 修改数据前每次批准、按模块设置或全部自动批准，MCP 客户端的删除权限也在这里开启。
- 4859615: <!-- en -->
  The AI usage page can now show just today's requests, tokens and estimated cost.
  <!-- zh -->
  AI 用量页现在可以只看今天的请求数、token 和估算费用。
- 6529097: <!-- en -->
  The theme previews in Settings → Preferences now show a more detailed mini app and follow your accent color in all three modes, and picking an accent color plays a short focus animation.

  <!-- zh -->

  设置 → 偏好里的主题预览更精致，三种模式都会跟随强调色，选择强调色时还有一个聚焦小动画。

- 08be812: <!-- improved -->
  <!-- en -->
  Overview and Today cards: drag a card's corner to resize it, click a card to change its size, settings or remove it, see card contents while editing, and get more columns on large screens instead of stretched cards.
  <!-- zh -->
  概览与今天页的卡片：拖动右下角即可改大小，点选卡片就能切换尺寸、打开设置或移除，编辑时也能看清卡片内容；大屏上会显示更多列，卡片不再被拉得又宽又扁。
- ca29291: <!-- improved -->
  <!-- en -->
  Canvas tab: files show their size and last update in columns and can be sorted by name, size or date.
  <!-- zh -->
  Canvas 页签：文件的大小和更新时间分列显示，可以按名称、大小或时间排序。
- 7301103: <!-- improved -->
  <!-- en -->
  Canvas tab: a cleaner course menu with icons and an "Open in Canvas" group, scores and status badges for assignments, quizzes and grades, overdue module items marked, and announcement previews.
  <!-- zh -->
  Canvas 页签：课程菜单更清爽，带图标和"在 Canvas 中打开"分组；作业、测验和成绩显示得分与状态标记；逾期的单元条目会标出；公告列表显示正文摘要。
- 0fde751: <!-- en -->
  Settings → Data now shows how much of your storage you use, what takes the space (by course or file type), and how much data your account holds.
  <!-- zh -->
  设置 → 数据 现在会显示存储空间用了多少、被哪些课程或文件类型占用，以及账户里各类数据的数量。
- 952d52d: <!-- en -->
  Sem: see how full a conversation is and compact it yourself, from the ring by the input or with /compact, keeping what you name. Compacted turns are marked and their summary can be opened.
  <!-- zh -->
  Sem：输入框旁的用量环会显示对话用掉了多少上下文，可以从这里或用 /compact 手动压缩，并写明想保留的重点；压缩过的部分会有分隔线，点开能看摘要。
- 2c0c8eb: <!-- en -->
  Sem: skills picked with / and courses or terms picked with @ now show as chips right in the text you type, and in your sent messages.
  <!-- zh -->
  Sem：用 / 选的技能和用 @ 引用的课程、学期会以标签的形式直接显示在输入的文字里，发出去的消息里也一样。
- abfc1fe: <!-- improved -->
  <!-- en -->
  Term grades: the page now matches the course gradebook, with a breakdown ring of each course's credits, the term GPA beside it, and a Plan mode where you type the final percentages you expect and set a term GPA to aim for.
  <!-- zh -->
  学期成绩：页面和课程成绩册统一，右侧环图显示各课程学分构成和学期 GPA；点「规划」后可以给未结课课程填预期最终成绩，并设一个目标学期 GPA。

### Patch Changes

- 25eebb7: <!-- en -->
  The add-provider dialog now scrolls on small windows instead of running off the screen.
  <!-- zh -->
  窗口较小时，添加服务商的弹窗可以滚动，不会再超出屏幕。
- 623b5f6: <!-- en -->
  AI import: long syllabi are no longer cut off and reported as having no useful information, and an AI provider account out of credit now says so.
  <!-- zh -->
  AI 导入：较长的课程大纲不再被截断并提示"没有找到可用的信息"；AI 服务商账户余额不足时会直接说明。
- cebde85: <!-- en -->
  Board editing: cards no longer wiggle, resizing from the corner is smoother, every card resizes from its bottom-right corner, and removing a card asks first.
  <!-- zh -->
  编辑看板：卡片不再晃动，拖角改尺寸更流畅，所有卡片都从右下角调整大小，移除卡片前会先确认。
- 9e9fafe: <!-- en -->
  Board editing: a dragged card now follows the pointer smoothly instead of jumping from cell to cell.
  <!-- zh -->
  编辑看板：拖动卡片时卡片会平滑地跟着鼠标走，不再一格一格地跳。
- 7301103: <!-- en -->
  Canvas tab: previewing, downloading and saving Canvas files works again, and images inside Canvas pages load.
  <!-- zh -->
  Canvas 页签：Canvas 文件又能正常预览、下载和保存到课程文件，Canvas 页面里的图片也能显示了。
- 8b9c371: <!-- en -->
  Course, habit and sticky-note color pickers now use the same animated swatches as the accent color, and the selection ring settles a little faster.

  <!-- zh -->

  课程、习惯和便签的颜色选择也换成了和强调色一样的动画色块，选中圆环收缩得更快一些。

- dc7743e: <!-- en -->
  Closing a dialog no longer makes the blurred background flash back for a moment.
  <!-- zh -->
  关闭弹窗时，背景模糊不会再闪一下。
- 3c5b649: <!-- en -->
  "Group by category" and "Count unfinished" in the gradebook are now switches, so it is clear whether they are on.

  <!-- zh -->

  成绩册里的「按分类分组」和「计入未结课」改成了开关，一眼能看出是否打开。

- be0564d: <!-- en -->
  GPA settings: the preset picker now shows the conversion table in use, and picking another preset switches the table after a confirmation.
  <!-- zh -->
  GPA 设置：预设下拉框会显示当前使用的换算表，选择其他预设并确认后即切换换算表。
- 1395329: <!-- en -->
  The "Add term" picker in the sidebar and the level path in settings keep a small gap between highlighted rows again.
  <!-- zh -->
  侧边栏的"添加学期"选择器和设置左上角的层级路径里，高亮的行之间重新留出了间距。
- 34799cc: <!-- en -->
  Changing the language, clock format or first day of the week in Settings no longer makes the settings window close and pop open again.

  <!-- zh -->

  在设置里切换语言、时间格式或一周起始日时，设置窗口不再关闭后重新弹出。

- 6649c42: <!-- en -->
  Sem: the slash commands in the skills menu now line up at the right edge.
  <!-- zh -->
  Sem：技能菜单里右侧的斜杠命令现在整齐靠右对齐。
- 798135c: <!-- en -->
  In the "Create API token" dialog, the permission and expiry options no longer sit in a track stretched across the whole dialog.

  <!-- zh -->

  「创建 API 令牌」对话框里，权限和有效期的选项不再被拉成一条横跨整个对话框的长条。

- @semestra/api-client@1.3.0

## 1.2.0

### Minor Changes

- 8988bab: <!-- improved -->
  <!-- en -->
  Grades: a course percentage is now rounded to a whole number before its letter grade and GPA are looked up (84.5% counts as 85%). You can turn this off in the Program's GPA settings.
  <!-- zh -->
  成绩：课程百分比现在先四舍五入到整数再定字母等级和绩点（84.5% 按 85% 算），可以在 Program 的 GPA 设置里关闭。
- 3b542f2: <!-- improved -->
  <!-- en -->
  Account security: creating an API token or changing your email asks for your password if you signed in more than 10 minutes ago, changing or resetting your password also revokes your API tokens, and your old address is told when your email changes.
  <!-- zh -->
  账户安全：登录超过 10 分钟后，创建 API 令牌或修改邮箱需要输入密码；修改或重置密码会同时撤销所有 API 令牌；邮箱更改后会通知原邮箱。
- f3b2d22: <!-- en -->
  Sem keeps working when you close or reload the page, and the conversation picks up where it is when you come back.
  <!-- zh -->
  关闭或刷新页面后 Sem 会继续工作，回来时对话会接着显示当前进度。

### Patch Changes

- f3c8c3d: <!-- en -->
  Files and imports: import uploads count toward your storage, unsubmitted imports are cleaned up after 30 days, and two commits of the same import can no longer both write. File processing is faster and more robust (first-page thumbnails only, scanned pages read in parallel and one bad page no longer fails the file, missing embeddings are retried). Search is quicker, long file lists scroll smoothly, and uploads show real progress. Syllabus imports wait for course files that are still processing, read GBK text and phone photos correctly, cancel classes on "no class" dates, and share category weights across their assessments.
  <!-- zh -->
  文件与导入：导入的上传计入存储空间，30 天没提交的导入会被清理，同一次导入不会被提交两次。文件处理更快更稳（只生成首页缩略图，扫描页并行识别，单页出错不再让整个文件失败，缺失的向量会自动补齐）。检索更快，长文件列表滚动流畅，上传显示真实进度。课程大纲导入会等待仍在处理的课程文件，能正确读取 GBK 文本和手机照片，"停课"日期会取消对应的上课时间，分类权重会分摊到各项考核。
- 8988bab: <!-- en -->
  Grades: with "Hide GPA" on, letter grades are hidden too.
  <!-- zh -->
  成绩：开启"隐藏 GPA"后字母等级也一起隐藏。
- 8988bab: <!-- en -->
  Calendar: opening an assessment deadline goes to the course's grades and highlights that assessment.
  <!-- zh -->
  日历：打开考核截止项会跳到课程成绩页并高亮这一项。
- 8988bab: <!-- en -->
  Grades: plan mode no longer shows the average so far as the planned grade; it says how many items still need an assumed score.
  <!-- zh -->
  成绩：计划模式不再把目前的平均分当作规划成绩显示，而是提示还有几项没有假设分数。
- 06efc04: <!-- en -->
  Canvas: pages load faster, Refresh fetches the course once instead of skipping the cache from then on, and the app no longer stalls while a Canvas file preview loads.
  <!-- zh -->
  Canvas：页面加载更快；"刷新"只重新获取一次这门课，之后照常使用缓存；预览 Canvas 文件时应用不再卡住。
- 3b542f2: <!-- en -->
  Restoring a large backup no longer makes other saves fail while its files are copied; the last 3 backups are kept, and a new upload replaces one you did not restore.
  <!-- zh -->
  恢复大备份时，复制文件期间其他保存不会再失败；只保留最近 3 份备份，新上传的备份会替换之前未恢复的那份。
- 3b542f2: <!-- en -->
  Fixed: the "manage devices" link in sign-in emails, signing up again right after deleting an account, and Sem turning Canvas writes or memory back on by itself. API: settings values moved to /me/settings.
  <!-- zh -->
  修复：登录通知邮件里的"管理设备"链接；删除账户后马上用同一邮箱注册；Sem 自己打开 Canvas 写入或记忆。API：设置值的接口改到 /me/settings。
- 3b542f2: <!-- en -->
  Live updates send fewer requests: changes arriving together refresh once, and reconnecting no longer reloads every page's data.
  <!-- zh -->
  实时刷新的请求更少：同时到达的多处变化只刷新一次，断线重连也不再重新加载所有数据。
- b9ea242: <!-- en -->
  Calendar export: exporting many weeks as PNG or PDF no longer fails.
  <!-- zh -->
  日历导出：一次导出很多周的 PNG 或 PDF 不再报错。
- b9ea242: <!-- en -->
  Calendar import: ICS files now keep moved and cancelled classes and every repeat rule. Importing the same file again keeps the sections you hid and your notes, removes cancellations the file no longer has, and no longer duplicates exams.
  <!-- zh -->
  日历导入：ICS 文件中的调课、停课和各种重复规则都能正确导入。重新导入同一文件会保留你隐藏的教学班和备注，撤销文件里已经取消的停课，考试也不会重复。
- b9ea242: <!-- en -->
  Course schedule: "Keep only this section" now keeps every weekly class of that section.
  <!-- zh -->
  课程课表：“只保留这个教学班”现在会保留这个教学班每周的全部上课时间。
- b9ea242: <!-- en -->
  Course schedule: moved classes show their new end time, and subscribed calendars in Outlook pick up changes to classes.
  <!-- zh -->
  课程课表：调课显示新的结束时间；Outlook 订阅的日历也能收到上课时间的修改。
- b9ea242: <!-- en -->
  Deleting a term now keeps the events of courses that continue in other terms.
  <!-- zh -->
  删除学期时，仍在其他学期继续的课程的日程会保留。
- f3b2d22: <!-- en -->
  Sem: changes you approved on a card no longer show as failed steps, update cards show what each field was before, and tidying Sem's memory no longer slows the app down.
  <!-- zh -->
  Sem：在卡片上批准的改动不再显示为失败的步骤，修改卡片会显示每个字段原来的值，整理 Sem 的记忆时不再拖慢应用。
- f3b2d22: <!-- en -->
  AI settings: the small model's purpose is now called "Light tasks", since it also summarizes long conversations and tidies Sem's memory.
  <!-- zh -->
  AI 设置：小模型的用途改名为「轻量任务」，因为它也负责压缩长对话和整理 Sem 的记忆。
- 82a1663: <!-- en -->
  Tasks: tasks made from assessments now follow course deletes and setting changes, the Completed section loads faster, and term lists show tasks from every term.
  <!-- zh -->
  待办：由考核生成的待办会随课程删除和设置变更正确更新，「已完成」加载更快，学期清单也能显示其他学期课程的待办。
- @semestra/api-client@1.2.0

## 1.1.1

### Patch Changes

- 1676790: <!-- en -->
  Calendar: exporting the weekly timetable right after opening Export no longer comes out empty, and editing a class from its details says so when it no longer exists.
  <!-- zh -->
  日历：打开导出后立即导出课表模板不会再是空白；从详情编辑已被删除的课程或日程时会给出提示。
- @semestra/api-client@1.1.1

## 1.1.0

### Minor Changes

- f355121: <!-- en -->
  Canvas tab: an opened assignment shows when it opens and closes, how to submit, how many attempts you have, why it is locked, and your grade with your teacher's comments and rubric. Modules show your progress, prerequisites and what each item needs, and quizzes show the time limit, attempts and your score.
  <!-- zh -->
  Canvas 页签：展开作业可以看到开放和关闭时间、提交方式、可提交次数、锁定原因，以及你的成绩、老师评语和评分标准。单元会显示你的完成进度、前置要求和每一项需要做什么，测验会显示限时、次数和你的得分。
- f355121: <!-- en -->
  Canvas tab: the Files tab is back, with folders and search by file name. Word, PowerPoint and Excel files can be previewed as text.
  <!-- zh -->
  Canvas 页签：新增“文件”页签，可以按文件夹浏览、按文件名搜索。Word、PowerPoint 和 Excel 文件可以预览文字内容。
- f355121: <!-- en -->
  Grades posted on Canvas for imported assignments now show up in "Review changes", so you can bring them into your gradebook.
  <!-- zh -->
  已导入的作业在 Canvas 上出了成绩时，会出现在“查看变化”里，确认后即可写入成绩册。
- f355121: <!-- en -->
  New setting under Integrations: allow changes on the platform. When it's on, opening an announcement here also marks it read on Canvas. It's off by default, and Semestra then only reads.
  <!-- zh -->
  集成设置新增“允许在平台上做修改”。打开后，在这里阅读公告会同时在 Canvas 上标为已读。默认关闭，此时 Semestra 只读取。

### Patch Changes

- afd8a0d: <!-- en -->
  Pages open faster: hovering a link gets the page ready, and the app loads less code and data up front.
  <!-- zh -->
  页面打开更快：鼠标悬停在链接上时就开始准备页面，应用启动时加载的代码和数据也更少。
- @semestra/api-client@1.1.0

## 1.0.0

### Major Changes

- e17427d: <!-- new -->
  <!-- en -->
  Semestra 1.0: terms and courses, schedule and calendar, tasks, grades and GPA planning, course files, imports from syllabi, calendars and Canvas, and Sem, an assistant that works across all of them and asks before it changes anything.
  <!-- zh -->
  Semestra 1.0：学期与课程、课表与日历、待办、成绩与 GPA 规划、课程文件，从课程大纲、日历和 Canvas 导入，以及能在这些地方帮你做事、改动前先征求你同意的助手 Sem。

### Patch Changes

- @semestra/api-client@1.0.0
