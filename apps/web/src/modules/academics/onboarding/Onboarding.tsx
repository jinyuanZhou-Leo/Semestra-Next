import { academicsProgramCreateMutation } from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { GraduationCap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { type AppLocale, useLocale } from '@/app/locale'
import { useUpdatePreferences } from '@/app/preferences'
import { useExtensions } from '@/app/registry'
import { useUiPref } from '@/app/ui-pref'
import { SignOutDialog } from '@/modules/auth/components/SignOutDialog'
import { useAuth } from '@/modules/auth/useAuth'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { ChoiceControl } from '@/app/settings/choice'
import { ProgramForm } from '../components/ProgramForm'
import { programPath, termPath } from '../paths'
import { invalidateAcademics } from '../queries'
import { TOUR_DONE_KEY } from '../shell/Tour'
import { ONBOARDING_STEPS, type OnboardingStep } from '../types'
import { TermWizard } from '../wizard/TermWizard'
import { load, type Progress, store } from './progress'

/**
 * First run without a Program (M02 §5.7): language → Program → first term → steps other
 * modules add (`academics.onboardingSteps`) → done, then the tour on the term page (on Today
 * when the first term was left for later).
 */
export function Onboarding() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { locale, changeLocale } = useLocale()
  const updatePreferences = useUpdatePreferences()
  const [, setTourDone] = useUiPref<boolean | null>(TOUR_DONE_KEY, null)
  const extra = useExtensions<OnboardingStep>(ONBOARDING_STEPS).toSorted(
    (a, b) => a.order - b.order,
  )
  const { user } = useAuth()
  const [signingOut, setSigningOut] = useState(false)
  const [progress, setProgress] = useState<Progress>(() => load(user?.id))
  useEffect(() => store(progress), [progress])

  const createProgram = useMutation({
    ...academicsProgramCreateMutation(),
    onError: toastError,
    onSuccess: async (program) => {
      await invalidateAcademics(queryClient)
      updatePreferences({ active_program_id: program.id })
      setProgress((current) => ({ userId: current.userId, step: 2, programId: program.id }))
    },
  })

  const finishIndex = 3 + extra.length
  const step = Math.min(progress.step, finishIndex)
  const advance = (change: Partial<Progress> = {}) =>
    setProgress((current) => ({ ...current, ...change, step: current.step + 1 }))

  const finish = () => {
    store(null)
    setTourDone(false)
    const { programId, termId } = progress
    // Without a term, Today: it has cards for the tour, and the sidebar offers "New term".
    router.history.replace(
      programId ? (termId ? termPath(programId, termId) : `${programPath(programId)}/today`) : '/',
    )
  }

  const extraStep = step >= 3 && step < finishIndex ? extra[step - 3] : undefined

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="flex items-center gap-3">
        <GraduationCap aria-hidden className="size-7 text-primary" />
        <p className="flex-1 text-sm text-muted-foreground">
          {m.academics_onboarding_progress({ current: step + 1, total: finishIndex + 1 })}
        </p>
        {user ? (
          <p className="text-xs text-muted-foreground" data-testid="signed-in-as">
            {m.home_signed_in_as({ name: user.display_name })}
          </p>
        ) : null}
        <Button variant="destructive" size="sm" onClick={() => setSigningOut(true)}>
          {m.home_sign_out()}
        </Button>
        <SignOutDialog open={signingOut} onOpenChange={setSigningOut} />
      </header>

      {step === 0 ? (
        <section className="space-y-6">
          <div className="space-y-2">
            <h1 className="font-heading text-3xl font-semibold tracking-tight">
              {m.academics_onboarding_welcome_title()}
            </h1>
            <p className="text-muted-foreground">{m.academics_onboarding_welcome_body()}</p>
          </div>
          <div className="space-y-2">
            <p id="onboarding-language" className="text-sm font-medium">
              {m.settings_language_label()}
            </p>
            <ChoiceControl<AppLocale>
              labelId="onboarding-language"
              value={locale}
              onChange={(next) => {
                // Changing the language remounts the app; the step is kept in sessionStorage.
                store(progress)
                changeLocale(next)
                updatePreferences({ locale: next })
              }}
              options={[
                { value: 'en', label: 'English' },
                { value: 'zh-CN', label: '简体中文' },
              ]}
            />
          </div>
          <div className="flex justify-end">
            <Button onClick={() => advance()}>{m.academics_wizard_next()}</Button>
          </div>
        </section>
      ) : null}

      {step === 1 ? (
        <section className="space-y-6">
          <div className="space-y-2">
            <h1 className="font-heading text-2xl font-semibold tracking-tight">
              {m.academics_onboarding_program_title()}
            </h1>
            <p className="text-muted-foreground">{m.academics_onboarding_program_body()}</p>
          </div>
          <ProgramForm
            submitLabel={m.academics_wizard_next()}
            pending={createProgram.isPending}
            onSubmit={(body) => createProgram.mutate({ body })}
            footer={
              <Button
                variant="ghost"
                type="button"
                onClick={() => setProgress({ ...progress, step: 0 })}
              >
                {m.academics_wizard_back()}
              </Button>
            }
          />
        </section>
      ) : null}

      {step === 2 && progress.programId ? (
        <section className="space-y-6">
          <div className="space-y-2">
            <h1 className="font-heading text-2xl font-semibold tracking-tight">
              {m.academics_onboarding_term_title()}
            </h1>
            <p className="text-muted-foreground">{m.academics_onboarding_term_body()}</p>
          </div>
          <TermWizard
            programId={progress.programId}
            onCreated={(result) => advance({ termId: result.term.id })}
            onSkip={() => advance({ termId: undefined })}
          />
        </section>
      ) : null}

      {extraStep ? (
        <section className="space-y-6">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            {extraStep.title()}
          </h1>
          <extraStep.component onDone={() => advance()} />
          <div className="flex justify-end">
            <Button variant="ghost" onClick={() => advance()}>
              {m.academics_onboarding_skip()}
            </Button>
          </div>
        </section>
      ) : null}

      {step === finishIndex ? (
        <section className="space-y-6">
          <div className="space-y-2">
            <h1 className="font-heading text-3xl font-semibold tracking-tight">
              {m.academics_onboarding_done_title()}
            </h1>
            <p className="text-muted-foreground">
              {progress.termId
                ? m.academics_onboarding_done_body()
                : m.academics_onboarding_done_body_no_term()}
            </p>
          </div>
          <Button onClick={finish}>
            {progress.termId
              ? m.academics_onboarding_start()
              : m.academics_onboarding_start_no_term()}
          </Button>
        </section>
      ) : null}
    </main>
  )
}
