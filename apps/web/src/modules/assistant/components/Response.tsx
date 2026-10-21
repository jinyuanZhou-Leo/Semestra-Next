import { useRouter } from '@tanstack/react-router'
import 'katex/dist/katex.min.css'
import { type ComponentProps, createContext, type ReactNode, useContext } from 'react'
import {
  type Components,
  defaultRehypePlugins,
  type StreamdownProps,
  type StreamdownTranslations,
} from 'streamdown'
import { MessageResponse } from '@/components/ai-elements/message'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/ui/hover-card'
import type { Citation } from '../stream'
import { CITE_HREF, linkCitations, type MarkdownProps } from './Markdown'

function citationTitle(citation: Citation): string {
  return citation.title ?? citation.name ?? m.assistant_citation_untitled()
}

/** A quoted file in the sentence (AI Elements "Inline Citation"): its title and words on hover. */
function CitationBadge({ citation, children }: { citation: Citation; children: ReactNode }) {
  const snippet = citation.snippet ?? citation.text
  return (
    <HoverCard>
      <HoverCardTrigger
        delay={10}
        closeDelay={100}
        render={
          <Button
            variant="secondary"
            size="xs"
            className="mx-0.5 h-4 min-w-4 px-1 align-text-top text-[10px] tabular-nums"
            aria-label={citationTitle(citation)}
          />
        }
      >
        {children}
      </HoverCardTrigger>
      <HoverCardContent className="flex w-64 flex-col gap-1">
        <div className="font-medium">{citationTitle(citation)}</div>
        {snippet ? <p className="line-clamp-4 text-muted-foreground">{snippet}</p> : null}
        {citation.url ? (
          <a
            href={citation.url}
            className="text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            {m.assistant_citation_open()}
          </a>
        ) : null}
      </HoverCardContent>
    </HoverCard>
  )
}

const LINK_CLASS = 'font-medium text-primary underline-offset-4 hover:underline'

/** A link to a page of the app stays in the app. */
function InternalLink({ href, children }: { href: string; children: ReactNode }) {
  const router = useRouter()
  return (
    <a
      href={href}
      className={LINK_CLASS}
      onClick={(event) => {
        event.preventDefault()
        router.history.push(href)
      }}
    >
      {children}
    </a>
  )
}

// The conversation's citations reach the links through context, so `COMPONENTS` stays one object
// and the renderer keeps the blocks it already drew instead of rebuilding them on every token.
const Citations = createContext<ReadonlyMap<string, Citation>>(new Map())

function Link({ href, children }: ComponentProps<'a'>) {
  const citations = useContext(Citations)
  if (href?.startsWith(CITE_HREF)) {
    const citation = citations.get(decodeURIComponent(href.slice(CITE_HREF.length)))
    return citation ? <CitationBadge citation={citation}>{children}</CitationBadge> : null
  }
  if (href?.startsWith('/') && !href.startsWith('//')) {
    return <InternalLink href={href}>{children}</InternalLink>
  }
  return (
    <a href={href} className={LINK_CLASS} target="_blank" rel="noreferrer">
      {children}
    </a>
  )
}

/**
 * Only images from this app load by themselves. Any other address could carry data out (an
 * instruction planted in a page or file asking for "an image" with the user's grades in its URL),
 * so it shows as a link named by its description instead.
 */
function Image({ src, alt }: ComponentProps<'img'>) {
  const url = typeof src === 'string' ? src : ''
  if (url.startsWith('/') && !url.startsWith('//')) {
    return <img src={url} alt={alt ?? ''} className="my-2 max-w-full rounded-lg" />
  }
  return (
    <a href={url} className={LINK_CLASS} target="_blank" rel="noreferrer">
      {alt || url}
    </a>
  )
}

// `Components`' string index signature rejects any typed override; `a` gets real anchor props.
const COMPONENTS = { a: Link, img: Image } as Components
// HTML in an answer shows as text, as quoted pages and files may carry it (no `raw`); links and
// images the hardening step refuses keep their text, without an English "[blocked]" note.
const [harden, hardenOptions] = defaultRehypePlugins.harden as [never, object]
const REHYPE_PLUGINS: StreamdownProps['rehypePlugins'] = [
  defaultRehypePlugins.sanitize!,
  [harden, { ...hardenOptions, linkBlockPolicy: 'text-only', imageBlockPolicy: 'text-only' }],
]
// Copying code and diagrams is the one tool an answer offers: no table toolbar, downloads, full
// screen or line numbers, as before Streamdown.
const CONTROLS = {
  table: false,
  code: { copy: true, download: false },
  mermaid: { copy: true, download: false, fullscreen: false, panZoom: false },
  image: false,
}
// Links are handled by `Link` (in the app, citations, or a new tab), without a warning dialog.
const LINK_SAFETY = { enabled: false }

function translations(): Partial<StreamdownTranslations> {
  return {
    close: m.assistant_md_close(),
    copied: m.assistant_md_copied(),
    copyCode: m.assistant_md_copy_code(),
    copyLink: m.assistant_md_copy_link(),
    copyTable: m.assistant_md_copy_table(),
    copyTableAsCsv: m.assistant_md_copy_table_as_csv(),
    copyTableAsMarkdown: m.assistant_md_copy_table_as_markdown(),
    copyTableAsTsv: m.assistant_md_copy_table_as_tsv(),
    downloadDiagram: m.assistant_md_download_diagram(),
    downloadDiagramAsMmd: m.assistant_md_download_diagram_as_mmd(),
    downloadDiagramAsPng: m.assistant_md_download_diagram_as_png(),
    downloadDiagramAsSvg: m.assistant_md_download_diagram_as_svg(),
    downloadFile: m.assistant_md_download_file(),
    downloadImage: m.assistant_md_download_image(),
    downloadTable: m.assistant_md_download_table(),
    downloadTableAsCsv: m.assistant_md_download_table_as_csv(),
    downloadTableAsMarkdown: m.assistant_md_download_table_as_markdown(),
    errorMermaid: m.assistant_md_error_mermaid(),
    exitFullscreen: m.assistant_md_exit_fullscreen(),
    externalLinkWarning: m.assistant_md_external_link_warning(),
    imageNotAvailable: m.assistant_md_image_not_available(),
    mermaidAriaLabel: m.assistant_md_mermaid_aria_label(),
    mermaidFormatMmd: m.assistant_md_mermaid_format_mmd(),
    mermaidFormatPng: m.assistant_md_mermaid_format_png(),
    mermaidFormatSvg: m.assistant_md_mermaid_format_svg(),
    openExternalLink: m.assistant_md_open_external_link(),
    openLink: m.assistant_md_open_link(),
    resetView: m.assistant_md_reset_view(),
    tableFormatCsv: m.assistant_md_table_format_csv(),
    tableFormatMarkdown: m.assistant_md_table_format_markdown(),
    tableFormatTsv: m.assistant_md_table_format_tsv(),
    viewFullscreen: m.assistant_md_view_fullscreen(),
    zoomIn: m.assistant_md_zoom_in(),
    zoomOut: m.assistant_md_zoom_out(),
  }
}

/** The answer rendered by AI Elements' `MessageResponse`; `Markdown` loads it on demand. */
export default function Response({ text, citations, streaming, className }: MarkdownProps) {
  return (
    <Citations value={citations}>
      <MessageResponse
        // Headings stay at the answer's size, as they did before Streamdown.
        className={cn(
          'space-y-2 text-sm leading-relaxed wrap-break-word [&_h1]:mt-3 [&_h1]:mb-1 [&_h1]:text-base [&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:text-sm [&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-medium [&_li]:py-0.5',
          className,
        )}
        components={COMPONENTS}
        rehypePlugins={REHYPE_PLUGINS}
        controls={CONTROLS}
        lineNumbers={false}
        linkSafety={LINK_SAFETY}
        translations={translations()}
        isAnimating={streaming}
      >
        {linkCitations(text, citations)}
      </MessageResponse>
    </Citations>
  )
}
