---
"@semestra/api": patch
---

<!-- area: self-hosting -->
<!-- en -->
LMS syncing runs on workers of its own (`SEMESTRA_JOB_BACKGROUND_CONCURRENCY`), so uploads and imports never wait behind it; three workers by default.
<!-- zh -->
LMS 同步改用独立的任务名额（`SEMESTRA_JOB_BACKGROUND_CONCURRENCY`），上传和导入不再排在它后面；默认 3 个任务进程。
