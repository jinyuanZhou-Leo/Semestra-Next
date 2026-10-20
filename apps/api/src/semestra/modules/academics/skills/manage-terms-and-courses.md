---
name: manage-terms-and-courses
title: { en: "Manage terms and courses", zh-CN: "管理学期与课程" }
command: /terms
description: Use when the user wants to add, rename, re-date or delete a semester or course, set reading weeks and holidays, reorder courses, or make a course year-long.
tools: [academics.program.get, academics.program.update, academics.program.set_subject_color, academics.term.list, academics.term.get, academics.term.get_weeks, academics.term.create, academics.term.update, academics.term.preview_delete, academics.term.delete, academics.course.find, academics.course.list, academics.course.get, academics.course.create, academics.course.create_many, academics.course.set_terms, academics.course.update, academics.course.reorder, academics.course.delete]
---

# Managing terms and courses

**Structure.** A Program (degree) has terms (semesters) and courses. A course runs in one term,
or in two or more consecutive terms (a year-long course, e.g. "MAT137Y1" from fall to winter).
There are no courses without a term.

**Finding things.** The work context gives the Program and usually the term. `academics.term.list`
returns every term with its dates and breaks and marks the current one (`is_current`).
`academics.course.list` lists the courses of a term; to find the one course the user named, use
`academics.course.find`.

**Creating.**
- A new semester: check `academics.term.list` first (it may exist), then `academics.term.create`
  with name and dates. Reading weeks and holidays go in `breaks`; they must lie inside the term
  and not overlap. Courses of the new term can be created in the same call (`courses`).
- Year-long courses that continue from the term before go in `continue_course_ids` (ids from
  `academics.course.list` of that term).
- One course: `academics.course.create` with `term_ids`. If the course is year-long but the next
  term does not exist yet, link only the current term and set `planned_terms: 2`. Several courses
  the user listed: `academics.course.create_many`.
- Credits default to the Program's default; the subject (e.g. "APS") is parsed from the code.
- Courses or dates in a document (a timetable, a syllabus) are imported instead: load
  `import-from-documents`. An import never creates a term, so create a missing term here first.

**Changing.**
- A term's name, dates, breaks or week numbering: `academics.term.update` (only the fields you
  send change; `breaks` replaces the whole list, so start from the list in `academics.term.list`).
  Never delete and re-create a term to change it: deleting takes its courses with it.
- "Which dates is week 6?" or "the Friday of week 3": `academics.term.get_weeks`.
- Course fields: `academics.course.update`. The order of courses in a term:
  `academics.course.reorder`. A subject's color for all its courses:
  `academics.program.set_subject_color`.
- Make a course year-long or move it: `academics.course.set_terms` with all its terms, which must
  be consecutive terms of the Program.

**Deleting** (cannot be undone). Say in one sentence what goes with it, then call the delete
tool in the same reply; the user confirms on the card. For a term, get the counts from
`academics.term.preview_delete` first (courses deleted, year-long courses kept). Deleting a
course or Program also deletes its grades, files and schedule.
