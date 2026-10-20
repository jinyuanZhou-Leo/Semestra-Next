import type { AgentProposalOut } from '@semestra/api-client'
import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { ProposalChanges } from './ProposalCard'

function proposal(
  preview: Record<string, unknown>,
  effect: AgentProposalOut['effect'] = 'write',
): AgentProposalOut {
  return {
    id: 'pr1',
    session_id: 's1',
    message_id: 'a1',
    call_id: 'call1',
    capability: 'tasks.item.update',
    effect,
    args: {},
    input_schema: { properties: {} },
    preview,
    status: 'pending',
    result: null,
    error_code: null,
    created_at: '2026-10-20T12:00:00Z',
    decided_at: null,
    executed_at: null,
  }
}

function rows(): string[] {
  return screen.getAllByRole('definition').map((dd) => dd.textContent ?? '')
}

test('a cleared value says so, and an empty list or folder by its own name', () => {
  render(
    <ProposalChanges
      proposal={proposal({
        changes: [
          { field: 'list', before: 'Errands', after: null },
          { field: 'folder', before: 'Slides', after: null },
          { field: 'final_override_percentage', before: 85, after: null },
          { field: 'exception', before: 'cancelled', after: null },
        ],
      })}
    />,
  )
  expect(rows()).toEqual([
    'ErrandsUnsorted',
    'SlidesCourse files (no folder)',
    '85Cleared',
    'CancelledAs scheduled',
  ])
  expect(screen.getByText('Official final grade (%)')).toBeInTheDocument()
})

test('a shortened list says how many more there are; a card kind reads as its title', () => {
  render(
    <ProposalChanges
      proposal={proposal({
        changes: [
          { field: 'lms_assignments', after: ['Lab 1', 'Lab 2'], count: 12 },
          { field: 'card', after: 'sticky.note' },
          { field: 'as_kind', after: 'task' },
        ],
      })}
    />,
  )
  const [listed, card, kind] = rows()
  expect(listed).toBe('Lab 1, Lab 2 and 10 more')
  expect(card).not.toBe('sticky.note')
  expect(kind).toBe('Task')
})

test('what a delete removes is struck through, without "cleared" after it', () => {
  render(
    <ProposalChanges
      proposal={proposal(
        { changes: [{ field: 'courses', before: ['APS105H1'], after: null, count: 1 }] },
        'destructive',
      )}
    />,
  )
  expect(rows()).toEqual(['APS105H1'])
  expect(screen.getByText('APS105H1')).toHaveClass('line-through')
})
