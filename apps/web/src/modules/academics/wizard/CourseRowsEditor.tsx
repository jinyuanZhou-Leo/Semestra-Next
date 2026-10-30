import type { Course } from '@semestra/api-client'
import { BookOpen, ChevronDown, Import, Plus } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { ImportSourceItems } from '@/components/ImportSourceItems'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/ui/dropdown-menu'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/ui/empty'
import { FieldError } from '@/ui/field'
import type { TermWizardImportSource } from '../types'
import { CourseRowsTable, type WizardRow } from './CourseRowsTable'
import { type DraftRow, filledRows, importedRow, newRowKey, rowsInvalid } from './draft'

/**
 * The course rows of a term, shared by the term wizard and "Add course → Enter manually": typed
 * rows, rows read in by an import source, and year-long courses of the previous term that can
 * continue into it (the last two only where the caller passes them).
 */
export function CourseRowsEditor({
  programId,
  heading,
  sources = [],
  rows,
  continuing = [],
  touched,
  defaultCredits,
  startDate,
  endDate,
  onRowsChange,
  onContinue,
}: {
  programId: string
  heading?: ReactNode
  /** Without sources there is no "From existing material" menu (the add-course menu has them). */
  sources?: readonly TermWizardImportSource[]
  rows: DraftRow[]
  continuing?: { course: Course; kept: boolean }[]
  touched: boolean
  defaultCredits: number
  /** The term's dates, for imports that read dated items (meetings, deadlines). */
  startDate?: string
  endDate?: string
  onRowsChange: (update: (rows: DraftRow[]) => DraftRow[]) => void
  onContinue?: (courseId: string, kept: boolean) => void
}) {
  const [importing, setImporting] = useState<string | null>(null)

  const launch = async (source: TermWizardImportSource) => {
    setImporting(source.id)
    try {
      const drafts = await source.launch({ programId, startDate, endDate })
      onRowsChange((current) => [
        ...filledRows(current),
        ...drafts.map((d) => importedRow(source.id, d)),
      ])
    } catch (error) {
      toastError(error)
    }
    setImporting(null)
  }

  const addRow = () =>
    onRowsChange((current) => [
      ...current,
      { key: newRowKey(), code: '', title: '', credits: '', yearLong: false },
    ])
  const tableRows: WizardRow[] = [
    ...continuing.map((c) => ({ kind: 'continue' as const, ...c })),
    ...rows.map((row) => ({ kind: 'draft' as const, row })),
  ]

  const importMenu = (trigger: 'outline' | 'empty') =>
    sources.length > 0 ? (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              size={trigger === 'outline' ? 'sm' : 'default'}
              disabled={importing !== null}
            />
          }
        >
          <Import aria-hidden />
          {importing ? m.common_loading() : m.common_add_from_sources()}
          <ChevronDown aria-hidden data-icon="inline-end" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align={trigger === 'outline' ? 'end' : 'center'} className="w-72">
          <ImportSourceItems
            sources={sources}
            onPick={(source) => void launch(source)}
            titleProps={{ programId }}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null

  return (
    <section className="space-y-4">
      {heading || sources.length > 0 ? (
        <div className="flex min-h-8 items-center justify-between gap-2">
          {heading ?? <span />}
          {tableRows.length > 0 ? importMenu('outline') : null}
        </div>
      ) : null}

      {tableRows.length === 0 ? (
        <Empty className="rounded-2xl border border-solid border-border p-6">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BookOpen aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{m.academics_wizard_courses_empty()}</EmptyTitle>
            <EmptyDescription>
              {sources.length > 0
                ? m.academics_wizard_courses_empty_description()
                : m.academics_wizard_courses_empty_manual()}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row justify-center">
            <Button onClick={addRow}>
              <Plus aria-hidden />
              {m.academics_wizard_add_row()}
            </Button>
            {importMenu('empty')}
          </EmptyContent>
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border">
          <CourseRowsTable
            rows={tableRows}
            programId={programId}
            sources={sources}
            touched={touched}
            defaultCredits={defaultCredits}
            onChange={(key, change) =>
              onRowsChange((current) =>
                current.map((row) => (row.key === key ? { ...row, ...change } : row)),
              )
            }
            onRemove={(key) => onRowsChange((current) => current.filter((r) => r.key !== key))}
            onContinue={(courseId, kept) => onContinue?.(courseId, kept)}
          />
          <div className="border-t border-border p-2">
            <Button variant="ghost" size="sm" onClick={addRow}>
              <Plus aria-hidden />
              {m.academics_wizard_add_row()}
            </Button>
          </div>
        </div>
      )}
      <FieldError>
        {touched && rowsInvalid(rows) ? m.academics_wizard_rows_invalid() : null}
      </FieldError>
    </section>
  )
}
