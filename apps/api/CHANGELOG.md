# @semestra/api

## 2.7.0

### Minor Changes

- 59b6170: <!-- area: api -->
  <!-- en -->
  The HTTP-only grade list endpoint of the LMS integration is removed, and dismissing new assignments in the sync now takes assignment ids.
  <!-- zh -->
  移除 LMS 集成仅限 HTTP 的成绩列表接口，同步中忽略新作业改为传入作业 ID。
- 59b6170: <!-- area: canvas -->
  <!-- improved -->
  <!-- en -->
  Canvas assignments are saved in Semestra with each sync, so assignment details open instantly and stay available when Canvas can't be reached.
  <!-- zh -->
  Canvas 作业随同步保存在 Semestra 中，作业详情即开即看，Canvas 无法连接时也可查阅。
- 69b94e1: <!-- area: canvas -->
  <!-- en -->
  Canvas calendar events are saved with each sync, show up even when Canvas can't be reached, and now include events for your section.
  <!-- zh -->
  Canvas 日历事件随同步保存，Canvas 连不上时也能显示，并包含只给你所在 Section 的事件。
- 4422eac: <!-- area: canvas -->
  <!-- en -->
  When a teacher turns off an area on Canvas, its materials are no longer treated as deleted. They are listed under “Not syncing for now” in the sync status, where materials read from Canvas can be removed one by one or all at once.
  <!-- zh -->
  老师在 Canvas 上关闭某个栏目后，其中的资料不再被当作已删除，而是列在同步状态的“暂时无法同步”里，从 Canvas 读取的资料可以逐项或一次性移除。

### Patch Changes

- 8df8d28: <!-- area: self-hosting -->
  <!-- en -->
  On servers shared by several people, background work now takes turns between users, so one person's large sync no longer delays everyone else.
  <!-- zh -->
  多人共用的服务器上，后台任务在用户之间轮流处理，一个人的大量同步不再拖慢其他人。
- 2545142: <!-- area: canvas -->
  <!-- en -->
  Assignment status and due dates read the same in assignment details, to-dos and the Canvas tab; paper assignments stay under To do until they are due.
  <!-- zh -->
  作业状态与截止提示在作业详情、待办和 Canvas 标签中保持一致；纸质作业在截止前留在「待完成」中。
- 6656162: <!-- area: canvas -->
  <!-- en -->
  Files that only appear in modules while the Files tab is closed no longer flicker in and out of “Not syncing for now”.
  <!-- zh -->
  “文件”栏目关闭时，只出现在单元里的文件不再在“暂时无法同步”中反复出现又消失。
- aa10a0a: <!-- area: canvas -->
  <!-- en -->
  Faster course material sync: large courses come in with the first sync, saved files are downloaded only once, and the Canvas tab opens saved files from Semestra.
  <!-- zh -->
  课程资料同步更快：资料多的课程在第一次同步时一次带进，保存在 Semestra 的文件只下载一次，Canvas 标签页直接从 Semestra 打开已保存的文件。
- 5487327: <!-- area: files -->
  <!-- en -->
  Files kept after a course material leaves Canvas or the course is unlinked are now fully your own, and files saved by Sem count as your own when checking for duplicates and organizing.
  <!-- zh -->
  课程资料从 Canvas 删除或取消关联后留下的文件完全成为你自己的文件；Sem 存下的文件在查重和整理时也按你自己的文件处理。
- aa10a0a: <!-- area: canvas -->
  <!-- en -->
  Course materials deleted on Canvas are now removed even when the course hides its Files or Pages page.
  <!-- zh -->
  即使课程隐藏了文件页或页面列表，在 Canvas 上删除的课程资料也会同步移除。
- 03fbcd5: <!-- area: canvas -->
  <!-- en -->
  Sem, MCP and the app now agree on where each assignment stands: missing only when Canvas marks it missing, work handed in on paper is not counted as unsubmitted, and missing work that was later graded counts as graded.
  <!-- zh -->
  Sem、MCP 与应用对作业状态的判断保持一致：只有 Canvas 标记缺交的才算缺交，纸质提交的作业不再显示为未提交，缺交后补评的作业算作已评分。
- 9a7015d: <!-- area: canvas -->
  <!-- en -->
  Assignments now show every missing or late mark Canvas gives them, including work not yet submitted or handed in on paper, the same in assignment details, tasks, the Canvas tab and Sem.
  <!-- zh -->
  作业会显示 Canvas 标出的所有缺交与迟交标记，包括尚未提交和纸质提交的作业，作业详情、待办、Canvas 标签页和 Sem 中显示一致。
- 5e23ced: <!-- area: canvas -->
  <!-- en -->
  When a course hides both its files and its pages, the sync now checks the pages too instead of spending every round on the files.
  <!-- zh -->
  课程同时隐藏了文件和页面时，同步也会轮流检查页面，不再每轮只查文件。

## 2.6.0

### Minor Changes

- 36d41ab: <!-- area: canvas -->
  <!-- en -->
  Every gradebook assessment that comes from Canvas now has a button to open its assignment details, and it shows the teacher's feedback when there is some; in the Canvas tab, assignment names underline on hover.
  <!-- zh -->
  成绩册里来自 Canvas 的每个考核都有按钮可以打开作业详情，老师留了反馈时直接打开反馈；Canvas 页签里悬停作业时名称会加下划线。

## 2.5.0

No changes in this release.

## 2.4.1

### Patch Changes

- 9c8a47f: <!-- area: data -->
  <!-- en -->
  Course materials restored from a backup keep following renames on the platform.
  <!-- zh -->
  从备份恢复的课程资料会继续跟随平台上的改名。
- aa3da75: <!-- area: tasks -->
  <!-- en -->
  Apple Reminders now connects to self-hosted servers that use plain http.
  <!-- zh -->
  自部署的服务器未启用 https 时，现在也能连接 Apple 提醒事项。
- c0f1057: <!-- area: canvas -->
  <!-- en -->
  The Canvas content display chosen in 2.0 is kept after upgrading and when restoring a 2.0 backup.
  <!-- zh -->
  2.0 中选择的 Canvas 内容显示方式在升级后和恢复 2.0 备份时都会保留。
- c0f1057: <!-- area: canvas -->
  <!-- en -->
  Course materials sync again when a Canvas title contains a slash or a link points to an email address, and names keep their full title.
  <!-- zh -->
  Canvas 资料标题含斜杠或链接指向邮箱时，课程资料可以正常同步，名称也保留完整标题。
- f1f3584: <!-- area: canvas -->
  <!-- en -->
  Files saved from the Canvas page in 2.0 now follow the platform like other course materials and no longer appear twice.
  <!-- zh -->
  2.0 中从 Canvas 页面保存的文件现在会像其它课程资料一样跟随平台，不再重复出现。
- 532de87: <!-- area: files -->
  <!-- en -->
  Saving course materials in Semestra no longer holds up syncing your other courses, and the list of files being read loads faster.
  <!-- zh -->
  保存课程资料到 Semestra 时不再拖慢其它课程的同步，「正在读取」列表也加载得更快。
- 8f425cc: <!-- area: files -->
  <!-- en -->
  Switching a course back to reading materials from the LMS now stops copies that were still waiting to be saved.
  <!-- zh -->
  把课程改回从 LMS 读取资料后，还在排队的副本不再继续保存。
- 532de87: <!-- area: sem -->
  <!-- en -->
  Sem looks at LMS files through your course files, using the copy saved in Semestra when there is one.
  <!-- zh -->
  Sem 查看 LMS 文件的页面时经由课程文件，有保存在 Semestra 的副本就直接使用。
- 1e80c49: <!-- area: files -->
  <!-- en -->
  Downloading several files as a zip reads each file only once, and large selections no longer hit a limit.
  <!-- zh -->
  多个文件打包下载时每个文件只读取一次，选中很多文件时也不再受数量限制。

## 2.4.0

### Minor Changes

- c7b9d66: <!-- area: canvas -->
  <!-- en -->
  Choose how course materials sync when you connect Canvas or set up Semestra, before the first sync. Materials left after turning the sync off can be removed in one step.
  <!-- zh -->
  连接 Canvas 或初次设置时，可在首次同步前选好课程资料的同步方式；关闭同步后留下的资料可一次移除。
- e354755: <!-- area: api -->
  <!-- en -->
  AI tools connected over MCP now use Sem's skills and working rules, so they follow the same steps as Sem.
  <!-- zh -->
  通过 MCP 连接的 AI 工具现在可以使用 Sem 的技能和工作规则，按与 Sem 相同的步骤完成任务。

### Patch Changes

- 2ce7ebb: <!-- area: account -->
  <!-- en -->
  Signing in again in the same browser no longer leaves an extra entry under signed-in devices.
  <!-- zh -->
  在同一浏览器重新登录时，登录设备里不再多出一条旧记录。

## 2.3.0

### Minor Changes

- 1a7c305: <!-- area: files -->
  <!-- en -->
  The file list shows whether each course material is read from the LMS, being saved, saved, or saved as an older version, and why a save failed. Changing a course's storage setting now applies to all of its materials.
  <!-- zh -->
  文件列表会显示每份课程资料是从 LMS 读取、正在保存、已保存还是旧版本，保存失败时说明原因；更改课程的保存方式后，所有资料统一按新设置处理。
- e247b9c: <!-- area: canvas -->
  <!-- en -->
  Course materials follow Canvas more reliably: renamed files keep your name through updates, files locked on Canvas stay until they open, removed materials can be restored all at once, and materials published again on Canvas come back.
  <!-- zh -->
  课程资料更稳定地跟随 Canvas：改过名的文件更新后保留你的名字，Canvas 上锁定的文件保持原样，已移除的资料可以一次全部恢复，Canvas 上重新发布的资料会重新加进来。
- cd22c98: <!-- area: sem -->
  <!-- improved -->
  <!-- en -->
  Sem can save course materials in Semestra or stop saving them, process a file again and rename folders.
  <!-- zh -->
  Sem 可以将课程资料保存在 Semestra 或取消保存，重新处理文件，以及重命名文件夹。
- cd22c98: <!-- area: sem -->
  <!-- improved -->
  <!-- en -->
  Ask Sem which course materials were posted or updated on your LMS lately.
  <!-- zh -->
  可以问 Sem 最近 LMS 上新增或更新了哪些课程资料。

### Patch Changes

- 6a15653: <!-- area: files -->
  <!-- en -->
  Files changed again before they are read are now read once, for the latest version, and restored backups only re-index files that were indexed before.
  <!-- zh -->
  文件在读取前又有更新时只读取一次最新版本；恢复备份时只为原先已建立索引的文件重新建立索引。

## 2.2.0

### Patch Changes

- d22fd35: <!-- area: canvas -->
  <!-- en -->
  Sync status marks new course materials that match a file you uploaded yourself.
  <!-- zh -->
  同步状态会标出与你自己上传的文件重复的新课程资料。
- d22fd35: <!-- area: files -->
  <!-- en -->
  Uploading a file the course already has now asks first, including Canvas materials read online and files still uploading.
  <!-- zh -->
  上传课程中已有的文件时会先询问，包括在线读取的 Canvas 资料和正在上传的文件。
- d22fd35: <!-- area: files -->
  <!-- en -->
  Creating or renaming a folder to a name already used there shows a clear error on the name.
  <!-- zh -->
  新建或重命名文件夹时如与已有文件夹重名，会在名称处直接提示。
- d22fd35: <!-- area: imports -->
  <!-- en -->
  Importing a syllabus again no longer saves a second copy to the course files.
  <!-- zh -->
  再次导入同一份大纲时，不会在课程文件中重复保存。

## 2.1.0

### Minor Changes

- 26cc2db: <!-- area: account -->
  <!-- en -->
  Redesigned account emails, with verification codes that are easier to read and copy, including in dark mode.
  <!-- zh -->
  账户邮件焕新设计，验证码更醒目、更易复制，深色模式下同样清晰。
- 32a2587: <!-- area: grades -->
  <!-- improved -->
  <!-- en -->
  Instructor feedback from your LMS is saved in Semestra, so it stays readable after a course closes, and you're notified of new comments.
  <!-- zh -->
  LMS 上的老师评语保存在 Semestra 里，课程关闭后仍可查看；有新评语时会通知你。
- 45413cc: <!-- area: files -->
  <!-- en -->
  Course materials from your LMS can be read online or kept as a local copy. New and changed materials show up in the sync status, and new ones are marked until you open them.
  <!-- zh -->
  来自 LMS 的课程资料可以在线读取或保留本地副本；新增和更新的资料会出现在同步状态里，新资料在打开前会有标记。

### Patch Changes

- a297ad5: <!-- area: files -->
  <!-- en -->
  Downloading several files now says when none of them could be read, and the zip lists any files it had to leave out.
  <!-- zh -->
  批量下载在所有文件都无法读取时会给出提示；部分文件读取不到时，压缩包里会附一份未下载文件的清单。
- 73853e5: <!-- area: account -->
  <!-- en -->
  Resetting a password now checks the code first, so a password that doesn't meet the requirements can be changed without a new code.
  <!-- zh -->
  重置密码改为先验证验证码再设置新密码，新密码不符合要求时可直接修改，无需重新获取验证码。

## 2.0.0

### Major Changes

- e6a7e58: <!-- area: self-hosting -->
  <!-- en -->
  The `-ocr` image tags are no longer published; use the `-local` tags instead.
  <!-- zh -->
  不再发布 `-ocr` 镜像标签，请改用 `-local` 标签。
- 29d2459: <!-- area: api -->
  <!-- en -->
  Schedule endpoints and MCP tools are organized by section: weekly times are listed and added through schedule.section.*, and integrations that used schedule.meeting.list or schedule.meeting.create_many need updating.
  <!-- zh -->
  课表接口与 MCP 工具改为以教学班为单位：上课时间通过 schedule.section.* 列出和添加，使用 schedule.meeting.list 或 schedule.meeting.create_many 的集成需要更新。
- 475d435: <!-- area: self-hosting -->
  <!-- en -->
  Behind the bundled Caddy or another reverse proxy, set SEMESTRA_TRUSTED_PROXY_HOPS=1 so sign-in limits see the real client address; FORWARDED_ALLOW_IPS is no longer used.
  <!-- zh -->
  使用内置 Caddy 或其他反向代理时，请设置 SEMESTRA_TRUSTED_PROXY_HOPS=1，登录限流才能识别真实的客户端地址；不再使用 FORWARDED_ALLOW_IPS。

### Minor Changes

- a49e533: <!-- area: ai -->
  <!-- improved -->
  <!-- en -->
  When an AI feature can't run, it says why, such as no provider connected or a model that can't do it, with a direct way to fix it. A provider problem is pointed out without stopping you.
  <!-- zh -->
  AI 功能不可用时会说明原因（未连接服务商、模型不支持等），并直接带你去处理；服务商出问题时会提醒你，但不会挡住你。
- 08d582e: <!-- area: grades -->
  <!-- improved -->
  <!-- en -->
  Every assessment with a due date has a to-do that follows it and is finished when the assessment is graded; the calendar shows each deadline once.
  <!-- zh -->
  每个有截止日期的考核都有一个跟随它的待办，出分后自动完成；日历中每个截止日期只显示一次。
- 75d9a15: <!-- area: canvas -->
  <!-- en -->
  Assessments added by hand can be bound to Canvas assignments, and importing an assignment of the same name binds it instead of adding a duplicate.
  <!-- zh -->
  手动添加的考核可以绑定到 Canvas 作业，导入同名作业时会绑定到已有考核，不再重复添加。
- 56d3ac2: <!-- area: canvas -->
  <!-- en -->
  The Canvas tab combines assignments, quizzes and grades into one list; grades already on Canvas come along when importing to the gradebook.
  <!-- zh -->
  Canvas 页签把作业、测验和成绩合并为一个列表；导入到成绩簿时会带上 Canvas 上已有的成绩。
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
- 969865c: <!-- area: canvas -->
  <!-- en -->
  To-dos of imported assignments are checked off once Canvas shows them submitted; this can be turned off in the integration settings.
  <!-- zh -->
  导入的作业在 Canvas 上显示已提交后，对应待办自动完成；可在集成设置中关闭。
- 3e5c369: <!-- area: grades -->
  <!-- en -->
  Change several assessments at once: tick them to set a category or weight, split a total weight evenly, drop them from the grade, or delete them.
  <!-- zh -->
  可以一次修改多项考核：勾选后统一设置分类或权重、平分总权重、不计入成绩，或一起删除。
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
- a49e533: <!-- area: imports -->
  <!-- improved -->
  <!-- en -->
  Imports keep going when you close them: the sidebar shows their progress, or why a file couldn't be read, and takes you back to where you left off. Nothing pops up when reading finishes.
  <!-- zh -->
  导入关掉也不会丢：侧边栏显示进度或读取失败的原因，点一下就回到离开时的那一步，读完也不会弹窗打断你。
- a49e533: <!-- area: imports -->
  <!-- improved -->
  <!-- en -->
  The import review underlines values worth a second look, with the source text a click away.
  <!-- zh -->
  导入审核会标出需要确认的值，并能直接查看原文。
- a9eb8c8: <!-- area: account -->
  <!-- improved -->
  <!-- en -->
  Sensitive account actions now confirm it's you in place, with your password, an email code or Google, instead of signing you out.
  <!-- zh -->
  敏感的账户操作改为就地确认身份（密码、邮箱验证码或 Google），不再需要退出重新登录。
- f0dafdd: <!-- area: canvas -->
  
  <!-- en -->
  Linked courses now sync in the background: imported assignments follow Canvas, and you're only asked about new assignments, values changed on both sides, and the kinds of change you choose to review first. The sync's status, updates you can undo and a manual sync are in the sidebar.
  
  <!-- zh -->
  已关联的课程现在在后台同步：导入的作业自动跟随 Canvas，只有新作业、两边都改过的内容和你选择先过目的变化才会询问你。同步状态、可撤销的更新和手动同步都在侧边栏。
- d9a7988: <!-- area: canvas -->
  
  <!-- en -->
  Values you changed that no longer match Canvas are now easy to find and restore, from the sync panel or right where you edit them.
  
  <!-- zh -->
  自己改过、和 Canvas 不一致的值现在一目了然，可以在同步面板或编辑处一键改回。
- d65890a: <!-- area: data -->
  <!-- en -->
  Self-hosted servers: see, download and delete local OCR and search models under Settings → Data.
  <!-- zh -->
  自部署服务器可在设置 → 数据中查看、下载和删除本地 OCR 与搜索模型。
- 8523a69: <!-- area: api -->
  <!-- en -->
  See when a new MCP connection goes live, and review what each client has changed.
  <!-- zh -->
  新建 MCP 连接后可看到连接状态，并可查看每个客户端做过的修改。
- 12d0b47: <!-- area: api -->
  <!-- en -->
  Connect Semestra to ChatGPT and Claude by signing in, with no API token.
  <!-- zh -->
  现在可以登录授权，把 Semestra 连接到 ChatGPT 和 Claude，无需 API 令牌。
- aba17fc: <!-- area: data -->
  <!-- improved -->
  <!-- en -->
  Backups made with 1.x can be restored.
  <!-- zh -->
  可以恢复 1.x 导出的备份。
- e419fab: <!-- area: calendar -->
  <!-- improved -->
  <!-- en -->
  The course schedule groups sections by type, pre-fills the next section code, and can merge a section into an existing one with the same code.
  <!-- zh -->
  课程课表按教学班类型分组，新建时预填下一个编号，并可将教学班并入编号相同的已有教学班。
- 1529763: <!-- area: sem -->
  <!-- improved -->
  <!-- en -->
  Suggested questions in new conversations now come from your deadlines, classes and grades, and can be personalized by the light-task model (can be turned off in settings).
  <!-- zh -->
  新对话的推荐问题改为根据你的截止、课程和成绩生成，并可由轻量任务模型个性化改写（可在设置中关闭）。
- 9e622fd: <!-- area: notifications -->
  <!-- en -->
  System notifications: reminders before classes, events and due to-dos, a daily summary, and alerts for imports, Sem approvals and new sign-ins, with quiet hours.
  <!-- zh -->
  新增系统通知：上课、事件和待办截止前提醒，每日摘要，以及导入、Sem 等待确认和新登录通知，支持免打扰时段。

### Patch Changes

- cc73b39: <!-- area: self-hosting -->
  <!-- en -->
  Lower memory use with local embedding, and faster repeated searches and attachment cleanup.
  <!-- zh -->
  降低本机 embedding 的内存占用，加快重复搜索与附件清理。
- 3abc029: <!-- area: ai -->
  <!-- en -->
  AI providers are no longer marked unreachable by errors unrelated to the provider, and model lists load faster.
  <!-- zh -->
  AI 服务商不再因与其无关的错误被标为无法连接，模型列表加载更快。
- 61e922d: <!-- area: api -->
  <!-- en -->
  Added an endpoint that lists all course links of a program, and an option to include active jobs when listing jobs.
  <!-- zh -->
  新增列出学业项目全部课程关联的接口；列出任务时可附带进行中的任务。
- 3a6a241: <!-- area: general -->
  <!-- en -->
  Performance improvements.
  <!-- zh -->
  性能优化。
- 7e697ec: <!-- area: canvas -->
  <!-- en -->
  Links and images in Canvas pages and announcements now open on Canvas instead of a "Page not found" screen.
  <!-- zh -->
  Canvas 页面与公告中的链接和图片现在指向 Canvas，不再打开“页面不存在”。
- f4f3825: <!-- area: general -->
  <!-- en -->
  Clearer, more consistent wording throughout the app: to-dos are now called tasks everywhere, and settings descriptions are shorter.
  <!-- zh -->
  界面文案更清晰统一：Program、Section 与 LMS 不再翻译，“AI 服务商”改称“模型服务商”，设置说明更简洁。
- 1626ed9: <!-- area: general -->
  <!-- en -->
  Deleting terms, programs, folders and Sem conversations is faster, and uploading a backup no longer holds up other changes.
  <!-- zh -->
  删除学期、学业项目、文件夹和 Sem 对话更快，上传备份时不再阻塞其他修改。
- 9375f05: <!-- area: files -->
  <!-- en -->
  Headings and search snippets from PDFs no longer show Markdown symbols such as asterisks.
  <!-- zh -->
  PDF 的标题和搜索摘要不再显示星号等 Markdown 符号。
- cc73b39: <!-- area: files -->
  <!-- en -->
  Files that finish processing while you switch search models are indexed again with the new model.
  <!-- zh -->
  切换搜索模型时正在处理的文件，处理完成后会用新模型重新建立索引。
- eff4c90: <!-- area: grades -->
  <!-- en -->
  Grade forecasts are steadier when a category has only a few scores so far.
  <!-- zh -->
  成绩预测在分类里分数较少时更稳定。
- c786d14: <!-- area: grades -->
  <!-- en -->
  Hide grades now also masks percentages and shows a value when you hover over it, and gradebook due dates are shorter.
  <!-- zh -->
  隐藏成绩现在会同时隐藏百分制成绩，鼠标移上去即可查看，成绩册的截止日期也更简洁。
- c148c1b: <!-- area: imports -->
  <!-- en -->
  Importing the same syllabus again no longer duplicates its deadline tasks and calendar events.
  <!-- zh -->
  再次导入同一份课程大纲不再重复创建截止待办和日历事件。
- c148c1b: <!-- area: imports -->
  <!-- en -->
  An interrupted import resumes without reading files it already read, avoiding repeat AI charges.
  <!-- zh -->
  中断的导入恢复后不再重新读取已读过的文件，避免重复的 AI 费用。
- cc73b39: <!-- area: imports -->
  <!-- en -->
  Sources quoted from scanned pages of an imported document now point to the right page.
  <!-- zh -->
  导入文档中引自扫描页的出处现在指向正确的页码。
- c148c1b: <!-- area: imports -->
  <!-- en -->
  Syllabus dates such as "Week 5, Friday" or "Oct 3" now resolve when importing into a course, and dates far outside the term are flagged for review.
  <!-- zh -->
  导入到课程时可正确解析“第 5 周周五”“10 月 3 日”等大纲日期，远在学期之外的日期会在审核时标出。
- 3a6a241: <!-- area: self-hosting -->
  <!-- en -->
  LMS syncing runs on workers of its own (`SEMESTRA_JOB_BACKGROUND_CONCURRENCY`), so uploads and imports never wait behind it.
  <!-- zh -->
  LMS 同步改由专属的任务进程执行（`SEMESTRA_JOB_BACKGROUND_CONCURRENCY`），上传和导入不再排在它后面。
- 80f7b4e: <!-- area: courses -->
  <!-- en -->
  After a program, term or course is deleted, including from Sem or another tab, the app moves straight to one that still exists, and your only program can no longer be deleted.
  <!-- zh -->
  删除 Program、学期或课程后（包括在 Sem 或其他标签页里删除），应用会立即跳到仍存在的页面；唯一的 Program 不能再被删除。
- f3202e6: <!-- area: self-hosting -->
  <!-- en -->
  Self-hosted servers use less memory, and the images are slightly smaller.
  <!-- zh -->
  自部署的服务器占用更少内存，镜像也略小一些。
- 3a6a241: <!-- area: canvas -->
  <!-- en -->
  Ignored assignments no longer reappear in courses with many assignments.
  <!-- zh -->
  作业很多的课程里，已忽略的作业不会再次出现。
- 720ae3b: <!-- area: canvas -->
  
  <!-- en -->
  Importing assignments from Canvas always opens the import review first, so you can choose each one's category and edit it before anything is saved. The sync panel also shows a clear Reconnect button when the connection has expired.
  
  <!-- zh -->
  从 Canvas 导入作业时始终先打开导入审核，可以先选好每个作业的分类并修改，确认后才保存。连接失效时，同步面板也会直接给出「重新连接」按钮。
- 0e8790e: <!-- area: canvas -->
  
  <!-- en -->
  Sync questions are now answered one field at a time, and a value you keep can still be restored to the Canvas value later.
  
  <!-- zh -->
  同步询问改为逐个字段回答，保留的值之后仍可改回 Canvas 的值。
- 3abc029: <!-- area: self-hosting -->
  <!-- en -->
  A local embedding model that fails no longer interrupts search and indexing for other users of the server.
  <!-- zh -->
  某个本机 embedding 模型出错时，不再影响同一服务器上其他用户的搜索与索引。
- aee046d: <!-- area: files -->
  <!-- en -->
  Fixed scanned files failing to process with on-server OCR.
  <!-- zh -->
  修复使用本机 OCR 时扫描文件处理失败的问题。
- 8523a69: <!-- area: ai -->
  <!-- en -->
  Adding a model provider links to its documentation, and unnamed compatible endpoints are named in your language.
  <!-- zh -->
  添加模型服务商时可直接查看文档，未命名的兼容接口按界面语言命名。
- 3a6a241: <!-- area: data -->
  <!-- en -->
  Restoring an older backup keeps your Hide grades setting.
  <!-- zh -->
  恢复旧版备份时会保留“隐藏成绩”设置。
- f042585: <!-- area: files -->
  <!-- en -->
  Searching selected files now stays within the current term or course.
  <!-- zh -->
  在指定文件中搜索时，结果不再超出当前学期或课程。
- e419fab: <!-- area: calendar -->
  <!-- en -->
  Changing a section to a code that is already taken no longer fails with an unknown error.
  <!-- zh -->
  把教学班改成已被使用的编号时不再提示未知错误。
- 475d435: <!-- area: self-hosting -->
  <!-- en -->
  Link-local and cloud metadata addresses are now always blocked for outbound requests, even when private network access is allowed.
  <!-- zh -->
  出站请求始终拒绝链路本地和云主机元数据地址，即使允许访问内网也是如此。
- 3a6a241: <!-- area: sem -->
  <!-- en -->
  Files you mention with @ count toward your storage, and mentioning the same file again in a chat takes no extra space.
  <!-- zh -->
  用 @ 引用的文件计入存储空间；同一对话里再次引用同一文件不再额外占用。
- 9e52342: <!-- area: sem -->
  <!-- en -->
  Fixed Sem and MCP clients failing to look up assessments by name in courses that use grading categories.
  <!-- zh -->
  修复了课程设有成绩分类时，Sem 和 MCP 客户端按名称查找考核失败的问题。
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
- 475d435: <!-- area: api -->
  <!-- en -->
  API tokens follow the same limits on REST endpoints as over MCP: deleting needs the "Delete data" permission, and settings only you may change stay protected.
  <!-- zh -->
  API 令牌调用 REST 接口时与 MCP 遵守相同的限制：删除需要开启“删除数据”权限，只能由你本人修改的设置不会被令牌改动。
- 9e52342: <!-- area: api -->
  <!-- en -->
  When a tool fails on the server, Sem and MCP clients are told to get the information another way instead of retrying.
  <!-- zh -->
  工具在服务器端出错时，Sem 和 MCP 客户端会被提示改用其他方式获取信息，而不是反复重试。
- 1626ed9: <!-- area: files -->
  <!-- en -->
  Storage quota is enforced the same way for course files, import uploads and Sem attachments, including uploads made at the same time.
  <!-- zh -->
  课程文件、导入上传和 Sem 附件统一按存储配额检查，同时上传也不会超出配额。

## 2.0.0-beta.10

### Minor Changes

- a49e533: <!-- area: ai -->
  <!-- improved -->
  <!-- en -->
  When an AI feature can't run, it says why, such as no provider connected or a model that can't do it, with a direct way to fix it. A provider problem is pointed out without stopping you.
  <!-- zh -->
  AI 功能不可用时会说明原因（未连接服务商、模型不支持等），并直接带你去处理；服务商出问题时会提醒你，但不会挡住你。
- a49e533: <!-- area: imports -->
  <!-- improved -->
  <!-- en -->
  Imports keep going when you close them: the sidebar shows their progress, or why a file couldn't be read, and takes you back to where you left off. Nothing pops up when reading finishes.
  <!-- zh -->
  导入关掉也不会丢：侧边栏显示进度或读取失败的原因，点一下就回到离开时的那一步，读完也不会弹窗打断你。
- a49e533: <!-- area: imports -->
  <!-- improved -->
  <!-- en -->
  The import review underlines values worth a second look, with the source text a click away.
  <!-- zh -->
  导入审核会标出需要确认的值，并能直接查看原文。
- 8523a69: <!-- area: api -->
  <!-- en -->
  See when a new MCP connection goes live, and review what each client has changed.
  <!-- zh -->
  新建 MCP 连接后可看到连接状态，并可查看每个客户端做过的修改。
- 12d0b47: <!-- area: api -->
  <!-- en -->
  Connect Semestra to ChatGPT and Claude by signing in, with no API token.
  <!-- zh -->
  现在可以登录授权，把 Semestra 连接到 ChatGPT 和 Claude，无需 API 令牌。

### Patch Changes

- 3a6a241: <!-- area: general -->
  <!-- en -->
  Performance improvements.
  <!-- zh -->
  性能优化。
- f4f3825: <!-- area: general -->
  <!-- en -->
  Clearer, more consistent wording throughout the app: to-dos are now called tasks everywhere, and settings descriptions are shorter.
  <!-- zh -->
  界面文案更清晰统一：Program、Section 与 LMS 不再翻译，“AI 服务商”改称“模型服务商”，设置说明更简洁。
- c786d14: <!-- area: grades -->
  <!-- en -->
  Hide grades now also masks percentages and shows a value when you hover over it, and gradebook due dates are shorter.
  <!-- zh -->
  隐藏成绩现在会同时隐藏百分制成绩，鼠标移上去即可查看，成绩册的截止日期也更简洁。
- 3a6a241: <!-- area: self-hosting -->
  <!-- en -->
  LMS syncing runs on workers of its own (`SEMESTRA_JOB_BACKGROUND_CONCURRENCY`), so uploads and imports never wait behind it.
  <!-- zh -->
  LMS 同步改由专属的任务进程执行（`SEMESTRA_JOB_BACKGROUND_CONCURRENCY`），上传和导入不再排在它后面。
- 80f7b4e: <!-- area: courses -->
  <!-- en -->
  After a program, term or course is deleted, including from Sem or another tab, the app moves straight to one that still exists, and your only program can no longer be deleted.
  <!-- zh -->
  删除 Program、学期或课程后（包括在 Sem 或其他标签页里删除），应用会立即跳到仍存在的页面；唯一的 Program 不能再被删除。
- 3a6a241: <!-- area: canvas -->
  <!-- en -->
  Ignored assignments no longer reappear in courses with many assignments.
  <!-- zh -->
  作业很多的课程里，已忽略的作业不会再次出现。
- 8523a69: <!-- area: ai -->
  <!-- en -->
  Adding a model provider links to its documentation, and unnamed compatible endpoints are named in your language.
  <!-- zh -->
  添加模型服务商时可直接查看文档，未命名的兼容接口按界面语言命名。
- 3a6a241: <!-- area: data -->
  <!-- en -->
  Restoring an older backup keeps your Hide grades setting.
  <!-- zh -->
  恢复旧版备份时会保留“隐藏成绩”设置。
- 3a6a241: <!-- area: sem -->
  <!-- en -->
  Files you mention with @ count toward your storage, and mentioning the same file again in a chat takes no extra space.
  <!-- zh -->
  用 @ 引用的文件计入存储空间；同一对话里再次引用同一文件不再额外占用。

## 2.0.0-beta.9

### Minor Changes

- 3e5c369: <!-- area: grades -->
  <!-- en -->
  Change several assessments at once: tick them to set a category or weight, split a total weight evenly, drop them from the grade, or delete them.
  <!-- zh -->
  可以一次修改多项考核：勾选后统一设置分类或权重、平分总权重、不计入成绩，或一起删除。

## 2.0.0-beta.8

### Minor Changes

- f0dafdd: <!-- area: canvas -->
  
  <!-- en -->
  Linked courses now sync in the background: imported assignments follow Canvas, and you're only asked about new assignments, values changed on both sides, and the kinds of change you choose to review first. The sync's status, updates you can undo and a manual sync are in the sidebar.
  
  <!-- zh -->
  已关联的课程现在在后台同步：导入的作业自动跟随 Canvas，只有新作业、两边都改过的内容和你选择先过目的变化才会询问你。同步状态、可撤销的更新和手动同步都在侧边栏。
- d9a7988: <!-- area: canvas -->
  
  <!-- en -->
  Values you changed that no longer match Canvas are now easy to find and restore, from the sync panel or right where you edit them.
  
  <!-- zh -->
  自己改过、和 Canvas 不一致的值现在一目了然，可以在同步面板或编辑处一键改回。

### Patch Changes

- 720ae3b: <!-- area: canvas -->
  
  <!-- en -->
  Importing assignments from Canvas always opens the import review first, so you can choose each one's category and edit it before anything is saved. The sync panel also shows a clear Reconnect button when the connection has expired.
  
  <!-- zh -->
  从 Canvas 导入作业时始终先打开导入审核，可以先选好每个作业的分类并修改，确认后才保存。连接失效时，同步面板也会直接给出「重新连接」按钮。
- 0e8790e: <!-- area: canvas -->
  
  <!-- en -->
  Sync questions are now answered one field at a time, and a value you keep can still be restored to the Canvas value later.
  
  <!-- zh -->
  同步询问改为逐个字段回答，保留的值之后仍可改回 Canvas 的值。

## 2.0.0-beta.7

### Patch Changes

- 9375f05: <!-- area: files -->
  <!-- en -->
  Headings and search snippets from PDFs no longer show Markdown symbols such as asterisks.
  <!-- zh -->
  PDF 的标题和搜索摘要不再显示星号等 Markdown 符号。
- eff4c90: <!-- area: grades -->
  <!-- en -->
  Grade forecasts are steadier when a category has only a few scores so far.
  <!-- zh -->
  成绩预测在分类里分数较少时更稳定。

## 2.0.0-beta.6

No changes in this release.

## 2.0.0-beta.5

### Major Changes

- e6a7e58: <!-- area: self-hosting -->
  <!-- en -->
  The `-ocr` image tags are no longer published; use the `-local` tags instead.
  <!-- zh -->
  不再发布 `-ocr` 镜像标签，请改用 `-local` 标签。

### Minor Changes

- 75d9a15: <!-- area: canvas -->
  <!-- en -->
  Assessments added by hand can be bound to Canvas assignments, and importing an assignment of the same name binds it instead of adding a duplicate.
  <!-- zh -->
  手动添加的考核可以绑定到 Canvas 作业，导入同名作业时会绑定到已有考核，不再重复添加。

### Patch Changes

- f3202e6: <!-- area: self-hosting -->
  <!-- en -->
  Self-hosted servers use less memory, and the images are slightly smaller.
  <!-- zh -->
  自部署的服务器占用更少内存，镜像也略小一些。
- 9e52342: <!-- area: sem -->
  <!-- en -->
  Fixed Sem and MCP clients failing to look up assessments by name in courses that use grading categories.
  <!-- zh -->
  修复了课程设有成绩分类时，Sem 和 MCP 客户端按名称查找考核失败的问题。
- 9e52342: <!-- area: api -->
  <!-- en -->
  When a tool fails on the server, Sem and MCP clients are told to get the information another way instead of retrying.
  <!-- zh -->
  工具在服务器端出错时，Sem 和 MCP 客户端会被提示改用其他方式获取信息，而不是反复重试。

## 2.0.0-beta.4

No changes in this release.

## 2.0.0-beta.3

No changes in this release.

## 2.0.0-beta.2

### Minor Changes

- a9eb8c8: <!-- area: account -->
  <!-- improved -->
  <!-- en -->
  Sensitive account actions now confirm it's you in place, with your password, an email code or Google, instead of signing you out.
  <!-- zh -->
  敏感的账户操作改为就地确认身份（密码、邮箱验证码或 Google），不再需要退出重新登录。
- e419fab: <!-- area: calendar -->
  <!-- improved -->
  <!-- en -->
  The course schedule groups sections by type, pre-fills the next section code, and can merge a section into an existing one with the same code.
  <!-- zh -->
  课程课表按教学班类型分组，新建时预填下一个编号，并可将教学班并入编号相同的已有教学班。

### Patch Changes

- e419fab: <!-- area: calendar -->
  <!-- en -->
  Changing a section to a code that is already taken no longer fails with an unknown error.
  <!-- zh -->
  把教学班改成已被使用的编号时不再提示未知错误。

## 2.0.0-beta.1

### Major Changes

- 475d435: <!-- area: self-hosting -->
  <!-- en -->
  Behind the bundled Caddy or another reverse proxy, set SEMESTRA_TRUSTED_PROXY_HOPS=1 so sign-in limits see the real client address; FORWARDED_ALLOW_IPS is no longer used.
  <!-- zh -->
  使用内置 Caddy 或其他反向代理时，请设置 SEMESTRA_TRUSTED_PROXY_HOPS=1，登录限流才能识别真实的客户端地址；不再使用 FORWARDED_ALLOW_IPS。

### Patch Changes

- cc73b39: <!-- area: self-hosting -->
  <!-- en -->
  Lower memory use with local embedding, and faster repeated searches and attachment cleanup.
  <!-- zh -->
  降低本机 embedding 的内存占用，加快重复搜索与附件清理。
- 3abc029: <!-- area: ai -->
  <!-- en -->
  AI providers are no longer marked unreachable by errors unrelated to the provider, and model lists load faster.
  <!-- zh -->
  AI 服务商不再因与其无关的错误被标为无法连接，模型列表加载更快。
- 61e922d: <!-- area: api -->
  <!-- en -->
  Added an endpoint that lists all course links of a program, and an option to include active jobs when listing jobs.
  <!-- zh -->
  新增列出学业项目全部课程关联的接口；列出任务时可附带进行中的任务。
- 1626ed9: <!-- area: general -->
  <!-- en -->
  Deleting terms, programs, folders and Sem conversations is faster, and uploading a backup no longer holds up other changes.
  <!-- zh -->
  删除学期、学业项目、文件夹和 Sem 对话更快，上传备份时不再阻塞其他修改。
- cc73b39: <!-- area: files -->
  <!-- en -->
  Files that finish processing while you switch search models are indexed again with the new model.
  <!-- zh -->
  切换搜索模型时正在处理的文件，处理完成后会用新模型重新建立索引。
- c148c1b: <!-- area: imports -->
  <!-- en -->
  Importing the same syllabus again no longer duplicates its deadline tasks and calendar events.
  <!-- zh -->
  再次导入同一份课程大纲不再重复创建截止待办和日历事件。
- c148c1b: <!-- area: imports -->
  <!-- en -->
  An interrupted import resumes without reading files it already read, avoiding repeat AI charges.
  <!-- zh -->
  中断的导入恢复后不再重新读取已读过的文件，避免重复的 AI 费用。
- cc73b39: <!-- area: imports -->
  <!-- en -->
  Sources quoted from scanned pages of an imported document now point to the right page.
  <!-- zh -->
  导入文档中引自扫描页的出处现在指向正确的页码。
- c148c1b: <!-- area: imports -->
  <!-- en -->
  Syllabus dates such as "Week 5, Friday" or "Oct 3" now resolve when importing into a course, and dates far outside the term are flagged for review.
  <!-- zh -->
  导入到课程时可正确解析“第 5 周周五”“10 月 3 日”等大纲日期，远在学期之外的日期会在审核时标出。
- 3abc029: <!-- area: self-hosting -->
  <!-- en -->
  A local embedding model that fails no longer interrupts search and indexing for other users of the server.
  <!-- zh -->
  某个本机 embedding 模型出错时，不再影响同一服务器上其他用户的搜索与索引。
- aee046d: <!-- area: files -->
  <!-- en -->
  Fixed scanned files failing to process with on-server OCR.
  <!-- zh -->
  修复使用本机 OCR 时扫描文件处理失败的问题。
- f042585: <!-- area: files -->
  <!-- en -->
  Searching selected files now stays within the current term or course.
  <!-- zh -->
  在指定文件中搜索时，结果不再超出当前学期或课程。
- 475d435: <!-- area: self-hosting -->
  <!-- en -->
  Link-local and cloud metadata addresses are now always blocked for outbound requests, even when private network access is allowed.
  <!-- zh -->
  出站请求始终拒绝链路本地和云主机元数据地址，即使允许访问内网也是如此。
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
- 475d435: <!-- area: api -->
  <!-- en -->
  API tokens follow the same limits on REST endpoints as over MCP: deleting needs the "Delete data" permission, and settings only you may change stay protected.
  <!-- zh -->
  API 令牌调用 REST 接口时与 MCP 遵守相同的限制：删除需要开启“删除数据”权限，只能由你本人修改的设置不会被令牌改动。
- 1626ed9: <!-- area: files -->
  <!-- en -->
  Storage quota is enforced the same way for course files, import uploads and Sem attachments, including uploads made at the same time.
  <!-- zh -->
  课程文件、导入上传和 Sem 附件统一按存储配额检查，同时上传也不会超出配额。

## 2.0.0-beta.0

### Major Changes

- 29d2459: <!-- area: api -->
  <!-- en -->
  Schedule endpoints and MCP tools are organized by section: weekly times are listed and added through schedule.section.*, and integrations that used schedule.meeting.list or schedule.meeting.create_many need updating.
  <!-- zh -->
  课表接口与 MCP 工具改为以教学班为单位：上课时间通过 schedule.section.* 列出和添加，使用 schedule.meeting.list 或 schedule.meeting.create_many 的集成需要更新。

### Minor Changes

- 08d582e: <!-- area: grades -->
  <!-- improved -->
  <!-- en -->
  Every assessment with a due date has a to-do that follows it and is finished when the assessment is graded; the calendar shows each deadline once.
  <!-- zh -->
  每个有截止日期的考核都有一个跟随它的待办，出分后自动完成；日历中每个截止日期只显示一次。
- 56d3ac2: <!-- area: canvas -->
  <!-- en -->
  The Canvas tab combines assignments, quizzes and grades into one list; grades already on Canvas come along when importing to the gradebook.
  <!-- zh -->
  Canvas 页签把作业、测验和成绩合并为一个列表；导入到成绩簿时会带上 Canvas 上已有的成绩。
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
- 969865c: <!-- area: canvas -->
  <!-- en -->
  To-dos of imported assignments are checked off once Canvas shows them submitted; this can be turned off in the integration settings.
  <!-- zh -->
  导入的作业在 Canvas 上显示已提交后，对应待办自动完成；可在集成设置中关闭。
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
- aba17fc: <!-- area: data -->
  <!-- improved -->
  <!-- en -->
  Backups made with 1.x can be restored.
  <!-- zh -->
  可以恢复 1.x 导出的备份。
- 1529763: <!-- area: sem -->
  <!-- improved -->
  <!-- en -->
  Suggested questions in new conversations now come from your deadlines, classes and grades, and can be personalized by the light-task model (can be turned off in settings).
  <!-- zh -->
  新对话的推荐问题改为根据你的截止、课程和成绩生成，并可由轻量任务模型个性化改写（可在设置中关闭）。
- 9e622fd: <!-- area: notifications -->
  <!-- en -->
  System notifications: reminders before classes, events and due to-dos, a daily summary, and alerts for imports, Sem approvals and new sign-ins, with quiet hours.
  <!-- zh -->
  新增系统通知：上课、事件和待办截止前提醒，每日摘要，以及导入、Sem 等待确认和新登录通知，支持免打扰时段。

### Patch Changes

- 7e697ec: <!-- area: canvas -->
  <!-- en -->
  Links and images in Canvas pages and announcements now open on Canvas instead of a "Page not found" screen.
  <!-- zh -->
  Canvas 页面与公告中的链接和图片现在指向 Canvas，不再打开“页面不存在”。

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

## 1.14.1

### Patch Changes

- 71b1fdf: <!-- area: self-hosting -->
  
  <!-- en -->
  Fixed self-hosted Docker instances failing to save Canvas connections and AI provider keys.
  
  <!-- zh -->
  修复了 Docker 自托管实例无法保存 Canvas 连接和 AI 服务商密钥的问题。

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

- 6e9ba1c: <!-- area: imports -->
  <!-- en -->
  Long syllabi and scanned documents import reliably, and reading them is faster and cheaper.
  <!-- zh -->
  较长的课程大纲和扫描件可以稳定导入，读取速度更快、费用更低。
- 6e9ba1c: <!-- area: files -->
  <!-- en -->
  Improved search accuracy for common embedding models, smaller Gemini vectors, and support for services that accept only small batches.
  <!-- zh -->
  提升常用向量模型的搜索准确度，缩小 Gemini 向量占用的空间，并支持单次只接收少量文本的服务。
- 6e9ba1c: <!-- area: files -->
  <!-- en -->
  Search falls back to keywords within seconds when the embedding model is slow.
  <!-- zh -->
  向量模型响应慢时，搜索会在几秒内改用关键词返回结果。
- e53664d: <!-- area: self-hosting -->
  <!-- en -->
  Rebuilding search indexes and downloading models no longer hold up imports and new files.
  <!-- zh -->
  重建搜索索引和下载模型不再阻塞导入和新文件的处理。
- 6e9ba1c: <!-- area: self-hosting -->
  <!-- en -->
  Faster local OCR and local search when users choose different models.
  <!-- zh -->
  本机 OCR 更快；用户选用不同本机搜索模型时不再反复加载模型。

## 1.13.0

### Minor Changes

- 3692fa4: <!-- area: self-hosting -->
  <!-- en -->
  Self-hosted servers can run search embedding models locally, so file search works without an AI provider. Choose a built-in model or any Hugging Face model with an ONNX version. The default image is now tagged -local; the -ocr tag still works.
  <!-- zh -->
  自部署服务器可以在本机运行搜索用的 embedding 模型，不接 AI 服务商也能搜索文件内容。可以选内置模型，也可以使用 Hugging Face 上任何带 ONNX 版本的模型。默认镜像的标签改为 -local，原来的 -ocr 标签仍然可用。

### Patch Changes

- c9c83ad: <!-- area: general -->
  <!-- en -->
  Finished background tasks now stay in the status bar for about 15 seconds, and while the task list is open.
  <!-- zh -->
  后台任务完成后会在状态条保留约 15 秒，任务列表打开期间也不会消失。

## 1.12.0

No changes in this release.

## 1.11.3

No changes in this release.

## 1.11.2

No changes in this release.

## 1.11.1

### Patch Changes

- 9f1ca3e: <!-- area: canvas -->
  <!-- en -->
  Self-hosted instances can connect Canvas with a school account instead of a personal access token.
  <!-- zh -->
  自托管实例可用学校账号连接 Canvas，无需个人访问令牌。

## 1.11.0

### Patch Changes

- 5d168af: <!-- area: account -->
  <!-- en -->
  Limited how many times a sign-in code can be checked for one email address per day, to better protect accounts.
  <!-- zh -->
  限制了同一邮箱每天校验验证码的次数，更好地保护账户安全。

## 1.10.0

### Minor Changes

- c048933: <!-- area: plugins -->
  <!-- improved -->
  <!-- en -->
  The habit calendar is now part of the habit card: check in on the ring and review past weeks beside it. Existing calendar cards are converted automatically.
  <!-- zh -->
  习惯日历并入习惯打卡卡片：在圆环上打卡，旁边回顾最近几周的记录；已有的日历卡片会自动转换。

### Patch Changes

- d99b9f1: <!-- area: imports -->
  <!-- en -->
  Reading a syllabus with Claude models works again, and is faster: course info, grading and schedule are read side by side.
  <!-- zh -->
  用 Claude 模型识别课程大纲不再报错，而且更快：课程信息、成绩构成和课表同时识别。

## 1.9.0

### Minor Changes

- 33aa7fe: <!-- area: api -->
  <!-- en -->
  MCP tools are streamlined: adding items always takes a list, and failed calls include a hint on what to do next.
  <!-- zh -->
  精简 MCP 工具：添加条目统一接受列表，调用失败时附带下一步提示。

### Patch Changes

- e3deebc: <!-- area: sem -->
  <!-- en -->
  Sem's tool definitions are leaner, so each request uses less context.
  <!-- zh -->
  精简 Sem 的工具定义，每次请求占用的上下文更少。
- 33aa7fe: <!-- area: sem -->
  <!-- en -->
  Sem picks the right tools more reliably and recovers from failed actions with clearer guidance.
  <!-- zh -->
  Sem 选择工具更准确，操作失败时能按提示更快纠正。

## 1.8.0

### Patch Changes

- b409973: <!-- area: general -->
  <!-- en -->
  Performance improvements.
  <!-- zh -->
  性能优化。

## 1.7.0

No changes in this release.

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

## 1.5.0

### Minor Changes

- d819cc5: <!-- area: files -->
  <!-- en -->
  You can turn off automatic indexing of new files for a Program or a course, and index a file only when you need it.
  <!-- zh -->
  可以为学业项目或单门课程关闭新文件的自动索引，需要时再为某个文件建立索引。

## 1.4.0

No changes in this release.

## 1.3.0

### Patch Changes

- 952d52d: <!-- en -->
  Sem: an approved change and the answer after it can be followed after a reload or in another tab, and a slow title no longer holds up the answer.
  <!-- zh -->
  Sem：批准后的修改和随后的回答在刷新或换标签页后也能接着看，起标题慢也不会拖住回答。
- 952d52d: <!-- en -->
  Sem: long conversations keep more of what was said, since what earlier lookups returned is cleared before anything is summarized, and pressing Stop while compacting ends the turn and keeps the history as it was.
  <!-- zh -->
  Sem：长对话压缩时先清掉较早的查询结果，再考虑总结，保留下来的对话更多；压缩时按停止会结束这一轮并保留原来的历史。
- 952d52d: <!-- en -->
  Sem: a change you approve after the conversation has moved on is no longer lost when you regenerate or edit a message.
  <!-- zh -->
  Sem：对话继续往下之后才批准的修改，在重新生成或编辑消息时不会再被悄悄丢掉。
- 952d52d: <!-- en -->
  Sem keeps trying to learn from a conversation while your AI provider is unreachable, instead of giving up after a few tries.
  <!-- zh -->
  AI 服务商暂时连不上时，Sem 会继续尝试从对话中整理记忆，不会试几次就放弃。
- 952d52d: <!-- en -->
  Sem: with providers that reuse tool call ids, approvals and steps now match the right answer.
  <!-- zh -->
  Sem：使用会重复工具调用 id 的服务商时，批准和步骤会对应到正确的回答。
- 952d52d: <!-- en -->
  Sem: a scanned PDF page that cannot be rendered is noted in the conversation instead of breaking the answer.
  <!-- zh -->
  Sem：附件里渲染不了的扫描页会在对话中注明，不会再让回答出错。

## 1.2.0

### Patch Changes

- f3c8c3d: <!-- en -->
  Files and imports: import uploads count toward your storage, unsubmitted imports are cleaned up after 30 days, and two commits of the same import can no longer both write. File processing is faster and more robust (first-page thumbnails only, scanned pages read in parallel and one bad page no longer fails the file, missing embeddings are retried). Search is quicker, long file lists scroll smoothly, and uploads show real progress. Syllabus imports wait for course files that are still processing, read GBK text and phone photos correctly, cancel classes on "no class" dates, and share category weights across their assessments.
  <!-- zh -->
  文件与导入：导入的上传计入存储空间，30 天没提交的导入会被清理，同一次导入不会被提交两次。文件处理更快更稳（只生成首页缩略图，扫描页并行识别，单页出错不再让整个文件失败，缺失的向量会自动补齐）。检索更快，长文件列表滚动流畅，上传显示真实进度。课程大纲导入会等待仍在处理的课程文件，能正确读取 GBK 文本和手机照片，"停课"日期会取消对应的上课时间，分类权重会分摊到各项考核。

## 1.1.1

No changes in this release.

## 1.1.0

No changes in this release.

## 1.0.0

No changes in this release.
