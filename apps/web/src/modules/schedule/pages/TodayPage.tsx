import type { PageProps } from '@/app/extensions'
import { CardGrid } from '@/app/host/CardGrid'

/**
 * The Program's "today" page (M04 §5.1): the `today` board. Its date and term week are the
 * page header's subtitle (`TodaySubtitle`). Phones show `mobile/TodayAgenda` instead (M17).
 */
export default function TodayPage({ scope }: PageProps) {
  return <CardGrid scope={scope} board="today" />
}
