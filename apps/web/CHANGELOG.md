# @semestra/web

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
