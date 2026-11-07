import type { PageProps } from '@/app/extensions'
import { CardGrid } from '@/app/host/CardGrid'
import { useExtensions } from '@/app/registry'
import { TODAY_BANNERS, type TodayBanner } from '../types'

/**
 * The Program's "today" page (M04 §5.1): other modules' prompts (`schedule.todayBanners`), then
 * the `today` board. Its date and term week are the page header's subtitle (`TodaySubtitle`).
 * Phones show `mobile/TodayAgenda` instead (M17).
 */
export default function TodayPage({ scope }: PageProps) {
  const banners = useExtensions<TodayBanner>(TODAY_BANNERS)
  return (
    <div className="flex flex-col gap-4">
      {banners.map((banner) => (
        <banner.component key={banner.id} programId={scope.programId} />
      ))}
      <CardGrid scope={scope} board="today" />
    </div>
  )
}
