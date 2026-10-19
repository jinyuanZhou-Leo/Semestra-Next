import type { Program, ProgramUpdateInputBody } from '@semestra/api-client'
import {
  academicsProgramDeleteMutation,
  academicsProgramSetSubjectColorMutation,
  academicsProgramUpdateMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { Palette } from 'lucide-react'
import { type CellContext, createColumnHelper } from '@tanstack/react-table'
import { createContext, use, useState } from 'react'
import type { SettingsSectionProps } from '@/app/extensions'
import {
  DangerZone,
  NumberRow,
  SettingRow,
  SettingsGroup,
  SettingsTable,
  settingsTableFeatures,
  TextRow,
  useAutosave,
} from '@/app/settings'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { toastError } from '@/lib/errors'
import { subjectColor } from '@/lib/subject-color'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { ColorDotPicker } from '../components/ColorDotPicker'
import type { ColorRef } from '../components/ColorPicker'
import { TimezoneSelect } from '../components/TimezoneSelect'
import { invalidateAcademics, useCourses, useProgram } from '../queries'

/** Program "basics" (M02 §5.2 settings): name, school, time zone, credits; delete. */
export function ProgramBasicsSection({ scope }: SettingsSectionProps) {
  const programId = scope?.programId ?? ''
  return (
    <AsyncBoundary query={useProgram(programId)}>
      {(program) => <ProgramBasics key={program.id} program={program} />}
    </AsyncBoundary>
  )
}

function ProgramBasics({ program }: { program: Program }) {
  const queryClient = useQueryClient()
  const update = useMutation({ ...academicsProgramUpdateMutation() })
  const { queue } = useAutosave<ProgramUpdateInputBody>({
    save: async (body) => {
      try {
        await update.mutateAsync({ path: { program_id: program.id }, body })
      } catch (error) {
        toastError(error)
        throw error
      }
      await invalidateAcademics(queryClient)
    },
  })
  const [timezone, setTimezone] = useState(program.timezone)
  return (
    <SettingsGroup>
      <TextRow
        label={m.academics_program_name()}
        value={program.name}
        required
        onChange={(name) => queue({ name })}
      />
      <TextRow
        label={m.academics_program_institution()}
        value={program.institution ?? ''}
        onChange={(text) => queue({ institution: text.trim() || null })}
      />
      <SettingRow
        label={m.academics_program_timezone()}
        description={m.academics_program_timezone_hint()}
      >
        {(labelId) => (
          <TimezoneSelect
            aria-labelledby={labelId}
            value={timezone}
            onChange={(next) => {
              setTimezone(next)
              queue({ timezone: next })
            }}
          />
        )}
      </SettingRow>
      <NumberRow
        label={m.academics_program_default_credits()}
        description={m.academics_program_default_credits_hint()}
        value={program.default_course_credits}
        max={100}
        onChange={(value) => value !== null && queue({ default_course_credits: value })}
      />
      <NumberRow
        label={m.academics_program_credit_requirement()}
        description={m.academics_program_credit_requirement_hint()}
        value={program.credit_requirement}
        max={10_000}
        nullable
        onChange={(value) => queue({ credit_requirement: value })}
      />
    </SettingsGroup>
  )
}

/** Delete the Program, at the end of its general settings. */
export function ProgramDangerSection({ scope }: SettingsSectionProps) {
  const programId = scope?.programId ?? ''
  return (
    <AsyncBoundary query={useProgram(programId)}>
      {(program) => <ProgramDanger key={program.id} program={program} />}
    </AsyncBoundary>
  )
}

function ProgramDanger({ program }: { program: Program }) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const remove = useMutation({
    ...academicsProgramDeleteMutation(),
    onError: toastError,
    onSuccess: async () => {
      setConfirming(false)
      await invalidateAcademics(queryClient)
      router.history.replace('/')
    },
  })
  return (
    <>
      <DangerZone>
        <SettingRow
          label={m.academics_program_delete()}
          description={m.academics_program_delete_description()}
        >
          <Button variant="destructive" onClick={() => setConfirming(true)}>
            {m.common_delete()}
          </Button>
        </SettingRow>
      </DangerZone>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={m.academics_program_delete_title({ name: program.name })}
        description={`${m.academics_program_delete_confirm({ terms: program.term_count, courses: program.course_count })} ${m.academics_cannot_undo()}`}
        confirmLabel={m.academics_program_delete()}
        pending={remove.isPending}
        onConfirm={() => remove.mutate({ path: { program_id: program.id } })}
      />
    </>
  )
}

type SubjectRow = {
  subject: string
  value: ColorRef | null
  /** The color its courses show: the subject's own, or the default the server picked. */
  color: string | null
  courses: string[]
}

const SetSubjectColorContext = createContext<(subject: string, color: ColorRef) => void>(() => {})

type SubjectCellProps = CellContext<typeof settingsTableFeatures, SubjectRow>

function SubjectColorCell({ row }: SubjectCellProps) {
  const setColor = use(SetSubjectColorContext)
  const { subject, value, color } = row.original
  return (
    <ColorDotPicker
      label={m.academics_subject_color_of({ subject })}
      color={color}
      value={value}
      onChange={(next) => next && setColor(subject, next)}
    />
  )
}

function SubjectCell({ row }: SubjectCellProps) {
  const { subject, courses } = row.original
  return (
    <div className="min-w-0">
      <div className="truncate font-medium">{subject}</div>
      <div className="truncate text-xs text-muted-foreground">
        {courses.length > 0 ? courses.join(' · ') : m.academics_subject_no_courses()}
      </div>
    </div>
  )
}

const subjectColumn = createColumnHelper<typeof settingsTableFeatures, SubjectRow>()
const subjectColumns = subjectColumn.columns([
  subjectColumn.display({
    id: 'color',
    header: () => m.common_color(),
    cell: SubjectColorCell,
  }),
  subjectColumn.accessor((r) => r.subject, {
    id: 'subject',
    header: () => m.academics_subject(),
    cell: SubjectCell,
  }),
])

const SUBJECT_COLUMN_CLASS: Record<string, string> = { color: 'w-12', subject: 'w-full max-w-0' }

function refColor(ref: ColorRef): string {
  return 'palette' in ref ? subjectColor(`subject-${ref.palette}`) : ref.hex
}

/** One color per subject code; every course of the subject follows unless it has its own. */
export function SubjectColorsSection({ scope }: SettingsSectionProps) {
  const programId = scope?.programId ?? ''
  const program = useProgram(programId)
  const courses = useCourses(programId).data?.items ?? []
  const queryClient = useQueryClient()
  const setColor = useMutation({
    ...academicsProgramSetSubjectColorMutation(),
    onError: toastError,
    onSuccess: () => invalidateAcademics(queryClient),
  })
  return (
    <AsyncBoundary query={program}>
      {(p) => {
        const subjects = [
          ...new Set([
            ...Object.keys(p.subject_colors),
            ...courses.map((c) => c.subject_code).filter(Boolean),
          ]),
        ].toSorted()
        if (subjects.length === 0) {
          return (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Palette aria-hidden />
                </EmptyMedia>
                <EmptyTitle>{m.academics_subjects_empty()}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          )
        }
        const rows = subjects.map((subject): SubjectRow => {
          const own = p.subject_colors[subject] ?? null
          const members = courses.filter((c) => c.subject_code === subject)
          // A course without its own color shows the subject's color as resolved by the server.
          const follower = members.find((c) => c.color === null)
          return {
            subject,
            value: own,
            color: own ? refColor(own) : follower ? subjectColor(follower.resolved_color) : null,
            courses: members.map((c) => c.code ?? c.title),
          }
        })
        return (
          <SetSubjectColorContext
            value={(subject, color) =>
              setColor.mutate({
                path: { program_id: p.id, subject_code: subject },
                body: { color },
              })
            }
          >
            <SettingsTable
              label={m.academics_settings_subject_colors()}
              data={rows}
              columns={subjectColumns}
              getRowId={(r) => r.subject}
              columnClassName={SUBJECT_COLUMN_CLASS}
            />
          </SetSubjectColorContext>
        )
      }}
    </AsyncBoundary>
  )
}
