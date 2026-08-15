/**
 * The hover card is fed very differently by its two callers. The editor hands
 * it everything at once; the reader opens it on a name and fills in the rest
 * when a tier-gated fetch lands. These cover the states only the reader hits.
 *
 * The locked case is the one that matters most: a peek must never show what
 * the drawer would have withheld, even if a description reaches the component.
 */

import { render, screen, act, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { EntityHoverCard, type EntityHoverDetail } from '@bobbinry/ui-components'

const RECT = { top: 400, bottom: 424, left: 100, right: 160 }

function baseDetail(overrides: Partial<EntityHoverDetail> = {}): EntityHoverDetail {
  return {
    key: 'entity-1',
    name: 'Marcus',
    entries: [
      {
        id: 'entity-1',
        name: 'Marcus',
        typeId: 'characters',
        typeIcon: '👤',
        typeLabel: 'Characters',
      },
    ],
    rect: RECT,
    ...overrides,
  }
}

function hover(detail: EntityHoverDetail) {
  act(() => {
    window.dispatchEvent(new CustomEvent('bobbinry:entity-hover', { detail }))
  })
}

function endHover() {
  act(() => {
    window.dispatchEvent(new CustomEvent('bobbinry:entity-hover-end'))
  })
}

afterEach(() => {
  endHover()
})

describe('EntityHoverCard', () => {
  it('stays shut until the pointer has rested', async () => {
    render(<EntityHoverCard />)
    hover(baseDetail({ entries: [{ ...baseDetail().entries[0]!, description: 'A disgraced heir.' }] }))

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('tooltip')).toBeInTheDocument())
    expect(screen.getByText('A disgraced heir.')).toBeInTheDocument()
  })

  it('never renders a description for a locked entity', async () => {
    render(<EntityHoverCard />)
    hover(
      baseDetail({
        locked: { tierLevel: 2 },
        entries: [{ ...baseDetail().entries[0]!, description: 'SPOILER: dies in chapter 9' }],
      })
    )

    await waitFor(() => expect(screen.getByRole('tooltip')).toBeInTheDocument())
    expect(screen.getByText(/Subscriber-only/)).toBeInTheDocument()
    expect(screen.queryByText(/SPOILER/)).not.toBeInTheDocument()
    // The name and type are already public — the highlight itself shows them.
    expect(screen.getByText('Marcus')).toBeInTheDocument()
  })

  it('shows a placeholder rather than claiming there is no description', async () => {
    render(<EntityHoverCard />)
    hover(baseDetail({ pending: true }))

    await waitFor(() => expect(screen.getByRole('tooltip')).toBeInTheDocument())
    expect(screen.queryByText(/No description yet/)).not.toBeInTheDocument()
  })

  it('admits an entity genuinely has no description once the fetch has landed', async () => {
    render(<EntityHoverCard />)
    hover(baseDetail({ pending: false }))

    await waitFor(() => expect(screen.getByRole('tooltip')).toBeInTheDocument())
    expect(screen.getByText(/No description yet/)).toBeInTheDocument()
  })

  it('enriches in place without restarting the wait', async () => {
    render(<EntityHoverCard />)
    const start = Date.now()
    hover(baseDetail({ pending: true }))

    // The fetch lands mid-delay, as it usually does on a warm connection.
    await new Promise(resolve => setTimeout(resolve, 150))
    hover(
      baseDetail({
        entries: [{ ...baseDetail().entries[0]!, description: 'A disgraced heir.' }],
      })
    )

    await waitFor(() => expect(screen.getByText('A disgraced heir.')).toBeInTheDocument())
    // Had the enrichment reset the timer, this would take ~550ms rather than ~400.
    expect(Date.now() - start).toBeLessThan(520)
  })

  it('ignores a hover that arrives while the reader is typing', async () => {
    render(<EntityHoverCard />)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    })
    hover(baseDetail())

    await new Promise(resolve => setTimeout(resolve, 600))
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
})
