import Link from 'next/link'
import type { Lang } from '@/lib/i18n'

const copy = {
  en: {
    title: 'Semestra documentation',
    tagline:
      'Run Semestra on your own server, bring your own AI keys, and connect it to MCP clients and Canvas.',
    start: 'Get started',
    api: 'API reference',
    sections: [
      [
        'Self-hosting',
        'One container with Docker Compose: HTTPS, email, backups and upgrades.',
        'self-hosting',
      ],
      [
        'AI and BYOK',
        'Use your own keys for Anthropic, OpenAI, Gemini, compatible endpoints or Ollama.',
        'ai',
      ],
      [
        'MCP',
        'Let Claude, Cursor and other MCP clients read and change your Semestra data.',
        'mcp',
      ],
      ['LMS', 'Connect Canvas and import courses, assignments and syllabi.', 'lms'],
      ['API', 'Authentication, API tokens and every endpoint.', 'api'],
      [
        'Plugins and data',
        'Write a first-party plugin, export your data or delete your account.',
        'plugins',
      ],
    ],
  },
  zh: {
    title: 'Semestra 文档',
    tagline: '在自己的服务器上运行 Semestra，自带 AI 密钥，并接入 MCP 客户端和 Canvas。',
    start: '开始阅读',
    api: 'API 参考',
    sections: [
      ['自部署', '用 Docker Compose 运行一个容器：HTTPS、邮件、备份与升级。', 'self-hosting'],
      ['AI 与 BYOK', '使用自己的 Anthropic、OpenAI、Gemini、兼容端点或 Ollama 密钥。', 'ai'],
      ['MCP', '让 Claude、Cursor 等 MCP 客户端读取和修改你的 Semestra 数据。', 'mcp'],
      ['LMS', '连接 Canvas，导入课程、作业和 Syllabus。', 'lms'],
      ['API', '认证方式、API 令牌和全部接口。', 'api'],
      ['插件与数据', '编写第一方插件、导出数据或删除账户。', 'plugins'],
    ],
  },
} satisfies Record<Lang, unknown>

export default async function HomePage({ params }: PageProps<'/[lang]'>) {
  const { lang } = await params
  const t = copy[lang as Lang] ?? copy.en

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-12 px-4 py-16 md:py-24">
      <section className="flex flex-col gap-4">
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{t.title}</h1>
        <p className="max-w-2xl text-fd-muted-foreground md:text-lg">{t.tagline}</p>
        <div className="flex flex-wrap gap-3">
          <Link
            href={`/${lang}/docs`}
            className="rounded-md bg-fd-primary px-4 py-2 text-sm font-medium text-fd-primary-foreground"
          >
            {t.start}
          </Link>
          <Link
            href={`/${lang}/docs/api/reference/academics`}
            className="rounded-md border px-4 py-2 text-sm font-medium"
          >
            {t.api}
          </Link>
        </div>
      </section>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {t.sections.map(([name, text, slug]) => (
          <Link
            key={slug}
            href={`/${lang}/docs/${slug}`}
            className="rounded-lg border bg-fd-card p-5 transition-colors hover:bg-fd-accent"
          >
            <h2 className="font-medium">{name}</h2>
            <p className="mt-1 text-sm text-fd-muted-foreground">{text}</p>
          </Link>
        ))}
      </section>
    </main>
  )
}
