---
name: setup-gradebook
title: { en: "Set up a gradebook", zh-CN: "设置成绩簿" }
command: /gradebook
description: Build a course gradebook (categories and weighted assessments) from the syllabus's grading scheme.
tools: [academics.course.find, grading.gradebook.get, grading.category.create, grading.category.update, grading.assessment.create_many, grading.assessment.update, grading.course_result.update]
---

# Setting up a gradebook

1. Identify the course (`academics.course.find`) and read what exists with `grading.gradebook.get`.
   Do not add items that are already there (compare titles).
2. From the syllabus's grading scheme, make sure every kind of assessment has a category
   (`categories` in the gradebook). Only create one (`grading.category.create`) when none of the
   built-in ones (quiz, exam, assignment, project, lab, presentation, participation) fits.
3. Add the assessments with `grading.assessment.create_many`: title, `category_id`, `weight` (percent
   of the course), and the deadline as `due_date` (+ `due_time` when the syllabus gives one) in the
   Program's time zone. When the weight of a group is given ("4 assignments, 20% total"), split it
   evenly and say so. For items imported from a source, set `source_kind` and `source_ref` so repeating
   the import creates no duplicates.
4. **Check the sum**: after creating, read `grading.gradebook.get`. `summary.weights_ok` must be true
   (weights add up to 100). If not, report `weight_gap` and ask the user before inventing weights.
5. A drop rule ("lowest quiz dropped") can be applied with `dropped: true` on that assessment once
   the scores are in.
6. A course that is only pass/fail, or where the user wants to enter only the final grade, uses
   `grading.course_result.update` (`basis: "pass_fail"`, or `gradebook_enabled: false` with
   `manual_percentage`).
