import { useQueries } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import {
  CalendarRange,
  ChevronDown,
  Flag,
  GraduationCap,
  Languages,
  LogOut,
  type LucideIcon,
} from 'lucide-react'
import { AnimatePresence, MotionConfig, type Variants, motion } from 'motion/react'
import { type ReactNode, useEffect, useState } from 'react'
import type { Message } from '@/app/extensions'
import { useExtensions } from '@/app/registry'
import { useMotionPreference } from '@/app/theme'
import { useUiPref } from '@/app/ui-pref'
import { SettingsGroup } from '@/app/settings'
import { SignOutDialog } from '@/modules/auth/components/SignOutDialog'
import { useAuth } from '@/modules/auth/useAuth'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { programPath, termPath } from '../paths'
import { TOUR_DONE_KEY } from '../shell/Tour'
import { ONBOARDING_STEPS, type OnboardingNav, type OnboardingStep } from '../types'
import { type Progress, load, store } from './progress'
import { StepFooter } from './StepFooter'
import { ProgramStep, ProgramSummary, TermStep, TermSummary, WelcomeStep } from './steps'

type Step = {
  id: string
  order: number
  icon: LucideIcon
  title: Message
  description: Message
  /** The term wizard needs the room of its course table. */
  wide?: boolean
  /** A step another module adds. */
  extension?: OnboardingStep
}

/** The host's own steps; other modules' steps (`academics.onboardingSteps`) go between them. */
const HOST_STEPS: readonly Step[] = [
  {
    id: 'welcome',
    order: 0,
    icon: Languages,
    title: m.academics_onboarding_welcome_title,
    description: m.academics_onboarding_welcome_body,
  },
  {
    id: 'program',
    order: 10,
    icon: GraduationCap,
    title: m.academics_onboarding_program_title,
    description: m.academics_onboarding_program_body,
  },
  {
    id: 'term',
    order: 500,
    icon: CalendarRange,
    title: m.academics_onboarding_term_title,
    description: m.academics_onboarding_term_body,
    wide: true,
  },
  {
    id: 'done',
    order: 1000,
    icon: Flag,
    title: m.academics_onboarding_done_title,
    description: m.academics_onboarding_done_body,
  },
]

const SLIDE: Variants = {
  enter: (direction: number) => ({ opacity: 0, x: direction * 24 }),
  center: { opacity: 1, x: 0 },
  exit: (direction: number) => ({ opacity: 0, x: direction * -24 }),
}

/**
 * First run without a Program (M02 §5.7): language and appearance → Program → the steps other
 * modules add (setting up AI and the learning platform first, so the term wizard can use them)
 * → first term → notifications → done, then the tour. Every step can go back with what it was
 * given kept; steps that set something up can be skipped, and what needs them is left out.
 */
export function Onboarding() {
  const router = useRouter()
  const motionPreference = useMotionPreference()
  const [, setTourDone] = useUiPref<boolean | null>(TOUR_DONE_KEY, null)
  const { user } = useAuth()
  const [signingOut, setSigningOut] = useState(false)
  const [progress, setProgress] = useState<Progress>(() => load(user?.id))
  const [direction, setDirection] = useState(1)
  useEffect(() => store(progress), [progress])

  const extensions = useExtensions<OnboardingStep>(ONBOARDING_STEPS).filter(
    (step) => step.available?.() ?? true,
  )
  const programId = progress.programId
  const queries = extensions.map((step) => step.status?.queries(programId) ?? [])
  const results = useQueries({ queries: queries.flat() })
  // A step whose status is still loading counts as offered and as having set nothing up.
  const statuses = extensions.map((step, index) => {
    const start = queries.slice(0, index).flat().length
    const data = results.slice(start, start + queries[index]!.length).map((r) => r.data)
    if (!step.status || data.some((d) => d === undefined)) return { offered: true, provides: [] }
    return step.status.read(data)
  })
  const provides = new Set(statuses.flatMap((status) => status.provides))
  const steps = [
    ...HOST_STEPS,
    ...extensions.flatMap((extension, index): Step[] =>
      statuses[index]!.offered ? [{ ...extension, extension }] : [],
    ),
  ].toSorted((a, b) => a.order - b.order)

  // A step no longer offered (it was on an earlier load): carry on where its Program is.
  const found = steps.findIndex((step) => step.id === progress.step)
  const programIndex = steps.findIndex((s) => s.id === 'program')
  const wanted = found >= 0 ? found : programId ? steps.findIndex((s) => s.id === 'term') : 0
  // Every step after the Program's belongs to it: without one, the Program step comes first.
  const index = !programId && wanted > programIndex ? programIndex : wanted
  const step = steps[index]!

  const goTo = (target: number, patch: Partial<Progress> = {}) => {
    setDirection(target < index ? -1 : 1)
    setProgress((current) => ({ ...current, ...patch, step: steps[target]!.id }))
  }
  const nav: OnboardingNav = {
    back: () => goTo(Math.max(index - 1, 0)),
    next: () => goTo(Math.min(index + 1, steps.length - 1)),
  }

  const finish = () => {
    if (!programId) return
    store(null)
    setTourDone(false)
    const term = progress.term
    // Without a term, Today: it has cards for the tour, and the sidebar offers "New term".
    router.history.replace(
      term && term !== 'later' ? termPath(programId, term.id) : `${programPath(programId)}/today`,
    )
  }

  let body: ReactNode = null
  if (step.id === 'welcome') {
    body = <WelcomeStep nav={nav} onLocaleChange={() => store(progress)} />
  } else if (step.id === 'program') {
    body = (
      <ProgramStep
        progress={progress}
        nav={nav}
        onSaved={(id, setup) => goTo(index + 1, { programId: id, setup })}
      />
    )
  } else if (!programId) {
    body = null // not reached: see `index`
  } else if (step.id === 'term') {
    body = (
      <TermStep
        programId={programId}
        progress={progress}
        provides={provides}
        nav={nav}
        onDone={(term) => goTo(index + 1, { term })}
      />
    )
  } else if (step.id === 'done') {
    body = (
      <>
        <SettingsGroup>
          {steps.map((s) =>
            s.id === 'program' ? (
              <ProgramSummary key={s.id} programId={programId} />
            ) : s.id === 'term' ? (
              <TermSummary key={s.id} term={progress.term} />
            ) : s.extension ? (
              <s.extension.summary key={s.id} programId={programId} />
            ) : null,
          )}
        </SettingsGroup>
        <StepFooter onBack={nav.back}>
          <Button onClick={finish}>
            {progress.term && progress.term !== 'later'
              ? m.academics_onboarding_start()
              : m.academics_onboarding_start_no_term()}
          </Button>
        </StepFooter>
      </>
    )
  } else if (step.extension) {
    const Component = step.extension.component
    body = <Component programId={programId} nav={nav} />
  }

  const Icon = step.icon
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-14 shrink-0 items-center gap-4 px-6">
        <GraduationCap aria-hidden className="size-5 shrink-0 text-primary" />
        <ol
          aria-label={m.academics_onboarding_progress({ current: index + 1, total: steps.length })}
          className="mx-auto flex w-full max-w-xl gap-1.5"
        >
          {steps.map((s, i) => (
            <li
              key={s.id}
              aria-current={i === index ? 'step' : undefined}
              className="h-1 flex-1 overflow-hidden rounded-full bg-muted"
            >
              <span className="sr-only">{s.title()}</span>
              <span
                aria-hidden
                className={cn(
                  'block h-full origin-left rounded-full bg-primary transition-transform duration-300 ease-out motion-reduce:transition-none',
                  i <= index ? 'scale-x-100' : 'scale-x-0',
                )}
              />
            </li>
          ))}
        </ol>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="sm" className="shrink-0" />}
            data-testid="signed-in-as"
            aria-label={m.home_signed_in_as({ name: user?.display_name ?? '' })}
          >
            {user?.display_name}
            <ChevronDown aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem variant="destructive" onClick={() => setSigningOut(true)}>
              <LogOut aria-hidden />
              {m.home_sign_out()}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <SignOutDialog open={signingOut} onOpenChange={setSigningOut} />
      </header>
      <MotionConfig reducedMotion={motionPreference}>
        <AnimatePresence mode="wait" initial={false} custom={direction}>
          <motion.main
            key={step.id}
            custom={direction}
            variants={SLIDE}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className={cn(
              'mx-auto flex w-full flex-1 flex-col gap-8 px-6 pt-10 pb-8',
              step.wide ? 'max-w-3xl' : 'max-w-2xl',
            )}
          >
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Icon aria-hidden className="size-6" />
              </div>
              <h1 className="font-heading text-2xl font-semibold tracking-tight">{step.title()}</h1>
              <p className="max-w-md text-muted-foreground">{step.description()}</p>
            </div>
            {body}
          </motion.main>
        </AnimatePresence>
      </MotionConfig>
    </div>
  )
}
