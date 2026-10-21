// The MCP tool and prompt tables, from `packages/api-client/capabilities.json` (written by
// `pnpm gen:api`, checked by CI) and the app's own capability titles.
import catalog from '../../../../packages/api-client/capabilities.json'
import en from '../../../web/messages/en.json'
import zh from '../../../web/messages/zh-CN.json'

type Lang = 'en' | 'zh'
type Effect = 'read' | 'write' | 'destructive'

const messages: Record<Lang, Record<string, string>> = { en, zh }

const modules: Record<string, Record<Lang, string>> = {
  academics: { en: 'Programs, terms and courses', zh: '学业结构' },
  grading: { en: 'Grades and GPA', zh: '成绩与 GPA' },
  schedule: { en: 'Schedule', zh: '课表' },
  calendar: { en: 'Calendar', zh: '日历' },
  tasks: { en: 'Tasks', zh: '待办' },
  files: { en: 'Files', zh: '文件' },
  imports: { en: 'Imports', zh: '导入' },
  lms: { en: 'LMS (Canvas)', zh: 'LMS（Canvas）' },
  layouts: { en: 'Pages and cards', zh: '页面与卡片' },
  settings: { en: 'Settings', zh: '设置' },
  plugins: { en: 'Plugins', zh: '插件' },
  account: { en: 'Account', zh: '账户' },
  core: { en: 'Background jobs and storage', zh: '后台任务与存储' },
  habit: { en: 'Habit streak plugin', zh: '习惯打卡插件' },
  pomodoro: { en: 'Pomodoro plugin', zh: '番茄钟插件' },
  sticky: { en: 'Sticky note plugin', zh: '便签插件' },
}

const effects: Record<Effect, Record<Lang, string>> = {
  read: { en: 'Read', zh: '读取' },
  write: { en: 'Write', zh: '修改' },
  destructive: { en: 'Delete', zh: '删除' },
}

const headers = {
  en: { tool: 'Tool', what: 'What it does', effect: 'Access', prompt: 'Prompt', uses: 'Uses' },
  zh: { tool: '工具', what: '作用', effect: '权限', prompt: 'Prompt', uses: '用到的工具' },
}

function title(capability: string, lang: Lang): string {
  return messages[lang][`capability_${capability.replaceAll('.', '_')}_title`] ?? capability
}

export function McpTools({ lang }: { lang: Lang }) {
  const groups = Map.groupBy(catalog.tools, (tool) => tool.module)
  const h = headers[lang]

  return (
    <>
      {[...groups].map(([module, tools]) => (
        <section key={module}>
          <h3>{modules[module]?.[lang] ?? module}</h3>
          <table>
            <thead>
              <tr>
                <th>{h.tool}</th>
                <th className="min-w-40">{h.what}</th>
                <th>{h.effect}</th>
              </tr>
            </thead>
            <tbody>
              {tools.map((tool) => (
                <tr key={tool.name}>
                  <td>
                    <code>{tool.name}</code>
                  </td>
                  <td>{title(tool.capability, lang)}</td>
                  <td>{effects[tool.effect as Effect][lang]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </>
  )
}

export function McpPrompts({ lang }: { lang: Lang }) {
  const h = headers[lang]

  return (
    <table>
      <thead>
        <tr>
          <th>{h.prompt}</th>
          <th className="min-w-40">{h.what}</th>
          <th>{h.uses}</th>
        </tr>
      </thead>
      <tbody>
        {catalog.prompts.map((prompt) => (
          <tr key={prompt.name}>
            <td>
              <code>{prompt.name}</code>
            </td>
            <td>{lang === 'zh' ? prompt.title['zh-CN'] : prompt.title.en}</td>
            <td>
              {prompt.tools.map((tool, i) => (
                <span key={tool}>
                  {i > 0 && ', '}
                  <code>{tool}</code>
                </span>
              ))}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
