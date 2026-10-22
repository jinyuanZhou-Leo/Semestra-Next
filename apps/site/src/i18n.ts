export type Lang = 'zh-CN' | 'en'

// The app lives at semestra.jyleo.cc and the docs at docs.semestra.jyleo.cc. Builds can override the
// addresses; `pnpm site:dev` points at the other local dev servers.
const env = import.meta.env
export const APP_URL: string =
  env.PUBLIC_APP_URL ?? (env.DEV ? 'http://localhost:5173' : 'https://semestra.jyleo.cc')
export const DOCS_URL: string =
  env.PUBLIC_DOCS_URL ?? (env.DEV ? 'http://localhost:3001' : 'https://docs.semestra.jyleo.cc')
export const GITHUB_URL = 'https://github.com/jinyuanZhou-Leo/Semestra-Next'

/** A title and one line under it. */
type Item = [title: string, text: string]

export const copy = {
  'zh-CN': {
    title: 'Semestra：学期里的每一天，都在这里',
    description:
      'Semestra 将课表、待办、成绩与 GPA 整合进同一个工作区，并由 AI Agent Sem 协助你规划和执行。',
    nav: {
      product: '功能',
      open: '开源',
      docs: '文档',
      login: '登录',
      start: '免费开始',
      other: 'English',
    },
    hero: {
      badge: '能独立完成多步骤任务的学业 Agent',
      h1: ['学期里的每一天，', '都在这里。'],
      lede: 'Semestra 将课表、待办、成绩与 GPA 整合进同一个工作区，并由 AI Agent Sem 协助你规划和执行。',
      start: '免费开始使用',
      explore: '了解产品',
      small: '开源 · 支持私有化部署',
    },
    logos: '与你常用的平台无缝衔接',
    today: {
      eyebrow: '今日概览',
      h2: '当天的课程与截止事项，一页掌握。',
      sub: '今日课程、教室与下一节课倒计时，和未来七天的截止事项并列呈现。',
      bullets: [
        ['实时课程时间线', '当前时间线标出正在进行与即将开始的课程。'],
        ['七日截止视图', '按日期分组，并以课程颜色区分。'],
      ] as Item[],
    },
    calendar: {
      eyebrow: '日历',
      h2: '整个学期，统一在一个日历中。',
      week: [
        '课程、截止与待办的统一视图',
        '以学业项目所在时区显示，身处任何时区都准确无误。支持拖拽调整与导出，可在周、月、列表与课表视图间切换。',
      ] as Item,
      filters: ['精确筛选', '按事项类型与课程控制显示内容。'] as Item,
      subscribe: [
        '日历订阅',
        '通过 iCalendar 订阅链接，同步至 Google Calendar、Apple Calendar 与 Outlook。',
      ] as Item,
      meetings: [
        '教学班与上课时间',
        '按教学班设置每周上课时间，系统自动生成整个学期的课表。',
      ] as Item,
      import: [
        '批量导入',
        '从 Canvas、iCalendar 文件或课程大纲导入课程、考核与截止日期，提交前逐项审核。',
      ] as Item,
    },
    grades: {
      eyebrow: '成绩与 GPA',
      h2: '精确掌握成绩，清晰规划目标。',
      live: ['实时成绩与 GPA', '根据已评分项计算当前成绩与 GPA，并展示各分类进度。'] as Item,
      book: ['加权成绩册', '按分类与权重记录考核，课程总评自动计算。'] as Item,
      plan: ['目标规划', '设定目标绩点，自动推算剩余每项考核所需的最低分数。'] as Item,
      scales: [
        '多种 GPA 换算标准',
        '内置多伦多大学、美国 4.0 / 4.33、澳大利亚 7 分制与韩国 4.5 分制等标准，也支持自定义区间。',
      ] as Item,
      prev: '上一张',
      next: '下一张',
    },
    sem: {
      h2: '交给 Sem，从规划到执行。',
      sub: 'Sem 是面向长程任务的学业 Agent：它会拆解目标，调用工具查询你的课表、成绩与课程文件，连续执行多个步骤，直到任务完成。',
      run: [
        '多步骤自主执行',
        '只需一句指令，Sem 自行规划步骤、检索数据，并交付可执行的方案。',
      ] as Item,
      memory: [
        '长期记忆',
        '记住你的偏好与学习习惯，跨会话持续生效；所有记忆均可查看和删除。',
      ] as Item,
      mcp: [
        '开放的 MCP 接口',
        '通过 Model Context Protocol，在 Claude 等 AI 客户端中直接使用 Semestra。',
      ] as Item,
      hitl: [
        'Human in the loop',
        '每一次写入操作都会先生成变更提案，经你批准、修改或拒绝后才会执行。支持使用你自己的模型服务商密钥。',
      ] as Item,
      trace: [
        '为长程任务而生，每一步都可追溯。',
        '展开任意步骤，即可查看 Sem 的推理过程、工具调用与数据改动。',
      ] as Item,
    },
    tasks: {
      eyebrow: '待办',
      h2: '用自然语言快速创建待办。',
      bullets: [
        ['智能解析', '自动识别日期、时间与优先级标记，例如“周五 lab 报告 !!!”。'],
        ['与成绩册联动', '考核自动生成对应待办，截止日期变更时同步更新。'],
      ] as Item[],
      cta: '开始使用',
    },
    palette: {
      eyebrow: '命令面板',
      h2: '键盘直达，一切触手可及。',
      bullets: [
        ['全局搜索', '按 Ctrl K，快速跳转页面、学期、课程与命令，支持拼音检索。'],
        ['快速切换课程', '使用 Ctrl ↑ / ↓ 在课程间切换，停留在当前页面。'],
      ] as Item[],
    },
    more: {
      h2: '为日常学习打磨的每一处细节。',
      plugins: [
        '插件扩展',
        '番茄钟、习惯打卡、便签、世界时钟与计数器，可添加到任意页面的看板。',
      ] as Item,
      files: [
        '课程资料检索',
        '上传课件即可全文检索；Sem 引用资料时会标注出处页码，一键定位原文。',
      ] as Item,
      canvas: ['Canvas 集成', '连接 Canvas，在 Semestra 中查看课程公告、作业与日历。'] as Item,
      theme: ['外观与主题', '浅色与深色模式，并可自定义强调色。'] as Item,
      open: ['开源与私有化部署', '源代码公开，可通过 Docker 一键部署到自有服务器。'] as Item,
      data: ['数据可迁移', '完整导出账户数据，并可随时导入恢复。'] as Item,
    },
    close: {
      h2: '让下一个学期更从容。',
      sub: '免费使用，也支持私有化部署。',
    },
    footer: {
      about: '面向大学生的学期管理平台。',
      product: '产品',
      today: '今日概览',
      calendar: '日历',
      grades: '成绩与 GPA',
      open: '开源',
      selfHost: '私有化部署',
      docs: '文档',
      guide: '使用指南',
      mcp: 'MCP',
      api: 'API',
      plugins: '插件开发',
      account: '账户',
      login: '登录',
      signup: '注册',
    },
  },
  en: {
    title: 'Semestra: every day of your semester, in one place',
    description:
      'Semestra brings your schedule, tasks, grades and GPA into one workspace, with Sem, an AI agent that plans and gets the work done.',
    nav: {
      product: 'Product',
      open: 'Open source',
      docs: 'Docs',
      login: 'Log in',
      start: 'Get started',
      other: '中文',
    },
    hero: {
      badge: 'An academic agent for multi-step work',
      h1: ['Every day of your semester,', 'in one place.'],
      lede: 'Semestra brings your schedule, tasks, grades and GPA into one workspace, with Sem, an AI agent that plans and gets the work done.',
      start: 'Get started for free',
      explore: 'Explore the product',
      small: 'Open source · Self-hosting supported',
    },
    logos: 'Integrates with the tools you already use',
    today: {
      eyebrow: 'Today',
      h2: "Your day's classes and deadlines, at a glance.",
      sub: "Today's classes, rooms and the countdown to the next one, alongside everything due in the next seven days.",
      bullets: [
        ['Live class timeline', "A now line marks what's in progress and what's next."],
        ['Seven-day deadline view', 'Grouped by date and colour-coded by course.'],
      ] as Item[],
    },
    calendar: {
      eyebrow: 'Calendar',
      h2: 'Your entire semester in one calendar.',
      week: [
        'Classes, deadlines and tasks in one view',
        "Rendered in your program's time zone, accurate wherever you are. Drag to reschedule, export, and switch between week, month, list and timetable views.",
      ] as Item,
      filters: ['Precise filtering', 'Choose exactly which item types and courses appear.'] as Item,
      subscribe: [
        'Calendar subscriptions',
        'Sync to Google Calendar, Apple Calendar and Outlook through an iCalendar feed.',
      ] as Item,
      meetings: [
        'Sections and meeting times',
        'Define weekly meetings for each section and the full term schedule is generated for you.',
      ] as Item,
      import: [
        'Bulk import',
        'Import courses, assessments and due dates from Canvas, iCalendar files or a syllabus, and review every item before it is saved.',
      ] as Item,
    },
    grades: {
      eyebrow: 'Grades and GPA',
      h2: "Know where you stand. Plan where you're going.",
      live: [
        'Live grades and GPA',
        'Your current grade and GPA from graded work, with progress in every category.',
      ] as Item,
      book: [
        'Weighted gradebook',
        'Record assessments by category and weight; the course grade is calculated for you.',
      ] as Item,
      plan: [
        'Target planning',
        'Set a target and see the minimum score you need on every remaining assessment.',
      ] as Item,
      scales: [
        'Multiple GPA scales',
        'Built-in University of Toronto, US 4.0 / 4.33, Australian 7-point and Korean 4.5 scales, or define your own ranges.',
      ] as Item,
      prev: 'Previous',
      next: 'Next',
    },
    sem: {
      h2: 'Hand it to Sem, from plan to done.',
      sub: 'Sem is an academic agent built for long-horizon work. It breaks a goal into steps, calls tools across your schedule, grades and course files, and keeps going until the job is done.',
      run: [
        'Autonomous multi-step execution',
        'From a single instruction, Sem plans the steps, gathers the data and delivers a plan you can act on.',
      ] as Item,
      memory: [
        'Long-term memory',
        'Remembers your preferences and study habits across sessions. Every memory can be reviewed and deleted.',
      ] as Item,
      mcp: [
        'Open MCP server',
        'Use Semestra from Claude and other AI clients through the Model Context Protocol.',
      ] as Item,
      hitl: [
        'Human in the loop',
        'Every write is proposed first and only runs after you approve, edit or reject it. Bring your own model provider key.',
      ] as Item,
      trace: [
        'Built for long-horizon tasks, with every step traceable.',
        "Expand any step to see Sem's reasoning, the tools it called and the changes it made.",
      ] as Item,
    },
    tasks: {
      eyebrow: 'Tasks',
      h2: 'Capture tasks in natural language.',
      bullets: [
        [
          'Smart parsing',
          'Dates, times and priority marks are recognised automatically, as in “Fri lab report !!!”.',
        ],
        [
          'Linked to your gradebook',
          'Assessments create matching tasks, and due-date changes stay in sync.',
        ],
      ] as Item[],
      cta: 'Get started',
    },
    palette: {
      eyebrow: 'Command palette',
      h2: 'Everything, one shortcut away.',
      bullets: [
        [
          'Global search',
          'Press Ctrl K to jump to any page, term, course or command, with pinyin matching.',
        ],
        [
          'Quick course switching',
          'Use Ctrl ↑ / ↓ to move between courses without leaving the page.',
        ],
      ] as Item[],
    },
    more: {
      h2: 'Details refined for everyday study.',
      plugins: [
        'Plugins',
        "Pomodoro timer, habit tracker, sticky notes, world clock and counter, on any page's board.",
      ] as Item,
      files: [
        'Course material search',
        'Full-text search across uploaded materials. Sem cites page numbers, one click from the source.',
      ] as Item,
      canvas: [
        'Canvas integration',
        'Connect Canvas to see course announcements, assignments and calendar events in Semestra.',
      ] as Item,
      theme: ['Appearance', 'Light and dark modes with a customisable accent colour.'] as Item,
      open: [
        'Open source and self-hostable',
        'Public source code, deployable to your own server with a single Docker command.',
      ] as Item,
      data: [
        'Data portability',
        'Export your complete account data and restore it at any time.',
      ] as Item,
    },
    close: {
      h2: 'Make next semester your most organised yet.',
      sub: 'Free to use. Self-hosting supported.',
    },
    footer: {
      about: 'The semester workspace for university students.',
      product: 'Product',
      today: 'Today',
      calendar: 'Calendar',
      grades: 'Grades and GPA',
      open: 'Open source',
      selfHost: 'Self-hosting',
      docs: 'Docs',
      guide: 'Guides',
      mcp: 'MCP',
      api: 'API',
      plugins: 'Plugin development',
      account: 'Account',
      login: 'Log in',
      signup: 'Sign up',
    },
  },
} satisfies Record<Lang, unknown>

export const home = (lang: Lang) => (lang === 'en' ? '/en/' : '/')
/** A page of the docs site in the visitor's language, e.g. `docs('en', 'mcp')`. */
export const docs = (lang: Lang, section = '') =>
  `${DOCS_URL}/${lang === 'en' ? 'en' : 'zh'}/docs${section ? `/${section}` : ''}`
export const shotLang = (lang: Lang) => (lang === 'en' ? 'en' : 'zh')
