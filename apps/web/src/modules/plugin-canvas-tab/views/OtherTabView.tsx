import { CircleHelp, Puzzle } from 'lucide-react'
import { m } from '@/paraglide/messages'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/ui/empty'
import type { NavEntry } from '../navigation'
import { OpenInCanvas } from './common'

/**
 * Tabs the app does not show itself: an external tool (LTI) only runs inside Canvas, and a tab
 * of a kind the app does not know is opened there too (M16 §3).
 */
export function OtherTabView({ entry }: { entry: NavEntry }) {
  const external = entry.kind === 'external'
  const url = entry.tab.web_url
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          {external ? <Puzzle aria-hidden /> : <CircleHelp aria-hidden />}
        </EmptyMedia>
        <EmptyTitle>{external ? entry.label : m.canvas_tab_unknown_title()}</EmptyTitle>
        <EmptyDescription>
          {external ? m.canvas_tab_external_description() : m.canvas_tab_unknown_description()}
        </EmptyDescription>
      </EmptyHeader>
      {url ? (
        <EmptyContent>
          <OpenInCanvas
            href={url}
            label={external ? m.canvas_tab_external_launch() : m.canvas_tab_open_in_canvas()}
          />
        </EmptyContent>
      ) : null}
    </Empty>
  )
}
