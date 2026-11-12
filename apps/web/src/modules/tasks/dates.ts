import { casual as en } from 'chrono-node/en'
import { hans as zh } from 'chrono-node/zh/hans'

/** A date, and maybe a time, read from a new task's title. */
export type ReadDate = {
  index: number
  text: string
  due_date: string
  due_time: string | null
}

const pad = (value: number) => String(value).padStart(2, '0')
const WORD = /[A-Za-z0-9]/

/** chrono can end inside a word ("明天下午3点 A" of "… APS105"): stop before that word. */
function wholeWords(text: string, index: number, found: string): string {
  let end = index + found.length
  while (end > index && WORD.test(text[end - 1]!) && WORD.test(text[end] ?? '')) end--
  return text.slice(index, end).trimEnd()
}

/**
 * The dates in `text`, in Chinese or English ("Fri 5pm", "next Monday", "明天下午3点",
 * "11月20日"), the interface language's first. `now` holds the Program's wall-clock time, so
 * "tomorrow" and "in 2 hours" count from the Program's today. Loaded only once a new task is
 * being typed (chrono-node is the larger part of the tasks code).
 */
export function readDates(text: string, now: Date, locale: string): ReadDate[] {
  const dates: ReadDate[] = []
  for (const parser of locale.startsWith('zh') ? [zh, en] : [en, zh]) {
    for (const found of parser.parse(text, now, { forwardDate: true })) {
      const words = wholeWords(text, found.index, found.text)
      if (!words) continue
      // Read again without the cut-off letters, which can change it ("3点 A" is 3 AM).
      const start =
        words === found.text
          ? found.start
          : parser.parse(words, now, { forwardDate: true })[0]?.start
      if (!start) continue
      dates.push({
        index: found.index,
        text: words,
        due_date: `${start.get('year')}-${pad(start.get('month') ?? 1)}-${pad(start.get('day') ?? 1)}`,
        due_time: start.isCertain('hour')
          ? `${pad(start.get('hour') ?? 0)}:${pad(start.get('minute') ?? 0)}`
          : null,
      })
    }
  }
  return dates
}
