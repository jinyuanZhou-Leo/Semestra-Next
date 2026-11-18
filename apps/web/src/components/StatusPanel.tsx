import { Link } from '@tanstack/react-router'
import { ChevronRight, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/ui/collapsible'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/ui/item'
import { Spinner } from '@/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'

/*
 * The parts the status bar's panels are made of (M10 §5.6): the LMS sync panel and the files
 * panel look and behave alike. Each panel lays them out itself.
 */

/** A small muted section heading with an optional count. */
export function PanelHeading({ count, children }: { count?: number; children: ReactNode }) {
  return (
    <h3 className="flex items-center gap-1.5 px-2 pt-1 text-xs font-medium text-muted-foreground">
      {children}
      {count ? <span className="tabular-nums text-muted-foreground/70">{count}</span> : null}
    </h3>
  )
}

/** An icon button with a tooltip. */
export function PanelIconAction({
  label,
  disabled,
  onClick,
  className,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  className?: string
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
            className={cn('text-muted-foreground', className)}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * One row of the panel: an icon, the title, the course (color dot + code) and a detail, and on the
 * right either the time or the row's actions. A row with `href`/`onOpen` opens on click.
 */
export function PanelRow({
  icon: Icon,
  spin = false,
  tone,
  title,
  course,
  color,
  detail,
  time,
  muted = false,
  href,
  onOpen,
  children,
}: {
  icon: LucideIcon
  /** A spinner in the icon's place: the row's work is running. */
  spin?: boolean
  tone?: 'error' | 'success'
  title: string
  course: string
  color: string | undefined
  detail?: ReactNode
  time?: string
  muted?: boolean
  href?: string
  onOpen?: () => void
  children?: ReactNode
}) {
  const clickable = href !== undefined || (onOpen !== undefined && children === undefined)
  const body = (
    <>
      <ItemMedia
        className={cn(
          'mt-0.5 flex size-7 items-center justify-center self-start rounded-lg bg-muted text-muted-foreground [&_svg]:size-3.5',
          tone === 'error' && 'bg-destructive/10 text-destructive',
          tone === 'success' && 'text-success',
        )}
      >
        {spin ? <Spinner aria-hidden /> : <Icon aria-hidden />}
      </ItemMedia>
      <ItemContent className="min-w-0 gap-0.5">
        <ItemTitle className="w-full">
          {href && children ? (
            // The row has its own buttons: the link is the title, stretched over the row.
            <Link
              to={href}
              onClick={onOpen}
              className={cn(
                'truncate outline-none after:absolute after:inset-0 after:rounded-lg',
                muted && 'text-muted-foreground line-through',
              )}
            >
              {title}
            </Link>
          ) : (
            <span className={cn('truncate', muted && 'text-muted-foreground line-through')}>
              {title}
            </span>
          )}
        </ItemTitle>
        <ItemDescription className="flex min-w-0 items-center gap-1.5 text-xs">
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full bg-muted-foreground"
            style={color ? { backgroundColor: color } : undefined}
          />
          <span className="shrink-0">{course}</span>
          {detail ? (
            <>
              <span aria-hidden>·</span>
              <span className="min-w-0 truncate">{detail}</span>
            </>
          ) : null}
        </ItemDescription>
      </ItemContent>
      {children || time ? (
        <ItemActions className="relative z-10 shrink-0 gap-1 self-center">
          {time ? (
            <span
              className={cn(
                'text-xs whitespace-nowrap text-muted-foreground tabular-nums',
                children &&
                  'transition-opacity group-focus-within/item:opacity-0 group-hover/item:opacity-0',
              )}
            >
              {time}
            </span>
          ) : null}
          {children ? (
            <div
              className={cn(
                'flex items-center gap-1',
                // In the time's place on hover or keyboard focus.
                time &&
                  'absolute right-0 opacity-0 transition-opacity group-focus-within/item:opacity-100 group-hover/item:opacity-100',
              )}
            >
              {children}
            </div>
          ) : null}
        </ItemActions>
      ) : null}
    </>
  )
  const className = cn('gap-3 rounded-lg px-2 py-2', clickable && 'hover:bg-muted/60')
  if (href && children) {
    return (
      <Item
        size="xs"
        className={cn(
          className,
          'relative has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring/50',
        )}
      >
        {body}
      </Item>
    )
  }
  if (href) {
    return (
      <Item size="xs" className={className} render={<Link to={href} onClick={onOpen} />}>
        {body}
      </Item>
    )
  }
  if (clickable) {
    return (
      <Item
        size="xs"
        className={cn(className, 'w-full text-left')}
        // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- `body` labels it
        render={<button type="button" onClick={onOpen} />}
      >
        {body}
      </Item>
    )
  }
  return (
    <Item size="xs" className={className}>
      {body}
    </Item>
  )
}

/** A folded list at the bottom of the panel ("Different from Canvas 1"). */
export function PanelMoreList({
  label,
  count,
  children,
}: {
  label: string
  count: number
  children: ReactNode
}) {
  return (
    <Collapsible className="flex flex-col">
      <CollapsibleTrigger
        render={
          <Button
            size="xs"
            variant="ghost"
            className="justify-start text-muted-foreground [&[data-panel-open]>svg:first-child]:rotate-90"
          />
        }
      >
        <ChevronRight aria-hidden className="transition-transform" />
        {label}
        <span className="tabular-nums text-muted-foreground/70">{count}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="-mx-2">
        <ItemGroup className="gap-0 has-data-[size=xs]:gap-0">{children}</ItemGroup>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** A row that folds away (200 ms, in height) once answered. */
export function PanelFold({ leaving, children }: { leaving: boolean; children: ReactNode }) {
  return (
    <div
      inert={leaving}
      className={cn(
        'grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none',
        leaving ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100',
      )}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}
