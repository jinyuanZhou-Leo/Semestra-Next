import type { Program, ProgramUpdateInputBody } from '@semestra/api-client'
import {
  academicsProgramDeleteMutation,
  academicsProgramSetSubjectColorMutation,
  academicsProgramUpdateMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { Palette } from 'lucide-react'
import { useState } from 'react'
import type { SettingsSectionProps } from '@/app/extensions'
import {
  DangerZone,
  NumberRow,
  SettingRow,
  SettingsGroup,
  TextRow,
  useAutosave,
} from '@/app/settings'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { ColorPicker } from '../components/ColorPicker'
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
        return (
          <SettingsGroup>
            {subjects.map((subject) => (
              <SettingRow key={subject} label={subject}>
                <ColorPicker
                  label={m.academics_subject_color_of({ subject })}
                  value={p.subject_colors[subject] ?? null}
                  onChange={(color) =>
                    color &&
                    setColor.mutate({
                      path: { program_id: p.id, subject_code: subject },
                      body: { color },
                    })
                  }
                />
              </SettingRow>
            ))}
          </SettingsGroup>
        )
      }}
    </AsyncBoundary>
  )
}
