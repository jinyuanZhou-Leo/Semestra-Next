import { type ReactNode, useId, useState } from 'react'
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
 * Opens saved links in a new tab, after "You're leaving Semestra" unless the user chose to trust
 * the site (M07 §6.1). Render `dialog` once; call `open(url)` from any link.
 */
export function useExternalLink(): { open: (url: string) => void; dialog: ReactNode } {
  const id = useId()
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
          <AlertDialogTitle>{m.files_link_leave_title()}</AlertDialogTitle>
          <AlertDialogDescription className="break-all">
            {m.files_link_leave_description({ url: shown })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Field orientation="horizontal">
          <Checkbox id={`${id}-trust`} checked={remember} onCheckedChange={setRemember} />
          <FieldLabel htmlFor={`${id}-trust`} className="font-normal">
            {m.files_link_trust_domain({ host })}
          </FieldLabel>
        </Field>
        <AlertDialogFooter>
          <AlertDialogCancel>{m.common_cancel()}</AlertDialogCancel>
          <AlertDialogAction onClick={confirm}>{m.files_link_open()}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
  return { open, dialog }
}
