import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { i18nProvider } from 'fumadocs-ui/i18n'
import { Provider } from '@/components/provider'
import { i18n } from '@/lib/i18n'
import { translations } from '@/lib/layout.shared'
import { siteUrl } from '@/lib/shared'
import '../global.css'

const inter = Inter({
  subsets: ['latin'],
})

export default async function Layout({ params, children }: LayoutProps<'/[lang]'>) {
  const { lang } = await params

  return (
    <html
      lang={lang === 'zh' ? 'zh-CN' : lang}
      className={inter.className}
      suppressHydrationWarning
    >
      <body className="flex flex-col min-h-screen">
        <Provider i18n={i18nProvider(translations, lang)}>{children}</Provider>
      </body>
    </html>
  )
}

export async function generateMetadata({ params }: LayoutProps<'/[lang]'>): Promise<Metadata> {
  const { lang } = await params
  const title = lang === 'zh' ? 'Semestra 文档' : 'Semestra Docs'

  return {
    // Origin for the social images' absolute URLs (their paths already carry the basePath).
    metadataBase: new URL(siteUrl),
    title: { default: title, template: `%s | ${title}` },
    description:
      lang === 'zh'
        ? '自部署、AI 服务商、MCP、Canvas、API 与插件开发。'
        : 'Self-hosting, AI providers, MCP, Canvas, the API and plugin authoring.',
  }
}

export function generateStaticParams() {
  return i18n.languages.map((lang) => ({ lang }))
}
