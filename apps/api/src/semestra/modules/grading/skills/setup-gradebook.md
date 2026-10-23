+++
name = "setup-gradebook"
title = { en = "Set up a gradebook", zh-CN = "设置成绩簿" }
command = "/gradebook"
description = "Use when the user tells you a course's grading scheme in the chat (\"2 midterms 25% each, final 40%\") and wants the gradebook built from it. A scheme in a file or syllabus is imported instead."
tools = [
  "academics.course.find",
  "grading.gradebook.get",
  "grading.category.create",
  "grading.category.update",
  "grading.assessment.create_many",
  "grading.assessment.update",
  "grading.course_result.update",
]
+++

# Setting up a gradebook

**A scheme in a file** (a syllabus PDF, a course page, an attachment) is imported so the user
reviews it first: load `import-from-documents` instead of this skill. LMS assignments are imported
through `use-lms`.

1. Read what exists with `grading.gradebook.get`. Do not add items that are already there
   (compare titles).
2. Make sure every kind of assessment in the scheme has a category: use the course's own
   `categories` that are not archived. Only create one (`grading.category.create`) when none
   fits.
3. Add the assessments with `grading.assessment.create_many`: title, `category_id`, `weight`
   (percent of the course), and the deadline as `due_date` (+ `due_time` when known) in the
   Program's time zone. When the weight of a group is given ("4 assignments, 20% total"), split
   it evenly and say so. Leave `source_kind` and `source_ref` out: they are for imports.
4. **Check the sum**: after creating, read `grading.gradebook.get`. `summary.weights_ok` must be
   true (weights add up to 100). If not, report `weight_gap` and ask the user before inventing
   weights.
5. A drop rule ("lowest quiz dropped") is applied with `dropped: true` on that assessment once
   the scores are in.
6. A course that is only pass/fail, or where the user wants to enter only the final grade, uses
   `grading.course_result.update` (`basis: "pass_fail"`, or `gradebook_enabled: false` with
   `manual_percentage`).
