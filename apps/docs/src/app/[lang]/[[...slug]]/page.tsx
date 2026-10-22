import { source } from '@/lib/source'
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  ViewOptionsPopover,
} from 'fumadocs-ui/layouts/spacious/page'
import { notFound } from 'next/navigation'
import { getMDXComponents } from '@/components/mdx'
import type { Metadata } from 'next'
import { Card } from 'fumadocs-ui/components/card'
import { createRelativeLink } from 'fumadocs-ui/mdx'
import { OpenAPIPage } from '@/components/api-page'
import { openapi } from '@/lib/openapi'
import { basePath, getPageImageUrl, getPageMarkdownUrl, gitConfig } from '@/lib/shared'

type DocsPageData = NonNullable<ReturnType<typeof source.getPage>>

// MDX components bound to one page: links resolve relative to it, and content links written
// as `/docs/...` go to that page in the reader's language (`/docs/mcp` → `/<lang>/mcp`, which
// next/link serves under the basePath).
function pageComponents(page: DocsPageData, lang: string) {
  const RelativeLink = createRelativeLink(source, page)
  const localize = (href?: string) =>
    href === '/docs' || href?.startsWith('/docs/') ? `/${lang}${href.slice('/docs'.length)}` : href

  return getMDXComponents({
    a: (props) => <RelativeLink {...props} href={localize(props.href)} />,
    Card: (props) => <Card {...props} href={localize(props.href)} />,
    OpenAPIPage: async (props) => (
      <OpenAPIPage {...await openapi.preloadOpenAPIPage(page)} {...props} />
    ),
  })
}

export default async function Page(props: PageProps<'/[lang]/[[...slug]]'>) {
  const { slug, lang } = await props.params
  const page = source.getPage(slug, lang)
  if (!page) notFound()

  const MDX = page.data.body
  const markdownUrl = basePath + getPageMarkdownUrl(page).url
  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription className="mb-0">{page.data.description}</DocsDescription>
      <div className="flex flex-row gap-2 items-center border-b pb-6">
        <MarkdownCopyButton markdownUrl={markdownUrl} />
        <ViewOptionsPopover
          markdownUrl={markdownUrl}
          githubUrl={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/${gitConfig.contentDir}/${page.path}`}
        />
      </div>
      <DocsBody>
        <MDX components={pageComponents(page, lang)} />
      </DocsBody>
    </DocsPage>
  )
}

export async function generateStaticParams() {
  return source.generateParams()
}

export async function generateMetadata(props: PageProps<'/[lang]/[[...slug]]'>): Promise<Metadata> {
  const { slug, lang } = await props.params
  const page = source.getPage(slug, lang)
  if (!page) notFound()

  return {
    title: page.data.title,
    description: page.data.description,
    openGraph: {
      images: basePath + getPageImageUrl(page).url,
    },
  }
}
