import { type MouseEvent, type ReactNode, useId, useState } from 'react'
import { useUiPref } from '@/app/ui-pref'
import { useDialogTarget } from '@/lib/dialog-target'
import { m } from '@/paraglide/messages'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/ui/alert-dialog'
import { Checkbox } from '@/ui/checkbox'
import { Field, FieldLabel } from '@/ui/field'

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function openInNewTab(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer')
}

/**
 * Opens a link to another site in a new tab, after "Open an external site?" unless the user chose
 * to trust the site (M00 §4.8). Every link whose address someone wrote (a link saved in course
 * files, the course website, a course's tools, links in a teacher's text) opens through it, so
 * they all behave alike; the app's own "Open in …" buttons do not. Render `dialog` once; call
 * `open(url)` from any link, or `onClick` on an `<a href>` (it keeps the address for copying).
 */
export function useExternalLink(): {
  open: (url: string) => void
  onClick: (event: MouseEvent<HTMLAnchorElement>) => void
  dialog: ReactNode
} {
  const id = useId()
  // Named after the files module, where it began: kept so the sites users already trust count.
  const [trusted, setTrusted] = useUiPref<string[]>('files.trusted_domains', [])
  const pending = useDialogTarget<string>()
  const [remember, setRemember] = useState(false)
  const shown = pending.target ?? ''
  const host = hostOf(shown)

  const open = (url: string) => {
    if (trusted.includes(hostOf(url))) openInNewTab(url)
    else {
      setRemember(false)
      pending.show(url)
    }
  }
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    open(event.currentTarget.href)
  }
  const confirm = () => {
    if (!pending.target) return
    const site = hostOf(pending.target)
    if (remember && !trusted.includes(site)) setTrusted([...trusted, site])
    openInNewTab(pending.target)
    pending.close()
  }

  const dialog = (
    <AlertDialog {...pending.props}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{m.link_leave_title()}</AlertDialogTitle>
          <AlertDialogDescription className="break-all">
            {m.link_leave_description({ url: shown })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Field orientation="horizontal">
          <Checkbox id={`${id}-trust`} checked={remember} onCheckedChange={setRemember} />
          <FieldLabel htmlFor={`${id}-trust`} className="font-normal">
            {m.link_trust_site({ host })}
          </FieldLabel>
        </Field>
        <AlertDialogFooter>
          <AlertDialogCancel>{m.common_cancel()}</AlertDialogCancel>
          <AlertDialogAction onClick={confirm}>{m.link_open()}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
  return { open, onClick, dialog }
}
