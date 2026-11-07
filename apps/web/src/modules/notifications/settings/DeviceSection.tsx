import { notificationsTestSendMutation } from '@semestra/api-client/react-query'
import { useMutation } from '@tanstack/react-query'
import { BellOff, Send, Smartphone, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { RowMenu, SettingRow, SettingsGroup, SettingsNote } from '@/app/settings'
import { deviceLabel } from '@/lib/device'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Alert, AlertDescription, AlertTitle } from '@/ui/alert'
import { Button } from '@/ui/button'
import { DropdownMenuItem } from '@/ui/dropdown-menu'
import { Spinner } from '@/ui/spinner'
import { disableDevice, enableDevice, useDeviceState } from '../push'

/** Settings → Notifications → This device (M18 §7): whether this browser gets anything. */
export default function DeviceSection() {
  const state = useDeviceState()
  const [busy, setBusy] = useState(false)
  const test = useMutation({
    ...notificationsTestSendMutation(),
    onSuccess: (result) => {
      if (result.delivered === 0) toast.error(m.notifications_test_failed())
    },
    onError: toastError,
  })

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await action()
    } catch (err) {
      toastError(err)
    }
    setBusy(false)
  }

  if (state === 'unsupported') return <SettingsNote>{m.notifications_unsupported()}</SettingsNote>
  if (state === 'blocked') {
    return (
      <Alert>
        <TriangleAlert aria-hidden />
        <AlertTitle>{m.notifications_blocked_title()}</AlertTitle>
        <AlertDescription>{m.notifications_blocked_description()}</AlertDescription>
      </Alert>
    )
  }
  if (state === 'install') {
    return (
      <SettingsGroup>
        <SettingRow
          label={m.notifications_install_title()}
          description={m.notifications_install_description()}
        >
          <Smartphone aria-hidden className="size-5 text-muted-foreground" />
        </SettingRow>
      </SettingsGroup>
    )
  }
  const on = state === 'on'
  return (
    <SettingsGroup>
      <SettingRow
        label={deviceLabel(navigator.userAgent) ?? m.notifications_this_device()}
        description={on ? m.notifications_device_on() : m.notifications_device_off()}
      >
        {state === 'checking' ? (
          <Spinner />
        ) : on ? (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={test.isPending}
              onClick={() => test.mutate({})}
            >
              {test.isPending ? <Spinner /> : <Send aria-hidden />}
              {m.notifications_test()}
            </Button>
            <RowMenu label={m.notifications_device_menu()}>
              <DropdownMenuItem disabled={busy} onClick={() => void run(disableDevice)}>
                <BellOff aria-hidden />
                {m.notifications_turn_off()}
              </DropdownMenuItem>
            </RowMenu>
          </div>
        ) : (
          <Button size="sm" disabled={busy} onClick={() => void run(enableDevice)}>
            {busy ? <Spinner /> : null}
            {m.notifications_turn_on()}
          </Button>
        )}
      </SettingRow>
    </SettingsGroup>
  )
}
