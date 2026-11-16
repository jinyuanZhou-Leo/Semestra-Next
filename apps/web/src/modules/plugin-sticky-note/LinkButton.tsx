import type { Editor } from '@tiptap/react'
import { ExternalLink, Link2 } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'
import { Toggle } from '@/ui/toggle'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { openLink } from './links'

const withScheme = (url: string) => (/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`)

/**
 * Adds a link to the selection (or, with nothing selected, inserts the address as a link), and
 * edits, opens or removes the link under the cursor.
 */
export function LinkButton({ editor, active }: { editor: Editor; active: boolean }) {
  const [open, setOpen] = useState(false)
  const [href, setHref] = useState('')
  /** The link under the cursor when the popover opened. */
  const [current, setCurrent] = useState('')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const url = href.trim()
    const chain = editor.chain().focus()
    if (!url) chain.extendMarkRange('link').unsetLink().run()
    else if (active || !editor.state.selection.empty)
      chain
        .extendMarkRange('link')
        .setLink({ href: withScheme(url) })
        .run()
    else
      chain
        .insertContent({
          type: 'text',
          text: url,
          marks: [{ type: 'link', attrs: { href: withScheme(url) } }],
        })
        .unsetMark('link')
        .run()
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          const link = active
            ? ((editor.getAttributes('link').href as string | undefined) ?? '')
            : ''
          setCurrent(link)
          setHref(link)
        }
        setOpen(next)
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Toggle
                  size="sm"
                  aria-label={m.sticky_format_link()}
                  pressed={active}
                  onMouseDown={(event) => event.preventDefault()}
                  className="h-7 min-w-7 px-1.5"
                />
              }
            />
          }
        >
          <Link2 aria-hidden />
        </TooltipTrigger>
        <TooltipContent>{m.sticky_format_link()}</TooltipContent>
      </Tooltip>
      <PopoverContent side="top" className="w-80 p-2">
        <form onSubmit={submit} className="flex gap-1.5">
          <Input
            type="text"
            inputMode="url"
            value={href}
            placeholder="https://"
            aria-label={m.sticky_link_url()}
            onChange={(event) => setHref(event.target.value)}
            className="h-8"
          />
          {current ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={m.sticky_link_open()}
                    onClick={() => openLink(current)}
                  />
                }
              >
                <ExternalLink aria-hidden />
              </TooltipTrigger>
              <TooltipContent>{m.sticky_link_open()}</TooltipContent>
            </Tooltip>
          ) : null}
          {active && !href.trim() ? (
            <Button type="submit" size="sm" variant="destructive">
              {m.sticky_link_remove()}
            </Button>
          ) : (
            <Button type="submit" size="sm">
              {active ? m.sticky_link_save() : m.sticky_link_apply()}
            </Button>
          )}
        </form>
      </PopoverContent>
    </Popover>
  )
}
