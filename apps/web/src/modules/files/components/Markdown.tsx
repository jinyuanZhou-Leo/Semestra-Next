import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'

const REMARK_PLUGINS = [remarkGfm]

/**
 * Markdown from a file (a .md upload, or the text the pipeline extracted). Raw HTML in it is not
 * rendered (react-markdown's default), so file content cannot inject markup.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={cn(
        'space-y-3 text-sm leading-relaxed break-words',
        '[&_h1]:font-heading [&_h1]:text-xl [&_h1]:font-semibold',
        '[&_h2]:font-heading [&_h2]:text-lg [&_h2]:font-semibold',
        '[&_h3]:font-semibold [&_h4]:font-semibold',
        '[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5',
        '[&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1',
        '[&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3',
        '[&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground',
        '[&_table]:w-full [&_table]:text-xs [&_td]:border [&_td]:px-2 [&_td]:py-1',
        '[&_th]:border [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1 [&_th]:text-left',
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{children}</ReactMarkdown>
    </div>
  )
}
