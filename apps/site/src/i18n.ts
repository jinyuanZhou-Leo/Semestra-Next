export type Lang = 'zh-CN' | 'en'

// The app, the docs (/docs) and this site (/landing) share one origin in production, so links are
// plain paths there. `pnpm site:dev` points at the other local dev servers; builds can override both.
const env = import.meta.env
export const APP_URL: string = env.PUBLIC_APP_URL ?? (env.DEV ? 'http://localhost:5173' : '')
export const DOCS_URL: string =
  env.PUBLIC_DOCS_URL ?? (env.DEV ? 'http://localhost:3001/docs' : '/docs')
export const GITHUB_URL = 'https://github.com/jinyuanZhou-Leo/Semestra-Next'

/** A title and one line under it. */
type Item = [title: string, text: string]

export const copy = {
  'zh-CN': {
    title: 'Semestra：整个学期，一手掌握',
    description:
      'Semestra 把课表、待办、成绩与课程资料汇聚一处，再由 AI Agent Sem 从规划到执行，一步步替你办妥。',
    nav: {
      product: '功能',
      open: '开源',
      docs: '文档',
      login: '登录',
      start: '免费开始',
      other: 'English',
    },
    hero: {
      badge: '为长程任务打造的学业 Agent',
      h1: ['整个学期，', '一手掌握。'],
      lede: '课表、待办、成绩与课程资料，从此不必东拼西凑。AI Agent Sem 从规划到执行，一步步替你办妥。',
      start: '免费开始使用',
      explore: '了解产品',
      small: '开源 · 可私有化部署',
    },
    logos: '与你常用的平台，无缝衔接',
    today: {
      eyebrow: '今日概览',
      h2: '今日事，今日知。',
      sub: '今日课程、教室与下一节课倒计时，和未来七天的截止事项并排呈现。早上看一眼，一天心里有数。',
      bullets: [
        ['实时时间线', '正在上的课、接下来的课，时间线替你标好。'],
        ['七日截止', '按日期分组，以课程颜色区分，一目了然。'],
      ] as Item[],
    },
    calendar: {
      eyebrow: '日历',
      h2: '整个学期，历历在目。',
      week: [
        '课程、截止、待办，同框呈现',
        '始终按 Program 的时区显示，人在哪里都不会错。拖一下就能改期，周、月、列表与课表视图随心切换。',
      ] as Item,
      filters: ['想看什么，只看什么', '按事项类型与课程筛选，无关内容一键隐藏。'] as Item,
      subscribe: [
        '订阅到你的日历',
        '一条 iCalendar 链接，同步到 Google 日历、Apple 日历与 Outlook。',
      ] as Item,
      meetings: [
        '录一次，排满整学期',
        '按 Section 填好每周上课时间，整个学期的课表自动生成。',
      ] as Item,
      import: [
        '导入，而不是重抄',
        '从 LMS、iCalendar 文件或课程大纲导入课程、考核与截止日期，逐项过目后再保存。',
      ] as Item,
    },
    grades: {
      eyebrow: '成绩与 GPA',
      h2: '每一分，都算数。',
      live: [
        '成绩与 GPA，实时更新',
        '每录入一项分数，当前成绩、GPA 与各分类进度随之刷新。',
      ] as Item,
      book: ['加权成绩册，自动算好', '按分类与权重记录考核，课程总评无需手算。'] as Item,
      forecast: [
        '还没出分，先看走向',
        '从第一项成绩起就给出预测，按你在各分类的表现推算剩余考核。',
      ] as Item,
      plan: ['从目标倒推每一分', '定下目标绩点，剩下每项考核至少要考多少，一算便知。'] as Item,
      scales: [
        '换算标准，各地通用',
        '内置多伦多大学、美国 4.0 / 4.33、澳大利亚 7 分制与韩国 4.5 分制等标准，也可自定义区间。',
      ] as Item,
      prev: '上一张',
      next: '下一张',
    },
    sem: {
      h2: '交给 Sem，事情一步步办妥。',
      sub: 'Sem 是为长程任务打造的学业 Agent。它拆解目标，查阅你的课表、成绩与课程资料，一步接一步执行，直到把事情做完。',
      run: [
        '一句话，换一整套方案',
        '说出目标，Sem 自己规划步骤、查齐数据，交回一份可以直接执行的安排。',
      ] as Item,
      memory: [
        '越用，越懂你',
        '记住你的偏好与学习习惯，并在后台定期整理。每一条记忆，都由你查看和删除。',
      ] as Item,
      mcp: [
        '你熟悉的 AI，也懂你的学业',
        '通过 MCP，把课表、成绩、待办与课程资料作为上下文，交给 Claude Code、Cursor、VS Code、Codex 等你常用的 AI 工具。',
      ] as Item,
      hitl: [
        'Human in the loop',
        '每一处改动都先成为提案，经你批准、修改或拒绝后才会执行。模型服务商与密钥，也由你来选。',
      ] as Item,
      trace: [
        '长程任务，步步可查。',
        '展开任意一步，Sem 的推理过程、调用的工具与改动的数据，清清楚楚。',
      ] as Item,
    },
    tasks: {
      eyebrow: '待办',
      h2: '让待办，不再待办。',
      bullets: [
        ['交完即勾', '每项考核都有对应待办，出分即完成；在 LMS 上交了作业，同样自动勾选。'],
        ['按课程归位', '待办按课程与截止日自动归入对应学期，在 Program、学期与课程页都能看到。'],
        ['排进日历', '待办出现在日历中，拖一下改期，点一下完成。'],
      ] as Item[],
      cta: '开始使用',
    },
    lms: {
      eyebrow: 'LMS 深度集成',
      h2: '作业成绩，打包搞定。',
      sub: '课程与 LMS 绑定一次，作业、测验、公告与成绩便自动同步到对应课程。新作业一键导入，已导入的作业一有变化，第一时间告诉你。目前支持 Canvas。',
      cards: [
        ['作业与成绩，一页看全', '按作业组列出截止、得分与提交状态，哪些已进成绩册，一目了然。'],
        ['权重分类，一并带来', '作业组自动对应成绩分类，已出的分数随之导入。'],
        ['Sem 也读得懂', 'Sem 能查阅 LMS 上的课程内容，替你回答与课程有关的问题。'],
      ] as Item[],
    },
    files: {
      eyebrow: '课程资料',
      h2: '翻遍课件，只需一搜。',
      sub: '上传即建立索引。预览中有目录、全文搜索与缩放，扫描版 PDF 也能查看识别出的文字。Sem 引用资料时标注页码，点一下就回到原文。',
    },
    notify: {
      eyebrow: '通知',
      h2: '事事有提醒，时时不误事。',
      bullets: [
        ['上课与截止提醒', '按你设定的提前量提醒，每天早上再送上一份当日摘要。'],
        ['LMS 动态', '新成绩、作业变更与课程公告，及时送达。'],
        ['免打扰时段', '设好安静时间，这段时间里一律不打扰。'],
      ] as Item[],
    },
    palette: {
      eyebrow: '命令面板',
      h2: '一键直达，键步如飞。',
      bullets: [
        ['全局搜索', '按 Ctrl K，页面、学期、课程与命令随叫随到，拼音也能搜。'],
        ['课程间一键切换', '用 Ctrl ↑ / ↓ 在课程间切换，停留在同一页面。'],
      ] as Item[],
    },
    more: {
      h2: '每一处细节，都为日常学习打磨。',
      local: [
        '端侧 AI',
        '私有化部署时，文字识别与语义搜索直接在你自己的服务器上完成，数据不经过任何第三方。',
      ] as Item,
      open: [
        '开源，可私有化部署',
        '源代码公开，一条 Docker 命令即可部署到自己的服务器。数据放在哪里，由你决定。',
      ] as Item,
      mobile: [
        '口袋里的今天',
        '在手机上查看今日安排、处理待办、与 Sem 对话，还能添加到主屏幕。',
      ] as Item,
      plugins: ['插件，按需添加', '为任意页面的看板添上实用小工具，用不到的就不装。'] as Item,
      layout: ['版面由你布置', '看板卡片自由增减与排列，侧边栏页面也能排序或隐藏。'] as Item,
      data: ['数据随时带走', '完整导出账户数据，随时导入恢复。'] as Item,
    },
    close: {
      h2: '下一个学期，从容开始。',
      sub: '免费使用，也可私有化部署。',
    },
    footer: {
      about: '面向大学生的学期管理平台。',
      product: '产品',
      today: '今日概览',
      calendar: '日历',
      grades: '成绩与 GPA',
      lms: 'LMS 集成',
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
    title: 'Semestra: your whole semester, handled',
    description:
      'Semestra brings your schedule, tasks, grades and course files together, with Sem, an AI agent that takes a goal and sees it through.',
    nav: {
      product: 'Product',
      open: 'Open source',
      docs: 'Docs',
      login: 'Log in',
      start: 'Get started',
      other: '中文',
    },
    hero: {
      badge: 'An academic agent built for long-horizon work',
      h1: ['Your whole semester.', 'Handled.'],
      lede: 'Schedule, tasks, grades and course files, finally in one place. And Sem, an AI agent that plans the work and sees it through.',
      start: 'Get started for free',
      explore: 'Explore the product',
      small: 'Open source · Self-hostable',
    },
    logos: 'Works with the tools you already use',
    today: {
      eyebrow: 'Today',
      h2: "Where to be. What's due. At a glance.",
      sub: "Today's classes, rooms and the countdown to the next one, next to everything due this week. One look in the morning and the day makes sense.",
      bullets: [
        ['A live timeline', "A now line shows what's on and what's next."],
        ['Seven days ahead', 'Deadlines grouped by day and colour-coded by course.'],
      ] as Item[],
    },
    calendar: {
      eyebrow: 'Calendar',
      h2: 'One calendar. The whole semester.',
      week: [
        'Classes, deadlines and tasks. Together.',
        "Always in your program's time zone, so it's right wherever you are. Drag to reschedule, and switch between week, month, list and timetable views.",
      ] as Item,
      filters: [
        'See only what matters.',
        'Filter by item type and course to cut the noise.',
      ] as Item,
      subscribe: [
        'On every calendar you use.',
        'One iCalendar link keeps Google Calendar, Apple Calendar and Outlook in sync.',
      ] as Item,
      meetings: [
        'Enter once. Scheduled all term.',
        'Add the weekly meeting times for each section and the whole term fills itself in.',
      ] as Item,
      import: [
        "Import. Don't retype.",
        "Bring in courses, assessments and due dates from your LMS, an iCalendar file or a syllabus, and review each item before it's saved.",
      ] as Item,
    },
    grades: {
      eyebrow: 'Grades and GPA',
      h2: "Know where you stand. See where you're headed.",
      live: [
        'Grades and GPA, always current.',
        'Every score you enter updates your grade, your GPA and your progress in each category.',
      ] as Item,
      book: [
        'A gradebook that does the math.',
        'Record assessments by category and weight. The course grade takes care of itself.',
      ] as Item,
      forecast: [
        'See it coming.',
        'A forecast from your very first grade, projecting the rest of the term from how you do in each category.',
      ] as Item,
      plan: [
        'Work back from your goal.',
        'Set a target and see the minimum you need on every remaining assessment.',
      ] as Item,
      scales: [
        'Fluent in every scale.',
        'University of Toronto, US 4.0 / 4.33, Australian 7-point, Korean 4.5 and more, or define your own ranges.',
      ] as Item,
      prev: 'Previous',
      next: 'Next',
    },
    sem: {
      h2: 'Hand it to Sem. Consider it done.',
      sub: 'Sem is an academic agent built for long-horizon work. It breaks a goal into steps, looks across your schedule, grades and course files, and keeps going until the job is done.',
      run: [
        'One sentence in. A whole plan out.',
        'Describe the goal. Sem plans the steps, gathers what it needs and hands back a plan you can act on.',
      ] as Item,
      memory: [
        'Gets to know you.',
        'Sem remembers your preferences and study habits and tidies its notes in the background. Every memory is yours to review or delete.',
      ] as Item,
      mcp: [
        'Your AI tools, fluent in your semester.',
        'Through MCP, give Claude Code, Cursor, VS Code, Codex and the other AI tools you use your schedule, grades, tasks and course files as context.',
      ] as Item,
      hitl: [
        'Human in the loop',
        'Every change starts as a proposal and runs only after you approve, edit or reject it. Your model provider, your key.',
      ] as Item,
      trace: [
        'Long tasks. Every step in the open.',
        "Expand any step to see Sem's reasoning, the tools it called and the data it changed.",
      ] as Item,
    },
    tasks: {
      eyebrow: 'Tasks',
      h2: 'Jot it down. Watch it check itself off.',
      bullets: [
        [
          'Submitted means done',
          'Every assessment gets a task that completes when the grade comes in, or as soon as you submit on your LMS.',
        ],
        [
          'Sorted by course',
          'Tasks land in the right term from their course and due date, and show up on program, term and course pages.',
        ],
        [
          'On your calendar',
          'Tasks show up on the calendar. Drag to reschedule, select to complete.',
        ],
      ] as Item[],
      cta: 'Get started',
    },
    lms: {
      eyebrow: 'Deep LMS integration',
      h2: 'Your LMS. Built right in.',
      sub: 'Link your courses to your LMS once, and assignments, quizzes, announcements and grades sync to the right course automatically. Import new work in one step, and hear about it the moment anything you imported changes. Canvas is supported today.',
      cards: [
        [
          'Assignments and grades, one view',
          "Due dates, scores and submission status by assignment group, with what's already in your gradebook marked.",
        ],
        [
          'The weights come along',
          'Assignment groups map to grade categories, and existing scores come in with them.',
        ],
        [
          'Sem reads it too',
          'Sem can look through course content on your LMS to answer questions about your courses.',
        ],
      ] as Item[],
    },
    files: {
      eyebrow: 'Course files',
      h2: 'Every slide. One search away.',
      sub: 'Files are indexed the moment you upload them. Preview with an outline, full-text search and zoom, and read the recognised text of scanned PDFs. When Sem cites a file, the page number takes you straight to the source.',
    },
    notify: {
      eyebrow: 'Notifications',
      h2: 'The nudge you need, right on time.',
      bullets: [
        [
          'Class and deadline reminders',
          'Reminders at the lead time you choose, plus a summary of your day each morning.',
        ],
        [
          'LMS updates',
          'New grades, changed assignments and course announcements, as they happen.',
        ],
        ['Quiet hours', 'Set quiet hours and nothing interrupts them.'],
      ] as Item[],
    },
    palette: {
      eyebrow: 'Command palette',
      h2: 'Everything. One shortcut away.',
      bullets: [
        [
          'Global search',
          'Press Ctrl K to jump to any page, term, course or command, with pinyin matching.',
        ],
        [
          'Switch courses in a keystroke',
          'Use Ctrl ↑ / ↓ to move between courses and stay on the same page.',
        ],
      ] as Item[],
    },
    more: {
      h2: 'Thoughtful details. Every day.',
      local: [
        'On-device AI',
        'Self-host and text recognition and semantic search run on your own server, so your data never passes through a third party.',
      ] as Item,
      open: [
        'Open source. Self-hostable.',
        'Public source code, deployed to your own server with one Docker command. Your data lives where you decide.',
      ] as Item,
      mobile: [
        'Today, in your pocket',
        'Check your day, clear tasks and talk to Sem on your phone, then add it to your Home Screen.',
      ] as Item,
      plugins: [
        'Plugins, as you need them',
        "Add handy tools to any page's board, and skip the ones you don't need.",
      ] as Item,
      layout: [
        'Your layout',
        'Add, remove and arrange cards on every board, and reorder or hide pages in the sidebar.',
      ] as Item,
      data: [
        'Your data goes where you go',
        'Export your whole account and restore it whenever you like.',
      ] as Item,
    },
    close: {
      h2: 'Next semester starts calmer.',
      sub: 'Free to use. Self-hostable.',
    },
    footer: {
      about: 'The semester workspace for university students.',
      product: 'Product',
      today: 'Today',
      calendar: 'Calendar',
      grades: 'Grades and GPA',
      lms: 'LMS integration',
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

/** The site's base path, without a trailing slash (`/landing`). */
export const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')
export const home = (lang: Lang) => (lang === 'en' ? `${BASE}/` : `${BASE}/zh/`)
/** A file in `public/`, e.g. `asset('/parts/gpa-light-en.webp')`. */
export const asset = (path: string) => `${BASE}${path}`
/** A page of the docs site in the visitor's language, e.g. `docs('en', 'mcp')`. */
export const docs = (lang: Lang, section = '') =>
  `${DOCS_URL}/${lang === 'en' ? 'en' : 'zh'}${section ? `/${section}` : ''}`
export const langName: Record<Lang, string> = { en: 'English', 'zh-CN': '简体中文' }
export const shotLang = (lang: Lang) => (lang === 'en' ? 'en' : 'zh')
