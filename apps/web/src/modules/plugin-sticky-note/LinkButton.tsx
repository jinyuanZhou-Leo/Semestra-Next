import type { Editor } from '@tiptap/react'
import { Link2 } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'
import { Toggle } from '@/ui/toggle'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'

/** Adds a link to the selection, or edits / removes the link under the cursor. */
export function LinkButton({ editor, active }: { editor: Editor; active: boolean }) {
  const [open, setOpen] = useState(false)
  const [href, setHref] = useState('')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const url = href.trim()
    const chain = editor.chain().focus().extendMarkRange('link')
    if (url) chain.setLink({ href: /^[a-z]+:/i.test(url) ? url : `https://${url}` }).run()
    else chain.unsetLink().run()
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setHref((editor.getAttributes('link').href as string | undefined) ?? '')
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
      <PopoverContent side="top" className="w-72 p-2">
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
          {active && !href.trim() ? (
            <Button type="submit" size="sm" variant="destructive">
              {m.sticky_link_remove()}
            </Button>
          ) : (
            <Button type="submit" size="sm">
              {m.sticky_link_apply()}
            </Button>
          )}
        </form>
      </PopoverContent>
    </Popover>
  )
}
