import { useRouterState } from '@tanstack/react-router'
import { Suspense, useEffect, useEffectEvent } from 'react'
import { m } from '@/paraglide/messages'
import { Dialog, DialogContent, DialogTitle } from '@/ui/dialog'
import { Spinner } from '@/ui/spinner'
import { useHostAction } from '../commands'
import { type SettingsLevel, preload, preloadable } from '../extensions'
import { useModules } from '../registry'
import { buildNavigation } from './groups'
import type { Params } from './SettingsBody'
import { type SettingsTarget, useSettingsDialog } from './use-settings-dialog'

// The groups and their forms are not part of the first load: they load once the app is idle
// (see `whenIdle`), or when settings open before that.
const SettingsBody = preloadable<{ target: SettingsTarget; page: Params }>(() =>
  import('./SettingsBody').then((mod) => ({ default: mod.SettingsBody })),
)

const LEVELS: readonly SettingsLevel[] = ['account', 'program', 'term', 'course']
/** Longest wait for an idle moment before preloading anyway. */
const IDLE_TIMEOUT_MS = 5000
/** Where `requestIdleCallback` is missing (older Safari): a plain delay after start. */
const FALLBACK_DELAY_MS = 2000

/** Runs `task` when the browser is idle; returns a cancel function. */
function whenIdle(task: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(task, { timeout: IDLE_TIMEOUT_MS })
    return () => cancelIdleCallback(id)
  }
  const timer = setTimeout(task, FALLBACK_DELAY_MS)
  return () => clearTimeout(timer)
}

/**
 * Settings as a dialog (M11 §5.2), shaped like shadcn's "sidebar in a dialog": the level path and
 * the groups on the left, the sections of the chosen group on the right. Account, Program, term
 * and course settings share it; `?settings=` names the level and `&scope=` its Program, term or
 * course, which otherwise comes from the page.
 */
export function SettingsDialog() {
  const { target, open, close } = useSettingsDialog()
  // The dialog sits above the pages, so the page's scope comes from the deepest match.
  const params = useRouterState({ select: (state) => state.matches.at(-1)?.params ?? {} }) as Params

  // "Manage plugins" in the command palette opens the plugin group of the account settings.
  useHostAction('settings.plugins', () => open({ level: 'account', group: 'plugins' }))

  // Once idle: the dialog itself, and the group each level opens on, so the first opening shows
  // its forms at once instead of an empty pane that then fills in.
  const modules = useModules()
  const preloadSettings = useEffectEvent(() => {
    void preload(SettingsBody)
    const sections = modules.flatMap((module) => module.settingsSections ?? [])
    for (const level of LEVELS) {
      for (const section of buildNavigation(sections, level)[0]?.sections ?? []) {
        void preload(section.component)
      }
    }
  })
  useEffect(() => whenIdle(preloadSettings), [])

  return (
    <Dialog open={target !== undefined} onOpenChange={(next) => !next && close()}>
      {target ? (
        <DialogContent
          // Focus the level being edited, not the first node of the path; while the path is still
          // loading, the dialog itself (no focus ring on a level that is not the current one).
          initialFocus={() =>
            document.querySelector<HTMLElement>('[data-settings-level-current]') ??
            document.querySelector<HTMLElement>('[data-slot="dialog-content"]') ??
            true
          }
          className="gap-0 overflow-hidden p-0 h-[min(46rem,calc(100svh-2rem))] md:w-[72rem] md:max-w-[calc(100%-2rem)]"
          showCloseButton
        >
          <Suspense
            fallback={
              <div className="flex flex-1 items-center justify-center">
                <DialogTitle className="sr-only">{m.settings_title()}</DialogTitle>
                <Spinner />
              </div>
            }
          >
            <SettingsBody target={target} page={params} />
          </Suspense>
        </DialogContent>
      ) : null}
    </Dialog>
  )
}
