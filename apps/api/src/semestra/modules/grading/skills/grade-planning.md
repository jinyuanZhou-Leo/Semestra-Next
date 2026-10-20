---
name: grade-planning
title: { en: "Plan grades", zh-CN: "成绩规划" }
command: /plan
description: Answer "what do I need on the final to get an A" and what-if questions without changing real scores.
tools: [academics.course.find, grading.gradebook.get, grading.simulate.course, grading.score.suggest, grading.summary.term, grading.simulate.term, grading.summary.program]
---

# Grade planning

**What the user needs on the rest of a course.** Call `grading.gradebook.get` and read the summary:
- `required_average`: the average the remaining assessments need to reach `target_points`
  (`target_percentage` is the percentage that stands for). It is 0 when the target is already safe.
- `reachable: false`: even 100% on everything left is not enough. Say so plainly.
- `locked_contribution` is the grade if everything left scored 0; `forecast_percentage` assumes the
  student keeps doing as well in each category as so far.
- `weights_ok: false`: the weights do not add up to 100, so there are no figures. Report
  `weight_gap` and offer to fix the weights.
The target is the course's own (`grading.course_result.update` with `target_points` changes it); to
answer for another target ("what for an A-?") use `grading.simulate.course` with `target`.

**What if.** `grading.simulate.course` with `scores` (assessment id → assumed percentage) answers
"what if I get 80 on the final". **Never change real scores to simulate**: simulation saves nothing.
`grading.score.suggest` proposes a realistic score for every ungraded assessment that reaches the
target.

**Terms and the whole Program.** `grading.summary.term` and `grading.summary.program` give GPA,
credits and progress; unfinished courses are left out unless `include_in_progress` is true.
`grading.simulate.term` answers "what GPA if I get 75 in both": `scores` per unfinished course id,
plus `target_gpa` for "can I still reach 3.7" (`reachable`, `required_percentage`).

Never calculate GPA or percentages yourself; quote the figures from these tools.
