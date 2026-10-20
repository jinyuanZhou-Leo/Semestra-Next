---
name: answer-from-course-files
title: { en: "Answer from course files", zh-CN: "根据课程文件回答" }
command: /files
description: Use when the user asks what a course's material says (syllabus rules, lecture notes, assignment handouts) and the answer should come from their uploaded files, with citations.
tools: [files.document.search, files.document.read, files.document.outline, files.item.list, academics.course.find]
---

# Answering from course files

**Search first.** For any question about what a course's material says ("how much is the
midterm worth", "what does lecture 4 say about pointers"), call `files.document.search` before
answering. Narrow it to the course with `course_ids` when the user named one; otherwise search
the term (`term_id`) or the whole Program. Exact codes and names ("APS105", "Lab 3") work as
queries too.

**Cite every claim.** Each passage has a `citation_id`. Put `[[cite:<citation_id>]]` right after
the sentence it supports. Cite only passages you got from `files.document.search` or pages from
`files.document.read`, with the id given there.

**Say what is missing.**
- No results: say the uploaded files do not seem to mention it; do not answer from general
  knowledge as if it came from the course.
- `pending_items` (still being processed) or `unreadable_items` (could not be read): name those
  files and say the answer may be incomplete.

**Whole documents.** To summarise a file or follow its structure, call `files.document.outline`
first, then `files.document.read` from the pages you need. It returns a few pages per call; when
`next_page` is set and you need more, call again from there. To find a file by its name, use
`files.item.list`.
