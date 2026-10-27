# @semestra/web

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
