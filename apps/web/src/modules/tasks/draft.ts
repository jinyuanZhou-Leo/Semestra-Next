import type { Course, TaskUpdateInputBody } from '@semestra/api-client'
import { TZDate } from '@date-fns/tz'
import { format } from 'date-fns'
import { useEffect, useState } from 'react'
import { getLocale } from '@/paraglide/runtime'
import type { ChipValues } from './components/TaskChips'
import { readTitle, stripTokens, type Token, type TokenKind } from './parse'

type Dates = typeof import('./dates')

let dates: Dates | null = null
let loading: Promise<Dates> | null = null

function loadDates(): Promise<Dates> {
  loading ??= import('./dates')
  return loading
}

/** The date reader, loaded the first time a new task is being typed. */
function useDates(enabled: boolean): Dates | null {
  const [loaded, setLoaded] = useState(dates)
  useEffect(() => {
    if (loaded || !enabled) return
    let live = true
    void loadDates().then((module) => {
      dates = module
      if (live) setLoaded(module)
    })
    return () => {
      live = false
    }
  }, [loaded, enabled])
  return loaded
}

/** Now as the Program's wall clock, in a browser-local `Date` (what chrono reads). */
function wallNow(timezone: string): Date {
  return new Date(format(new TZDate(Date.now(), timezone), "yyyy-MM-dd'T'HH:mm:ss"))
}

/**
 * A new task being typed (M05 §5.1): its title, and its chips with what the title says on top.
 * Words read as a date, a priority or a course set those chips and are left out of the saved
 * title. Pressing such a word keeps it as text; picking a chip by hand wins over the title.
 */
export function useNewTaskDraft(
  initial: ChipValues,
  {
    courses,
    timezone,
    readCourse,
    enabled,
  }: {
    courses: readonly Course[]
    timezone: string
    readCourse: boolean
    /** The `smart_parsing` setting: off, the title is only a title. */
    enabled: boolean
  },
) {
  const [title, setTitle] = useState('')
  const [values, setValues] = useState(initial)
  const [kept, setKept] = useState<readonly string[]>([])
  const [picked, setPicked] = useState<readonly (TokenKind | 'time')[]>([])
  const loaded = useDates(enabled)
  const readDates = loaded
    ? (text: string) => loaded.readDates(text, wallNow(timezone), getLocale())
    : null
  const read = enabled ? readTitle(title, { courses: readCourse ? courses : [], readDates }) : []
  const tokens = read.filter((t) => !kept.includes(t.text) && !picked.includes(t.kind))
  const found = (kind: TokenKind) => tokens.find((t) => t.kind === kind)
  const date = tokens.find((t) => t.kind === 'date')
  const shown: ChipValues = { ...values }
  for (const t of tokens) {
    if (t.kind === 'date') {
      shown.due_date = t.due_date
      if (!picked.includes('time')) shown.due_time = t.due_time
    } else if (t.kind === 'priority') shown.priority = t.priority
    else shown.course_id = t.course_id
  }
  const pick = (kind: TokenKind | 'time') => setPicked((current) => [...current, kind])
  return {
    title,
    setTitle,
    tokens,
    values: shown,
    /** The chips set by the title, tinted like its words. */
    fromTitle: {
      date: date !== undefined,
      time: date?.due_time != null && !picked.includes('time'),
      priority: found('priority') !== undefined,
      course: found('course') !== undefined,
    },
    /** The title to save: without the words read as properties. */
    savedTitle: stripTokens(title, tokens),
    keep: (token: Token) => setKept((current) => [...current, token.text]),
    change: (body: TaskUpdateInputBody) => {
      // A time picked by hand leaves the date to the title.
      if ('due_date' in body) pick('date')
      else if ('due_time' in body) pick('time')
      if ('priority' in body) pick('priority')
      if ('course_id' in body) pick('course')
      setValues((current) => ({ ...current, ...body }) as ChipValues)
    },
    reset: () => {
      setTitle('')
      setValues(initial)
      setKept([])
      setPicked([])
    },
  }
}
