import { RotateCcw } from 'lucide-react'
import { useState } from 'react'
import type { CardProps } from '@/app/extensions'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { resetCounter } from './resetBus'
import type { CounterSettings } from './schema'

/** The counter's "reset" button in the card header (M14 §1), asking before it resets. */
export default function CounterHeaderActions({ instanceId, settings }: CardProps<CounterSettings>) {
  const [open, setOpen] = useState(false)
  const label = settings.label || m.counter_default_label()
  return (
    <>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={m.counter_reset()}
        title={m.counter_reset()}
        onClick={() => setOpen(true)}
        className="text-muted-foreground"
      >
        <RotateCcw aria-hidden />
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={m.counter_reset_title({ label })}
        description={m.counter_reset_description({ initial: settings.initial })}
        confirmLabel={m.counter_reset()}
        onConfirm={() => {
          resetCounter(instanceId)
          setOpen(false)
        }}
      />
    </>
  )
}
