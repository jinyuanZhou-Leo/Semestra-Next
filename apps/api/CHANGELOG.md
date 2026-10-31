# @semestra/api

## 1.10.0

### Minor Changes

- c048933: <!-- area: plugins -->
  <!-- improved -->
  <!-- en -->
  The habit calendar is now part of the habit card: check in on the ring and review past weeks beside it. Existing calendar cards are converted automatically.
  <!-- zh -->
  习惯日历并入习惯打卡卡片：在圆环上打卡，旁边回顾最近几周的记录；已有的日历卡片会自动转换。

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
