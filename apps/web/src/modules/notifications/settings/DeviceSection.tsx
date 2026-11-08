import { notificationsTestSendMutation } from '@semestra/api-client/react-query'
import { useMutation } from '@tanstack/react-query'
import { Send, Smartphone, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { SettingRow, SettingsGroup, SettingsNote } from '@/app/settings'
import { deviceLabel } from '@/lib/device'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Alert, AlertDescription, AlertTitle } from '@/ui/alert'
import { Button } from '@/ui/button'
import { Spinner } from '@/ui/spinner'
import { Switch } from '@/ui/switch'
import { disableDevice, enableDevice, useDeviceState } from '../push'

/** Settings → Notifications → This device (M18 §7): whether this browser gets anything. */
export default function DeviceSection() {
  const state = useDeviceState()
  // The value being switched to while the browser subscribes or unsubscribes; the switch shows
  // it at once so nothing else in the row moves.
  const [pending, setPending] = useState<boolean | null>(null)
  const test = useMutation({
    ...notificationsTestSendMutation(),
    onSuccess: (result) => {
      if (result.delivered === 0) toast.error(m.notifications_test_failed())
    },
    onError: toastError,
  })

  // Called from the switch's change, so the permission prompt has its user gesture.
  const toggle = async (checked: boolean) => {
    setPending(checked)
    try {
      await (checked ? enableDevice() : disableDevice())
    } catch (err) {
      toastError(err)
    }
    setPending(null)
  }

  if (state === 'unsupported') return <SettingsNote>{m.notifications_unsupported()}</SettingsNote>
  if (state === 'blocked' || state === 'install') {
    const blocked = state === 'blocked'
    return (
      <Alert>
        {blocked ? <TriangleAlert aria-hidden /> : <Smartphone aria-hidden />}
        <AlertTitle>
          {blocked ? m.notifications_blocked_title() : m.notifications_install_title()}
        </AlertTitle>
        <AlertDescription>
          {blocked ? m.notifications_blocked_description() : m.notifications_install_description()}
        </AlertDescription>
      </Alert>
    )
  }
  const on = state === 'on'
  const settling = pending !== null || state === 'checking'
  return (
    <SettingsGroup>
      <SettingRow label={deviceLabel(navigator.userAgent) ?? m.notifications_this_device()}>
        {(labelId) => (
          <div className="flex items-center gap-3">
            {/* Always there, so turning the device on or off keeps the row's height. */}
            <Button
              variant="outline"
              size="sm"
              disabled={!on || settling || test.isPending}
              onClick={() => test.mutate({})}
            >
              {test.isPending ? <Spinner /> : <Send aria-hidden />}
              {m.notifications_test()}
            </Button>
            <Switch
              aria-labelledby={labelId}
              checked={pending ?? on}
              disabled={settling}
              onCheckedChange={(checked) => void toggle(checked)}
            />
          </div>
        )}
      </SettingRow>
    </SettingsGroup>
  )
}
