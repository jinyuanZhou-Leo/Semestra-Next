import DOMPurify from 'dompurify'
import type { MouseEvent } from 'react'
import { cn } from '@/lib/utils'
import './safe-html.css'

/** A link the backend recognised as pointing into the platform (`data-lms-kind` / `-ref`, M09). */
export type InternalLink = { kind: string; ref: string }

const purify = DOMPurify(window)
purify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'IMG') node.setAttribute('loading', 'lazy')
  if (node.tagName === 'A' && node.hasAttribute('href')) {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

/**
 * Inline styles kept in the original look: the backend's list (`lms/html.py` `STYLE_PROPERTIES`)
 * again, here with the longhands the browser expands shorthands into. Nothing that positions,
 * layers, hides or loads anything.
 */
const STYLE_PROPERTY =
  /^(color|background-color|font(-.+)?|line-height|letter-spacing|text-(align|indent|transform)|text-decoration(-.+)?|vertical-align|white-space|word-break|overflow-wrap|(margin|padding)(-(top|right|bottom|left))?|border(-(top|right|bottom|left))?(-(left|right))?(-(color|style|width|radius))?|border-(collapse|spacing)|(min-|max-)?(width|height)|float|clear|list-style-(type|position)|caption-side)$/

purify.addHook('afterSanitizeAttributes', (node) => {
  if (!(node instanceof HTMLElement) || !node.hasAttribute('style')) return
  for (const name of Array.from(node.style)) {
    if (!STYLE_PROPERTY.test(name)) node.style.removeProperty(name)
  }
  if (node.style.length === 0) node.removeAttribute('style')
})

const ALLOWED_DATA = new Set(['data-lms-kind', 'data-lms-ref'])

function sanitize(html: string, original: boolean): string {
  return purify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select'],
    FORBID_ATTR: original ? [] : ['style'],
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: [...ALLOWED_DATA],
  })
}

/**
 * Points marked images (`img[data-lms-kind]`) at the app's own address for them, keeping the
 * platform's address in `data-original-src` for `fallBackToOriginal`.
 */
function withImages(html: string, imageSrc: (link: InternalLink) => string | null): string {
  const template = document.createElement('template')
  template.innerHTML = html
  for (const img of template.content.querySelectorAll('img[data-lms-kind][data-lms-ref]')) {
    const src = imageSrc({
      kind: img.getAttribute('data-lms-kind') ?? '',
      ref: img.getAttribute('data-lms-ref') ?? '',
    })
    if (!src) continue
    const original = img.getAttribute('src')
    if (original && /^https?:/i.test(original)) img.setAttribute('data-original-src', original)
    img.setAttribute('src', src)
  }
  return template.innerHTML
}

/**
 * An image the app can't load (a file of another course, one the user's token can't read) goes
 * back to the platform's own address, which a browser signed in to the platform may still load.
 * `error` doesn't bubble and React doesn't see nodes set as HTML, so this listens in the capture
 * phase on the container.
 */
function fallBackToOriginal(node: HTMLDivElement | null) {
  if (!node) return
  const onError = (event: Event) => {
    const img = event.target
    if (!(img instanceof HTMLImageElement)) return
    const original = img.dataset.originalSrc
    if (!original) return
    img.removeAttribute('data-original-src')
    img.src = original
  }
  node.addEventListener('error', onError, true)
  return () => node.removeEventListener('error', onError, true)
}

const SIMPLIFIED = cn(
  'min-w-0 text-sm leading-relaxed break-words',
  '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2',
  '[&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6',
  '[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:font-heading [&_h1]:text-xl [&_h1]:font-semibold',
  '[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:font-heading [&_h2]:text-lg [&_h2]:font-semibold',
  '[&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:font-semibold [&_h4]:mt-3 [&_h4]:font-semibold',
  '[&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground',
  '[&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_code]:font-mono',
  '[&_hr]:my-4 [&_img]:h-auto [&_img]:max-w-full',
  '[&_table]:my-3 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto',
  '[&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left',
  '[&>:first-child]:mt-0 [&>:last-child]:mb-0',
)

/**
 * HTML from outside the app (LMS pages, announcements, syllabi), cleaned once more in the browser
 * although the backend already did (M00, M16 §4). By default it takes the app's typography and
 * drops inline styles; `original` keeps the safe inline styles on a light sheet with the
 * platform's base typography (`safe-html.css`), in the dark theme too, since the author's colors
 * assume a light page. Images load lazily, wide tables scroll sideways, links open in a new tab; `onInternalLink` takes over links into the platform that the
 * app can open itself, and `imageSrc` loads marked images from the app (a platform file whose own
 * address needs a platform session), falling back to their own address when that fails.
 */
export function SafeHtml({
  html,
  onInternalLink,
  imageSrc,
  original = false,
  className,
}: {
  html: string
  original?: boolean
  onInternalLink?: (link: InternalLink) => boolean | void
  imageSrc?: (link: InternalLink) => string | null
  className?: string
}) {
  const clean = sanitize(html, original)
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!onInternalLink || event.defaultPrevented || event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const anchor = (event.target as Element).closest('a[data-lms-kind]')
    const kind = anchor?.getAttribute('data-lms-kind')
    const ref = anchor?.getAttribute('data-lms-ref')
    if (!kind || !ref) return
    if (onInternalLink({ kind, ref }) !== false) event.preventDefault()
  }
  return (
    // Clicks on the links inside are delegated here; the links themselves stay focusable.
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      className={cn(
        original
          ? 'lms-original min-w-0 overflow-x-auto rounded-2xl border p-6 break-words'
          : SIMPLIFIED,
        className,
      )}
      onClick={onClick}
      ref={imageSrc ? fallBackToOriginal : undefined}
      // oxlint-disable-next-line react/no-danger -- sanitized just above
      dangerouslySetInnerHTML={{ __html: imageSrc ? withImages(clean, imageSrc) : clean }}
    />
  )
}
