---
"@semestra/api": patch
---

<!-- area: self-hosting -->
<!-- en -->
LMS syncing runs on workers of its own (`SEMESTRA_JOB_BACKGROUND_CONCURRENCY`), so uploads and imports never wait behind it.
<!-- zh -->
LMS 同步改由专属的任务进程执行（`SEMESTRA_JOB_BACKGROUND_CONCURRENCY`），上传和导入不再排在它后面。
