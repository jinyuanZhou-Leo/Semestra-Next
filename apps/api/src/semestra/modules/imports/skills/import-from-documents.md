---
name: import-from-documents
title: { en: "Import from documents", zh-CN: "从文档导入" }
command: /import
description: Use when the user shares a syllabus, timetable, ICS file or screenshot and wants its courses, grading scheme, class times or dates in the app ("import this", "import syllabus", "set up my courses from these"), or to finish an import an LMS tool started.
tools: [academics.course.find, academics.term.list, academics.term.create, academics.term.update, imports.session.create, imports.session.get, imports.item.update, imports.item.decide_many, imports.item.add_many, imports.session.commit, imports.session.discard]
---

# Importing from documents

Everything a document brings in goes through one import, which the user reviews before anything
is written. Never "import" a document by calling the courses, grading, schedule or tasks create
tools one by one.

1. **Pick the target.** A course the user names: `{kind: "course", course_id}`. Otherwise the
   term of the work context: `{kind: "term", term_id}`; use another term only when the user
   names it. **An import never creates terms**: if the document is for a term that does not
   exist yet, create it first with `academics.term.create` (name and dates from the document or
   the user).
2. **Start the import.** `imports.session.create` with the files themselves, never their text
   copied into arguments: files attached to this conversation go in `attachment_ids` (the `id`
   of their `<attachment>` block), course files in `file_item_ids`. `source_kind` is `ics` for a
   calendar file (read exactly, with cancelled dates, without AI), `syllabus` for course
   documents, `timetable_image` for a screenshot of a timetable, `text` only for text the user
   pasted. Mixed files: one import per kind. `ai.not_configured`: tell the user AI needs a model
   in the settings; ICS files work without one.
3. **Wait until it is ready.** AI sources start as `extracting`: call `imports.session.get` once
   with `wait_seconds` (up to 25). If it is still extracting after that, tell the user it is
   still reading and stop. `failed` with `import.no_content`: the document had nothing usable;
   say so. A `source_refs` entry with `status: failed` means that one file could not be read;
   name it.
4. **Summarise.** Tell the user what was found per course (assessments with weights, class
   times, dates). `summary.issues` only counts open issues per code; to explain them, read the
   items with `imports.session.get` (`fields: ["issues", "data"]`) and say in plain words what is
   wrong: dates that could not be worked out, weights that do not add up to 100, courses or
   assessments that already exist. Fix what the user tells you with `imports.item.update`
   (`data` for fields, `decision: "reject"` to leave an item out) or `imports.item.decide_many`
   for many (rejecting a course rejects what belongs to it). A course item's `term_ids` decide
   which existing term it goes into, and its class times follow it.
5. **Commit.** If issues the user has to decide are still open, ask about them and stop.
   Otherwise, in the same reply, say what the commit will write (courses, class times,
   assessments per term, and what you left out) and call `imports.session.commit`; the user
   confirms on its card. Report `created`, `updated` and `failed`; for failed items say why
   (`result.error_code`) and offer to fix and commit again (only the failed items are retried).
6. **Your own findings.** Only for what no importer reads (the user's own words, a format the
   importers refuse): create an import with `source_kind: "agent"`, add items with
   `imports.item.add_many` (each type has its own fields; a class's cancelled dates go in
   `exceptions`) and go through steps 4–5.
7. **Report what was left out.** Name anything in the documents that the import did not cover
   (dates it could not place, sections you skipped), so the user does not assume everything was
   taken in.

If the user changes their mind, `imports.session.discard`.
