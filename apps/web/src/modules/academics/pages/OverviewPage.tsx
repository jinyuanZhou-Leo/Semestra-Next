import type { PageProps } from '@/app/extensions'
import { CardGrid } from '@/app/host/CardGrid'

/** The default page of a Program, term or course: its cards (M02 §5.2, §5.4, §5.5). */
export default function OverviewPage({ scope }: PageProps) {
  return <CardGrid scope={scope} />
}
