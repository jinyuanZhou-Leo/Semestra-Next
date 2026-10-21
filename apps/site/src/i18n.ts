export type Lang = 'zh-CN' | 'en'

export const APP_URL = 'https://app.semestra.app'
export const GITHUB_URL = 'https://github.com/jinyuanZhou-Leo/Semestra-Next'

type Moment = {
  time: string
  shots: string[]
  focus: string
  lift: string
  title: string
  body: string
  where: string
}

const moments = (t: { title: string; body: string; where: string }[]): Moment[] => {
  // Where the camera looks (x y zoom) and the part of the screen that lifts (x0 y0 x1 y1), as fractions of a screenshot.
  const shots: Omit<Moment, 'title' | 'body' | 'where'>[] = [
    { time: '08:40', shots: ['today'], focus: '0.62 0.36 1.3', lift: '0.2 0.17 0.985 0.43' },
    { time: '10:05', shots: ['calendar'], focus: '0.66 0.5 1.4', lift: '0.647 0.32 0.732 0.97' },
    { time: '12:30', shots: ['tasks'], focus: '0.55 0.45 1.35', lift: '0.195 0.235 0.985 0.375' },
    {
      time: '16:10',
      shots: ['grades', 'planfill'],
      focus: '0.84 0.4 1.6',
      lift: '0.76 0.28 0.985 0.655',
    },
    {
      time: '22:15',
      shots: ['semcard', 'sem'],
      focus: '0.56 0.36 1.45',
      lift: '0.325 0.19 0.94 0.415',
    },
  ]
  return shots.map((s, i) => ({ ...s, ...t[i]! }))
}

export const copy = {
  'zh-CN': {
    title: 'Semestra：学期里的每一天，都在这里',
    description:
      'Semestra 为大学生管理整个学期：课表、待办、成绩和 GPA，还有一位会动手的助手 Sem。',
    nav: {
      product: '功能',
      integrations: '集成',
      open: '开源',
      login: '登录',
      start: '免费开始',
      other: 'English',
    },
    stamp: ['2026 秋季', '第 7 周', '周三'],
    h1: ['学期里的每一天，', '都在这里。'],
    lede: 'Semestra 为大学生管理整个学期：课表、待办、成绩和 GPA，还有一位会动手的助手 Sem。',
    startFree: '免费开始',
    walk: '看一个周三',
    handoff: '下面是 Maya 的一个周三，计算机工程，大二',
    moments: moments([
      {
        title: '出门前，看一眼今天。',
        body: '今天三节课，第一节二十分钟后开始。这周要交的东西，按时间排好了。',
        where: '今天',
      },
      {
        title: '两节课之间，看看这一周。',
        body: '讲座、辅导、实验和考试都在一个周视图里。停课和调课周也算进去了，还能订阅到你常用的日历。',
        where: '学期 · 日历',
      },
      {
        title: '午饭时，把要做的记下来。',
        body: 'Canvas 上的作业自动变成待办。输入「周五交实验报告 !!!」，日期和优先级就填好了。',
        where: '待办',
      },
      {
        title: '期中成绩出来了，78 分。',
        body: '成绩一记上，课程成绩和 GPA 就更新了。打开规划，算出期末考到 85 分，这门课还能拿 A。',
        where: 'ECE244H1 · 成绩',
      },
      {
        title: '睡前，让 Sem 排好这周。',
        body: 'Sem 看过课表和截止日期，把期中复习插进空档。每一次改动，都先问过你。',
        where: 'Sem',
      },
    ]),
    moreTitle: '它还接得上这些。',
    more: [
      ['LMS', 'Canvas', '作业、公告和成绩自动同步。'],
      ['ICS', '日历订阅', 'Google 日历，或任何读得懂 ICS 的日历。'],
      ['PLUGINS', '插件', '番茄钟、习惯打卡、世界时钟、便签。'],
      ['MCP', '其他 AI 客户端', '在 Claude 等客户端里读写你的课程和待办。'],
      ['SELF-HOST', '开源', '可以自己部署，数据随时一键导出。'],
    ],
    close: '明天的课，已经排好了。',
    privacy: '隐私',
    terms: '条款',
  },
  en: {
    title: 'Semestra: every day of your semester, in one place',
    description:
      'Semestra runs your whole semester: classes, tasks, grades and GPA, and Sem, an assistant that does the busywork.',
    nav: {
      product: 'Product',
      integrations: 'Integrations',
      open: 'Open source',
      login: 'Log in',
      start: 'Get started',
      other: '中文',
    },
    stamp: ['Fall 2026', 'Week 7', 'Wednesday'],
    h1: ['Every day of your semester,', 'in one place.'],
    lede: 'Semestra runs your whole semester: classes, tasks, grades and GPA, and Sem, an assistant that does the busywork.',
    startFree: 'Get started free',
    walk: 'Walk through a Wednesday',
    handoff: 'Below: a Wednesday for Maya, second-year Computer Engineering',
    moments: moments([
      {
        title: 'Before leaving, a look at today.',
        body: 'Three classes today, the first in twenty minutes. This week’s deadlines, in order.',
        where: 'Today',
      },
      {
        title: 'Between lectures, the week ahead.',
        body: 'Lectures, tutorials, labs and exams in one week view, cancellations included. Subscribe from the calendar you already use.',
        where: 'Term · Calendar',
      },
      {
        title: 'At lunch, jot it down.',
        body: 'Canvas assignments arrive as tasks. Type “Fri lab report !!!” and the date and priority fill themselves in.',
        where: 'Tasks',
      },
      {
        title: 'Midterm marks are back: 78.',
        body: 'Log it and the course grade and GPA update. Plan mode shows an 85 on the final still gets the A.',
        where: 'ECE244H1 · Grades',
      },
      {
        title: 'Before bed, Sem plans the week.',
        body: 'Sem reads the schedule and deadlines and fits midterm review into the gaps. It asks before changing anything.',
        where: 'Sem',
      },
    ]),
    moreTitle: 'It also connects to.',
    more: [
      ['LMS', 'Canvas', 'Assignments, announcements and grades, synced.'],
      ['ICS', 'Calendar feeds', 'Google Calendar, or any app that reads ICS.'],
      ['PLUGINS', 'Plugins', 'Pomodoro, habit streaks, world clock, sticky notes.'],
      [
        'MCP',
        'Other AI clients',
        'Read and update your courses and tasks from Claude and other clients.',
      ],
      ['SELF-HOST', 'Open source', 'Run it yourself and export everything any time.'],
    ],
    close: 'Tomorrow is already planned.',
    privacy: 'Privacy',
    terms: 'Terms',
  },
} satisfies Record<Lang, unknown>

export const home = (lang: Lang) => (lang === 'en' ? '/en/' : '/')
export const shotLang = (lang: Lang) => (lang === 'en' ? 'en' : 'zh')
