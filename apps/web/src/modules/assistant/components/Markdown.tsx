import { useRouter } from '@tanstack/react-router'
import type { ComponentProps, ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useHighlightedCode } from '@/hooks/use-highlighted-code'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/ui/hover-card'
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockLine,
} from '@/ui/code-block'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'
import type { Citation } from '../stream'

const CITE = /\[\[cite:([^\]\s]+)\]\]/g
const CITE_HREF = '#cite:'

/** `[[cite:<id>]]` markers become numbered links the renderer turns into citation badges. */
export function linkCitations(text: string, citations: ReadonlyMap<string, Citation>): string {
  const numbers = new Map<string, number>()
  return text.replace(CITE, (_, id: string) => {
    if (!citations.has(id)) return ''
    const n = numbers.get(id) ?? numbers.size + 1
    numbers.set(id, n)
    return `[${n}](${CITE_HREF}${encodeURIComponent(id)})`
  })
}

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

function Code({ code, language }: { code: string; language: string }) {
  const lines = useHighlightedCode(code, language)
  return (
    <CodeBlock size="sm" className="my-2">
      <CodeBlockActions>
        <CodeBlockCopyButton value={code} />
      </CodeBlockActions>
      <CodeBlockContent>
        {lines.map((line, index) => (
          // oxlint-disable-next-line react/no-array-index-key -- lines have no identity
          <CodeBlockLine key={index}>{line}</CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  )
}

function components(citations: ReadonlyMap<string, Citation>): Components {
  return {
    a: ({ href, children }: ComponentProps<'a'>) => {
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
    },
    pre: ({ children }) => <>{children}</>,
    code: ({ className, children }) => {
      const language = /language-(\w+)/.exec(className ?? '')?.[1]
      const text = String(children ?? '')
      if (!language && !text.includes('\n')) {
        return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{text}</code>
      }
      return <Code code={text} language={language ?? 'text'} />
    },
    table: ({ children }) => (
      <div className="my-2 overflow-x-auto rounded-xl border">
        <Table>{children}</Table>
      </div>
    ),
    thead: ({ children }) => <TableHeader>{children}</TableHeader>,
    tbody: ({ children }) => <TableBody>{children}</TableBody>,
    tr: ({ children }) => <TableRow>{children}</TableRow>,
    th: ({ children }) => <TableHead>{children}</TableHead>,
    td: ({ children }) => <TableCell className="whitespace-normal">{children}</TableCell>,
  }
}

/** An answer: GFM Markdown with highlighted code, tables and citation badges (M12 §6.1). */
export function Markdown({
  text,
  citations,
}: {
  text: string
  citations: ReadonlyMap<string, Citation>
}) {
  return (
    <div className="space-y-2 text-sm leading-relaxed wrap-break-word [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:font-medium [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components(citations)}>
        {linkCitations(text, citations)}
      </ReactMarkdown>
    </div>
  )
}
