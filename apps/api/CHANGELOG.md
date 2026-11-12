# @semestra/api

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
