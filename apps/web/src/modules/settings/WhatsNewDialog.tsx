import { Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useSettingsDialog } from '@/app/settings'
import { useMotionPreference } from '@/app/theme'
import { formatDate } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog'
import { ReleaseNotes } from './ReleaseNotes'
import type { Announcement } from './WhatsNew'

const CONFETTI_TOKENS = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5']

/**
 * The theme's chart colors as hex, which is what canvas-confetti takes. The tokens are oklch()
 * built from `var(--accent-hue)`, so each is resolved through an element's `color` and then
 * painted on a 1×1 canvas and read back.
 */
function themeColors(): string[] | undefined {
  const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  if (!context) return undefined
  const probe = document.createElement('span')
  document.body.append(probe)
  const colors = CONFETTI_TOKENS.map((token) => {
    probe.style.color = `var(${token})`
    context.clearRect(0, 0, 1, 1)
    context.fillStyle = getComputedStyle(probe).color
    context.fillRect(0, 0, 1, 1)
    const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
  })
  probe.remove()
  return colors
}

/**
 * A short burst from both sides. The app's motion setting wins; when it follows the system,
 * canvas-confetti skips the burst if the system asks for reduced motion.
 */
async function fireConfetti(motion: 'always' | 'never' | 'user', cancelled: () => boolean) {
  if (motion === 'always') return
  const { default: confetti } = await import('canvas-confetti')
  if (cancelled()) return
  const burst = {
    particleCount: 80,
    spread: 70,
    startVelocity: 50,
    ticks: 220,
    colors: themeColors(),
    // Above the dialog (z-50); the canvas never takes clicks.
    zIndex: 100,
    disableForReducedMotion: motion === 'user',
  }
  void confetti({ ...burst, angle: 60, origin: { x: 0, y: 0.7 } })
  void confetti({ ...burst, angle: 120, origin: { x: 1, y: 0.7 } })
}

/** Fires once, when the dialog opens. */
function useConfetti() {
  const motion = useMotionPreference()
  const [initialMotion] = useState(motion)
  useEffect(() => {
    let cancelled = false
    void fireConfetti(initialMotion, () => cancelled)
    return () => {
      cancelled = true
    }
  }, [initialMotion])
}

/** "What's new in Semestra 1.2": the notes of the versions this account has not seen. */
export default function WhatsNewDialog({
  announcement,
  onClose,
}: {
  announcement: Announcement
  onClose: () => void
}) {
  const settings = useSettingsDialog()
  const done = useRef<HTMLButtonElement>(null)
  useConfetti()
  const [latest] = announcement.releases
  if (!latest) return null
  const several = announcement.releases.length > 1
  const openAbout = () => {
    onClose()
    settings.open({ level: 'account', group: 'about' })
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        // "Got it", not the changelog link: Enter dismisses the dialog.
        initialFocus={done}
        className="flex max-h-[min(40rem,85vh)] flex-col gap-5 sm:max-w-lg"
      >
        <DialogHeader className="gap-2">
          <Badge variant="secondary">
            <Sparkles data-icon="inline-start" />
            {m.settings_whats_new_badge({ version: latest.version })}
          </Badge>
          <DialogTitle className="text-xl">
            {m.settings_whats_new_title({ version: latest.version.split('.', 2).join('.') })}
          </DialogTitle>
          <DialogDescription>
            {several
              ? m.settings_whats_new_several({ count: announcement.releases.length })
              : formatDate(latest.date)}
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-6 min-h-0 flex-1 space-y-6 overflow-y-auto px-6">
          {announcement.releases.map((release) => (
            <section key={release.version} className="space-y-3">
              {several ? (
                <h3 className="font-heading text-sm font-medium">
                  {release.version}
                  <span className="ml-2 font-normal text-muted-foreground">
                    {formatDate(release.date)}
                  </span>
                </h3>
              ) : null}
              <ReleaseNotes release={release} />
            </section>
          ))}
          {announcement.more > 0 ? (
            <p className="text-xs text-muted-foreground">
              {m.settings_whats_new_more({ count: announcement.more })}
            </p>
          ) : null}
        </div>
        <DialogFooter className="items-center border-t pt-4 sm:justify-between">
          <Button variant="link" className="px-0" onClick={openAbout}>
            {m.settings_whats_new_all()}
          </Button>
          <Button ref={done} onClick={onClose}>
            {m.settings_whats_new_close()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
