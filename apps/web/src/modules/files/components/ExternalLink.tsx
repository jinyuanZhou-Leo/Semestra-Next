import { type ReactNode, useId, useState } from 'react'
import { useUiPref } from '@/app/ui-pref'
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
  const [pending, setPending] = useState<string | null>(null)
  const [remember, setRemember] = useState(false)
  const host = pending ? hostOf(pending) : ''

  const open = (url: string) => {
    if (trusted.includes(hostOf(url))) openInNewTab(url)
    else {
      setRemember(false)
      setPending(url)
    }
  }
  const confirm = () => {
    if (!pending) return
    if (remember && !trusted.includes(host)) setTrusted([...trusted, host])
    openInNewTab(pending)
    setPending(null)
  }

  const dialog = (
    <AlertDialog open={pending !== null} onOpenChange={(next) => !next && setPending(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{m.files_link_leave_title()}</AlertDialogTitle>
          <AlertDialogDescription className="break-all">
            {m.files_link_leave_description({ url: pending ?? '' })}
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
