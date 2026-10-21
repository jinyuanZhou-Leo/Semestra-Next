import { API, OUT, REPO, WEB, launch } from './env.mjs'
import { readFileSync, writeFileSync } from 'node:fs'
const OUTBOX = REPO + '/apps/api/data/dev-outbox.jsonl'
const api0 = API
const web = WEB
const email = 'maya.chen@mail.utoronto.ca'
const code = () => {
  try {
    for (const l of readFileSync(OUTBOX, 'utf8').trim().split('\n').reverse()) {
      const m = JSON.parse(l)
      if (m.to === email) return /\b(\d{6})\b/.exec(m.text)[1]
    }
  } catch {}
  return ''
}
const browser = await launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
const page = await ctx.newPage()
await page.goto(web + '/login')
await page.getByLabel('Email').fill(email)
await page.getByRole('button', { name: 'Continue' }).click()
for (let i = 0; i < 50 && !code(); i++) await page.waitForTimeout(200)
await page.keyboard.type(code())
await page.getByLabel('Name').fill('Maya Chen')
await page.getByRole('button', { name: 'Create account' }).click()
await page.waitForURL(/onboarding/)
const csrf = async () => (await ctx.cookies()).find((c) => c.name === 'semestra_csrf')?.value
const api = async (method, path, data) => {
  const r = await page.request.fetch(api0 + path, {
    method,
    data,
    headers: { 'X-Semestra-CSRF': await csrf() },
  })
  if (!r.ok()) throw new Error(method + ' ' + path + ' ' + r.status() + ' ' + (await r.text()))
  return r.status() === 204 ? null : r.json()
}
const soft = (p) => p.catch((e) => console.error(String(e).slice(0, 300)))

const prog = await api('POST', '/programs', {
  name: 'Computer Engineering',
  institution: 'University of Toronto',
  timezone: 'America/Toronto',
  credit_requirement: 20,
})
const unwrap = (t) => t.term ?? t
const winter = unwrap(
  await api('POST', `/programs/${prog.id}/terms`, {
    name: '2026 Winter',
    start_date: '2026-01-05',
    end_date: '2026-04-10',
  }),
)
const fall = unwrap(
  await api('POST', `/programs/${prog.id}/terms`, {
    name: '2026 Fall',
    start_date: '2026-09-08',
    end_date: '2026-12-08',
    breaks: [],
  }),
)

// Past term: finished courses with final marks, so the GPA has history.
for (const [code, title, pct] of [
  ['ECE110H1', 'Electrical Fundamentals', 88],
  ['MAT188H1', 'Linear Algebra', 82],
  ['APS112H1', 'Engineering Strategies & Practice II', 91],
  ['CIV102H1', 'Structures and Materials', 79],
  ['ESC180H1', 'Introduction to Computer Programming', 93],
]) {
  const c = await api('POST', `/programs/${prog.id}/courses`, {
    code,
    title,
    credits: 0.5,
    term_ids: [winter.id],
  })
  await soft(api('PATCH', `/courses/${c.id}/grade`, { manual_percentage: pct }))
}

const fallCourses = {}
for (const [code, title, palette] of [
  ['ECE244H1', 'Programming Fundamentals', 8],
  ['MAT290H1', 'Advanced Engineering Mathematics', 2],
  ['ECE216H1', 'Signals and Systems', 10],
  ['ECE231H1', 'Introductory Electronics', 5],
  ['ECE297H1', 'Software Design and Communication', 1],
]) {
  fallCourses[code] = await api('POST', `/programs/${prog.id}/courses`, {
    code,
    title,
    credits: 0.5,
    term_ids: [fall.id],
    color: { palette },
  })
}

const meet = (code, type, sec, wd, s, e, loc) =>
  soft(
    api('POST', `/courses/${fallCourses[code].id}/meetings`, {
      term_id: fall.id,
      type_code: type,
      section_code: sec,
      weekday: wd,
      start_time: s,
      end_time: e,
      location: loc,
    }),
  )
await meet('ECE244H1', 'LEC', 'LEC0101', 1, '09:00', '10:00', 'BA 1130')
await meet('ECE244H1', 'LEC', 'LEC0101', 3, '09:00', '10:00', 'BA 1130')
await meet('ECE244H1', 'LEC', 'LEC0101', 4, '11:00', '12:00', 'BA 1130')
await meet('ECE244H1', 'PRA', 'PRA0103', 2, '15:00', '18:00', 'SF 2204')
await meet('MAT290H1', 'LEC', 'LEC0102', 1, '11:00', '12:00', 'MB 128')
await meet('MAT290H1', 'LEC', 'LEC0102', 3, '11:00', '12:00', 'MB 128')
await meet('MAT290H1', 'TUT', 'TUT0104', 5, '10:00', '11:00', 'GB 119')
await meet('ECE216H1', 'LEC', 'LEC0101', 2, '10:00', '11:00', 'SF 1105')
await meet('ECE216H1', 'LEC', 'LEC0101', 4, '10:00', '11:00', 'SF 1105')
await meet('ECE216H1', 'TUT', 'TUT0102', 1, '16:00', '17:00', 'BA 2165')
await meet('ECE231H1', 'LEC', 'LEC0101', 2, '13:00', '14:00', 'GB 248')
await meet('ECE231H1', 'LEC', 'LEC0101', 5, '13:00', '14:00', 'GB 248')
await meet('ECE231H1', 'PRA', 'PRA0102', 4, '14:00', '17:00', 'SF 2102')
await meet('ECE297H1', 'LEC', 'LEC0101', 3, '14:00', '15:00', 'BA 1180')
await meet('ECE297H1', 'TUT', 'TUT0101', 5, '15:00', '17:00', 'GB 404')

for (const [title, code, d, h, loc] of [
  ['ECE216 Midterm', 'ECE216H1', '2026-10-27', 18, 'EX 100'],
  ['MAT290 Term Test 2', 'MAT290H1', '2026-11-04', 18, 'EX 300'],
])
  await soft(
    api('POST', `/programs/${prog.id}/events`, {
      title,
      start_at: `${d}T${h}:00:00`,
      end_at: `${d}T${h + 2}:00:00`,
      course_id: fallCourses[code].id,
      term_id: fall.id,
      location: loc,
    }),
  )

// Gradebook for ECE244: categories, scores so far, the rest still to come.
const ece244 = fallCourses['ECE244H1'].id
const cat = {}
for (const [key, name] of [
  ['labs', 'Labs'],
  ['quizzes', 'Quizzes'],
  ['midterm', 'Midterm'],
  ['final', 'Final exam'],
])
  cat[key] = (await api('POST', `/courses/${ece244}/grading-categories`, { name, key })).id
const assess = [
  ['Lab 1', 'labs', 4, 100, '2026-09-19'],
  ['Lab 2', 'labs', 4, 95, '2026-09-26'],
  ['Lab 3', 'labs', 4, 92, '2026-10-03'],
  ['Lab 4', 'labs', 4, 88, '2026-10-17'],
  ['Lab 5', 'labs', 4, null, '2026-10-31'],
  ['Lab 6', 'labs', 4, null, '2026-11-14'],
  ['Quiz 1', 'quizzes', 5, 84, '2026-09-30'],
  ['Quiz 2', 'quizzes', 5, 90, '2026-10-14'],
  ['Midterm', 'midterm', 26, 78, '2026-10-16'],
  ['Final exam', 'final', 40, null, '2026-12-14'],
]
for (const [title, c, weight, score, due] of assess)
  await soft(
    api('POST', `/courses/${ece244}/assessments`, {
      title,
      category_id: cat[c],
      weight,
      score_percentage: score,
      due_date: due,
    }),
  )
// Other fall courses: a few marks each so the term GPA exists.
for (const [code, rows] of Object.entries({
  MAT290H1: [
    ['Problem Set 1', 10, 92],
    ['Problem Set 2', 10, 85],
    ['Term Test 1', 30, 81],
    ['Final exam', 50, null],
  ],
  ECE216H1: [
    ['Homework 1', 10, 95],
    ['Homework 2', 10, 90],
    ['Midterm', 30, null],
    ['Final exam', 50, null],
  ],
  ECE231H1: [
    ['Lab 1', 7.5, 90],
    ['Lab 2', 7.5, 86],
    ['Midterm', 25, 74],
    ['Final exam', 60, null],
  ],
  ECE297H1: [
    ['Milestone 1', 15, 94],
    ['Milestone 2', 20, null],
    ['Milestone 3', 25, null],
    ['Final report', 40, null],
  ],
}))
  for (const [title, weight, score] of rows)
    await soft(
      api('POST', `/courses/${fallCourses[code].id}/assessments`, {
        title,
        weight,
        score_percentage: score,
      }),
    )

const task = (title, code, due, time, priority, extra = {}) =>
  soft(
    api('POST', `/programs/${prog.id}/tasks`, {
      title,
      course_id: code ? fallCourses[code].id : null,
      due_date: due,
      due_time: time,
      priority,
      ...extra,
    }),
  )
await task('Lab 5: Linked lists', 'ECE244H1', '2026-10-24', '23:59', 'urgent', {
  source_kind: 'lms',
  source_ref: 'canvas:' + Math.random().toString(36).slice(2),
})
await task('Problem Set 3', 'MAT290H1', '2026-10-23', '17:00', 'high', {
  source_kind: 'lms',
  source_ref: 'canvas:' + Math.random().toString(36).slice(2),
})
await task('Milestone 2 slides', 'ECE297H1', '2026-10-22', '12:00', 'high')
await task('Review Laplace transform notes', 'ECE216H1', '2026-10-25', null, 'medium')
await task('Prelab for Lab 3', 'ECE231H1', '2026-10-26', '09:00', 'medium', {
  source_kind: 'lms',
  source_ref: 'canvas:' + Math.random().toString(36).slice(2),
})
await task('Book office hours with Prof. Lee', null, '2026-10-22', null, 'none', { flagged: true })
await task('Return library books', null, '2026-10-28', null, 'low')
await task('Read Ch. 7 — Fourier series', 'ECE216H1', '2026-10-21', null, 'low')

writeFileSync(
  OUT + '/ids.json',
  JSON.stringify({
    prog: prog.id,
    fall: fall.id,
    winter: winter.id,
    courses: Object.fromEntries(Object.entries(fallCourses).map(([k, v]) => [k, v.id])),
  }),
)
await ctx.storageState({ path: OUT + '/state.json' })
console.log('ok', prog.id)
await browser.close()
