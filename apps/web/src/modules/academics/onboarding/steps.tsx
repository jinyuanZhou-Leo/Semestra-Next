import {
  academicsProgramCreateMutation,
  academicsProgramUpdateMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CalendarRange, GraduationCap } from 'lucide-react'
import { type AppLocale, useLocale } from '@/app/locale'
import { useSetTheme, useUpdatePreferences } from '@/app/preferences'
import { useExtensions } from '@/app/registry'
import { SettingRow, SettingsGroup } from '@/app/settings'
import { ChoiceControl } from '@/app/settings/choice'
import { useTheme } from '@/app/theme'
import { THEME_OPTIONS } from '@/app/theme-options'
import { toastError } from '@/lib/errors'
import { formatDate } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Skeleton } from '@/ui/skeleton'
import { ProgramForm, type ProgramFormValues } from '../components/ProgramForm'
import { invalidateAcademics, useProgram, useTerms } from '../queries'
import { PROGRAM_SETUP_FIELDS, type OnboardingNav, type ProgramSetupField } from '../types'
import { TermWizard } from '../wizard/TermWizard'
import type { Progress } from './progress'
import { StepFooter, SummaryIcon, SummaryRow } from './StepFooter'

/** Language and appearance, the same controls as in settings; both apply at once. */
export function WelcomeStep({
  nav,
  onLocaleChange,
}: {
  nav: OnboardingNav
  /** Called before the language changes, which remounts the app. */
  onLocaleChange: () => void
}) {
  const { locale, changeLocale } = useLocale()
  const updatePreferences = useUpdatePreferences()
  const { theme } = useTheme()
  const setTheme = useSetTheme()
  return (
    <>
      <SettingsGroup>
        <SettingRow label={m.settings_language_label()}>
          {(labelId) => (
            <ChoiceControl<AppLocale>
              labelId={labelId}
              value={locale}
              onChange={(next) => {
                onLocaleChange()
                changeLocale(next)
                updatePreferences({ locale: next })
              }}
              options={[
                { value: 'en', label: 'English' },
                { value: 'zh-CN', label: '简体中文' },
              ]}
            />
          )}
        </SettingRow>
        <SettingRow label={m.settings_theme_label()}>
          {(labelId) => (
            <ChoiceControl
              labelId={labelId}
              value={theme}
              onChange={setTheme}
              options={THEME_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label(),
              }))}
            />
          )}
        </SettingRow>
      </SettingsGroup>
      <StepFooter>
        <Button onClick={nav.next}>{m.academics_onboarding_continue()}</Button>
      </StepFooter>
    </>
  )
}

/**
 * The Program: created on the first "Continue"; coming back to the step edits the same one, and
 * setup rows that changed are applied to it.
 */
export function ProgramStep({
  progress,
  nav,
  onSaved,
}: {
  progress: Progress
  nav: OnboardingNav
  onSaved: (programId: string, setup: Record<string, unknown>) => void
}) {
  const queryClient = useQueryClient()
  const programId = progress.programId
  const program = useProgram(programId)
  const setupFields = useExtensions<ProgramSetupField>(PROGRAM_SETUP_FIELDS)
  const create = useMutation({ ...academicsProgramCreateMutation(), onError: toastError })
  const update = useMutation({ ...academicsProgramUpdateMutation(), onError: toastError })
  const pending = create.isPending || update.isPending

  const save = async ({ setup, ...fields }: ProgramFormValues) => {
    const values = setup ?? {}
    if (!programId) {
      const created = await create.mutateAsync({ body: { ...fields, setup: values } })
      await invalidateAcademics(queryClient)
      onSaved(created.id, values)
      return
    }
    await update.mutateAsync({ path: { program_id: programId }, body: fields })
    const changed = setupFields.filter((f) => values[f.id] !== progress.setup?.[f.id])
    await Promise.all(changed.map((f) => f.apply(programId, values[f.id])))
    await invalidateAcademics(queryClient)
    onSaved(programId, values)
  }

  // Back on the step: the form opens with the Program as it is.
  if (programId && !program.data) return <Skeleton className="h-80 w-full rounded-2xl" />
  const data = program.data
  return (
    <ProgramForm
      initial={
        data
          ? {
              name: data.name,
              institution: data.institution,
              timezone: data.timezone,
              default_course_credits: data.default_course_credits,
              setup: progress.setup,
            }
          : undefined
      }
      onSubmit={(body) => void save(body).catch(() => undefined)}
      footer={
        <StepFooter onBack={nav.back}>
          <Button type="submit" disabled={pending}>
            {pending ? m.common_saving() : m.academics_onboarding_continue()}
          </Button>
        </StepFooter>
      }
    />
  )
}

/**
 * The first term: the term wizard, offering only the import sources whose setup is done. Once
 * created, coming back shows it instead of making another.
 */
export function TermStep({
  programId,
  progress,
  provides,
  nav,
  onDone,
}: {
  programId: string
  progress: Progress
  provides: ReadonlySet<string>
  nav: OnboardingNav
  onDone: (term: Progress['term']) => void
}) {
  const term = progress.term
  if (term && term !== 'later') {
    return (
      <>
        <SettingsGroup>
          <CreatedTermRow programId={programId} termId={term.id} />
        </SettingsGroup>
        <StepFooter onBack={nav.back}>
          <Button onClick={nav.next}>{m.academics_onboarding_continue()}</Button>
        </StepFooter>
      </>
    )
  }
  return (
    <TermWizard
      programId={programId}
      provides={provides}
      onBack={nav.back}
      onCreated={(result) =>
        onDone({
          id: result.term.id,
          name: result.term.name,
          courses: result.course_ids.length,
        })
      }
      onSkip={() => onDone('later')}
    />
  )
}

const day = (iso: string) => formatDate(`${iso}T00:00`)

function CreatedTermRow({ programId, termId }: { programId: string; termId: string }) {
  const term = useTerms(programId).data?.items.find((t) => t.id === termId)
  return (
    <SummaryRow
      media={<SummaryIcon icon={CalendarRange} />}
      title={term?.name ?? ''}
      detail={term ? `${day(term.start_date)} – ${day(term.end_date)}` : undefined}
      done
    />
  )
}

/** The Program and the first term on the done step; the steps between add their own rows. */
export function ProgramSummary({ programId }: { programId: string }) {
  const program = useProgram(programId).data
  return (
    <SummaryRow
      media={<SummaryIcon icon={GraduationCap} />}
      title={m.academics_onboarding_program_title()}
      detail={program ? [program.name, program.institution].filter(Boolean).join(' · ') : ''}
      done
    />
  )
}

export function TermSummary({ term }: { term: Progress['term'] }) {
  const created = term && term !== 'later' ? term : null
  return (
    <SummaryRow
      media={<SummaryIcon icon={CalendarRange} />}
      title={m.academics_onboarding_term_title()}
      detail={
        created
          ? `${created.name} · ${m.academics_course_count({ count: created.courses })}`
          : m.academics_onboarding_term_summary_later()
      }
      done={created !== null}
    />
  )
}
