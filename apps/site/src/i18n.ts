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
    title: 'Semestra：你的学业，一手掌握',
    description: 'Semestra 汇聚课表、待办、成绩与 LMS，AI Agent Sem 从规划到执行，替你一步步办妥。',
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
      h1: ['你的学业，', '一手掌握。'],
      lede: '课表、待办、成绩与 LMS，汇于一处。AI Agent Sem 从规划到执行，替你一步步办妥。',
      start: '免费开始使用',
      explore: '了解产品',
      small: '开源 · 可私有化部署',
    },
    logos: '接入你常用的平台',
    today: {
      eyebrow: '今日概览',
      h2: '今日事，今日知。',
      sub: '今天的课与待办，一眼看全。',
      bullets: [
        ['实时时间线', '正在上什么，接下来是什么，心里有数。'],
        ['七日截止', '未来七天的截止，提前看见。'],
      ] as Item[],
    },
    calendar: {
      eyebrow: '日历',
      h2: '整个学期，历历在目。',
      week: [
        '课程、截止、待办，同框呈现',
        '拖一下就改期，周、月、列表与课表视图随心切换。',
      ] as Item,
      filters: ['想看什么，只看什么', '按类型与课程筛选。'] as Item,
      subscribe: ['订阅到你的日历', '一条链接，同步到 Google 日历、Apple 日历与 Outlook。'] as Item,
      meetings: ['所有事件，一处搞定', '讲座、小课、实验，各归其位。'] as Item,
      import: ['轻松配置', '从 LMS、日历文件或课程大纲导入，不必手动填写。'] as Item,
    },
    grades: {
      eyebrow: '成绩与 GPA',
      h2: '每一分，都算数。',
      live: ['实时更新', '考核绑定 LMS，出分即同步。'] as Item,
      book: ['加权成绩册', '按分类与权重记录，总评不用手算。'] as Item,
      forecast: ['预测与模拟', '按已有成绩推算剩余考核，也能代入假设。'] as Item,
      plan: ['设立目标', '定下目标绩点，每项考核要考多少，一算便知。'] as Item,
      scales: ['国际通用', '内置多伦多大学、美国 4.0、澳大利亚 7 分制等标准，也可自定义。'] as Item,
      hide: ['低调模式', '成绩先藏起来，想看时再看。'] as Item,
      prev: '上一张',
      next: '下一张',
    },
    sem: {
      h2: '交给 Sem，你的学业助理。',
      sub: '它熟悉你的课程、成绩与安排，有问必答。',
      run: ['无需解释，直奔主题', '报出课程代码或考核名称，Sem 秒懂。'] as Item,
      memory: ['越用，越懂你', '记住你的偏好与学习习惯。'] as Item,
      mcp: ['你熟悉的 AI，也懂你的学业', '通过 MCP 连接 ChatGPT、Claude、Cursor 等工具。'] as Item,
      hitl: ['Human in the loop', '每一处改动，都先经你确认。'] as Item,
      refs: ['@ 文件，/ 技能', '输入 @ 引用课程文件，输入 / 选择技能。'] as Item,
      ask: ['拿不准，先问你', '需要你拿主意时，Sem 给出选项让你挑。'] as Item,
      recall: ['聊过的，都记得', '以前聊过的，随时翻得出来。'] as Item,
      beats: [
        '说出你的目标。',
        'Sem 翻看你的课表，和每一个截止日期。',
        '在空档里，排好复习。',
        '每一项改动，都先摆在你面前。',
        '你点头，才会写进去。',
        '安排好了，就在待办里。',
      ],
      trace: ['长程任务，步步可查。', 'Sem 的每一步推理与改动，清清楚楚。'] as Item,
    },
    tasks: {
      eyebrow: '待办',
      h2: '让待办，不再待办。',
      bullets: [
        ['随手一写', '日期、优先级与课程，自动识别。'],
        ['自动完成', '在 LMS 提交或出分后，自动勾选。'],
        ['排进日历', '在日历里拖一下改期，点一下完成。'],
      ] as Item[],
      cta: '开始使用',
    },
    lms: {
      eyebrow: 'LMS 深度集成',
      h2: '作业成绩，打包搞定。',
      sub: '课程绑定 LMS，作业、测验、公告与成绩自动同步。现已支持 Canvas。',
      cards: [
        ['后台同步，自动跟随', '平台一有变化就跟上，只在需要你拿主意时才打扰你。'],
        ['权重分类，一并带来', '作业组对应成绩分类，已出的分数一起导入。'],
        ['Sem 也读得懂', '关于课程的问题，Sem 会去 LMS 里找答案。'],
      ] as Item[],
    },
    files: {
      eyebrow: '课程资料',
      h2: '翻遍课件，只需一搜。',
      sub: '上传即可全文搜索，扫描版 PDF 也不例外。Sem 引用时标明页码，一点直达原文。',
    },
    notify: {
      eyebrow: '通知',
      h2: '事事有提醒，时时不误事。',
      bullets: [
        ['上课与截止提醒', '提前多久，你说了算。'],
        ['LMS 动态', '新成绩、作业变更与公告，及时送达。'],
        ['免打扰时段', '安静时段，一律不打扰。'],
      ] as Item[],
    },
    palette: {
      eyebrow: '命令面板',
      h2: '一键直达，键步如飞。',
      bullets: [
        ['全局搜索', 'Ctrl K，页面、课程与命令随叫随到，拼音也能搜。'],
        ['课程间一键切换', 'Ctrl ↑ / ↓ 切换课程，页面不变。'],
      ] as Item[],
    },
    more: {
      h2: '还有这些。',
      local: ['端侧 AI', '私有化部署时，文字识别与搜索都在本地完成，数据不出你的服务器。'] as Item,
      open: ['开源，可私有化部署', '一条 Docker 命令，部署到你自己的服务器。'] as Item,
      mobile: ['口袋里的今天', '在手机上看安排、清待办、问 Sem。'] as Item,
      plugins: ['看板，由你布置', '卡片随意排列，小工具按需添加。'] as Item,
      passkey: ['通行密钥', '用指纹或面容登录，不用记密码。'] as Item,
      data: ['数据随时带走', '一键导出，随时恢复。'] as Item,
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
      'Semestra brings your schedule, tasks, grades and LMS together, with Sem, an AI agent that plans the work and sees it through.',
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
      lede: 'Schedule, tasks, grades and your LMS, in one place. And Sem, an AI agent that plans the work and sees it through.',
      start: 'Get started for free',
      explore: 'Explore the product',
      small: 'Open source · Self-hostable',
    },
    logos: 'Works with the tools you already use',
    today: {
      eyebrow: 'Today',
      h2: "Where to be. What's due. At a glance.",
      sub: "Today's classes and tasks, all in one look.",
      bullets: [
        ['A live timeline', "Know what's on now, and what's next."],
        ['Seven days ahead', "See the week's deadlines coming."],
      ] as Item[],
    },
    calendar: {
      eyebrow: 'Calendar',
      h2: 'One calendar. The whole semester.',
      week: [
        'Classes, deadlines and tasks. Together.',
        'Drag to reschedule. Week, month, list or timetable, your call.',
      ] as Item,
      filters: ['See only what matters.', 'Filter by type and course.'] as Item,
      subscribe: [
        'On every calendar you use.',
        'One link syncs with Google Calendar, Apple Calendar and Outlook.',
      ] as Item,
      meetings: [
        'Every event. One place.',
        'Lectures, tutorials and labs, each in its place.',
      ] as Item,
      import: [
        "Import. Don't retype.",
        'Import from your LMS, a calendar file or a syllabus instead of typing it in.',
      ] as Item,
    },
    grades: {
      eyebrow: 'Grades and GPA',
      h2: "Know where you stand. See where you're headed.",
      live: [
        'Always current.',
        'Link assessments to your LMS and grades sync as they come in.',
      ] as Item,
      book: [
        'A gradebook that does the math.',
        'Record by category and weight. Never work out a course grade by hand again.',
      ] as Item,
      forecast: [
        'See it coming.',
        'Project the rest of the term from your grades so far, or try a what-if.',
      ] as Item,
      plan: [
        'Work back from your goal.',
        'Set a target and see what you need on every remaining assessment.',
      ] as Item,
      scales: [
        'Fluent in every scale.',
        'University of Toronto, US 4.0, Australian 7-point and more, or your own.',
      ] as Item,
      hide: [
        'Keep it private.',
        'Keep your grades out of sight until you want to see them.',
      ] as Item,
      prev: 'Previous',
      next: 'Next',
    },
    sem: {
      h2: 'Hand it to Sem. Consider it done.',
      sub: 'Sem knows your courses, grades and schedule. Just ask.',
      run: [
        'Skip the explaining.',
        'Name a course code or an assessment. Sem knows what you mean.',
      ] as Item,
      memory: ['Gets to know you.', 'Sem remembers your preferences and study habits.'] as Item,
      mcp: [
        'Your AI tools, fluent in your semester.',
        'Connect ChatGPT, Claude, Cursor and more through MCP.',
      ] as Item,
      hitl: ['Human in the loop', 'Nothing changes until you approve it.'] as Item,
      refs: ['@ files. / skills.', 'Type @ to attach a course file, or / to pick a skill.'] as Item,
      ask: [
        'Asks before it guesses.',
        'When the call is yours, Sem gives you options to choose from.',
      ] as Item,
      recall: [
        'Remembers the conversation.',
        'Anything you talked about before, back in a moment.',
      ] as Item,
      beats: [
        'Tell Sem what you need.',
        'It reads your schedule, and every deadline.',
        'It fits the review into the gaps.',
        'Every change, laid out for you first.',
        'Nothing is written until you say so.',
        "Done. It's on your list.",
      ],
      trace: [
        'Long tasks. Every step in the open.',
        "Every step of Sem's reasoning, and every change, in the open.",
      ] as Item,
    },
    tasks: {
      eyebrow: 'Tasks',
      h2: 'Jot it down. Watch it check itself off.',
      bullets: [
        ['Just type', 'Dates, priority and course fill themselves in.'],
        ['Checks itself off', 'Submit on your LMS or get a grade, and the task is done.'],
        ['On your calendar', 'Drag to reschedule. Check it off right there.'],
      ] as Item[],
      cta: 'Get started',
    },
    lms: {
      eyebrow: 'Deep LMS integration',
      h2: 'Your LMS. Built right in.',
      sub: 'Link your courses once. Assignments, quizzes, announcements and grades stay in sync. Canvas is supported today.',
      cards: [
        [
          'Syncs in the background',
          'Keeps up with every change, and only interrupts you when it needs your call.',
        ],
        ['The weights come along', 'Assignment groups become grade categories, scores included.'],
        ['Sem reads it too', 'Ask about a course and Sem looks it up on your LMS.'],
      ] as Item[],
    },
    files: {
      eyebrow: 'Course files',
      h2: 'Every slide. One search away.',
      sub: "Upload and search every word, even in scanned PDFs. The page numbers in Sem's answers take you straight to the source.",
    },
    notify: {
      eyebrow: 'Notifications',
      h2: 'The nudge you need, right on time.',
      bullets: [
        ['Class and deadline reminders', 'As early as you like.'],
        ['LMS updates', 'New grades, changed assignments and announcements, as they happen.'],
        ['Quiet hours', 'Quiet hours stay quiet.'],
      ] as Item[],
    },
    palette: {
      eyebrow: 'Command palette',
      h2: 'Everything. One shortcut away.',
      bullets: [
        ['Global search', 'Press Ctrl K to jump to any page, course or command.'],
        ['Switch courses in a keystroke', 'Ctrl ↑ / ↓ moves between courses and keeps your place.'],
      ] as Item[],
    },
    more: {
      h2: "And there's more.",
      local: [
        'On-device AI',
        'Self-host, and text recognition and search run on your own server. Your data stays there.',
      ] as Item,
      open: [
        'Open source. Self-hostable.',
        'Deploy to your own server with one Docker command.',
      ] as Item,
      mobile: [
        'Today, in your pocket',
        'Check your day, clear tasks and ask Sem on your phone.',
      ] as Item,
      plugins: ['Your board, your way', 'Arrange cards and add the tools you want.'] as Item,
      passkey: ['Passkeys', 'Sign in with your fingerprint or face instead of a password.'] as Item,
      data: ['Your data goes where you go', 'Export it all. Restore it anytime.'] as Item,
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
