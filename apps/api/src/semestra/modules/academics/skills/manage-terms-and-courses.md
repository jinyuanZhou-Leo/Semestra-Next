---
name: manage-terms-and-courses
description: Create terms, add courses, make a course year-long, and delete terms or courses safely.
tools: [academics.program.list, academics.term.list, academics.term.create, academics.term.delete_preview, academics.term.delete, academics.course.find, academics.course.create, academics.course.set_terms, academics.course.update, academics.course.delete]
---

# Managing terms and courses

**Structure.** A user has one or more Programs (degrees). A Program has terms (semesters) and
courses. A course runs in one term, or in two or more *consecutive* terms (a year-long course,
e.g. "MAT137Y1" from fall to winter). There are no courses without a term.

**Finding things.**
- Use `academics.program.list` only when no Program is in context; most users have one.
- Use `academics.term.list` to get term ids and see which one `is_current`. Always check it before
  creating a term: the term may already exist.
- Use `academics.course.find` whenever the user names a course in words ("APS 105", "calc",
  "the programming course"). If the two best candidates have similar scores, ask which one.

**Creating.**
- A new semester: `academics.term.create` with name and dates. Reading weeks and holidays go in
  `breaks`; they must lie inside the term and not overlap. Courses of the new term can be created
  in the same call (`courses`).
- If the previous term has year-long courses that continue, pass their ids in
  `continue_course_ids` (they must be in the term directly before the new one).
- A single course: `academics.course.create` with `term_ids`. If the user says the course is
  year-long but the next term does not exist yet, link only the current term and set
  `planned_terms: 2`.
- Credits default to the Program's default; the subject (e.g. "APS") is parsed from the code.

**Changing.**
- Course fields: `academics.course.update` (only the fields you send change).
- Make a course year-long or move it: `academics.course.set_terms` with all its terms. They must
  be consecutive terms of the same Program (`academics.course_terms_not_adjacent` otherwise).

**Deleting** (cannot be undone).
- Before `academics.term.delete`, call `academics.term.delete_preview` and tell the user how many
  courses will be deleted and how many year-long courses are kept (they only lose this term).
- Deleting a course or Program also deletes its grades, files and schedule. Confirm with the
  user in plain words first.
