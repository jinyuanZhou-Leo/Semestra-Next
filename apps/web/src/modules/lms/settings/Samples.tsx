// SAMPLE ONLY (not for merge): visual samples of the LMS settings redesign with fixed data.
import { createColumnHelper } from '@tanstack/react-table'
import { ArrowRight, ChevronDown, ExternalLink, Lightbulb, Link2, Link2Off, RefreshCw, Settings2, Unplug } from 'lucide-react'
import type { SettingsSectionProps } from '@/app/extensions'
import {
  RowMenu,
  SectionAction,
  SettingRow,
  SettingsBlock,
  SettingsGroup,
  SettingsTable,
  settingsTableFeatures,
} from '@/app/settings'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/ui/alert'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import {
  Combobox,
  ComboboxContent,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxSeparator,
  ComboboxTrigger,
} from '@/ui/combobox'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/ui/dropdown-menu'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/ui/item'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { useProviderUis } from '../providers'
import { LogoTile } from './ConnectionsSection'

function useCanvasLogo() {
  return useProviderUis().get('canvas')?.logo ?? Link2
}

/* ---------- Program → LMS → 连接 ---------- */

export function ProgramConnectionSample(_: SettingsSectionProps) {
  const Logo = useCanvasLogo()
  return (
    <SettingsGroup>
      <Item>
        <ItemMedia>
          <LogoTile logo={Logo} />
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle>Demo Canvas</ItemTitle>
          <ItemDescription className="truncate">Canvas · q.utoronto.ca</ItemDescription>
        </ItemContent>
        <ItemActions className="shrink-0 gap-3">
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary">正常</Badge>3 分钟前同步
          </span>
          <RowMenu label="连接操作">
            <DropdownMenuItem>
              <RefreshCw aria-hidden />
              立即同步
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Settings2 aria-hidden />
              管理 LMS 连接
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled>
              <Unplug aria-hidden />
              <span className="flex flex-col">
                <span>更换连接…</span>
                <span className="text-xs text-muted-foreground">先解除 5 门课程的关联</span>
              </span>
            </DropdownMenuItem>
          </RowMenu>
        </ItemActions>
      </Item>
    </SettingsGroup>
  )
}

/* ---------- Program → LMS → 课程关联 ---------- */

type Row = {
  id: string
  code: string
  name: string
  color: string
  linked?: { code: string; name: string; problem?: string }
  suggested?: { code: string; term: string }
}

const ROWS: Row[] = [
  {
    id: '1',
    code: 'ECE201H1',
    name: 'Electrical Circuits',
    color: 'var(--chart-1)',
    linked: { code: 'ECE201H1', name: 'Electrical Circuits' },
  },
  {
    id: '2',
    code: 'ECE212H1',
    name: 'Circuit Analysis',
    color: 'var(--chart-2)',
    linked: { code: 'ECE212H1', name: 'Circuit Analysis' },
  },
  {
    id: '3',
    code: 'ECE231H1',
    name: 'Introductory Electronics',
    color: 'var(--chart-3)',
    linked: { code: 'ECE231H1', name: 'Introductory Electronics', problem: '同步出错' },
  },
  {
    id: '4',
    code: 'ECE243H1',
    name: 'Computer Organization',
    color: 'var(--chart-4)',
    linked: { code: 'ECE243H1', name: 'Computer Organization' },
  },
  {
    id: '5',
    code: 'MAT290H1',
    name: 'Advanced Engineering Mathematics',
    color: 'var(--chart-5)',
    linked: { code: 'MAT290H1', name: 'Advanced Engineering Mathematics' },
  },
  {
    id: '6',
    code: 'ECE110H1',
    name: 'Electrical Fundamentals',
    color: 'var(--chart-1)',
    suggested: { code: 'ECE110H1', term: 'Winter term' },
  },
  {
    id: '7',
    code: 'ECE244H1',
    name: 'Programming Fundamentals',
    color: 'var(--chart-2)',
    suggested: { code: 'ECE244H1', term: 'Fall term' },
  },
  { id: '8', code: 'APS112H1', name: 'Engineering Strategies & Practice II', color: 'var(--chart-3)' },
]

const col = createColumnHelper<typeof settingsTableFeatures, Row>()

const COLUMNS = [
  col.display({
    id: 'course',
    header: '课程',
    cell: ({ row: { original: r } }) => (
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="size-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
        <div className="min-w-0">
          <div className="truncate font-medium">{r.code}</div>
          <div className="truncate text-xs text-muted-foreground">{r.name}</div>
        </div>
      </div>
    ),
  }),
  col.display({
    id: 'lms',
    header: 'Canvas 课程',
    cell: ({ row: { original: r } }) => <LmsCell row={r} />,
  }),
  col.display({
    id: 'action',
    header: () => <span className="sr-only">关联</span>,
    cell: ({ row: { original: r } }) =>
      r.linked ? null : (
        <Button size="sm" variant="outline" className="w-20">
          {r.suggested ? '关联' : '选择…'}
        </Button>
      ),
  }),
  col.display({
    id: 'menu',
    header: () => <span className="sr-only">操作</span>,
    cell: ({ row: { original: r } }) =>
      r.linked ? (
        <RowMenu label={`${r.code} 的操作`}>
          <DropdownMenuItem>
            <RefreshCw aria-hidden />
            立即同步
          </DropdownMenuItem>
          <DropdownMenuItem>
            <ExternalLink aria-hidden />
            在 Canvas 中打开
          </DropdownMenuItem>
          <DropdownMenuItem>
            <Link2 aria-hidden />
            更换课程…
          </DropdownMenuItem>
          <DropdownMenuItem>
            <Settings2 aria-hidden />
            课程的 LMS 设置
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive">
            <Link2Off aria-hidden />
            解除关联…
          </DropdownMenuItem>
        </RowMenu>
      ) : r.suggested ? (
        <RowMenu label={`${r.code} 的操作`}>
          <DropdownMenuItem>
            <Link2 aria-hidden />
            选择其他课程…
          </DropdownMenuItem>
        </RowMenu>
      ) : null,
  }),
]

function LmsCell({ row: r }: { row: Row }) {
  if (r.linked) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0">
          <div className="truncate">
            {r.linked.code} · {r.linked.name}
          </div>
          <div className="truncate text-xs text-muted-foreground">Fall term</div>
        </div>
        {r.linked.problem ? (
          <Badge variant="destructive" className="shrink-0">
            {r.linked.problem}
          </Badge>
        ) : null}
      </div>
    )
  }
  if (r.suggested) {
    return (
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-muted-foreground">{r.suggested.code}</span>
          <Badge variant="secondary" className="shrink-0">
            建议
          </Badge>
        </div>
        <div className="truncate text-xs text-muted-foreground">{r.suggested.term}</div>
      </div>
    )
  }
  return <span className="text-muted-foreground">未关联</span>
}

const LINKED_COLUMNS = [
  COLUMNS[0],
  col.display({
    id: 'lms',
    header: 'Canvas 课程',
    cell: ({ row: { original: r } }) => (
      <div className="min-w-0">
        <div className="truncate">{r.linked?.name}</div>
        <div className="truncate text-xs text-muted-foreground">
          {r.linked?.code} · Fall term
        </div>
      </div>
    ),
  }),
  col.display({
    id: 'status',
    header: '同步',
    cell: ({ row: { original: r } }) =>
      r.linked?.problem ? (
        <Badge variant="destructive">{r.linked.problem}</Badge>
      ) : (
        <span className="text-xs text-muted-foreground">3 分钟前</span>
      ),
  }),
  COLUMNS[COLUMNS.length - 1],
]

export function ProgramCoursesSample(_: SettingsSectionProps) {
  const unlinked = ROWS.filter((r) => !r.linked)
  return (
    <div className="space-y-6">
      <SettingsBlock title={`未关联 · ${unlinked.length}`}>
        <Alert>
          <Lightbulb aria-hidden />
          <AlertTitle>2 门课程在 Canvas 上有代码相同的课程</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 space-y-1">
              {unlinked
                .filter((r) => r.suggested)
                .map((r) => (
                  <li key={r.id} className="flex items-center gap-2">
                    <span className="text-foreground">{r.code}</span>
                    <ArrowRight aria-hidden className="size-3.5" />
                    <span>
                      {r.suggested?.code} · {r.name}（{r.suggested?.term}）
                    </span>
                  </li>
                ))}
            </ul>
          </AlertDescription>
          <AlertAction>
            <Button size="sm">全部关联</Button>
          </AlertAction>
        </Alert>
        <SettingsGroup>
          {unlinked.map((r) => (
            <Item key={r.id}>
              <ItemMedia>
                <span className="size-2.5 rounded-full" style={{ background: r.color }} />
              </ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle>
                  {r.code}
                  <span className="truncate font-normal text-muted-foreground">{r.name}</span>
                </ItemTitle>
              </ItemContent>
              <ItemActions>
                <Button variant="outline" className="w-56 justify-between font-normal">
                  <span className="text-muted-foreground">选择课程</span>
                  <ChevronDown aria-hidden className="text-muted-foreground" />
                </Button>
              </ItemActions>
            </Item>
          ))}
        </SettingsGroup>
      </SettingsBlock>
      <SettingsBlock title="已关联 · 5">
        <SettingsTable
          label="已关联的课程"
          data={ROWS.filter((r) => r.linked)}
          columns={LINKED_COLUMNS}
          getRowId={(r) => r.id}
          fill="lms"
          columnClassName={{ course: 'w-56 max-w-56', status: 'w-28', menu: 'w-10' }}
        />
      </SettingsBlock>
    </div>
  )
}

/* ---------- Course → LMS (not linked yet) ---------- */

export function CourseSuggestionSample({ open = false }: SettingsSectionProps & { open?: boolean }) {
  return (
    <div className="space-y-3">
      <SettingsGroup>
        <SettingRow label="Canvas 课程" description="未关联。从“Demo Canvas”里选择本课程对应的课程。">
          <SamplePicker open={open} />
        </SettingRow>
      </SettingsGroup>
      <Alert>
        <Lightbulb aria-hidden />
        <AlertTitle>可能是 Canvas 上的 ECE110H1 · Electrical Fundamentals</AlertTitle>
        <AlertDescription>Winter term · 课程代码与本课程一致</AlertDescription>
        <AlertAction>
          <Button size="sm">关联</Button>
        </AlertAction>
      </Alert>
    </div>
  )
}

const OPTIONS = {
  suggested: [{ code: 'ECE110H1', sub: 'Electrical Fundamentals · Winter term' }],
  fall: [{ code: 'APS100H1', sub: 'Orientation to Engineering' }],
  taken: [
    { code: 'ECE201H1', sub: '已关联到 ECE201H1' },
    { code: 'ECE212H1', sub: '已关联到 ECE212H1' },
    { code: 'ECE231H1', sub: '已关联到 ECE231H1' },
  ],
}

function SamplePicker({ open }: { open: boolean }) {
  return (
    <Combobox items={[]} value={null} open={open}>
      <ComboboxTrigger
        render={<Button variant="outline" className="w-72 justify-between font-normal" />}
      >
        <span className="truncate text-muted-foreground">选择课程</span>
      </ComboboxTrigger>
      <ComboboxContent align="end" className="w-96">
        <ComboboxInput showTrigger={false} placeholder="搜索课程代码或名称" />
        <ComboboxList>
          <ComboboxGroup>
            <ComboboxLabel>建议</ComboboxLabel>
            {OPTIONS.suggested.map((o) => (
              <Opt key={o.code} {...o} />
            ))}
          </ComboboxGroup>
          <ComboboxGroup>
            <ComboboxSeparator />
            <ComboboxLabel>Fall term</ComboboxLabel>
            {OPTIONS.fall.map((o) => (
              <Opt key={o.code} {...o} />
            ))}
          </ComboboxGroup>
          <ComboboxGroup>
            <ComboboxSeparator />
            <ComboboxLabel>已关联其他课程</ComboboxLabel>
            {OPTIONS.taken.map((o) => (
              <Opt key={o.code} {...o} disabled />
            ))}
          </ComboboxGroup>
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

function Opt({ code, sub, disabled }: { code: string; sub: string; disabled?: boolean }) {
  return (
    <ComboboxItem value={code} disabled={disabled}>
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{code}</span>
        <span className="truncate text-xs text-muted-foreground">{sub}</span>
      </span>
    </ComboboxItem>
  )
}

/* ---------- Course → LMS when the Program has no connection, one exists ---------- */

export function CourseUnboundSample(_: SettingsSectionProps) {
  const Logo = useCanvasLogo()
  return (
    <SettingsGroup>
      <Item>
        <ItemMedia>
          <LogoTile logo={Logo} />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>Demo Canvas</ItemTitle>
          <ItemDescription>本 Program 还没有选择 LMS 连接。</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Tooltip>
            <TooltipTrigger render={<Button size="sm" />}>用于本 Program</TooltipTrigger>
            <TooltipContent>Program 的其他课程也将从这个连接关联</TooltipContent>
          </Tooltip>
        </ItemActions>
      </Item>
    </SettingsGroup>
  )
}
