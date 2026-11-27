// SAMPLE ONLY (not for merge): visual samples of the LMS settings redesign with fixed data.
import { createColumnHelper } from '@tanstack/react-table'
import { ExternalLink, Link2, Link2Off, RefreshCw, Settings2, Unplug } from 'lucide-react'
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
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0 text-muted-foreground">
          <div className="truncate">{r.suggested.code}</div>
          <div className="truncate text-xs">建议 · {r.suggested.term}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <PickerButton label="其他…" ghost />
          <Button size="sm" variant="outline">
            关联
          </Button>
        </div>
      </div>
    )
  }
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">未关联</span>
      <PickerButton label="选择课程" />
    </div>
  )
}

function PickerButton({ label, ghost }: { label: string; ghost?: boolean }) {
  return (
    <Button size="sm" variant={ghost ? 'ghost' : 'outline'} className="font-normal">
      {label}
    </Button>
  )
}

export function ProgramCoursesSample(_: SettingsSectionProps) {
  return (
    <>
      <SectionAction>
        <div className="flex items-center gap-2">
          <Select defaultValue="all" items={[{ value: 'all', label: '全部学期' }]}>
            <SelectTrigger size="sm" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部学期</SelectItem>
              <SelectItem value="fall">Fall term</SelectItem>
              <SelectItem value="winter">Winter term</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm">关联 2 门建议的课程</Button>
        </div>
      </SectionAction>
      <SettingsTable
        label="课程关联"
        data={[...ROWS.filter((r) => !r.linked), ...ROWS.filter((r) => r.linked)]}
        columns={COLUMNS}
        getRowId={(r) => r.id}
        fill="lms"
        columnClassName={{ course: 'w-64 max-w-64', menu: 'w-10' }}
      />
    </>
  )
}

/* ---------- Course → LMS (not linked yet) ---------- */

export function CourseSuggestionSample({ open = false }: SettingsSectionProps & { open?: boolean }) {
  const Logo = useCanvasLogo()
  return (
    <div className="space-y-6">
      <SettingsBlock title="建议关联" description="代码与本课程一致。">
        <SettingsGroup>
          <Item>
            <ItemMedia>
              <LogoTile logo={Logo} />
            </ItemMedia>
            <ItemContent className="min-w-0">
              <ItemTitle>ECE110H1 · Electrical Fundamentals</ItemTitle>
              <ItemDescription>Winter term · Demo Canvas</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button size="sm">关联</Button>
            </ItemActions>
          </Item>
          <SettingRow label="不是这门课？" description="从“Demo Canvas”里选择其他课程。">
            <SamplePicker open={open} />
          </SettingRow>
        </SettingsGroup>
      </SettingsBlock>
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
