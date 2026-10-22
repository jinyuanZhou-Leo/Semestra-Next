// Generates the API reference pages (content/docs/api/reference, not committed) from the
// OpenAPI schema, one page per tag. Runs before `dev` and `build`.
import { rm, writeFile } from 'node:fs/promises'
import { generateFiles } from 'fumadocs-openapi'
import { openapi } from '../src/lib/openapi.ts'

const output = './content/docs/api/reference'

// Page titles for the OpenAPI tags (the tag names are module ids).
const titles: Record<string, string> = {
  Academics: 'Programs, terms and courses',
  Account: 'Account and API tokens',
  Agent: 'Sem (assistant)',
  Ai: 'AI providers and models',
  Auth: 'Sign-in and sessions',
  Files: 'Files',
  Grading: 'Grades and GPA',
  Habit: 'Habit streak plugin',
  Imports: 'Imports',
  Jobs: 'Background jobs',
  Layouts: 'Pages and cards',
  Lms: 'LMS (Canvas)',
  Plugins: 'Plugins',
  Pomodoro: 'Pomodoro plugin',
  Portability: 'Export, import and account deletion',
  Schedule: 'Schedule and calendar',
  Settings: 'Settings',
  Sticky: 'Sticky note plugin',
  Storage: 'Storage',
  System: 'Health checks',
  Tasks: 'Tasks',
}

await rm(output, { recursive: true, force: true })
await generateFiles({
  input: openapi,
  output,
  per: 'tag',
  includeDescription: true,
  frontmatter: (title, description) => ({ title: titles[title] ?? title, description }),
})

// Sidebar title of the generated folder (the pages themselves are English in both languages).
await writeFile(`${output}/meta.json`, JSON.stringify({ title: 'Endpoints' }))
await writeFile(`${output}/meta.zh.json`, JSON.stringify({ title: '接口参考' }))
