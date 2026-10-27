# @semestra/api

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
