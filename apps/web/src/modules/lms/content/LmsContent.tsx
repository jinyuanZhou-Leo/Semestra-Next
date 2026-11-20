import { ArrowLeft, ExternalLink, type LucideIcon, Palette, Type } from 'lucide-react'
import type { ReactNode } from 'react'
import { type InternalLink, SafeHtml } from '@/components/SafeHtml'
import { IconAction } from '@/components/IconAction'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { type LmsDisplay, useLmsContent } from './context'
import { fileContentUrl } from './file-url'

/**
 * The header of LMS content (an announcement, a view of the Canvas tab): the title (and a line
 * under it) on the left; on the right the quiet controls as icon buttons (display, "Open in …")
 * and at most one primary action last, so every header reads the same way.
 */
export function ViewHeader({
  title,
  meta,
  tools,
  primary,
  withDisplay,
  webUrl,
}: {
  title: string
  meta?: ReactNode
  /** Icon buttons before the display menu. */
  tools?: ReactNode
  /** The one main action (`Button` default variant or `AiAction`). */
  primary?: ReactNode
  /** The item has HTML: show the display menu. */
  withDisplay?: boolean
  webUrl?: string | null
}) {
  return (
    <div className="flex min-h-9 flex-wrap items-start justify-between gap-x-3 gap-y-2">
      {/* The title wraps before the buttons do: they move under it only when it can't keep 15rem. */}
      <div className="min-w-0 flex-1 basis-60">
        <h2 className="font-heading text-lg font-semibold">{title}</h2>
        {meta ? <p className="text-sm text-muted-foreground">{meta}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {tools}
        {withDisplay ? <DisplayMenu /> : null}
        {webUrl ? <OpenOnPlatformIcon href={webUrl} /> : null}
        {primary ? <div className="ml-2">{primary}</div> : null}
      </div>
    </div>
  )
}

/** The header of an item opened from a list: back to the list, then the item. */
export function DetailHeader({
  onBack,
  backLabel,
  ...header
}: Parameters<typeof ViewHeader>[0] & { onBack: () => void; backLabel?: string }) {
  return (
    <div className="space-y-2">
      <Button variant="ghost" size="sm" className="-ml-2" onClick={onBack}>
        <ArrowLeft aria-hidden />
        {backLabel ?? m.lms_back()}
      </Button>
      <ViewHeader {...header} />
    </div>
  )
}

const DISPLAY_ICONS: Record<LmsDisplay, LucideIcon> = { simplified: Type, original: Palette }

function displayName(display: LmsDisplay, provider: string): string {
  return display === 'simplified'
    ? m.lms_display_simplified()
    : m.lms_display_original({ provider })
}

/** Switches how the HTML is shown while it is open. */
export function DisplayMenu() {
  const { display, setDisplay, provider } = useLmsContent()
  const Icon = DISPLAY_ICONS[display]
  const label = `${m.lms_display()}: ${displayName(display, provider)}`
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon-sm" aria-label={label} />}
            />
          }
        >
          <Icon aria-hidden />
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{m.lms_display()}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={display}
            onValueChange={(value) => setDisplay(value as LmsDisplay)}
          >
            {(['simplified', 'original'] as const).map((d) => {
              const ItemIcon = DISPLAY_ICONS[d]
              return (
                <DropdownMenuRadioItem key={d} value={d}>
                  <ItemIcon aria-hidden />
                  {displayName(d, provider)}
                </DropdownMenuRadioItem>
              )
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * LMS HTML in the chosen display. Platform links go where the content says (`openLink`); images
 * of course files load through the file proxy, since their own address needs a platform session
 * (M09 §2.1); when that fails (another course's file) `SafeHtml` goes back to the platform's.
 */
export function LmsHtml({ html }: { html: string }) {
  const { display, openLink, courseId } = useLmsContent()
  return (
    <SafeHtml
      html={html}
      original={display === 'original'}
      onInternalLink={openLink}
      imageSrc={(link: InternalLink) =>
        link.kind === 'file' ? fileContentUrl(courseId, link.ref) : null
      }
    />
  )
}

export function OpenOnPlatformIcon({ href }: { href: string }) {
  const { provider } = useLmsContent()
  return (
    <IconAction
      label={m.lms_open_in({ provider })}
      className="shrink-0"
      nativeButton={false}
      // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- labelled by `label`
      render={<a href={href} target="_blank" rel="noopener noreferrer" />}
    >
      <ExternalLink aria-hidden />
    </IconAction>
  )
}
