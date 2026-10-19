---
name: record-grades
description: Record a score the user got ("I got 82 on the midterm", "Lab 3: 18/20") on the right assessment.
tools: [academics.course.find, grading.assessment.find, grading.assessment.create, grading.assessment.update, grading.gradebook.get]
---

# Recording grades

1. **Find the course.** If the user names it ("my calc midterm"), call `academics.course.find`; if
   the course is on screen you may skip this. Ask when the two best candidates score similarly.
2. **Find the assessment.** `grading.assessment.find` with the words the user used ("midterm",
   "Lab 3") and the course id. Several close candidates: ask which one.
3. **Nothing matches?** Ask whether to create it. If the user agrees, `grading.assessment.create`
   with the title, the category from `grading.gradebook.get` (`categories`), the weight if known and
   the deadline as `due_date`; then record the score on it.
4. **Record the score** with `grading.assessment.update`:
   - A percentage ("82", "82%"): `score_percentage: 82`.
   - A fraction ("18/20", "18 out of 20"): `points_earned: 18`, `points_possible: 20`. Never convert it
     to a percentage yourself.
   - Bonus marks above 100% are allowed.
   - To take a score back, send `null` for it.
5. **Tell the user the effect**: read `grading.gradebook.get` and report `summary.current_percentage`
   (and `summary.final_percentage` when the course is complete). If `summary.weights_ok` is false,
   say that the weights do not add up to 100 (by `weight_gap`), so no figures can be shown yet.

An official final grade from the registrar is not a score on an assessment: use
`grading.course_result.update` with `final_override_percentage`.
