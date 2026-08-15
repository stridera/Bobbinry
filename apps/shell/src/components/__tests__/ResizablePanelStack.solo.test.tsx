/**
 * Solo mode is what focus mode uses to float exactly one panel over the
 * manuscript. Its two load-bearing promises are easy to break by accident:
 *
 *  1. The other panels keep their mounts. Unmounting them would kill a writing
 *     session in progress or drop an unsaved note every time the writer glances
 *     at a character.
 *  2. It never writes the saved layout. Solo is a temporary view, not a change
 *     to the arrangement the user built.
 */

import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { ResizablePanelStack } from '../ResizablePanelStack'

const SLOT = 'shell.rightPanel'
const STORAGE_KEY = `panelLayout:${SLOT}`

const PANELS = [
  { id: 'entities.entity-preview', title: 'Entity Preview', content: <div>PREVIEW BODY</div> },
  { id: 'notes.chapter-notes', title: 'Chapter Notes', content: <div>NOTES BODY</div> },
  { id: 'bookworm-siege.panel', title: 'Bookworm Siege', content: <div>SIEGE BODY</div> },
]

beforeEach(() => {
  localStorage.clear()
})

describe('ResizablePanelStack solo mode', () => {
  it('keeps every panel mounted, not just the soloed one', () => {
    render(<ResizablePanelStack panels={PANELS} slotId={SLOT} soloPanelId="entities.entity-preview" />)

    expect(screen.getByText('PREVIEW BODY')).toBeInTheDocument()
    // Still mounted — hidden, not removed.
    expect(screen.getByText('NOTES BODY')).toBeInTheDocument()
    expect(screen.getByText('SIEGE BODY')).toBeInTheDocument()
  })

  it('hides the non-soloed panels', () => {
    render(<ResizablePanelStack panels={PANELS} slotId={SLOT} soloPanelId="entities.entity-preview" />)

    const soloWrapper = screen.getByText('PREVIEW BODY').closest('.hidden')
    const notesWrapper = screen.getByText('NOTES BODY').closest('.hidden')

    expect(soloWrapper).toBeNull()
    expect(notesWrapper).not.toBeNull()
  })

  it('drops the panel chrome so the soloed panel reads as one surface', () => {
    const { rerender } = render(<ResizablePanelStack panels={PANELS} slotId={SLOT} />)
    expect(screen.getByText('Panels')).toBeInTheDocument()

    rerender(<ResizablePanelStack panels={PANELS} slotId={SLOT} soloPanelId="entities.entity-preview" />)
    expect(screen.queryByText('Panels')).not.toBeInTheDocument()
  })

  it('preserves panel instances across entering and leaving solo mode', () => {
    // Node identity is the real test: if React remounts, the preview loses the
    // entity it was just handed and the writer sees an empty panel.
    const { rerender } = render(<ResizablePanelStack panels={PANELS} slotId={SLOT} />)
    const notesBefore = screen.getByText('NOTES BODY')
    const previewBefore = screen.getByText('PREVIEW BODY')

    rerender(<ResizablePanelStack panels={PANELS} slotId={SLOT} soloPanelId="entities.entity-preview" />)
    expect(screen.getByText('NOTES BODY')).toBe(notesBefore)
    expect(screen.getByText('PREVIEW BODY')).toBe(previewBefore)

    rerender(<ResizablePanelStack panels={PANELS} slotId={SLOT} />)
    expect(screen.getByText('NOTES BODY')).toBe(notesBefore)
    expect(screen.getByText('PREVIEW BODY')).toBe(previewBefore)
  })

  it('leaves the saved layout untouched', () => {
    const { rerender } = render(<ResizablePanelStack panels={PANELS} slotId={SLOT} />)
    const savedBefore = localStorage.getItem(STORAGE_KEY)
    expect(savedBefore).not.toBeNull()

    rerender(<ResizablePanelStack panels={PANELS} slotId={SLOT} soloPanelId="entities.entity-preview" />)
    expect(localStorage.getItem(STORAGE_KEY)).toBe(savedBefore)

    rerender(<ResizablePanelStack panels={PANELS} slotId={SLOT} />)
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) as string)
    // Every panel still listed, in order, none hidden by the round trip.
    expect(saved.order).toEqual(PANELS.map(panel => panel.id))
    expect(saved.hidden).toEqual([])
  })

  it('renders the soloed panel even if it was collapsed in the saved layout', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        order: PANELS.map(panel => panel.id),
        sizes: [33, 33, 33],
        collapsed: [true, false, false],
        hidden: [],
      })
    )

    render(<ResizablePanelStack panels={PANELS} slotId={SLOT} soloPanelId="entities.entity-preview" />)
    expect(screen.getByText('PREVIEW BODY')).toBeInTheDocument()
  })
})
