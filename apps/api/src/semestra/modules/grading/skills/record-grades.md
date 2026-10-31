+++
name = "record-grades"
title = { en = "Record grades", zh-CN = "录入成绩" }
command = "/grade"
description = "Use when the user reports a score they got (\"I got 82 on the midterm\", \"Lab 3: 18/20\") or an official final grade, to record it on the right assessment or course."
tools = [
  "academics.course.find",
  "grading.assessment.find",
  "grading.assessment.list",
  "grading.assessment.create_many",
  "grading.assessment.update",
  "grading.gradebook.get",
  "grading.course_result.update",
]
+++

# Recording grades

1. **Find the assessment.** Call `grading.assessment.find` with the user's words ("midterm",
   "Lab 3"). Pass `course_id` only when the user named a course (`academics.course.find`);
   otherwise it searches the Program, current term first, and each candidate names its course.
   When the top candidates are close, ask which one, naming their courses.
2. **Nothing matches?** Read the course's `grading.assessment.list`: the user may call it
   something else. If it really is missing, call `grading.assessment.create_many` (title, a category
   from the course's `grading.gradebook.get`, the weight if known, the deadline as `due_date`)
   and then record the score on it. The cards confirm both, so do not ask first; ask only when
   you cannot tell which course it belongs to.
3. **Record the score** with `grading.assessment.update`:
   - A percentage ("82", "82%"): `score_percentage: 82`.
   - A fraction ("18/20", "18 out of 20"): `points_earned: 18`, `points_possible: 20`. Never
     convert it to a percentage yourself.
   - Bonus marks above 100% are allowed. To take a score back, send `null`.
4. **Tell the user the effect**: read `grading.gradebook.get` and report
   `summary.current_percentage` (and `summary.final_percentage` when the course is complete). If
   `summary.weights_ok` is false, say the weights do not add up to 100 (by `weight_gap`), so no
   figures can be shown yet.

An official final grade from the school is not a score on an assessment: use
`grading.course_result.update` with `final_override_percentage`.
