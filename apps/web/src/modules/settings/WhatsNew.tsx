import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation } from '@tanstack/react-router'
import { Suspense, useEffect, useState } from 'react'
import { preloadable } from '@/app/extensions'
import { readUiPref, updateUiPref, useUiPref } from '@/app/ui-pref'
import { TOUR_DONE_KEY } from '@/modules/academics/shell/Tour'
import {
  compareVersions,
  DIALOG_MAX_VERSIONS,
  LAST_SEEN_KEY,
  type Release,
  releasesBetween,
} from './release-notes'

const WhatsNewDialog = preloadable(() => import('./WhatsNewDialog'))

/** How long the app has been on screen before the dialog appears. */
const SHOW_DELAY_MS = 600

export type Announcement = { releases: Release[]; more: number }

/** Remembers `version` as seen, unless this account has already seen a newer one. */
export function markSeen(queryClient: QueryClient, version: string): Promise<void> {
  return updateUiPref<string>(queryClient, LAST_SEEN_KEY, (seen) =>
    seen && compareVersions(seen, version) >= 0 ? undefined : version,
  )
}

/**
 * The minor and major releases this account has not seen yet, newest first. Patch releases are
 * only listed on the About page. A new account (its tour still due) starts at this version without
 * being told what changed; an account from before this feature hears about everything so far.
 */
export async function pendingAnnouncement(
  queryClient: QueryClient,
  current: string,
): Promise<Announcement> {
  const [seen, tourDone] = await Promise.all([
    readUiPref<string>(queryClient, LAST_SEEN_KEY),
    readUiPref<boolean>(queryClient, TOUR_DONE_KEY),
  ])
  if (seen && compareVersions(seen, current) >= 0) return { releases: [], more: 0 }
  const releases =
    seen === undefined && tourDone === false
      ? []
      : (await releasesBetween(seen ?? '0.0.0', current)).filter((r) => r.level !== 'patch')
  if (releases.length === 0) await markSeen(queryClient, current)
  return {
    releases: releases.slice(0, DIALOG_MAX_VERSIONS),
    more: Math.max(0, releases.length - DIALOG_MAX_VERSIONS),
  }
}

/**
 * Shows "What's new" once per account the first time it opens a version with new features. Waits
 * for onboarding, the tour and the settings dialog to be out of the way.
 */
export function WhatsNew({ version = SEMESTRA_VERSION }: { version?: string }) {
  const queryClient = useQueryClient()
  const { pathname, searchStr } = useLocation()
  const [tourDone] = useUiPref<boolean | null>(TOUR_DONE_KEY, null)
  const onboarding = pathname.startsWith('/onboarding')
  const { data } = useQuery({
    queryKey: ['whats-new', version],
    queryFn: () => pendingAnnouncement(queryClient, version),
    enabled: !onboarding,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  })
  const [closed, setClosed] = useState(false)
  const [delayed, setDelayed] = useState(false)
  const ready =
    !closed &&
    !onboarding &&
    tourDone !== false &&
    !new URLSearchParams(searchStr).has('settings') &&
    (data?.releases.length ?? 0) > 0

  useEffect(() => {
    if (!ready) return
    const timer = setTimeout(() => setDelayed(true), SHOW_DELAY_MS)
    return () => clearTimeout(timer)
  }, [ready])

  if (!ready || !delayed || !data) return null
  const close = () => {
    setClosed(true)
    void markSeen(queryClient, version)
  }
  return (
    <Suspense fallback={null}>
      <WhatsNewDialog announcement={data} onClose={close} />
    </Suspense>
  )
}
